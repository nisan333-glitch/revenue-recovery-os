// Score NH's raw output against the prediction that was frozen before the run.
//
// Reads two files and writes a third. It never reads the product, and it never edits ground truth.
//
// DETECTION ACCURACY AND MONETARY ACCURACY ARE KEPT APART. A scenario NH places in the right cohort
// with the wrong amount is a monetary variance, not a detection failure, and collapsing the two into
// one "accuracy" number would hide exactly the defect worth finding.
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "e2e/fixtures/synthetic-validation";
const truth = JSON.parse(readFileSync(`${DIR}/ground-truth.json`, "utf8"));
const prediction = JSON.parse(readFileSync(`${DIR}/prediction.json`, "utf8"));
const raw = JSON.parse(readFileSync(`${DIR}/raw-output.json`, "utf8"));

const byId = new Map(truth.scenarios.map((s) => [s.scenario_id, s]));
const BUCKETS = ["observedUnpaid", "partialOutstanding", "excludedValue", "unknownValue"];
const MINOR_FIELD = {
  observedUnpaid: "observedUnpaidMinor", partialOutstanding: "partialOutstandingMinor",
  excludedValue: "excludedValueMinor", unknownValue: "unknownValueMinor",
};
const usd = (m) => `$${(m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Which scenarios a bucket total's cents can have come from.
 *
 * The tag is the CONTRIBUTION's cents, not the invoice's: partialOutstanding contributes
 * (amount − paid), so its cents are the difference's. Distinct tags summing below 100 make the subset
 * unique, and `verify.mjs` proved that before the run.
 */
function decode(bucket, totalMinor, scenarioIds) {
  const contributors = truth.scenarios
    .filter((s) => scenarioIds.has(s.scenario_id) && s.expected_bucket === bucket && s.expected_amount_minor > 0)
    .map((s) => ({ id: s.scenario_id, tag: s.expected_amount_minor % 100, full: s.expected_amount_minor }));
  // Subset-sum over the FULL expected amounts. The distinct cent tags are what make the answer unique
  // (proved in verify.mjs); matching on full amounts rather than on cents alone also settles a bucket
  // with a single untagged contributor, where cents 00 is indistinguishable from contributing nothing.
  const matches = [];
  for (let mask = 0; mask < 1 << contributors.length; mask += 1) {
    let sum = 0;
    const set = [];
    for (let i = 0; i < contributors.length; i += 1) {
      if (mask & (1 << i)) { sum += contributors[i].full; set.push(contributors[i].id); }
    }
    if (sum === totalMinor) matches.push(set);
  }
  return {
    cents: totalMinor % 100, unique: matches.length === 1,
    decoded: matches.length === 1 ? matches[0] : null, candidates: matches.length,
  };
}

const report = { scoredAt: new Date().toISOString(), runId: raw.runId, frozen: raw.frozen, datasets: [] };

for (const run of raw.runs) {
  const pred = prediction.datasets.find((d) => d.dataset === run.dataset);
  const dsMeta = truth.datasets.find((d) => d.name === run.dataset);
  const ids = new Set(dsMeta.scenarioIds);
  const upload = run.steps.upload.body ?? {};
  const finding = run.steps.execution?.body?.finding?.finding ?? null;

  const entry = {
    label: run.label, dataset: run.dataset,
    admission: {
      accepted: upload.accepted ?? null,
      usableForAssessment: upload.usableForAssessment ?? null,
      outcome: upload.admission?.outcome ?? null,
      datasetFindings: (upload.datasetFindings ?? []).map((f) => f.code),
      counts: upload.counts ?? null,
      scheduled: run.steps.schedule.body?.scheduled ?? false,
      scheduleRefusal: run.steps.schedule.body?.refusal?.code ?? null,
      executionState: run.steps.execution?.body?.state ?? null,
      predictedDatasetLevelRejection: pred.datasetLevelRejectionExpected,
    },
  };

  if (!finding) {
    entry.result = "no finding produced";
    const strictRun = run.label.startsWith("strict/");
    entry.verdict = pred.datasetLevelRejectionExpected
      ? "AS PREDICTED — the dataset was refused whole and produced no money figure"
      : strictRun && entry.admission.outcome === "NOT_ADMISSIBLE"
        ? "AS PREDICTED — the strict bar refused the dataset at admission. An adversarial control, deliberately stated before the run."
        : "NOT AS PREDICTED — a finding was expected. See admission above.";
    report.datasets.push(entry);
    continue;
  }

  // ── Cohorts: NH's counts against the prediction ─────────────────────────────────────────────────
  entry.cohorts = {
    nh: { stalled: finding.stalledCount, undetermined: finding.undeterminedCount, reference: finding.referenceCount, acceptedCycles: finding.acceptedCycleCount },
    predicted: pred.cohorts,
    stalledMatches: finding.stalledCount === pred.cohorts.stalledRows,
    undeterminedMatches: finding.undeterminedCount === pred.cohorts.undeterminedRows,
    referenceMatches: finding.referenceCount === pred.cohorts.referenceRows,
    acceptedMatches: finding.acceptedCycleCount === (pred.cohorts.stalledRows + pred.cohorts.undeterminedRows + pred.cohorts.referenceRows),
  };
  entry.stateCounts = finding.stateCounts;

  // ── Money: per bucket, predicted vs actual, plus the decode ──────────────────────────────────────
  entry.money = {};
  for (const b of BUCKETS) {
    const nh = finding[MINOR_FIELD[b]];
    const predicted = pred.money[MINOR_FIELD[b]];
    entry.money[b] = {
      predictedMinor: predicted, nhMinor: nh, varianceMinor: nh - predicted,
      exact: nh === predicted, decode: decode(b, nh, ids),
    };
  }
  // grossEligible is an identity check rather than a decode: Unpaid + the full obligation of every
  // PartiallyPaid and paid-state cycle in the stalled cohort.
  entry.money.grossEligible = { nhMinor: finding.grossEligibleMinor, note: "checked as an identity in the report, not decoded" };

  // ── Per-scenario reconciliation ──────────────────────────────────────────────────────────────────
  const decoded = {};
  for (const b of BUCKETS) for (const id of entry.money[b].decode.decoded ?? []) decoded[id] = b;

  entry.reconciliation = truth.scenarios.filter((s) => ids.has(s.scenario_id)).map((s) => {
    const inMoneyBucket = BUCKETS.includes(s.expected_bucket);
    const placed = decoded[s.scenario_id] ?? null;
    let classification;
    if (inMoneyBucket) {
      classification = placed === s.expected_bucket ? "TRUE POSITIVE"
        : placed === null ? "FALSE NEGATIVE — expected in a money bucket, not decoded from any total"
        : `MISPLACED — expected ${s.expected_bucket}, decoded in ${placed}`;
    } else if (s.expected_bucket === "row_excluded") {
      classification = "EXCLUDED ROW — verified from the rejected-row count and codes, not from a money total";
    } else if (s.expected_bucket === "not_representable") {
      classification = "OUT OF CAPABILITY — no row exists; NH was never given the chance";
    } else {
      classification = "TRUE NEGATIVE — expected to contribute nothing, and contributes nothing";
    }
    return {
      scenario_id: s.scenario_id, entity_id: s.entity_id, leakage_class: s.leakage_class,
      expected_cohort: s.expected_cohort, expected_bucket: s.expected_bucket,
      expected_amount_minor: s.expected_amount_minor, nh_bucket: placed,
      classification, business_expectation: s.business_expectation, ambiguity: s.ambiguity,
    };
  });

  // ── Metrics, for the ONE binary classification NH performs: stalled vs not ───────────────────────
  // Counted over SCENARIOS whose placement the decode can settle, plus the control population as true
  // negatives — a healthy row appearing in a stalled total would have moved a bucket's cents.
  const moneyScenarios = entry.reconciliation.filter((r) => BUCKETS.includes(r.expected_bucket));
  const tp = moneyScenarios.filter((r) => r.classification === "TRUE POSITIVE").length;
  const fn = moneyScenarios.filter((r) => r.classification.startsWith("FALSE NEGATIVE")).length;
  const misplaced = moneyScenarios.filter((r) => r.classification.startsWith("MISPLACED")).length;
  const controlRows = entry.reconciliation
    .filter((r) => r.expected_bucket === "none")
    .reduce((a, r) => a + (byId.get(r.scenario_id)?.row_count ?? 0), 0);
  // A false positive would show up as a stalled count above the prediction: the stalled cohort is
  // fully accounted for by planted scenarios, so any surplus is an unplanted row NH called stalled.
  const fp = Math.max(0, finding.stalledCount - pred.cohorts.stalledRows);

  entry.detection = {
    truePositives: tp, falseNegatives: fn, misplaced, falsePositives: fp,
    trueNegativeRows: controlRows,
    precision: tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : null,
    recall: tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : null,
    note: "Counted over scenarios the decode can settle. NH emits no per-entity output, so this is the strongest per-scenario statement the product's own output supports.",
  };

  const predictedLeakage = pred.groundTruthLeakage.inDatasetMinor;
  const nhLeakage = finding.observedUnpaidMinor + finding.partialOutstandingMinor;
  entry.monetary = {
    groundTruthInDatasetMinor: predictedLeakage,
    nhDetectedOpportunityMinor: finding.observedUnpaidMinor,
    nhHeadlinePlusPartialMinor: nhLeakage,
    varianceVsGroundTruthMinor: nhLeakage - predictedLeakage,
    exact: nhLeakage === predictedLeakage,
    note: "NH's HEADLINE is observedUnpaid alone. partialOutstanding is reported beside it and is not part of the headline.",
  };
  report.datasets.push(entry);
}

report.outOfCapability = {
  registerMinor: prediction.outOfCapabilityMinor,
  scenarios: truth.scenarios.filter((s) => s.in_capability === false)
    .map((s) => ({ leakage_class: s.leakage_class, amount_minor: s.expected_amount_minor, missing_columns: s.missing_columns })),
  note: "A SEPARATE register. No row exists for any of these, so none is a detection failure. Never summed with in-dataset leakage.",
};
report.claimBoundary = {
  ...truth.claimBoundary,
  restated: "Ground-truth figures are planted. NH's figures are Detected Revenue Opportunity. Neither is recovered money and neither is proven returned revenue.",
};
writeFileSync(`${DIR}/score.json`, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

// ── Console summary ───────────────────────────────────────────────────────────────────────────────
for (const d of report.datasets) {
  console.log(`\n══ ${d.label} ══`);
  console.log(`admission: accepted=${d.admission.accepted} outcome=${d.admission.outcome} findings=${d.admission.datasetFindings.join(",") || "none"} scheduled=${d.admission.scheduled} state=${d.admission.executionState ?? "n/a"}`);
  if (!d.cohorts) { console.log(`result: ${d.result}\nverdict: ${d.verdict}`); continue; }
  console.log(`cohorts NH  : stalled=${d.cohorts.nh.stalled} undetermined=${d.cohorts.nh.undetermined} reference=${d.cohorts.nh.reference} accepted=${d.cohorts.nh.acceptedCycles}`);
  console.log(`cohorts PRED: stalled=${d.cohorts.predicted.stalledRows} undetermined=${d.cohorts.predicted.undeterminedRows} reference=${d.cohorts.predicted.referenceRows}`);
  for (const b of BUCKETS) {
    const m = d.money[b];
    console.log(`${b.padEnd(19)} pred=${usd(m.predictedMinor).padStart(13)} nh=${usd(m.nhMinor).padStart(13)} var=${usd(m.varianceMinor).padStart(9)} ${m.exact ? "EXACT" : "VARIANCE"} decode=${m.decode.unique ? m.decode.decoded.join("+") || "none" : `AMBIGUOUS(${m.decode.candidates})`}`);
  }
  console.log(`grossEligible       nh=${usd(d.money.grossEligible.nhMinor)}`);
  console.log(`detection: TP=${d.detection.truePositives} FN=${d.detection.falseNegatives} misplaced=${d.detection.misplaced} FP=${d.detection.falsePositives} trueNegativeRows=${d.detection.trueNegativeRows} precision=${d.detection.precision} recall=${d.detection.recall}`);
  console.log(`monetary: groundTruth=${usd(d.monetary.groundTruthInDatasetMinor)} nhHeadline=${usd(d.monetary.nhDetectedOpportunityMinor)} headline+partial=${usd(d.monetary.nhHeadlinePlusPartialMinor)} variance=${usd(d.monetary.varianceVsGroundTruthMinor)}`);
}
console.log(`\nout-of-capability register (no rows exist): ${usd(report.outOfCapability.registerMinor)} across ${report.outOfCapability.scenarios.length} classes`);
console.log(`\nscore written to ${DIR}/score.json`);
