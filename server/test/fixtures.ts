// EP-8.1 · Shared REST-acceptance-test fixtures for the governed approval flow.
//
// The EP-8.1 trust model requires a locked BaselineSnapshot and (for auditable-tier claims)
// referenced outcome-role evidence to exist BEFORE a proof can be approved — neither can be
// asserted inline on the approval request anymore. These helpers do that governed multi-step
// setup (author → baseline → intervention → evidence) once, so acceptance tests across
// EP-2/3/4/8/8.1 do not each re-invent it.
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { attestFixture } from "./sourceFixture";
import { prisma } from "../db";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import type { CandidateSignal } from "../agents/types";

export const uid = (): string => Math.random().toString(36).slice(2, 10);
export const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });
export const AUTHOR = hdr("dana@company", "author");
export const APPROVER = hdr("cfo@company", "approver");
export const VERIFIER = hdr("val@company", "verifier");
export const STEWARD = hdr("gov@company", "steward");

/** Establish + lock a baseline snapshot for a case (author-only governed step). */
export async function seedBaseline(
  app: FastifyInstance,
  caseId: string,
  opts: {
    baselineId?: string; calculatedMinor?: number; currency?: string; actor?: Record<string, string>;
    /**
     * Skip the governed root. ONLY for a test whose subject is the ABSENCE of one — leaving it absent
     * everywhere else was what made the old suite exercise a path the approved rule forbids.
     */
    noGovernedRoot?: boolean;
  } = {},
): Promise<string> {
  if (opts.noGovernedRoot !== true) await seedGovernedRoot(caseId, { currency: opts.currency });
  const baselineId = opts.baselineId ?? `BL-${uid()}`;
  const res = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/baseline`,
    headers: opts.actor ?? AUTHOR,
    payload: {
      baselineId,
      calculatedMinor: opts.calculatedMinor ?? 260_000,
      currency: opts.currency ?? "USD",
      method: "matched_historical_cohort",
      methodVersion: 1,
      sourceRefs: ["src-1"],
      effectiveAt: "2026-07-01T00:00:00.000Z",
    },
  });
  if (res.statusCode !== 201) throw new Error(`seedBaseline failed: ${res.statusCode} ${res.body}`);
  return baselineId;
}

/** Record the governed Fix/intervention timing event for a case. */
export async function seedIntervention(
  app: FastifyInstance,
  caseId: string,
  opts: { actor?: Record<string, string> } = {},
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/intervention`,
    headers: opts.actor ?? AUTHOR,
  });
  if (res.statusCode !== 201) throw new Error(`seedIntervention failed: ${res.statusCode} ${res.body}`);
}

/** Ingest one evidence item. Defaults to an outcome-role billing record (invoice_paid). */
export async function seedEvidence(
  app: FastifyInstance,
  caseId: string,
  opts: {
    evidenceId?: string;
    sourceSystem?: string;
    sourceRecordId?: string;
    evidenceType?: string;
    observedAt?: string;
    amountMinor?: number;
    currency?: string;
    actor?: Record<string, string>;
  } = {},
): Promise<{ evidenceId: string; res: Awaited<ReturnType<FastifyInstance["inject"]>> }> {
  const evidenceId = opts.evidenceId ?? `EV-${uid()}`;
  const res = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/evidence`,
    headers: opts.actor ?? AUTHOR,
    payload: attestFixture(caseId, {
      evidenceId,
      sourceSystem: opts.sourceSystem ?? "billing",
      sourceRecordId: opts.sourceRecordId ?? `inv-${uid()}`,
      evidenceType: opts.evidenceType ?? "invoice_paid",
      observedAt: opts.observedAt ?? "2026-07-25T00:00:00.000Z",
      amountMinor: opts.amountMinor,
      currency: opts.amountMinor === undefined ? opts.currency : (opts.currency ?? "USD"),
    }),
  });
  return { evidenceId, res };
}

/**
 * Full legitimate setup for a case approvable at auditable tier: author → baseline (locked) →
 * intervention recorded → outcome evidence ingested. Returns everything `approveBody` needs.
 */
/**
 * The GOVERNED ROOT a monetary proof now requires: a candidate stating what its claim covers, and a
 * RecoveryCase root pointing at it.
 *
 * WHY THIS IS A FIXTURE CHANGE AND NOT A GATE WEAKENING. `approve()` refuses a case whose obligation
 * coverage is not stated, which is the approved rule. Before this helper existed, every acceptance test
 * approved a proof for a case id with NO governed root at all — so the suite was exercising a path the
 * rule forbids, and in production an operator could do the same. The tests model SINGLE-OBLIGATION
 * claims, so the fixture now says so explicitly instead of leaving the subject of the claim unrecorded.
 *
 * The figures are self-consistent by CONSTRUCTION — `residualMinor` is derived from the two beside it,
 * never passed in — because a fixture that can stamp an unreconcilable triple would be testing the
 * gate's arithmetic branch by accident instead of its identity branch on purpose.
 */
export async function seedGovernedRoot(
  caseId: string,
  opts: { boundaryId?: string; expectedMinor?: number; billedMinor?: number; currency?: string } = {},
): Promise<{ boundaryId: string; candidateId: string; sourceRef: string; obligationRef: string } | null> {
  // IDEMPOTENT, because `seedBaseline` now ensures a root and `seedAuditableCase` calls both. Returning
  // `null` for "already present" rather than throwing keeps the two entry points composable without
  // either having to know whether the other ran.
  const existing = await prisma.recoveryCaseRecord.findUnique({
    where: { recoveryCaseId: caseId }, select: { recoveryCaseId: true },
  });
  if (existing) return null;
  const boundaryId = opts.boundaryId ?? `SYNTHETIC-fixture-${uid()}`;
  const currency = opts.currency ?? "USD";
  const expectedMinor = opts.expectedMinor ?? 1_600_000;
  const billedMinor = opts.billedMinor ?? 280_000;
  const recoveryType = "RevenueUnderBilled";
  const key = `fixture-${caseId}-${boundaryId}`;
  const h = (ns: string) => `hmac-sha256:${createHmac("sha256", key).update(ns).digest("hex")}`;
  const sourceRef = h("account");
  const obligationRef = h("obligation");

  const signal: CandidateSignal = {
    signalId: `FIX-${uid()}${uid()}`,
    boundaryId,
    recoveryType,
    sourceRef,
    sourcePayloadHash: createHmac("sha256", key).update("payload").digest("hex"),
    detectorVersion: "fixture-governed-root-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: expectedMinor - billedMinor,
    currency,
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: {
      kind: "SINGLE_OBLIGATION",
      obligationRef,
      expectedMinor,
      billedMinor,
      residualMinor: expectedMinor - billedMinor,
      currency,
    },
  };
  const dedupeKey = caseCandidateDedupeKey(signal);
  const candidateId = caseCandidateId(dedupeKey);

  await prisma.agentCaseCandidateRecord.create({
    data: {
      candidateId, dedupeKey, boundaryId, agentId: "fixture-governed-root-v1",
      signal: signal as unknown as object, submittedAt: new Date(),
    },
  });
  // THE DATABASE ENFORCES THE GOVERNANCE CHAIN, not just this fixture: a trigger refuses a
  // RecoveryCase whose candidate carries no ACCEPTED review ("RecoveryCase requires an accepted
  // candidate review"). Found by being refused, which is the right way to learn it.
  await prisma.agentCaseCandidateReviewRecord.create({
    data: {
      reviewId: `CR-${uid()}${uid()}`, candidateId, boundaryId, decision: "accepted",
      reason: "fixture: a single-obligation claim accepted for the governed approval flow",
      // `operator` is the ONLY role the database permits here (agent_case_candidate_reviews_role_valid),
      // and the only one it permits as a case opener (recovery_cases_opener_role_valid).
      actorId: "ops@company", actorRole: "operator", policyVersion: "fixture",
    },
  });
  await prisma.recoveryCaseRecord.create({
    data: {
      recoveryCaseId: caseId, boundaryId, sourceCandidateId: candidateId, recoveryType, sourceRef,
      amountAtRiskMinor: BigInt(expectedMinor - billedMinor), currency,
      detectorVersion: "fixture-governed-root-v1",
      openedByActorId: "ops@company", openedByRole: "operator", policyVersion: "fixture",
      openedAt: new Date(),
    },
  });
  return { boundaryId, candidateId, sourceRef, obligationRef };
}

export async function seedAuditableCase(
  app: FastifyInstance,
  opts: { caseId?: string; collectedMinor?: number; baselineMinor?: number; currency?: string } = {},
): Promise<{ caseId: string; baselineId: string; evidenceId: string; currency: string; collectedMinor: number }> {
  const caseId = opts.caseId ?? `RC-${uid()}`;
  const currency = opts.currency ?? "USD";
  const collectedMinor = opts.collectedMinor ?? 1_320_000;
  await seedGovernedRoot(caseId, { currency });
  await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
  const baselineId = await seedBaseline(app, caseId, { calculatedMinor: opts.baselineMinor ?? 260_000, currency });
  await seedIntervention(app, caseId);
  const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: collectedMinor, currency });
  if (res.statusCode !== 201) throw new Error(`seedAuditableCase evidence failed: ${res.statusCode} ${res.body}`);
  return { caseId, baselineId, evidenceId, currency, collectedMinor };
}

export function approveBody(input: {
  proofId: string;
  caseId: string;
  baselineId: string;
  evidenceIds: string[];
  currency?: string;
  collectedMinor?: number;
  excludedRecoveryMinor?: number;
  exclusionStatement?: string;
  recoveryReason?: string;
  attribution?: string;
  confidenceUsed?: number;
}) {
  return {
    proofId: input.proofId,
    recoveryCaseId: input.caseId,
    currency: input.currency ?? "USD",
    collectedMinor: input.collectedMinor ?? 1_320_000,
    excludedRecoveryMinor: input.excludedRecoveryMinor ?? 0,
    exclusionStatement: input.exclusionStatement ?? "no exclusions asserted",
    recoveryReason: input.recoveryReason ?? "UsageActivation",
    attribution: input.attribution ?? "ar-system",
    evidenceIds: input.evidenceIds,
    baselineId: input.baselineId,
    confidenceUsed: input.confidenceUsed ?? 95,
  };
}
