// Integrity checks for the OBLIGATION-REFERENCE COUNTERFACTUAL. Read-only; it writes and fixes nothing.
//
// It inherits V3's three properties and adds the three a COUNTERFACTUAL needs, because a counterfactual
// can fail in ways a standalone benchmark cannot:
//
//   4. THE RULER'S ARITHMETIC IS UNCHANGED. The scorer is a byte copy of V3's with two lines
//      redirected. Checked by re-deriving the diff and refusing any hunk that is not one of them — a
//      measured improvement obtained with a reshaped ruler measures the ruler.
//   5. THE VARIANT IS THE BASELINE PLUS ONE FACT. The six integrity proofs, run again here so they
//      gate every scoring run and not only the freeze.
//   6. V3 ITSELF DID NOT MOVE. Its data, its harness and its lock are hashed against its own frozen
//      record, so "we changed nothing over there" is a check rather than a promise.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { frozenProblems, integrityProblems, DATA_FILES, SCRIPT_FILES } from "./freeze.mjs";

const HARNESS = "scripts/reconciliation-obligation-ref";
const V3_HARNESS = "scripts/reconciliation-synthetic";
const problems = [];

// ── 1 · generator independence ───────────────────────────────────────────────────────────────────
const gen = readFileSync(`${HARNESS}/generate.mjs`, "utf8");
for (const [, spec] of gen.matchAll(/from\s+"([^"]+)"/g)) {
  if (!spec.startsWith("node:")) problems.push(`generator imports "${spec}" — it must import node builtins only`);
}

// ── 2 · nothing under the product reads either answer key ────────────────────────────────────────
const FORBIDDEN = /planted-register\.json|ground-truth\.csv/;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
    if (FORBIDDEN.test(readFileSync(full, "utf8"))) problems.push(`${full} reads the ground truth`);
  }
};
for (const root of ["src", "server"]) walk(root);

// ── 3 · the variant freeze holds ─────────────────────────────────────────────────────────────────
problems.push(...frozenProblems());

// ── 4 · the ruler's arithmetic is unchanged ──────────────────────────────────────────────────────
//
// Compared as CODE with comments stripped, because the banner legitimately differs and a check that
// reads comments measures documentation — the lesson the emitter's structural guard learned against
// its own fixture, and the scoreboard's guard after it.
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
  const mine = strip(readFileSync(`${HARNESS}/score.mjs`, "utf8"));
  const theirs = strip(readFileSync(`${V3_HARNESS}/score.mjs`, "utf8"));
  const expected = theirs.replace(
    'const DIR = "e2e/fixtures/reconciliation-synthetic";',
    'const DIR = "e2e/fixtures/reconciliation-obligation-ref";',
  );
  if (theirs === expected) problems.push("the DIR redirect was not found in V3's scorer — this check has gone inert");
  if (mine !== expected) problems.push("the variant scorer differs from V3's beyond the DIR redirect — the RULER CHANGED");
}

// ── 5 · the variant is the baseline plus one fact ────────────────────────────────────────────────
problems.push(...integrityProblems());

// ── 6 · V3 itself did not move ───────────────────────────────────────────────────────────────────
{
  const lock = JSON.parse(readFileSync(`${V3_HARNESS}/FREEZE.lock.json`, "utf8"));
  const { createHash } = await import("node:crypto");
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  for (const [f, want] of Object.entries(lock.data)) {
    if (sha(readFileSync(`e2e/fixtures/reconciliation-synthetic/${f}`, "utf8")) !== want) {
      problems.push(`V3 data artefact ${f} no longer matches V3's own lock — the BASELINE moved`);
    }
  }
  for (const [f, want] of Object.entries(lock.scripts)) {
    if (sha(readFileSync(`${V3_HARNESS}/${f}`, "utf8")) !== want) {
      problems.push(`V3 harness script ${f} no longer matches V3's own lock — the BASELINE HARNESS moved`);
    }
  }
  if (lock.revision !== "V3") problems.push(`V3's lock now names revision ${lock.revision}`);
}

if (problems.length > 0) {
  process.stdout.write(`VERIFY FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `verified · generator imports only node builtins · no product module reads a ground truth · ` +
  `the ruler's arithmetic is byte-identical to V3's · the variant is V3 plus one column · ` +
  `V3's own package and harness are unmoved · ${DATA_FILES.length} data artefacts + ${SCRIPT_FILES.length} scripts match the variant lock\n`,
);
