// CYCLE 2 (2026-09-27) · Freeze the experiment: prove the generator is independent, prove the
// reconciliation scheme decodes, and write the PREDICTION for every dataset before NH is run on it.
//
// This is a SEPARATE freeze from the 2026-09-26 one, in a separate artifact directory, over a separate
// script set. The first freeze is not read, not re-verified through this file and not touched: it records
// what the PRE-GOVERNANCE system did, and that record stays exactly as it was written.
//
// The methodology is deliberately held fixed so that rule 10 — distinguish a product change from a
// methodology change — is answerable. Same seed, same generator logic, and the dataset bytes must come
// out byte-identical to the frozen originals. Only the runner changed, because the request shape did.
//
// Nothing here reads NH's output. It runs before the run, and its output is what the run is scored
// against. A wrong prediction is a result to report, not a number to edit afterwards — run v1's
// predictions were wrong in two places and both are kept in `prediction-v1.json`.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const DIR = "e2e/fixtures/synthetic-validation-2026-09-27";
const fail = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} · ${label}${detail ? ` · ${detail}` : ""}`);
  if (!cond) fail.push(label);
};

// ── 1 · Anti-circularity: these scripts may import node builtins and nothing else ─────────────────
for (const file of ["scripts/synthetic-validation-2026-09-27/generate.mjs", "scripts/synthetic-validation-2026-09-27/verify.mjs"]) {
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
  builtBy: "scripts/synthetic-validation-2026-09-27/verify.mjs",
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
  // ── EP-26/26b · THE GOVERNED ASSESSMENT POLICIES THIS RUN WILL BE READ UNDER ───────────────────
  // The cut-off, the stall threshold and the currency are no longer the runner's to state: they are
  // registered, activated by a second identity, and cited by reference. So they are frozen HERE, before
  // the run, exactly as the admission bars are — a definition invented after seeing a number would break
  // the composite digest.
  //
  // Version 1.0.0 carries the SAME values run v3 used (`asOf` 2026-06-30, N=30, USD), which is what makes
  // the four governed runs comparable with the previous frozen validation at all. Version 2.0.0 is a
  // SECOND, later cut-off at the end of the declared coverage window — the governed re-reading route that
  // did not exist when the previous validation ran.
  governedAssessmentPolicies: {
    primary: {
      termsId: "sv-assessment-policy", termsVersion: "1.0.0",
      asOf: truth.asOf, stallThresholdDays: truth.stallThresholdDays, currency: truth.currency,
    },
    laterCutoff: {
      termsId: "sv-assessment-policy", termsVersion: "2.0.0",
      asOf: truth.provenanceCoverage.end, stallThresholdDays: truth.stallThresholdDays, currency: truth.currency,
    },
  },
  declaredContractVersion: "2.0.0",
  // ── EP-28 · WHAT THE TWO EXTRA RUNS MUST SHOW, stated before either was executed ─────────────────
  // Neither is scored for monetary accuracy, and that is a deliberate limit rather than an omission: the
  // money prediction above is derived under `asOf` 2026-06-30 ONLY, and re-deriving it under a later
  // cut-off would mean re-implementing the stall rule inside the scorer — new methodology, invented after
  // the fact, in the one file that must stay blind. So these two measure the IDENTITY semantics, which is
  // what EP-28 changed, and the figures they produce are recorded as observations.
  governedReReading: {
    reReadUnderLaterCutoff: {
      expectation: "ACCEPTED. The same bytes, the same boundary, a DIFFERENT governed AssessmentPolicy — "
        + "so a different submission identity, a second admission decision and a second execution id. The "
        + "first execution must still be there, unchanged, saying what it said.",
      mustNotBe: "NH-DC-4003 (duplicate submission)",
      moneyScored: false,
      moneyNote: "Observed and reported. NOT compared against the frozen prediction, which is derived under asOf "
        + truth.asOf + " alone.",
    },
    duplicateUnderIdenticalTerms: {
      expectation: "REFUSED 409 NH-DC-4003. The same bytes, the same boundary, the same governed policy, and a "
        + "DIFFERENT operator-typed datasetId — which under contract 2.0.0 is no longer part of the identity. "
        + "Before EP-28 this would have been admitted a second time by renaming the file.",
      mustBe: "NH-DC-4003",
      moneyScored: false,
    },
  },
  claimBoundary: truth.claimBoundary,
};
writeFileSync(`${DIR}/prediction.json`, `${JSON.stringify(prediction, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

// ── 7 · THE FREEZE ────────────────────────────────────────────────────────────────────────────────
// Everything that could be quietly adjusted after seeing a result is covered: the dataset bytes, the
// manifest, the prediction, the SCRIPTS that produced them, the commit they were produced at, and the
// run parameters. `run.mjs` and `score.mjs` both re-verify this digest before doing anything, so an
// edited experiment cannot be run or scored without the mismatch being reported.
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const scriptHashes = {};
for (const f of ["generate.mjs", "verify.mjs", "run.mjs", "score.mjs", "browser-confirm.mjs"]) {
  scriptHashes[f] = sha(readFileSync(`scripts/synthetic-validation-2026-09-27/${f}`));
}
let gitHead = "unavailable";
try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a repo */ }

const frozen = {
  frozenAt: new Date().toISOString(),
  cycle: "2026-09-27 · the SECOND validation cycle, against the governed contract-2.0.0 system",
  supersedes: "nothing. The 2026-09-26 freeze in e2e/fixtures/synthetic-validation/ stands untouched and "
    + "describes the pre-governance system at 117ded4. This cycle stands BESIDE it.",
  note: "Written BEFORE any NH run. run.mjs and score.mjs verify this file and refuse to proceed on a mismatch.",
  gitHead,
  runParameters: {
    asOf: truth.asOf,
    stallThresholdDays: truth.stallThresholdDays,
    currency: truth.currency,
    seed: truth.seed,
    provenanceCoverage: truth.provenanceCoverage,
    admissionPolicyPermissive: prediction.admissionPolicyPermissive,
    admissionPolicyStrict: prediction.admissionPolicyStrict,
    // EP-26b/EP-28 · What the assessment MEASURES, and which contract major the customer declares, are
    // both part of the experiment now, so both are inside the digest.
    governedAssessmentPolicies: prediction.governedAssessmentPolicies,
    declaredContractVersion: prediction.declaredContractVersion,
    governedReReading: prediction.governedReReading,
  },
  datasets: truth.datasets.map((d) => ({ name: d.name, rowCount: d.rowCount, sha256: d.sha256 })),
  groundTruthSha256: sha(readFileSync(`${DIR}/ground-truth.json`)),
  predictionSha256: sha(Buffer.from(`${JSON.stringify(prediction, null, 2)}\n`)),
  scriptSha256: scriptHashes,
};
// The composite digest is over the whole record, so a change to ANY part of it is detectable.
frozen.compositeSha256 = sha(Buffer.from(JSON.stringify(frozen)));
writeFileSync(`${DIR}/FROZEN.json`, `${JSON.stringify(frozen, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const digest = frozen.compositeSha256;

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
