import { describe, it, expect } from "vitest";
import {
  buildAssessmentRecord,
  verifyAssessmentRecord,
  linkAssessmentRecord,
  verifyAssessmentChain,
  canonicalizeAssessment,
  stableStringify,
  ASSESSMENT_RECORD_VERSION,
  type TamperEvidentRecord,
} from "./record";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";
import type { AssessmentResult } from "./types";

const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

const AT = "2026-03-02T00:00:00.000Z";
const sample = (createdAt = AT, csv = CSV): Promise<AssessmentResult> =>
  assessCsv(csv, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), { createdAt });

describe("stableStringify", () => {
  it("is deterministic regardless of key insertion order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("canonicalizeAssessment", () => {
  it("produces identical bytes for the same result", async () => {
    const r = await sample();
    expect(canonicalizeAssessment(r)).toBe(canonicalizeAssessment(r));
  });
});

describe("buildAssessmentRecord / verifyAssessmentRecord", () => {
  it("a freshly built record verifies", async () => {
    const rec = await buildAssessmentRecord(await sample());
    expect(rec.recordVersion).toBe(ASSESSMENT_RECORD_VERSION);
    expect(rec.algo).toBe("SHA-256");
    expect(rec.previousHash).toBeNull();
    expect(rec.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyAssessmentRecord(rec)).toBe(true);
  });

  it("identical results (same createdAt) ⇒ identical record hash; a changed number ⇒ a different hash", async () => {
    const a = await buildAssessmentRecord(await sample());
    const b = await buildAssessmentRecord(await sample());
    expect(b.recordHash).toBe(a.recordHash);

    const changed =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,2026-01-01,,2026-02-01,12345.00,USD"; // different observed value
    const c = await buildAssessmentRecord(await sample(AT, changed));
    expect(c.recordHash).not.toBe(a.recordHash);
  });

  it("detects tampering with the canonical content", async () => {
    const rec = await buildAssessmentRecord(await sample());
    const tampered: TamperEvidentRecord = {
      ...rec,
      canonical: rec.canonical.replace("1000000", "9999999"), // alter the observed minor units
    };
    expect(await verifyAssessmentRecord(tampered)).toBe(false);
  });

  it("detects a swapped recordHash", async () => {
    const rec = await buildAssessmentRecord(await sample());
    const forged: TamperEvidentRecord = { ...rec, recordHash: "0".repeat(64) };
    expect(await verifyAssessmentRecord(forged)).toBe(false);
  });
});

describe("chaining", () => {
  it("links records and verifies the whole chain", async () => {
    const r1 = await buildAssessmentRecord(await sample());
    const r2 = await linkAssessmentRecord(r1, await sample(AT, CSV.replace("10000.00", "20000.00")));
    expect(r2.previousHash).toBe(r1.recordHash);
    expect(await verifyAssessmentChain([r1, r2])).toBe(true);
  });

  it("a tampered earlier record breaks the chain", async () => {
    const r1 = await buildAssessmentRecord(await sample());
    const r2 = await linkAssessmentRecord(r1, await sample(AT, CSV.replace("10000.00", "20000.00")));
    const r1Tampered: TamperEvidentRecord = { ...r1, canonical: r1.canonical.replace("1000000", "1") };
    // r2.previousHash still points at r1's ORIGINAL hash → chain no longer consistent.
    expect(await verifyAssessmentChain([r1Tampered, r2])).toBe(false);
  });

  it("a reordered chain is rejected", async () => {
    const r1 = await buildAssessmentRecord(await sample());
    const r2 = await linkAssessmentRecord(r1, await sample(AT, CSV.replace("10000.00", "20000.00")));
    expect(await verifyAssessmentChain([r2, r1])).toBe(false);
  });
});
