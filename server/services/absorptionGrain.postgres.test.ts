// The absorption-grain correction, measured on the real governed path against a real database.
//
// THE DEFECT. `accountGrainedGroup` is `(boundaryId, recoveryType, sourceRef)` while the candidate dedupe
// key gained an obligation-grained branch, so the PROVEN gate judged absorption ONE GRAIN COARSER than the
// identity it protects: an absorbed observation of obligation B blocked a case about obligation A whenever
// the two shared an account.
//
// THE TWO PROPERTIES THIS FILE MUST ESTABLISH TOGETHER, because either alone is worthless. False refusals
// must DECREASE for verified-independent obligations, and unsafe approvals must NOT INCREASE. A correction
// that only did the first would be a weakening dressed as a fix.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { caseProvenEligibility } from "./caseProvenGate";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

const OBL_A = `hmac-sha256:${"a".repeat(64)}`;
const OBL_B = `hmac-sha256:${"b".repeat(64)}`;

/** One obligation-grained candidate signal for a given account and obligation. */
const signalFor = (boundaryId: string, sourceRef: string, obligationRef: string, amountAtRiskMinor = 60_000) => ({
  signalId: `FIX-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
  boundaryId,
  recoveryType: "RevenueUnderBilled",
  sourceRef,
  sourcePayloadHash: "c".repeat(64),
  detectorVersion: "absorption-grain-test",
  observedAt: new Date(Date.now() - 86_400_000).toISOString(),
  amountAtRiskMinor,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "corrective invoice raised and collected",
  obligationCoverage: {
    kind: "SINGLE_OBLIGATION", obligationRef,
    expectedMinor: 100_000 + amountAtRiskMinor, billedMinor: 100_000,
    residualMinor: amountAtRiskMinor, currency: "USD",
  },
});

/**
 * Record ONE `task.succeeded` event with its signals, exactly as the publisher writes them.
 *
 * `absorbed: true` writes `admittedCount >= 1, createdCount = 0`, which IS the stored record of an
 * absorption — the same derivation the diagnostic and the gate both read.
 */
async function recordEvent(
  boundaryId: string,
  signals: readonly Record<string, unknown>[],
  absorbed: boolean,
): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'absorption-grain-test', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(), JSON.stringify(signals),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'absorption-grain-test', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, boundaryId,
    JSON.stringify(absorbed ? { admittedCount: 1, createdCount: 0 } : { admittedCount: 1, createdCount: 1 }),
  );
}

describe.skipIf(!HAS_DB)("absorption grain · aligned with the obligation identity it protects", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** Promote one obligation-grained case and return its id, on a boundary of its own. */
  async function promoteFor(boundaryId: string, sourceRef: string, obligationRef: string): Promise<string> {
    const signal = signalFor(boundaryId, sourceRef, obligationRef);
    const dedupeKey = caseCandidateDedupeKey(signal as never);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "absorption-grain-test", signal, submittedAt: new Date() },
    });
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "test · absorption grain fixture",
    });
    const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
    // The candidate key really is obligation-grained, so the fixture is exercising the branch it claims to.
    expect(dedupeKey).not.toBe(caseCandidateDedupeKey({ ...signal, obligationCoverage: undefined } as never));
    return promoted.recoveryCase.recoveryCaseId;
  }

  it("A · an absorbed observation of ANOTHER obligation no longer blocks this one", async () => {
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"1".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    // The event that used to block it: an ABSORPTION recorded against obligation B, SAME account.
    await recordEvent(boundaryId, [signalFor(boundaryId, account, OBL_B, 90_000)], true);

    const verdict = await caseProvenEligibility(caseA);
    // BEFORE THE CORRECTION this was `ABSORBED_OBSERVATION_RECORDED`. The false refusal is gone.
    expect(verdict.eligible, JSON.stringify(verdict)).toBe(true);
  }, 90_000);

  it("B · an absorbed observation of THIS obligation still blocks it — unsafe approvals did not increase", async () => {
    // THE OTHER HALF, and without it the test above would be a weakening dressed as a fix.
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"2".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    await recordEvent(boundaryId, [signalFor(boundaryId, account, OBL_A, 90_000)], true);

    const verdict = await caseProvenEligibility(caseA);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("ABSORBED_OBSERVATION_RECORDED");
  }, 90_000);

  it("F · LEGACY account-grained absorption still blocks, because it names no obligation", async () => {
    // No unsupported upgrade to obligation-level certainty: nothing establishes which obligation this
    // observation was about, so it keeps its full account-level reach and the case stays refused.
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"3".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    await recordEvent(
      boundaryId,
      [{ recoveryType: "RevenueUnderBilled", sourceRef: account, amountAtRiskMinor: 90_000, currency: "USD" }],
      true,
    );

    const verdict = await caseProvenEligibility(caseA);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("ABSORBED_OBSERVATION_RECORDED");
  }, 90_000);

  it("C · an absorption event carrying NO admission counts is NOT CHECKED, never 'no absorption'", async () => {
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"4".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1, $2, 'absorption-grain-test', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
      taskId, boundaryId, randomUUID(), JSON.stringify([signalFor(boundaryId, account, OBL_A)]),
    );
    // An event with NO counts at all — every event written before the publisher recorded them.
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1, $2, $3, 'absorption-grain-test', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), taskId, boundaryId,
    );

    const verdict = await caseProvenEligibility(caseA);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("ABSORPTION_NOT_CHECKED");
  }, 90_000);

  it("a non-absorbing event of another obligation leaves the case eligible, and so does one of its own", async () => {
    // The control that keeps A honest: it must be the ABSORPTION that mattered, not merely the presence
    // of another obligation's signal. Both events below record `createdCount: 1` — no absorption at all.
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"5".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    await recordEvent(boundaryId, [signalFor(boundaryId, account, OBL_B, 90_000)], false);
    await recordEvent(boundaryId, [signalFor(boundaryId, account, OBL_A, 60_000)], false);

    const verdict = await caseProvenEligibility(caseA);
    expect(verdict.eligible, JSON.stringify(verdict)).toBe(true);
  }, 90_000);

  it("two independent cases on ONE account are both eligible — the money is not merged either", async () => {
    // The acceptance criterion stated as a single assertion: two obligations of one account remain
    // independently identifiable AND independently approvable.
    const boundaryId = `TEST-absgrain-${uid()}`;
    const account = `hmac-sha256:${"6".repeat(64)}`;
    const caseA = await promoteFor(boundaryId, account, OBL_A);
    const caseB = await promoteFor(boundaryId, account, OBL_B);
    expect(caseA).not.toBe(caseB);
    for (const id of [caseA, caseB]) {
      const v = await caseProvenEligibility(id);
      expect(v.eligible, `${id}: ${JSON.stringify(v)}`).toBe(true);
    }
  }, 90_000);
});
