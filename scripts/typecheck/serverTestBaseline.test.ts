// Falsifiers for the server-test typecheck ratchet.
//
// THE DECISION IS TESTED WITHOUT RUNNING THE COMPILER, which is the point of keeping it pure: the
// verdicts can be falsified from fixture strings, so a change to the rule fails here rather than being
// discovered by a CI run that happened to have the right number of errors in it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compareTypecheckBaseline, parseTypecheckOutput } from "./serverTestBaseline";

const HERE = dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(readFileSync(resolve(HERE, "server-test-baseline.json"), "utf8")) as {
  errors: number; files: number;
};

const diag = (file: string, line: number, code: string, msg: string) =>
  `${file}(${line},9): error ${code}: ${msg}`;

describe("the typecheck ratchet counts diagnostics, not the word 'error'", () => {
  it("counts one diagnostic per anchored error line", () => {
    const out = [
      diag("server/a.test.ts", 1, "TS2322", "Type 'string' is not assignable to type 'number'."),
      diag("server/b.test.ts", 2, "TS6133", "'X' is declared but its value is never read."),
    ].join("\n");
    expect(parseTypecheckOutput(out)).toEqual({ errors: 2, files: 2 });
  });

  it("does NOT count an indented continuation line that contains the word error", () => {
    // tsc wraps long diagnostics. A guard that matched the bare term would double-count them — the
    // recurring lesson in this repository: a term is not a claim.
    const out = [
      diag("server/a.test.ts", 1, "TS2322", "Type 'A' is not assignable to type 'B'."),
      "    the error above originates from a nested property error TS2322: not a real diagnostic",
    ].join("\n");
    expect(parseTypecheckOutput(out).errors).toBe(1);
  });

  it("counts two diagnostics in ONE file as one file", () => {
    const out = [
      diag("server/a.test.ts", 1, "TS2322", "x"),
      diag("server/a.test.ts", 9, "TS6133", "y"),
    ].join("\n");
    expect(parseTypecheckOutput(out)).toEqual({ errors: 2, files: 1 });
  });

  it("an empty run is zero, not a parse failure", () => {
    expect(parseTypecheckOutput("")).toEqual({ errors: 0, files: 0 });
  });
});

describe("the ratchet refuses in both directions, and says which", () => {
  const pinned = { errors: 2, files: 2 };
  const two = [diag("server/a.test.ts", 1, "TS1", "x"), diag("server/b.test.ts", 1, "TS2", "y")].join("\n");

  it("PASSES when the count and the file spread both match", () => {
    const v = compareTypecheckBaseline(two, pinned);
    expect(v.ok).toBe(true);
    expect(v.reason).toContain("No regression");
  });

  it("REFUSES a regression, and tells the reader not to raise the pin", () => {
    const three = `${two}\n${diag("server/c.test.ts", 1, "TS3", "z")}`;
    const v = compareTypecheckBaseline(three, pinned);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("REGRESSED");
    expect(v.reason).toContain("Do not raise the pinned number");
    // The remedy must not be a suppression. If this sentence ever goes, the guard starts inviting one.
    expect(v.reason).toMatch(/suppression/);
  });

  it("REFUSES an improvement too, because an un-lowered pin stops describing the repository", () => {
    const v = compareTypecheckBaseline(diag("server/a.test.ts", 1, "TS1", "x"), pinned);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("IMPROVED");
    expect(v.reason).toContain("Lower the pinned number");
  });

  it("REFUSES the same total spread over a DIFFERENT number of files", () => {
    // Same debt, moved. Passing this silently would let one file's errors be traded for another's.
    const bothInOne = [diag("server/a.test.ts", 1, "TS1", "x"), diag("server/a.test.ts", 2, "TS2", "y")].join("\n");
    const v = compareTypecheckBaseline(bothInOne, pinned);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("errors moved");
  });
});

describe("the gates are WIRED, because a gate CI never runs is not a gate", () => {
  const WF = readFileSync(resolve(HERE, "../../.github/workflows/ci.yml"), "utf8");
  const PKG = JSON.parse(readFileSync(resolve(HERE, "../../package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("both npm scripts exist and point at the two separate projects", () => {
    expect(PKG.scripts["typecheck:server"]).toBe("tsc --noEmit -p tsconfig.server.json");
    expect(PKG.scripts["typecheck:server:ratchet"]).toContain("check-server-tests.ts");
  });

  it("CI runs the production gate and the ratchet", () => {
    // Matched on `run:` lines only. A workflow COMMENT naming a command is not a step that runs it —
    // the recurring lesson, and the reason the next assertion exists at all.
    const runLines = WF.split("\n").filter((l) => /^\s*run:/.test(l));
    expect(runLines.some((l) => l.includes("npm run typecheck:server\n") || l.trim() === "run: npm run typecheck:server")).toBe(true);
    expect(runLines.some((l) => l.trim() === "run: npm run typecheck:server:ratchet")).toBe(true);
  });

  it("neither gate is swallowed by continue-on-error or '|| true'", () => {
    // Read EXECUTABLE lines, never prose: ci.yml already contains a comment that mentions `|| true`
    // to say there is none, and a guard matching the bare term reports that comment as a violation.
    // That happened while verifying this very change — the fourteenth instance in this repository.
    const exec = WF.split("\n").filter((l) => /^\s*(run:|continue-on-error:)/.test(l));
    expect(exec.filter((l) => /\|\| true|continue-on-error/.test(l))).toEqual([]);
    // And the stripper is not vacuous: the term really is present in the file, just not in a step.
    expect(WF).toMatch(/\|\| true/);
  });

  it("the test project is collected by vitest and typechecked by tsc", () => {
    const vite = readFileSync(resolve(HERE, "../../vite.config.ts"), "utf8");
    expect(vite).toContain("scripts/typecheck/**/*.test.ts");
    const tscfg = readFileSync(resolve(HERE, "../../tsconfig.scripts.json"), "utf8");
    expect(tscfg).toContain("scripts/typecheck/**/*.ts");
  });

  it("the production config still EXCLUDES tests, so the two programs stay separate", () => {
    const prod = readFileSync(resolve(HERE, "../../tsconfig.server.json"), "utf8");
    expect(prod).toContain("server/**/*.test.ts");
    expect(prod).toContain("server/test/**");
  });

  it("the test config differs from production ONLY in the module system", () => {
    // If a future edit loosens `strict` here to lower the count, this fails. The debt must be paid by
    // fixing code, never by weakening the compiler.
    const raw = readFileSync(resolve(HERE, "../../tsconfig.server.test.json"), "utf8");
    expect(raw).toContain('"extends": "./tsconfig.server.json"');
    expect(raw).not.toMatch(/"strict"\s*:\s*false/);
    expect(raw).not.toMatch(/"noUnusedLocals"\s*:\s*false/);
    expect(raw).not.toMatch(/"noUnusedParameters"\s*:\s*false/);
    expect(raw).not.toMatch(/"skipLibCheck"\s*:\s*true[\s\S]*"strict"\s*:\s*false/);
  });
});

describe("the pinned baseline is a record, and says so", () => {
  it("pins the measured debt as non-negative integers", () => {
    expect(Number.isSafeInteger(PINNED.errors)).toBe(true);
    expect(Number.isSafeInteger(PINNED.files)).toBe(true);
    expect(PINNED.errors).toBeGreaterThanOrEqual(0);
  });

  it("states that it is NOT a budget, so nobody reads the number as an allowance", () => {
    const raw = readFileSync(resolve(HERE, "server-test-baseline.json"), "utf8");
    expect(raw).toContain("_notABudget");
    expect(raw).toMatch(/never raised/i);
  });

  it("the ratchet command is UNCONDITIONAL — a vite-node argv guard never fires", () => {
    // The failure this file exists to prevent a second time: my first version guarded `main()` on
    // `process.argv[1]`, which under vite-node is the vite-node binary, so the gate exited 0 in silence.
    //
    // COMMENTS ARE STRIPPED BEFORE MATCHING, and the first form of THIS test did not strip them — so it
    // failed on the command's own comment explaining why the argv guard is absent. That is the thirteenth
    // recorded instance in this repository of a structural guard reading prose instead of code, and I
    // produced it inside a test about that exact class of bug. A term is not a claim.
    const cmd = readFileSync(resolve(HERE, "check-server-tests.ts"), "utf8");
    const code = cmd.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/process\.argv\[1\]/);
    expect(code).toContain("runServerTestTypecheck(process.cwd())");
    expect(code).toContain("process.exit(");
    // And the stripper must actually strip: if this fails, the assertion above proves nothing.
    expect(cmd).toMatch(/process\.argv\[1\]/);
    expect(code).not.toMatch(/UNCONDITIONAL, NOT GUARDED/);
  });
});
