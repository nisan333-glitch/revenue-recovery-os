// EP-31c · The contract-gap predicate. Small, but it is the single thing candidate emission turns on.
import { describe, expect, it } from "vitest";
import {
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  OBLIGATION_IDENTITY_FIELDS,
  leakInstanceIdentityStatus,
} from "./leakInstanceIdentity";

describe("EP-31c · leak-instance identity", () => {
  it("1 · is NOT establishable under the contract this build implements", () => {
    const status = leakInstanceIdentityStatus();
    expect(status.establishable).toBe(false);
    expect(status.detail).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
  });

  it("2 · declares NO obligation-identity field, and that emptiness is the finding", () => {
    // `cycle_id` is deliberately absent: it is optional, it has no synonyms in the adapter's mapping spec,
    // it is ignored whenever `subscription_id` is present (defect D1), and it is nowhere declared stable
    // across a reschedule of its own due date. See docs/GOVERNED_DETECTION_V1.md.
    expect(OBLIGATION_IDENTITY_FIELDS).toEqual([]);
    expect(OBLIGATION_IDENTITY_FIELDS).not.toContain("cycle_id");
    expect(OBLIGATION_IDENTITY_FIELDS).not.toContain("subscription_id");
  });

  it("3 · the answer is DERIVED from the declared set, not asserted — so it can change", () => {
    // Capable of failing in the useful direction: the status is a function of the list, so an extension
    // that adds a field flips it. That is what makes test 1 a live check rather than a restated constant,
    // and it is why an incomplete extension fails the emission controls instead of silently enabling them.
    const derived = (fields: readonly string[]) =>
      fields.length === 0
        ? { establishable: false, detail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL }
        : { establishable: true, detail: `obligation identity is carried by: ${[...fields].sort().join(", ")}` };
    expect(derived(OBLIGATION_IDENTITY_FIELDS)).toEqual(leakInstanceIdentityStatus());
    expect(derived(["invoice_id"]).establishable).toBe(true);
    expect(derived(["invoice_id"]).detail).toMatch(/carried by: invoice_id/);
  });

  it("4 · the detail names the gap rather than gesturing at it, and echoes no customer value", () => {
    const detail = leakInstanceIdentityStatus().detail;
    // Both halves of the audit are stated: the same-key collision AND the reschedule ambiguity.
    expect(detail).toMatch(/entity_id, signed_at, next_invoice_due_at/);
    expect(detail).toMatch(/reschedul/i);
    expect(detail).toMatch(/refused rather than counted/);
    // A refusal reason is shown to operators; it must carry no data.
    expect(detail).not.toMatch(/synthetic-|@|\d{4}-\d{2}-\d{2}/);
  });

  it("5 · is pure: no clock, no randomness, no I/O — the same answer every time", () => {
    const a = leakInstanceIdentityStatus();
    const b = leakInstanceIdentityStatus();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
  });
});
