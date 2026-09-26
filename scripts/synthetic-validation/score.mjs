// Score NH's raw output against the prediction that was frozen before the run.
//
// Reads two files and writes a third. It never reads the product, and it never edits ground truth.
//
// DETECTION ACCURACY AND MONETARY ACCURACY ARE KEPT APART. A scenario NH places in the right cohort
// with the wrong amount is a monetary variance, not a detection failure, and collapsing the two into
// one "accuracy" number would hide exactly the defect worth finding.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "e2e/fixtures/synthetic-validation";

// ── The freeze gate ───────────────────────────────────────────────────────────────────────────────
// Refuse to proceed unless the experiment is byte-for-byte the one that was frozen before any NH run.
// This is what makes "no adjusting the experiment after seeing the result" enforceable rather than
// promised: the datasets, the manifest, the prediction, every script and the commit are all covered.
function verifyFreeze(dir) {
  const frozen = JSON.parse(readFileSync(`${dir}/FROZEN.json`, "utf8"));
  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  const problems = [];
  const { compositeSha256, ...record } = frozen;
  if (sha(Buffer.from(JSON.stringify(record))) !== compositeSha256) problems.push("FROZEN.json itself was edited");
  for (const d of frozen.datasets) {
    if (sha(readFileSync(`${dir}/${d.name}.csv`)) !== d.sha256) problems.push(`${d.name}.csv changed since the freeze`);
  }
  if (sha(readFileSync(`${dir}/ground-truth.json`)) !== frozen.groundTruthSha256) problems.push("ground-truth.json changed since the freeze");
  if (sha(readFileSync(`${dir}/prediction.json`)) !== frozen.predictionSha256) problems.push("prediction.json changed since the freeze");
  for (const [file, want] of Object.entries(frozen.scriptSha256)) {
    if (sha(readFileSync(`scripts/synthetic-validation/${file}`)) !== want) problems.push(`${file} changed since the freeze`);
  }
  if (problems.length) {
    console.error(`FREEZE VIOLATION — refusing to proceed:\n  ${problems.join("\n  ")}`);
    console.error("Re-freeze deliberately with verify.mjs if the change is intended, and say so in the report.");
    process.exit(3);
  }
  console.log(`freeze verified · composite=${compositeSha256.slice(0, 16)}… gitHead=${frozen.gitHead.slice(0, 8)}`);
  return frozen;
}

// BLIND SCORING. This file reads ground truth, the prediction and NH's raw output, and writes exactly
// one file: score.json. It never writes ground truth or the prediction, and it never derives either
// from NH's answer. The freeze gate above makes that checkable rather than merely stated — if scoring
// had edited the truth, the digest would no longer match.
const frozen = verifyFreeze(DIR);
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

const report = { scoredAt: new Date().toISOString(), runId: raw.runId, frozen: raw.frozen, freezeVerifiedAtScoring: frozen.compositeSha256, datasets: [] };

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

// ══ THE THIRD RESULT — CAPABILITY COVERAGE ════════════════════════════════════════════════════════
//
// Detection accuracy answers "does NH correctly find what it is able to find". Monetary accuracy answers
// "is the amount right". Neither answers "how much of real revenue leakage can this product see at all",
// and without the third a product can score precision 1.000 while covering a fraction of the problem.
//
// Computed from the INDEPENDENT business register (`business_leakage_minor`), which was written from the
// narratives and never from NH's semantics. Nothing here is allowed to disappear because it is
// "out of capability" — that is precisely the number being measured.
{
  const classes = new Map();
  for (const s of truth.scenarios) {
    if (s.business_leakage_minor === 0 && s.representable !== false) continue; // not leakage in anyone's reading
    const k = s.leakage_class;
    const prev = classes.get(k) ?? { leakage_class: k, businessLeakageMinor: 0, representable: s.representable, nhCanDetect: false, missingColumns: s.missing_columns ?? null };
    prev.businessLeakageMinor += s.business_leakage_minor;
    prev.representable = prev.representable && s.representable;
    prev.nhCanDetect = prev.nhCanDetect || s.nh_can_detect === true;
    classes.set(k, prev);
  }
  const all = [...classes.values()].sort((a, b) => b.businessLeakageMinor - a.businessLeakageMinor);
  const total = all.reduce((a, c) => a + c.businessLeakageMinor, 0);
  const detectable = all.filter((c) => c.nhCanDetect);
  const representableNotDetected = all.filter((c) => c.representable && !c.nhCanDetect);
  const notRepresentable = all.filter((c) => !c.representable);
  const sum = (xs) => xs.reduce((a, c) => a + c.businessLeakageMinor, 0);

  report.capabilityCoverage = {
    question: "Of the business revenue leakage planted, how much can this product see at all?",
    businessLeakageClasses: all.length,
    classesNHCanDetect: detectable.length,
    classesRepresentableButNotDetected: representableNotDetected.length,
    classesNotRepresentable: notRepresentable.length,
    classCoverage: Number((detectable.length / all.length).toFixed(4)),
    totalBusinessLeakageMinor: total,
    detectableValueMinor: sum(detectable),
    representableButNotDetectedValueMinor: sum(representableNotDetected),
    notRepresentableValueMinor: sum(notRepresentable),
    valueCoverage: Number((sum(detectable) / total).toFixed(4)),
    breakdown: all.map((c) => ({
      leakage_class: c.leakage_class,
      businessLeakageMinor: c.businessLeakageMinor,
      status: c.nhCanDetect ? "DETECTED BY NH"
        : c.representable ? "REPRESENTABLE BUT NOT DETECTED — a scope decision, not a schema limit"
        : "NOT REPRESENTABLE — the data contract declares no column that could carry the signal",
      missingColumns: c.missingColumns,
    })),
    note: "Separate from detection accuracy and from monetary accuracy on purpose. High precision on a narrow surface is still a narrow surface.",
  };
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
const cc = report.capabilityCoverage;
console.log(`\n══ CAPABILITY COVERAGE — the third result ══`);
console.log(`business leakage classes planted : ${cc.businessLeakageClasses}`);
console.log(`  detected by NH                 : ${cc.classesNHCanDetect}  (${usd(cc.detectableValueMinor)})`);
console.log(`  representable, NOT detected     : ${cc.classesRepresentableButNotDetected}  (${usd(cc.representableButNotDetectedValueMinor)})`);
console.log(`  NOT representable at all       : ${cc.classesNotRepresentable}  (${usd(cc.notRepresentableValueMinor)})`);
console.log(`total business leakage planted   : ${usd(cc.totalBusinessLeakageMinor)}`);
console.log(`CLASS coverage ${(cc.classCoverage * 100).toFixed(1)}%   VALUE coverage ${(cc.valueCoverage * 100).toFixed(1)}%`);
for (const b of cc.breakdown) {
  console.log(`  ${usd(b.businessLeakageMinor).padStart(12)}  ${b.leakage_class.padEnd(40)} ${b.status}`);
}
console.log(`\nscore written to ${DIR}/score.json`);
