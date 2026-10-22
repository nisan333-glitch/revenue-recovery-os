// The MONEY-FIRST SCOREBOARD.
//
// It scores a reconciler against ground truth it did not author. The four rules below are the reason
// this file is separate from both the scenarios and any reconciler, and each is enforced by a test that
// breaks when the rule is broken:
//
//   1. UNKNOWN IS NEVER ZERO. An unpriceable expectation is a COUNT reported beside the money. It never
//      enters a money sum, and a result computed with exclusions is a LOWER BOUND, labelled as one.
//   2. NEGATIVE NEVER CANCELS POSITIVE. Gross positive and gross negative are separate columns, and
//      monetary recall is computed over positives only. `netResidual` exists, is optional, and is never
//      called leakage.
//   3. ATTRIBUTED MONEY IS NOT INCREMENTAL UNION MONEY. A dollar another capability already counts, or
//      a dollar that was paid to the wrong place, contributes nothing to the union.
//   4. A_BLIND_BY_CONSTRUCTION STAYS IN THE DENOMINATOR. Scenarios monetary reconciliation cannot see at
//      any grain are real false negatives. Recall is correctly below 100% and the named line explains
//      the shortfall — trimming the denominator to flatter the capability is the same error as clamping
//      a signed residual.
import type { Scenario } from "./reconciliationScenarios";

/** What a reconciler reports per scenario. A reconciler that finds nothing returns zeros and refusals. */
export interface ReconcilerReading {
  readonly scenarioId: string;
  /** Σ positive residuals the reconciler reports as exposure, after its own pairing rules. */
  readonly reportedPositiveMinor: number;
  /** Σ |negative residuals| it reports. */
  readonly reportedNegativeMinor: number;
  /** Positive residuals it held out of the headline because a named mechanism paired them. */
  readonly reportedPairedMinor: number;
  /** Units it refused rather than guessed at. */
  readonly refusedUnitCount: number;
  /** Expectations it could not price. */
  readonly reportedUnknownCount: number;
  readonly eventFindings: {
    readonly missing: number;
    readonly duplicate: number;
    readonly matched: number;
  } | null; // null = the event capability is gated closed
  readonly correlationFindings: number | null; // null = gated closed
}

export interface Scoreboard {
  readonly scenarioCount: number;
  // ── monetary ──
  readonly knownGroundTruthPositiveMinor: number;
  readonly detectedPositiveMinor: number;
  readonly truePositiveMinor: number;
  readonly falsePositiveMinor: number;
  readonly falseNegativeMinor: number;
  /** null when there is no positive ground truth at all — never silently 0, and never 1. */
  readonly monetaryRecall: number | null;
  /** null when nothing was detected. A detector that reports nothing has NO precision, not perfect precision. */
  readonly monetaryPrecision: number | null;
  // ── the figures that must never be blended ──
  readonly unknownExpectationCount: number;
  readonly grossNegativeDiscrepancyMinor: number;
  readonly doubleCountedUnionMinor: number;
  readonly aBlindByConstructionMinor: number;
  readonly incrementalUnionMinor: number;
  readonly pairedHeldOutMinor: number;
  readonly refusedUnitCount: number;
  // ── event and correlation, where ground truth makes them meaningful ──
  readonly eventRecall: number | null;
  readonly eventPrecision: number | null;
  readonly correlationFailuresInTruth: number;
  readonly correlationFailuresDetected: number | null;
  readonly capabilityGatedScenarios: number;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** A ratio, or null when the denominator is zero. NEVER 0/0 = 0 and never 0/0 = 1. */
const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function score(
  scenarios: readonly Scenario[],
  readings: readonly ReconcilerReading[],
): Scoreboard {
  const byId = new Map(readings.map((r) => [r.scenarioId, r]));

  let knownPositive = 0, detectedPositive = 0, truePositive = 0, falsePositive = 0, falseNegative = 0;
  let unknownCount = 0, grossNegative = 0, blind = 0, incrementalUnion = 0, paired = 0, refused = 0;
  let truthMissing = 0, truthDuplicate = 0, foundMissing = 0, foundDuplicate = 0, correctFound = 0;
  let correlationTruthFailures = 0, correlationDetected = 0, gated = 0;
  let anyEventCapability = false, anyCorrelationCapability = false;

  for (const s of scenarios) {
    const t = s.truth;
    const r = byId.get(s.id);

    // RULE 4 · the blind scenarios stay in the denominator.
    knownPositive += t.positiveExposureMinor;
    if (t.blindToMonetary) blind += t.positiveExposureMinor;

    // RULE 1 · unknown is a count, never money.
    unknownCount += t.unknownExpectationCount;
    // RULE 2 · its own column.
    grossNegative += t.negativeDiscrepancyMinor;
    // RULE 3 · displacement and misallocation add nothing.
    incrementalUnion += t.incrementalUnionMinor;

    if (!r) { falseNegative += t.positiveExposureMinor; gated += 1; continue; }

    detectedPositive += r.reportedPositiveMinor;
    paired += r.reportedPairedMinor;
    refused += r.refusedUnitCount;

    // True positive is the money BOTH the truth and the reading agree is exposure — per scenario, so an
    // over-report on one scenario can never be excused by an under-report on another.
    const tp = Math.min(t.positiveExposureMinor, r.reportedPositiveMinor);
    truePositive += tp;
    falsePositive += Math.max(0, r.reportedPositiveMinor - t.positiveExposureMinor);
    falseNegative += Math.max(0, t.positiveExposureMinor - r.reportedPositiveMinor);

    if (r.eventFindings) {
      anyEventCapability = true;
      truthMissing += t.eventTruthCounts.missing;
      truthDuplicate += t.eventTruthCounts.duplicate;
      foundMissing += r.eventFindings.missing;
      foundDuplicate += r.eventFindings.duplicate;
      correctFound += Math.min(t.eventTruthCounts.missing, r.eventFindings.missing)
        + Math.min(t.eventTruthCounts.duplicate, r.eventFindings.duplicate);
    } else gated += 1;

    if (t.correlationTruth !== "CORRECT") correlationTruthFailures += 1;
    if (r.correlationFindings !== null) {
      anyCorrelationCapability = true;
      correlationDetected += r.correlationFindings;
    }
  }

  return Object.freeze({
    scenarioCount: scenarios.length,
    knownGroundTruthPositiveMinor: knownPositive,
    detectedPositiveMinor: detectedPositive,
    truePositiveMinor: truePositive,
    falsePositiveMinor: falsePositive,
    falseNegativeMinor: falseNegative,
    monetaryRecall: ratio(truePositive, knownPositive),
    monetaryPrecision: ratio(truePositive, detectedPositive),
    unknownExpectationCount: unknownCount,
    grossNegativeDiscrepancyMinor: grossNegative,
    // Nothing in this benchmark may be counted twice: the union is the sum of per-scenario incremental
    // contributions, so a scenario whose money another capability already counts contributes zero.
    //
    // READ THIS FIGURE PRECISELY. It is IDENTICALLY ZERO for every possible input — the accumulator and
    // the subtrahend walk the same multiset of scenarios and read the same field, so no reading, no
    // scenario list and no repeated entry can move it. It is therefore NOT evidence that a detector
    // double-counted nothing; it is evidence that the ACCUMULATION PATH still reads the authored union
    // figure and nothing else. Its only force is against a change to this file, which makes it
    // undefendable by behaviour alone — hence the structural guard in the test beside it, and falsifier
    // F10, which drives it to exactly 30_000 on the enabled population (272_001 accumulated against
    // 242_001 authored: R07 + R08 + R09, the three scenarios whose money is explained, not found).
    doubleCountedUnionMinor: Math.max(0, incrementalUnion - sum(scenarios.map((s) => s.truth.incrementalUnionMinor))),
    aBlindByConstructionMinor: blind,
    incrementalUnionMinor: incrementalUnion,
    pairedHeldOutMinor: paired,
    refusedUnitCount: refused,
    eventRecall: anyEventCapability ? ratio(correctFound, truthMissing + truthDuplicate) : null,
    eventPrecision: anyEventCapability ? ratio(correctFound, foundMissing + foundDuplicate) : null,
    correlationFailuresInTruth: correlationTruthFailures,
    correlationFailuresDetected: anyCorrelationCapability ? correlationDetected : null,
    capabilityGatedScenarios: gated,
  });
}

/** The mandatory control: a reconciler that finds nothing. Not a stub to be replaced — a permanent fixture. */
export function doNothingReconciler(scenarios: readonly Scenario[]): readonly ReconcilerReading[] {
  return Object.freeze(
    scenarios.map((s) => Object.freeze({
      scenarioId: s.id,
      reportedPositiveMinor: 0,
      reportedNegativeMinor: 0,
      reportedPairedMinor: 0,
      refusedUnitCount: 0,
      reportedUnknownCount: 0,
      eventFindings: null,
      correlationFindings: null,
    })),
  );
}
