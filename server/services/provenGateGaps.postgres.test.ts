// The two PROVEN-gate gaps from docs/PROVEN_GATE_REVIEW_V1.md, MEASURED rather than argued.
//
// WHY THIS FILE EXISTS. The review read the code and concluded that the correction leg is not a conjunct of
// PROVEN (G1) and that the evidence bar for collected money is selected by a request field (G2). A review
// that says "not enforced" without executing anything is an argument. This runs the real governed path —
// real candidate, real review, real promotion, real baseline, real evidence ingestion, real `POST /proofs` —
// against a real database, and records what actually happens.
//
// THESE TESTS DOCUMENT HOLES, THEY DO NOT CLOSE THEM. Each one asserts the CURRENT behaviour, so when a gap
// is closed the test FAILS and whoever closed it must come here and update the review in the same change.
// That is deliberate and is the pattern this repository already uses for the attestation hole: a test that
// pretended the gap was caught would be worse than no test. Every assertion names the matrix row it answers.
//
// NOTHING HERE PRESENTS A SYNTHETIC FIGURE AS COLLECTED REVENUE. Every amount is invented by this file for
// a boundary whose id starts `TEST-`, and the point of the exercise is precisely that the product MINTS a
// figure it should arguably refuse.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { CURRENT_POLICY } from "../../src/domain/policy";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const THRESHOLD = CURRENT_POLICY.proofThreshold;

const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;

interface Seeded {
  readonly caseId: string;
  readonly boundaryId: string;
  readonly sourceRef: string;
}

/** A single-obligation claim promoted through the REAL governed path, so leg A genuinely passes. */
async function seedProvableCase(expectedMinor: number, billedMinor: number): Promise<Seeded> {
  const boundaryId = `TEST-pgap-${uid()}`;
  const sourceRef = pseudonym();
  const signal = {
    signalId: `FIX-${hex().slice(0, 32)}`,
    boundaryId,
    recoveryType: "RevenueUnderBilled",
    sourceRef,
    sourcePayloadHash: hex(),
    detectorVersion: "proven-gap-test-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: expectedMinor - billedMinor,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: {
      kind: "SINGLE_OBLIGATION",
      obligationRef: pseudonym(),
      expectedMinor,
      billedMinor,
      residualMinor: expectedMinor - billedMinor,
      currency: "USD",
    },
  };
  const dedupeKey = caseCandidateDedupeKey(signal as never);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "proven-gap-test-v1", signal, submittedAt: new Date() },
  });
  const operator = actor("ops@test", "operator", [boundaryId]);
  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId, boundaryId, decision: "accepted",
    reason: "test · governed review of a synthetic single-obligation claim",
  });
  const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);

  // The detector's own statement, as the publisher records it — so the absorption question is ANSWERABLE
  // and leg A's `ABSORPTION_NOT_CHECKED` branch does not refuse for an unrelated reason.
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'proven-gap-test-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(),
    JSON.stringify([{ recoveryType: "RevenueUnderBilled", sourceRef, amountAtRiskMinor: expectedMinor - billedMinor, currency: "USD" }]),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'proven-gap-test-v1', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, boundaryId, JSON.stringify({ admittedCount: 1, createdCount: 1 }),
  );
  return { caseId: promoted.recoveryCase.recoveryCaseId, boundaryId, sourceRef };
}

describe.skipIf(!HAS_DB)("PROVEN gate · the two gaps, measured on the real path", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  // ── G1 · matrix rows 5 and 6: the correction leg is not a conjunct ────────────────────────────────
  it("G1 · a case with NO Intervene event ever recorded still reaches PROVEN", async () => {
    const seeded = await seedProvableCase(160_000, 100_000);
    expect((await app.inject({ method: "POST", url: `/cases/${seeded.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, seeded.caseId, { calculatedMinor: 10_000 });
    const { evidenceId, res } = await seedEvidence(app, seeded.caseId, { amountMinor: 70_000, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);

    // DELIBERATELY NO `seedIntervention`. Nothing was fixed, and nothing claims it was.
    const authority = await prisma.authorityEvent.findMany({
      where: { recoveryCaseId: seeded.caseId }, select: { action: true },
    });
    expect(authority.map((a) => a.action)).not.toContain("Intervene");

    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: seeded.caseId, currency: "USD",
        collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    // THE GAP. A proof is minted, and Revenue Returned with it, on a case where no correction was ever
    // recorded — while the reason says `BillingCorrection`. Matrix rows 5 and 6 read NOT ENFORCED.
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().revenueReturned.minor).toBe(60_000);
    // When this assertion starts failing, G1 has been closed. Update docs/PROVEN_GATE_REVIEW_V1.md §3.
  }, 60_000);

  // ── G2 · CLOSED. What this test asserted, and what it asserts now ────────────────────────────────
  //
  // IT USED TO ASSERT THE DEFECT. The original form ran the SAME supporting-role evidence carrying no
  // amount twice — once at `confidenceUsed = 80`, once at `79` — and asserted `403` then `201`, with
  // 60_000 minor of Revenue Returned minted at the lower number. That was the measurement that
  // established G2: the submitter chose which evidence bar applied to their own claim.
  //
  // G2 IS NOW CLOSED, so that assertion is inverted and the history is recorded here rather than
  // deleted. The evidence requirement is universal, and the two tests below separate the two things a
  // reader must not confuse: the bar no longer MOVES with the tier (negative), and the bar is about the
  // EVIDENCE rather than about the confidence number (positive).
  const unsubstantiated = async () => {
    const seeded = await seedProvableCase(160_000, 100_000);
    expect((await app.inject({ method: "POST", url: `/cases/${seeded.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, seeded.caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, seeded.caseId);
    // Supporting-role, no amount: `deriveEvidenceRole` makes (crm, operator_note) `supporting`.
    const { evidenceId, res } = await seedEvidence(app, seeded.caseId, {
      sourceSystem: "crm", evidenceType: "operator_note",
    });
    expect(res.statusCode, res.body).toBe(201);
    return { seeded, baselineId, evidenceId };
  };
  const substantiated = async (collectedMinor: number) => {
    const seeded = await seedProvableCase(160_000, 100_000);
    expect((await app.inject({ method: "POST", url: `/cases/${seeded.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, seeded.caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, seeded.caseId);
    // Outcome-role, authenticated by the fixture verifier, amount stated and sufficient.
    const { evidenceId, res } = await seedEvidence(app, seeded.caseId, { amountMinor: collectedMinor, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);
    return { seeded, baselineId, evidenceId };
  };
  const payload = (caseId: string, baselineId: string, evidenceId: string, confidenceUsed: number) => ({
    proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
    collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
    recoveryReason: "BillingCorrection", attribution: "ar-system",
    evidenceIds: [evidenceId], baselineId, confidenceUsed,
  });

  it("G2 NEGATIVE · unsubstantiated evidence is refused at EVERY tier, not only at the threshold", async () => {
    for (const confidence of [THRESHOLD, THRESHOLD - 1, 50, 1, 0]) {
      const c = await unsubstantiated();
      const res = await app.inject({
        method: "POST", url: "/proofs", headers: APPROVER,
        payload: payload(c.seeded.caseId, c.baselineId, c.evidenceId, confidence),
      });
      expect(res.statusCode, `confidence ${confidence}: ${res.body}`).toBe(403);
      // The same code at every tier. Before G2, `THRESHOLD - 1` and below returned 201.
      expect(res.body).toMatch(/NO_OUTCOME_EVIDENCE|OUTCOME_EVIDENCE_NOT_AUTHENTICATED|NO_INDEPENDENT_EVIDENCE/);
      expect(await prisma.proof.count({ where: { recoveryCaseId: c.seeded.caseId } })).toBe(0);
    }
  }, 180_000);

  it("G2 POSITIVE · substantiated evidence is accepted at EVERY tier, including below the threshold", async () => {
    // THE CONTROL THAT MAKES THE NEGATIVE MEAN SOMETHING. If a sub-threshold claim were refused whatever
    // its evidence, the test above would be measuring "low confidence is refused" rather than "the
    // evidence requirement no longer moves with the tier". A test that cannot pass is no better than a
    // test that cannot fail.
    for (const confidence of [THRESHOLD, THRESHOLD - 1, 1]) {
      const c = await substantiated(70_000);
      const res = await app.inject({
        method: "POST", url: "/proofs", headers: APPROVER,
        payload: payload(c.seeded.caseId, c.baselineId, c.evidenceId, confidence),
      });
      expect(res.statusCode, `confidence ${confidence}: ${res.body}`).toBe(201);
      expect(res.json().revenueReturned.minor).toBe(60_000);
    }
  }, 180_000);

  it("G2 · evidence that states no amount is refused rather than counted as zero", async () => {
    // The sharpest of the six refusals: the previous arithmetic summed `amountMinor ?? 0`, so an outcome
    // record with no amount contributed a silent zero and a claim could clear a sum it never met.
    const seeded = await seedProvableCase(160_000, 100_000);
    expect((await app.inject({ method: "POST", url: `/cases/${seeded.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, seeded.caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, seeded.caseId);
    // Outcome ROLE (billing/invoice_paid) and authenticated, but NO amount at all.
    const { evidenceId, res } = await seedEvidence(app, seeded.caseId, {
      sourceSystem: "billing", evidenceType: "invoice_paid",
    });
    expect(res.statusCode, res.body).toBe(201);
    const refused = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: payload(seeded.caseId, baselineId, evidenceId, THRESHOLD - 1),
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.body).toContain("OUTCOME_EVIDENCE_AMOUNT_NOT_STATED");
  }, 60_000);

  it("G2 · evidence that does not reach the amount claimed is refused", async () => {
    const c = await substantiated(10_000); // evidence states 10_000, the claim will state 70_000
    const refused = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: payload(c.seeded.caseId, c.baselineId, c.evidenceId, THRESHOLD - 1),
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.body).toContain("OUTCOME_EVIDENCE_INSUFFICIENT");
  }, 60_000);

  // ── The control: leg A really is doing the refusing, so the two tests above are not vacuous ───────
  it("CONTROL · the same payload on a case with no obligation coverage is refused by leg A", async () => {
    // Identical in every respect except that the candidate states NO coverage. If this were also accepted,
    // the two gap tests would be measuring a gate that refuses nothing at all. A test that cannot fail is
    // not a control.
    const boundaryId = `TEST-pgap-${uid()}`;
    const signal = {
      signalId: `FIX-${hex().slice(0, 32)}`, boundaryId, recoveryType: "RevenueUnderBilled",
      sourceRef: pseudonym(), sourcePayloadHash: hex(), detectorVersion: "proven-gap-test-v1",
      observedAt: new Date(Date.now() - 86_400_000).toISOString(), amountAtRiskMinor: 60_000,
      currency: "USD", actionAvailable: true, expectedProofEvent: "corrective invoice raised and collected",
    };
    const dedupeKey = caseCandidateDedupeKey(signal as never);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "proven-gap-test-v1", signal, submittedAt: new Date() },
    });
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "test · no coverage stated",
    });
    const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
    const caseId = promoted.recoveryCase.recoveryCaseId;

    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, caseId);
    const { evidenceId } = await seedEvidence(app, caseId, { amountMinor: 70_000, currency: "USD" });
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain("OBLIGATION_COVERAGE_NOT_STATED");
  }, 60_000);
});
