// RE-MEASURE the 2026-09-27 synthetic-validation cycle against the CURRENT build. Pure, read-only core.
//
// WHY A NEW DRIVER RATHER THAN THE CYCLE'S OWN HARNESS, and the reason is not that the harness is broken.
// Cycle 2's `run.mjs` is EP-26b/EP-28 current and would execute: it proposes and activates a governed
// AssessmentPolicy and cites it by reference, exactly as the API now requires. (Cycle 1's runner is the one
// that cannot run — `scripts/synthetic-validation/run.mjs:146` still sends the retired
// `policy: { stallThresholdDays, asOf, currency }` object.) The blocker is different and sharper:
//
//   • `run.mjs:273`        writes `raw-output.json`
//   • `score.mjs:386`      writes `score.json`
//   • `verify.mjs:218,261` writes `prediction.json` AND `FROZEN.json`
//
// `prediction.json` is hash-covered by the TRACKED evidence record
// `e2e/evidence/synthetic-validation-2026-09-27.evidence.json`, so running the harness end to end would
// overwrite preserved evidence and break `verify:evidence`. That is the same defect the evidence slice
// recorded against `verify.mjs`: a freeze-creation step whose name reads as verification.
//
// ───────────────────────────────────────────────────────────────────────────────────────────────────
// HOW ATTRIBUTION WORKS, AND WHY THE FIRST DESIGN WAS REPLACED
//
// `assess()` returns AGGREGATES — no per-instance list — so attributing money to a scenario needs a
// mechanism. The frozen ground truth offers one: each money-contributing scenario carries a distinct
// power-of-two CENT TAG, so a bucket total's cents name its contributors.
//
// THAT MECHANISM IS BLIND EXACTLY WHERE THIS MEASUREMENT MATTERS, and the first run proved it. A tag is
// given only to a scenario the 2026-09-27 truth EXPECTED to contribute money; a scenario it expected to
// contribute nothing carries `cent_tag: 0`. That set is {S17, S18, S20} — precisely the scenarios whose
// status could have changed when Detector #2 shipped eight days later. The decoder could see
// `nonStalledExposure.overdueUnpaid = $14,800.00` and could not attribute one cent of it.
//
//     AN ATTRIBUTION MECHANISM SUPPLIED BY A PREDICTION CANNOT SEE WHERE THE PREDICTION WAS WRONG.
//
// So the primary mechanism is LEAVE-ONE-OUT ABLATION: run the current build on the frozen dataset, then
// again with one scenario's rows withheld, and attribute the delta. It uses only the product's public
// output, needs no tag metadata, and the blindness above is impossible by construction. Cent-tag decoding
// is kept as an INDEPENDENT CROSS-CHECK on the buckets whose tag arithmetic is self-consistent — two
// mechanisms agreeing is stronger than one, and a disagreement is a finding.
//
// ABLATION'S OWN LIMIT, stated before any number: it measures a MARGINAL effect, so two scenarios that
// masked each other would each show a zero delta. The completeness identity below is what detects that —
// if the per-scenario deltas do not sum to the whole, the residual is reported rather than absorbed.
//
// NOTHING FROZEN IS MODIFIED. Variants are built in memory. The only file written is a dated report
// outside `e2e/`, and that write lives in the edge, not here.
import { createHash } from "node:crypto";
import { assessCsv } from "../../src/assessment/assess";
import { makePolicy } from "../../src/assessment/policy";
import type { AssessmentResult } from "../../src/assessment/types";

export const REMEASURE_SCHEME = "nh-cycle2-remeasure-v2-ablation";

export const CYCLE = "synthetic-validation-2026-09-27";
export const FIXTURE_DIR = `e2e/fixtures/${CYCLE}`;
export const EVIDENCE_RECORD = `e2e/evidence/${CYCLE}.evidence.json`;

/**
 * The reported money surfaces, named exactly as `AssessmentResult` exposes them.
 *
 * Both detectors' surfaces are present. Detector #1's are under `observed.*` (the stalled cohort) and
 * Detector #2's under `nonStalledExposure.*` (its complement) — provably disjoint populations, so a
 * scenario appears on exactly one of them.
 */
export const REPORTED_FIELDS = Object.freeze([
  "observed.grossEligible",
  "observed.observedUnpaid",
  "observed.partialOutstanding",
  "observed.unknownValue",
  "observed.excludedValue",
  "nonStalledExposure.overdueUnpaid",
  "nonStalledExposure.overduePartialOutstanding",
  "nonStalledExposure.unknownValue",
  "nonStalledExposure.excludedValue",
] as const);
export type ReportedField = (typeof REPORTED_FIELDS)[number];

/**
 * The truth buckets that ARE exposure surfaces.
 *
 * This list exists because of a false flag in this instrument's own third form, and the lesson
 * generalises. The rule keyed on `business_leakage_minor === 0` and therefore flagged S09 — a scenario
 * the truth explicitly expects in `partialOutstanding` with `nh_can_detect: true`, priced at zero only
 * because "one cent outstanding is not commercially meaningful leakage". The product booking $0.05 there
 * is exactly what the truth predicts.
 *
 *     `business_leakage_minor` is a COMMERCIAL judgement about whether money is worth chasing.
 *     `expected_bucket` is a PREDICTION about where the product should put it. They are different
 *     questions, and a false-positive rule must read the second.
 *
 * So money booked for a scenario is a false-positive candidate only when the business prices it at zero
 * AND the truth expected it on no exposure surface at all.
 */
export const TRUTH_EXPOSURE_BUCKETS: readonly string[] = Object.freeze([
  "observedUnpaid",
  "partialOutstanding",
]);

/** The exposure surfaces. A scenario is DETECTED when withholding it reduces one of these. */
export const EXPOSURE_FIELDS: readonly ReportedField[] = Object.freeze([
  "observed.observedUnpaid",
  "observed.partialOutstanding",
  "nonStalledExposure.overdueUnpaid",
  "nonStalledExposure.overduePartialOutstanding",
]);

export interface ScenarioTruth {
  readonly scenario_id: string;
  readonly entity_id: string;
  readonly row_count: number;
  readonly business_class: string;
  readonly expected_bucket: string;
  readonly expected_cohort: string;
  readonly expected_payment_state: string;
  readonly expected_amount_minor: number;
  readonly cent_tag: number;
  readonly business_leakage_minor: number;
  readonly representable: boolean;
  readonly nh_can_detect: boolean;
  readonly expected_detector: string | null;
}

export interface GroundTruth {
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly currency: string;
  readonly datasets: readonly { readonly name: string; readonly scenarioIds: readonly string[] }[];
  readonly scenarios: readonly ScenarioTruth[];
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Split the dataset into a header and rows keyed by `entity_id`.
 *
 * Deliberately minimal rather than a full RFC-4180 parser, and the licence for that is CHECKED not
 * assumed: `assertUnquoted` refuses a file containing a double quote. The frozen dataset contains none.
 * A quoted field could hide a comma and silently mis-key a row, which would make every ablation wrong in
 * a way nothing downstream could detect — so it is refused rather than handled approximately.
 */
export function assertUnquoted(csvText: string): void {
  if (csvText.includes('"')) {
    throw new Error(
      "dataset contains a double quote: this driver's row splitter is minimal by design and refuses " +
        "quoted CSV rather than risk mis-keying a row during ablation",
    );
  }
}

export function splitRows(csvText: string): { readonly header: string; readonly rows: readonly string[] } {
  assertUnquoted(csvText);
  const lines = csvText.split("\n");
  const header = lines[0] ?? "";
  const rows = lines.slice(1).filter((l) => l.trim() !== "");
  return { header, rows };
}

/** Rebuild the CSV with every row whose first column is in `entityIds` withheld. */
export function withhold(csvText: string, entityIds: ReadonlySet<string>): string {
  const { header, rows } = splitRows(csvText);
  const kept = rows.filter((r) => !entityIds.has(r.slice(0, r.indexOf(","))));
  return `${[header, ...kept].join("\n")}\n`;
}

/** Flatten an AssessmentResult to the reported money fields, in minor units. */
export function reportedMoney(result: AssessmentResult): Readonly<Record<ReportedField, number>> {
  return Object.freeze({
    "observed.grossEligible": result.observed.grossEligible.minor,
    "observed.observedUnpaid": result.observed.observedUnpaid.minor,
    "observed.partialOutstanding": result.observed.partialOutstanding.minor,
    "observed.unknownValue": result.observed.unknownValue.minor,
    "observed.excludedValue": result.observed.excludedValue.minor,
    "nonStalledExposure.overdueUnpaid": result.nonStalledExposure.overdueUnpaid.minor,
    "nonStalledExposure.overduePartialOutstanding": result.nonStalledExposure.overduePartialOutstanding.minor,
    "nonStalledExposure.unknownValue": result.nonStalledExposure.unknownValue.minor,
    "nonStalledExposure.excludedValue": result.nonStalledExposure.excludedValue.minor,
  }) as Readonly<Record<ReportedField, number>>;
}

/**
 * Cent-tag decoding, kept as the INDEPENDENT CROSS-CHECK.
 *
 * Returns `undecodable` when the cents do not reconstruct from the declared tags. That is a refusal, not
 * a best-effort decode: it means money is in a bucket the truth's own tag arithmetic cannot account for,
 * which is exactly what a lenient decoder would hide. The first run found such a case — S09 carries
 * `cent_tag: 4` against `expected_amount_minor: 5`, so `partialOutstanding`'s tags sum to 7 while its
 * declared total's cents are 8. That is a defect in the ruler, recorded and never repaired here.
 */
export function decodeContributors(
  totalMinor: number,
  bucketScenarios: readonly ScenarioTruth[],
): { readonly scenarioIds: readonly string[]; readonly undecodable: boolean } {
  const cents = ((totalMinor % 100) + 100) % 100;
  const tagged = bucketScenarios.filter((s) => s.cent_tag > 0);
  const hit = tagged.filter((s) => (cents & s.cent_tag) === s.cent_tag);
  const reconstructed = hit.reduce((n, s) => n + s.cent_tag, 0);
  if (reconstructed !== cents) return { scenarioIds: Object.freeze([]), undecodable: true };
  return { scenarioIds: Object.freeze(hit.map((s) => s.scenario_id)), undecodable: false };
}

export interface Ablation {
  readonly scenarioId: string;
  readonly entityId: string;
  readonly businessClass: string;
  readonly businessLeakageMinor: number;
  readonly representable: boolean;
  readonly rowsWithheld: number;
  /** Baseline minus variant, per reported field. Positive = the scenario contributed that much. */
  readonly delta: Readonly<Record<string, number>>;
  /** The exposure fields it moved, if any. */
  readonly detectedIn: readonly string[];
  readonly detectedMinor: number;
  readonly predicted2026_09_27: { readonly bucket: string; readonly nhCanDetect: boolean };
  /**
   * `FALSE_POSITIVE_CANDIDATE` is the slot this vocabulary did not have, and its absence was the most
   * serious defect in the instrument's second form: a scenario the truth prices at ZERO which the product
   * nevertheless books into an exposure bucket was filed as `NOT_A_LEAKAGE` and never flagged. An audit
   * blind to false positives is worse than no audit, because it only ever reports flattering news.
   */
  readonly verdict:
    | "DETECTED"
    | "NOT_DETECTED"
    | "FALSE_POSITIVE_CANDIDATE"
    | "NOT_REPRESENTABLE"
    | "NOT_A_LEAKAGE";
  /** This build's detection status differs from the 2026-09-27 BUILD PREDICTION (never a business fact). */
  readonly supersedesPrediction: boolean;
  /** Which frozen dataset this ablation was run against. */
  readonly dataset: string;
}

/** One frozen dataset's measurement. Each is measured on its own, then the classes are unioned. */
export interface DatasetMeasurement {
  readonly baseline: Readonly<Record<string, number>>;
  readonly cohortCounts: Readonly<Record<string, number>>;
  readonly unclaimed: {
    readonly entityCount: number;
    readonly rowsWithheld: number;
    readonly delta: Readonly<Record<string, number>>;
  };
  /** Σ(per-scenario deltas) + unclaimed vs the baseline, per field. A residual is reported, never absorbed. */
  readonly completeness: Readonly<
    Record<string, { readonly baseline: number; readonly attributed: number; readonly residual: number }>
  >;
  readonly crossCheck: readonly {
    readonly field: string;
    readonly truthBucket: string;
    readonly centTagScenarios: readonly string[];
    readonly ablationScenarios: readonly string[];
    readonly agrees: boolean;
    readonly undecodable: boolean;
  }[];
}

export interface Remeasurement {
  readonly scheme: typeof REMEASURE_SCHEME;
  readonly cycle: typeof CYCLE;
  readonly measuredAt: string;
  readonly buildRevision: string;
  readonly inputs: readonly { readonly path: string; readonly sha256: string }[];
  readonly policy: { readonly asOf: string; readonly stallThresholdDays: number; readonly currency: string };
  readonly perDataset: Readonly<Record<string, DatasetMeasurement>>;
  readonly ablations: readonly Ablation[];
  /** Money the product books for scenarios the frozen truth prices at ZERO. */
  readonly falsePositives: readonly {
    readonly scenarioId: string;
    readonly dataset: string;
    readonly businessClass: string;
    readonly bookedMinor: number;
    readonly bookedIn: readonly string[];
    readonly truthSays: string;
  }[];
  readonly falsePositiveMinor: number;
  readonly coverage: {
    readonly businessClasses: number;
    readonly classesDetectedNow: number;
    readonly classesRepresentableNotDetected: number;
    readonly classesNotRepresentable: number;
    readonly classCoverage: number;
    readonly totalBusinessLeakageMinor: number;
    readonly detectedValueMinor: number;
    readonly representableNotDetectedValueMinor: number;
    readonly notRepresentableValueMinor: number;
    readonly valueCoverage: number;
  };
  readonly claimBoundary: {
    readonly syntheticOnly: true;
    readonly isRecoveredRevenue: false;
    readonly isProvenRevenueReturned: false;
    readonly note: string;
  };
}

/** PURE: every input is passed in. No filesystem, no clock, no network, no randomness. */
export async function remeasure(input: {
  /**
   * ALL THREE frozen datasets, because the denominator demands it. The recorded 2026-09-27 score counts
   * 11 business leakage classes over $122,250.66, and `terminal_state_after_cutoff` ($6,700.00, S20) has
   * its rows in `spot-cancelled-after-asof.csv`. Measuring only `dataset.csv` yielded 10 classes over
   * $115,550.66 — a different question, quietly asked. Comparing that to the recorded figure would have
   * been the error V1 warned about: two correct numbers about two different denominators, quoted
   * interchangeably.
   */
  readonly datasets: readonly { readonly name: string; readonly csv: string }[];
  readonly groundTruthJson: string;
  readonly measuredAt: string;
  readonly buildRevision: string;
}): Promise<Remeasurement> {
  const truth = JSON.parse(input.groundTruthJson) as GroundTruth;
  const policy = makePolicy({
    // FROM THE FROZEN TRUTH, never from this file. The terms are part of what was frozen; choosing them
    // here would make the measurer the author of what it measures.
    asOf: truth.asOf,
    stallThresholdDays: truth.stallThresholdDays,
    currency: truth.currency,
    excludedStatuses: ["test", "internal"],
  });

  const ablations: Ablation[] = [];
  const perDataset: Record<string, DatasetMeasurement> = {};

  for (const { name: datasetName, csv } of input.datasets) {
    const declared = truth.datasets.find((d) => d.name === datasetName);
    if (!declared) throw new Error(`dataset ${datasetName} is not declared by the frozen ground truth`);
    const mainIds = new Set(declared.scenarioIds);
    const mine = truth.scenarios.filter((s) => mainIds.has(s.scenario_id));

    const run = async (text: string) =>
      reportedMoney(await assessCsv(text, policy, { createdAt: input.measuredAt }));
    const full = await assessCsv(csv, policy, { createdAt: input.measuredAt });
    const baseline = reportedMoney(full);
    const { rows } = splitRows(csv);
    const entityOf = (r: string) => r.slice(0, r.indexOf(","));
    const rowsByEntity = new Map<string, number>();
    for (const r of rows) rowsByEntity.set(entityOf(r), (rowsByEntity.get(entityOf(r)) ?? 0) + 1);
    const claimed = new Set(mine.filter((x) => x.row_count > 0).map((x) => x.entity_id));

    const diff = (variant: Readonly<Record<string, number>>) =>
      Object.freeze(
        Object.fromEntries(REPORTED_FIELDS.map((f) => [f, (baseline[f] ?? 0) - (variant[f] ?? 0)])),
      ) as Readonly<Record<string, number>>;

    const mineAblations: Ablation[] = [];
    for (const s of mine) {
      const withheldRows = rowsByEntity.get(s.entity_id) ?? 0;
      const delta =
        withheldRows === 0
          ? (Object.freeze(Object.fromEntries(REPORTED_FIELDS.map((f) => [f, 0]))) as Readonly<Record<string, number>>)
          : diff(await run(withhold(csv, new Set([s.entity_id]))));
      const detectedIn = EXPOSURE_FIELDS.filter((f) => (delta[f] ?? 0) > 0);
      const detectedMinor = detectedIn.reduce((n, f) => n + (delta[f] ?? 0), 0);
      const truthExpectedExposure = TRUTH_EXPOSURE_BUCKETS.includes(s.expected_bucket);
      const verdict: Ablation["verdict"] = !s.representable
        ? "NOT_REPRESENTABLE"
        : s.business_leakage_minor === 0
          ? // Priced at zero by the business. Money booked here is a false positive only where the truth
            // ALSO expected no exposure surface — otherwise the product is doing exactly what was
            // predicted and the zero price is a commercial de-minimis judgement, not a refusal. Reported
            // as a CANDIDATE, never as a verdict on who is right: whether such a row should have been
            // admitted at all is a contract question with an owner.
            detectedIn.length > 0 && !truthExpectedExposure
            ? "FALSE_POSITIVE_CANDIDATE"
            : "NOT_A_LEAKAGE"
          : detectedIn.length > 0
            ? "DETECTED"
            : "NOT_DETECTED";
      mineAblations.push(
        Object.freeze({
          scenarioId: s.scenario_id,
          entityId: s.entity_id,
          businessClass: s.business_class,
          businessLeakageMinor: s.business_leakage_minor,
          representable: s.representable,
          rowsWithheld: withheldRows,
          delta,
          detectedIn: Object.freeze(detectedIn),
          detectedMinor,
          predicted2026_09_27: Object.freeze({ bucket: s.expected_bucket, nhCanDetect: s.nh_can_detect }),
          verdict,
          // Fires in BOTH directions: the truth predicted whether THIS PRODUCT could detect the
          // scenario, so the comparison is against `nh_can_detect` alone. A one-sided flag would only
          // ever surface improvements. Folding `business_leakage_minor` in here was the same conflation
          // corrected above — it made S09 read as a departure when the product matched exactly.
          supersedesPrediction: s.representable && (detectedIn.length > 0) !== s.nh_can_detect,
          dataset: datasetName,
        }),
      );
    }
    ablations.push(...mineAblations);

    // THE FILLER COHORT, measured rather than assumed away. Most entities belong to no scenario; the
    // first run's unexplained $1,000.00 had to come from somewhere, and an audit that could not say where
    // would be asserting its own completeness.
    const unclaimedEntities = [...rowsByEntity.keys()].filter((e) => !claimed.has(e));
    const unclaimedRows = unclaimedEntities.reduce((n, e) => n + (rowsByEntity.get(e) ?? 0), 0);
    const unclaimedDelta =
      unclaimedEntities.length === 0
        ? (Object.freeze(Object.fromEntries(REPORTED_FIELDS.map((f) => [f, 0]))) as Readonly<Record<string, number>>)
        : diff(await run(withhold(csv, new Set(unclaimedEntities))));

    // COMPLETENESS. Σ(per-scenario deltas) + unclaimed must equal the baseline. A residual means either
    // an interaction (two rows masking each other) or money nothing accounts for — both are findings,
    // and this identity is the only thing that detects the masking case ablation cannot see directly.
    const completeness = Object.freeze(
      Object.fromEntries(
        REPORTED_FIELDS.map((f) => {
          const attributed =
            mineAblations.reduce((n, a) => n + (a.delta[f] ?? 0), 0) + (unclaimedDelta[f] ?? 0);
          return [
            f,
            Object.freeze({ baseline: baseline[f] ?? 0, attributed, residual: (baseline[f] ?? 0) - attributed }),
          ];
        }),
      ),
    ) as DatasetMeasurement["completeness"];

    // CROSS-CHECK the two mechanisms where the truth's tag arithmetic is self-consistent.
    const crossCheck = (
      [
        { field: "observed.observedUnpaid", truthBucket: "observedUnpaid" },
        { field: "observed.unknownValue", truthBucket: "unknownValue" },
        { field: "observed.excludedValue", truthBucket: "excludedValue" },
        { field: "observed.partialOutstanding", truthBucket: "partialOutstanding" },
      ] as const
    ).map(({ field, truthBucket }) => {
      const bucketScenarios = mine.filter((x) => x.expected_bucket === truthBucket);
      const { scenarioIds, undecodable } = decodeContributors(baseline[field] ?? 0, bucketScenarios);
      const byAblation = mineAblations.filter((a) => (a.delta[field] ?? 0) > 0).map((a) => a.scenarioId).sort();
      const byTag = [...scenarioIds].sort();
      return Object.freeze({
        field,
        truthBucket,
        centTagScenarios: Object.freeze(byTag),
        ablationScenarios: Object.freeze(byAblation),
        // Tag decoding can only ever name TAGGED scenarios, so agreement is containment in that
        // direction. An ablation-only name is not a disagreement — it is the tag device's blind spot,
        // which is exactly how the S33 false positive surfaced.
        agrees: !undecodable && byTag.every((id) => byAblation.includes(id)),
        undecodable,
      });
    });

    perDataset[datasetName] = Object.freeze({
      baseline,
      cohortCounts: Object.freeze({
        acceptedCycleCount: full.acceptedCycleCount,
        excludedRowCount: full.excludedRowCount,
        stalledCount: full.stalledCount,
        undeterminedCount: full.undeterminedCount,
        referenceCount: full.referenceCount,
        nonStalledPopulation: full.nonStalledExposure.population,
        csvRows: rows.length,
        distinctEntities: rowsByEntity.size,
        scenariosInThisDataset: mine.length,
      }),
      unclaimed: Object.freeze({
        entityCount: unclaimedEntities.length,
        rowsWithheld: unclaimedRows,
        delta: unclaimedDelta,
      }),
      completeness,
      crossCheck: Object.freeze(crossCheck),
    });
  }

  // ── COVERAGE over BUSINESS CLASSES, across every dataset ───────────────────────────────────────
  // A class counts as detected when ANY scenario of it is detected in ANY frozen dataset. Computed from
  // the ablation, so a stale prediction cannot blind it.
  const classes = new Map<string, Ablation[]>();
  for (const a of ablations) {
    if (a.businessLeakageMinor === 0) continue;
    classes.set(a.businessClass, [...(classes.get(a.businessClass) ?? []), a]);
  }
  // The not-representable classes have no rows in any dataset by construction — there is nothing to
  // withhold — so they are counted from the truth directly.
  for (const s of truth.scenarios) {
    if (s.representable || s.business_leakage_minor === 0) continue;
    if (classes.has(s.business_class)) continue;
    classes.set(s.business_class, [
      Object.freeze({
        scenarioId: s.scenario_id, entityId: s.entity_id, businessClass: s.business_class,
        businessLeakageMinor: s.business_leakage_minor, representable: false, rowsWithheld: 0,
        delta: Object.freeze({}), detectedIn: Object.freeze([]), detectedMinor: 0,
        predicted2026_09_27: Object.freeze({ bucket: s.expected_bucket, nhCanDetect: s.nh_can_detect }),
        verdict: "NOT_REPRESENTABLE" as const, supersedesPrediction: false, dataset: "(none)",
      }),
    ]);
  }

  // Scenario-level dedupe: S19 and S37 are controls present in all three datasets, so a class must not
  // be counted once per appearance.
  const seen = new Set<string>();
  let detectedNow = 0, repNotDetected = 0, notRep = 0;
  let detectedValue = 0, repNotDetectedValue = 0, notRepValue = 0;
  for (const [, dsAll] of classes) {
    const ds = dsAll.filter((d) => {
      const key = `${d.businessClass}|${d.scenarioId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const value = ds.reduce((n, d) => n + d.businessLeakageMinor, 0);
    if (ds.every((d) => !d.representable)) {
      notRep += 1;
      notRepValue += value;
    } else if (ds.some((d) => d.verdict === "DETECTED")) {
      detectedNow += 1;
      detectedValue += ds.filter((d) => d.verdict === "DETECTED").reduce((n, d) => n + d.businessLeakageMinor, 0);
      repNotDetectedValue += ds.filter((d) => d.verdict !== "DETECTED").reduce((n, d) => n + d.businessLeakageMinor, 0);
    } else {
      repNotDetected += 1;
      repNotDetectedValue += value;
    }
  }
  const total = detectedValue + repNotDetectedValue + notRepValue;

  const falsePositives = ablations.filter((a) => a.verdict === "FALSE_POSITIVE_CANDIDATE");

  return Object.freeze({
    scheme: REMEASURE_SCHEME,
    cycle: CYCLE,
    measuredAt: input.measuredAt,
    buildRevision: input.buildRevision,
    inputs: Object.freeze([
      ...input.datasets.map((d) => ({ path: `${FIXTURE_DIR}/${d.name}.csv`, sha256: sha(d.csv) })),
      { path: `${FIXTURE_DIR}/ground-truth.json`, sha256: sha(input.groundTruthJson) },
    ]),
    policy: Object.freeze({ asOf: policy.asOf, stallThresholdDays: policy.stallThresholdDays, currency: policy.currency }),
    perDataset: Object.freeze(perDataset),
    ablations: Object.freeze(ablations),
    falsePositives: Object.freeze(
      falsePositives.map((a) =>
        Object.freeze({
          scenarioId: a.scenarioId,
          dataset: a.dataset,
          businessClass: a.businessClass,
          bookedMinor: a.detectedMinor,
          bookedIn: a.detectedIn,
          truthSays: a.predicted2026_09_27.bucket,
        }),
      ),
    ),
    falsePositiveMinor: falsePositives.reduce((n, a) => n + a.detectedMinor, 0),
    coverage: Object.freeze({
      businessClasses: classes.size,
      classesDetectedNow: detectedNow,
      classesRepresentableNotDetected: repNotDetected,
      classesNotRepresentable: notRep,
      classCoverage: classes.size === 0 ? 0 : detectedNow / classes.size,
      totalBusinessLeakageMinor: total,
      detectedValueMinor: detectedValue,
      representableNotDetectedValueMinor: repNotDetectedValue,
      notRepresentableValueMinor: notRepValue,
      valueCoverage: total === 0 ? 0 : detectedValue / total,
    }),
    claimBoundary: Object.freeze({
      syntheticOnly: true as const,
      isRecoveredRevenue: false as const,
      isProvenRevenueReturned: false as const,
      note:
        "Planted figures are Synthetic Ground-Truth Leakage. Anything this build computed is Detected " +
        "Revenue Opportunity — OBSERVED exposure only. No figure here is Revenue Returned or Auditable " +
        "Revenue, and no Recovery Case was created.",
    }),
  }) as Remeasurement;
}
