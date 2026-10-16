// AMBIGUOUS LIVE EXPECTATION LINES · falsifiers written BEFORE the core changes.
//
// THE SEMANTIC UNDER TEST (docs/AMBIGUOUS_LINES_V1.md): when more than one LIVE expectation line
// occupies one reconciliation unit, NH may add them ONLY where the source establishes that they are
// DISTINCT ADDITIVE obligations. Nothing about their co-location establishes it.
//
// Eight shapes can put two live lines in one unit and only two are additive — split schedule lines and
// additive component lines. The other six (duplicate export row, mutually exclusive alternatives,
// migration duplicate, unlinked amendment, overlapping periods, supersession) are NOT additive, and
// they are INDISTINGUISHABLE from the additive two without an authoritative fact. So the default is a
// refusal, and addition is unlocked only by a supplied component identity.
//
// BOTH DIRECTIONS BITE, because only one of them is tempting:
//   FALSE AGGREGATION — summing lines whose distinctness nobody stated, inventing money.
//   FALSE REFUSAL     — refusing lines whose distinctness the source DID state, hiding real money.
import { describe, it, expect } from "vitest";
import type { ExpectationRow, ObservationRow } from "./reconciliationScenarios";
import { reconcile, type GovernedReconciliationTerms } from "./reconciliationCore";

const TERMS: GovernedReconciliationTerms = {
  currency: "USD", invoicingGracePeriods: 1, payerHierarchy: {}, identityAliases: {},
};
const withTerms = (over: Partial<GovernedReconciliationTerms>): GovernedReconciliationTerms =>
  ({ ...TERMS, ...over });

const MARCH = { periodStart: "2026-03-01", periodEnd: "2026-03-28" };

const line = (
  ent: string, amount: number | null, scheduleLineRef: string | null, over: Partial<ExpectationRow> = {},
): ExpectationRow => Object.freeze({
  entitlementRef: ent, customerRef: `payer-${ent}`, ...MARCH, expectedAmountMinor: amount,
  currency: "USD", terminatedAt: null, pauseStart: null, pauseEnd: null, amendedAt: null,
  supersedesRef: null, scheduleLineRef, ...over,
});

const billed = (ent: string, amount: number): ObservationRow => Object.freeze({
  invoiceRef: `inv-${ent}`, entitlementRef: ent, customerRef: `payer-${ent}`, ...MARCH,
  billedAmountMinor: amount, currency: "USD", isCredit: false,
});

const unit = (e: readonly ExpectationRow[], o: readonly ObservationRow[], t = TERMS, ent = "ent-A") => {
  const r = reconcile(e, o, t);
  const u = r.units.find((x) => x.entitlementRef === ent)!;
  return { state: u.state, residual: u.residualMinor, expected: u.expectedMinor, unpaired: r.unpairedPositiveMinor };
};

describe("ambiguous live lines · FALSE AGGREGATION must not happen", () => {
  it("1 · two ambiguous live lines are refused, never summed", () => {
    // $299.00 and $179.40 both claiming March, one $299.00 invoice. Summing gives $478.40 and a
    // residual of $179.40 — an amount NEITHER LINE ASSERTS. This is the frozen package's M17.
    const got = unit([line("ent-A", 29_900, "sl-1"), line("ent-A", 17_940, "sl-2")], [billed("ent-A", 29_900)]);
    expect(got.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
    expect(got.residual).toBeNull();
    expect(got.expected).toBeNull(); // not a figure anyone can act on, so not a figure at all
    expect(got.unpaired).toBe(0);
  });

  it("5 · a DUPLICATE expectation row creates no money", () => {
    // The same obligation exported twice. Summing doubles a real obligation and invents the second
    // half. Distinct schedule-line ids do NOT make them distinct obligations — a duplicated export row
    // has two ids for one obligation, which is exactly why row identity cannot settle this.
    const got = unit([line("ent-A", 29_900, "sl-1"), line("ent-A", 29_900, "sl-2")], [billed("ent-A", 29_900)]);
    expect(got.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
    expect(got.unpaired).toBe(0);
  });

  it("6 · a MIGRATION duplicate creates no money", () => {
    // One obligation carried under both its old and new schedule-line id after a migration.
    const got = unit(
      [line("ent-A", 29_900, "sl-legacy-1"), line("ent-A", 29_900, "sl-v2-1")],
      [billed("ent-A", 29_900)],
    );
    expect(got.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });

  it("9 · ambiguity is NOT resolved by amount similarity", () => {
    // Equal amounts refuse, and so do unequal ones. Amount is the most tempting discriminator and the
    // most dangerous: two unrelated obligations on one plan price are identical in amount.
    const equal = unit([line("ent-A", 29_900, "sl-1"), line("ent-A", 29_900, "sl-2")], [billed("ent-A", 29_900)]);
    const unequal = unit([line("ent-A", 29_900, "sl-1"), line("ent-A", 17_940, "sl-2")], [billed("ent-A", 29_900)]);
    expect(equal.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
    expect(unequal.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });

  it("10 · ambiguity is NOT resolved by row order", () => {
    // Reversing the two lines must give the identical verdict. Order is the file author's lever, and
    // the pilot-dataset collision rule already forbids letting file position decide anything.
    const a = line("ent-A", 29_900, "sl-1");
    const b = line("ent-A", 17_940, "sl-2");
    const forward = unit([a, b], [billed("ent-A", 29_900)]);
    const reverse = unit([b, a], [billed("ent-A", 29_900)]);
    expect(forward).toEqual(reverse);
    expect(forward.state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });

  it("11 · REMOVING authoritative distinctness turns exact money into a refusal", () => {
    // The same two rows, with and without the supplied component map. The money is identical data; only
    // the authoritative fact differs, and that is what decides whether a figure exists.
    const lines = [line("ent-A", 20_000, "sl-base"), line("ent-A", 9_900, "sl-overage")];
    const obs = [billed("ent-A", 20_000)];
    const withFact = withTerms({ additiveLineComponents: { "sl-base": "BASE", "sl-overage": "OVERAGE" } });
    expect(unit(lines, obs, withFact).residual).toBe(9_900);
    expect(unit(lines, obs, TERMS).state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });
});

describe("ambiguous live lines · FALSE REFUSAL must not happen either", () => {
  it("2 · two SOURCE-PROVEN additive components ARE summed", () => {
    // A base fee and an overage line are genuinely two obligations, and the source says so by naming
    // distinct components. Refusing here would hide $99.00 of real unbilled money.
    const t = withTerms({ additiveLineComponents: { "sl-base": "BASE", "sl-overage": "OVERAGE" } });
    const got = unit([line("ent-A", 20_000, "sl-base"), line("ent-A", 9_900, "sl-overage")], [billed("ent-A", 20_000)], t);
    expect(got.state).toBe("UNDER_BILLED");
    expect(got.expected).toBe(29_900);
    expect(got.residual).toBe(9_900);
  });

  it("2b · the SAME component twice is still ambiguous — distinctness means DIFFERENT", () => {
    // Two lines both declared BASE are not two obligations; they are one obligation twice. A map that
    // merely mentions both lines must not unlock addition.
    const t = withTerms({ additiveLineComponents: { "sl-1": "BASE", "sl-2": "BASE" } });
    expect(unit([line("ent-A", 29_900, "sl-1"), line("ent-A", 29_900, "sl-2")], [billed("ent-A", 29_900)], t).state)
      .toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });

  it("2c · a PARTIAL component map does not unlock addition", () => {
    // One line declared, the other not. Addition requires every line to carry a distinct stated
    // component; a half-answer is not an answer.
    const t = withTerms({ additiveLineComponents: { "sl-base": "BASE" } });
    expect(unit([line("ent-A", 20_000, "sl-base"), line("ent-A", 9_900, "sl-overage")], [billed("ent-A", 20_000)], t).state)
      .toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
  });

  it("3 · a superseded line contributes no money, and leaves no ambiguity", () => {
    // Supersession already collapses the pair, so only ONE line is live and the unit is unambiguous.
    // Pinned against regression: the ambiguity rule must not fire on a correctly linked amendment.
    const old = line("ent-A", 29_900, "sl-old");
    const amended = line("ent-A", 17_940, "sl-new", { amendedAt: "2026-02-20", supersedesRef: "sl-old" });
    const got = unit([old, amended], [billed("ent-A", 17_940)]);
    expect(got.state).toBe("MONETARILY_BALANCED");
    expect(got.expected).toBe(17_940); // the amendment's figure, not the sum
  });

  it("4 · a linked amendment does not double-count old + new", () => {
    const old = line("ent-A", 29_900, "sl-old");
    const amended = line("ent-A", 38_870, "sl-new", { amendedAt: "2026-02-20", supersedesRef: "sl-old" });
    const got = unit([old, amended], [billed("ent-A", 29_900)]);
    expect(got.state).toBe("UNDER_BILLED");
    expect(got.expected).toBe(38_870); // NOT 29_900 + 38_870
    expect(got.residual).toBe(8_970);
  });

  it("12 · ADDING authoritative distinctness restores exact money and disturbs no other unit", () => {
    // A second, unrelated, single-line entitlement must read identically before and after the component
    // map appears. A fact about one unit must not reach another.
    const lines = [
      line("ent-A", 20_000, "sl-base"), line("ent-A", 9_900, "sl-overage"),
      line("ent-B", 50_000, "sl-b"),
    ];
    const obs = [billed("ent-A", 20_000), billed("ent-B", 30_000)];
    const t = withTerms({ additiveLineComponents: { "sl-base": "BASE", "sl-overage": "OVERAGE" } });
    const verdict = (u: ReturnType<typeof unit>) => ({ state: u.state, expected: u.expected, residual: u.residual });
    // ent-B's OWN verdict is identical before and after. The first form of this check compared the
    // helper's whole return value, which carries the DATASET-level unpaired total — so it folded ent-A's
    // money into ent-B's comparison and failed on correct behaviour. A per-unit claim needs per-unit
    // fields.
    expect(verdict(unit(lines, obs, TERMS, "ent-B"))).toEqual(verdict(unit(lines, obs, t, "ent-B")));
    expect(unit(lines, obs, t, "ent-B").state).toBe("UNDER_BILLED");
    expect(unit(lines, obs, t, "ent-B").residual).toBe(20_000);
    // ...and ent-A's money appears only once the fact does, moving the dataset total by exactly it.
    expect(unit(lines, obs, TERMS, "ent-A").state).toBe("REFUSED_AMBIGUOUS_LIVE_LINES");
    expect(unit(lines, obs, TERMS, "ent-A").unpaired).toBe(20_000); // ent-B alone
    expect(unit(lines, obs, t, "ent-A").residual).toBe(9_900);
    expect(unit(lines, obs, t, "ent-A").unpaired).toBe(29_900); // ent-B + ent-A's overage
  });
});

describe("ambiguous live lines · the other guards are untouched", () => {
  it("7 · two unrelated obligations do not collapse merely because payer and period match", () => {
    // Same payer, same period, different entitlements: two units, each reconciled on its own. The
    // ambiguity rule is about lines within ONE unit and must not reach across units.
    const a = line("ent-A", 29_900, "sl-a", { customerRef: "payer-shared" });
    const b = line("ent-B", 29_900, "sl-b", { customerRef: "payer-shared" });
    const r = reconcile([a, b], [{ ...billed("ent-A", 29_900), customerRef: "payer-shared" }], TERMS);
    expect(r.units).toHaveLength(2);
    expect(r.units.find((u) => u.entitlementRef === "ent-A")!.state).toBe("MONETARILY_BALANCED");
    expect(r.units.find((u) => u.entitlementRef === "ent-B")!.state).toBe("UNDER_BILLED");
    expect(r.unpairedPositiveMinor).toBe(29_900);
  });

  it("8 · an UNKNOWN amount stays UNKNOWN, ambiguity or not", () => {
    // Unpriced outranks ambiguous: both are refusals of a figure, and the unpriced reason is the more
    // specific truth about why no residual exists.
    const got = unit([line("ent-A", null, "sl-1"), line("ent-A", 29_900, "sl-2")], [billed("ent-A", 29_900)]);
    expect(["NO_RESIDUAL_UNPRICED", "REFUSED_AMBIGUOUS_LIVE_LINES"]).toContain(got.state);
    expect(got.residual).toBeNull();
    expect(got.unpaired).toBe(0);
  });
});
