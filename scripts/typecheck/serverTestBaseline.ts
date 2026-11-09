// THE RATCHET ON THE SERVER TESTS' TYPECHECK. It cannot make CI green by lowering a bar; it can only
// refuse an increase.
//
// WHY A RATCHET AND NOT A HARD GATE. `tsconfig.server.test.json` currently reports 33 errors across 19
// files. A hard zero-error gate would be red on arrival and would therefore be turned off, or worse,
// satisfied by `@ts-ignore` — which is hiding errors, not fixing them. A ratchet pinned to the measured
// count blocks the only thing that actually matters in the meantime: the number getting WORSE. The plan
// to drive it to zero is in `docs/CI_SERVER_TYPECHECK_V1.md` and is not a promise this script enforces.
//
// EXACT MATCH, NOT "AT MOST". A decrease fails too, and deliberately: an improvement must be recorded by
// lowering the pinned number in the same change, or the committed baseline stops describing the
// repository and the guard quietly stops being able to detect the next regression. This repository
// already pins dedupe keys to bare literals for the same reason.
//
// PURE DECISION, IMPURE GATHERING. `compareTypecheckBaseline` takes the compiler's output as a string and
// returns a verdict; nothing in it reads a file, runs a process or consults a clock. The entry point does
// all of that. A command whose claims cannot be imported cannot be falsified.
export interface TypecheckBaseline {
  readonly errors: number;
  readonly files: number;
}

export interface TypecheckVerdict {
  readonly ok: boolean;
  readonly observed: TypecheckBaseline;
  readonly pinned: TypecheckBaseline;
  readonly reason: string;
}

/**
 * Count the diagnostics in a `tsc` run's stdout.
 *
 * COUNTS THE ERROR LINES, NOT THE WORD "error". A diagnostic line is `path(line,col): error TSxxxx: …`,
 * and tsc also prints indented continuation lines that can contain the word. Anchoring on the code is
 * what makes this a count of diagnostics rather than a count of a term — a term is not a claim.
 */
export function parseTypecheckOutput(stdout: string): TypecheckBaseline {
  const lines = stdout.split("\n").filter((l) => /^\S.*error TS\d+:/.test(l));
  const files = new Set(lines.map((l) => l.replace(/\(.*$/, "")));
  return { errors: lines.length, files: files.size };
}

export function compareTypecheckBaseline(
  stdout: string,
  pinned: TypecheckBaseline,
): TypecheckVerdict {
  const observed = parseTypecheckOutput(stdout);
  if (observed.errors > pinned.errors) {
    return {
      ok: false, observed, pinned,
      reason: `server test typecheck REGRESSED: ${observed.errors} errors against a pinned ${pinned.errors}. `
        + "Fix the new error. Do not raise the pinned number, and do not silence it with a suppression "
        + "comment — the pinned number is a record of a known debt, not a budget to spend.",
    };
  }
  if (observed.errors < pinned.errors) {
    return {
      ok: false, observed, pinned,
      reason: `server test typecheck IMPROVED: ${observed.errors} errors against a pinned ${pinned.errors}. `
        + "Lower the pinned number in scripts/typecheck/server-test-baseline.json in this same change, so "
        + "the committed baseline keeps describing the repository and can still detect the next regression.",
    };
  }
  if (observed.files !== pinned.files) {
    return {
      ok: false, observed, pinned,
      reason: `the error COUNT matches the pinned ${pinned.errors} but it is spread over ${observed.files} `
        + `files rather than ${pinned.files}. The same total across a different set of files means errors `
        + "moved, which is a change this guard will not pass silently.",
    };
  }
  return {
    ok: true, observed, pinned,
    reason: `server test typecheck unchanged: ${observed.errors} known errors across ${observed.files} files, `
      + "exactly as pinned. No regression.",
  };
}
