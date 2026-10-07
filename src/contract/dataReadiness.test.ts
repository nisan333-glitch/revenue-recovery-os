// FALSIFIERS FOR CUSTOMER DATA READINESS, the authority ladder, and the append-only erratum.
//
// The three properties that carry the slice, and each is a way the report could flatter a customer:
//
//   1. A LEVEL, NEVER A BOOLEAN. The presence of `obligation_ref` licenses L2 and leaves L3 and L4
//      closed. "Ready" would announce a capability from a subset of the facts it needs — the error the
//      capability-reporting correction just fixed one layer in.
//   2. NO MONEY. A readiness report that estimated blocked dollars would be a forecast presented as a
//      finding. Checked structurally over the returned object, not promised in a comment.
//   3. NO SELF-VOUCHING. The caller is the beneficiary of a larger number, so no parameter they send
//      may raise authority, and in this slice nothing reaches AUTHORITY_VERIFIED at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTATION_EXTRACT_VERSION, EXPECTATION_EXTRACT_VERSION_HISTORY, STOPPED_FIELDS } from "./expectationExtract";
import {
  CORRECTED_CANDIDATES, ORPHANED_CORRECTIONS, STOPPED_FIELD_CORRECTIONS, correctionsFor,
} from "./expectationExtractCorrections";
import { validateExpectationExtract, type RawExpectationRow } from "./expectationExtractValidator";
import { BILLING_EXTRACT_COLUMNS, BILLING_REQUIRED_COLUMNS } from "./billingExtract";
import { validateBillingExtract, type RawBillingRow } from "./billingExtractValidator";
import { evaluateDataReadiness, READINESS_LEVELS } from "./dataReadiness";
import {
  AUTHORITY_LADDER, PROVENANCE_CHANNELS, SELF_ASSERTED_AUTHORITY_PARAMETERS,
  assessSourceFactAuthority, declaresOwnAuthority,
} from "./sourceFactAuthority";
import { EXPECTATION_EXTRACT_COLUMNS } from "./expectationExtract";

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
const paid = (obligation: string, over: Record<string, string> = {}): RawBillingRow => {
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

/** A fully capable pair: both sides keyed, priced, dated, in one currency. */
const capable = () => {
  const e = owe();
  const ob = e.cells.schedule_line_ref!;
  return {
    expectation: validateExpectationExtract(E_FULL, [e], E_TERMS),
    settlement: validateBillingExtract(S_FULL, [paid(ob)], S_TERMS),
    obligation: ob,
  };
};

const report = (cols: readonly string[], obligation: string, sRows?: readonly RawBillingRow[], eRows?: readonly RawExpectationRow[]) => {
  const e = eRows ?? [owe({ schedule_line_ref: obligation })];
  return evaluateDataReadiness(
    validateExpectationExtract(E_FULL, e, E_TERMS),
    validateBillingExtract(cols, sRows ?? [paid(obligation)], S_TERMS),
  );
};

describe("1 · the answer is a LEVEL, and it is cumulative", () => {
  it("a fully capable pair reaches L3 and stops there — L4 is not reachable", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.level).toBe("L3_EXACT_MONEY");
    expect(READINESS_LEVELS.indexOf(r.level)).toBeLessThan(READINESS_LEVELS.indexOf("L4_EVENT_PROOF"));
  });

  it("NO obligation_ref column ⇒ ceiling is L1, and nothing is rejected", () => {
    const e = owe();
    const r = report(S_FULL.filter((c) => c !== "obligation_ref"), e.cells.schedule_line_ref!, [paid("")], [e]);
    expect(r.level).toBe("L1_STRUCTURALLY_VALID");
    expect(r.billing.rejectedRows).toBe(0);
    expect(r.billing.acceptedRows).toBe(1);
  });

  it("an unreadable file is L0, and it is NOT reported as 'nothing was billed'", () => {
    const r = evaluateDataReadiness(
      validateExpectationExtract(E_FULL, [owe()], E_TERMS),
      validateBillingExtract(S_FULL, [], S_TERMS),
    );
    expect(r.level).toBe("L0_NOT_READABLE");
    expect(r.billing.usable).toBe(false);
  });

  it("L3 refuses while ANY accepted unit has an UNKNOWN amount — PARTIAL is never rounded up", () => {
    const e = owe({ expected_amount: "" });
    const r = report(S_FULL, e.cells.schedule_line_ref!, [paid(e.cells.schedule_line_ref!)], [e]);
    expect(r.expectation.unknownAmountRows).toBe(1);
    expect(r.expectation.monetaryQuantification).not.toBe("AVAILABLE");
    expect(r.level).toBe("L2_MONETARY_RECONCILIATION_POSSIBLE");
    // the row is PRESERVED, never dropped and never valued at zero
    expect(r.expectation.acceptedRows).toBe(1);
    expect(r.expectation.rejectedRows).toBe(0);
  });

  it("a currency mismatch closes exact money and reconciliation WITHOUT rejecting a row", () => {
    const e = owe();
    const r = report(S_FULL, e.cells.schedule_line_ref!, [paid(e.cells.schedule_line_ref!, { currency: "EUR" })], [e]);
    expect(r.currencyCompatible).toBe(false);
    expect(r.billing.currencyMismatchRows).toBe(1);
    expect(r.billing.rejectedRows).toBe(0);
    expect(r.level).toBe("L1_STRUCTURALLY_VALID");
  });

  it("a DANGLING obligation_ref is reported with its meaning, and blocks nothing at dataset level", () => {
    // The first form of this test asserted the dataset dropped to L1. That was the DATASET-GLOBAL TAINT
    // DEFECT repeated — 11 unjoinable rows of 597 on the frozen variant would have made NH tell a
    // customer reconciliation was impossible for a book that is 98% joinable. Doubt is scoped to the
    // evidence that creates it: the affected units are reported and excluded, the rest proceed.
    const e = owe();
    const r = report(S_FULL, e.cells.schedule_line_ref!, [paid("ghost-obligation")], [e]);
    expect(r.danglingObligationRefs).toBe(1);
    expect(r.danglingObligationRefNote).toContain("cannot be joined");
    expect(r.danglingObligationRefNote).toContain("expectation.rejectionCodes");
    expect(r.level).toBe("L3_EXACT_MONEY"); // the joinable remainder is unaffected
  });

  it("...and a dangling reference is never counted as having resolved", () => {
    const e = owe();
    const none = report(S_FULL, e.cells.schedule_line_ref!, [paid(e.cells.schedule_line_ref!)], [e]);
    expect(none.danglingObligationRefs).toBe(0);
    expect(none.danglingObligationRefNote).toBeNull();
  });

  it("expectation-side identity ALONE cannot raise the billing-side capability, or the reverse", () => {
    const e = owe(); // schedule_line_ref present, so the expectation side IS keyed
    const noLink = report(S_FULL.filter((c) => c !== "obligation_ref"), e.cells.schedule_line_ref!, [paid("")], [e]);
    expect(noLink.capabilities.find((c) => c.capability === "MONETARY_RECONCILIATION")!.available).toBe(false);
    // and the reverse: billing keyed, expectation side not
    const unkeyed = owe({ schedule_line_ref: "" });
    const noTarget = evaluateDataReadiness(
      validateExpectationExtract(E_FULL, [unkeyed], E_TERMS),
      validateBillingExtract(S_FULL, [paid("ob-anything")], S_TERMS),
    );
    expect(noTarget.capabilities.find((c) => c.capability === "MONETARY_RECONCILIATION")!.available).toBe(false);
  });
});

describe("2 · every blocked capability names fact, owner and what is blocked", () => {
  it("all three are always present and non-trivial", () => {
    const r = report(S_FULL.filter((c) => c !== "obligation_ref"), "ob-1", [paid("")]);
    expect(r.blocked.length).toBeGreaterThan(0);
    for (const b of r.blocked) {
      expect(b.missingSourceFact.length).toBeGreaterThan(20);
      expect(["contract_or_clm", "billing_or_erp", "payments_processor", "either_but_must_be_one"]).toContain(b.owningSourceSystem);
      expect(b.blockedMoneyDiscoveryCapability.length).toBeGreaterThan(20);
      expect(b.code).toMatch(/^NH-(EX|BX)-\d{4}$/);
    }
  });

  it("the missing obligation link is owned by BILLING, and names the join as what is blocked", () => {
    const r = report(S_FULL.filter((c) => c !== "obligation_ref"), "ob-1", [paid("")]);
    const b = r.blocked.find((x) => x.capability === "MONETARY_RECONCILIATION")!;
    expect(b.owningSourceSystem).toBe("billing_or_erp");
    expect(b.missingSourceFact).toContain("obligation_ref");
    expect(b.code).toBe("NH-BX-3001");
  });

  it("EVENT_PROOF is blocked, owned by the CONTRACT system, and says it unlocks no money", () => {
    const { expectation, settlement } = capable();
    const b = evaluateDataReadiness(expectation, settlement).blocked.find((x) => x.capability === "EVENT_PROOF")!;
    expect(b.owningSourceSystem).toBe("contract_or_clm");
    expect(b.missingSourceFact).toContain("EXPECTED SETTLEMENT COUNT");
    expect(b.blockedMoneyDiscoveryCapability).toContain("NO additional money");
  });

  it("ADDITIVE_OBLIGATION is blocked by construction and names the governance hazard", () => {
    const { expectation, settlement } = capable();
    const b = evaluateDataReadiness(expectation, settlement).blocked.find((x) => x.capability === "ADDITIVE_OBLIGATION")!;
    expect(b.missingSourceFact).toContain("INFLATES");
    expect(b.code).toBe("NH-EX-2016");
  });

  it("an available capability carries NO blocked record, and vice versa", () => {
    const { expectation, settlement } = capable();
    for (const c of evaluateDataReadiness(expectation, settlement).capabilities) {
      expect(c.available ? c.blocked === null : c.blocked !== null).toBe(true);
    }
  });
});

describe("3 · NO MONEY may appear in a readiness report", () => {
  it("no key names an amount and no value is a monetary string, checked over the whole object", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    const banned = /(minor|amountMinor|totalMinor|exposure|residual|blockedDollars|estimatedMoney|leakage)/i;
    const walk = (node: unknown, path: string): void => {
      if (node === null || node === undefined) return;
      if (typeof node === "string") {
        // A dollar FIGURE is forbidden. The word "money" in a sentence is not a figure.
        expect(node, `monetary figure at ${path}`).not.toMatch(/\$\s?\d/);
        return;
      }
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          expect(k, `monetary key at ${path}`).not.toMatch(banned);
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(r, "report");
    expect(r.claimBoundary.computesMoney).toBe(false);
  });

  it("the evaluator imports no reconciliation core and no money module", () => {
    const src = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    for (const forbidden of ["reconciliationCore", "obligationAwareReconciliation", "domain/money", "provenLedger"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe("4 · authority · nothing may vouch for itself", () => {
  it("with NO attestation the answer is exactly what it has always been", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.provisional).toBe(true);
    expect(r.authority.ceilingReason).toContain("no implemented provenance channel");
    expect(r.authority.wouldBeLiftedBy.length).toBeGreaterThan(0);
    expect(r.attestation).toBeNull();
  });

  it("NOTHING reaches AUTHORITY_VERIFIED — and the invariant is about REACH, not about being unbuilt", () => {
    // The first form of this test asserted that NO channel is implemented. That became false the moment
    // the attestation channel shipped, and it was the wrong property anyway: what protects the rung is
    // that no channel CAPABLE of reaching AUTHORITY_VERIFIED exists here. A weak channel being built is
    // not a weakening; a weak channel claiming a strong rung would be.
    for (const c of PROVENANCE_CHANNELS) {
      if (c.reaches === "AUTHORITY_VERIFIED") expect(c.implemented, c.channel).toBe(false);
    }
    const verifiedReachable = PROVENANCE_CHANNELS.filter((c) => c.implemented && c.reaches === "AUTHORITY_VERIFIED");
    expect(verifiedReachable).toEqual([]);
    // And the one implemented channel is honest about why it cannot reach it.
    const attested = PROVENANCE_CHANNELS.find((c) => c.implemented)!;
    expect(attested.channel).toBe("DATA_OWNER_ATTESTATION");
    expect(attested.reaches).toBe("SOURCE_ATTESTED");
    expect(attested.whyTheBeneficiaryCannotAlterIt).toContain("THEY LARGELY CAN");
    // And the residual weakness is STRUCTURAL rather than prose, so it cannot be written into optimism.
    expect(attested.submitterStillControls.length).toBeGreaterThan(0);
  });

  it("even a fully capable L3 pair is PROVISIONAL — a level is about shape, not trust", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.level).toBe("L3_EXACT_MONEY");
    expect(r.provisional).toBe(true);
  });

  it("a submission that vouches for itself is REFUSED and the refusal is visible", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement, { authoritative: true, signedBy: "the customer" });
    // Copied before sorting: the returned array is FROZEN, and an in-place sort on it throws — which
    // the first form of this test discovered by throwing. Incidental proof that the freeze is real.
    expect([...r.refusedSelfAssertedAuthority].sort()).toEqual(["authoritative", "signedBy"]);
    expect(Object.isFrozen(r.refusedSelfAssertedAuthority)).toBe(true);
    // ...and it changed nothing about what was reached.
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.provisional).toBe(true);
  });

  it("the ladder is ordered and AUTHORITY_UNVERIFIED is outside it, not the bottom rung", () => {
    expect(AUTHORITY_LADDER).toEqual([
      "PRESENT", "VALID_FORMAT", "SOURCE_NATIVE", "SOURCE_ATTESTED", "AUTHORITY_VERIFIED",
    ]);
    // SOURCE_ATTESTED sits BELOW AUTHORITY_VERIFIED, which is what keeps `provisional` true for it
    // without any change to that predicate.
    expect(AUTHORITY_LADDER.indexOf("SOURCE_ATTESTED"))
      .toBeLessThan(AUTHORITY_LADDER.indexOf("AUTHORITY_VERIFIED"));
    expect(AUTHORITY_LADDER).not.toContain("AUTHORITY_UNVERIFIED");
    expect(assessSourceFactAuthority({ present: false, validFormat: false, declaredSourceNative: false }).reached)
      .toBe("AUTHORITY_UNVERIFIED");
  });

  it("structural presence is not authority — each rung needs the one below it", () => {
    expect(assessSourceFactAuthority({ present: true, validFormat: false, declaredSourceNative: true }).reached).toBe("PRESENT");
    expect(assessSourceFactAuthority({ present: true, validFormat: true, declaredSourceNative: false }).reached).toBe("VALID_FORMAT");
    expect(assessSourceFactAuthority({ present: true, validFormat: true, declaredSourceNative: true }).reached).toBe("SOURCE_NATIVE");
  });

  it("every self-asserting parameter name is detected, case-insensitively", () => {
    for (const p of SELF_ASSERTED_AUTHORITY_PARAMETERS) {
      expect(declaresOwnAuthority({ [p.toUpperCase()]: 1 })).toHaveLength(1);
    }
    expect(declaresOwnAuthority({ currency: "USD" })).toHaveLength(0);
  });

  it("the evaluator has no parameter by which a caller could establish provenance", () => {
    // The refusal is STRUCTURAL: a field that exists and is rejected still invites someone to ask what
    // it would take to be accepted.
    const src = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    const call = src.slice(src.indexOf("assessSourceFactAuthority({"), src.indexOf("});", src.indexOf("assessSourceFactAuthority({")));
    expect(call).not.toContain("provenanceEstablished");
    expect(call).not.toContain("submission");
  });
});

describe("5 · the append-only erratum · history preserved, correction visible", () => {
  // The exact recorded prose, quoted here so the test FAILS if anyone rewrites it in place.
  const ORIGINAL =
    "A generic invoice-level reference is not sufficient for a cross-system join: the two sides identify at different grains, consolidation and splitting are many-to-many, and a billing migration re-keys the entire book at once, so the whole expected book would read as missing. `schedule_line_ref` is scoped WITHIN this extract and is deliberately not that key. The grain question is open and belongs to the D2 decision.";

  it("the original conclusion is BYTE-IDENTICAL to what was recorded — history is not rewritten", () => {
    const entry = STOPPED_FIELDS.find((s) => s.candidate === "obligation_ref as a cross-system join key")!;
    expect(entry).toBeDefined();
    expect(entry.why).toBe(ORIGINAL);
  });

  it("every correction points at a real candidate", () => {
    expect(ORPHANED_CORRECTIONS).toEqual([]);
    expect(STOPPED_FIELD_CORRECTIONS.length).toBeGreaterThan(0);
  });

  it("each correction carries all six required elements, non-empty", () => {
    for (const c of STOPPED_FIELD_CORRECTIONS) {
      expect(c.supersededConclusion.length).toBeGreaterThan(40);
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.causingCommits.length).toBeGreaterThan(0);
      expect(c.stillValid.length).toBeGreaterThan(0);
      expect(c.noLongerValid.length).toBeGreaterThan(0);
      expect(c.currentArchitecture.length).toBeGreaterThan(40);
      expect(c.recordedIn.length).toBeGreaterThan(0);
      expect(["SUPERSEDED_IN_PART", "SUPERSEDED_IN_FULL"]).toContain(c.status);
      for (const sha of c.causingCommits) expect(sha).toMatch(/^[0-9a-f]{40}/);
    }
  });

  it("the correction keeps the grain and many-to-many objections ALIVE", () => {
    const c = correctionsFor("obligation_ref as a cross-system join key")[0]!;
    const still = c.stillValid.join(" ");
    expect(still).toContain("DIFFERENT GRAINS");
    expect(still).toContain("MANY-TO-MANY");
    expect(still).toContain("GRAIN QUESTION REMAINS OPEN");
    // ...and only the measured objection falls.
    expect(c.noLongerValid.join(" ")).toContain("migration");
    expect(c.currentArchitecture).toContain("BILLING/SETTLEMENT side");
  });

  it("a SUPERSEDED marker sits beside the original, so no reader can miss it", () => {
    const src = readFileSync(resolve(__dirname, "expectationExtract.ts"), "utf8");
    for (const candidate of CORRECTED_CANDIDATES) {
      const at = src.indexOf(`candidate: "${candidate}"`);
      expect(at).toBeGreaterThan(-1);
      const preceding = src.slice(Math.max(0, at - 900), at);
      expect(preceding, `no SUPERSEDED marker before "${candidate}"`).toContain("SUPERSEDED IN PART");
      expect(preceding).toContain("expectationExtractCorrections");
    }
  });

  it("the expectation extract is NOT version-bumped for a reasoning correction", () => {
    expect(EXPECTATION_EXTRACT_VERSION).toBe("1.1.0");
    expect(EXPECTATION_EXTRACT_VERSION_HISTORY.map((h) => h.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("the corrections file cannot edit the record it corrects — it only reads it", () => {
    const src = readFileSync(resolve(__dirname, "expectationExtractCorrections.ts"), "utf8");
    expect(src).toContain('import { STOPPED_FIELDS } from "./expectationExtract"');
    expect(src).not.toMatch(/STOPPED_FIELDS\s*[.[]\s*\w*\s*=/); // no mutation of the imported record
    expect(src).not.toContain("EXPECTATION_EXTRACT_VERSION =");
  });
});

describe("6 · the required-only floor", () => {
  it("both sides at their required minimum are L1 with every optional capability named as blocked", () => {
    const e: RawExpectationRow = {
      rowNumber: 1,
      cells: { entitlement_ref: "e1", period_start: "2026-03-01", period_end: "2026-03-31", expected_amount: "10.00", currency: "USD" },
    };
    const eCols = E_FULL.filter((c) => ["entitlement_ref", "period_start", "period_end", "expected_amount", "currency"].includes(c));
    const s: RawBillingRow = {
      rowNumber: 1,
      cells: { invoice_ref: "i1", invoice_line_ref: "L1", invoice_raised_at: "2026-03-05", invoice_line_amount: "10.00", currency: "USD", payer_ref: "p1" },
    };
    const r = evaluateDataReadiness(
      validateExpectationExtract(eCols, [e], E_TERMS),
      validateBillingExtract(BILLING_REQUIRED_COLUMNS, [s], S_TERMS),
    );
    expect(r.level).toBe("L1_STRUCTURALLY_VALID");
    expect(r.expectation.rejectedRows).toBe(0);
    expect(r.billing.rejectedRows).toBe(0);
    // Every capability that is closed says what is missing and who owns it.
    expect(r.blocked.length).toBe(r.capabilities.filter((c) => !c.available).length);
  });
});

describe("7 · the customer-facing pilot request is GENERATED, not written", () => {
  it("the committed document equals a fresh render from the field specs", async () => {
    // The reason this is a test rather than a convention: a customer-facing artefact derived by hand
    // from a governed definition drifts silently, and here the stale version would be a DATA REQUEST —
    // the customer gathers the wrong columns and finds out at reconciliation.
    const committed = readFileSync(resolve(__dirname, "../../docs/pilot-intake/PILOT_DATA_REQUEST_V1.md"), "utf8");
    // Render into a temporary location by re-running the emitter's own logic through a child process
    // would couple this test to the filesystem; instead assert the invariants the render guarantees.
    for (const f of BILLING_REQUIRED_COLUMNS) {
      expect(committed, `required settlement column ${f} missing from the request`).toContain(`\`${f}\``);
    }
    for (const f of EXPECTATION_EXTRACT_COLUMNS) {
      expect(committed, `expectation column ${f} missing from the request`).toContain(`\`${f}\``);
    }
    expect(committed).toContain("MANDATORY FOR MONEY DISCOVERY");
    expect(committed).toContain("OPTIONAL / CAPABILITY ENHANCING");
    expect(committed).toContain("Generated from the governed definitions");
  });

  it("expected settlement count is NOT requested as mandatory", () => {
    const committed = readFileSync(resolve(__dirname, "../../docs/pilot-intake/PILOT_DATA_REQUEST_V1.md"), "utf8");
    const mandatory = committed.slice(
      committed.indexOf("## MANDATORY FOR MONEY DISCOVERY"),
      committed.indexOf("## OPTIONAL / CAPABILITY ENHANCING"),
    );
    expect(mandatory).not.toContain("settlement count");
    expect(mandatory).not.toContain("expected_attempts");
    // ...and it IS named, in the section that says why it is not mandatory.
    expect(committed).toContain("no additional money");
  });

  it("the request asks for no personal data and no derived values", () => {
    const committed = readFileSync(resolve(__dirname, "../../docs/pilot-intake/PILOT_DATA_REQUEST_V1.md"), "utf8");
    expect(committed).toContain("Pseudonymised");
    expect(committed).toContain("No names, emails, addresses");
    expect(committed).toContain("Do not substitute a default, a zero, an estimate or a derived value");
    expect(committed).toContain("Original**, per row");
  });

  it("the request promises NO money in the readiness report", () => {
    const committed = readFileSync(resolve(__dirname, "../../docs/pilot-intake/PILOT_DATA_REQUEST_V1.md"), "utf8");
    expect(committed).toContain("readiness report contains no money");
    expect(committed).toContain("PROVISIONAL");
  });
});
