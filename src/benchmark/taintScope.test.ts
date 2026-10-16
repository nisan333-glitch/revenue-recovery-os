// ADVERSARIAL TESTS FOR THE TAINT SCOPE · written BEFORE the core changes, so they must fail against
// the dataset-global rule and pass only against a causally-scoped one.
//
// THE RULE UNDER TEST (docs/TAINT_SCOPE_V1.md): an unmatched observation taints a unit's positive
// residual only where authoritative facts make SETTLEMENT between them possible — same payer or a
// SUPPLIED hierarchy, the same period or inside the governed window, and the governed currency.
//
// BOTH DIRECTIONS ARE PINNED, because only one of them is tempting. An over-broad taint refuses money
// that is really owed; an under-broad taint reports money that an unmatched invoice may already have
// settled. A test suite that only chased recall would catch the first and license the second.
import { describe, it, expect } from "vitest";
import type { ExpectationRow, ObservationRow } from "./reconciliationScenarios";
import { reconcile, type GovernedReconciliationTerms } from "./reconciliationCore";

const TERMS: GovernedReconciliationTerms = {
  currency: "USD", invoicingGracePeriods: 1, payerHierarchy: {}, identityAliases: {},
};
const withTerms = (over: Partial<GovernedReconciliationTerms>): GovernedReconciliationTerms =>
  ({ ...TERMS, ...over });

const month = (m: string) => ({ periodStart: `2026-${m}-01`, periodEnd: `2026-${m}-28` });

const exp = (ent: string, payer: string, m: string, amount: number | null = 10_000): ExpectationRow =>
  Object.freeze({
    entitlementRef: ent, customerRef: payer, ...month(m), expectedAmountMinor: amount,
    currency: "USD", terminatedAt: null, pauseStart: null, pauseEnd: null, amendedAt: null,
    supersedesRef: null, scheduleLineRef: null,
  });

const obs = (
  inv: string, ent: string, payer: string, m: string, amount = 10_000, currency = "USD",
): ObservationRow => Object.freeze({
  invoiceRef: inv, entitlementRef: ent, customerRef: payer, ...month(m),
  billedAmountMinor: amount, currency, isCredit: false,
});

const stateOf = (
  e: readonly ExpectationRow[], o: readonly ObservationRow[], t = TERMS, ent?: string,
) => {
  const r = reconcile(e, o, t);
  const u = ent ? r.units.find((x) => x.entitlementRef === ent)! : r.units[0]!;
  return { state: u.state, residual: u.residualMinor, unpaired: r.unpairedPositiveMinor };
};

describe("taint scope · OVER-BROAD must not happen", () => {
  it("1 · an unrelated payer's unmatched observation does NOT taint this payer's residual", () => {
    // payer-A owes March and was not billed. payer-B has a stray invoice under a key nobody expects.
    // Nothing authoritative lets payer-B's invoice settle payer-A's obligation: the company billed
    // someone else. The residual is real and must be reported.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-stray", "ent-UNKNOWN-B", "payer-B", "03")];
    const got = stateOf(e, o, TERMS, "ent-A");
    expect(got.state).toBe("UNDER_BILLED");
    expect(got.residual).toBe(10_000);
  });

  it("2 · an unmatched observation in a FAR period does NOT taint this period's residual", () => {
    // Same payer, but September cannot settle a March obligation: timing displacement is governed at
    // one period and this is six.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-late", "ent-UNKNOWN", "payer-A", "09")];
    const got = stateOf(e, o, TERMS, "ent-A");
    expect(got.state).toBe("UNDER_BILLED");
    expect(got.residual).toBe(10_000);
  });

  it("6 · a migration cohort does not globally poison unrelated customers", () => {
    // The scaled version of test 1, and the reason this matters most: a whole-book migration leaves
    // dozens of unmatched observations. Under the dataset-global rule every customer in the file was
    // refused. Here, 20 migrated payers must leave the 21st payer's genuine shortfall reportable.
    const e: ExpectationRow[] = [exp("ent-clean", "payer-clean", "03")];
    const o: ObservationRow[] = [];
    for (let i = 0; i < 20; i += 1) {
      e.push(exp(`ent-mig-${i}`, `payer-mig-${i}`, "03"));
      o.push(obs(`inv-mig-${i}`, `sub-new-${i}`, `payer-mig-${i}`, "03")); // re-keyed, unmatched
    }
    const r = reconcile(e, o, TERMS);
    const clean = r.units.find((u) => u.entitlementRef === "ent-clean")!;
    expect(clean.state).toBe("UNDER_BILLED");
    expect(clean.residualMinor).toBe(10_000);
    // ...and each migrated payer's own unit is still refused, because for THEM settlement is possible.
    expect(r.units.filter((u) => u.state === "REFUSED_UNMATCHED_IDENTITY")).toHaveLength(20);
  });

  it("12 · no false-positive money appears merely because the taint narrowed", () => {
    // A balanced book with one unrelated stray invoice must report ZERO exposure. If narrowing the
    // taint invented money anywhere, it shows up here.
    const e = [exp("ent-1", "payer-1", "03"), exp("ent-2", "payer-2", "03")];
    const o = [obs("inv-1", "ent-1", "payer-1", "03"), obs("inv-2", "ent-2", "payer-2", "03"),
      obs("inv-stray", "ent-UNKNOWN", "payer-99", "03")];
    const r = reconcile(e, o, TERMS);
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.grossPositiveMinor).toBe(0);
  });
});

describe("taint scope · UNDER-BROAD must not happen either", () => {
  it("3 · an unmatched observation that COULD settle the same obligation still refuses", () => {
    // Same payer, same period, governed currency: this invoice really might be that obligation's under
    // another key. Reporting the residual would manufacture money out of a re-key. THIS is the case
    // the dataset-global rule existed to protect, and it must survive the narrowing.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-rekeyed", "sub-new-A", "payer-A", "03")];
    expect(stateOf(e, o, TERMS, "ent-A").state).toBe("REFUSED_UNMATCHED_IDENTITY");
  });

  it("3b · an unmatched observation one period away, INSIDE the governed window, still refuses", () => {
    // Timing displacement is governed at one period, so February can settle March. The window is a
    // supplied term, never a guess — and widening it is a governance act, not a code change.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-early", "sub-new-A", "payer-A", "02")];
    expect(stateOf(e, o, TERMS, "ent-A").state).toBe("REFUSED_UNMATCHED_IDENTITY");
  });

  it("4 · an AUTHORITATIVE re-key alias keeps the relationship live", () => {
    // With the alias supplied the observation MATCHES, so there is nothing floating and nothing to
    // taint — the honest answer is a balanced unit, not a refusal.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-rekeyed", "sub-new-A", "payer-A", "03")];
    const t = withTerms({ identityAliases: { "sub-new-A": "ent-A" } });
    expect(stateOf(e, o, t, "ent-A").state).toBe("MONETARILY_BALANCED");
  });

  it("5 · a MISSING alias fails closed where the ambiguity is real", () => {
    // The same two rows without the alias. NH cannot tell a re-key from an unexpected invoice, and
    // "I cannot tell" is the answer — not a finding, and not a clean zero.
    const e = [exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-rekeyed", "sub-new-A", "payer-A", "03")];
    const got = stateOf(e, o, TERMS, "ent-A");
    expect(got.state).toBe("REFUSED_UNMATCHED_IDENTITY");
    expect(got.residual).toBeNull(); // never 0.00
  });

  it("4b · a SUPPLIED payer hierarchy makes a parent's stray invoice a live counterpart", () => {
    // A parent may legitimately be billed for a child's obligation. That relation must be supplied; it
    // is never inferred from the account ids looking related.
    const e = [exp("ent-child", "payer-child", "03")];
    const o = [obs("inv-parent", "sub-unknown", "payer-parent", "03")];
    const linked = withTerms({ payerHierarchy: { "payer-child": "payer-parent" } });
    expect(stateOf(e, o, linked, "ent-child").state).toBe("REFUSED_UNMATCHED_IDENTITY");
    // ...and WITHOUT the supplied hierarchy the same two rows leave the residual reportable.
    expect(stateOf(e, o, TERMS, "ent-child").state).toBe("UNDER_BILLED");
  });
});

describe("taint scope · every other guard is untouched", () => {
  it("7 · split invoices still reconcile, and an unmatched sibling still refuses", () => {
    const e = [exp("ent-A", "payer-A", "03")];
    const split = [obs("inv-a", "ent-A", "payer-A", "03", 6_000), obs("inv-b", "ent-A", "payer-A", "03", 4_000)];
    expect(stateOf(e, split, TERMS, "ent-A").state).toBe("MONETARILY_BALANCED");
  });

  it("8 · a consolidated invoice allocated per period still reconciles", () => {
    const e = [exp("ent-A", "payer-A", "03"), exp("ent-A", "payer-A", "04")];
    const o = [obs("inv-con", "ent-A", "payer-A", "03"), obs("inv-con", "ent-A", "payer-A", "04")];
    const r = reconcile(e, o, TERMS);
    expect(r.units.every((u) => u.state === "MONETARILY_BALANCED")).toBe(true);
    expect(r.unpairedPositiveMinor).toBe(0);
  });

  it("9 · a duplicate masking an omission stays structurally blind at this grain", () => {
    // February billed twice, March never. The money nets to zero, so no monetary grain can see it —
    // narrowing the taint must not accidentally "find" it, because finding it here would be luck
    // rather than evidence.
    const e = [exp("ent-A", "payer-A", "02"), exp("ent-A", "payer-A", "03")];
    const o = [obs("inv-1", "ent-A", "payer-A", "02"), obs("inv-2", "ent-A", "payer-A", "02")];
    const r = reconcile(e, o, TERMS);
    const march = r.units.find((u) => u.periodStart === "2026-03-01")!;
    const feb = r.units.find((u) => u.periodStart === "2026-02-01")!;
    expect(march.state).toBe("UNDER_BILLED"); // the omission IS visible per-unit
    expect(feb.state).toBe("OVER_BILLED"); // and so is the duplicate
    // What stays invisible is the NET at any coarser grain — and the pairing holds it out of the
    // headline rather than reporting it as found money.
    expect(r.unpairedPositiveMinor).toBe(0);
    expect(r.pairedPositiveMinor).toBe(10_000);
  });

  it("10 · an UNKNOWN amount stays UNKNOWN, taint or no taint", () => {
    const e = [exp("ent-A", "payer-A", "03", null)];
    const o = [obs("inv-stray", "sub-unknown", "payer-A", "03")];
    const got = stateOf(e, o, TERMS, "ent-A");
    expect(got.state).toBe("NO_RESIDUAL_UNPRICED");
    expect(got.residual).toBeNull();
  });

  it("11 · cross-currency stays refused on its OWN grounds, and poisons nothing else", () => {
    const e = [
      Object.freeze({ ...exp("ent-eur", "payer-eur", "03"), currency: "EUR" }),
      exp("ent-usd", "payer-usd", "03"),
    ];
    const o = [obs("inv-eur", "ent-eur", "payer-eur", "03", 10_000, "USD")];
    const r = reconcile(e, o, TERMS);
    expect(r.units.find((u) => u.entitlementRef === "ent-eur")!.state).toBe("REFUSED_CURRENCY_MISMATCH");
    // The USD unit next to it is genuinely unbilled and must still be reported.
    expect(r.units.find((u) => u.entitlementRef === "ent-usd")!.state).toBe("UNDER_BILLED");
  });
});
