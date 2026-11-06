// `npm run trace:seed` — writes ONE synthetic obligation all the way to a frozen proof, then prints the
// ids so `npm run trace:case` can be run against it.
//
// IT WRITES THROUGH THE REAL PATH AND NOTHING ELSE. The candidate through the real staging identity, the
// review through `CandidateReviewService`, the root through `CandidatePromotionService.promote`, and the
// baseline, intervention, evidence and proof through the real HTTP routes with separation of duties and
// source verification in force. Nothing is INSERTed into `recovery_cases`, `baseline_snapshots` or
// `proofs`: a seeder that wrote those rows directly would produce a case the product could never make,
// and the trace printed from it would be evidence of nothing.
//
// IT PRINTS WHAT IT WROTE, so the figures a reader checks come from the seeder's own report rather than
// being restated in two places that can drift.
//
// SYNTHETIC, AND THE KEY IS THE POINT. The settlement evidence is signed by an EPHEMERAL key this
// process generates, which is exactly why the trace reports Revenue Returned as withheld: NH signing
// its own settlement establishes nothing about whether anyone outside NH asserts it.
import { createHash, randomUUID } from "node:crypto";
import { buildApp } from "../../server/app";
import { prisma } from "../../server/db";
import { fixtureVerifier, attestFixture } from "../../server/test/sourceFixture";
import { CandidateReviewService } from "../../server/agents/candidateReview";
import { CandidatePromotionService } from "../../server/agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../../server/agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../../server/agents/caseAdmission";
import type { ActorContext } from "../../server/auth/identity";

const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;
const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });

const EXPECTED_MINOR = 160_000;
const BILLED_MINOR = 100_000;
const BASELINE_MINOR = 10_000;
const COLLECTED_MINOR = 70_000;

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("trace:seed: DATABASE_URL is not set. Point it at a SYNTHETIC, TEST-NAMED database.");
    return 2;
  }
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  await app.ready();

  const boundaryId = `SYNTHETIC-trace-${hex().slice(0, 8)}`;
  const sourceRef = pseudonym();
  const obligationRef = pseudonym();
  const signal = {
    signalId: `FIX-${hex().slice(0, 32)}`,
    boundaryId,
    recoveryType: "RevenueUnderBilled",
    sourceRef,
    sourcePayloadHash: hex(),
    detectorVersion: "trace-demo-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: EXPECTED_MINOR - BILLED_MINOR,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: {
      kind: "SINGLE_OBLIGATION" as const,
      obligationRef,
      expectedMinor: EXPECTED_MINOR,
      billedMinor: BILLED_MINOR,
      residualMinor: EXPECTED_MINOR - BILLED_MINOR,
      currency: "USD",
    },
  };
  const dedupeKey = caseCandidateDedupeKey(signal);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "trace-demo-v1", signal, submittedAt: new Date() },
  });

  // The detector's own statement, in the append-only log the correction ledger reads.
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'trace-demo-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(),
    JSON.stringify([{
      recoveryType: signal.recoveryType, sourceRef, amountAtRiskMinor: signal.amountAtRiskMinor,
      currency: "USD", obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef },
    }]),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'trace-demo-v1', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, boundaryId, JSON.stringify({ admittedCount: 1, createdCount: 1 }),
  );

  const operator: ActorContext = Object.freeze({
    actorId: "ops@company", role: "operator", boundaryIds: Object.freeze([boundaryId]),
  });
  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId, boundaryId, decision: "accepted",
    reason: "synthetic demo · a single-obligation under-billing claim accepted for the governed flow",
  });
  const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
  const caseId = promoted.recoveryCase.recoveryCaseId;

  const expect201 = (label: string, status: number, body: string) => {
    if (status !== 201) throw new Error(`${label} failed: ${status} ${body}`);
  };
  const authored = await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: hdr("dana@company", "author") });
  expect201("author", authored.statusCode, authored.body);

  const baselineId = `BL-${hex().slice(0, 8)}`;
  const baseline = await app.inject({
    method: "POST", url: `/cases/${caseId}/baseline`, headers: hdr("dana@company", "author"),
    payload: {
      baselineId, calculatedMinor: BASELINE_MINOR, currency: "USD",
      method: "matched_historical_cohort", methodVersion: 1, sourceRefs: ["src-1"],
      effectiveAt: "2026-07-01T00:00:00.000Z",
    },
  });
  expect201("baseline", baseline.statusCode, baseline.body);

  const intervened = await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: hdr("dana@company", "author") });
  expect201("intervention", intervened.statusCode, intervened.body);

  const evidenceId = `EV-${hex().slice(0, 8)}`;
  const evidence = await app.inject({
    method: "POST", url: `/cases/${caseId}/evidence`, headers: hdr("dana@company", "author"),
    payload: attestFixture(caseId, {
      evidenceId, sourceSystem: "billing", sourceRecordId: `inv-${hex().slice(0, 8)}`,
      evidenceType: "invoice_paid", observedAt: "2026-07-25T00:00:00.000Z",
      amountMinor: COLLECTED_MINOR, currency: "USD",
    }),
  });
  expect201("evidence", evidence.statusCode, evidence.body);

  const proofId = `SYNTHETIC-proof-${randomUUID()}`;
  const approved = await app.inject({
    method: "POST", url: "/proofs", headers: hdr("cfo@company", "approver"),
    payload: {
      proofId, recoveryCaseId: caseId, currency: "USD", collectedMinor: COLLECTED_MINOR,
      excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
      recoveryReason: "BillingCorrection", attribution: "ar-system",
      evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
    },
  });
  expect201("proof approval", approved.statusCode, approved.body);

  await app.close();
  console.log(JSON.stringify({
    recoveryCaseId: caseId,
    boundaryId,
    candidateId,
    baselineId,
    evidenceId,
    proofId,
    wrote: {
      expectedMinor: EXPECTED_MINOR,
      billedMinor: BILLED_MINOR,
      residualMinor: EXPECTED_MINOR - BILLED_MINOR,
      baselineMinor: BASELINE_MINOR,
      collectedMinor: COLLECTED_MINOR,
      proofChainFigureMinor: approved.json().revenueReturned.minor,
    },
    howToTrace: `NH_TRACE_BOUNDARY=${boundaryId} npm run trace:case -- ${caseId}`,
    disclosure:
      "SYNTHETIC. The settlement evidence is signed by an ephemeral key this process generated. " +
      "No billing system was contacted, no charge was raised and no money was collected.",
  }, null, 2));
  return 0;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (error) => {
    console.error(`trace:seed failed — ${error instanceof Error ? error.message : String(error)}`);
    await prisma.$disconnect();
    process.exit(1);
  });
