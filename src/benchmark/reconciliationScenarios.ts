// The two-sided reconciliation benchmark — SCENARIOS AND GROUND TRUTH.
//
// THIS MODULE IMPORTS NOTHING. Not a type, not a helper, not a constant. That is asserted structurally
// by its test, and it is the whole point: ground truth that imported the reconciler could come to agree
// with the reconciler. Every number below is AUTHORED from the business reading of the scenario, and
// `whyThisIsTheTruth` records that reading in one sentence so a reviewer can disagree with the claim
// rather than with an opaque integer.
//
// WHY TWO SIDES, AND WHY ABSENCE IS ABSENCE. Side E is the expectation (what the contract system says is
// owed). Side O is the observation (what billing actually did). A missing invoice is represented by
// `o: []` — NO OBSERVATION ROW AT ALL. Not a row of zeroes, not a row with blanks. A detector that reads
// only Side O cannot distinguish "never billed" from "not in the file", which is exactly the structural
// gap the architecture exists to close, so the fixture must not paper over it.
//
// THE TWIN RULE. Every scenario whose correct handling depends on a lifecycle fact being REPRESENTED
// appears twice: once with the fact present (`representationEnabled: true`) and once absent. The $0
// false-positive target holds only under those representation requirements, and a benchmark containing
// only the enabled twins would prove the design works where it is easy — the selection-bias failure
// recorded in docs/S1_OBLIGATION_IDENTITY_AUDIT_V1.md §5.
//
// MONEY IS INTEGER MINOR UNITS throughout. $100.00 is 10_000.

/** What Side E asserts: this entitlement owes money for this period. */
export interface ExpectationRow {
  readonly entitlementRef: string;
  readonly customerRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** null means UNKNOWN — an expectation whose amount cannot be established. NEVER write 0 for unknown. */
  readonly expectedAmountMinor: number | null;
  readonly currency: string;
  readonly terminatedAt: string | null;
  readonly pauseStart: string | null;
  readonly pauseEnd: string | null;
  readonly amendedAt: string | null;
  readonly supersedesRef: string | null;
  readonly scheduleLineRef: string | null;
}

/** What Side O observed: billing raised this. An absent obligation has NO row here. */
export interface ObservationRow {
  readonly invoiceRef: string;
  /** The allocation. Without it nothing can be reconciled to a grain — an invoice total is not enough. */
  readonly entitlementRef: string;
  readonly customerRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly billedAmountMinor: number;
  readonly currency: string;
  /** A credit is NOT a billing event and must never be netted into billed money. */
  readonly isCredit: boolean;
}

export type EventTruthKind = "matched" | "missing" | "duplicate" | "unmatchedObservation" | "notExpected";

/** Per-scenario event counts rather than one label, because a scenario may hold several obligations. */
export type EventTruthCounts = Readonly<Record<EventTruthKind, number>>;

export type CorrelationTruth =
  | "CORRECT"
  | "MISALLOCATED_ENTITLEMENT"
  | "MISALLOCATED_CUSTOMER"
  | "UNAVAILABLE";

export interface GroundTruth {
  /** Σ authoritative expected amounts. An UNKNOWN expectation contributes NOTHING here, not zero-as-a-value. */
  readonly expectedMoneyMinor: number;
  readonly observedMoneyMinor: number;
  /** Money genuinely owed and not billed. The target of monetary detection. */
  readonly positiveExposureMinor: number;
  /** Money billed beyond expectation. A liability signal — never exposure, never "recovered". */
  readonly negativeDiscrepancyMinor: number;
  readonly eventTruthCounts: EventTruthCounts;
  readonly correlationTruth: CorrelationTruth;
  /** Count of expectations whose amount cannot be established. Reported beside money, never inside it. */
  readonly unknownExpectationCount: number;
  /** What this scenario adds to the union. Displacement and misallocation add NOTHING. */
  readonly incrementalUnionMinor: number;
  /**
   * True when monetary reconciliation cannot see this scenario's exposure AT ANY GRAIN, because the
   * offsetting errors live inside one reconciliation unit. These stay in the recall denominator: they
   * are real false negatives, and trimming them would flatter the capability.
   */
  readonly blindToMonetary: boolean;
  readonly whyThisIsTheTruth: string;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly representationEnabled: boolean;
  readonly e: readonly ExpectationRow[];
  readonly o: readonly ObservationRow[];
  readonly truth: GroundTruth;
}

const USD = "USD";
const C = 10_000; // $100.00

const NO_EVENTS: EventTruthCounts = Object.freeze({
  matched: 0, missing: 0, duplicate: 0, unmatchedObservation: 0, notExpected: 0,
});
const events = (over: Partial<EventTruthCounts>): EventTruthCounts => Object.freeze({ ...NO_EVENTS, ...over });

/** An expectation with every lifecycle fact absent unless stated. */
function exp(
  entitlementRef: string,
  month: string,
  expectedAmountMinor: number | null,
  over: Partial<ExpectationRow> = {},
): ExpectationRow {
  return Object.freeze({
    entitlementRef,
    customerRef: "cust-A",
    periodStart: `2026-${month}-01`,
    periodEnd: `2026-${month}-28`,
    expectedAmountMinor,
    currency: USD,
    terminatedAt: null,
    pauseStart: null,
    pauseEnd: null,
    amendedAt: null,
    supersedesRef: null,
    scheduleLineRef: null,
    ...over,
  });
}

/** An observation allocated to an entitlement and a period. */
function obs(
  invoiceRef: string,
  entitlementRef: string,
  month: string,
  billedAmountMinor: number,
  over: Partial<ObservationRow> = {},
): ObservationRow {
  return Object.freeze({
    invoiceRef,
    entitlementRef,
    customerRef: "cust-A",
    periodStart: `2026-${month}-01`,
    periodEnd: `2026-${month}-28`,
    billedAmountMinor,
    currency: USD,
    isCredit: false,
    ...over,
  });
}

export const RECONCILIATION_SCENARIOS: readonly Scenario[] = Object.freeze([
  // ── 1 · TRUE MISSING MONEY ──────────────────────────────────────────────────────────────────────
  {
    id: "R01-missing-billing",
    title: "expected $100, nothing billed — the base case",
    representationEnabled: true,
    e: [exp("ent-1", "03", C)],
    o: [], // ABSENCE IS ABSENCE. No row.
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: 0,
      positiveExposureMinor: C, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ missing: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "An obligation was established and billing never acted; the whole amount is owed and unbilled.",
    },
  },
  {
    id: "R01b-missing-odd-cents",
    title: "expected $2,000.01, nothing billed — exactness to the cent",
    representationEnabled: true,
    e: [exp("ent-1b", "03", 200_001)],
    o: [],
    truth: {
      expectedMoneyMinor: 200_001, observedMoneyMinor: 0,
      positiveExposureMinor: 200_001, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ missing: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 200_001, blindToMonetary: false,
      whyThisIsTheTruth: "Same as R01 with an odd-cent amount, so the arithmetic is proved exact rather than round.",
    },
  },
  // ── 2 · PARTIAL UNDER-BILLING ───────────────────────────────────────────────────────────────────
  {
    id: "R02-partial-underbilling",
    title: "expected $100, billed $80 — the event happened, the amount is short",
    representationEnabled: true,
    e: [exp("ent-2", "03", C)],
    o: [obs("inv-2", "ent-2", "03", 8_000)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: 8_000,
      positiveExposureMinor: 2_000, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 2_000, blindToMonetary: false,
      whyThisIsTheTruth: "Billing acted but for too little; the shortfall is owed and the event is not missing.",
    },
  },
  // ── 3 · EXACT BALANCE ───────────────────────────────────────────────────────────────────────────
  {
    id: "R03-exact-balance",
    title: "expected $100, billed $100 — MONETARILY_BALANCED and nothing more",
    representationEnabled: true,
    e: [exp("ent-3", "03", C)],
    o: [obs("inv-3", "ent-3", "03", C)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Billing did its job; a correct answer of zero, which is not the same as proof of correctness.",
    },
  },
  // ── 4 · OVER-BILLING ────────────────────────────────────────────────────────────────────────────
  {
    id: "R04-overbilling",
    title: "expected $100, billed $120 — a liability signal, never exposure",
    representationEnabled: true,
    e: [exp("ent-4", "03", C)],
    o: [obs("inv-4", "ent-4", "03", 12_000)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: 12_000,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 2_000,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The company billed more than was owed; that is money it may owe back, not money it found.",
    },
  },
  // ── 5 · MISSING + UNRELATED SURPLUS ─────────────────────────────────────────────────────────────
  {
    id: "R05-missing-plus-unrelated-surplus",
    title: "$100 missing on one customer, $100 over-billed on an UNRELATED customer",
    representationEnabled: true,
    e: [exp("ent-5a", "03", C), exp("ent-5b", "03", C, { customerRef: "cust-Z" })],
    o: [obs("inv-5b", "ent-5b", "03", 2 * C, { customerRef: "cust-Z" })],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ missing: 1, matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "Two unrelated problems on two unrelated payers; netting them to zero would report no problem at all, which is false.",
    },
  },
  // ── 6 · DUPLICATE MASKING MISSING ───────────────────────────────────────────────────────────────
  {
    id: "R06-duplicate-masks-missing",
    title: "two obligations in one unit: one billed TWICE, the other never — residual zero",
    representationEnabled: true,
    e: [exp("ent-6", "03", C, { scheduleLineRef: "sl-6-1" }), exp("ent-6", "03", C, { scheduleLineRef: "sl-6-2" })],
    o: [obs("inv-6", "ent-6", "03", C), obs("inv-6-dup", "ent-6", "03", C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 1, missing: 1, duplicate: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: true,
      whyThisIsTheTruth: "A duplicate conceals an omission inside one unit, so the money is genuinely owed and monetary reconciliation cannot see it at any grain.",
    },
  },
  // ── 7 · WRONG ENTITLEMENT ───────────────────────────────────────────────────────────────────────
  {
    id: "R07-wrong-entitlement",
    title: "one customer, two entitlements: all the money billed to the wrong one",
    representationEnabled: true,
    e: [exp("ent-7a", "03", C), exp("ent-7b", "03", C)],
    o: [obs("inv-7", "ent-7b", "03", 2 * C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "MISALLOCATED_ENTITLEMENT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The company WAS paid in full; the revenue sits against the wrong entitlement, so this is an attribution failure and not missing money.",
    },
  },
  {
    id: "R07x-wrong-entitlement-unpairable",
    title: "same as R07 but the contract relation is NOT authoritative — the pairing is unavailable",
    representationEnabled: false,
    e: [exp("ent-7xa", "03", C, { customerRef: "cust-U1" }), exp("ent-7xb", "03", C, { customerRef: "cust-U2" })],
    o: [obs("inv-7x", "ent-7xb", "03", 2 * C, { customerRef: "cust-U2" })],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "Without an authoritative relation the two residuals cannot be shown to be one displacement, so the shortfall must be reported rather than explained away.",
    },
  },
  // ── 8 · WRONG CUSTOMER ──────────────────────────────────────────────────────────────────────────
  {
    id: "R08-wrong-customer",
    title: "billed to a sibling payer under an authoritative hierarchy",
    representationEnabled: true,
    e: [exp("ent-8a", "03", C, { customerRef: "cust-P-child1" }), exp("ent-8b", "03", C, { customerRef: "cust-P-child2" })],
    o: [obs("inv-8", "ent-8b", "03", 2 * C, { customerRef: "cust-P-child2" })],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "MISALLOCATED_CUSTOMER",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The money arrived within one payer group; which child was invoiced is an attribution question, not a missing-money question.",
    },
  },
  {
    id: "R08x-wrong-customer-no-hierarchy",
    title: "same as R08 with NO payer hierarchy — the known residual false-positive risk",
    representationEnabled: false,
    e: [exp("ent-8xa", "03", C, { customerRef: "cust-Q1" }), exp("ent-8xb", "03", C, { customerRef: "cust-Q2" })],
    o: [obs("inv-8x", "ent-8xb", "03", 2 * C, { customerRef: "cust-Q2" })],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "Two unrelated payers cannot be paired on evidence, so the shortfall stands as reported — this is the documented limit, not a defect to tune away.",
    },
  },
  // ── 9 · TIMING SHIFT ────────────────────────────────────────────────────────────────────────────
  {
    id: "R09-timing-shift-in-grace",
    title: "the March invoice raised in February — adjacent periods, inside the grace window",
    representationEnabled: true,
    e: [exp("ent-9", "02", C), exp("ent-9", "03", C)],
    o: [obs("inv-9a", "ent-9", "02", C), obs("inv-9b", "ent-9", "02", C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Both invoices exist and the money arrived; it was recognised in the wrong period, which is displacement rather than absence.",
    },
  },
  {
    id: "R09x-timing-shift-out-of-grace",
    title: "the same shift but far outside the grace window — no longer a timing explanation",
    representationEnabled: false,
    e: [exp("ent-9x", "01", C), exp("ent-9x", "06", C)],
    o: [obs("inv-9xa", "ent-9x", "01", C), obs("inv-9xb", "ent-9x", "01", C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: C, negativeDiscrepancyMinor: C,
      eventTruthCounts: events({ matched: 1, missing: 1, duplicate: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "Five months apart is not a timing shift; June was never billed and January was billed twice, so the June money is owed.",
    },
  },
  // ── 10, 11 · SPLIT AND CONSOLIDATED BILLING ─────────────────────────────────────────────────────
  {
    id: "R10-split-billing",
    title: "one obligation settled by two invoices summing correctly",
    representationEnabled: true,
    e: [exp("ent-10", "03", C)],
    o: [obs("inv-10a", "ent-10", "03", 6_000), obs("inv-10b", "ent-10", "03", 4_000)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Splitting an invoice is a billing choice, not a leak; the obligation is fully settled.",
    },
  },
  {
    id: "R11-consolidated-allocatable",
    title: "two obligations on one invoice, ALLOCATABLE to each entitlement-period",
    representationEnabled: true,
    e: [exp("ent-11", "03", C, { scheduleLineRef: "sl-11-1" }), exp("ent-11", "04", C, { scheduleLineRef: "sl-11-2" })],
    o: [obs("inv-11", "ent-11", "03", C), obs("inv-11", "ent-11", "04", C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "One invoice may carry two periods; because each line is allocated, both reconcile and nothing is owed.",
    },
  },
  {
    id: "R11x-consolidated-unallocatable",
    title: "the same invoice with NO allocation — must be refused, never apportioned",
    representationEnabled: false,
    e: [exp("ent-11x", "03", C), exp("ent-11x", "04", C)],
    o: [obs("inv-11x", "ent-11x", "03", 2 * C)], // one line claiming one period for both obligations
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The money is all there but cannot be attributed to periods; the honest output is a refusal, and inventing an apportionment would be a guess.",
    },
  },
  // ── 12 · PRORATION ──────────────────────────────────────────────────────────────────────────────
  {
    id: "R12-proration-unknown-amount",
    title: "a part-period obligation NH cannot price, never billed",
    representationEnabled: true,
    e: [exp("ent-12", "03", null)], // UNKNOWN, not zero
    o: [],
    truth: {
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ missing: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 1, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The event is genuinely missing and genuinely unpriceable; the finding is real and its money is UNKNOWN, which is not zero.",
    },
  },
  // ── 13, 14, 15, 16 · LIFECYCLE ──────────────────────────────────────────────────────────────────
  {
    id: "R13-pause-represented",
    title: "a paused period expects nothing — and the pause is in the data",
    representationEnabled: true,
    e: [exp("ent-13", "03", C, { pauseStart: "2026-03-01", pauseEnd: "2026-03-28" })],
    o: [],
    truth: {
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Billing correctly raised nothing for a paused period, so there is no obligation and no leak.",
    },
  },
  {
    id: "R13x-pause-unrepresented",
    title: "the same pause with NO pause field — indistinguishable from an omission",
    representationEnabled: false,
    e: [exp("ent-13x", "03", C)],
    o: [],
    truth: {
      // GROUND TRUTH IS REALITY, NEVER THE DATA'S APPEARANCE. Nothing was owed — the period was paused;
      // the data simply cannot say so. A naive reader computes $100 expected, and that computation is
      // the FALSE POSITIVE this twin exists to measure. Writing $100 here would have encoded the
      // detector's mistake as the truth.
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Nothing was owed, so any exposure reported here is a FALSE POSITIVE; this twin proves the pause field is a requirement and not a nicety.",
    },
  },
  {
    id: "R14-cancellation-dated",
    title: "terminated before the period — expects nothing",
    representationEnabled: true,
    e: [exp("ent-14", "03", C, { terminatedAt: "2026-02-15" })],
    o: [],
    truth: {
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The obligation ended before the period began; raising no invoice was correct.",
    },
  },
  {
    id: "R14x-cancellation-undated",
    title: "the same cancellation with NO effective date — must fail closed",
    representationEnabled: false,
    e: [exp("ent-14x", "03", C)],
    o: [],
    truth: {
      // As R13x: the obligation had ended, so nothing was owed. See that scenario's note.
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Nothing was owed, so exposure here is a FALSE POSITIVE — the mirror of the undated-terminal-state rule the billing side already enforces.",
    },
  },
  {
    id: "R15-amendment-superseded",
    title: "an amendment reduces the period to $60, with supersession recorded",
    representationEnabled: true,
    e: [
      exp("ent-15", "03", C, { supersedesRef: null, amendedAt: null, scheduleLineRef: "sl-15-old" }),
      exp("ent-15", "03", 6_000, { amendedAt: "2026-02-20", supersedesRef: "sl-15-old", scheduleLineRef: "sl-15-new" }),
    ],
    o: [obs("inv-15", "ent-15", "03", 6_000)],
    truth: {
      expectedMoneyMinor: 6_000, observedMoneyMinor: 6_000,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1, notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Only the amendment in force for the period is owed; the superseded line is not a second obligation.",
    },
  },
  {
    id: "R15x-amendment-no-supersession",
    title: "the same amendment with NO supersession link — the old line looks still owed",
    representationEnabled: false,
    e: [exp("ent-15x", "03", C, { scheduleLineRef: "sl-15x-old" }), exp("ent-15x", "03", 6_000, { scheduleLineRef: "sl-15x-new" })],
    o: [obs("inv-15x", "ent-15x", "03", 6_000)],
    truth: {
      expectedMoneyMinor: 6_000, observedMoneyMinor: 6_000,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1, notExpected: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Only $60 was ever owed, so counting the superseded $100 would be a FALSE POSITIVE of $100.",
    },
  },
  {
    id: "R16-renewal",
    title: "a renewed term bills the next period correctly",
    representationEnabled: true,
    e: [exp("ent-16", "03", C), exp("ent-16", "04", C)],
    o: [obs("inv-16a", "ent-16", "03", C), obs("inv-16b", "ent-16", "04", C)],
    truth: {
      expectedMoneyMinor: 2 * C, observedMoneyMinor: 2 * C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 2 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "A renewal is simply more periods under the same entitlement; both are billed and nothing is owed.",
    },
  },
  // ── 17, 18 · IDENTITY DISCONTINUITY ─────────────────────────────────────────────────────────────
  {
    id: "R17-rekey-mapped",
    title: "the entitlement was re-keyed, and the old→new mapping is authoritative",
    representationEnabled: true,
    e: [exp("ent-17-new", "03", C, { supersedesRef: "ent-17-old" })],
    o: [obs("inv-17", "ent-17-old", "03", C)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The invoice exists under the old key and the mapping proves it is the same obligation; nothing is owed.",
    },
  },
  {
    id: "R17x-rekey-unmapped",
    title: "the same re-key with NO mapping — every obligation reads as unbilled",
    representationEnabled: false,
    e: [exp("ent-17x-new", "03", C)],
    o: [obs("inv-17x", "ent-17x-old", "03", C)],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The money was billed, so reporting exposure would be a FALSE POSITIVE; the correct output is a refusal on unmatched identity.",
    },
  },
  {
    id: "R18x-migration-unannounced",
    title: "a billing migration re-keys everything at once — the whole book looks unbilled",
    representationEnabled: false,
    e: [exp("ent-18x-a", "03", C), exp("ent-18x-b", "03", C), exp("ent-18x-c", "03", C)],
    o: [obs("inv-18x-a", "new-sys-a", "03", C), obs("inv-18x-b", "new-sys-b", "03", C), obs("inv-18x-c", "new-sys-c", "03", C)],
    truth: {
      expectedMoneyMinor: 3 * C, observedMoneyMinor: 3 * C,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 3 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Every invoice exists; a migration is the worst false-positive scenario in the design and must be refused wholesale, not reported as $300 of leakage.",
    },
  },
  // ── 19 · CURRENCY MISMATCH ──────────────────────────────────────────────────────────────────────
  {
    id: "R19-currency-mismatch",
    title: "expectation in USD, billing in EUR — refuse, never convert",
    representationEnabled: true,
    e: [exp("ent-19", "03", C)],
    o: [obs("inv-19", "ent-19", "03", C, { currency: "EUR" })],
    truth: {
      expectedMoneyMinor: 0, observedMoneyMinor: 0,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ notExpected: 1 }), correlationTruth: "UNAVAILABLE",
      unknownExpectationCount: 0, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "Two currencies cannot be compared without a rate nobody governed; the unit is refused and contributes no money of either sign.",
    },
  },
  // ── 20 · UNKNOWN AMOUNT, BILLED ─────────────────────────────────────────────────────────────────
  {
    id: "R20-unknown-amount-billed",
    title: "an unpriceable expectation that WAS billed — coverage is reduced, not the residual",
    representationEnabled: true,
    e: [exp("ent-20", "03", null)],
    o: [obs("inv-20", "ent-20", "03", 7_500)],
    truth: {
      expectedMoneyMinor: 0, observedMoneyMinor: 7_500,
      positiveExposureMinor: 0, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ matched: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 1, incrementalUnionMinor: 0, blindToMonetary: false,
      whyThisIsTheTruth: "The event happened; because the expectation cannot be priced the comparison is impossible, so this reduces COVERAGE and must not be read as $75 of over-billing.",
    },
  },
  // ── A credit must never be netted into billed money ─────────────────────────────────────────────
  {
    id: "R21-credit-not-a-billing-event",
    title: "nothing billed, but a credit note exists — a credit is not a billing event",
    representationEnabled: true,
    e: [exp("ent-21", "03", C)],
    o: [obs("crd-21", "ent-21", "03", C, { isCredit: true })],
    truth: {
      expectedMoneyMinor: C, observedMoneyMinor: 0,
      positiveExposureMinor: C, negativeDiscrepancyMinor: 0,
      eventTruthCounts: events({ missing: 1 }), correlationTruth: "CORRECT",
      unknownExpectationCount: 0, incrementalUnionMinor: C, blindToMonetary: false,
      whyThisIsTheTruth: "A credit settles nothing; counting it as billed money would let a credit note conceal an entirely unbilled obligation.",
    },
  },
]);
