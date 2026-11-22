// T1 END TO END, ON THE PRODUCTION PATH: two CSV FILES in, a Recovery Case out.
//
// WHY THIS TEST EXISTS SEPARATELY FROM THE UNIT SUITE. `pilotPairIntake.test.ts` drives the intake
// against an in-memory queue, which is a different lane from what runs in production — the
// obligation-merge slice already corrected one claim made from exactly that mistake, and *a limitation
// measured in a non-production lane is not a product limitation either*. This test uses the real
// Postgres task store, the real agent worker, the real Postgres candidate store and the real promotion
// transaction, and the only thing it supplies is two strings of CSV.
//
// THE FIXTURE IS THE FROZEN DEMO BOOK, SERIALISED. `reconciliationWorker.postgres.test.ts` enqueues
// that book as an in-memory PAYLOAD and asserts three candidates of 60_000 / 100_000 / 150_000. This
// test reaches the same three figures through PARSE -> VALIDATE -> EVALUATE from text, so the assertion
// is not "the intake produced some numbers" but **the file door and the payload door reach the same
// engine and the same money**. Had the CSV transport altered one cell, the figures would differ.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "../agents/bootstrap";
import { configuredAgentHandlers } from "../agents/activationDetector";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { RECONCILIATION_RECOVERY_TYPE } from "../agents/reconciliationObserver";
import { submitPilotPair } from "./pilotPairIntakeService";
import {
  BILLING_COLUMNS,
  DEMO_BILLING_ROWS,
  DEMO_CURRENCY,
  DEMO_EXPECTATION_ROWS,
  EXPECTATION_COLUMNS,
} from "../agents/fixtures/reconciliation.synthetic";
import type { ActorContext } from "../auth/identity";

/** RFC-4180 enough for a fixture with no quotes, commas or newlines inside a cell — asserted below. */
const toCsv = (columns: readonly string[], rows: readonly { cells: Readonly<Record<string, string>> }[]): string => {
  for (const r of rows) {
    for (const v of Object.values(r.cells)) {
      if (/[",\r\n]/.test(v)) throw new Error("fixture cell needs quoting — the serialiser would lie");
    }
  }
  return [columns.join(","), ...rows.map((r) => columns.map((c) => r.cells[c] ?? "").join(","))].join("\n");
};

const EXPECTATION_CSV = toCsv(EXPECTATION_COLUMNS, DEMO_EXPECTATION_ROWS);
const BILLING_CSV = toCsv(BILLING_COLUMNS, DEMO_BILLING_ROWS);

describe.skipIf(!process.env.DATABASE_URL)("T1 · two files reach a Recovery Case", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("file -> task -> candidate -> accepted review -> ONE case, and no second case for the same work", async () => {
    const boundaryId = `SYNTHETIC-pair-intake-${randomUUID()}`;
    const operator: ActorContext = { actorId: `op-${randomUUID()}`, role: "operator", boundaryIds: [boundaryId] };
    const env = {
      NH_AGENTS_ENABLED: "true", NH_RECONCILIATION_OBSERVER_ENABLED: "true",
      NH_RECONCILER_PSEUDONYM_KEY: `test-${randomUUID()}-${randomUUID()}`,
      NH_AGENT_BOUNDARIES: boundaryId,
      NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:10000`, NH_AGENT_IDLE_DELAY_MS: "10",
    };
    const worker = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
    const store = createPostgresAgentTaskStore();
    const submit = () => submitPilotPair(store, operator, {
      boundaryId, expectationCsv: EXPECTATION_CSV, billingCsv: BILLING_CSV, currency: DEMO_CURRENCY,
    });

    // ── 1 · the door ────────────────────────────────────────────────────────────────────────────
    const first = await submit();
    expect(first.accepted).toBe(true);
    expect(first.queued).toBe(true);
    expect(first.expectation!.usable && first.billing!.usable).toBe(true);
    // NOTHING is established yet. The intake is an OBSERVATION, not a finding.
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);

    worker.start();
    try {
      const candidates = () => prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await candidates()).length < 3) await new Promise((r) => setTimeout(r, 25));

      // ── 2 · the SAME money the payload door reaches ───────────────────────────────────────────
      // THE WORKER REALLY RAN. Without this, a fast pass could mean the loop exited for another
      // reason; the task's terminal status is the fact that says a worker read this observation.
      expect(await prisma.agentTaskRecord.count({ where: { boundaryId, status: "succeeded" } })).toBe(1);
      const rows = await candidates();
      expect(rows).toHaveLength(3);
      const signals = rows.map((r) => r.signal as { amountAtRiskMinor: number; sourceRef: string; recoveryType: string; currency: string });
      expect(signals.map((s) => s.amountAtRiskMinor).sort((a, b) => a - b)).toEqual([60_000, 100_000, 150_000]);
      expect(signals.every((s) => s.recoveryType === RECONCILIATION_RECOVERY_TYPE)).toBe(true);
      expect(signals.every((s) => s.currency === DEMO_CURRENCY)).toBe(true);
      // The identifiers in the file never reach the record: they are pseudonymised before storage.
      expect(signals.every((s) => /^hmac-sha256:[a-f0-9]{64}$/.test(s.sourceRef))).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/(ENT|PAYER|SL|INV)-DEMO/);
      expect(rows.every((r) => r.status === "pending_review")).toBe(true);
      // A DETECTION IS NOT A CASE. The queue holds Revenue Opportunity; nothing has been opened.
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);

      // ── 3 · review, then promotion — two separate acts ────────────────────────────────────────
      const reviews = new PostgresCandidateReviewStore();
      const target = rows.find((r) => (r.signal as { amountAtRiskMinor: number }).amountAtRiskMinor === 150_000)!;
      const promoteOnce = (recoveryCaseId: string) => reviews.promote({
        recoveryCaseId, candidateId: target.candidateId, boundaryId,
        actorId: operator.actorId, actorRole: "operator", policyVersion: "pair-intake-test",
      });

      // ACCEPTANCE IS NOT PROMOTION, and promotion without an accepted review is refused.
      await expect(promoteOnce(`RC-${randomUUID()}`)).rejects.toThrow(/accepted review/);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);

      await reviews.recordDecision({
        reviewId: `REV-${randomUUID()}`, candidateId: target.candidateId, boundaryId,
        decision: "accepted", reason: "synthetic pilot pair — under-billed, unpaired, priced",
        actorId: operator.actorId, actorRole: "operator", policyVersion: "pair-intake-test",
        decidedAt: new Date().toISOString(),
      });

      const caseId = `RC-${randomUUID()}`;
      const opened = await promoteOnce(caseId);
      expect(opened.created).toBe(true);
      expect(opened.recoveryCase.recoveryCaseId).toBe(caseId);
      expect(opened.recoveryCase.amountAtRiskMinor).toBe(150_000);
      expect(opened.recoveryCase.sourceCandidateId).toBe(target.candidateId);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(1);

      // ── 4 · NO DUPLICATE CASE, by two independent mechanisms ──────────────────────────────────
      // (a) a second promotion of the same candidate returns the SAME case and creates nothing;
      const again = await promoteOnce(`RC-${randomUUID()}`);
      expect(again.created).toBe(false);
      expect(again.recoveryCase.recoveryCaseId).toBe(caseId);
      // (b) the candidate has left the review queue, so it cannot be promoted a second time by hand.
      const queued = await reviews.listPending(boundaryId);
      expect(queued.map((q) => q.candidateId)).not.toContain(target.candidateId);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(1);

      // ── 5 · the SAME two files again produce no second observation and no second case ─────────
      const repeat = await submit();
      expect(repeat.accepted).toBe(true);
      expect(repeat.queued).toBe(false);
      expect(repeat.taskId).toBe(first.taskId);
      expect(await prisma.agentTaskRecord.count({ where: { boundaryId } })).toBe(1);
      expect(await candidates()).toHaveLength(3);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(1);

      // ── 6 · AND NO PROOF. A case is an opened question, not a recovered dollar. ────────────────
      expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(0);
      expect(await prisma.evidenceRecord.count({ where: { recoveryCaseId: caseId } })).toBe(0);
      expect(worker.readiness().status).toBe("up");
    } finally { await worker.stop(); }
  }, 60_000);

  it("a REFUSED pair writes nothing at all — no task, no candidate, no case", async () => {
    const boundaryId = `SYNTHETIC-pair-refused-${randomUUID()}`;
    const operator: ActorContext = { actorId: `op-${randomUUID()}`, role: "operator", boundaryIds: [boundaryId] };
    const out = await submitPilotPair(createPostgresAgentTaskStore(), operator, {
      boundaryId, expectationCsv: BILLING_CSV, billingCsv: EXPECTATION_CSV, currency: DEMO_CURRENCY,
    });
    expect(out.accepted).toBe(false);
    expect(out.taskId).toBeNull();
    expect(await prisma.agentTaskRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
  });
});
