import { describe, it, expect } from "vitest";
import { runAssessment } from "./runAssessment";

const P = { n: 30, asOf: "2026-03-01", currency: "USD" };
const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

describe("runAssessment — the container flows at the real code path", () => {
  it("valid CSV reaches a result", async () => {
    const o = await runAssessment(CSV, P);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.result.acceptedCycleCount).toBe(2);
      expect(o.result.observed.observedUnpaid.minor).toBe(10000_00);
    }
  });

  it("BOM-prefixed CSV succeeds (not silently zero)", async () => {
    const o = await runAssessment(String.fromCharCode(0xfeff) + CSV, P);
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.result.acceptedCycleCount).toBe(2);
  });

  it("missing required headers → visible error outcome", async () => {
    const o = await runAssessment("foo,bar\n1,2", P);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toMatch(/missing required column/i);
  });

  it("invalid currency → error outcome, never a throw/crash", async () => {
    const o = await runAssessment(CSV, { ...P, currency: "US" });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toMatch(/unsupported currency/i);
  });

  it("changing N re-runs with a different classification", async () => {
    const mid =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,2026-01-01,2026-02-20,2026-02-25,10000.00,USD"; // ~50 days
    const a = await runAssessment(mid, { ...P, n: 30 });
    const b = await runAssessment(mid, { ...P, n: 90 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.result.stalledCount).toBe(1);
      expect(b.result.stalledCount).toBe(0);
    }
  });

  it("a failed re-run returns an error outcome (caller keeps the prior result)", async () => {
    const o = await runAssessment(CSV, { ...P, currency: "ZZZ" });
    expect(o.ok).toBe(false);
  });
});
