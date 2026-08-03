// EP-8.1 · Shared REST-acceptance-test fixtures for the governed approval flow.
//
// The EP-8.1 trust model requires a locked BaselineSnapshot and (for auditable-tier claims)
// referenced outcome-role evidence to exist BEFORE a proof can be approved — neither can be
// asserted inline on the approval request anymore. These helpers do that governed multi-step
// setup (author → baseline → intervention → evidence) once, so acceptance tests across
// EP-2/3/4/8/8.1 do not each re-invent it.
import type { FastifyInstance } from "fastify";

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
  opts: { baselineId?: string; calculatedMinor?: number; currency?: string; actor?: Record<string, string> } = {},
): Promise<string> {
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
    payload: {
      evidenceId,
      sourceSystem: opts.sourceSystem ?? "billing",
      sourceRecordId: opts.sourceRecordId ?? `inv-${uid()}`,
      evidenceType: opts.evidenceType ?? "invoice_paid",
      observedAt: opts.observedAt ?? "2026-07-25T00:00:00.000Z",
      amountMinor: opts.amountMinor,
      currency: opts.currency,
    },
  });
  return { evidenceId, res };
}

/**
 * Full legitimate setup for a case approvable at auditable tier: author → baseline (locked) →
 * intervention recorded → outcome evidence ingested. Returns everything `approveBody` needs.
 */
export async function seedAuditableCase(
  app: FastifyInstance,
  opts: { caseId?: string; collectedMinor?: number; baselineMinor?: number; currency?: string } = {},
): Promise<{ caseId: string; baselineId: string; evidenceId: string; currency: string; collectedMinor: number }> {
  const caseId = opts.caseId ?? `RC-${uid()}`;
  const currency = opts.currency ?? "USD";
  const collectedMinor = opts.collectedMinor ?? 1_320_000;
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
