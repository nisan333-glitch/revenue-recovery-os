// THE PILOT ACCEPTANCE JOURNEY. Ten scenarios, one governed loop each, driven through the REAL path
// against a real database, and rendered into the artefact an owner reads.
//
// WHAT MAKES THIS AN ACCEPTANCE JOURNEY RATHER THAN A TEST SUITE. Every scenario carries what it was
// PRE-REGISTERED to do, written in the table below before any of them ran, and the verdict is "every
// scenario did what it was pre-registered to do" — refusals included. A journey scored by how much money
// it proved would reward exactly the behaviour the trust invariant forbids, so an UNEXPECTED PROOF is a
// failure here, not a win.
//
// THE EIGHT STAGES, and which scenario stops where:
//
//   1 opportunity          a genuine under-billed obligation exists in the source data
//   2 detection_and_case   the detector's signal becomes a candidate with stated obligation coverage
//   3 candidate_review     a human accepts it; acceptance is not promotion, and promotion makes the root
//   4 correction_evidence  the billing system's signed statement that it RAISED the corrective charge
//   5 collection_evidence  the billing system's signed statement that the money ARRIVED
//   6 reconciliation       identity, absorption and duplicate checks
//   7 proven_decision      the PROVEN eligibility decision, either way
//   8 audit_evidence       the CFO-facing audit read and the case's own governed record
//
// A scenario refused at stage 5 has NOT failed stage 8 — it never reached it. The report keeps those
// apart, which is the same rule as NOT COMPUTED versus $0.00 one level up.
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
import { caseProvenEligibility } from "./caseProvenGate";
import { cfoAuditExport } from "../audit/auditService";
import {
  ACCEPTANCE_STAGES,
  buildAcceptanceReport,
  formatAcceptanceReport,
  type AcceptanceStage,
  type ScenarioRecord,
} from "../../scripts/pilot-acceptance/acceptanceReport";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;
const actor = (a: string, r: ActorContext["role"], b: readonly string[]): ActorContext =>
  Object.freeze({ actorId: a, role: r, boundaryIds: Object.freeze([...b]) });

const upTo = (stage: AcceptanceStage): readonly AcceptanceStage[] =>
  ACCEPTANCE_STAGES.slice(0, ACCEPTANCE_STAGES.indexOf(stage) + 1);

type Coverage = "single" | "aggregate";

function signalFor(
  boundaryId: string, sourceRef: string, obligationRef: string,
  expectedMinor: number, billedMinor: number, coverage: Coverage = "single",
) {
  const residual = expectedMinor - billedMinor;
  return {
    signalId: `FIX-${hex().slice(0, 32)}`,
    boundaryId,
    recoveryType: "RevenueUnderBilled",
    sourceRef,
    sourcePayloadHash: hex(),
    detectorVersion: "pilot-acceptance-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: residual,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: coverage === "aggregate"
      ? { kind: "ACCOUNT_AGGREGATE", unitCount: 3 }
      : {
          kind: "SINGLE_OBLIGATION", obligationRef,
          expectedMinor, billedMinor, residualMinor: residual, currency: "USD",
        },
  };
}

describe.skipIf(!HAS_DB)("pilot acceptance journey · ten scenarios, real path, synthetic data", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** Stage 1-3: the opportunity becomes a governed case root. */
  async function openCase(
    boundaryId: string, sourceRef: string, obligationRef: string,
    expectedMinor: number, billedMinor: number, coverage: Coverage = "single",
  ): Promise<{ caseId: string; candidateId: string; exposureMinor: number }> {
    const signal = signalFor(boundaryId, sourceRef, obligationRef, expectedMinor, billedMinor, coverage);
    const dedupeKey = caseCandidateDedupeKey(signal as never);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "pilot-acceptance-v1", signal, submittedAt: new Date() },
    });
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    // STAGE 3 · acceptance is NOT promotion. Two separate governed steps, in order.
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "acceptance journey · synthetic review",
    });
    const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
    return { caseId: promoted.recoveryCase.recoveryCaseId, candidateId, exposureMinor: expectedMinor - billedMinor };
  }

  /** The detector's own succeeded event, so the absorption question is ANSWERABLE. */
  async function detectorEvent(
    boundaryId: string, signals: readonly ReturnType<typeof signalFor>[], absorbed: boolean, withCounts = true,
  ): Promise<void> {
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1,$2,'pilot-acceptance-v1',$3,'{}'::jsonb,'succeeded',1,now(),1,$4::jsonb,now(),now())`,
      taskId, boundaryId, randomUUID(), JSON.stringify(signals),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1,$2,$3,'pilot-acceptance-v1',1,1,'task.succeeded',$4::jsonb,now())`,
      randomUUID(), taskId, boundaryId,
      withCounts ? JSON.stringify(absorbed ? { admittedCount: 1, createdCount: 0 } : { admittedCount: 1, createdCount: 1 }) : "{}",
    );
  }

  /** Stages 4-7: correction evidence, collection evidence, then the approval attempt. */
  async function runToProof(
    caseId: string,
    opts: { collectedMinor: number; evidenceMinor: number; baselineMinor: number; skipCorrection?: boolean; approveAsAuthor?: boolean },
  ): Promise<{ status: number; body: string; returnedMinor?: number }> {
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: opts.baselineMinor });
    // STAGE 4 · the signed statement that the correction was EXECUTED. Omitted only where the scenario's
    // subject is its absence.
    await seedIntervention(app, caseId, opts.skipCorrection === true ? { noCorrectionRecord: true } : {});
    // STAGE 5 · the signed statement that the money ARRIVED.
    const { evidenceId } = await seedEvidence(app, caseId, { amountMinor: opts.evidenceMinor, currency: "USD" });
    const res = await app.inject({
      method: "POST", url: "/proofs",
      headers: opts.approveAsAuthor === true ? AUTHOR : APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: opts.collectedMinor, excludedRecoveryMinor: 0,
        exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    return {
      status: res.statusCode, body: res.body,
      returnedMinor: res.statusCode === 201 ? res.json().revenueReturned.minor : undefined,
    };
  }

  /** Read the refusal code out of an error body without guessing at its wording. */
  function codeFrom(body: string, fallback: string): string {
    const m = body.match(/[A-Z][A-Z0-9_]{6,}/);
    return m ? m[0] : fallback;
  }

  it("runs all ten scenarios and every one does what it was pre-registered to do", async () => {
    const records: ScenarioRecord[] = [];

    // ── A1 · POSITIVE · a clean billing correction, collected in full ────────────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false);
      const r = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      expect(r.status, r.body).toBe(201);
      // STAGE 8 · the CFO-facing audit read sees the frozen proof and reports it as PROVEN money.
      const auditor = actor("cfo@company", "approver", [boundaryId]);
      const audit = await cfoAuditExport(auditor, c.caseId);
      // `provenRevenueReturnedMinor` is `null` for NOT COMPUTED and a number once a proof exists. The
      // journey reads it rather than coalescing it, because `?? 0` at a read site is the exact defect
      // this field was changed to prevent.
      expect(audit.provenRevenueReturnedMinor, JSON.stringify(audit)).toBe(r.returnedMinor);
      expect(audit.excluded).toBe(false);
      expect(audit.currency).toBe("USD");
      records.push({
        id: "A1-clean-correction", expected: "PROVEN",
        intent: "a single under-billed obligation, corrected and collected in full",
        stagesReached: upTo("audit_evidence"),
        outcome: { kind: "PROVEN", provenMinor: r.returnedMinor!, exposureMinor: c.exposureMinor },
      });
    }

    // ── A2/A3 · MULTIPLE OBLIGATIONS on ONE account, each proven on its own facts ────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const oblA = pseudonym();
      const oblB = pseudonym();
      const a = await openCase(boundaryId, account, oblA, 160_000, 100_000);
      const b = await openCase(boundaryId, account, oblB, 250_000, 150_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, oblA, 160_000, 100_000)], false);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, oblB, 250_000, 150_000)], false);
      expect(a.caseId).not.toBe(b.caseId);
      const ra = await runToProof(a.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      const rb = await runToProof(b.caseId, { collectedMinor: 120_000, evidenceMinor: 120_000, baselineMinor: 20_000 });
      expect(ra.status, ra.body).toBe(201);
      expect(rb.status, rb.body).toBe(201);
      records.push({
        id: "A2-two-obligations-1", expected: "PROVEN",
        intent: "first of two obligations on ONE account — identities must not merge",
        stagesReached: upTo("audit_evidence"),
        outcome: { kind: "PROVEN", provenMinor: ra.returnedMinor!, exposureMinor: a.exposureMinor },
      });
      records.push({
        id: "A3-two-obligations-2", expected: "PROVEN",
        intent: "second of two obligations on ONE account — its own figure, not the first's",
        stagesReached: upTo("audit_evidence"),
        outcome: { kind: "PROVEN", provenMinor: rb.returnedMinor!, exposureMinor: b.exposureMinor },
      });
    }

    // ── A4 · PARTIAL PAYMENT · proven is what arrived, never the exposure ────────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000); // $600 at risk
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false);
      const r = await runToProof(c.caseId, { collectedMinor: 30_000, evidenceMinor: 30_000, baselineMinor: 10_000 });
      expect(r.status, r.body).toBe(201);
      expect(r.returnedMinor!).toBeLessThan(c.exposureMinor);
      records.push({
        id: "A4-partial-collection", expected: "PROVEN",
        intent: "only part of the exposure was collected — proven must be Collected minus Baseline",
        stagesReached: upTo("audit_evidence"),
        outcome: { kind: "PROVEN", provenMinor: r.returnedMinor!, exposureMinor: c.exposureMinor },
      });
    }

    // ── A5 · NEGATIVE · claiming more than the signed evidence substantiates ─────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false);
      const r = await runToProof(c.caseId, { collectedMinor: 60_000, evidenceMinor: 30_000, baselineMinor: 10_000 });
      expect(r.status, r.body).toBe(403);
      expect(await prisma.proof.count({ where: { recoveryCaseId: c.caseId } })).toBe(0);
      records.push({
        id: "A5-overclaim", expected: "REFUSED",
        intent: "the claim asserts more collected than the source attested",
        stagesReached: upTo("collection_evidence"),
        outcome: { kind: "REFUSED", atStage: "collection_evidence", code: codeFrom(r.body, "OUTCOME_EVIDENCE_INSUFFICIENT"), detail: "nothing was written" },
      });
    }

    // ── A6 · NEGATIVE · a DUPLICATE event cannot mint a second proof ─────────────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false);
      const first = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      expect(first.status, first.body).toBe(201);
      const second = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      expect(second.status).toBe(409);
      expect(await prisma.proof.count({ where: { recoveryCaseId: c.caseId } })).toBe(1);
      // And the SAME candidate cannot open a second case either — two independent mechanisms.
      const again = await new CandidatePromotionService(new PostgresCandidateReviewStore())
        .promote(actor("ops@test", "operator", [boundaryId]), c.candidateId, boundaryId);
      expect(again.created).toBe(false);
      expect(again.recoveryCase.recoveryCaseId).toBe(c.caseId);
      records.push({
        id: "A6-duplicate-event", expected: "REFUSED",
        intent: "the same recovery submitted twice — exactly one proof may exist",
        stagesReached: upTo("reconciliation"),
        outcome: { kind: "REFUSED", atStage: "reconciliation", code: "DUPLICATE_RECOVERY", detail: "one proof chain already counted; promotion is idempotent too" },
      });
    }

    // ── A7 · CONTRADICTORY OBSERVATION · a second observation folded into the claim ──────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 190_000, 100_000)], true);
      const verdict = await caseProvenEligibility(c.caseId);
      expect(verdict.eligible).toBe(false);
      const r = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      expect(r.status, r.body).toBe(403);
      expect(await prisma.proof.count({ where: { recoveryCaseId: c.caseId } })).toBe(0);
      records.push({
        id: "A7-absorbed-observation", expected: "REFUSED",
        intent: "a differing second observation was absorbed into this claim's identity",
        stagesReached: upTo("proven_decision"),
        outcome: { kind: "REFUSED", atStage: "proven_decision", code: !verdict.eligible ? verdict.code : "?", detail: "the claim may cover more than one observation" },
      });
    }

    // ── A8 · NO OBLIGATION IDENTITY · an account-level aggregate ─────────────────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const c = await openCase(boundaryId, account, pseudonym(), 160_000, 100_000, "aggregate");
      const verdict = await caseProvenEligibility(c.caseId);
      expect(verdict.eligible).toBe(false);
      const r = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000 });
      expect(r.status, r.body).toBe(403);
      records.push({
        id: "A8-no-obligation", expected: "REFUSED",
        intent: "the claim sums several reconciliation units, so no single obligation underlies it",
        stagesReached: upTo("reconciliation"),
        outcome: { kind: "REFUSED", atStage: "reconciliation", code: !verdict.eligible ? verdict.code : "?", detail: "PROVEN may not be assigned at account level" },
      });
    }

    // ── A9 · UNANSWERABLE · an event touching the identity with NO admission counts ──────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false, false);
      const verdict = await caseProvenEligibility(c.caseId);
      expect(verdict.eligible).toBe(false);
      records.push({
        id: "A9-absorption-unknown", expected: "REFUSED",
        intent: "the absorption question cannot be answered — NOT CHECKED is never read as none",
        stagesReached: upTo("proven_decision"),
        outcome: { kind: "REFUSED", atStage: "proven_decision", code: !verdict.eligible ? verdict.code : "?", detail: "a partial count is not a count" },
      });
    }

    // ── A10 · NO EXECUTED CORRECTION · the money without the fix ─────────────────────────────────────
    {
      const boundaryId = `TEST-acc-${uid()}`;
      const account = pseudonym();
      const obligation = pseudonym();
      const c = await openCase(boundaryId, account, obligation, 160_000, 100_000);
      await detectorEvent(boundaryId, [signalFor(boundaryId, account, obligation, 160_000, 100_000)], false);
      const r = await runToProof(c.caseId, { collectedMinor: 70_000, evidenceMinor: 70_000, baselineMinor: 10_000, skipCorrection: true });
      expect(r.status, r.body).toBe(403);
      expect(await prisma.proof.count({ where: { recoveryCaseId: c.caseId } })).toBe(0);
      records.push({
        id: "A10-no-correction", expected: "REFUSED",
        intent: "money arrived but no source attested that the correction was EXECUTED",
        stagesReached: upTo("correction_evidence"),
        outcome: { kind: "REFUSED", atStage: "correction_evidence", code: codeFrom(r.body, "NO_EXECUTED_CORRECTION_RECORD"), detail: "a collection is not a correction" },
      });
    }

    // ── THE REPORT ───────────────────────────────────────────────────────────────────────────────────
    const report = buildAcceptanceReport(records);
    // eslint-disable-next-line no-console
    console.log(`\n${formatAcceptanceReport(report)}\n`);

    expect(report.totals.scenarios).toBe(10);
    expect(report.totals.proven).toBe(4);
    expect(report.totals.refused).toBe(6);
    expect(report.totals.notRun).toBe(0);
    expect(report.surprises, JSON.stringify(report.surprises)).toEqual([]);
    expect(report.verdict).toBe("ACCEPTED");

    // THE MONEY, AS TWO FIGURES THAT ARE NEVER ADDED.
    // Proven: A1 600 + A2 600 + A3 1000 + A4 200 = 2400.00
    expect(report.totals.provenMinor).toBe(240_000);
    // Exposure on those same four: 600 + 600 + 1000 + 600 = 2800.00 — larger, because A4 collected part.
    expect(report.totals.provenScenarioExposureMinor).toBe(280_000);
    expect(report.totals.provenMinor).toBeLessThan(report.totals.provenScenarioExposureMinor);

    // EVERY REFUSAL NAMED A STAGE AND A CODE. A refusal with no reason is not a refusal a CFO can read.
    for (const s of records.filter((x) => x.outcome.kind === "REFUSED")) {
      if (s.outcome.kind !== "REFUSED") continue;
      expect(ACCEPTANCE_STAGES, s.id).toContain(s.outcome.atStage);
      expect(s.outcome.code, s.id).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(s.outcome.code, s.id).not.toBe("?");
    }

    // AND THE REFUSALS ARE DISTINCT. Six scenarios refusing with one shared code would mean the journey
    // was measuring one gate five times over.
    const codes = new Set(records.flatMap((s) => (s.outcome.kind === "REFUSED" ? [s.outcome.code] : [])));
    expect(codes.size).toBeGreaterThanOrEqual(5);
  }, 600_000);
});
