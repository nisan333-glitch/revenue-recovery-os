// FALSIFIERS FOR THE OBLIGATION-REFERENCE COUNTERFACTUAL.
//
// Pinned before the frozen variant was scored, and both directions bite. A rule that only ever
// releases money is a recall optimiser; a rule that only ever refuses is indistinguishable from a
// broken detector. So the suite proves BOTH: the money the reference genuinely unlocks, and the money
// it must NOT be allowed to unlock.
//
// The three cases that carry the argument are M05, M07 and M08. Under obligation identity all three
// are the same shape — a surplus somewhere, a shortfall somewhere, one obligation cited more than once
// — and the correct answers are different. A design that cannot tell them apart fabricates money.
//
// Full treatment in docs/OBLIGATION_REF_COUNTERFACTUAL_V1.md.
import { describe, it, expect } from "vitest";
import type { ExpectationRow } from "./reconciliationScenarios";
import type { GovernedReconciliationTerms } from "./reconciliationCore";
import { GRAIN_CANDIDATES } from "./grainCandidates";
import {
  reconcileWithObligationIdentity, type ObligationObservationRow,
} from "./obligationAwareReconciliation";

const TERMS: GovernedReconciliationTerms = Object.freeze({
  currency: "USD",
  invoicingGracePeriods: 1,
  payerHierarchy: Object.freeze({}),
  identityAliases: Object.freeze({}),
});

const P = (m: string) => ({ periodStart: `2026-${m}-01`, periodEnd: `2026-${m}-28` });

/** One expected obligation. `obligation` is the schedule line, which is what billing will cite. */
const owe = (ent: string, month: string, minor: number | null, obligation?: string, over: Partial<ExpectationRow> = {}): ExpectationRow =>
  Object.freeze({
    entitlementRef: ent, customerRef: `payer-${ent}`, ...P(month),
    expectedAmountMinor: minor, currency: "USD",
    terminatedAt: null, pauseStart: null, pauseEnd: null, amendedAt: null,
    supersedesRef: null, scheduleLineRef: obligation ?? `${ent}-${month}`, ...over,
  }) as ExpectationRow;

/** One settlement. `settles` is the obligation billing says it settles; null means not stated. */
const paid = (ent: string, month: string, minor: number, settles: string | null | undefined, over: Partial<ObligationObservationRow> = {}): ObligationObservationRow =>
  Object.freeze({
    invoiceRef: `inv-${ent}-${month}-${minor}`, entitlementRef: ent, customerRef: `payer-${ent}`,
    ...P(month), billedAmountMinor: minor, currency: "USD", isCredit: false,
    obligationRef: settles === undefined ? `${ent}-${month}` : settles, ...over,
  }) as ObligationObservationRow;

const look = (es: ExpectationRow[], os: ObligationObservationRow[]) => {
  const r = reconcileWithObligationIdentity(es, os, TERMS);
  const of = (ent: string, month: string) => {
    const u = r.units.find((x) => x.entitlementRef === ent && x.periodStart === `2026-${month}-01`)!;
    return { state: u.state, residual: u.residualMinor, paired: u.pairedWith?.mechanism ?? null };
  };
  return { r, of, headline: r.unpairedPositiveMinor, held: r.pairedPositiveMinor, gross: r.grossPositiveMinor };
};

// ── THE M07 SHAPE · February settled twice, March never ──────────────────────────────────────────
//
// Same entitlement, adjacent periods. Without the references the core pairs them and holds March's
// money out, which is correct caution: the February surplus COULD be an early settlement of March.
const m07 = () => ({
  es: [owe("e1", "02", 10_000), owe("e1", "03", 10_000)],
  os: [paid("e1", "02", 10_000, "e1-02"), paid("e1", "02", 10_000, "e1-02")],
});

describe("1 · the money obligation identity genuinely unlocks", () => {
  it("releases March once the references prove February's surplus settles February", () => {
    const { of, headline, held, r } = look(...Object.values(m07()) as [never, never]);
    expect(of("e1", "03")).toEqual({ state: "UNDER_BILLED", residual: 10_000, paired: null });
    expect(headline).toBe(10_000);
    expect(held).toBe(0);
    expect(r.refutedPairings).toHaveLength(1);
    expect(r.refutedPairings[0]!.releasedMinor).toBe(10_000);
    expect(r.refutedPairings[0]!.because).toContain("no settlement anywhere names e1-03");
  });

  it("and WITHOUT the references the same data is held out — the fact moved the money, not the code", () => {
    // Every reference blanked. The module must collapse to the core's answer: paired, held out.
    const { es, os } = m07();
    const { of, headline, held } = look(es, os.map((o) => ({ ...o, obligationRef: null })));
    expect(of("e1", "03")).toEqual({ state: "UNDER_BILLED", residual: 10_000, paired: "ADJACENT_PERIOD_SAME_ENTITLEMENT" });
    expect(headline).toBe(0);
    expect(held).toBe(10_000);
  });

  it("refutation MOVES money between columns and never creates any", () => {
    const withRefs = look(...Object.values(m07()) as [never, never]);
    const { es, os } = m07();
    const without = look(es, os.map((o) => ({ ...o, obligationRef: null })));
    expect(withRefs.gross).toBe(without.gross); // the invariant the roll-up comment claims
    expect(withRefs.headline + withRefs.held).toBe(without.headline + without.held);
  });

  it("the pairing STANDS when the surplus line names the deficit's own obligation", () => {
    // A genuinely mis-dated invoice: raised in February, settling MARCH's obligation. The displacement
    // hypothesis is now supported by the reference rather than refuted by it, so the money stays held.
    const { of, headline } = look(
      [owe("e1", "02", 10_000), owe("e1", "03", 10_000)],
      [paid("e1", "02", 10_000, "e1-02"), paid("e1", "02", 10_000, "e1-03")],
    );
    expect(of("e1", "03").paired).toBe("ADJACENT_PERIOD_SAME_ENTITLEMENT");
    expect(headline).toBe(0);
  });
});

// ── THE FALSIFIERS THAT MATTER · money that must NOT move ────────────────────────────────────────
describe("2 · the money obligation identity must NOT unlock", () => {
  it("M05 · two lines settling one obligation and summing correctly is NOT a duplicate", () => {
    const { of, headline, held, r } = look(
      [owe("e1", "02", 10_000)],
      [paid("e1", "02", 5_000, "e1-02"), paid("e1", "02", 5_000, "e1-02")],
    );
    expect(of("e1", "02").state).toBe("MONETARILY_BALANCED");
    expect(headline).toBe(0);
    expect(held).toBe(0);
    // It IS reported — as an observation, with the missing fact named, and never as a duplicate.
    const ev = r.obligationEvents.find((e) => e.obligationRef === "e1-02")!;
    expect(ev.kind).toBe("MULTIPLE_SETTLEMENTS_OBSERVED");
    expect(ev.settlementCount).toBe(2);
    expect(ev.missingFactForStrongerClaim).toContain("EXPECTED SETTLEMENT COUNT");
  });

  it("M08 · a SIBLING-relation pairing is not refutable by obligation identity", () => {
    // The declared semantics: billing's reference names where billing PUT the money, so on a
    // misallocation it agrees with the wrong account and testifies to nothing. Releasing this would
    // claim $27.98 the company was already paid.
    const terms: GovernedReconciliationTerms = { ...TERMS, payerHierarchy: Object.freeze({}) };
    const es = [owe("e1", "03", 10_000), owe("sib", "03", 10_000)];
    const os = [
      paid("e1", "03", 10_000, "sib-03", { entitlementRef: "sib" }), // billing allocated it to the sibling
      paid("sib", "03", 10_000, "sib-03"),
    ];
    // Same payer on both, so the core's sibling mechanism is reachable.
    const same = es.map((e) => ({ ...e, customerRef: "payer-1" }));
    const sameO = os.map((o) => ({ ...o, customerRef: "payer-1" }));
    const r = reconcileWithObligationIdentity(same, sameO, terms);
    const u = r.units.find((x) => x.entitlementRef === "e1")!;
    expect(u.state).toBe("UNDER_BILLED");
    expect(u.pairedWith?.mechanism).toBe("SIBLING_ENTITLEMENT_SAME_PAYER");
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.refutedPairings).toHaveLength(0);
  });

  it("M17 · billing-side identity does not cure CONTRACT-side ambiguity", () => {
    // Two live lines claim one entitlement-period with no supersession. Billing settling one of them
    // establishes nothing about whether the other is a real additive obligation.
    const { of, headline } = look(
      [owe("e1", "03", 10_000, "e1-03"), owe("e1", "03", 6_000, "e1-03-DUP")],
      [paid("e1", "03", 10_000, "e1-03")],
    );
    expect(of("e1", "03").state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
    expect(of("e1", "03").residual).toBeNull();
    expect(headline).toBe(0);
  });

  it("M16 · an UNKNOWN expected amount stays UNKNOWN", () => {
    const { of, headline } = look([owe("e1", "03", null)], [paid("e1", "03", 10_000, "e1-03")]);
    expect(of("e1", "03").state).toBe("NO_RESIDUAL_UNPRICED");
    expect(headline).toBe(0);
  });

  it("M19 · a currency mismatch still refuses before any of this is reached", () => {
    const { of } = look(
      [owe("e1", "03", 10_000, "e1-03", { currency: "EUR" } as Partial<ExpectationRow>)],
      [paid("e1", "03", 10_000, "e1-03")],
    );
    expect(of("e1", "03").state).toBe("REFUSED_CURRENCY_MISMATCH");
  });

  it("M18 · an unrelated payer's surplus is not reachable, with or without references", () => {
    const { of, headline } = look(
      [owe("e1", "03", 10_000), owe("stranger", "03", 10_000)],
      [paid("stranger", "03", 20_000, "stranger-03")],
    );
    // e1 is unbilled and the stranger is over-billed: no mechanism links them, so the money is a real
    // unpaired positive rather than a pairing to refute.
    expect(of("e1", "03")).toEqual({ state: "UNDER_BILLED", residual: 10_000, paired: null });
    expect(headline).toBe(10_000);
  });
});

// ── THE IDENTITY CAPABILITY · refs subsume the alias map ─────────────────────────────────────────
describe("3 · identity resolved from the source's own reference", () => {
  // A re-key changes billing's INTERNAL subscription id. It does not change the payer, and the payer
  // is what makes the core's unmatched-identity doubt reachable at all — so the fixture carries the
  // same payer on both sides. The first form of these two tests used the helper's derived payer and
  // the doubt could not reach the unit; the fixture was unrealistic and the core was right.
  const rekeyed = (settles: string | null) => ({
    es: [owe("e1", "03", 10_000)],
    os: [paid("rekeyed-9999", "03", 10_000, settles, { customerRef: "payer-e1" })],
  });

  it("a bare re-key with NO alias map resolves from the obligation reference alone", () => {
    const { es, os } = rekeyed("e1-03"); // billing's internal key changed; the reference did not
    const { of, headline } = look(es, os);
    expect(of("e1", "03").state).toBe("MONETARILY_BALANCED");
    expect(headline).toBe(0);
  });

  it("...and without the reference the same row is unmatched, which is the honest refusal", () => {
    const { es, os } = rekeyed(null);
    const { r } = look(es, os);
    expect(r.units.map((u) => u.state)).toEqual(["REFUSED_UNMATCHED_IDENTITY"]);
    expect(r.unkeyedObservationCount).toBe(1);
  });

  it("a blank reference FAILS CLOSED per row and rejects nothing", () => {
    const { r, headline } = look(
      [owe("e1", "03", 10_000), owe("e2", "03", 10_000)],
      [paid("e1", "03", 10_000, null), paid("e2", "03", 10_000, "e2-03")],
    );
    expect(r.unkeyedObservationCount).toBe(1);
    expect(r.obligationCoverage.obligationIdentity).toBe("PARTIAL_BILLING_SIDE");
    expect(r.units).toHaveLength(2); // both still present — no row was discarded
    expect(headline).toBe(0);
  });

  it("a reference naming no obligation is REPORTED, never silently matched", () => {
    const { r } = look([owe("e1", "03", 10_000)], [paid("e1", "03", 10_000, "ghost-obligation")]);
    const ev = r.obligationEvents.find((e) => e.kind === "SETTLEMENT_CITES_UNKNOWN_OBLIGATION");
    expect(ev?.obligationRef).toBe("ghost-obligation");
  });

  it("coverage is UNAVAILABLE when the billing side is wholly unkeyed — not AVAILABLE from one side", () => {
    const { r } = look([owe("e1", "03", 10_000)], [paid("e1", "03", 10_000, null)]);
    expect(r.obligationCoverage.obligationIdentity).toBe("UNAVAILABLE_BILLING_SIDE_UNKEYED");
    // `coverage.event` once read AVAILABLE here, from the EXPECTATION side alone. It was recorded as a
    // finding and then corrected: an event join needs both sides keyed, and this row names no
    // obligation, so the capability is unavailable and says which half is missing.
    expect(r.coverage.event).toBe("UNAVAILABLE_BILLING_SIDE_UNKEYED");
  });

  it("...and becomes AVAILABLE once BOTH sides are keyed — the upgrade is earned, not assumed", () => {
    const { r } = look([owe("e1", "03", 10_000)], [paid("e1", "03", 10_000, "e1-03")]);
    expect(r.obligationCoverage.obligationIdentity).toBe("AVAILABLE");
    expect(r.coverage.event).toBe("AVAILABLE");
  });

  it("a DANGLING reference does not earn the upgrade — a key that joins to nothing is not a key", () => {
    const { r } = look([owe("e1", "03", 10_000)], [paid("e1", "03", 10_000, "ghost-obligation")]);
    expect(r.coverage.event).toBe("UNAVAILABLE_BILLING_SIDE_UNKEYED");
  });

  it("one unkeyed billing row among keyed ones is enough to withhold it", () => {
    const { r } = look(
      [owe("e1", "03", 10_000), owe("e2", "03", 10_000)],
      [paid("e1", "03", 10_000, "e1-03"), paid("e2", "03", 10_000, null)],
    );
    expect(r.coverage.event).toBe("UNAVAILABLE_BILLING_SIDE_UNKEYED");
  });
});

// ── WHAT MAY NEVER BE SAID, AND WHAT MAY NEVER MOVE ─────────────────────────────────────────────
describe("4 · the claim boundary and the baseline's run surface", () => {
  it("the word duplicate appears in NO event kind this module can emit", () => {
    // Checked on what the module actually returns, not on a literal built here — the lesson from the
    // guards that measured their own fixture.
    const { r } = look(
      [owe("e1", "02", 10_000)],
      [paid("e1", "02", 5_000, "e1-02"), paid("e1", "02", 5_000, "e1-02")],
    );
    expect(r.obligationEvents.length).toBeGreaterThan(0);
    for (const e of r.obligationEvents) expect(e.kind.toLowerCase()).not.toContain("duplicate");
    expect(r.obligationCoverage.duplicateEstablishable).toBe("UNAVAILABLE_NO_EXPECTED_SETTLEMENT_COUNT");
  });

  it("it carries its OWN scheme and version, and names the arithmetic it borrowed", () => {
    const { r } = look([owe("e1", "03", 10_000)], [paid("e1", "03", 10_000, "e1-03")]);
    expect(r.scheme).toBe("nh-obligation-aware-reconciliation-v1");
    expect(r.methodVersion).toBe("oblig-2026.1");
    expect(r.underlyingMethodVersion).toBe("recon-2026.1");
    expect(r.claimBoundary).toEqual({
      observationOnly: true, provesEventCorrectness: false, constitutesProof: false, constitutesRevenue: false,
    });
  });

  it("GUARD · the V3 run surface still holds exactly its five candidates", () => {
    // The V3 freeze lock covers scripts/reconciliation-synthetic and the data files — it does NOT
    // cover src/benchmark. So adding a candidate here would silently change V3's own recorded run and
    // no gate would notice. This test is that gate.
    expect(GRAIN_CANDIDATES.map((c) => c.id)).toEqual([
      "A_SUBSCRIPTION", "B_CONTRACT", "C_SCHEDULE_LINE", "D_PAYER_PERIOD", "E_SUBSCRIPTION_WITH_LEGACY_ALIAS",
    ]);
    const c = GRAIN_CANDIDATES.find((x) => x.id === "C_SCHEDULE_LINE")!;
    // And C is still NOT CONSTRUCTIBLE, which is the premise of this whole experiment: the counterfactual
    // supplies the fact C names as missing, and it supplies it in a SEPARATE package.
    expect(c.notConstructible).toContain("invoice_line_id` is a position WITHIN an invoice");
  });
});
