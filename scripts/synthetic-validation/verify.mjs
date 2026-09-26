// Freeze the experiment: prove the generator is independent, prove the reconciliation scheme decodes,
// and write the PREDICTION for every dataset before NH is run on it.
//
// Nothing here reads NH's output. It runs before the run, and its output is what the run is scored
// against. A wrong prediction is a result to report, not a number to edit afterwards — run v1's
// predictions were wrong in two places and both are kept in `prediction-v1.json`.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "e2e/fixtures/synthetic-validation";
const fail = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} · ${label}${detail ? ` · ${detail}` : ""}`);
  if (!cond) fail.push(label);
};

// ── 1 · Anti-circularity: these scripts may import node builtins and nothing else ─────────────────
for (const file of ["scripts/synthetic-validation/generate.mjs", "scripts/synthetic-validation/verify.mjs"]) {
  const src = readFileSync(file, "utf8");
  const imports = [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  ok(`${file} imports only node builtins`, imports.every((i) => i.startsWith("node:")), imports.join(", "));
  ok(`${file} references no product module`, !/src\/(assessment|contract|domain)\//.test(src.replace(/\/\/.*$/gm, "")));
}

const truth = JSON.parse(readFileSync(`${DIR}/ground-truth.json`, "utf8"));
const byId = new Map(truth.scenarios.map((s) => [s.scenario_id, s]));

// ── 2 · Each dataset is the file its manifest describes ───────────────────────────────────────────
const csvOf = {};
for (const d of truth.datasets) {
  const csv = readFileSync(`${DIR}/${d.name}.csv`, "utf8");
  csvOf[d.name] = csv;
  ok(`${d.name}: bytes match the recorded sha256`, createHash("sha256").update(csv).digest("hex") === d.sha256);
  const rowCount = csv.trimEnd().split("\n").length - 1;
  ok(`${d.name}: row count matches`, rowCount === d.rowCount, `${rowCount} vs ${d.rowCount}`);
  const owned = d.scenarioIds.reduce((a, id) => a + (byId.get(id)?.row_count ?? 0), 0);
  ok(`${d.name}: scenario row_counts sum to the file`, owned === d.rowCount, `${owned} vs ${d.rowCount}`);
}

// ── 3 · Every tagged amount really carries its tag, read back out of the bytes ────────────────────
const main = csvOf.dataset.trimEnd().split("\n");
const header = main[0].split(",");
const col = (r, name) => r[header.indexOf(name)];
const mainRows = main.slice(1).map((l) => l.split(","));
const rowByEntity = new Map(mainRows.map((r) => [col(r, "entity_id"), r]));

let tagMismatch = 0;
for (const s of truth.scenarios) {
  if (s.cent_tag === 0 || s.row_count !== 1) continue;
  const r = rowByEntity.get(s.entity_id);
  if (!r) continue; // lives in a spot dataset
  const cents = Number((col(r, "next_invoice_amount") ?? "0.00").split(".")[1]);
  if (cents !== s.cent_tag) tagMismatch += 1;
}
ok("every tagged row's cents equal its scenario tag", tagMismatch === 0, `${tagMismatch} mismatches`);

const polluting = mainRows.filter((r) => {
  const amt = col(r, "next_invoice_amount") ?? "";
  const cents = amt.includes(".") ? Number(amt.split(".")[1]) : 0;
  if (cents === 0) return false;
  const s = truth.scenarios.find((x) => x.entity_id === col(r, "entity_id"));
  return !s || s.cent_tag === 0;
});
ok("no untagged row carries non-zero cents", polluting.length === 0, `${polluting.length} polluting rows`);

// ── 4 · Every row's obligation date sits inside the declared coverage window ──────────────────────
// Run v1 taught this: 5 healthy rows fell outside the window the provenance declared and were rejected
// NH-DC-2021. That was my artifact contradicting its own declaration. Now asserted, not assumed.
const { start, end } = truth.provenanceCoverage;
const outside = mainRows.filter((r) => {
  const due = col(r, "next_invoice_due_at");
  const s = truth.scenarios.find((x) => x.entity_id === col(r, "entity_id"));
  const deliberate = s?.leakage_class === "not_a_leakage_outside_declared_window";
  return !deliberate && due && (due < start || due > end);
});
ok("no row accidentally falls outside the declared coverage window", outside.length === 0,
  outside.slice(0, 3).map((r) => `${col(r, "entity_id")}@${col(r, "next_invoice_due_at")}`).join(", "));

// ── 5 · Decodability, per money bucket, over the main dataset ────────────────────────────────────
const BUCKETS = ["observedUnpaid", "partialOutstanding", "excludedValue", "unknownValue"];
const mainIds = new Set(truth.datasets.find((d) => d.name === "dataset").scenarioIds);
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
for (const bucket of BUCKETS) {
  const tags = truth.scenarios
    .filter((s) => mainIds.has(s.scenario_id) && s.expected_bucket === bucket && s.cent_tag > 0)
    .map((s) => s.cent_tag);
  const sum = tags.reduce((a, b) => a + b, 0);
  ok(`${bucket}: distinct powers of two`, new Set(tags).size === tags.length && tags.every(isPow2), tags.join("+"));
  ok(`${bucket}: tag sum ${sum} cannot carry into dollars`, sum <= 63);
  const sums = new Set();
  for (let mask = 0; mask < 1 << tags.length; mask += 1) {
    let t = 0;
    for (let i = 0; i < tags.length; i += 1) if (mask & (1 << i)) t += tags[i];
    sums.add(t);
  }
  ok(`${bucket}: all ${1 << tags.length} subsets decode uniquely`, sums.size === 1 << tags.length);
}

// ── 6 · THE PREDICTION, per dataset, from ground truth alone ──────────────────────────────────────
function predictFor(dataset) {
  const ids = new Set(dataset.scenarioIds);
  const mine = truth.scenarios.filter((s) => ids.has(s.scenario_id));
  const sumBucket = (b) => mine.filter((s) => s.expected_bucket === b)
    .reduce((a, s) => a + s.expected_amount_minor * (s.row_count || 1), 0);
  const rowsWhere = (p) => mine.filter(p).reduce((a, s) => a + s.row_count, 0);

  // The multi-currency dataset is expected to be refused WHOLE, so no cohort or money figure applies.
  const datasetRejected = mine.some((s) => s.leakage_class === "not_a_leakage_defective_row"
    && s.entity_id === "synthetic-e-currency-mismatch");

  return {
    dataset: dataset.name,
    sha256: dataset.sha256,
    datasetLevelRejectionExpected: datasetRejected
      ? "NH-DC-1006 — the dataset mixes more than one currency, so the whole file is unassessable and no money figure is produced"
      : null,
    cohorts: datasetRejected ? null : {
      stalledRows: rowsWhere((s) => s.expected_cohort === "stalled"),
      undeterminedRows: rowsWhere((s) => s.expected_cohort === "undetermined"),
      referenceRows: rowsWhere((s) => s.expected_cohort === "reference"),
      excludedRows: rowsWhere((s) => s.expected_cohort === "excluded"),
    },
    money: datasetRejected ? null : {
      observedUnpaidMinor: sumBucket("observedUnpaid"),
      partialOutstandingMinor: sumBucket("partialOutstanding"),
      excludedValueMinor: sumBucket("excludedValue"),
      unknownValueMinor: sumBucket("unknownValue"),
    },
    groundTruthLeakage: datasetRejected ? null : {
      inDatasetMinor: sumBucket("observedUnpaid") + sumBucket("partialOutstanding"),
    },
  };
}

const prediction = {
  builtBy: "scripts/synthetic-validation/verify.mjs",
  builtFrom: "ground-truth.json only — NH has not been run at this point",
  outOfCapabilityMinor: truth.scenarios.filter((s) => s.in_capability === false)
    .reduce((a, s) => a + s.expected_amount_minor, 0),
  outOfCapabilityNote:
    "Recorded in a SEPARATE register. No row exists for these, so no detector was given a chance at them. " +
    "Never summed with in-dataset leakage into a single accuracy figure.",
  datasets: truth.datasets.map(predictFor),
  // Stated before the run, derived from the frozen design — never retuned after seeing a result. The
  // same bar applies to all three datasets: each shares the identical healthy base, so none needs its
  // own thresholds.
  admissionPolicyPermissive: {
    minAcceptedRows: 200, minDistinctEntities: 50, minCoverageDays: 90,
    maxMissingRecommendedColumns: 0, maxRejectionRate: 0.1, maxSingleReasonShare: 0.5,
    maxDuplicateRate: 0.05, maxOrderingDefectRate: 0.05,
    requiredLifecycleStates: ["stalled", "reference", "undetermined"],
    requireProvenanceDeclaration: true,
  },
  admissionPolicyStrict: {
    minAcceptedRows: 200, minDistinctEntities: 50, minCoverageDays: 90,
    maxMissingRecommendedColumns: 0, maxRejectionRate: 0.01, maxSingleReasonShare: 0.5,
    maxDuplicateRate: 0.05, maxOrderingDefectRate: 0.05,
    requiredLifecycleStates: ["stalled", "reference", "undetermined"],
    requireProvenanceDeclaration: true,
    expectation: "REFUSAL on the main dataset — the planted defect rate is deliberately above 1%. An adversarial control, not a failure.",
  },
  claimBoundary: truth.claimBoundary,
};
writeFileSync(`${DIR}/prediction.json`, `${JSON.stringify(prediction, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

const freeze = createHash("sha256");
for (const d of truth.datasets) freeze.update(csvOf[d.name]);
freeze.update(readFileSync(`${DIR}/ground-truth.json`)).update(JSON.stringify(prediction));
const digest = freeze.digest("hex");
writeFileSync(`${DIR}/FROZEN.txt`, `datasets+groundtruth+prediction sha256=${digest}\nfrozen before the v2 NH run\n`,
  { encoding: "utf8", mode: 0o600 });

console.log("");
for (const p of prediction.datasets) {
  console.log(`${p.dataset}: ${p.datasetLevelRejectionExpected ? "expected REFUSED whole" : `cohorts=${JSON.stringify(p.cohorts)} money=${JSON.stringify(p.money)}`}`);
}
console.log(`out-of-capability register: ${prediction.outOfCapabilityMinor} minor (no rows exist)`);
console.log(`FROZEN ${digest}`);
if (fail.length) {
  console.error(`\n${fail.length} verification failure(s): ${fail.join("; ")}`);
  process.exit(1);
}
console.log("\nverification clean — the experiment may run");
