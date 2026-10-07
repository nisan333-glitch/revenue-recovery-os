// FALSIFIERS FOR THE PAIRING-ORDER CORRECTION.
//
// The defect: the pairing pass scanned negative units and took the FIRST whose amount matched, so when
// two counterparts were reachable the mechanism assigned — and therefore whether the money could ever
// be claimed — followed array position. It was found by a counterfactual, not by a test, because no
// test had ever put two reachable counterparts in front of it.
//
// So the first three tests here are the ones that would have caught it: permute the inputs and assert
// the answer cannot move. Everything else proves the replacement selects on EVIDENCE — and that it
// still refuses where the evidence does not reach, because a rule that only releases money is a recall
// optimiser wearing a principle.
//
// Full treatment in docs/PAIRING_ORDER_V1.md.
import { describe, it, expect } from "vitest";
import type { ExpectationRow } from "./reconciliationScenarios";
import {
  reconcile, selectPairing,
  type GovernedReconciliationTerms, type PairingCandidate, type UnitResult,
} from "./reconciliationCore";
import {
  reconcileWithObligationIdentity, type ObligationObservationRow,
} from "./obligationAwareReconciliation";

const TERMS: GovernedReconciliationTerms = Object.freeze({
  currency: "USD", invoicingGracePeriods: 1,
  payerHierarchy: Object.freeze({}), identityAliases: Object.freeze({}),
});

const P = (m: string) => ({ periodStart: `2026-${m}-01`, periodEnd: `2026-${m}-28` });

const owe = (ent: string, month: string, minor: number | null, payer = `payer-${ent}`): ExpectationRow =>
  Object.freeze({
    entitlementRef: ent, customerRef: payer, ...P(month), expectedAmountMinor: minor, currency: "USD",
    terminatedAt: null, pauseStart: null, pauseEnd: null, amendedAt: null,
    supersedesRef: null, scheduleLineRef: `${ent}-${month}`,
  }) as ExpectationRow;

const paid = (ent: string, month: string, minor: number, settles: string | null | undefined, payer = `payer-${ent}`): ObligationObservationRow =>
  Object.freeze({
    invoiceRef: `inv-${ent}-${month}-${minor}-${Math.random()}`, entitlementRef: ent, customerRef: payer,
    ...P(month), billedAmountMinor: minor, currency: "USD", isCredit: false,
    obligationRef: settles === undefined ? `${ent}-${month}` : settles,
  }) as ObligationObservationRow;

/**
 * THE SHAPE THAT EXPOSED THE DEFECT, reduced to its essentials.
 *
 * Two sibling entitlements of ONE payer at the SAME price. Each has February settled twice and March
 * never settled. So each March shortfall has TWO exact counterparts: its own February (a timing claim)
 * and the sibling's February (a wrong-identity claim, in a different period).
 */
const twoSiblings = (settles: (ent: string, month: string) => string | null) => ({
  es: [owe("eA", "02", 9_800, "payer-1"), owe("eA", "03", 9_800, "payer-1"),
       owe("eB", "02", 9_800, "payer-1"), owe("eB", "03", 9_800, "payer-1")],
  os: [paid("eA", "02", 9_800, settles("eA", "02"), "payer-1"), paid("eA", "02", 9_800, settles("eA", "02"), "payer-1"),
       paid("eB", "02", 9_800, settles("eB", "02"), "payer-1"), paid("eB", "02", 9_800, settles("eB", "02"), "payer-1")],
});
const withRefs = () => twoSiblings((e, m) => `${e}-${m}`);
const withoutRefs = () => twoSiblings(() => null);

const strip = (us: readonly UnitResult[]) => us
  .map((u) => `${u.entitlementRef}|${u.periodStart}|${u.state}|${u.residualMinor}|${u.pairedWith?.mechanism ?? "-"}`)
  .sort();

const look = (es: ExpectationRow[], os: ObligationObservationRow[]) => {
  const r = reconcileWithObligationIdentity(es, os, TERMS);
  const of = (ent: string, month: string) => {
    const u = r.units.find((x) => x.entitlementRef === ent && x.periodStart === `2026-${month}-01`)!;
    return { state: u.state, residual: u.residualMinor, mechanism: u.pairedWith?.mechanism ?? null };
  };
  return { r, of, headline: r.unpairedPositiveMinor, held: r.pairedPositiveMinor, gross: r.grossPositiveMinor };
};

// ── 1-3 · ORDER CANNOT MOVE ANYTHING · the tests that would have caught the defect ───────────────
describe("1 · permuting the inputs cannot change money or mechanism", () => {
  const permutations = <T,>(xs: readonly T[]): T[][] => [
    [...xs], [...xs].reverse(),
    [...xs.slice(2), ...xs.slice(0, 2)], [...xs.slice(1), xs[0]!],
  ];

  it("reversing BILLING row order changes neither money nor mechanism", () => {
    for (const build of [withRefs, withoutRefs]) {
      const { es, os } = build();
      const base = look(es, os);
      for (const perm of permutations(os)) {
        const got = look(es, perm);
        expect(got.headline).toBe(base.headline);
        expect(got.held).toBe(base.held);
        expect(strip(got.r.units)).toEqual(strip(base.r.units));
      }
    }
  });

  it("reversing EXPECTATION row order changes neither money nor mechanism", () => {
    for (const build of [withRefs, withoutRefs]) {
      const { es, os } = build();
      const base = look(es, os);
      for (const perm of permutations(es)) {
        const got = look(perm, os);
        expect(got.headline).toBe(base.headline);
        expect(got.held).toBe(base.held);
        expect(strip(got.r.units)).toEqual(strip(base.r.units));
      }
    }
  });

  it("reversing CANDIDATE enumeration changes neither the verdict nor the mechanism", () => {
    // Straight at the selector: the same candidate set in either order must give the same verdict.
    const cs: PairingCandidate[] = [
      { counterpartUnit: "eA|2026-02-01|2026-02-28", mechanism: "ADJACENT_PERIOD_SAME_ENTITLEMENT", requires: ["TIMING_DISPLACEMENT"] },
      { counterpartUnit: "eB|2026-02-01|2026-02-28", mechanism: "SIBLING_ENTITLEMENT_SAME_PAYER", requires: ["MISALLOCATION", "TIMING_DISPLACEMENT"] },
    ];
    expect(selectPairing(cs)).toEqual(selectPairing([...cs].reverse()));
    expect(selectPairing(cs)!.mechanism).toBe("AMBIGUOUS_MULTIPLE_COUNTERPARTS");
    // ...and with the timing half refuted, BOTH die, in either order.
    const refute = () => ["TIMING_DISPLACEMENT" as const];
    expect(selectPairing(cs, refute)).toBeNull();
    expect(selectPairing([...cs].reverse(), refute)).toBeNull();
  });
});

// ── 4-5 · the M07 shape · both entitlements resolve, and identically ─────────────────────────────
describe("2 · both sibling entitlements resolve the same way", () => {
  it("with the references, BOTH March shortfalls become claimable", () => {
    const { es, os } = withRefs();
    const { of, headline, held } = look(es, os);
    expect(of("eA", "03")).toEqual({ state: "UNDER_BILLED", residual: 9_800, mechanism: null });
    expect(of("eB", "03")).toEqual({ state: "UNDER_BILLED", residual: 9_800, mechanism: null });
    expect(headline).toBe(19_600);
    expect(held).toBe(0);
  });

  it("the two entitlements are treated IDENTICALLY despite one being scanned first", () => {
    // The defect in one line: under the old pass eA's March paired with its own February and eB's
    // paired with eA's, because eA's negative came first. The two were decided by position.
    const { es, os } = withRefs();
    const { of } = look(es, os);
    expect(of("eA", "03")).toEqual(of("eB", "03"));
  });

  it("WITHOUT the references both are HELD, and neither claims a single mechanism", () => {
    const { es, os } = withoutRefs();
    const { of, headline, held } = look(es, os);
    for (const e of ["eA", "eB"]) {
      expect(of(e, "03").mechanism).toBe("AMBIGUOUS_MULTIPLE_COUNTERPARTS");
      expect(of(e, "03").residual).toBe(9_800);
    }
    expect(headline).toBe(0);
    expect(held).toBe(19_600);
  });

  it("gross positive is identical with and without the references — money MOVES, none is created", () => {
    expect(look(...Object.values(withRefs()) as [never, never]).gross)
      .toBe(look(...Object.values(withoutRefs()) as [never, never]).gross);
  });
});

// ── 6-8 · the money that must NOT move ───────────────────────────────────────────────────────────
describe("3 · the protections", () => {
  it("M08 · a SAME-PERIOD sibling misallocation stays held — no fabricated money", () => {
    // Pure misallocation: one claim, and the references cannot testify about it. The hold must survive.
    const es = [owe("eX", "03", 2_798, "payer-1"), owe("eSib", "03", 2_798, "payer-1")];
    const os = [paid("eSib", "03", 2_798, "eSib-03", "payer-1"), paid("eSib", "03", 2_798, "eSib-03", "payer-1")];
    const { of, headline, held } = look(es, os);
    expect(of("eX", "03").mechanism).toBe("SIBLING_ENTITLEMENT_SAME_PAYER");
    expect(headline).toBe(0);
    expect(held).toBe(2_798);
  });

  it("M05 · a legitimate split settlement is still $0 and still not a duplicate", () => {
    const { of, headline, r } = look(
      [owe("e1", "02", 10_000)],
      [paid("e1", "02", 5_000, "e1-02"), paid("e1", "02", 5_000, "e1-02")],
    );
    expect(of("e1", "02").state).toBe("MONETARILY_BALANCED");
    expect(headline).toBe(0);
    for (const e of r.obligationEvents) expect(e.kind.toLowerCase()).not.toContain("duplicate");
  });

  it("M18 · an unrelated payer's surplus is not a candidate at all", () => {
    const { of, headline, r } = look(
      [owe("e1", "03", 10_000, "payer-1"), owe("stranger", "03", 10_000, "payer-9")],
      [paid("stranger", "03", 20_000, "stranger-03", "payer-9")],
    );
    expect(of("e1", "03")).toEqual({ state: "UNDER_BILLED", residual: 10_000, mechanism: null });
    expect(headline).toBe(10_000);
    const u = r.units.find((x) => x.entitlementRef === "e1")!;
    expect(u.pairingCandidates).toHaveLength(0); // enumerated and found empty, not silently skipped
  });
});

// ── 9-10 · identity still comes only from authoritative evidence ─────────────────────────────────
describe("4 · identity resolution is unchanged and still evidence-only", () => {
  it("a re-key resolves from the reference, and refuses without it", () => {
    const es = [owe("e1", "03", 10_000, "payer-1")];
    const resolved = look(es, [paid("rekey-9", "03", 10_000, "e1-03", "payer-1")]);
    expect(resolved.of("e1", "03").state).toBe("MONETARILY_BALANCED");
    const refused = look(es, [paid("rekey-9", "03", 10_000, null, "payer-1")]);
    expect(refused.r.units.map((u) => u.state)).toEqual(["REFUSED_UNMATCHED_IDENTITY"]);
  });

  it("a migration resolves from the SUPPLIED alias with no references at all", () => {
    const terms: GovernedReconciliationTerms = { ...TERMS, identityAliases: Object.freeze({ "new-key": "e1" }) };
    const r = reconcile([owe("e1", "03", 10_000, "payer-1")], [{
      invoiceRef: "i1", entitlementRef: "new-key", customerRef: "payer-1", ...P("03"),
      billedAmountMinor: 10_000, currency: "USD", isCredit: false,
    }], terms);
    expect(r.units.map((u) => u.state)).toEqual(["MONETARILY_BALANCED"]);
  });
});

// ── 11-13 · ambiguity appears and disappears with the FACT, and only locally ──────────────────────
describe("5 · ambiguity tracks the evidence, in both directions", () => {
  it("two equally plausible counterparts with different mechanisms produce AMBIGUOUS, never a pick", () => {
    const { of } = look(...Object.values(withoutRefs()) as [never, never]);
    expect(of("eA", "03").mechanism).toBe("AMBIGUOUS_MULTIPLE_COUNTERPARTS");
  });

  it("REMOVING the distinguishing fact restores the ambiguity", () => {
    const before = look(...Object.values(withRefs()) as [never, never]);
    const after = look(...Object.values(withoutRefs()) as [never, never]);
    expect(before.headline).toBe(19_600);
    expect(after.headline).toBe(0);
    expect(after.of("eA", "03").mechanism).toBe("AMBIGUOUS_MULTIPLE_COUNTERPARTS");
  });

  it("ADDING the fact resolves only the affected units and disturbs nothing else", () => {
    // One extra, unrelated, correctly-billed entitlement must read identically either way.
    const extra = owe("eC", "03", 4_200, "payer-7");
    const extraPaid = (settles: string | null) => paid("eC", "03", 4_200, settles, "payer-7");
    const a = withoutRefs(); const b = withRefs();
    const no = look([...a.es, extra], [...a.os, extraPaid(null)]);
    const yes = look([...b.es, extra], [...b.os, extraPaid("eC-03")]);
    const eC = (x: typeof no) => x.r.units.find((u) => u.entitlementRef === "eC")!;
    expect(eC(no).state).toBe("MONETARILY_BALANCED");
    expect(eC(yes).state).toBe("MONETARILY_BALANCED");
    expect(eC(no).residualMinor).toBe(eC(yes).residualMinor);
    // ...while the affected units DID move, so the test is not passing vacuously.
    expect(yes.headline - no.headline).toBe(19_600);
  });

  it("the ambiguous verdict NAMES every surviving counterpart, sorted for reporting only", () => {
    const { r } = look(...Object.values(withoutRefs()) as [never, never]);
    const u = r.units.find((x) => x.entitlementRef === "eA" && x.periodStart === "2026-03-01")!;
    expect(u.pairedWith!.ambiguousWith).toEqual([
      "eA|2026-02-01|2026-02-28", "eB|2026-02-01|2026-02-28",
    ]);
    expect(u.pairingCandidates).toHaveLength(2);
  });
});

// ── 14 · no first-match remains in the monetary pairing path ─────────────────────────────────────
describe("6 · the defect cannot come back", () => {
  it("the pairing pass enumerates with no early exit, checked on CODE", () => {
    // Behaviour cannot prove the absence of a shortcut that today's data never reaches, so this reads
    // the source — with comments AND string literals stripped, because both legitimately discuss the
    // defect by name and a guard that reads prose measures documentation.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const raw = fs.readFileSync(path.resolve(__dirname, "reconciliationCore.ts"), "utf8");
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const pass = code.slice(code.indexOf("const units = draft.map"));
    expect(pass).toContain("selectPairing(candidates)");
    // the old shape: a for-loop over negatives that returns from inside it
    expect(pass).not.toMatch(/for\s*\(\s*const\s+n\s+of\s+negatives/);
    expect(pass).not.toMatch(/\bcontinue\b/);
    // and the selector itself must not tie-break
    const sel = code.slice(code.indexOf("export function selectPairing"));
    expect(sel.slice(0, sel.indexOf("\n}"))).not.toMatch(/\.sort\(\s*\)\s*\[0\]|localeCompare/);
  });

  it("selectPairing pairs ONLY on a single survivor — zero and two both refuse to pick", () => {
    const one: PairingCandidate = { counterpartUnit: "u1", mechanism: "ADJACENT_PERIOD_SAME_ENTITLEMENT", requires: ["TIMING_DISPLACEMENT"] };
    const two: PairingCandidate = { counterpartUnit: "u2", mechanism: "ADJACENT_PERIOD_SAME_ENTITLEMENT", requires: ["TIMING_DISPLACEMENT"] };
    expect(selectPairing([])).toBeNull();
    expect(selectPairing([one])!.counterpartUnit).toBe("u1");
    // SAME mechanism, different counterpart: still ambiguous. "Which one" is an attribution claim too.
    expect(selectPairing([one, two])!.mechanism).toBe("AMBIGUOUS_MULTIPLE_COUNTERPARTS");
  });

  it("a compound claim dies with EITHER half, never survives on the half that holds", () => {
    const compound: PairingCandidate = {
      counterpartUnit: "u1", mechanism: "SIBLING_ENTITLEMENT_SAME_PAYER",
      requires: ["MISALLOCATION", "TIMING_DISPLACEMENT"],
    };
    expect(selectPairing([compound], () => ["TIMING_DISPLACEMENT"])).toBeNull();
    expect(selectPairing([compound], () => ["MISALLOCATION"])).toBeNull();
    expect(selectPairing([compound], () => [])!.mechanism).toBe("SIBLING_ENTITLEMENT_SAME_PAYER");
  });
});
