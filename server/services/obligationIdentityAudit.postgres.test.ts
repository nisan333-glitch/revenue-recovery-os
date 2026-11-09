// THE INTEGRATED OBLIGATION-IDENTITY AUDIT. Six properties, each driven through the REAL governed path
// against a real database, all the way to minted Revenue Returned where the property is about money.
//
// WHY THIS FILE EXISTS WHEN THE PIECES ARE ALREADY TESTED. Candidate identity, absorption grain, the
// PROVEN gate, precedence and the migration rehearsal each have their own suite and each passes. What
// nobody had executed is the COMPOSITE: that two obligations of one account travel the whole path
// independently and each mint their own money, that one obligation cannot mint twice, and that the
// refusals still fire when identity is absent. A property proved in parts is not proved as a whole —
// this is the same reason the repository insists a capability in one lane is not a capability in another.
//
// IT REPORTS THE CURRENT STATE, INCLUDING WHERE THAT STATE IS A LIMITATION. Property 6 asserts that the
// entity-attribution primary key is STILL account-grained, because Option B has not been executed. That
// assertion will fail the day the migration runs, which is correct: whoever runs it must update this
// audit in the same change rather than discover afterwards that the audit was describing a dead state.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId, candidateDedupeGrain } from "../agents/caseAdmission";
import { caseProvenEligibility } from "./caseProvenGate";
import { resolvePrecedence } from "../../src/domain/correctionPrecedence";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;
const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

interface Claim {
  readonly caseId: string;
  readonly boundaryId: string;
  readonly sourceRef: string;
  readonly obligationRef: string;
  readonly candidateId: string;
  readonly atRiskMinor: number;
}

// NO `Record<string, unknown>` RETURN ANNOTATION, DELIBERATELY. Widening the signal to an index
// signature is what Prisma's `InputJsonValue` rejects, and the server-test typecheck ratchet caught it
// on this very file — the gate working on new work rather than on historical debt. Letting TypeScript
// infer the concrete object type keeps the value assignable AND keeps the fixture's shape checked.
function signalFor(
  boundaryId: string, sourceRef: string, obligationRef: string | null,
  expectedMinor: number, billedMinor: number,
) {
  const residual = expectedMinor - billedMinor;
  return {
    signalId: `FIX-${hex().slice(0, 32)}`,
    boundaryId,
    recoveryType: "RevenueUnderBilled",
    sourceRef,
    sourcePayloadHash: hex(),
    detectorVersion: "obligation-identity-audit-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: residual,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: obligationRef === null
      // ACCOUNT_AGGREGATE states that the claim covers a whole account — it names NO obligation.
      ? { kind: "ACCOUNT_AGGREGATE", unitCount: 3 }
      : { kind: "SINGLE_OBLIGATION", obligationRef, expectedMinor, billedMinor, residualMinor: residual, currency: "USD" },
  };
}

/** Record the detector's own succeeded event so the absorption question is ANSWERABLE. */
async function recordDetectorEvent(
  boundaryId: string, signals: readonly ReturnType<typeof signalFor>[], absorbed: boolean,
): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'obligation-identity-audit-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(), JSON.stringify(signals),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'obligation-identity-audit-v1', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, boundaryId,
    JSON.stringify(absorbed ? { admittedCount: 1, createdCount: 0 } : { admittedCount: 1, createdCount: 1 }),
  );
}

/** Promote one claim through candidate → review → promotion, exactly as production does. */
async function promote(
  boundaryId: string, sourceRef: string, obligationRef: string | null,
  expectedMinor: number, billedMinor: number,
): Promise<Claim> {
  const signal = signalFor(boundaryId, sourceRef, obligationRef, expectedMinor, billedMinor);
  const dedupeKey = caseCandidateDedupeKey(signal as never);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "obligation-identity-audit-v1", signal, submittedAt: new Date() },
  });
  const operator = actor("ops@test", "operator", [boundaryId]);
  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId, boundaryId, decision: "accepted", reason: "audit · synthetic governed review",
  });
  const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
  await recordDetectorEvent(boundaryId, [signal], false);
  return {
    caseId: promoted.recoveryCase.recoveryCaseId, boundaryId, sourceRef,
    obligationRef: obligationRef ?? "(none)", candidateId,
    atRiskMinor: expectedMinor - billedMinor,
  };
}

describe.skipIf(!HAS_DB)("obligation identity · the six properties, on the real path", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** Take a promoted claim all the way to a frozen proof and return the minted Revenue Returned. */
  async function mint(claim: Claim, collectedMinor: number, baselineMinor: number): Promise<{
    readonly status: number; readonly body: string; readonly returnedMinor?: number;
  }> {
    expect((await app.inject({ method: "POST", url: `/cases/${claim.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, claim.caseId, { calculatedMinor: baselineMinor });
    await seedIntervention(app, claim.caseId);
    const { evidenceId } = await seedEvidence(app, claim.caseId, { amountMinor: collectedMinor, currency: "USD" });
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: claim.caseId, currency: "USD",
        collectedMinor, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    return {
      status: res.statusCode, body: res.body,
      returnedMinor: res.statusCode === 201 ? res.json().revenueReturned.minor : undefined,
    };
  }

  // ── P1 · TWO OBLIGATIONS OF ONE ACCOUNT ARE NOT MERGED, ALL THE WAY TO THE MONEY ────────────────
  it("P1 · two obligations of ONE account each mint their OWN money, and nothing is merged", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const account = pseudonym();            // ONE account
    const oblA = pseudonym();
    const oblB = pseudonym();               // TWO obligations

    const a = await promote(boundaryId, account, oblA, 160_000, 100_000); // $600 at risk
    const b = await promote(boundaryId, account, oblB, 250_000, 150_000); // $1000 at risk

    // Distinct candidate identity, and the key really took the obligation-grained branch.
    expect(a.candidateId).not.toBe(b.candidateId);
    expect(a.caseId).not.toBe(b.caseId);
    expect(candidateDedupeGrain(signalFor(boundaryId, account, oblA, 160_000, 100_000) as never)).toBe("OBLIGATION_V2");

    // Both reach PROVEN, each with ITS OWN arithmetic. The merge defect would have produced one case.
    const mintedA = await mint(a, 70_000, 10_000);
    const mintedB = await mint(b, 120_000, 20_000);
    expect(mintedA.status, mintedA.body).toBe(201);
    expect(mintedB.status, mintedB.body).toBe(201);
    expect(mintedA.returnedMinor).toBe(60_000);   // 70_000 − 10_000
    expect(mintedB.returnedMinor).toBe(100_000);  // 120_000 − 20_000

    // AND THE TWO FIGURES ARE SEPARATE RECORDS, not one summed row. Two proofs, two cases, two amounts.
    const proofs = await prisma.proof.findMany({
      where: { recoveryCaseId: { in: [a.caseId, b.caseId] } },
      select: { recoveryCaseId: true, revenueReturnedMinor: true },
    });
    expect(proofs).toHaveLength(2);
    expect(new Set(proofs.map((p) => p.recoveryCaseId)).size).toBe(2);
    expect(proofs.map((p) => Number(p.revenueReturnedMinor)).sort((x, y) => x - y)).toEqual([60_000, 100_000]);
  }, 120_000);

  // ── P2 · ONE OBLIGATION CANNOT MINT TWICE ────────────────────────────────────────────────────────
  it("P2 · one obligation cannot produce duplicate recovered revenue — two independent mechanisms", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const account = pseudonym();
    const obl = pseudonym();
    const claim = await promote(boundaryId, account, obl, 160_000, 100_000);

    const first = await mint(claim, 70_000, 10_000);
    expect(first.status, first.body).toBe(201);
    expect(first.returnedMinor).toBe(60_000);

    // MECHANISM 1 · the SAME candidate cannot yield a SECOND case. Promotion is IDEMPOTENT rather than
    // throwing — it returns the case that already exists with `created: false`, which is the stronger
    // behaviour: a retry is safe and still cannot open a second case. I had expected a throw; the
    // implementation is better than my expectation and the assertion is corrected to the real contract.
    const store = new PostgresCandidateReviewStore();
    const operator = actor("ops@test", "operator", [boundaryId]);
    const second = await new CandidatePromotionService(store).promote(operator, claim.candidateId, boundaryId);
    expect(second.created).toBe(false);
    expect(second.recoveryCase.recoveryCaseId).toBe(claim.caseId);
    expect(await prisma.recoveryCaseRecord.count({ where: { sourceCandidateId: claim.candidateId } })).toBe(1);

    // MECHANISM 2 · a re-detection of the SAME obligation resolves to the SAME candidate id, so it
    // cannot open a second case either. The key is the mechanism, not a uniqueness error downstream.
    const again = signalFor(boundaryId, account, obl, 160_000, 100_000);
    expect(caseCandidateId(caseCandidateDedupeKey(again as never))).toBe(claim.candidateId);

    // AND THE LEDGER HOLDS EXACTLY ONE PROVEN FIGURE FOR THIS OBLIGATION.
    const proofs = await prisma.proof.findMany({ where: { recoveryCaseId: claim.caseId } });
    expect(proofs).toHaveLength(1);
    expect(Number(proofs[0]!.revenueReturnedMinor)).toBe(60_000);
  }, 120_000);

  // ── P3 · MISSING OR CONFLICTING IDENTITY FAILS CLOSED ────────────────────────────────────────────
  it("P3a · a claim that states NO obligation is refused, and mints nothing", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const claim = await promote(boundaryId, pseudonym(), null, 160_000, 100_000); // ACCOUNT_AGGREGATE

    const verdict = await caseProvenEligibility(claim.caseId);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");

    const minted = await mint(claim, 70_000, 10_000);
    expect(minted.status, minted.body).toBe(403);
    expect(await prisma.proof.count({ where: { recoveryCaseId: claim.caseId } })).toBe(0);
  }, 120_000);

  it("P3b · an absorbed observation of the SAME obligation refuses, and mints nothing", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const account = pseudonym();
    const obl = pseudonym();
    const claim = await promote(boundaryId, account, obl, 160_000, 100_000);
    // A second observation of the SAME obligation, folded in rather than creating its own candidate.
    await recordDetectorEvent(boundaryId, [signalFor(boundaryId, account, obl, 190_000, 100_000)], true);

    const verdict = await caseProvenEligibility(claim.caseId);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("ABSORBED_OBSERVATION_RECORDED");

    const minted = await mint(claim, 70_000, 10_000);
    expect(minted.status, minted.body).toBe(403);
    expect(await prisma.proof.count({ where: { recoveryCaseId: claim.caseId } })).toBe(0);
  }, 120_000);

  it("P3c · an unanswerable absorption question is NOT CHECKED, never read as 'no absorption'", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const account = pseudonym();
    const obl = pseudonym();
    const claim = await promote(boundaryId, account, obl, 160_000, 100_000);
    // An event touching this identity that carries NO admission counts at all.
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1, $2, 'obligation-identity-audit-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
      taskId, boundaryId, randomUUID(), JSON.stringify([signalFor(boundaryId, account, obl, 160_000, 100_000)]),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1, $2, $3, 'obligation-identity-audit-v1', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), taskId, boundaryId,
    );

    const verdict = await caseProvenEligibility(claim.caseId);
    expect(verdict.eligible).toBe(false);
    expect(!verdict.eligible && verdict.code).toBe("ABSORPTION_NOT_CHECKED");
  }, 120_000);

  // ── P4 · PARTIAL PAYMENTS ────────────────────────────────────────────────────────────────────────
  it("P4a · a partially collected recovery mints exactly what the evidence substantiates", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const claim = await promote(boundaryId, pseudonym(), pseudonym(), 160_000, 100_000); // $600 at risk
    // Only $300 of the $600 arrives. The proven figure must be the collected money minus the baseline,
    // never the exposure — `Collected − Baseline`, which is the constitution's definition.
    const minted = await mint(claim, 30_000, 10_000);
    expect(minted.status, minted.body).toBe(201);
    expect(minted.returnedMinor).toBe(20_000);
    // AND IT IS LESS THAN THE EXPOSURE. A partial recovery must never read as a full one.
    expect(minted.returnedMinor!).toBeLessThan(claim.atRiskMinor);
  }, 120_000);

  it("P4b · claiming more than the signed evidence substantiates is refused", async () => {
    const boundaryId = `TEST-oia-${uid()}`;
    const claim = await promote(boundaryId, pseudonym(), pseudonym(), 160_000, 100_000);
    expect((await app.inject({ method: "POST", url: `/cases/${claim.caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, claim.caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, claim.caseId);
    // Evidence attests $300; the claim asserts $600 collected.
    const { evidenceId } = await seedEvidence(app, claim.caseId, { amountMinor: 30_000, currency: "USD" });
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: claim.caseId, currency: "USD",
        collectedMinor: 60_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain("OUTCOME_EVIDENCE_INSUFFICIENT");
    expect(await prisma.proof.count({ where: { recoveryCaseId: claim.caseId } })).toBe(0);
  }, 120_000);

  it("P4c · a SERIES of payments is additive, and a replayed record is refused", () => {
    // The pure rule, at the layer that owns it, using the REAL `PrecedenceInput` shape.
    const series = resolvePrecedence({
      observedAmountsMinor: [60_000],
      currency: "USD",
      obligationGrained: true,
      billing: {
        billedAmountsMinor: [60_000],
        collectedAmountsMinor: [25_000, 35_000],   // two payments
        currency: "USD",
        billedRecordIds: ["B1"],
        collectedRecordIds: ["C1", "C2"],
      },
    });
    expect(series.resolved, JSON.stringify(series)).toBe(true);
    if (series.resolved) {
      expect(series.collectedMinor).toBe(60_000);     // 25_000 + 35_000 — a payment series IS additive
      expect(series.billedMinor).toBe(60_000);
      expect(series.outstandingMinor).toBe(0);
      expect(series.settlement).toBe("FULLY_SETTLED");
    }

    // A PARTIAL series: the outstanding remainder is REPORTED and never subtracted from what was owed.
    const partial = resolvePrecedence({
      observedAmountsMinor: [60_000],
      currency: "USD",
      obligationGrained: true,
      billing: {
        billedAmountsMinor: [60_000], collectedAmountsMinor: [25_000], currency: "USD",
        billedRecordIds: ["B1"], collectedRecordIds: ["C1"],
      },
    });
    expect(partial.resolved).toBe(true);
    if (partial.resolved) {
      expect(partial.authoritativeMinor).toBe(60_000);  // what was OWED is unchanged by part payment
      expect(partial.collectedMinor).toBe(25_000);
      expect(partial.outstandingMinor).toBe(35_000);
      expect(partial.settlement).toBe("PARTIALLY_SETTLED");
    }

    // THE SAME RECORD ID ON BOTH SIDES is refused: it cannot be a charge and its own settlement.
    const doubleCounted = resolvePrecedence({
      observedAmountsMinor: [60_000],
      currency: "USD",
      obligationGrained: true,
      billing: {
        billedAmountsMinor: [60_000], collectedAmountsMinor: [60_000], currency: "USD",
        billedRecordIds: ["X1"], collectedRecordIds: ["X1"],
      },
    });
    expect(doubleCounted.resolved).toBe(false);
  });

  // ── P5 · CORRECTIVE CHARGES OVERRIDE ONLY ON AUTHORITATIVE EVIDENCE ──────────────────────────────
  it("P5 · ambiguity and absent authority both REFUSE rather than pick a number", () => {
    // Asymmetric by design: several payments sum, several corrective charges do not, because nothing
    // establishes whether the second is additive or a re-issue. Choosing would author the number.
    const twoCharges = resolvePrecedence({
      observedAmountsMinor: [60_000],
      currency: "USD",
      obligationGrained: true,
      billing: {
        billedAmountsMinor: [60_000, 45_000], collectedAmountsMinor: [], currency: "USD",
        billedRecordIds: ["B1", "B2"], collectedRecordIds: [],
      },
    });
    expect(twoCharges.resolved).toBe(false);
    expect(!twoCharges.resolved && twoCharges.code).toBe("BILLED_AMOUNT_AMBIGUOUS");

    // With NO authoritative billing evidence, an observation alone establishes nothing.
    const noAuthority = resolvePrecedence({
      observedAmountsMinor: [60_000], currency: "USD", obligationGrained: true, billing: null,
    });
    expect(noAuthority.resolved).toBe(false);
    expect(!noAuthority.resolved && noAuthority.code).toBe("NO_AUTHORITATIVE_BILLING_EVIDENCE");

    // IDENTITY IS CHECKED FIRST, before any figure is read. An account-level grouping refuses on
    // identity rather than on the amounts — so the refusal names the right problem.
    const accountGrained = resolvePrecedence({
      observedAmountsMinor: [60_000], currency: "USD", obligationGrained: false,
      billing: {
        billedAmountsMinor: [60_000], collectedAmountsMinor: [60_000], currency: "USD",
        billedRecordIds: ["B1"], collectedRecordIds: ["C1"],
      },
    });
    expect(accountGrained.resolved).toBe(false);
    expect(!accountGrained.resolved && accountGrained.code).toBe("OBLIGATION_IDENTITY_AMBIGUOUS");

    // And a billed amount NO observation corroborates is refused: the correction may not override an
    // observation it does not match.
    const uncorroborated = resolvePrecedence({
      observedAmountsMinor: [60_000], currency: "USD", obligationGrained: true,
      billing: {
        billedAmountsMinor: [99_999], collectedAmountsMinor: [], currency: "USD",
        billedRecordIds: ["B1"], collectedRecordIds: [],
      },
    });
    expect(uncorroborated.resolved).toBe(false);
    expect(!uncorroborated.resolved && uncorroborated.code).toBe("NO_OBSERVATION_MATCHES_BILLED");
  });

  // ── P6 · THE LIMITATION, ASSERTED SO IT CANNOT BE FORGOTTEN ──────────────────────────────────────
  it("P6 · the entity-attribution PK is STILL account-grained — Option B is NOT executed", async () => {
    // THIS TEST IS SUPPOSED TO FAIL THE DAY THE MIGRATION RUNS. That is the point: whoever executes
    // Option B must update this audit in the same change, rather than leaving an audit that describes
    // a state the database left behind. An audit that silently keeps passing is not an audit.
    const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'pilot_assessment_entity_attributions'::regclass AND contype = 'p'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.def).toBe("PRIMARY KEY (execution_id, source_ref)");
    // So two obligations of ONE account cannot both be STAGED as attributions, whatever the contract
    // declares. The candidate and case layers are obligation-grained; this table is not, and that is
    // the blocker the migration exists to clear.
    expect(rows[0]!.def).not.toContain("obligation");
  }, 60_000);
});
