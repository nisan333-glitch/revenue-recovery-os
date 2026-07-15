import { describe, it, expect } from "vitest";
import { toCycle } from "./saasActivation";
import type { RawRow } from "../parse";
import { makePolicy } from "../policy";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD", excludedStatuses: ["internal"] });

function raw(cells: Record<string, string>, malformed = false): RawRow {
  return { sourceRowId: "row-1", cells, malformed };
}

const base: Record<string, string> = {
  entity_id: "E1",
  subscription_id: "SUB-1",
  signed_at: "2026-01-01",
  activation_at: "",
  next_invoice_due_at: "2026-02-01",
  next_invoice_paid_at: "",
  next_invoice_amount: "10000.00",
  currency: "USD",
  status: "",
  is_test: "",
};

describe("saasActivation adapter — mapping and exclusions", () => {
  it("maps a valid row to a neutral ExpectationCycle (exact minor units)", () => {
    const out = toCycle(raw(base), policy);
    expect(out.kind).toBe("cycle");
    if (out.kind !== "cycle") return;
    expect(out.cycle.cycleId).toBe("SUB-1");
    expect(out.cycle.entityId).toBe("E1");
    expect(out.cycle.observationAt).toBeNull();
    expect(out.cycle.monetaryEvent.amount.minor).toBe(10000_00);
    expect(out.cycle.currency).toBe("USD");
  });

  it("derives a deterministic composite cycleId when no explicit id is present", () => {
    const { subscription_id, ...noSub } = base;
    void subscription_id;
    const out = toCycle(raw(noSub), policy);
    if (out.kind !== "cycle") throw new Error("expected cycle");
    expect(out.cycle.cycleId).toBe("E1|2026-01-01|2026-02-01");
  });

  it("excludes a malformed row", () => {
    const out = toCycle(raw(base, true), policy);
    expect(out).toMatchObject({ kind: "excluded", exclusion: { reason: "unparseable_row" } });
  });

  it("excludes a missing required field", () => {
    const out = toCycle(raw({ ...base, next_invoice_amount: "" }), policy);
    expect(out).toMatchObject({ kind: "excluded", exclusion: { reason: "missing_required_field", detail: "next_invoice_amount" } });
  });

  it("excludes test and excluded-status accounts", () => {
    expect(toCycle(raw({ ...base, is_test: "true" }), policy)).toMatchObject({ exclusion: { reason: "internal_or_test_account" } });
    expect(toCycle(raw({ ...base, status: "internal" }), policy)).toMatchObject({ exclusion: { reason: "excluded_status" } });
  });

  it("excludes a currency that does not match the single-currency policy", () => {
    expect(toCycle(raw({ ...base, currency: "EUR" }), policy)).toMatchObject({ exclusion: { reason: "currency_mismatch" } });
  });

  it("rejects ambiguous dates without a locale, accepts with one", () => {
    expect(toCycle(raw({ ...base, signed_at: "02/03/2026" }), policy)).toMatchObject({ exclusion: { reason: "ambiguous_date" } });
    const ok = toCycle(raw({ ...base, signed_at: "02/03/2026" }), policy, { locale: "DMY" });
    expect(ok.kind).toBe("cycle");
  });

  it("normalizes a boolean paid flag (no timestamp) to paid-at-due, flagged as unknown timing", () => {
    const out = toCycle(raw({ ...base, next_invoice_paid: "true" }), policy);
    if (out.kind !== "cycle") throw new Error("expected cycle");
    expect(out.cycle.monetaryEvent.paidAt).toBe("2026-02-01"); // due date (compatibility)
    expect(out.cycle.attributes["paid_timing"]).toBe("unknown_from_bool");
  });

  it("excludes zero and negative amounts explicitly", () => {
    expect(toCycle(raw({ ...base, next_invoice_amount: "0.00" }), policy)).toMatchObject({ exclusion: { reason: "zero_amount" } });
    expect(toCycle(raw({ ...base, next_invoice_amount: "-5.00" }), policy)).toMatchObject({ exclusion: { reason: "negative_amount" } });
  });

  it("preserves Unicode entity and cycle identifiers", () => {
    const out = toCycle(raw({ ...base, entity_id: " Acmé—Ünïçødé ", subscription_id: "SUB‑✓‑Ω" }), policy);
    if (out.kind !== "cycle") throw new Error("expected cycle");
    expect(out.cycle.entityId).toBe("Acmé—Ünïçødé"); // trimmed, case + Unicode intact
    expect(out.cycle.cycleId).toBe("SUB‑✓‑Ω");
  });
});
