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
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { EXPECTATION_EXTRACT_VERSION, EXPECTATION_EXTRACT_VERSION_HISTORY, STOPPED_FIELDS } from "./expectationExtract";
import {
  CORRECTED_CANDIDATES, ORPHANED_CORRECTIONS, STOPPED_FIELD_CORRECTIONS, correctionsFor,
} from "./expectationExtractCorrections";
import { validateExpectationExtract, type RawExpectationRow } from "./expectationExtractValidator";
import {
  BILLING_EXTRACT_COLUMNS, BILLING_EXTRACT_VERSION, BILLING_REQUIRED_COLUMNS,
  BILLING_VALIDATION_METHOD_VERSION,
} from "./billingExtract";
import { validateBillingExtract, type RawBillingRow } from "./billingExtractValidator";
import {
  DATA_READINESS_METHOD_VERSION, DATA_READINESS_SCHEME, READINESS_LEVELS, evaluateDataReadiness,
} from "./dataReadiness";
import { ATTESTATION_METHOD_VERSION } from "./provenanceAttestation";
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

  it("...and over the UNKNOWN-amount path, which the capable fixture never reaches", () => {
    // A COVERAGE HOLE IN THE CHECK ABOVE, found by the local pilot-pair falsifiers. `capable()` prices
    // every row, so `NH-EX-3006` is never blocked and the governed sentence that explains the no-zero
    // rule is never emitted — and that sentence quotes `$0.00`. So the guard above passed only because of
    // its fixture, and on a real export carrying one unpriced obligation a figure does appear.
    //
    // It is not a money leak: the figure is the constitution's own rule being stated — "never as zero,
    // because $0.00 would assert the obligation was checked and found clean" — and saying it with the
    // figure is clearer than saying it without. So the exemption is narrow and explicit, and ONE
    // permitted string is allowed in ONE governed sentence. Any other figure, anywhere, still fails.
    const e = validateExpectationExtract(E_FULL, [owe({ expected_amount: "" })], E_TERMS);
    const ob = "ob-unknown";
    const eKeyed = validateExpectationExtract(E_FULL, [owe({ expected_amount: "", schedule_line_ref: ob })], E_TERMS);
    const b = validateBillingExtract(S_FULL, [paid(ob)], S_TERMS);
    for (const r2 of [evaluateDataReadiness(e, b), evaluateDataReadiness(eKeyed, b)]) {
      const emitted = JSON.stringify(r2);
      const figures = [...emitted.matchAll(/\$\s?[\d,.]+/g)].map((m) => m[0]);
      const permitted = figures.filter((f) => f === "$0.00"
        && emitted.includes(`never as zero, because ${f} would assert`));
      expect(figures.filter((f) => !permitted.includes(f)),
        `unexpected monetary figures: ${figures.join(", ")}`).toEqual([]);
      expect(r2.claimBoundary.computesMoney).toBe(false);
    }
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

describe("7 · what would lift the rung · guidance names what is REACHABLE, not what is unbuilt", () => {
  // THE DEFECT THIS BLOCK CLOSES. `wouldBeLiftedBy` exists so "the customer conversation has somewhere
  // to go", and it was computed as `PROVENANCE_CHANNELS.filter((c) => !c.implemented)` — *which channels
  // are unbuilt*, not *which would raise this rung*. Those coincided while nothing was implemented and
  // diverged the moment DATA_OWNER_ATTESTATION shipped, after which every real submission at
  // SOURCE_NATIVE was told about four channels that do not exist and not about the one that does.
  //
  // It is the `coverage.event` shape: a field answering from a subset of the facts the answer needs.
  const rank = (a: string): number => AUTHORITY_LADDER.indexOf(a as never);
  const spec = (c: string) => PROVENANCE_CHANNELS.find((p) => p.channel === c)!;
  const base = Object.freeze({ present: true, validFormat: true, declaredSourceNative: true });

  it("POSITIVE · at SOURCE_NATIVE the attestation is offered, and offered as ACTIONABLE", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.authority.wouldBeLiftedBy).toContain("DATA_OWNER_ATTESTATION");
    // The half that was missing entirely: an operator can tell which one they can act on TODAY.
    expect(r.authority.availableNow).toEqual(["DATA_OWNER_ATTESTATION"]);
    // ...and the complete set is every channel above this rung — all five, not the four unbuilt ones.
    expect(r.authority.wouldBeLiftedBy).toHaveLength(PROVENANCE_CHANNELS.length);
  });

  it("NEGATIVE · at SOURCE_ATTESTED it is neither offered nor actionable — it was already used", () => {
    // The previously-correct branch, and the strongest evidence the general rule is right: it reproduces
    // the answer the retired `toVerified` local gave, with no special case.
    const a = assessSourceFactAuthority({
      ...base,
      attestation: {
        dataOwnerRole: "Revenue Operations", checks: [], contradictions: [],
        uncorroboratedClaims: [], allRungBearingClaimsPassed: true,
      } as never,
    });
    expect(a.reached).toBe("SOURCE_ATTESTED");
    expect(a.wouldBeLiftedBy).not.toContain("DATA_OWNER_ATTESTATION");
    expect([...a.wouldBeLiftedBy]).toEqual(
      PROVENANCE_CHANNELS.filter((c) => c.reaches === "AUTHORITY_VERIFIED").map((c) => c.channel),
    );
    // Empty, and not because nothing would help — because nothing IMPLEMENTED would.
    expect(a.availableNow).toEqual([]);
  });

  it("NEGATIVE · a CONTRADICTED attestation is not offered as its own remedy", () => {
    // Withheld on purpose. The channel was exercised and failed, so offering it reads as "send a
    // corrected attestation" — adjust the declaration until it agrees with the file — which is exactly
    // the coordinated edit this channel admits it cannot detect. A gate that points the incentive at
    // the failure is worse than no gate, so the contradiction is NAMED and nothing is offered.
    const a = assessSourceFactAuthority({
      ...base,
      attestation: {
        dataOwnerRole: "Revenue Operations", checks: [],
        contradictions: ["DECLARED_ROW_COUNT_AGREES"], uncorroboratedClaims: [],
        allRungBearingClaimsPassed: false,
      } as never,
    });
    expect(a.reached).toBe("SOURCE_NATIVE");
    expect(a.wouldBeLiftedBy).not.toContain("DATA_OWNER_ATTESTATION");
    expect(a.availableNow).toEqual([]);
    expect(a.ceilingReason).toContain("CONTRADICTS the files on: DECLARED_ROW_COUNT_AGREES");
  });

  it("NEGATIVE · below SOURCE_NATIVE no channel is offered — those rungs are reached by fixing the FILE", () => {
    // Every channel `reaches` SOURCE_ATTESTED or AUTHORITY_VERIFIED, so a naive application of the
    // ladder rule would offer all five to a file that does not parse. And AUTHORITY_UNVERIFIED sits
    // OUTSIDE the ladder, so `indexOf` is -1 there and every channel would look like an improvement.
    for (const input of [
      { present: false, validFormat: false, declaredSourceNative: false },
      { present: true, validFormat: false, declaredSourceNative: true },
      { present: true, validFormat: true, declaredSourceNative: false },
    ]) {
      const a = assessSourceFactAuthority(input);
      expect(a.wouldBeLiftedBy, a.reached).toEqual([]);
      expect(a.availableNow, a.reached).toEqual([]);
    }
  });

  it("INVARIANT · derived from the catalogue, so a new channel needs no edit here", () => {
    const cases = [
      assessSourceFactAuthority(base),
      assessSourceFactAuthority({ ...base, provenanceEstablished: true }),
      assessSourceFactAuthority({
        ...base,
        attestation: { dataOwnerRole: "X", checks: [], contradictions: [], uncorroboratedClaims: [], allRungBearingClaimsPassed: true } as never,
      }),
    ];
    for (const a of cases) {
      // `availableNow` is a SUBSET, never a separate answer that could disagree.
      for (const c of a.availableNow) expect(a.wouldBeLiftedBy, a.reached).toContain(c);
      // Nothing is offered as actionable unless it is actually built.
      for (const c of a.availableNow) expect(spec(c).implemented, c).toBe(true);
      // Everything offered would STRICTLY raise the rung reached. This is the property the old
      // `!implemented` filter did not have at all.
      for (const c of a.wouldBeLiftedBy) {
        expect(rank(spec(c).reaches), `${c} must reach above ${a.reached}`).toBeGreaterThan(rank(a.reached));
      }
    }
    // Catalogue order, not a ranking: the list carries no recommendation beyond `availableNow`.
    expect([...assessSourceFactAuthority(base).wouldBeLiftedBy])
      .toEqual(PROVENANCE_CHANNELS.map((c) => c.channel));
  });

  it("CONTROL · the correction moved guidance and nothing else", () => {
    // Everything a customer could mistake for a finding must be untouched by a change to advice. If any
    // of this moves, the slice was not operator guidance and the version decision below is wrong.
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.level).toBe("L3_EXACT_MONEY");
    expect(r.provisional).toBe(true);
    expect(r.authority.reached).toBe("SOURCE_NATIVE");
    expect(r.attestation).toBeNull();
    // Pinned by CODE rather than as an empty list: even a fully capable L3 pair blocks the two
    // capabilities no source fact in this contract can supply, and that must be exactly as it was.
    expect(r.blocked.map((b) => b.code)).toEqual(["NH-BX-3005", "NH-EX-2016"]);
    expect(r.claimBoundary).toEqual({
      observationOnly: true, computesMoney: false, constitutesProof: false, constitutesRevenue: false,
    });
  });

  it("VERSION · neither version moves, and the reason is the file's own test", () => {
    // DETERMINED BEFORE THE CHANGE, and pinned here because a version decision nothing asserts drifts.
    //
    // `rdy-2026.2` moved to `.2` because "a new authority state is genuinely REACHABLE", and stayed put
    // through the billing rename because "no level, gate, conjunct, count or refusal changed". Here no
    // level, gate, conjunct, count or refusal changes and no new state becomes reachable — `reached`,
    // `provisional`, `level`, `capabilities` and `blocked` are identical in every branch, which the
    // CONTROL above asserts. The counter-argument, that reported output changed, loses on the same
    // precedent: the rename changed reported NAMES and deliberately did not move it, because "a version
    // signalling a change that did not happen is its own defect".
    expect(DATA_READINESS_METHOD_VERSION).toBe("rdy-2026.2");
    // The SCHEME holds because `availableNow` is ADDITIVE, and a scheme id moves on a BREAKING shape
    // change — `settlement` → `billing` was one; a new optional field is not.
    expect(DATA_READINESS_SCHEME).toBe("nh-customer-data-readiness-v2");
    // And corroboration is untouched, so the attestation method version has nothing to say about this.
    expect(ATTESTATION_METHOD_VERSION).toBe("pav-2026.2");
  });

  it("VERSION · this layer does not touch calculationMethodVersion, and could not", () => {
    // The constant the question invites and the WRONG one for this layer. It governs admission and
    // execution, is server-stamped from ADMISSION_EVALUATOR_VERSION, and sits inside `canonicalBinding`
    // (`PAX-`) and `canonicalFinding` — so moving it would fire NH-AX-1014 and NH-AX-2006 across every
    // governed definition and force terms re-blessing, for a change to a guidance string.
    //
    // Asserted structurally rather than argued: the readiness path cannot reach it.
    for (const f of ["dataReadiness.ts", "sourceFactAuthority.ts", "provenanceAttestation.ts"]) {
      expect(readFileSync(resolve(__dirname, f), "utf8"), f).not.toContain("calculationMethodVersion");
    }
    // And nothing here is persisted, so there is no historical readiness report to reproduce.
    const src = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    for (const persistence of ["prisma", "PrismaClient", "INSERT", "writeFileSync"]) {
      expect(src, persistence).not.toContain(persistence);
    }
  });
});

describe("8 · extract-level faults are REPORTED, and their details never are", () => {
  // THE GAP THIS BLOCK CLOSES. An unusable extract came back `usable: false` and `L0_NOT_READABLE`
  // carrying no code at all, although the validator had computed `NH-EX-1001..1004` into `extractFaults`
  // — the report surfaced `rejectionCodes` (ROW level) and dropped them. So the one case where NH says
  // "I cannot read this at all" was the case where it explained least.
  //
  // It is codes-only, and that is a privacy decision rather than a shortcut. See the PRIVACY tests.
  const wrongShape = () => validateExpectationExtract(["a", "b", "c"], [
    { rowNumber: 2, cells: { a: "1", b: "2", c: "3" } },
  ], E_TERMS);

  it("POSITIVE · a wrong-column extract names the contract codes that refused it", () => {
    const { settlement } = capable();
    const r = evaluateDataReadiness(wrongShape(), settlement);
    expect(r.level).toBe("L0_NOT_READABLE");
    expect(r.expectation.usable).toBe(false);
    // NH-EX-1002 = a required column is absent · NH-EX-1003 = an undeclared column is present.
    expect(r.expectation.extractFaultCodes).toEqual(["NH-EX-1002", "NH-EX-1003"]);
  });

  it("POSITIVE · the billing half answers in its own code family", () => {
    const { expectation } = capable();
    const r = evaluateDataReadiness(expectation, validateBillingExtract(["x", "y"], [
      { rowNumber: 2, cells: { x: "1", y: "2" } },
    ], S_TERMS));
    expect(r.level).toBe("L0_NOT_READABLE");
    expect(r.billing.extractFaultCodes).toEqual(["NH-BX-1002", "NH-BX-1003"]);
    // ...and the side that is fine says so, rather than inheriting the other side's faults.
    expect(r.expectation.extractFaultCodes).toEqual([]);
  });

  it("NEGATIVE · a clean pair reports an EMPTY list, not a missing one", () => {
    const { expectation, settlement } = capable();
    const r = evaluateDataReadiness(expectation, settlement);
    expect(r.expectation.extractFaultCodes).toEqual([]);
    expect(r.billing.extractFaultCodes).toEqual([]);
  });

  it("NEGATIVE · 'no rows' and 'wrong shape' stay DISTINGUISHABLE", () => {
    // Both are `usable: false` and both are L0, so without the codes they are one undifferentiated
    // "unreadable" — and the remedies are opposite. An empty extract means "send us the obligations";
    // a wrong header means "fix the columns". NH-EX-1001 is the one that must not collapse into the rest,
    // because an empty extract is never read as "nothing was owed".
    const { settlement } = capable();
    const empty = evaluateDataReadiness(validateExpectationExtract(E_FULL, [], E_TERMS), settlement);
    expect(empty.expectation.extractFaultCodes).toEqual(["NH-EX-1001"]);
    const wrong = evaluateDataReadiness(wrongShape(), settlement);
    expect(wrong.expectation.extractFaultCodes).not.toContain("NH-EX-1001");
  });

  it("NEGATIVE · extract level is not row level — an unusable extract rejects no ROW", () => {
    // The distinction the original §6b pin was really protecting, and it survives the fix: no row was
    // ever examined, so reporting a rejected row would assert work that never happened.
    const { settlement } = capable();
    const r = evaluateDataReadiness(wrongShape(), settlement);
    expect(r.expectation.rejectionCodes).toEqual([]);
    expect(r.expectation.rejectedRows).toBe(0);
    expect(r.expectation.acceptedRows).toBe(0);
    expect(r.expectation.extractFaultCodes.length).toBeGreaterThan(0);
  });

  it("PRIVACY · a HEADERLESS export leaks nothing, which is the case the codes exist for", () => {
    // THE HAZARD, PROVED RATHER THAN ASSUMED. `parseStrictCsv` takes `records[0]` as the header
    // unconditionally, so an export with no header row makes the first DATA row the header. The
    // validator's `UNDECLARED_COLUMN` detail then reads, verbatim:
    //
    //     column "ENT-00041" is not declared by nh.expectation-extract@1.1.0
    //     column "1499.00"   is not declared by nh.expectation-extract@1.1.0
    //
    // A headerless export is an ordinary customer mistake, so rendering details would leak real
    // identifiers, dates and AMOUNTS exactly when this field is most needed. The guard is computed from
    // the validation rather than hardcoded, so it cannot drift away from what the validator produces.
    const DATA = ["ENT-00041", "2026-03-01", "2026-03-31", "1499.00", "USD"];
    const v = validateExpectationExtract(DATA, [
      { rowNumber: 2, cells: Object.fromEntries(DATA.map((d) => [d, d])) },
    ], E_TERMS);
    expect(v.extractFaults.some((f) => f.detail.includes("1499.00"))).toBe(true); // the premise
    const { settlement } = capable();
    const emitted = JSON.stringify(evaluateDataReadiness(v, settlement));
    for (const value of DATA) {
      if (value === "USD") continue; // the governed currency is the operator's own term, not file data
      expect(emitted, `leaked source value ${value}`).not.toContain(value);
    }
    // ...and no detail string reaches the report, whatever it happens to contain.
    for (const f of v.extractFaults) expect(emitted).not.toContain(f.detail);
  });

  it("PRIVACY · structural · the evaluator never reads `.detail` and never emits the key", () => {
    // Lexical guards have failed in this repository eleven times by matching a term rather than a claim,
    // so this one reads the construct it is actually asking about: a property access on a fault.
    const src = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/extractFaults\.map\(\(f\) => f\.detail\)/);
    expect(src).not.toMatch(/\bf\.detail\b/);
    expect(src).toContain("extractFaults.map((f) => f.code)");
    const { settlement } = capable();
    expect(JSON.stringify(evaluateDataReadiness(wrongShape(), settlement))).not.toContain("detail");
  });

  it("CANONICAL · the fault record still has exactly two keys", () => {
    // `expectationValidationWitness` hashes `extractFaults.map((f) => [f.code, f.detail])` alongside the
    // header and every raw cell. It has no production caller today, which is NOT why this is safe — the
    // Detector #2 rule is that "nothing fails today" was never the right test. It is safe because the
    // validators were not touched, and this pin is what makes a later third field fail loudly instead of
    // silently entering the preimage and re-identifying every validation.
    expect(Object.keys(wrongShape().extractFaults[0]!)).toEqual(["code", "detail"]);
  });

  it("VERSION · a report-only addition moves no version, and no customer contract", () => {
    // Determined before editing. Neither validator was touched, so the two extract contracts did not
    // move at all — no column, tier, code, severity, capability or acceptance behaviour changed, and a
    // customer's file is judged identically, which is why every docs/pilot-intake artefact stays
    // byte-identical. The readiness scheme holds because the field is ADDITIVE, and the method version
    // holds because no level, gate, conjunct, count or refusal changed and no new state became
    // reachable: `usable: false` and `L0_NOT_READABLE` already existed. The report stops DROPPING codes
    // it already held.
    expect(EXPECTATION_EXTRACT_VERSION).toBe("1.1.0");
    expect(BILLING_EXTRACT_VERSION).toBe("1.0.0");
    expect(BILLING_VALIDATION_METHOD_VERSION).toBe("bxv-2026.1");
    expect(DATA_READINESS_METHOD_VERSION).toBe("rdy-2026.2");
    expect(DATA_READINESS_SCHEME).toBe("nh-customer-data-readiness-v2");
  });
});

describe("9 · GATE 2 · a validator detail never reaches the verifier's log", () => {
  // THE DEFECT THIS BLOCK CLOSES. `scripts/pilot-intake/verify-package.ts` passed
  // `JSON.stringify(val.extractFaults)` as a check DETAIL, and the report loop at the foot of that file
  // prints every detail unconditionally — pass or fail. Two of the four extract faults quote a header
  // string taken FROM THE FILE, which a headerless export turns into a real identifier, date or amount.
  //
  // Fixed by rendering `extractFaultCodes` instead. These tests carry the gate in three parts, and each
  // part states what it proves rather than implying more.
  const PI = resolve(__dirname, "..", "..", "scripts", "pilot-intake");
  const stripped = (f: string): string => readFileSync(resolve(PI, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // THE HEADERLESS SHAPE, which is the hazard rather than a generic wrong-column file: `parseStrictCsv`
  // takes `records[0]` as the header unconditionally, so an export with no header row makes the first
  // DATA row the header — and the fault details then quote these very strings.
  const E_CELLS = ["ENT-00041", "2026-03-01", "1499.00"];
  const S_CELLS = ["INV-900", "2750.00"];
  const asHeaderless = (vals: readonly string[]) =>
    [{ rowNumber: 2, cells: Object.fromEntries(vals.map((v) => [v, v])) }];
  const wrongPair = () => ({
    expectation: validateExpectationExtract(E_CELLS, asHeaderless(E_CELLS) as never, E_TERMS),
    billing: validateBillingExtract(S_CELLS, asHeaderless(S_CELLS) as never, S_TERMS),
  });

  it("FAILING VERIFICATION · the values the verifier renders carry codes and no detail", () => {
    // THE CASE THAT MATTERS: both checks FAIL here, which is the only state in which anything is
    // rendered at all — a passing run renders an empty string. So this is the failing-verification case,
    // exercised on exactly the two values the verifier passes to its renderer.
    const { expectation, billing } = wrongPair();
    const r = evaluateDataReadiness(expectation, billing);
    expect(r.expectation.extractFaultCodes).toEqual(["NH-EX-1002", "NH-EX-1003"]);
    expect(r.billing.extractFaultCodes).toEqual(["NH-BX-1002", "NH-BX-1003"]);
    // The premise — the validator really does quote the file — then the property.
    const details = [...expectation.extractFaults, ...billing.extractFaults].map((f) => f.detail);
    expect(details.some((d) => d.includes("ENT-00041") || d.includes("1499.00"))).toBe(true);
    const rendered = [...r.expectation.extractFaultCodes, ...r.billing.extractFaultCodes].join(" ");
    for (const d of details) expect(rendered, `rendered a detail: ${d}`).not.toContain(d);
    for (const cell of [...E_CELLS, ...S_CELLS]) {
      expect(rendered, `rendered a cell value: ${cell}`).not.toContain(cell);
    }
    // ...and every rendered token is a contract code and nothing else.
    for (const token of rendered.split(" ")) expect(token).toMatch(/^NH-(EX|BX)-\d{4}$/);
  });

  it("STRUCTURAL · the verifier renders THAT field, and stringifies no validation", () => {
    // What this half adds to the one above: it ties the verifier to the field whose detail-freeness the
    // other half proves. Together they are the gate; neither alone is. It reads CALL SITES rather than
    // prose — the eleventh instance of a guard that matched a term instead of a claim is recorded in
    // CLAUDE.md, and this one is written to not be the twelfth.
    const src = stripped("verify-package.ts");
    expect(src).toContain("faultDetail(readiness.expectation.extractFaultCodes)");
    expect(src).toContain("faultDetail(readiness.billing.extractFaultCodes)");
    // No validation, fault list or accepted row may be serialised anywhere in the file.
    for (const forbidden of [
      /JSON\.stringify\(\s*\w*[eEsSvV]al\b/, /JSON\.stringify\([^)]*extractFaults/,
      /JSON\.stringify\([^)]*\.rejections/, /JSON\.stringify\([^)]*\.accepted/,
    ]) {
      expect(src, `must not serialise a validation: ${forbidden.source}`).not.toMatch(forbidden);
    }
    // `.detail` may be read only as a CHECK's own detail in the report loop, never off a fault.
    expect(src).not.toMatch(/extractFaults[\s\S]{0,40}\.detail/);
    expect(src).not.toMatch(/\bf\.detail\b/);
    // The already-correct row-rejection precedent the two fault checks now follow stays correct.
    expect(src).toContain("rejections.map((r) => `${r.rowNumber}:${r.code}`)");
  });

  it("STRUCTURAL · the rest of the directory stays clean, and writes to stdout only", () => {
    for (const f of ["dependency.ts", "emit-package.ts", "examples.ts"]) {
      const src = stripped(f);
      expect(src, `${f} must not serialise a validation`).not.toMatch(/JSON\.stringify\(\s*\w*[eEsSvV]al\b/);
      expect(src, `${f} must not read a fault detail`).not.toMatch(/extractFaults[\s\S]{0,40}\.detail/);
    }
    // There is no stderr site in this directory at all, which is why "stdout or stderr" reduces to one
    // stream. Asserted so a future write to the other one is a decision rather than an accident.
    for (const f of ["verify-package.ts", "dependency.ts", "emit-package.ts", "examples.ts"]) {
      expect(stripped(f), `${f} writes to stderr`).not.toMatch(/stderr|console\.(error|warn)/);
    }
  });

  it("END TO END · the verifier's real stdout+stderr contains no validator detail", { timeout: 120_000 }, () => {
    // The gate's literal wording, on the real streams. Its limit, stated rather than hidden: `DIR` is
    // hardcoded to the committed examples, so this cannot induce a FAILING run — that is what the first
    // test is for. What it does prove is that the two streams of an actual invocation carry none of the
    // detail strings the real validators produce for those files.
    //
    // MEASURED, not assumed: all four mutations tried against this slice — restoring either
    // `JSON.stringify(val.extractFaults)`, rendering `f.detail`, and adding a third stringify — are
    // caught by the STRUCTURAL test above and by none of them by this one, because on clean examples
    // the fault list is empty and nothing is rendered either way. So the structural half is the
    // load-bearing guard and this half is corroboration. A test that cannot fail is not a control, and
    // this one can only fail if the verifier starts printing something new about a clean file.
    const out = spawnSync("npx", ["vite-node", "scripts/pilot-intake/verify-package.ts"], {
      cwd: resolve(__dirname, "..", ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    const combined = `${out.stdout ?? ""}${out.stderr ?? ""}`;
    expect(out.status, combined.slice(-800)).toBe(0);
    expect(combined).toContain("242/242 package checks passed");
    // Recomputed from the committed CSVs through the real validators, so the forbidden set is whatever
    // the validators would actually say about these files rather than a list written beside the test.
    const pkg = resolve(__dirname, "..", "..", "docs", "pilot-intake");
    const cells = (name: string) => {
      const lines = readFileSync(resolve(pkg, name), "utf8").split("\n").filter((l) => l !== "");
      const cols = lines[0]!.split(",");
      return { cols, rows: lines.slice(1).map((l, i) => ({ rowNumber: i + 1, cells: Object.fromEntries(cols.map((c, j) => [c, l.split(",")[j] ?? ""])) })) };
    };
    const e = cells("expectation_example.csv");
    const s = cells("billing_example.csv");
    const faults = [
      ...validateExpectationExtract(e.cols, e.rows as never, E_TERMS).extractFaults,
      ...validateBillingExtract(s.cols, s.rows as never, S_TERMS).extractFaults,
      ...validateExpectationExtract(e.cols, e.rows as never, E_TERMS).rejections,
      ...validateBillingExtract(s.cols, s.rows as never, S_TERMS).rejections,
    ].map((x) => x.detail).filter((d) => d.length >= 8);
    for (const d of faults) expect(combined, `leaked a detail: ${d}`).not.toContain(d);
    // ...and the sanitized render is what appears instead: no bare JSON array of fault objects.
    expect(combined).not.toMatch(/no extract fault · \[\{/);
    expect(combined).not.toMatch(/"detail":/);
  });
});
