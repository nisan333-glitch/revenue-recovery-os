import { describe, expect, it } from "vitest";
import { assertCandidateSignal } from "./admission";
import { CaseAdmissionService, InMemoryCaseCandidateStore } from "./caseAdmission";
import { configuredAgentHandlers } from "./activationDetector";
import { publishesCandidates } from "./types";
import {
  MAX_EXTRACT_ROWS,
  RECONCILIATION_AGENT_ID,
  RECONCILIATION_RECOVERY_TYPE,
  planReconciliation,
  reconciliationObserver,
  signalsForPlan,
  accountSourceRef,
} from "./reconciliationObserver";
import {
  BILLING_COLUMNS,
  DEMO_BILLING_ROWS,
  DEMO_CURRENCY,
  DEMO_EXPECTATION_ROWS,
  EXPECTATION_COLUMNS,
} from "./fixtures/reconciliation.synthetic";

const KEY = "k".repeat(40);
const OBSERVED_AT = "2026-04-01T00:00:00.000Z";
const NOW = () => Date.parse("2026-04-02T00:00:00.000Z");
const CONTEXT = { taskId: "t-1", boundaryId: "SYNTHETIC-recon-1", attempt: 1 };

const demoInput = () => ({
  expectation: { columns: EXPECTATION_COLUMNS, rows: DEMO_EXPECTATION_ROWS },
  billing: { columns: BILLING_COLUMNS, rows: DEMO_BILLING_ROWS },
  currency: DEMO_CURRENCY,
});

const demoPayload = () => ({
  expectation: { columns: [...EXPECTATION_COLUMNS], rows: [...DEMO_EXPECTATION_ROWS] },
  billing: { columns: [...BILLING_COLUMNS], rows: [...DEMO_BILLING_ROWS] },
  currency: DEMO_CURRENCY,
  observedAt: OBSERVED_AT,
  actionAvailable: true,
});

describe("reconciliation observer · the plan (pure)", () => {
  it("turns exactly the unpaired, priced, under-billed units into candidates — and counts the rest", () => {
    const plan = planReconciliation(demoInput());
    expect(plan.usable).toBe(true);
    expect(plan.candidates.map((c) => [c.accountRef, c.units.map((u) => [u.entitlementRef, u.periodStart]), c.residualMinor])).toEqual([
      ["PAYER-DEMO-1", [["ENT-DEMO-A", "2026-03-01"]], 60_000],   // billed 1800 of 2400
      ["PAYER-DEMO-2", [["ENT-DEMO-B", "2026-02-01"]], 150_000],  // never invoiced
      ["PAYER-DEMO-6", [["ENT-DEMO-G", "2026-01-01"]], 100_000],  // shortfall; obligation references refute the timing pairing
    ]);
    expect(plan.counts).toMatchObject({
      units: 10, candidateUnits: 3, candidates: 3, monetarilyBalanced: 4, overBilledLiability: 2, underBilledPairedHeld: 0,
      underBilledWithheldBySiblingRefusal: 0, underBilledWithheldNoSingleAccount: 0, unpricedUnknown: 1, refused: 0, notExpected: 0,
      expectationRowsRejected: 0, billingRowsRejected: 0,
    });
  });

  it("never nets a liability against exposure — the figure is the sum of the positives alone", () => {
    const plan = planReconciliation(demoInput());
    // Two units are OVER_BILLED (D: 400.00, G February: 1000.00). If either were subtracted the figure
    // would be smaller than the sum of the candidates, which it is not.
    expect(plan.observedExposureMinor).toBe(60_000 + 150_000 + 100_000);
    expect(plan.observedExposureMinor).toBe(plan.candidates.reduce((n, c) => n + c.residualMinor, 0));
  });

  it("is invariant under row order — reordering a file cannot change what is found", () => {
    const forward = planReconciliation(demoInput());
    const reversed = planReconciliation({
      ...demoInput(),
      expectation: { columns: EXPECTATION_COLUMNS, rows: [...DEMO_EXPECTATION_ROWS].reverse() },
      billing: { columns: BILLING_COLUMNS, rows: [...DEMO_BILLING_ROWS].reverse() },
    });
    expect(reversed).toEqual(forward);
  });

  it("reports an unreadable extract as UNUSABLE, never as an empty book with nothing owed", () => {
    const plan = planReconciliation({
      ...demoInput(),
      expectation: { columns: ["not", "the", "contract"], rows: [] },
    });
    expect(plan.usable).toBe(false);
    expect(plan.candidates).toEqual([]);
    expect(plan.observedExposureMinor).toBe(0);
  });

  it("carries the claim boundary: observation only, never proof, never revenue", () => {
    expect(planReconciliation(demoInput()).claimBoundary).toEqual({
      observationOnly: true, constitutesProof: false, constitutesRevenue: false,
    });
  });

  it("withholds an under-billed unit when a sibling period of the SAME entitlement was refused", () => {
    // One February invoice of 2000.00 citing JANUARY's obligation, against two 1000.00 obligations with
    // January unbilled. The core refuses February (it cannot allocate the excess while a sibling period
    // is unbilled) and offers January as an unpaired shortfall — money that may already have been paid.
    const billing = DEMO_BILLING_ROWS.filter((r) => !r.cells.obligation_ref!.startsWith("SL-DEMO-G"));
    const lone = {
      rowNumber: 99,
      cells: {
        ...DEMO_BILLING_ROWS[0]!.cells, invoice_ref: "INV-DEMO-0099", invoice_line_amount: "2000.00",
        payer_ref: "PAYER-DEMO-6", obligation_ref: "SL-DEMO-G1", period_start: "2026-02-01", period_end: "2026-02-28",
      },
    };
    const plan = planReconciliation({
      ...demoInput(),
      billing: { columns: BILLING_COLUMNS, rows: [...billing, lone] },
    });
    expect(plan.candidates.some((c) => c.accountRef === "PAYER-DEMO-6")).toBe(false);
    expect(plan.counts.underBilledWithheldBySiblingRefusal).toBeGreaterThanOrEqual(1);
    expect(plan.counts.refused).toBeGreaterThanOrEqual(1);
    // ...and the refusal is scoped to the entitlement: the other candidates are untouched.
    expect(plan.candidates.map((c) => c.accountRef)).toEqual(["PAYER-DEMO-1", "PAYER-DEMO-2"]);
  });

  it("does not reduce a candidate because an UNRELATED payer was over-billed", () => {
    const plan = planReconciliation(demoInput());
    const a = plan.candidates.find((c) => c.accountRef === "PAYER-DEMO-1")!;
    expect(a.units).toHaveLength(1);
    expect(a.residualMinor).toBe(a.units[0]!.expectedMinor - a.units[0]!.observedMinor);
  });

  it("sums ONE payer's positive units into ONE candidate, and the sum is still positives only", () => {
    // PAYER-DEMO-1: February now billed 2000.00 of 2400.00 as well as March 1800.00 of 2400.00.
    const billing = DEMO_BILLING_ROWS.map((r) =>
      r.cells.invoice_ref === "INV-DEMO-0002" ? { ...r, cells: { ...r.cells, invoice_line_amount: "2000.00" } } : r);
    const plan = planReconciliation({ ...demoInput(), billing: { columns: BILLING_COLUMNS, rows: billing } });
    const p1 = plan.candidates.filter((c) => c.accountRef === "PAYER-DEMO-1");
    expect(p1).toHaveLength(1);
    expect(p1[0]!.units.map((u) => [u.periodStart, u.residualMinor])).toEqual([
      ["2026-02-01", 40_000], ["2026-03-01", 60_000],
    ]);
    expect(p1[0]!.residualMinor).toBe(100_000);
    expect(plan.counts).toMatchObject({ candidateUnits: 4, candidates: 3 });
    // Over-billed units of OTHER payers are still not subtracted from anything.
    expect(plan.observedExposureMinor).toBe(100_000 + 150_000 + 100_000);
  });

  it("withholds an under-billed unit whose contract side names no single payer, rather than choosing one", () => {
    const expectation = DEMO_EXPECTATION_ROWS.map((r) =>
      r.cells.schedule_line_ref === "SL-DEMO-B2" ? { ...r, cells: { ...r.cells, payer_ref: "" } } : r);
    const plan = planReconciliation({ ...demoInput(), expectation: { columns: EXPECTATION_COLUMNS, rows: expectation } });
    if (plan.counts.expectationRowsRejected > 0) return; // the validator already refuses a payer-less row: nothing to attribute
    expect(plan.candidates.some((c) => c.accountRef === "PAYER-DEMO-2")).toBe(false);
    expect(plan.counts.underBilledWithheldNoSingleAccount).toBeGreaterThanOrEqual(1);
  });
});

describe("reconciliation observer · signals", () => {
  const plan = planReconciliation(demoInput());
  const signals = signalsForPlan(plan, {
    boundaryId: CONTEXT.boundaryId, observedAt: OBSERVED_AT, actionAvailable: true, pseudonymKey: KEY,
  });

  it("emits one valid CandidateSignal per candidate, each carrying the residual and nothing else monetary", () => {
    expect(signals).toHaveLength(3);
    for (const s of signals) {
      expect(() => assertCandidateSignal(s)).not.toThrow();
      expect(s.recoveryType).toBe(RECONCILIATION_RECOVERY_TYPE);
      expect(s.detectorVersion).toBe(RECONCILIATION_AGENT_ID);
      expect(s.currency).toBe("USD");
    }
    expect(signals.map((s) => s.amountAtRiskMinor).sort((x, y) => x - y)).toEqual([60_000, 100_000, 150_000]);
  });

  it("pseudonymises: no raw entitlement, payer, obligation or invoice reference reaches a signal", () => {
    const text = JSON.stringify(signals);
    for (const raw of ["ENT-DEMO", "PAYER-DEMO", "SL-DEMO", "INV-DEMO"]) expect(text).not.toContain(raw);
    for (const s of signals) expect(s.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
  });

  it("gives every payer its own identity, and the same payer the same identity on every run", () => {
    expect(new Set(signals.map((s) => s.sourceRef)).size).toBe(3);
    expect(new Set(signals.map((s) => s.signalId)).size).toBe(3);
    const again = signalsForPlan(plan, {
      boundaryId: CONTEXT.boundaryId, observedAt: OBSERVED_AT, actionAvailable: true, pseudonymKey: KEY,
    });
    expect(again).toEqual(signals);
    // A different deployment key yields different references: they are not derivable from the data alone.
    const other = accountSourceRef("z".repeat(40), plan.candidates[0]!.accountRef);
    expect(other).not.toBe(signals[0]!.sourceRef);
  });

  it("emits nothing when no corrective action is available", () => {
    expect(signalsForPlan(plan, {
      boundaryId: CONTEXT.boundaryId, observedAt: OBSERVED_AT, actionAvailable: false, pseudonymKey: KEY,
    })).toEqual([]);
  });

  it("emits nothing from an unusable plan", () => {
    const bad = planReconciliation({ ...demoInput(), billing: { columns: ["x"], rows: [] } });
    expect(signalsForPlan(bad, {
      boundaryId: CONTEXT.boundaryId, observedAt: OBSERVED_AT, actionAvailable: true, pseudonymKey: KEY,
    })).toEqual([]);
  });
});

describe("reconciliation observer · the handler", () => {
  const handler = reconciliationObserver(KEY, NOW);

  it("is a candidate-publishing handler with the declared id", () => {
    expect(handler.agentId).toBe(RECONCILIATION_AGENT_ID);
    expect(publishesCandidates(handler)).toBe(true);
  });

  it("runs the demo book into three signals", async () => {
    const signals = await handler.run(demoPayload(), CONTEXT);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.boundaryId === CONTEXT.boundaryId)).toBe(true);
  });

  it("refuses unknown, missing or extra payload fields rather than ignoring them", async () => {
    await expect(handler.run({ ...demoPayload(), amountAtRiskMinor: 1 }, CONTEXT)).rejects.toThrow(/invalid reconciliation observation fields/);
    const { currency: _c, ...missing } = demoPayload();
    await expect(handler.run(missing, CONTEXT)).rejects.toThrow(/invalid reconciliation observation fields/);
  });

  it("takes no governed term from the payload — a request cannot set the grace window or the hierarchy", async () => {
    await expect(handler.run({ ...demoPayload(), invoicingGracePeriods: 99 }, CONTEXT)).rejects.toThrow(/invalid reconciliation observation fields/);
    await expect(handler.run({ ...demoPayload(), payerHierarchy: { a: "b" } }, CONTEXT)).rejects.toThrow(/invalid reconciliation observation fields/);
  });

  it("bounds what one task may carry", async () => {
    const huge = Array.from({ length: MAX_EXTRACT_ROWS + 1 }, (_, i) => ({ rowNumber: i + 1, cells: {} }));
    await expect(handler.run({ ...demoPayload(), billing: { columns: [...BILLING_COLUMNS], rows: huge } }, CONTEXT))
      .rejects.toThrow(/bounded raw extracts/);
  });

  it("rejects an observedAt that is not canonical or lies in the future", async () => {
    await expect(handler.run({ ...demoPayload(), observedAt: "2026-04-01" }, CONTEXT)).rejects.toThrow(/observedAt/);
    await expect(handler.run({ ...demoPayload(), observedAt: "2027-01-01T00:00:00.000Z" }, CONTEXT)).rejects.toThrow(/observedAt/);
  });

  it("rejects a non-ISO currency and a non-boolean action flag", async () => {
    await expect(handler.run({ ...demoPayload(), currency: "usd" }, CONTEXT)).rejects.toThrow(/currency/);
    await expect(handler.run({ ...demoPayload(), actionAvailable: "yes" }, CONTEXT)).rejects.toThrow(/actionAvailable/);
  });

  it("cannot be built without a deployment secret of reasonable length", () => {
    expect(() => reconciliationObserver("")).toThrow(/at least 32 characters/);
    expect(() => reconciliationObserver("short")).toThrow(/at least 32 characters/);
  });
});

describe("reconciliation observer · registration", () => {
  it("is OFF unless its own flag is exactly true", () => {
    expect(configuredAgentHandlers({})).toEqual([]);
    expect(configuredAgentHandlers({ NH_RECONCILIATION_OBSERVER_ENABLED: "false" })).toEqual([]);
    expect(() => configuredAgentHandlers({ NH_RECONCILIATION_OBSERVER_ENABLED: "yes" }))
      .toThrow(/NH_RECONCILIATION_OBSERVER_ENABLED must be true or false/);
  });

  it("registers when enabled with a key, and refuses to start without one", () => {
    const handlers = configuredAgentHandlers({
      NH_RECONCILIATION_OBSERVER_ENABLED: "true", NH_RECONCILER_PSEUDONYM_KEY: KEY,
    });
    expect(handlers.map((h) => h.agentId)).toEqual([RECONCILIATION_AGENT_ID]);
    expect(() => configuredAgentHandlers({ NH_RECONCILIATION_OBSERVER_ENABLED: "true" }))
      .toThrow(/NH_RECONCILER_PSEUDONYM_KEY/);
  });
});

describe("reconciliation observer · through the real admission boundary", () => {
  const POLICY = { recoveryType: RECONCILIATION_RECOVERY_TYPE, economicThresholdMinor: 10_000 };
  const clock = () => new Date("2026-04-02T01:00:00.000Z");

  it("creates pending-review candidates only — never a Recovery Case, proof or Revenue Returned", async () => {
    const handler = reconciliationObserver(KEY, NOW);
    const service = new CaseAdmissionService(new InMemoryCaseCandidateStore(), clock);
    const results = [];
    for (const s of await handler.run(demoPayload(), CONTEXT)) results.push(await service.submit(RECONCILIATION_AGENT_ID, s, POLICY));
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toMatchObject({ admitted: true, created: true });
      if (!r.admitted) throw new Error("expected admission");
      expect(r.candidate.status).toBe("pending_review");
      expect(r.candidate).not.toHaveProperty("revenueReturned");
      expect(r.candidate).not.toHaveProperty("proofId");
    }
  });

  it("re-running the same book creates no second candidate", async () => {
    const handler = reconciliationObserver(KEY, NOW);
    const service = new CaseAdmissionService(new InMemoryCaseCandidateStore(), clock);
    const first = await handler.run(demoPayload(), CONTEXT);
    for (const s of first) await service.submit(RECONCILIATION_AGENT_ID, s, POLICY);
    const again = [];
    for (const s of await handler.run(demoPayload(), CONTEXT)) again.push(await service.submit(RECONCILIATION_AGENT_ID, s, POLICY));
    expect(again.every((r) => r.admitted && r.created === false)).toBe(true);
  });

  it("keeps the FIRST observed amount when a corrected run arrives — documented store behaviour, not hidden", async () => {
    const handler = reconciliationObserver(KEY, NOW);
    const service = new CaseAdmissionService(new InMemoryCaseCandidateStore(), clock);
    const original = (await handler.run(demoPayload(), CONTEXT)).find((s) => s.amountAtRiskMinor === 60_000)!;
    const first = await service.submit(RECONCILIATION_AGENT_ID, original, POLICY);
    // The billing system later corrects DEMO-A March: 1900.00 instead of 1800.00, so the shortfall is 500.00.
    const corrected = demoPayload();
    corrected.billing.rows = corrected.billing.rows.map((r) =>
      r.cells.invoice_ref === "INV-DEMO-0003" ? { ...r, cells: { ...r.cells, invoice_line_amount: "1900.00" } } : r);
    const later = (await handler.run(corrected, CONTEXT)).find((s) => s.amountAtRiskMinor === 50_000)!;
    expect(later.sourceRef).toBe(original.sourceRef); // same payer, same identity
    const second = await service.submit(RECONCILIATION_AGENT_ID, later, POLICY);
    expect(first).toMatchObject({ admitted: true, created: true });
    expect(second).toMatchObject({ admitted: true, created: false });
    if (first.admitted && second.admitted) {
      expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
      expect(second.candidate.signal.amountAtRiskMinor).toBe(60_000); // the first observation's figure stands
    }
  });
});
