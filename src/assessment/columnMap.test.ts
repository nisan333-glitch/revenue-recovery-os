import { describe, it, expect } from "vitest";
import { autoDetectMapping, applyMapping, mappingId, type MappingSpec } from "./columnMap";
import { parseCsv } from "./parse";
import { assessCsv, planColumnMapping } from "./assess";
import { makePolicy } from "./policy";
import { SAAS_MAPPING_SPEC } from "./adapters/saasActivation";

const SPEC: MappingSpec = {
  canonicalFields: ["entity_id", "signed_at", "amount_field"],
  synonyms: { entity_id: ["customer_id", "account_id"], amount_field: ["amount"] },
  requiredFields: ["entity_id", "signed_at"],
};

describe("autoDetectMapping", () => {
  it("prefers an exact (case-insensitive) header match over a synonym", () => {
    const d = autoDetectMapping(["Entity_ID", "signed_at", "customer_id"], SPEC);
    expect(d.mapping["entity_id"]).toBe("Entity_ID"); // exact (case-insensitive) wins over customer_id
    expect(d.synonymMatched).not.toContain("entity_id");
    expect(d.unmatchedRequired).toEqual([]);
  });

  it("falls back to a synonym and reports it as a guess", () => {
    const d = autoDetectMapping(["customer_id", "signed_at", "amount"], SPEC);
    expect(d.mapping["entity_id"]).toBe("customer_id");
    expect(d.mapping["amount_field"]).toBe("amount");
    expect(d.synonymMatched).toContain("entity_id");
  });

  it("reports required fields with no match", () => {
    const d = autoDetectMapping(["foo", "bar"], SPEC);
    expect(d.unmatchedRequired.sort()).toEqual(["entity_id", "signed_at"]);
  });
});

describe("applyMapping", () => {
  it("re-keys cells to canonical names while preserving originals and row identity", () => {
    const parsed = parseCsv("customer_id,signed_at\nACME,2026-01-01");
    const mapped = applyMapping(parsed, { entity_id: "customer_id" });
    expect(mapped.headers).toContain("entity_id");
    expect(mapped.headers).toContain("customer_id"); // original preserved
    expect(mapped.rows[0]!.cells["entity_id"]).toBe("ACME");
    expect(mapped.rows[0]!.cells["customer_id"]).toBe("ACME");
    expect(mapped.rows[0]!.sourceRowId).toBe("row-1");
  });

  it("is a no-op in effect when the file already uses canonical names", () => {
    const parsed = parseCsv("entity_id\nACME");
    const mapped = applyMapping(parsed, { entity_id: "entity_id" });
    expect(mapped.rows[0]!.cells["entity_id"]).toBe("ACME");
  });
});

describe("mappingId", () => {
  it("is deterministic and order-independent", () => {
    expect(mappingId({ a: "x", b: "y" })).toBe(mappingId({ b: "y", a: "x" }));
  });
  it("differs when the mapping differs", () => {
    expect(mappingId({ a: "x" })).not.toBe(mappingId({ a: "z" }));
  });
});

// --- End-to-end through the real assess path ------------------------------------------------------
const CANON =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD";

// A Stripe/CRM-style export: none of the required columns use our canonical names.
const FOREIGN =
  "customer_id,created_at,activated_at,invoice_due_date,amount,ccy\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD";

describe("planColumnMapping (pre-flight the UI uses)", () => {
  it("does NOT need review when every required column matches exactly", () => {
    const plan = planColumnMapping(CANON);
    expect(plan.needsReview).toBe(false);
    expect(plan.unmatchedRequired).toEqual([]);
  });

  it("needs review when required columns matched only by synonym", () => {
    const plan = planColumnMapping(FOREIGN);
    expect(plan.needsReview).toBe(true);
    expect(plan.mapping["entity_id"]).toBe("customer_id");
    expect(plan.mapping["next_invoice_amount"]).toBe("amount");
    expect(plan.mapping["currency"]).toBe("ccy");
  });
});

describe("assessCsv with column mapping", () => {
  const policy = () => makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

  it("runs a foreign-header CSV via auto-detected synonyms and reports the same observed value", async () => {
    const canon = await assessCsv(CANON, policy(), { createdAt: "2026-03-02T00:00:00.000Z" });
    const foreign = await assessCsv(FOREIGN, policy(), { createdAt: "2026-03-02T00:00:00.000Z" });
    expect(foreign.acceptedCycleCount).toBe(1);
    expect(foreign.observed.observedUnpaid.minor).toBe(canon.observed.observedUnpaid.minor);
    expect(foreign.columnMapping["entity_id"]).toBe("customer_id");
  });

  it("still fails LOUDLY when a required column is absent even after mapping", async () => {
    await expect(assessCsv("foo,bar\n1,2", policy(), { createdAt: "2026-03-02T00:00:00.000Z" })).rejects.toThrow(
      /missing required column/i,
    );
  });

  it("folds the mapping into assessmentId — a different mapping is a different assessment", async () => {
    const auto = await assessCsv(FOREIGN, policy(), { createdAt: "2026-03-02T00:00:00.000Z" });
    // Force an explicit, different (wrong-but-valid-shape) mapping over the same bytes.
    const alt = await assessCsv(FOREIGN, policy(), {
      createdAt: "2026-03-02T00:00:00.000Z",
      mapping: { ...auto.columnMapping, entity_id: "created_at" },
    });
    expect(alt.mappingId).not.toBe(auto.mappingId);
    expect(alt.assessmentId).not.toBe(auto.assessmentId);
  });

  it("exposes the SaaS mapping spec required set", () => {
    expect(SAAS_MAPPING_SPEC.requiredFields).toContain("entity_id");
  });
});
