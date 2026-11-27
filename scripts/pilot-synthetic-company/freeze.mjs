// FREEZE THE RULER · the production-lane harness, hashed into a tracked lock.
//
// WHY. *The ruler is part of the experiment.* This harness measured $3,064.45 provable before a
// product change and $76,458.30 after; if the harness can move between those runs, the comparison
// means nothing. The frozen reconciliation packages already lock their data AND their scripts for
// exactly this reason, after a scorer was edited once with a result already visible.
//
// IT COVERS ONLY THE HARNESS, NOT THE DATA. The data and ground truth are already covered by
// `scripts/reconciliation-synthetic/FREEZE.lock.json` and the variant's lock; duplicating those
// hashes here would create a second place for them to disagree.
//
// AND IT IS NOT SELF-HEALING. The lock is written once, committed, and thereafter only VERIFIED —
// `verify.mjs` never rewrites it. A gate that updates itself cannot detect the only thing it exists
// to detect, which is the defect the first reconciliation freeze record had.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK = resolve(HERE, "FREEZE.lock.json");
const COVERED = ["project.ts", "run.ts", "score.ts", "reconcile.ts", "probe-plan.ts", "probe-admission.ts"];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

if (existsSync(LOCK) && process.argv[2] !== "--rewrite") {
  console.error(`REFUSED: ${LOCK} already exists. A freeze is written once; use verify.mjs.`);
  console.error("Re-freezing is a GOVERNED REVISION: it needs its own evidence and must state what it supersedes.");
  process.exit(1);
}

const scripts = {};
for (const name of COVERED) scripts[name] = sha(resolve(HERE, name));
const composite = createHash("sha256")
  .update(JSON.stringify(COVERED.map((n) => [n, scripts[n]])))
  .digest("hex");

writeFileSync(LOCK, `${JSON.stringify({
  frozenAt: new Date().toISOString().slice(0, 10),
  revision: "PL1",
  what: "the production-lane synthetic-company harness",
  covers: "the harness scripts only — the data and ground truth are covered by the reconciliation package locks",
  order: "freeze the harness -> run NH -> reconcile -> score. A product change may move the RESULT; the ruler may not move with it.",
  scripts,
  compositeSha256: composite,
  notFrozenHere: {
    "the frozen data and ground truth": "scripts/reconciliation-synthetic/FREEZE.lock.json and the obligation-ref variant lock",
    "the 10% baseline fraction": "a HARNESS CONSTANT in run.ts, not a governed baseline method — named in the acceptance plan as a prerequisite, and deliberately unchanged across the before/after runs so the two remain comparable",
  },
}, null, 2)}\n`);
console.log(`frozen · ${COVERED.length} harness scripts · composite ${composite}`);
