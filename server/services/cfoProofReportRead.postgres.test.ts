// THE CFO PROOF REPORT over a boundary, through the real path · Issue #18 Priority 4.
//
// Every row these tests read comes from records production code wrote: the candidate by the real
// staging identity, the review by `CandidateReviewService`, the root by
// `CandidatePromotionService.promote`, and the baseline, intervention, evidence and proof by the real
// HTTP routes with separation of duties and source verification in force.
//
// THE EXPECTATIONS ARE READ FROM THE PRE-REGISTRATION, frozen at sha256 0eb568b9… in commit a2b07c5,
// which contains no implementation.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { cfoAuditExport } from "../audit/auditService";
import { readCfoProofReport } from "./cfoProofReportRead";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;

const PREREG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../docs/architecture/cfo-proof-report-preregistration.json", import.meta.url)),
    "utf8",
  ),
) as {
  properties: readonly { id: string; property: string }[];
  measuredPredictionsAboutTHEEXISTINGSURFACE: readonly { id: string; claim: string; status: string }[];
  adversarialCases: readonly { id: string; name: string; expected: string }[];
};

const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;

type Coverage =
  | { kind: "SINGLE_OBLIGATION"; obligationRef: string; expectedMinor: number; billedMinor: number; residualMinor: number; currency: string }
  | { kind: "ACCOUNT_AGGREGATE"; unitCount: number };

const singleObligation = (expectedMinor: number, billedMinor: number, currency = "USD"): Coverage => ({
  kind: "SINGLE_OBLIGATION", obligationRef: pseudonym(),
  expectedMinor, billedMinor, residualMinor: expectedMinor - billedMinor, currency,
});

/** Promote one case into an existing boundary, through the real governed path. */
async function seedCaseIn(boundaryId: string, opts: {
  readonly coverage: Coverage; readonly amountAtRiskMinor: number; readonly currency?: string;
}): Promise<{ caseId: string; sourceRef: string; obligationRef: string | null }> {
  const sourceRef = pseudonym();
  const currency = opts.currency ?? "USD";
  const signal = {
    signalId: `FIX-${hex().slice(0, 32)}`, boundaryId, recoveryType: "RevenueUnderBilled", sourceRef,
    sourcePayloadHash: hex(), detectorVersion: "cfo-test-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: opts.amountAtRiskMinor, currency, actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: opts.coverage,
  };
  const dedupeKey = caseCandidateDedupeKey(signal as never);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "cfo-test-v1", signal, submittedAt: new Date() },
  });
  const operator = actor("ops@test", "operator", [boundaryId]);
  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId, boundaryId, decision: "accepted", reason: "test · governed review for the CFO report",
  });
  const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
  return {
    caseId: promoted.recoveryCase.recoveryCaseId,
    sourceRef,
    obligationRef: opts.coverage.kind === "SINGLE_OBLIGATION" ? opts.coverage.obligationRef : null,
  };
}

async function recordObservation(
  boundaryId: string, sourceRef: string, obligationRef: string | null,
  amountAtRiskMinor: number, metadata: Record<string, unknown>,
): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'cfo-test-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(),
    JSON.stringify([{
      recoveryType: "RevenueUnderBilled", sourceRef, amountAtRiskMinor, currency: "USD",
      ...(obligationRef ? { obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef } } : {}),
    }]),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'cfo-test-v1', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, boundaryId, JSON.stringify(metadata),
  );
}

describe.skipIf(!HAS_DB)("the CFO Proof report", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const approverIn = (b: string) => actor("cfo@test", "approver", [b]);

  /** Carry one case to a frozen proof. */
  async function proveCase(caseId: string, collectedMinor: number, baselineMinor: number): Promise<string> {
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: baselineMinor });
    await seedIntervention(app, caseId);
    const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: collectedMinor, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);
    const proofId = `SYNTHETIC-proof-${randomUUID()}`;
    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId, recoveryCaseId: caseId, currency: "USD", collectedMinor,
        excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    return proofId;
  }

  /** A boundary holding four cases: proven, disputed, aggregate, and bare. */
  async function seedBook() {
    const boundaryId = `TEST-cfo-${uid()}`;
    const proven = await seedCaseIn(boundaryId, { coverage: singleObligation(160_000, 100_000), amountAtRiskMinor: 60_000 });
    await recordObservation(boundaryId, proven.sourceRef, proven.obligationRef, 60_000, { admittedCount: 1, createdCount: 1 });
    const proofId = await proveCase(proven.caseId, 70_000, 10_000);

    const disputed = await seedCaseIn(boundaryId, { coverage: singleObligation(100_000, 60_000), amountAtRiskMinor: 40_000 });
    await recordObservation(boundaryId, disputed.sourceRef, disputed.obligationRef, 40_000, { admittedCount: 1, createdCount: 1 });
    await recordObservation(boundaryId, disputed.sourceRef, disputed.obligationRef, 60_000, { admittedCount: 1, createdCount: 0 });

    const aggregate = await seedCaseIn(boundaryId, { coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 3 }, amountAtRiskMinor: 30_000 });
    const bare = await seedCaseIn(boundaryId, { coverage: singleObligation(50_000, 40_000), amountAtRiskMinor: 10_000 });
    return { boundaryId, proven, proofId, disputed, aggregate, bare };
  }

  // ── P7 · authorization ───────────────────────────────────────────────────────────────────────────
  it("P7 · AuditRead first, then boundary access", async () => {
    const boundaryId = `TEST-cfo-${uid()}`;
    await seedCaseIn(boundaryId, { coverage: singleObligation(160_000, 100_000), amountAtRiskMinor: 60_000 });
    for (const role of ["operator", "author"] as const) {
      await expect(readCfoProofReport(actor(`${role}@test`, role, [boundaryId]), boundaryId)).rejects.toThrow(
        /forbidden|not permitted|AuditRead/i,
      );
    }
    // An actor may only name a boundary they hold — naming another cannot widen what is readable.
    await expect(readCfoProofReport(approverIn(`TEST-other-${uid()}`), boundaryId)).rejects.toThrow(/boundary|forbidden/i);
    expect((await readCfoProofReport(approverIn(boundaryId), boundaryId)).report.rows).toHaveLength(1);

    // THE GATE IS ASSERTED ON AN EMPTY BOUNDARY TOO, and this is the assertion that matters. A mutation
    // removing `requireCan` from this module passed the checks above, because the per-case
    // `readFinancialTrace` carries its own gate and refused the operator downstream — so the report's
    // OWN authorization was never under test. With no cases there is nothing downstream to refuse, so
    // this is the only place the claim "an unauthorized actor learns nothing, including whether a
    // boundary holds any cases" is actually checked. A test that rides on another layer's gate is not a
    // control.
    const emptyBoundary = `TEST-cfo-gate-${uid()}`;
    for (const role of ["operator", "author"] as const) {
      await expect(
        readCfoProofReport(actor(`${role}@test`, role, [emptyBoundary]), emptyBoundary),
      ).rejects.toThrow(/forbidden|not permitted|AuditRead/i);
    }
    expect((await readCfoProofReport(approverIn(emptyBoundary), emptyBoundary)).report.rows).toEqual([]);
  });

  // ── The book ────────────────────────────────────────────────────────────────────────────────────
  it("reports one row per obligation, with coverage leading and the gate's verdict", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    expect(view.report.rows).toHaveLength(4);
    const byCase = new Map(view.report.rows.map((r) => [r.recoveryCaseId, r]));

    const proven = byCase.get(book.proven.caseId)!;
    expect(proven.obligationCoverage).toBe("SINGLE_OBLIGATION");
    expect(proven.detectedExposureMinor).toBe(60_000);
    expect(proven.proofChainFigureMinor).toBe(60_000);
    expect(proven.gateVerdict).toBe("ELIGIBLE");
    expect(proven.attestationCode).toBe("INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD");
    expect(proven.evidenceSources).toEqual([
      { sourceSystem: "billing", trustClassification: "independent", signatureVerified: true },
    ]);

    const aggregate = byCase.get(book.aggregate.caseId)!;
    expect(aggregate.obligationCoverage).toBe("ACCOUNT_AGGREGATE");
    expect(aggregate.gateVerdict).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");

    const bare = byCase.get(book.bare.caseId)!;
    expect(bare.proofChainFigureMinor).toBeNull();
    expect(bare.attestationCode).toBe("NO_EVIDENCE");
    expect(bare.evidenceSources).toEqual([]);
  });

  // ── P1 / P2 · the two that carry the weight ─────────────────────────────────────────────────────
  it("P1/P2 · every row claims $0.00 collected, so every detected dollar is still open", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    for (const r of view.report.rows) {
      expect(r.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
      expect(r.claimedCollectedIsAsserted).toBe(true);
      expect(r.openBalanceMinor).toBe(r.detectedExposureMinor);
      expect(r.revenueReturnedWithheldCodes).toContain("REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED");
    }
    // 60,000 + 40,000 + 30,000 + 10,000 = 140,000 detected, and all of it open.
    expect(view.report.totals.detectedExposureMinor).toBe(140_000);
    expect(view.report.totals.openBalanceMinor).toBe(140_000);
    expect(view.report.totals.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
    // And the proven case's $600.00 reduced the open balance by nothing at all.
    expect(view.report.totals.openBalanceMinor).toBe(view.report.totals.detectedExposureMinor);
  });

  // ── P3 · the dispute is reported and never netted ───────────────────────────────────────────────
  it("P3 · a disputed correction is reported beside exposure, not inside it", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    const disputed = view.report.rows.find((r) => r.recoveryCaseId === book.disputed.caseId)!;
    expect(disputed.disputedState).toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
    expect(disputed.disputedAmountMinor).toBe(20_000);
    expect(disputed.disputedDirection).toBe("UPWARD");
    // Exposure is the frozen promotion figure, untouched by the dispute.
    expect(disputed.detectedExposureMinor).toBe(40_000);
    expect(disputed.openBalanceMinor).toBe(40_000);
    expect(view.report.totals.disputedUpwardMinor).toBe(20_000);
    expect(view.report.totals.disputedDownwardMinor).toBeNull();
    expect(Object.keys(view.report.totals)).not.toContain("disputedNetMinor");
  });

  // ── A5 · a case that does not exist is not a row ────────────────────────────────────────────────
  it("A5 · a non-existent case cannot appear, with zeros or otherwise", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    expect(view.report.rows.map((r) => r.recoveryCaseId)).not.toContain(`RC-does-not-exist-${uid()}`);
    expect(view.report.rows).toHaveLength(4);
    expect(PREREG.adversarialCases.find((a) => a.id === "A5")!.expected).toContain("FAILS CLOSED");
  });

  // ── A6 / P8 · an empty boundary ─────────────────────────────────────────────────────────────────
  it("A6/P8 · an empty boundary reports zero rows, null totals and an explicit notice", async () => {
    const empty = `TEST-cfo-empty-${uid()}`;
    const view = await readCfoProofReport(approverIn(empty), empty);
    expect(view.report.rows).toEqual([]);
    expect(view.report.totals.unavailableReason).toBe("no_rows");
    expect(view.report.totals.detectedExposureMinor).toBeNull();
    expect(view.report.totals.openBalanceMinor).toBeNull();
    expect(view.report.emptyBoundaryNotice).toContain("a finding that nothing is owed");
  });

  // ── P6 · reproducible, and traceable to the evidence ───────────────────────────────────────────
  it("P6 · the same records yield the same digest, and each row names its trace digest", async () => {
    const book = await seedBook();
    const a = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    const b = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    expect(a.reportDigest).toBe(b.reportDigest);
    expect(a.canonical).toBe(b.canonical);
    expect(createHash("sha256").update(a.canonical).digest("hex")).toBe(a.reportDigest);
    expect(a.traceDigests).toHaveLength(4);
    for (const t of a.traceDigests) expect(t.traceDigest).toMatch(/^[a-f0-9]{64}$/);
    // No clock reached the preimage.
    for (const clock of ["generatedAt", "verifiedAt", "ingestedAt"]) expect(a.canonical).not.toContain(clock);
  });

  it("no raw pseudonymous reference reaches the report", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("hmac-sha256:");
    expect(serialized).not.toContain(book.proven.sourceRef);
    expect(serialized).not.toContain(book.proven.obligationRef!);
  });

  // ── M1 · the measured prediction about the EXISTING surface ─────────────────────────────────────
  it("M1 · cfoAuditExport reports a clean zero for a case that never existed, and this one fails closed", async () => {
    const m1 = PREREG.measuredPredictionsAboutTHEEXISTINGSURFACE.find((m) => m.id === "M1")!;
    expect(m1.status).toContain("found TRUE");

    // Reproduced here so the finding is evidence in the suite rather than an anecdote in a report.
    const nobody = actor("cfo@test", "approver", ["TEST-cfo-nothing"]);
    const legacy = await cfoAuditExport(nobody, `RC-never-existed-${uid()}`);
    expect(legacy.provenRevenueReturnedMinor).toBe(0);
    expect(legacy.auditableRevenueMinor).toBe(0);
    expect(legacy.currency).toBeNull();
    expect(legacy.excluded).toBe(false);
    expect(legacy.chain).toEqual([]);

    // THE NEW SURFACE DOES NOT DO THAT. A boundary with no governed root reports no row and null
    // totals, with the notice saying what the absence does and does not mean — and a case id that does
    // not exist cannot be listed at all, because the report enumerates roots.
    const fresh = `TEST-cfo-nothing-${uid()}`;
    const view = await readCfoProofReport(actor("cfo@test", "approver", [fresh]), fresh);
    expect(view.report.rows).toEqual([]);
    expect(view.report.totals.detectedExposureMinor).toBeNull();
    expect(view.report.totals.openBalanceMinor).toBeNull();
    expect(view.report.emptyBoundaryNotice).not.toBeNull();
  });


  // ── Q1-Q6 / B1-B4 · the coverage disclosure, on real records ───────────────────────────────────
  it("Q1-Q3 · counts what never became a case, and refuses to read what the handler discarded", async () => {
    const book = await seedBook();
    // B1 · a candidate nobody has reviewed. B2 · one reviewed and rejected. B3 · an aggregate accepted
    // but never promoted. All three in the same boundary as the four reported cases.
    const boundaryId = book.boundaryId;
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();

    const stage = async (coverage: Coverage, amountAtRiskMinor: number) => {
      const sourceRef = pseudonym();
      const signal = {
        signalId: `FIX-${hex().slice(0, 32)}`, boundaryId, recoveryType: "RevenueUnderBilled", sourceRef,
        sourcePayloadHash: hex(), detectorVersion: "cfo-test-v1",
        observedAt: new Date(Date.now() - 86_400_000).toISOString(),
        amountAtRiskMinor, currency: "USD", actionAvailable: true,
        expectedProofEvent: "corrective invoice raised and collected", obligationCoverage: coverage,
      };
      const dedupeKey = caseCandidateDedupeKey(signal as never);
      const candidateId = caseCandidateId(dedupeKey);
      await prisma.agentCaseCandidateRecord.create({
        data: { candidateId, dedupeKey, boundaryId, agentId: "cfo-test-v1", signal, submittedAt: new Date() },
      });
      return candidateId;
    };

    await stage(singleObligation(80_000, 50_000), 30_000);                       // pending review
    const toReject = await stage(singleObligation(70_000, 50_000), 20_000);      // rejected
    await new CandidateReviewService(store).decide(operator, {
      candidateId: toReject, boundaryId, decision: "rejected", reason: "test · not a real shortfall",
    });
    const accepted = await stage({ kind: "ACCOUNT_AGGREGATE", unitCount: 2 }, 50_000); // accepted, unpromoted
    await new CandidateReviewService(store).decide(operator, {
      candidateId: accepted, boundaryId, decision: "accepted", reason: "test · accepted and left unpromoted",
    });

    const view = await readCfoProofReport(approverIn(boundaryId), boundaryId);
    const c = view.report.coverage;
    expect(c.population).toBe("governed roots in this boundary");
    expect(c.governedRootsReported).toBe(4);
    expect(c.unpromotedCandidates.examined).toBe(true);
    expect(c.unpromotedCandidates.pendingReview).toBe(1);
    expect(c.unpromotedCandidates.rejected).toBe(1);
    expect(c.unpromotedCandidates.acceptedNotPromoted).toBe(1);
    // 30,000 + 20,000 + 50,000 stated by candidates that are NOT cases.
    expect(c.unpromotedCandidates.statedAmountMinor).toBe(100_000);
    expect([...c.unpromotedCandidates.coverageKinds].sort()).toEqual(["ACCOUNT_AGGREGATE", "SINGLE_OBLIGATION"]);

    // AND NOT ONE CENT OF IT REACHED THE MONEY. Detected stays $1,400.00, open stays $1,400.00, and
    // 140,000 + 100,000 = 240,000 appears nowhere.
    expect(view.report.totals.detectedExposureMinor).toBe(140_000);
    expect(view.report.totals.openBalanceMinor).toBe(140_000);
    expect(JSON.stringify(view.report.totals)).not.toContain("240000");

    // Q3 · the refused figure is unreadable rather than nil, and carries no amount field at all.
    expect(c.refusedUpstreamExposure.establishable).toBe(false);
    expect(Object.keys(c.refusedUpstreamExposure)).toEqual(["establishable", "reason"]);
  });

  it("the unpromoted state is derived from the review and the root, not from the inert status column", async () => {
    const book = await seedBook();
    // Every candidate here WAS promoted, so the unpromoted counts are zero — and that zero is correct
    // because the population was examined. Reading `status` instead would report all four as pending,
    // since `agent_case_candidates_status_valid` pins that column to 'pending_review' for every row.
    const rows = await prisma.agentCaseCandidateRecord.findMany({
      where: { boundaryId: book.boundaryId }, select: { status: true },
    });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["pending_review"]));

    const c = (await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId)).report.coverage;
    expect([c.unpromotedCandidates.pendingReview, c.unpromotedCandidates.rejected, c.unpromotedCandidates.acceptedNotPromoted])
      .toEqual([0, 0, 0]);
    expect(c.unpromotedCandidates.statedAmountMinor).toBeNull();
    expect(c.governedRootsReported).toBe(4);
  });

  it("Q5 · the coverage is in the digest, so a change in what is covered moves it", async () => {
    const book = await seedBook();
    const before = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    // One more candidate, unreviewed: the money does not move and the completeness claim does.
    const sourceRef = pseudonym();
    const signal = {
      signalId: `FIX-${hex().slice(0, 32)}`, boundaryId: book.boundaryId, recoveryType: "RevenueUnderBilled",
      sourceRef, sourcePayloadHash: hex(), detectorVersion: "cfo-test-v1",
      observedAt: new Date(Date.now() - 86_400_000).toISOString(),
      amountAtRiskMinor: 15_000, currency: "USD", actionAvailable: true,
      expectedProofEvent: "corrective invoice raised and collected",
      obligationCoverage: singleObligation(55_000, 40_000),
    };
    const dedupeKey = caseCandidateDedupeKey(signal as never);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId: caseCandidateId(dedupeKey), dedupeKey, boundaryId: book.boundaryId,
              agentId: "cfo-test-v1", signal, submittedAt: new Date() },
    });
    const after = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    expect(after.report.totals.detectedExposureMinor).toBe(before.report.totals.detectedExposureMinor);
    expect(after.report.coverage.unpromotedCandidates.pendingReview).toBe(1);
    expect(after.reportDigest).not.toBe(before.reportDigest);
  });

  it("Q6 · an empty boundary reports coverage as examined-and-empty, with the refusal still unreadable", async () => {
    const empty = `TEST-cfo-cov-${uid()}`;
    const c = (await readCfoProofReport(approverIn(empty), empty)).report.coverage;
    expect(c.governedRootsReported).toBe(0);
    expect(c.unpromotedCandidates.examined).toBe(true);
    expect(c.unpromotedCandidates.statedAmountMinor).toBeNull();
    expect(c.unpromotedCandidates.coverageKinds).toEqual([]);
    expect(c.refusedUpstreamExposure.establishable).toBe(false);
  });

  it("P4 · no row or total presents a positive collected figure", async () => {
    const book = await seedBook();
    const view = await readCfoProofReport(approverIn(book.boundaryId), book.boundaryId);
    for (const r of view.report.rows) {
      expect(r.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
    }
    expect(view.report.claimStatement).toContain("$0.00");
    expect(view.report.disclosure).toContain("no amount here was collected");
    expect(PREREG.properties.find((p) => p.id === "P4")!.property).toContain("money the business got back");
  });
});
