// EP-8 · Audit & explainability service (READ-ONLY).
//
// Every function reconstructs from PERSISTED, FROZEN records only — it invents nothing
// and mutates nothing. Access is governed: an authenticated actor with the `AuditRead`
// permission is required (approver/verifier/steward — never a beneficiary), enforced here
// in the service layer. The domain kernel remains the source of truth for what is
// auditable; this service never recomputes a counted number, it re-derives it from the
// frozen collected/baseline to PROVE reconstruction.
import { getProofById, getCaseProofs } from "../persistence/proofStore";
import { authorityFor, type AuthorityRecord } from "../auth/authorityStore";
import { requireCan, firstInterveneEvent } from "../auth/authorityGate";
import { getBaselineSnapshot, getBaselinesForCase, type BaselineSnapshot } from "../persistence/baselineStore";
import { getEvidenceForCase, type IngestedEvidence } from "../persistence/evidenceStore";
import type { ActorContext } from "../auth/identity";
import { NotFoundError } from "../http/errors";
import { prisma } from "../db";
import type { Proof } from "../../src/domain/proof";
import { effectiveProofs, isEffectiveRecovery } from "../../src/domain/proof";
import { proofIsAuditable } from "../../src/domain/provenLedger";
import {
  type Money,
  addMoney,
  subMoney,
  clampNonNegative,
} from "../../src/domain/money";

/** Required frozen-provenance fields; any missing one excludes the amount from auditable. */
export function provenanceGaps(p: Proof): string[] {
  const gaps: string[] = [];
  if (!p.policyVersion) gaps.push("policyVersion");
  if (!p.confidenceMethodologyVersion) gaps.push("confidenceMethodologyVersion");
  if (!p.baselineId) gaps.push("baselineId");
  if (!p.baselineMethodId) gaps.push("baselineMethodId");
  if (!(p.baselineVersion >= 1)) gaps.push("baselineVersion");
  if (!p.baselineLockPolicy) gaps.push("baselineLockPolicy");
  if (!p.exclusionStatement) gaps.push("exclusionStatement");
  if (!p.evidenceRefs || p.evidenceRefs.length === 0) gaps.push("evidenceRefs");
  return gaps;
}

/**
 * EP-8.1 · Trust gaps re-derived from CURRENT persisted state (the locked BaselineSnapshot +
 * the case's live authority ledger) — never from the frozen proof alone. A gap here means the
 * amount stays Proven but is excluded from Auditable; it is never a retroactive block. Approval
 * already blocked every KNOWN baseline-ordering violation at approval time (see
 * services/proofService.ts) — this only catches facts that became known LATER, e.g. an
 * Intervene event recorded for the case after the proof was already approved.
 */
async function derivedTrustGaps(p: Proof): Promise<string[]> {
  const gaps: string[] = [];
  const evidence = await getEvidenceForCase(p.recoveryCaseId);
  const referenced = evidence.filter((item) => p.evidenceRefs.includes(item.evidenceId));
  const outcomes = referenced.filter((item) => item.evidenceRole === "outcome");
  if (referenced.length !== p.evidenceRefs.length || outcomes.length === 0
    || outcomes.some((item) => !item.sourceVerification || item.beneficiaryControl || item.trustClassification !== "independent")) {
    gaps.push("sourceAuthenticityUnverified");
  }
  const snapshot = await getBaselineSnapshot(p.baselineId);
  if (!snapshot) {
    // Baselines are immutable/append-only and required at approval time — unreachable in
    // practice, but an honest gap rather than a silent assumption if it ever were missing.
    gaps.push("baselineNotLocked");
    return gaps;
  }
  const intervention = await firstInterveneEvent(p.recoveryCaseId);
  if (!intervention) {
    // Unknown ≠ positive evidence: no Intervene event recorded is a gap, not a violation.
    gaps.push("interventionUnverified");
  } else if (snapshot.lockedAt > intervention.at.toISOString()) {
    gaps.push("baselineOrderingViolation");
  }
  return gaps;
}

/** All provenance gaps — static field-completeness plus re-derived trust gaps. */
export async function allProvenanceGaps(p: Proof): Promise<string[]> {
  return [...provenanceGaps(p), ...(await derivedTrustGaps(p))];
}

/** Internal helper: has governance excluded this case from the auditable ledger? */
async function caseIsExcluded(recoveryCaseId: string): Promise<boolean> {
  const n = await prisma.authorityEvent.count({ where: { recoveryCaseId, action: "Exclude" } });
  return n > 0;
}

export interface ProofReconstruction {
  proofId: string;
  recoveryCaseId: string;
  chainId: string;
  proofVersion: number;
  status: string;
  frozenProvenance: Record<string, unknown>;
  amounts: { collectedMinor: number; baselineMinor: number; storedRevenueReturnedMinor: number };
  reconstructedRevenueReturnedMinor: number;
  reconstructionMatches: boolean;
  provenanceGaps: string[];
  excluded: boolean;
  auditable: boolean;
}

async function reconstruct(p: Proof, excluded: boolean): Promise<ProofReconstruction> {
  const reconstructed = clampNonNegative(subMoney(p.collectedAmount, p.baselineAmount));
  const gaps = await allProvenanceGaps(p);
  return {
    proofId: p.proofId,
    recoveryCaseId: p.recoveryCaseId,
    chainId: p.chainId,
    proofVersion: p.proofVersion,
    status: p.status,
    frozenProvenance: {
      policyVersion: p.policyVersion,
      confidenceMethodologyVersion: p.confidenceMethodologyVersion,
      proofThresholdUsed: p.proofThresholdUsed,
      confidenceUsed: p.confidenceUsed,
      baselineId: p.baselineId,
      baselineMethodId: p.baselineMethodId,
      baselineVersion: p.baselineVersion,
      baselineLockPolicy: p.baselineLockPolicy,
      evidenceRefs: p.evidenceRefs,
      approvedBy: p.approvedBy,
      approvedAt: p.approvedAt,
    },
    amounts: {
      collectedMinor: p.collectedAmount.minor,
      baselineMinor: p.baselineAmount.minor,
      storedRevenueReturnedMinor: p.revenueReturned.minor,
    },
    reconstructedRevenueReturnedMinor: reconstructed.minor,
    reconstructionMatches: reconstructed.minor === p.revenueReturned.minor,
    provenanceGaps: gaps,
    excluded,
    // auditable only if the kernel says so AND provenance is complete AND not excluded.
    auditable: proofIsAuditable(p) && gaps.length === 0 && !excluded,
  };
}

/** Reconstruct a single proof from its frozen provenance. */
export async function reconstructProof(actor: ActorContext, proofId: string): Promise<ProofReconstruction> {
  requireCan(actor, "AuditRead");
  const proof = await getProofById(proofId);
  if (!proof) throw new NotFoundError(`proof ${proofId} not found`);
  return reconstruct(proof, await caseIsExcluded(proof.recoveryCaseId));
}

export interface CaseAuditTrail {
  recoveryCaseId: string;
  excluded: boolean;
  authorityTrail: AuthorityRecord[];
  proofs: ProofReconstruction[];
}

/** The full authority history + proof chain for a case. */
export async function caseAuditTrail(actor: ActorContext, recoveryCaseId: string): Promise<CaseAuditTrail> {
  requireCan(actor, "AuditRead");
  const excluded = await caseIsExcluded(recoveryCaseId);
  const proofs = await getCaseProofs(recoveryCaseId);
  return {
    recoveryCaseId,
    excluded,
    authorityTrail: await authorityFor(recoveryCaseId),
    proofs: await Promise.all(proofs.map((p) => reconstruct(p, excluded))),
  };
}

/** Why a monetary field is `null`. NAMED, never collapsed into a zero. */
export type CfoMonetaryUnavailableReason =
  /** No effective recovery proof exists for this case — there was no population to sum. */
  | "no_effective_recovery_proof"
  /** No proof of any kind exists under this id, and no governed root does either. */
  | "no_governed_root_and_no_proof";

export interface CfoAuditExport {
  recoveryCaseId: string;
  generatedAt: string;
  excluded: boolean;
  currency: string | null;
  // Two SEPARATE ledgers — forecast never appears here.
  /**
   * `null` MEANS NOT COMPUTED, and the reason is stated beside it. It used to be `0` for a case with no
   * proof AND for a case id that never existed, which made three different situations — no proof, all
   * proofs reversed, never opened — read identically on the most consequential financial read here.
   *
   * A renderer must NEVER coalesce this to `0`: `?? 0` would reinstate the defect at the last moment.
   */
  provenRevenueReturnedMinor: number | null;
  /**
   * `null` only where there was NO EFFECTIVE PROOF AT ALL to sum.
   *
   * WHERE PROOFS EXIST AND NONE IS AUDITABLE THIS STAYS `0`, because that zero is a FINDING: an
   * exclusion or a provenance gap removes an amount from the CFO-grade ledger while the proven history
   * is preserved, and `trustGate`/`auditService` already assert exactly that pair. Nullifying it would
   * have destroyed a governed meaning in order to fix a different one.
   */
  auditableRevenueMinor: number | null;
  /** `null` exactly when both figures are numbers. */
  monetaryUnavailableReason: CfoMonetaryUnavailableReason | null;
  /**
   * Whether a governed root exists under this id. Reported, NOT enforced: this route is deliberately
   * root-tolerant because `EventDetail` calls it with seed event ids through `loadCaseTrust`'s
   * `Promise.all`, so failing closed here would break that screen for every seed event. The flag is
   * what lets a reader tell "never opened" from "opened and unproven" without the route refusing.
   */
  governedRootExists: boolean;
  authorityTrail: AuthorityRecord[];
  chain: ProofReconstruction[];
}

/**
 * A skeptical-CFO audit representation built ONLY from persisted data. Shows proven vs
 * auditable as separate ledgers (no forecast); a governance exclusion or incomplete
 * provenance removes an amount from the auditable ledger without erasing history.
 */
export async function cfoAuditExport(actor: ActorContext, recoveryCaseId: string): Promise<CfoAuditExport> {
  requireCan(actor, "AuditRead");
  const proofs = await getCaseProofs(recoveryCaseId);
  const excluded = await caseIsExcluded(recoveryCaseId);
  const effective = effectiveProofs(proofs);
  const currency = effective[0]?.currency ?? proofs[0]?.currency ?? null;

  // THE ACCUMULATORS START AT null, NOT AT ZERO, and that single change is the fix. Starting at zero
  // meant "nothing to sum" and "summed to nothing" produced the same figure, and the second is a
  // finding while the first is an absence. The same correction `ledgerTotals` needed.
  let proven: Money | null = null;
  let auditable: Money | null = null;
  // Counted so the auditable branch can tell "no proofs at all" from "proofs, none auditable". The
  // second must stay 0 — see the field's own comment and trustGate's assertion.
  let effectiveInCurrency = 0;
  for (const p of effective) {
    if (p.currency !== (currency ?? p.currency)) continue;
    effectiveInCurrency += 1;
    if (isEffectiveRecovery(p)) {
      proven = proven === null ? p.revenueReturned : addMoney(proven, p.revenueReturned);
    }
    if (proofIsAuditable(p) && !excluded && (await allProvenanceGaps(p)).length === 0) {
      auditable = auditable === null ? p.revenueReturned : addMoney(auditable, p.revenueReturned);
    }
  }
  // PROOFS EXISTED AND NONE WAS AUDITABLE ⇒ 0, a finding over a real population. UNCHANGED behaviour.
  const auditableMinor =
    auditable !== null ? auditable.minor : effectiveInCurrency > 0 && currency !== null ? 0 : null;

  const governedRootExists =
    (await prisma.recoveryCaseRecord.count({ where: { recoveryCaseId } })) > 0;
  const reason: CfoMonetaryUnavailableReason | null =
    proven !== null && auditableMinor !== null
      ? null
      : proofs.length === 0 && !governedRootExists
        ? "no_governed_root_and_no_proof"
        : "no_effective_recovery_proof";

  return {
    recoveryCaseId,
    generatedAt: new Date().toISOString(),
    excluded,
    currency,
    provenRevenueReturnedMinor: proven === null ? null : proven.minor,
    auditableRevenueMinor: auditableMinor,
    monetaryUnavailableReason: reason,
    governedRootExists,
    authorityTrail: await authorityFor(recoveryCaseId),
    chain: await Promise.all(proofs.map((p) => reconstruct(p, excluded))),
  };
}

/**
 * EP-9 · The full, immutable baseline history for a case (governed read — same AuditRead gate
 * as every other provenance surface). Returns every snapshot ever established, in order,
 * including superseded ones — the frontend must never be given only "the latest."
 */
export async function listCaseBaselines(actor: ActorContext, recoveryCaseId: string): Promise<BaselineSnapshot[]> {
  requireCan(actor, "AuditRead");
  return getBaselinesForCase(recoveryCaseId);
}

/** EP-9 · Every evidence record ingested for a case (governed read, same AuditRead gate). The
 * classification fields (`evidenceRole`, `trustClassification`) are returned exactly as
 * derived at ingestion — this function does not and cannot recompute or alter them. */
export async function listCaseEvidence(actor: ActorContext, recoveryCaseId: string): Promise<IngestedEvidence[]> {
  requireCan(actor, "AuditRead");
  return getEvidenceForCase(recoveryCaseId);
}
