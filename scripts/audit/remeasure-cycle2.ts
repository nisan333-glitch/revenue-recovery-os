// EDGE for the cycle-2 re-measurement. Owns the filesystem, the clock and stdout; the logic lives in
// `remeasureCycle2.ts`, which is pure and imported by tests — the rule the local readiness CLI
// established: a command whose claims cannot be imported cannot be falsified.
//
// IT OPENS NOTHING UNDER `e2e/` FOR WRITING. The frozen bytes are read, their hashes are checked against
// the TRACKED evidence record BEFORE anything is measured, and the only file written is a dated report
// under `docs/audit/`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CYCLE, EVIDENCE_RECORD, FIXTURE_DIR, remeasure } from "./remeasureCycle2";

const OUT_DIR = "docs/audit";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function refuse(reason: string): never {
  console.error(`REFUSED · ${reason}\nNothing was written.`);
  process.exit(1);
}

// ALL THREE frozen datasets. The recorded 2026-09-27 denominator is 11 classes over $122,250.66, and
// `terminal_state_after_cutoff` has its rows in `spot-cancelled-after-asof.csv` — so measuring only
// `dataset.csv` answers a narrower question and must not be compared to the recorded figure.
const DATASET_NAMES = ["dataset", "spot-multicurrency", "spot-cancelled-after-asof"] as const;
const truthPath = `${FIXTURE_DIR}/ground-truth.json`;

let datasets: { name: string; csv: string }[];
let groundTruthJson: string;
try {
  datasets = DATASET_NAMES.map((name) => ({ name, csv: readFileSync(`${FIXTURE_DIR}/${name}.csv`, "utf8") }));
  groundTruthJson = readFileSync(truthPath, "utf8");
} catch {
  refuse(`a frozen input is unreadable — every ${FIXTURE_DIR} dataset and its ground truth are tracked evidence and must be present`);
}

// THE INPUTS ARE CHECKED AGAINST THEIR OWN WITNESS FIRST. A measurement over bytes that do not match the
// tracked record is a measurement of something else, and reporting it would be worse than refusing.
const record = JSON.parse(readFileSync(EVIDENCE_RECORD, "utf8")) as {
  datasets: { name: string; sha256: string }[];
  groundTruthSha256: string;
};
for (const d of datasets) {
  const declared = record.datasets.find((x) => x.name === d.name)?.sha256;
  if (sha(d.csv) !== declared) {
    refuse(`${FIXTURE_DIR}/${d.name}.csv hashes ${sha(d.csv).slice(0, 16)}… but ${EVIDENCE_RECORD} records ${String(declared).slice(0, 16)}…`);
  }
}
if (sha(groundTruthJson) !== record.groundTruthSha256) {
  refuse(`${truthPath} hashes ${sha(groundTruthJson).slice(0, 16)}… but ${EVIDENCE_RECORD} records ${record.groundTruthSha256.slice(0, 16)}…`);
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
const measuredAt = new Date().toISOString();

const r = await remeasure({
  datasets,
  groundTruthJson,
  measuredAt,
  // Reported, never hashed, and marked when the tree is dirty: a measurement taken on an uncommitted
  // tree is not a measurement of a revision, and saying so is cheaper than discovering it later.
  buildRevision: dirty ? `${head}-dirty` : head,
});

mkdirSync(OUT_DIR, { recursive: true });
const out = `${OUT_DIR}/cycle2-remeasured-${measuredAt.slice(0, 10)}.json`;
writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`, { encoding: "utf8" });

console.log(`\n── ${CYCLE} · re-measured on the current build · leave-one-out ablation`);
console.log(`   build revision : ${r.buildRevision}`);
console.log(`   policy         : asOf ${r.policy.asOf} · stall ${r.policy.stallThresholdDays}d · ${r.policy.currency}`);
console.log(`   inputs         : ${r.inputs.length} frozen inputs, all hashing to the tracked evidence record`);

let residualSeen = false;
for (const [name, m] of Object.entries(r.perDataset)) {
  const c = m.cohortCounts;
  console.log(`\n   ══ ${name}`);
  console.log(`      ${c.csvRows} rows · ${c.distinctEntities} entities · ${c.scenariosInThisDataset} scenarios claim it`);
  console.log(`      accepted ${c.acceptedCycleCount} · stalled ${c.stalledCount} · reference ${c.referenceCount} · undetermined ${c.undeterminedCount} · excluded rows ${c.excludedRowCount} · non-stalled pop ${c.nonStalledPopulation}`);
  for (const [f, v] of Object.entries(m.baseline)) if (v !== 0) console.log(`      ${f.padEnd(46)} ${usd(v)}`);
  const bad = Object.entries(m.completeness).filter(([, v]) => v.residual !== 0);
  if (bad.length === 0) {
    console.log(`      completeness: residual $0.00 on all ${Object.keys(m.completeness).length} fields — every dollar attributed`);
  } else {
    residualSeen = true;
    for (const [f, v] of bad) console.log(`      ⚠ RESIDUAL ${f} baseline ${usd(v.baseline)} attributed ${usd(v.attributed)} residual ${usd(v.residual)}`);
  }
  console.log(`      unclaimed filler: ${m.unclaimed.entityCount} entities / ${m.unclaimed.rowsWithheld} rows contributing ${usd(Object.values(m.unclaimed.delta).reduce((n, v) => n + (v > 0 ? v : 0), 0))} gross`);
  for (const x of m.crossCheck) {
    const status = x.undecodable ? "UNDECODABLE (ruler defect)" : x.agrees ? "agrees" : "DISAGREES";
    console.log(`      cross-check ${x.field.padEnd(34)} ${status}  tag[${x.centTagScenarios.join(" ")}] ablation[${x.ablationScenarios.join(" ")}]`);
  }
}

console.log(`\n   DETECTED BY ABLATION`);
for (const a of r.ablations.filter((x) => x.verdict === "DETECTED")) {
  console.log(`     ${a.scenarioId} ${a.businessClass.padEnd(40)} ${usd(a.detectedMinor).padStart(12)}  ${a.detectedIn.join(", ")}  [${a.dataset}]`);
}
const nd = r.ablations.filter((x) => x.verdict === "NOT_DETECTED");
console.log(`\n   REPRESENTABLE, NOT DETECTED${nd.length === 0 ? " — none" : ""}`);
for (const a of nd) {
  console.log(`     ${a.scenarioId} ${a.businessClass.padEnd(40)} ${usd(a.businessLeakageMinor).padStart(12)}  truth predicted bucket "${a.predicted2026_09_27.bucket}"  [${a.dataset}]`);
}

if (r.falsePositives.length > 0) {
  console.log(`\n   ✗ FALSE-POSITIVE CANDIDATES · ${usd(r.falsePositiveMinor)} booked for scenarios the truth prices at ZERO`);
  for (const f of r.falsePositives) {
    console.log(`     ${f.scenarioId} ${f.businessClass.padEnd(40)} ${usd(f.bookedMinor).padStart(12)}  booked in ${f.bookedIn.join(", ")}  truth says "${f.truthSays}"  [${f.dataset}]`);
  }
}

const cov = r.coverage;
console.log(`\n   COVERAGE at this build`);
console.log(`     business classes            ${cov.businessClasses}`);
console.log(`     detected now                ${cov.classesDetectedNow}  · class coverage ${pct(cov.classCoverage)}`);
console.log(`     representable, not detected ${cov.classesRepresentableNotDetected}`);
console.log(`     not representable           ${cov.classesNotRepresentable}`);
console.log(`     value detected              ${usd(cov.detectedValueMinor)} of ${usd(cov.totalBusinessLeakageMinor)} · value coverage ${pct(cov.valueCoverage)}`);
console.log(`     representable-not-detected  ${usd(cov.representableNotDetectedValueMinor)}`);
console.log(`     not-representable           ${usd(cov.notRepresentableValueMinor)}`);

const moved = r.ablations.filter((a) => a.supersedesPrediction);
if (moved.length > 0) {
  console.log(`\n   ${moved.length} scenario(s) departing from the 2026-09-27 BUILD PREDICTION:`);
  for (const a of moved) {
    console.log(`     ${a.scenarioId} ${a.businessClass} ${usd(a.businessLeakageMinor)} · predicted nhCanDetect=${a.predicted2026_09_27.nhCanDetect} · now ${a.verdict}${a.detectedIn.length > 0 ? ` in ${a.detectedIn.join(", ")}` : ""}`);
  }
  console.log(`   Predictions about a BUILD, not facts about the business. The frozen truth is NOT edited.`);
}
if (residualSeen) {
  console.log(`\n   ⚠ a non-zero residual means money the per-scenario ablations do not account for —`);
  console.log(`     either an interaction between rows or a gap in the truth's coverage. Reported, not absorbed.`);
}
console.log(`\nwrote ${out}`);
console.log("OBSERVED exposure only · no Recovery Case · no Revenue Returned · synthetic throughout");
