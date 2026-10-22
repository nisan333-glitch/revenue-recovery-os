// Obligation Scope — PRODUCTION-PATH regression tests for the assessment surface. Every case goes
// through the real pipeline (CSV → adapter → assess → scope), not a hand-built scope, so a drift
// between what `assess` actually absorbs and what the scope discloses fails here.
import { describe, it, expect } from "vitest";
import { assessCsv, assessCsvWithScope } from "./assess";
import { makePolicy } from "./policy";
import { buildAssessmentRecord, canonicalizeAssessment } from "./record";
import { assessmentObligationScope } from "./obligationScope";
import { toCycle } from "./adapters/saasActivation";
import type { RowOutcome, ExpectationCycle } from "./types";
import { assertSingleObligation, UnsupportedSingleObligationAssertion } from "../domain/obligationScope";

const CREATED = "2026-03-02T00:00:00.000Z";
const policy = () => makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

const HEAD = "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency";
// Two separate charges for E1 that share every field an identity can be derived from, plus a clean E2.
const TWO_OBLIGATIONS_NO_ID =
  HEAD +
  "\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E1,2026-01-01,,2026-02-01,4000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

describe("assessment scope — two obligations sharing a derived identity (the hidden-exposure case)", () => {
  it("records the absorption, quantifies an unclassified upper bound, and counts none of it", async () => {
    const { result, obligationScope: s } = await assessCsvWithScope(TWO_OBLIGATIONS_NO_ID, policy(), { createdAt: CREATED });

    // Existing, preserved behavior: BOTH colliding rows are rejected and nothing from them is counted.
    expect(result.acceptedCycleCount).toBe(1); // only E2
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id")).toHaveLength(2);
    expect(result.observed.observedUnpaid.minor).toBe(0);

    // New disclosure: what that absorption could be hiding.
    expect(s.recordedAbsorption.status).toBe("RECORDED");
    expect(s.recordedAbsorption.disposition).toBe("EXCLUDED_FROM_TOTALS");
    expect(s.recordedAbsorption.groupCount).toBe(1);
    expect(s.recordedAbsorption.unitCount).toBe(2);
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 14_000_00, currency: "USD" });
    expect(s.disclosure.join("\n")).toContain("$14,000.00");
    expect(s.identity.grain).toBe("DERIVED_COMPOSITE");
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.reasons).toEqual([
      "OBLIGATION_LEVEL_IDENTIFIER_NOT_DECLARED",
      "IDENTITY_NOT_SOURCED",
      "IDENTITY_COLLISION_UNRESOLVED",
    ]);
  });

  it("the scope's absorbed units are exactly the rows assess recorded as duplicate_cycle_id (no drift)", async () => {
    const { result, obligationScope: s } = await assessCsvWithScope(TWO_OBLIGATIONS_NO_ID, policy(), { createdAt: CREATED });
    const excluded = result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").map((e) => e.sourceRowId).sort();
    expect([...s.recordedAbsorption.unitIds]).toEqual(excluded);
  });

  it("nothing is inferred: no separate/duplicate classification, and nothing enters any money total", async () => {
    const { result, obligationScope: s } = await assessCsvWithScope(TWO_OBLIGATIONS_NO_ID, policy(), { createdAt: CREATED });
    const text = s.disclosure.join("\n");
    expect(text).toContain("not inferred whether these records are duplicates of one obligation or separate obligations");
    expect(text).toContain("not a loss");
    expect(result.observed.observedUnpaid.minor).toBe(0);
    expect(result.observed.grossEligible.minor).toBe(0);
    expect(result.proven.minor).toBe(0);
    expect(result.estimated).toBe("unavailable_in_validation_slice");
  });
});

describe("assessment scope — explicit identifiers do not upgrade to 'single obligation'", () => {
  const WITH_IDS =
    "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
    "E1,SUB-A,2026-01-01,,2026-02-01,10000.00,USD\n" +
    "E1,SUB-B,2026-01-01,,2026-02-01,4000.00,USD";

  it("distinct source ids ⇒ no collision, both counted, grain SOURCE_IDENTIFIER, yet single-obligation still refused", async () => {
    const { result, obligationScope: s } = await assessCsvWithScope(WITH_IDS, policy(), { createdAt: CREATED });
    expect(result.acceptedCycleCount).toBe(2);
    expect(result.observed.observedUnpaid.minor).toBe(14_000_00);
    expect(s.identity.grain).toBe("SOURCE_IDENTIFIER");
    expect(s.recordedAbsorption.status).toBe("NONE_RECORDED");
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 0, currency: "USD" });
    // A subscription/cycle id identifies a RECORD; nothing declares it identifies an obligation.
    expect(s.singleObligation).toBe("REFUSED_UNSUPPORTED");
    expect(s.ambiguity.status).toBe("PRESENT");
    expect(s.ambiguity.reasons).toEqual(["OBLIGATION_LEVEL_IDENTIFIER_NOT_DECLARED"]);
    expect(() => assertSingleObligation(s, "Observed unpaid")).toThrow(UnsupportedSingleObligationAssertion);
  });

  it("a shared source id is a recorded collision of SOURCE_IDENTIFIER units", async () => {
    const dup =
      "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,SUB-X,2026-01-01,,2026-02-01,10000.00,USD\n" +
      "E2,SUB-X,2026-01-01,,2026-02-01,20000.00,USD";
    const { result, obligationScope: s } = await assessCsvWithScope(dup, policy(), { createdAt: CREATED });
    expect(result.acceptedCycleCount).toBe(0);
    expect(s.identity.grain).toBe("SOURCE_IDENTIFIER");
    expect(s.recordedAbsorption.unitCount).toBe(2);
    expect(s.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 30_000_00, currency: "USD" });
  });

  it("a mixed file reports MIXED grain", async () => {
    const mixed =
      "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,SUB-A,2026-01-01,,2026-02-01,10000.00,USD\n" +
      "E2,,2026-01-01,,2026-02-01,4000.00,USD";
    const { obligationScope: s } = await assessCsvWithScope(mixed, policy(), { createdAt: CREATED });
    expect(s.identity.grain).toBe("MIXED");
    expect(s.identity.sourceIdentifierCount).toBe(1);
    expect(s.identity.derivedCompositeCount).toBe(1);
  });
});

describe("assessment scope — only identity collisions count as absorption", () => {
  it("rows excluded for other reasons (zero amount, currency, malformed date) are NOT absorption", async () => {
    const csv =
      HEAD +
      "\n" +
      "E1,2026-01-01,,2026-02-01,0.00,USD\n" + // zero_amount
      "E2,2026-01-01,,2026-02-01,9000.00,EUR\n" + // currency_mismatch
      "E3,2026-01-01,,not-a-date,9000.00,USD\n" + // malformed_date
      "E4,2026-01-01,,2026-02-01,1000.00,USD";
    const { result, obligationScope: s } = await assessCsvWithScope(csv, policy(), { createdAt: CREATED });
    expect(result.excludedRowCount).toBe(3);
    expect(s.recordedAbsorption.status).toBe("NONE_RECORDED");
    expect(s.identity.unitCount).toBe(1); // only E4 ever became a unit
  });

  it("hand-built cycles with no recorded identity basis fail closed (UNDECLARED ⇒ NOT_ESTABLISHED)", () => {
    const out = toCycle(
      { sourceRowId: "r1", malformed: false, cells: { entity_id: "E1", signed_at: "2026-01-01", next_invoice_due_at: "2026-02-01", next_invoice_amount: "10.00", currency: "USD" } },
      policy(),
    ) as Extract<RowOutcome, { kind: "cycle" }>;
    const stripped: ExpectationCycle = { ...out.cycle, identityBasis: undefined };
    const s = assessmentObligationScope([{ kind: "cycle", cycle: stripped }], policy());
    expect(s.identity.grain).toBe("NOT_ESTABLISHED");
    expect(s.identity.undeclaredCount).toBe(1);
  });
});

describe("assessment scope — historical behavior is byte-identical (no result, id or record drift)", () => {
  // Golden values were produced by the code at HEAD BEFORE this slice (same CSV, policy, createdAt).
  const GOLDEN = {
    assessmentId: "A-b972b561",
    fp: "bdfd701b0e6ced99577bdbf69e6124576f22af21db16e10ce3f6c9f55d094456",
    recordHash: "274ec97fcc812352b683cb9320eb159a8c8bbb72bf501066f3854befa6f8dd3b",
    canonicalLen: 1874,
  };
  const GOLDEN_CSV =
    HEAD +
    "\n" +
    "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
    "E1,2026-01-01,,2026-02-01,4000.00,USD\n" +
    "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

  it("assessCsv still yields the pre-slice assessmentId, fingerprint and tamper-evident record hash", async () => {
    const r = await assessCsv(GOLDEN_CSV, policy(), { createdAt: CREATED });
    const rec = await buildAssessmentRecord(r);
    expect(r.assessmentId).toBe(GOLDEN.assessmentId);
    expect(r.sourceFingerprint).toBe(GOLDEN.fp);
    expect(rec.recordHash).toBe(GOLDEN.recordHash);
    expect(rec.canonical.length).toBe(GOLDEN.canonicalLen);
  });

  it("assessCsvWithScope returns the SAME result and the scope is not part of it", async () => {
    const plain = await assessCsv(GOLDEN_CSV, policy(), { createdAt: CREATED });
    const withScope = await assessCsvWithScope(GOLDEN_CSV, policy(), { createdAt: CREATED });
    expect(withScope.result).toEqual(plain);
    expect(canonicalizeAssessment(withScope.result)).toBe(canonicalizeAssessment(plain));
    expect(canonicalizeAssessment(withScope.result)).not.toContain("obligationScope");
    expect(canonicalizeAssessment(withScope.result)).not.toContain("identityBasis");
    expect((await buildAssessmentRecord(withScope.result)).recordHash).toBe(GOLDEN.recordHash);
  });

  it("the scope is deterministic for identical input", async () => {
    const a = await assessCsvWithScope(GOLDEN_CSV, policy(), { createdAt: CREATED });
    const b = await assessCsvWithScope(GOLDEN_CSV, policy(), { createdAt: CREATED });
    expect(JSON.stringify(a.obligationScope)).toBe(JSON.stringify(b.obligationScope));
  });

  it("assessCsvWithScope fails on a structurally bad file exactly like assessCsv", async () => {
    await expect(assessCsvWithScope("foo,bar\n1,2", policy(), { createdAt: CREATED })).rejects.toThrow(/missing required column/i);
  });
});
