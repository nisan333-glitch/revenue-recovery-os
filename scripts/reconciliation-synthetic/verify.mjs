// The experiment's own integrity checks. Read-only; it writes nothing and it fixes nothing.
//
// Three independent properties, because each one, if it failed silently, would make a good-looking
// result meaningless:
//
//   1. THE GENERATOR IMPORTS NOTHING FROM THE PRODUCT. Sharing a module family with the code under test
//      would make the data and the detector encode the same assumptions, and agreement would prove
//      nothing. This is the EP-31 harness's rule, applied to the second generator.
//   2. NO DETECTOR READS THE GROUND TRUTH. A reconciler that can see the answer key is not being
//      measured. Asserted over the whole product tree, not promised in a comment.
//   3. THE FREEZE HOLDS. Every artefact, and the generator itself, hashes to what was frozen — so the
//      experiment cannot be quietly adjusted after a result is seen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIR = "e2e/fixtures/reconciliation-synthetic";
const GEN = "scripts/reconciliation-synthetic/generate.mjs";
const sha = (t) => createHash("sha256").update(t).digest("hex");
const problems = [];

// ── 1 · generator independence ────────────────────────────────────────────────────────────────────
const gen = readFileSync(GEN, "utf8");
for (const [, spec] of gen.matchAll(/from\s+"([^"]+)"/g)) {
  if (!spec.startsWith("node:")) problems.push(`generator imports "${spec}" — it must import node builtins only`);
}

// ── 2 · nothing under the product reads the answer key ────────────────────────────────────────────
const FORBIDDEN = /reconciliation-synthetic\/(ground-truth|planted-register)|planted-register\.json|ground-truth\.csv/;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
    if (full.startsWith("scripts/reconciliation-synthetic/")) continue; // the harness itself may read it
    const text = readFileSync(full, "utf8");
    if (FORBIDDEN.test(text)) problems.push(`${full} reads the ground truth`);
  }
};
for (const root of ["src", "server"]) walk(root);

// ── 3 · the freeze ────────────────────────────────────────────────────────────────────────────────
const frozen = JSON.parse(readFileSync(`${DIR}/FROZEN.json`, "utf8"));
const { compositeSha256, ...record } = frozen;
if (sha(JSON.stringify(record)) !== compositeSha256) problems.push("FROZEN.json itself was edited");
for (const [name, want] of Object.entries(frozen.files)) {
  const got = sha(readFileSync(`${DIR}/${name}`, "utf8"));
  if (got !== want) problems.push(`${name} changed since the freeze`);
}
if (sha(gen) !== frozen.generator) problems.push("the generator changed since the freeze");

if (problems.length > 0) {
  process.stdout.write(`VERIFY FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `verified · generator imports only node builtins · no product module reads the ground truth · ` +
  `${Object.keys(frozen.files).length} artefacts + the generator hash to the freeze\n`,
);
