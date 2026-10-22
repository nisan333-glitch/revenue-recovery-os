// THE REAL CORE, SCORED AGAINST THE FROZEN BENCHMARK.
//
// The authored ground truth from 68730a9 is the examiner and is NOT edited to make the core green. Where
// the core cannot see a case, the false negative is reported honestly.
import { describe, it, expect } from "vitest";
import {
  RECONCILIATION_SCENARIOS,
  type ExpectationRow, type ObservationRow, type Scenario,
} from "./reconciliationScenarios";
import {
  RECONCILIATION_SCHEME, RECONCILIATION_METHOD_VERSION, reconcile, reconciliationWitness,
  type GovernedReconciliationTerms,
} from "./reconciliationCore";
import { doNothingReconciler, score, type ReconcilerReading } from "./reconciliationScoreboard";

const S = RECONCILIATION_SCENARIOS;

/** Governed terms. Every authoritative relation is SUPPLIED here, never inferred from the data. */
const TERMS: GovernedReconciliationTerms = {
  currency: "USD",
  invoicingGracePeriods: 1,
  payerHierarchy: { "cust-P-child1": "cust-P", "cust-P-child2": "cust-P" },
  identityAliases: { "ent-17x-old": "ent-17x-old" },
};
/** The re-key alias is authoritative only where the expectation declares supersession (R17). */
const termsFor = (s: Scenario): GovernedReconciliationTerms => {
  const link = s.e.find((e) => e.supersedesRef !== null && !e.supersedesRef.startsWith("sl-"));
  return link
    ? { ...TERMS, identityAliases: { [link.supersedesRef!]: link.entitlementRef } }
    : { ...TERMS, identityAliases: {} };
};

/** One reading per scenario, from the real core. The headline figure is the UNPAIRED positive. */
const realReadings = (): ReconcilerReading[] =>
  S.map((s) => {
    const r = reconcile(s.e, s.o, termsFor(s));
    return {
      scenarioId: s.id,
      reportedPositiveMinor: r.unpairedPositiveMinor,
      reportedNegativeMinor: r.grossNegativeMinor,
      reportedPairedMinor: r.pairedPositiveMinor,
      refusedUnitCount: r.refusedUnitCount,
      reportedUnknownCount: r.unpricedExpectationCount,
      eventFindings: r.coverage.event === "AVAILABLE"
        ? { missing: 0, duplicate: 0, matched: 0 } : null,
      correlationFindings: r.coverage.correlation === "AVAILABLE" ? 0 : null,
    };
  });

describe("pure core · identity, purity and the unrepresentable claim", () => {
  it("owns its scheme and version, reusing none of the existing ones", () => {
    expect(RECONCILIATION_SCHEME).toBe("nh-expectation-reconciliation-v1");
    expect(RECONCILIATION_METHOD_VERSION).toBe("recon-2026.1");
    for (const foreign of ["nh-non-stalled-exposure-v1", "nse-2026.1", "nh-pilot-assessment-execution-v1",
      "nh-admission-policy-v1", "nh-analysis-terms-v2", "nh-leak-instance-v1", "assess-2026.1-thin"]) {
      expect(RECONCILIATION_SCHEME).not.toBe(foreign);
      expect(RECONCILIATION_METHOD_VERSION).not.toBe(foreign);
    }
  });

  it("NO_LEAKAGE is unrepresentable — the strong claim has no value to express it", () => {
    const states = new Set(S.flatMap((s) => reconcile(s.e, s.o, termsFor(s)).units.map((u) => u.state)));
    expect([...states].some((s) => /NO_LEAKAGE|CLEAN|CORRECT/.test(s))).toBe(false);
    const bal = S.find((x) => x.id === "R03-exact-balance")!;
    const r = reconcile(bal.e, bal.o, termsFor(bal));
    expect(r.units[0]!.state).toBe("MONETARILY_BALANCED");
    expect(r.claimBoundary.provesEventCorrectness).toBe(false);
  });

  it("is pure — same inputs, identical result and identical witness", async () => {
    const s = S[0]!;
    expect(reconcile(s.e, s.o, TERMS)).toEqual(reconcile(s.e, s.o, TERMS));
    const w1 = await reconciliationWitness(s.e, s.o, TERMS, reconcile(s.e, s.o, TERMS));
    const w2 = await reconciliationWitness(s.e, s.o, TERMS, reconcile(s.e, s.o, TERMS));
    expect(w1).toBe(w2);
    expect(w1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("the witness moves when any input or any result value moves", async () => {
    const s = S[0]!;
    const base = await reconciliationWitness(s.e, s.o, TERMS, reconcile(s.e, s.o, TERMS));
    const bumped = s.e.map((e) => ({ ...e, expectedAmountMinor: (e.expectedAmountMinor ?? 0) + 1 }));
    expect(await reconciliationWitness(bumped, s.o, TERMS, reconcile(bumped, s.o, TERMS))).not.toBe(base);
  });
});

describe("pure core · the five refusals, each on its own case", () => {
  const stateOf = (id: string) => {
    const s = S.find((x) => x.id === id)!;
    return reconcile(s.e, s.o, termsFor(s)).units.map((u) => u.state);
  };

  it("REFUSED_CURRENCY_MISMATCH · never converts", () => {
    expect(stateOf("R19-currency-mismatch")).toContain("REFUSED_CURRENCY_MISMATCH");
  });

  it("REFUSED_UNMATCHED_IDENTITY · a re-key with no authoritative alias is refused, not reported", () => {
    expect(stateOf("R17x-rekey-unmapped")).toContain("REFUSED_UNMATCHED_IDENTITY");
    // ...and a migration is the same refusal at scale, not a book-sized leakage claim.
    expect(stateOf("R18x-migration-unannounced").every((s) => s === "REFUSED_UNMATCHED_IDENTITY")).toBe(true);
  });

  it("REFUSED_UNALLOCATABLE_OBSERVATION · one invoice over its period while a sibling is unbilled", () => {
    expect(stateOf("R11x-consolidated-unallocatable")).toContain("REFUSED_UNALLOCATABLE_OBSERVATION");
  });

  it("an AUTHORITATIVE alias does permit the match — refusal is not blanket pessimism", () => {
    expect(stateOf("R17-rekey-mapped")).toEqual(["MONETARILY_BALANCED"]);
  });

  it("missing evidence never becomes $0 — a refused unit carries a null residual", () => {
    const s = S.find((x) => x.id === "R19-currency-mismatch")!;
    const u = reconcile(s.e, s.o, termsFor(s)).units[0]!;
    expect(u.residualMinor).toBeNull();
    expect(u.expectedMinor).toBeNull();
  });
});

// ── THE TWO REFUSALS THE FROZEN BENCHMARK CANNOT REACH ────────────────────────────────────────────
//
// Both period guards were UNREACHABLE under the examiner, and that is a property of the fixture rather
// than of the core: every scenario builds its rows through `exp()` / `obs()`, and neither helper is ever
// called with a periodStart/periodEnd override, so an observation's bounds always equal its
// expectation's and two expectations of one entitlement are either identical or in disjoint months.
//
// A falsifier that passes because nothing reaches the guard is evidence about the fixture, not the
// guard. So the two cases are built HERE, as bespoke rows, and the benchmark is left byte-identical:
// adding scenarios would move the authored totals and the row-count pins frozen in 68730a9, which the
// brief forbids. Refusal REACHABILITY is a property of the core and is testable directly.
describe("pure core · the two period refusals, on rows the examiner cannot express", () => {
  const PERIOD_TERMS: GovernedReconciliationTerms = {
    currency: "USD", invoicingGracePeriods: 1, payerHierarchy: {}, identityAliases: {},
  };
  const expRow = (over: Partial<ExpectationRow>): ExpectationRow => ({
    entitlementRef: "ent-P", customerRef: "cust-P", periodStart: "2026-03-01", periodEnd: "2026-03-28",
    expectedAmountMinor: 10_000, currency: "USD", terminatedAt: null, pauseStart: null, pauseEnd: null,
    amendedAt: null, supersedesRef: null, scheduleLineRef: null, ...over,
  });
  const obsRow = (over: Partial<ObservationRow>): ObservationRow => ({
    invoiceRef: "inv-P", entitlementRef: "ent-P", customerRef: "cust-P", periodStart: "2026-03-01",
    periodEnd: "2026-03-28", billedAmountMinor: 10_000, currency: "USD", isCredit: false, ...over,
  });

  it("REFUSED_PERIOD_BOUNDARY_DISAGREEMENT · the sides disagree, so NH does not manufacture a period", () => {
    // The obligation runs to the 28th; billing says the 31st. The money happens to be equal, which is
    // precisely the trap: a coarser read would call this MONETARILY_BALANCED and imply the two sides
    // agree about what was owed for what period. They do not.
    const r = reconcile([expRow({})], [obsRow({ periodEnd: "2026-03-31" })], PERIOD_TERMS);
    expect(r.units.map((u) => u.state)).toEqual(["REFUSED_PERIOD_BOUNDARY_DISAGREEMENT"]);
    expect(r.units[0]!.residualMinor).toBeNull();
    expect(r.units[0]!.expectedMinor).toBeNull();
    expect(r.coverage.monetary).toBe("REFUSED");
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.grossNegativeMinor).toBe(0);
  });

  it("REFUSED_OVERLAPPING_PERIODS · an invoice inside the intersection cannot be assigned to one of them", () => {
    // Two expectations of ONE entitlement whose periods intersect without being identical, and a single
    // invoice landing inside the intersection. Apportioning it would be a guess, and assigning it to
    // either period would report the other as unbilled — $100 of manufactured exposure.
    const r = reconcile(
      [expRow({}), expRow({ periodStart: "2026-03-15", periodEnd: "2026-04-14" })],
      [obsRow({})],
      PERIOD_TERMS,
    );
    expect(r.units).toHaveLength(2);
    expect(r.units.every((u) => u.state === "REFUSED_OVERLAPPING_PERIODS")).toBe(true);
    expect(r.units.every((u) => u.residualMinor === null)).toBe(true);
    expect(r.coverage.monetary).toBe("REFUSED");
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.refusedUnitCount).toBe(2);
  });
});

describe("pure core · mechanism pairing classifies and never nets", () => {
  const unitsOf = (id: string) => {
    const s = S.find((x) => x.id === id)!;
    return reconcile(s.e, s.o, termsFor(s));
  };

  it("pairs an adjacent period of the SAME entitlement inside the grace window", () => {
    const r = unitsOf("R09-timing-shift-in-grace");
    const under = r.units.find((u) => u.state === "UNDER_BILLED")!;
    expect(under.pairedWith?.mechanism).toBe("ADJACENT_PERIOD_SAME_ENTITLEMENT");
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.pairedPositiveMinor).toBe(10_000);
    // NOT NETTED: the gross positive still carries it, and the negative is reported in full beside it.
    expect(r.grossPositiveMinor).toBe(10_000);
    expect(r.grossNegativeMinor).toBe(10_000);
  });

  it("does NOT pair across a five-month gap — the grace window is a governed bound, not a hint", () => {
    const r = unitsOf("R09x-timing-shift-out-of-grace");
    expect(r.units.find((u) => u.state === "UNDER_BILLED")!.pairedWith).toBeNull();
    expect(r.unpairedPositiveMinor).toBe(10_000);
  });

  it("pairs sibling entitlements of ONE payer, and refuses to pair two unrelated payers", () => {
    expect(unitsOf("R07-wrong-entitlement").pairedPositiveMinor).toBe(10_000);
    expect(unitsOf("R07x-wrong-entitlement-unpairable").unpairedPositiveMinor).toBe(10_000);
  });

  it("pairs sibling payers ONLY under a supplied hierarchy", () => {
    expect(unitsOf("R08-wrong-customer").pairedPositiveMinor).toBe(10_000);
    expect(unitsOf("R08x-wrong-customer-no-hierarchy").unpairedPositiveMinor).toBe(10_000);
  });

  it("never pairs two amounts merely because they happen to offset", () => {
    // R05's two residuals offset exactly, but the payers are unrelated and no hierarchy links them.
    const r = unitsOf("R05-missing-plus-unrelated-surplus");
    expect(r.unpairedPositiveMinor).toBe(10_000);
    expect(r.pairedPositiveMinor).toBe(0);
  });
});

describe("pure core · declared coverage", () => {
  it("declares event reconciliation UNAVAILABLE where no per-obligation key exists", () => {
    const s = S.find((x) => x.id === "R01-missing-billing")!;
    expect(reconcile(s.e, s.o, termsFor(s)).coverage.event).toBe("UNAVAILABLE_NO_OBLIGATION_IDENTITY");
  });

  it("declares monetary REFUSED on a scenario it refused, rather than reporting a clean zero", () => {
    const s = S.find((x) => x.id === "R19-currency-mismatch")!;
    expect(reconcile(s.e, s.o, termsFor(s)).coverage.monetary).toBe("REFUSED");
  });

  it("an unpriced expectation yields NO residual and raises the unpriced count", () => {
    const s = S.find((x) => x.id === "R20-unknown-amount-billed")!;
    const r = reconcile(s.e, s.o, termsFor(s));
    expect(r.units[0]!.state).toBe("NO_RESIDUAL_UNPRICED");
    expect(r.units[0]!.residualMinor).toBeNull();
    expect(r.unpricedExpectationCount).toBe(1);
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.grossNegativeMinor).toBe(0); // and NOT -7500 read as over-billing
  });
});

describe("pure core · SCORED against the frozen benchmark", () => {
  const enabled = S.filter((s) => s.representationEnabled);
  const disabled = S.filter((s) => !s.representationEnabled);
  const pick = (ids: readonly string[]) => realReadings().filter((r) => ids.includes(r.scenarioId));

  it("the mandatory target holds on the ENABLED population · FALSE POSITIVE MONEY = $0", () => {
    const board = score(enabled, pick(enabled.map((s) => s.id)));
    expect(board.falsePositiveMinor).toBe(0);
    expect(board.doubleCountedUnionMinor).toBe(0);
    // And it beats the do-nothing baseline on real money, which is the point of running it at all.
    const baseline = score(enabled, doNothingReconciler(enabled));
    expect(board.truePositiveMinor).toBeGreaterThan(baseline.truePositiveMinor);
    expect(board.monetaryPrecision).toBe(1);
  });

  it("the DISABLED twins produce false positives — the proof each lifecycle field is required", () => {
    const board = score(disabled, pick(disabled.map((s) => s.id)));
    // This is a FEATURE of the fixture. The omitted representation is what manufactures the money.
    expect(board.falsePositiveMinor).toBeGreaterThan(0);
  });

  it("reports the blind case as an HONEST false negative, with the denominator intact", () => {
    const blind = S.filter((s) => s.id === "R06-duplicate-masks-missing");
    const board = score(blind, pick(["R06-duplicate-masks-missing"]));
    expect(board.knownGroundTruthPositiveMinor).toBe(10_000);
    expect(board.detectedPositiveMinor).toBe(0);
    expect(board.falseNegativeMinor).toBe(10_000);
    expect(board.aBlindByConstructionMinor).toBe(10_000);
    expect(board.monetaryRecall).toBe(0);
  });
});
