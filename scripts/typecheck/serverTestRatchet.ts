// GATHERING FOR THE SERVER-TEST TYPECHECK RATCHET. Importable, and importing it runs nothing.
//
// THE SPLIT IS THE ONE THIS REPOSITORY ALREADY SETTLED — `ciStatus.ts` (importable) beside
// `ci-status.ts` (the command). The pure decision is in `serverTestBaseline.ts`, the gathering is here,
// and `check-server-tests.ts` holds argv, stdout and the exit code.
//
// AND IT IS THE SHAPE FORCED BY A REAL FAILURE, TWICE NOW. My first version of this gate ended with
// `main()` behind `process.argv[1].endsWith("check-server-tests.ts")`. Under `vite-node` — how every
// script in this repository runs — `process.argv[1]` is the vite-node BINARY and the script path is
// consumed entirely, so the guard was ALWAYS FALSE and the gate exited 0 having done nothing. That is
// exactly the failure `scripts/coordination/endpoint.ts` had already recorded in prose, and I walked
// into it anyway. A conditional self-invocation is the wrong shape; the command is unconditional.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { compareTypecheckBaseline, type TypecheckBaseline, type TypecheckVerdict } from "./serverTestBaseline";

export interface RatchetResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** Absent when tsc could not be run at all — our own failure, never reported as the code's. */
  readonly verdict?: TypecheckVerdict;
}

export function readPinnedBaseline(repoRoot: string): TypecheckBaseline {
  const raw = readFileSync(join(repoRoot, "scripts/typecheck/server-test-baseline.json"), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const errors = Number(parsed.errors);
  const files = Number(parsed.files);
  if (!Number.isSafeInteger(errors) || !Number.isSafeInteger(files) || errors < 0 || files < 0) {
    throw new Error("the pinned baseline must carry non-negative integer `errors` and `files`");
  }
  return { errors, files };
}

export function runServerTestTypecheck(repoRoot: string): RatchetResult {
  let pinned: TypecheckBaseline;
  try {
    pinned = readPinnedBaseline(repoRoot);
  } catch (e) {
    return { ok: false, lines: [`NH_INTERNAL_ERROR · pinned baseline unreadable: ${e instanceof Error ? e.message : String(e)}`] };
  }
  // `tsc` exits non-zero WHEN IT REPORTS DIAGNOSTICS, which is not a failure of this command — the
  // diagnostics are the measurement. Only an inability to run it at all is reported as our own fault.
  const run = spawnSync("npx", ["tsc", "-p", "tsconfig.server.test.json"], {
    cwd: repoRoot, encoding: "utf8", shell: false,
  });
  if (run.error) {
    return { ok: false, lines: [`NH_INTERNAL_ERROR · could not run tsc: ${run.error.message}`] };
  }
  const verdict = compareTypecheckBaseline(`${run.stdout ?? ""}${run.stderr ?? ""}`, pinned);
  return {
    ok: verdict.ok,
    verdict,
    lines: [
      "── server test typecheck ratchet (tsconfig.server.test.json)",
      `   pinned   : ${verdict.pinned.errors} errors / ${verdict.pinned.files} files`,
      `   observed : ${verdict.observed.errors} errors / ${verdict.observed.files} files`,
      verdict.ok ? `   OK · ${verdict.reason}` : `   REFUSED · ${verdict.reason}`,
      "",
      "This gate measures KNOWN DEBT in test files only. The server's PRODUCTION typecheck is a separate,",
      "hard, zero-error gate (`npm run typecheck:server`). Neither may be satisfied by a suppression.",
    ],
  };
}
