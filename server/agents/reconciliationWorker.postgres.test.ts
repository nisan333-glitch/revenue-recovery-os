import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "./bootstrap";
import { configuredAgentHandlers } from "./activationDetector";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE } from "./reconciliationObserver";
import {
  BILLING_COLUMNS,
  DEMO_BILLING_ROWS,
  DEMO_CURRENCY,
  DEMO_EXPECTATION_ROWS,
  EXPECTATION_COLUMNS,
} from "./fixtures/reconciliation.synthetic";

// THE PRODUCTION PATH, NOT THE IN-MEMORY ONE. `reconciliationObserver.test.ts` drives the reconciler
// through `InMemoryCaseCandidateStore`, which is a different lane from what runs in production — the
// obligation-merge slice already corrected one claim made from exactly that mistake. This test queues a
// SYNTHETIC book through the real task store, the real worker and the real Postgres candidate store.
describe.skipIf(!process.env.DATABASE_URL)("reconciliation worker controlled operation", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  const payload = (billingOverride?: (r: (typeof DEMO_BILLING_ROWS)[number]) => (typeof DEMO_BILLING_ROWS)[number]) => ({
    expectation: { columns: [...EXPECTATION_COLUMNS], rows: DEMO_EXPECTATION_ROWS },
    billing: { columns: [...BILLING_COLUMNS], rows: billingOverride ? DEMO_BILLING_ROWS.map(billingOverride) : DEMO_BILLING_ROWS },
    currency: DEMO_CURRENCY,
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    actionAvailable: true,
  });

  it("turns a synthetic book into pending candidates only — one per under-billed payer, no case, no proof", async () => {
    const boundaryId = `SYNTHETIC-recon-worker-${randomUUID()}`;
    const env = {
      NH_AGENTS_ENABLED: "true", NH_RECONCILIATION_OBSERVER_ENABLED: "true",
      NH_RECONCILER_PSEUDONYM_KEY: `test-${randomUUID()}-${randomUUID()}`,
      NH_AGENT_BOUNDARIES: boundaryId,
      NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:10000`, NH_AGENT_IDLE_DELAY_MS: "10",
    };
    const worker = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
    const store = createPostgresAgentTaskStore();
    const enqueue = (p: unknown) => store.enqueueIfAbsent({
      taskId: randomUUID(), boundaryId, agentId: RECONCILIATION_AGENT_ID,
      idempotencyKey: randomUUID(), now: Date.now(), payload: p,
    });
    await enqueue(payload());
    worker.start();
    try {
      const count = () => prisma.agentCaseCandidateRecord.count({ where: { boundaryId } });
      const wait = async (n: number) => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && (await count()) < n) await new Promise((r) => setTimeout(r, 25));
      };
      await wait(3);
      expect(worker.readiness().status).toBe("up");

      const rows = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
      expect(rows).toHaveLength(3);
      const signals = rows.map((r) => r.signal as { amountAtRiskMinor: number; sourceRef: string; recoveryType: string });
      expect(signals.map((s) => s.amountAtRiskMinor).sort((a, b) => a - b)).toEqual([60_000, 100_000, 150_000]);
      expect(signals.every((s) => s.recoveryType === RECONCILIATION_RECOVERY_TYPE)).toBe(true);
      expect(signals.every((s) => /^hmac-sha256:[a-f0-9]{64}$/.test(s.sourceRef))).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/(ENT|PAYER|SL|INV)-DEMO/);
      expect(rows.every((r) => r.status === "pending_review")).toBe(true);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);

      // A SECOND observation of the same payers, with one billed amount corrected. The store keeps the
      // FIRST observation's candidate: no new row, and the original figure stands. That is the documented
      // account-grained behaviour, asserted here on the production store rather than on the in-memory one.
      await enqueue(payload((r) => (r.cells.invoice_ref === "INV-DEMO-0003"
        ? { ...r, cells: { ...r.cells, invoice_line_amount: "1900.00" } } : r)));
      await new Promise((r) => setTimeout(r, 1500));
      const after = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
      expect(after).toHaveLength(3);
      expect(after.map((r) => (r.signal as { amountAtRiskMinor: number }).amountAtRiskMinor).sort((a, b) => a - b))
        .toEqual([60_000, 100_000, 150_000]);
    } finally { await worker.stop(); }
    expect(worker.readiness().status).toBe("down");
  });
});
