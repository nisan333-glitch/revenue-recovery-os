// FALSIFIERS FOR THE MINIMAL PROVENANCE ATTESTATION.
//
// The slice adds one authority rung, so the tests that matter are the ones that would catch it claiming
// more than it has:
//
//   1. WITHOUT an attestation, the answer must be byte-for-byte what it was before. If this fails, the
//      slice has delayed the customer request, which it was explicitly not permitted to do.
//   2. WITH a corroborating attestation, `provisional` must STILL be true. This is the single most
//      important assertion in the file: the rung exists to record care, not to license trust.
//   3. A claim NH cannot check must never lift the rung — asserted by denying all three and watching the
//      rung hold.
//   4. An attestation that CONTRADICTS the files must fail closed and say so, because a contradicted
//      declaration is worse evidence than no declaration at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTATION_EXTRACT_COLUMNS } from "./expectationExtract";
import { validateExpectationExtract, type RawExpectationRow } from "./expectationExtractValidator";
import { BILLING_EXTRACT_COLUMNS } from "./billingExtract";
import { validateBillingExtract, type RawBillingRow } from "./billingExtractValidator";
import { evaluateDataReadiness } from "./dataReadiness";
import {
  ATTESTATION_CLAIMS, EXTRACTION_METHODS, RUNG_BEARING_CLAIMS, corroborateAttestation,
  type ProvenanceAttestation,
} from "./provenanceAttestation";

const E_TERMS = Object.freeze({ currency: "USD", asOf: "2026-06-30" });
const S_TERMS = Object.freeze({ currency: "USD" });
const E_FULL = Object.freeze([...EXPECTATION_EXTRACT_COLUMNS]);
const S_FULL = Object.freeze([...BILLING_EXTRACT_COLUMNS]);

let n = 0;
const owe = (over: Record<string, string> = {}): RawExpectationRow => {
  n += 1;
  return {
    rowNumber: n,
    cells: {
      entitlement_ref: `ent-${n}`, period_start: "2026-03-01", period_end: "2026-03-31",
      expected_amount: "100.00", currency: "USD", payer_ref: "payer-1",
      terminated_at: "", pause_start: "", pause_end: "",
      supersedes_ref: "", amended_at: "", schedule_line_ref: `ob-${n}`,
      ...over,
    },
  };
};
const billed = (obligation: string, over: Record<string, string> = {}): RawBillingRow => {
  n += 1;
  return {
    rowNumber: n,
    cells: {
      invoice_ref: `inv-${n}`, invoice_line_ref: "L1", invoice_raised_at: "2026-03-05",
      invoice_line_amount: "100.00", currency: "USD", payer_ref: "payer-1",
      obligation_ref: obligation, is_credit: "false",
      period_start: "2026-03-01", period_end: "2026-03-31",
      legacy_subscription_ref: "", source_system: "billing-v1",
      ...over,
    },
  };
};

const EXPORT_OK = Object.freeze({
  sourceSystem: "Acme CLM",
  extractionMethod: "direct_query" as const,
  extractionMethodDescription: null,
  extractedAt: "2026-04-01",
  coverageStart: "2026-03-01",
  coverageEnd: "2026-03-31",
  declaredRowCount: 1,
  amountsAndDatesNotReconstructed: true,
  cameFromStatedSystem: true,
});

/** A truthful attestation for the one-row-each pair below. */
const attest = (over: Partial<ProvenanceAttestation> = {}): ProvenanceAttestation => Object.freeze({
  dataOwnerRole: "Revenue Operations",
  expectationExport: EXPORT_OK,
  billingExport: Object.freeze({ ...EXPORT_OK, sourceSystem: "Acme Billing" }),
  pseudonymisation: Object.freeze({
    applied: true, joinPreserving: true, noIdentifierDerivedFromAmountDateOrPosition: true,
  }),
  obligationRefExportedFromSource: true,
  ...over,
});

/** One obligation, one billing line that settles it. Both sides keyed, priced and in window. */
const pair = (eOver: Record<string, string> = {}, bOver: Record<string, string> = {}) => {
  const e = owe(eOver);
  const ob = e.cells.schedule_line_ref!;
  return {
    expectation: validateExpectationExtract(E_FULL, [e], E_TERMS),
    billing: validateBillingExtract(S_FULL, [billed(ob, bOver)], S_TERMS),
    obligation: ob,
  };
};

const outcomeOf = (c: ReturnType<typeof corroborateAttestation>, id: string): string =>
  c.checks.find((x) => x.claimId === id)!.outcome;

describe("1 · the claim catalogue classifies every claim exactly once", () => {
  it("ids are unique and each kind is one of the three", () => {
    const ids = ATTESTATION_CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ATTESTATION_CLAIMS) {
      expect(["CORROBORATED", "WELL_FORMED", "UNCORROBORATED_CLAIM"]).toContain(c.kind);
      expect(c.statement.trim().length).toBeGreaterThan(20);
      expect(c.howNhChecksIt.trim().length).toBeGreaterThan(20);
      expect(c.requirement.trim()).not.toBe("");
    }
  });

  it("an UNCORROBORATED claim is NEVER rung-bearing, and says plainly that nothing is checked", () => {
    for (const c of ATTESTATION_CLAIMS.filter((x) => x.kind === "UNCORROBORATED_CLAIM")) {
      expect(RUNG_BEARING_CLAIMS).not.toContain(c.id);
      expect(c.howNhChecksIt).toMatch(/NOTHING/);
    }
    // ...and at least one of each kind exists, or the classification would be decorative.
    for (const kind of ["CORROBORATED", "WELL_FORMED", "UNCORROBORATED_CLAIM"]) {
      expect(ATTESTATION_CLAIMS.some((c) => c.kind === kind), kind).toBe(true);
    }
  });

  it("three of the six pilot requirements are corroborated and three are not — the honest split", () => {
    const corroborated = ATTESTATION_CLAIMS.filter((c) => c.kind === "CORROBORATED").length;
    const uncorroborated = ATTESTATION_CLAIMS.filter((c) => c.kind === "UNCORROBORATED_CLAIM").length;
    expect(corroborated).toBeGreaterThanOrEqual(3);
    expect(uncorroborated).toBe(3);
  });
});

describe("2 · without an attestation nothing changed — the customer request was never blocked", () => {
  it("the answer is SOURCE_NATIVE, PROVISIONAL, with no attestation block", () => {
    const { expectation, billing } = pair();
    const r = evaluateDataReadiness(expectation, billing);
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.provisional).toBe(true);
    expect(r.attestation).toBeNull();
    expect(r.authority.ceilingReason).toContain("no attestation accompanied the submission");
  });

  it("supplying one changes authority and NOTHING else about the report", () => {
    const a = pair();
    const without = evaluateDataReadiness(a.expectation, a.billing);
    const b = pair();
    const with_ = evaluateDataReadiness(b.expectation, b.billing, {}, attest());
    // Everything that is not authority or the attestation block must be identical. This is the control
    // that proves an attestation cannot move a LEVEL or a CAPABILITY — only how far we vouch for it.
    const strip = (r: typeof without) => JSON.stringify({
      level: r.level, capabilities: r.capabilities, blocked: r.blocked,
      expectation: r.expectation, billing: r.billing, currencyCompatible: r.currencyCompatible,
      danglingObligationRefs: r.danglingObligationRefs, claimBoundary: r.claimBoundary,
    });
    expect(strip(with_)).toBe(strip(without));
    expect(with_.authority.reached).not.toBe(without.authority.reached);
  });
});

describe("3 · a corroborating attestation reaches SOURCE_ATTESTED and stays PROVISIONAL", () => {
  it("THE ASSERTION THAT MATTERS MOST: the rung rises and provisional does not fall", () => {
    const { expectation, billing } = pair();
    const r = evaluateDataReadiness(expectation, billing, {}, attest());
    expect(r.authority.reached).toBe("SOURCE_ATTESTED");
    // `provisional` is `reached !== "AUTHORITY_VERIFIED"`, so a rung BELOW it cannot un-provisionalise
    // anything. If this ever fails, the rung was inserted in the wrong place.
    expect(r.provisional).toBe(true);
    expect(r.authority.ceilingReason).toContain("Authority is still UNVERIFIED");
    expect(r.authority.ceilingReason).toContain("Revenue Operations");
    expect(r.authority.wouldBeLiftedBy).not.toContain("DATA_OWNER_ATTESTATION");
  });

  it("the report names the accountable role and lists the claims it did NOT check", () => {
    const { expectation, billing } = pair();
    const r = evaluateDataReadiness(expectation, billing, {}, attest());
    expect(r.attestation!.dataOwnerRole).toBe("Revenue Operations");
    expect(r.attestation!.contradictions).toEqual([]);
    expect([...r.attestation!.uncorroboratedClaims].sort()).toEqual([
      "AMOUNTS_NOT_RECONSTRUCTED", "FILES_CAME_FROM_STATED_SYSTEMS", "NO_DERIVED_IDENTIFIERS",
    ]);
  });

  it("denying all three UNCORROBORATED claims does not lower the rung — they were never holding it up", () => {
    // Surprising but correct, and worth pinning: those claims contribute nothing, so withdrawing them
    // takes nothing away. What it DOES change is the recorded text, which is the point of recording them.
    const { expectation, billing } = pair();
    const denied = attest({
      expectationExport: { ...EXPORT_OK, amountsAndDatesNotReconstructed: false, cameFromStatedSystem: false },
      billingExport: { ...EXPORT_OK, sourceSystem: "Acme Billing", amountsAndDatesNotReconstructed: false, cameFromStatedSystem: false },
      pseudonymisation: { applied: true, joinPreserving: true, noIdentifierDerivedFromAmountDateOrPosition: false },
    });
    const r = evaluateDataReadiness(expectation, billing, {}, denied);
    expect(r.authority.reached).toBe("SOURCE_ATTESTED");
    for (const id of ["AMOUNTS_NOT_RECONSTRUCTED", "NO_DERIVED_IDENTIFIERS", "FILES_CAME_FROM_STATED_SYSTEMS"]) {
      const c = r.attestation!.checks.find((x) => x.claimId === id)!;
      expect(c.outcome).toBe("NOT_CHECKABLE");
      expect(c.detail).toContain("NOT asserted");
    }
  });
});

describe("4 · a contradicted attestation fails CLOSED and names the contradiction", () => {
  const contradicts = (a: ProvenanceAttestation, p = pair()) => {
    const r = evaluateDataReadiness(p.expectation, p.billing, {}, a);
    return { r, c: corroborateAttestation(a, p.expectation, p.billing) };
  };

  it("a declared row count that disagrees with the file", () => {
    const { r, c } = contradicts(attest({ billingExport: { ...EXPORT_OK, declaredRowCount: 7 } }));
    expect(outcomeOf(c, "ROW_COUNT_PRECOMMITTED")).toBe("CONTRADICTED");
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.authority.ceilingReason).toContain("CONTRADICTS");
    expect(r.attestation!.contradictions).toContain("ROW_COUNT_PRECOMMITTED");
  });

  it("a coverage window that excludes a date present in the file", () => {
    const { r, c } = contradicts(attest({
      billingExport: { ...EXPORT_OK, coverageStart: "2026-01-01", coverageEnd: "2026-01-31" },
    }));
    expect(outcomeOf(c, "COVERAGE_WINDOW_HONOURED")).toBe("CONTRADICTED");
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
  });

  it("a period that EXTENDS past the window is NOT a contradiction — normal data stays normal", () => {
    // The anchor date is what must be inside the window. A monthly obligation straddles any cut-off, and
    // treating that as a contradiction would manufacture failures out of ordinary exports.
    const p = pair({ period_end: "2026-04-30" }, { period_end: "2026-04-30" });
    const r = evaluateDataReadiness(p.expectation, p.billing, {}, attest());
    expect(r.authority.reached).toBe("SOURCE_ATTESTED");
  });

  it("an export taken BEFORE its window closed", () => {
    const { r, c } = contradicts(attest({ expectationExport: { ...EXPORT_OK, extractedAt: "2026-03-10" } }));
    expect(outcomeOf(c, "EXTRACTED_AFTER_COVERAGE")).toBe("CONTRADICTED");
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
  });

  it("an unnamed source system, and a described method with no description", () => {
    const { c: c1 } = contradicts(attest({ expectationExport: { ...EXPORT_OK, sourceSystem: "  " } }));
    expect(outcomeOf(c1, "EXPECTATION_SOURCE_NAMED")).toBe("CONTRADICTED");
    const { c: c2 } = contradicts(attest({
      billingExport: { ...EXPORT_OK, extractionMethod: "other_described", extractionMethodDescription: "" },
    }));
    expect(outcomeOf(c2, "BILLING_SOURCE_NAMED")).toBe("CONTRADICTED");
    // ...and `other_described` WITH a description is fine, or the enum would be a trap.
    const { r } = contradicts(attest({
      expectationExport: { ...EXPORT_OK, extractionMethod: "other_described", extractionMethodDescription: "nightly dump from the ledger replica" },
      billingExport: { ...EXPORT_OK, sourceSystem: "Acme Billing" },
    }));
    expect(r.authority.reached).toBe("SOURCE_ATTESTED");
  });

  it("an obligation_ref composed from another cell on its own row", () => {
    // This is what a reference manufactured for NH looks like: built out of the invoice it sits on.
    const e = owe();
    const ob = e.cells.schedule_line_ref!;
    const b = billed(ob);
    const forged = { ...b, cells: { ...b.cells, obligation_ref: b.cells.invoice_ref! } };
    const p = {
      expectation: validateExpectationExtract(E_FULL, [e], E_TERMS),
      billing: validateBillingExtract(S_FULL, [forged], S_TERMS),
    };
    const c = corroborateAttestation(attest(), p.expectation, p.billing);
    expect(outcomeOf(c, "OBLIGATION_REF_NOT_MANUFACTURED")).toBe("CONTRADICTED");
    const r = evaluateDataReadiness(p.expectation, p.billing, {}, attest());
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
  });

  it("two files pseudonymised INDEPENDENTLY — no shared payer, and the join does not form", () => {
    // The classic mistake the sixth requirement is about. Each file is internally consistent and the two
    // cannot be joined at all, which is precisely what NH can see.
    const e = owe({ payer_ref: "payer-A" });
    const p = {
      expectation: validateExpectationExtract(E_FULL, [e], E_TERMS),
      billing: validateBillingExtract(S_FULL, [billed("totally-different-ref", { payer_ref: "payer-Z" })], S_TERMS),
    };
    const c = corroborateAttestation(attest(), p.expectation, p.billing);
    expect(outcomeOf(c, "IDENTIFIERS_SOURCE_NATIVE")).toBe("CONTRADICTED");
    expect(outcomeOf(c, "JOINS_SURVIVED_PSEUDONYMISATION")).toBe("CONTRADICTED");
    expect(evaluateDataReadiness(p.expectation, p.billing, {}, attest()).authority.reached).toBe("SOURCE_NATIVE");
  });

  it("an unreadable extract makes the row count NOT_CHECKABLE, and that fails closed too", () => {
    // Deliberately not a CONTRADICTION: the file could not be read, which is an extract fault with its
    // own code. Blaming the attestation would point the customer at the wrong thing. But "we could not
    // look" is not "we looked and it was fine", so the rung still does not rise.
    const p = {
      expectation: validateExpectationExtract(E_FULL, [owe()], E_TERMS),
      billing: validateBillingExtract(["invoice_ref"], [], S_TERMS),
    };
    const c = corroborateAttestation(attest(), p.expectation, p.billing);
    expect(outcomeOf(c, "ROW_COUNT_PRECOMMITTED")).toBe("NOT_CHECKABLE");
    expect(c.allRungBearingClaimsPassed).toBe(false);
    // And the reported rung is AUTHORITY_UNVERIFIED rather than SOURCE_NATIVE, because the ladder's
    // "the fact is absent" branch outranks every later one: an unreadable export supplies no fact for any
    // rung to be about. My first form of this test expected SOURCE_NATIVE and was wrong — an attestation
    // cannot put a floor under a file that could not be read.
    const r = evaluateDataReadiness(p.expectation, p.billing, {}, attest());
    expect(r.authority.reached).toBe("AUTHORITY_UNVERIFIED");
    expect(r.provisional).toBe(true);
  });
});

describe("5 · the rung is DERIVED, never asserted", () => {
  it("`attested` is still refused as a request key, although a rung is now named for it", () => {
    // A rung named for a thing the request may not say is exactly where someone will later try to say it.
    const { expectation, billing } = pair();
    const r = evaluateDataReadiness(expectation, billing, { attested: true, authorityVerified: true });
    expect([...r.refusedSelfAssertedAuthority].sort()).toEqual(["attested", "authorityVerified"]);
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.provisional).toBe(true);
  });

  it("the evaluator exposes no way to assert corroboration — the asymmetry is structural", () => {
    // COMMENTS STRIPPED. The first form of this check matched `provenanceEstablished` inside the comment
    // that says the field is NOT accepted from the caller — so the guard failed on prose asserting the
    // very property it was testing for. Ninth instance in this repository: a structural guard must read
    // code, not the words the code is talking about.
    const raw = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // The caller hands over a DECLARATION; the corroboration is computed here from the files.
    expect(raw).toContain("corroborateAttestation(attestation, expectation, billing)");
    // ...and the computed verdict is never something the evaluator could be handed.
    expect(src).not.toContain("allRungBearingClaimsPassed");
    expect(src).not.toContain("provenanceEstablished");
  });

  it("the corroborator is pure and clockless — the same bytes always answer the same way", () => {
    const src = readFileSync(resolve(__dirname, "provenanceAttestation.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const forbidden of ["Date.now", "new Date(", "Math.random", "crypto", "fetch("]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    const { expectation, billing } = pair();
    const a = corroborateAttestation(attest(), expectation, billing);
    const b = corroborateAttestation(attest(), expectation, billing);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("every declared extraction method is in the closed set, and the set has no free-text escape", () => {
    expect(EXTRACTION_METHODS).toContain("other_described");
    // `other_described` is the escape, and it is the ONE that requires a description — so the closed set
    // cannot be bypassed by a shrug.
    const spec = ATTESTATION_CLAIMS.find((c) => c.id === "BILLING_SOURCE_NAMED")!;
    expect(spec.howNhChecksIt).toContain("shape");
  });
});

describe("6 · a readiness report with an attestation still contains NO money", () => {
  it("no monetary key and no currency figure anywhere in the returned object", () => {
    const { expectation, billing } = pair();
    const r = evaluateDataReadiness(expectation, billing, {}, attest());
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "string") {
        expect(v, path).not.toMatch(/\$\s?\d/);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      if (v !== null && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          expect(k.toLowerCase(), `${path}.${k}`).not.toMatch(/minor|amount|exposure|residual|recovered|revenue/);
          walk(val, `${path}.${k}`);
        }
      }
    };
    walk(r.attestation, "attestation");
  });
});

describe("7 · a reported finding, pinned rather than patched", () => {
  it("`level` does NOT cap on authority, although its comment says it is never above what authority permits", () => {
    // FOUND WHILE ADDING THE RUNG, REPORTED RATHER THAN CHANGED. `ReadinessReport.level` documents itself
    // as "the highest level BOTH files support. Never above what authority permits being relied on." The
    // code does not implement that cap: the level is computed from CAPABILITIES alone, and authority only
    // sets `provisional`. It is the `coverage.event` shape — a surface describing a stronger property
    // than it enforces.
    //
    // It is harmless TODAY because `provisional` is true in every reachable state, so no level can be
    // relied on unqualified either way. Quietly adding a cap would change readiness results for data
    // nobody has re-read, and quietly deleting the sentence would erase the discrepancy instead of
    // recording it. So the behaviour is pinned here and the sentence is left for its owner.
    const src = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    expect(src).toContain("Never above what authority permits being relied on");
    const { expectation, billing } = pair();
    const without = evaluateDataReadiness(expectation, billing);
    const with_ = evaluateDataReadiness(expectation, billing, {}, attest());
    // Authority moved by a whole rung; the level did not move at all. That is the discrepancy, measured.
    expect(without.authority.reached).toBe("SOURCE_NATIVE");
    expect(with_.authority.reached).toBe("SOURCE_ATTESTED");
    expect(with_.level).toBe(without.level);
    // And the only thing that would make the cap observable stays unreachable.
    expect(with_.provisional).toBe(true);
    expect(without.provisional).toBe(true);
  });
});
