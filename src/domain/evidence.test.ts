// C1: evidence independence is DERIVED from the source system, not self-attested. A manual/operator
// source can never be classified independent — so a beneficiary cannot self-attest their way to the
// Auditable tier. (Prototype: the independent sources are simulated stand-ins for real ingestion.)
import { describe, it, expect } from "vitest";
import { makeEvidence, hasIndependentEvidence, isIndependentSource, INDEPENDENT_SOURCE_SYSTEMS } from "./evidence";

describe("evidence independence is enforced by source (C1)", () => {
  it("a manual/operator source cannot be independent even if 'independent' is requested", () => {
    const forged = makeEvidence({
      evidenceId: "EV-forge",
      evidenceType: "operator_note",
      sourceSystem: "manual",
      sourceRecordId: "n1",
      observedAt: "2026-06-19T00:00:00.000Z",
      ingestedAt: "2026-06-19T00:00:00.000Z",
      trustClassification: "independent", // self-attested — must be overridden
      suppliedBy: "operator@company",
    });
    expect(forged.trustClassification).toBe("beneficiary_controlled");
    expect(forged.beneficiaryControl).toBe(true);
    expect(hasIndependentEvidence([forged])).toBe(false);
  });

  it("a trusted source system yields an independent reference", () => {
    const invoice = makeEvidence({
      evidenceId: "EV-inv",
      evidenceType: "invoice_paid",
      sourceSystem: "billing",
      sourceRecordId: "INV-1",
      observedAt: "2026-06-19T00:00:00.000Z",
      ingestedAt: "2026-06-19T00:00:00.000Z",
      trustClassification: "independent",
      suppliedBy: "billing",
    });
    expect(invoice.trustClassification).toBe("independent");
    expect(invoice.beneficiaryControl).toBe(false);
    expect(hasIndependentEvidence([invoice])).toBe(true);
  });

  it("an unknown source is not treated as independent", () => {
    expect(isIndependentSource("some_random_system")).toBe(false);
    for (const s of INDEPENDENT_SOURCE_SYSTEMS) expect(isIndependentSource(s)).toBe(true);
    expect(isIndependentSource("manual")).toBe(false);
  });
});
