// EP-3/EP-4/EP-8.1 · Application service — orchestration + authorization between REST routes
// and the persistence adapter. Every counted-number write is delegated to the domain
// kernel; every governed action passes the authority gate (least privilege + separation
// of duties) BEFORE the kernel, enforced here in the service layer (not only the route).
// The approver identity is the authenticated actor — a request body can never set it,
// so the beneficiary cannot authorize a counted number.
//
// EP-8.1 hardening (C1/C2/baseline+evidence trust) — every fact that determines whether an
// amount can become Auditable is now either pinned server-side from CURRENT_POLICY or
// re-derived from PERSISTED, governed records (the locked BaselineSnapshot, the case's
// Intervene ledger entry, ingested EvidenceRecords) — never accepted verbatim from the
// approval request body. Known trust violations BLOCK approval (ConflictError/ForbiddenError);
// unknown facts (e.g. no Intervene ever recorded) do NOT block — they surface as audit-time
// provenance gaps instead (see server/audit/auditService.ts), matching the Foundation's own
// null-tolerant `baselineTemporallyValid` contract.
import {
  approveProof,
  reviseExistingProof,
  getCaseProofs,
  getProofById,
  chainRootExists,
} from "../persistence/proofStore";
import { getBaselineSnapshot, establishAndLockBaseline } from "../persistence/baselineStore";
import { getEvidenceByIds, ingestEvidence, type IngestedEvidence } from "../persistence/evidenceStore";
import { money } from "../../src/domain/money";
import type { Proof, ProofApprovalInput } from "../../src/domain/proof";
import { baselineTemporallyValid, type Baseline } from "../../src/domain/baseline";
import { hasIndependentEvidence, type Evidence } from "../../src/domain/evidence";
import { CURRENT_POLICY } from "../../src/domain/policy";
import { NotFoundError, ConflictError, ForbiddenError } from "../http/errors";
import type { ActorContext } from "../auth/identity";
import {
  requireCan,
  enforceSeparation,
  recordAuthority,
  firstInterveneEvent,
  AUTHORITY_POLICY_VERSION,
} from "../auth/authorityGate";
import { authorityFor } from "../auth/authorityStore";

export interface ApproveProofRequest {
  proofId: string;
  recoveryCaseId: string;
  currency: string;
  collectedMinor: number;
  excludedRecoveryMinor: number;
  exclusionStatement: string;
  recoveryReason: string;
  attribution: string;
  evidenceIds: string[];
  // References a previously established+locked BaselineSnapshot — the baseline AMOUNT, method,
  // and version are read from that snapshot, never from this request.
  baselineId: string;
  confidenceUsed: number;
}

export interface ReviseProofRequest {
  newProofId: string;
  status: "Reversed" | "Superseded" | "Corrected";
  currency?: string;
  collectedMinor?: number;
  attribution?: string;
}

export interface EstablishBaselineRequest {
  baselineId: string;
  calculatedMinor: number;
  currency: string;
  method: string;
  methodVersion: number;
  sourceRefs: string[];
  effectiveAt: string;
  supersedes?: string;
}

export interface IngestEvidenceRequest {
  evidenceId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor?: number;
  currency?: string;
  note?: string;
}

/** Record a case's author/owner (the beneficiary). Requires the Author permission. */
export async function authorCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Author");
  await enforceSeparation(recoveryCaseId, actor, "Author");
  await recordAuthority(recoveryCaseId, actor, "Author", AUTHORITY_POLICY_VERSION);
}

/**
 * EP-8.1 · Establish and lock a baseline snapshot in one governed step. `lockedAt` is always
 * the DB server clock (see baselineStore) — never client-suppliable.
 */
export async function establishBaseline(
  actor: ActorContext,
  recoveryCaseId: string,
  req: EstablishBaselineRequest,
) {
  requireCan(actor, "EstablishBaseline");
  return establishAndLockBaseline({
    baselineId: req.baselineId,
    recoveryCaseId,
    calculatedMinor: req.calculatedMinor,
    currency: req.currency,
    method: req.method,
    methodVersion: req.methodVersion,
    sourceRefs: req.sourceRefs,
    effectiveAt: req.effectiveAt,
    establishedBy: actor.actorId,
    establishedByRole: actor.role,
    supersedes: req.supersedes,
  });
}

/**
 * EP-8.1 · Record the governed Fix/intervention timing event. This is the ONLY source the
 * baseline-ordering trust gate (below) and the audit-time gap check ever read for "when was
 * the fix taken" — never a client-supplied timestamp on the approval request.
 */
export async function recordIntervention(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Intervene");
  await recordAuthority(recoveryCaseId, actor, "Intervene", AUTHORITY_POLICY_VERSION);
}

/**
 * EP-8.1 · Pre-proof evidence ingestion. `evidenceRole`/`trustClassification` are DERIVED here
 * (see persistence/evidenceStore.ts) — the caller supplies only raw, falsifiable facts.
 */
export async function ingestCaseEvidence(
  actor: ActorContext,
  recoveryCaseId: string,
  req: IngestEvidenceRequest,
): Promise<IngestedEvidence> {
  requireCan(actor, "IngestEvidence");
  return ingestEvidence({
    evidenceId: req.evidenceId,
    recoveryCaseId,
    sourceSystem: req.sourceSystem,
    sourceRecordId: req.sourceRecordId,
    evidenceType: req.evidenceType,
    observedAt: req.observedAt,
    amountMinor: req.amountMinor,
    currency: req.currency,
    ingestedBy: actor.actorId,
    ingestedByRole: actor.role,
    note: req.note,
  });
}

/** Approve a governed proof. Authorization + separation + trust gates run before the kernel. */
export async function approve(actor: ActorContext, req: ApproveProofRequest): Promise<Proof> {
  requireCan(actor, "Approve");

  // C2 · fail closed: an unowned case (no Author event ever recorded) can never be approved.
  // `ownerId === null` must never be silently treated as "no separation conflict."
  const history = await authorityFor(req.recoveryCaseId);
  if (!history.some((h) => h.action === "Author")) {
    throw new ForbiddenError(
      "no authoritative case author/owner exists yet — an unowned case cannot be approved",
    );
  }

  await enforceSeparation(req.recoveryCaseId, actor, "Approve", req.collectedMinor);

  // Duplicate-count prevention: one counted proof-chain root per atomic claim (frozen rule).
  if (await chainRootExists(req.recoveryCaseId)) {
    throw new ConflictError("duplicate recovery: a counted proof chain already exists for this claim");
  }

  // Baseline trust: read ONLY from the locked snapshot the case references.
  const snapshot = await getBaselineSnapshot(req.baselineId);
  if (!snapshot || snapshot.recoveryCaseId !== req.recoveryCaseId) {
    throw new NotFoundError(`baseline ${req.baselineId} is not an established, locked snapshot for this case`);
  }
  if (snapshot.currency !== req.currency) {
    throw new ConflictError(`currency mismatch: proof ${req.currency} vs locked baseline ${snapshot.currency}`);
  }

  // Evidence trust: load only case-scoped, previously ingested records — a foreign or unknown
  // id is never silently dropped, it fails the whole request.
  const evidenceRecords = await getEvidenceByIds(req.recoveryCaseId, req.evidenceIds);
  if (evidenceRecords.length !== req.evidenceIds.length) {
    throw new NotFoundError("one or more referenced evidence ids do not exist for this case");
  }

  const intervention = await firstInterveneEvent(req.recoveryCaseId);
  const outcomeItems = evidenceRecords.filter((e) => e.evidenceRole === "outcome");
  // Only the server-stamped ingestion time of OUTCOME-role evidence can positively establish
  // "when the outcome was observed" — a claimed `observedAt` alone can never do this.
  const outcomeObservedAt =
    outcomeItems.length > 0 ? [...outcomeItems.map((e) => e.ingestedAt)].sort()[0]! : null;

  // A Baseline-shaped object for the Foundation's `baselineTemporallyValid`, built ONLY from the
  // locked snapshot's real fields. `baselineTemporallyValid` never reads `applicableLeakType` (or
  // the other fields below it does not use) — the server does not yet persist a leak type per
  // case, so an honest, type-correct, inert placeholder is used rather than an unsafe cast.
  const baselineForGate: Baseline = {
    baselineId: snapshot.baselineId,
    method: snapshot.method,
    methodVersion: snapshot.methodVersion,
    sourceRefs: snapshot.sourceRefs,
    calculatedAmount: money(snapshot.calculatedMinor, snapshot.currency),
    currency: snapshot.currency,
    applicableLeakType: "StalledOnboarding",
    effectiveAt: snapshot.effectiveAt,
    establishedAt: snapshot.lockedAt,
    establishedBy: snapshot.establishedBy,
    lockedAt: snapshot.lockedAt,
    lockReason: "EP-8.1 establish+lock (single insert)",
    supersedes: snapshot.supersedes,
  };

  // Known-fact ordering violations BLOCK approval; unknown facts (null) do not — exactly the
  // Foundation's own contract, re-derived from persisted state rather than the request body.
  const temporal = baselineTemporallyValid(baselineForGate, {
    interventionAt: intervention ? intervention.at.toISOString() : null,
    outcomeObservedAt,
  });
  if (!temporal.ok) {
    throw new ConflictError(`baseline trust violation: ${temporal.reason}`);
  }

  // Auditable-tier claims (confidence clears the server-pinned threshold) additionally require
  // independent, outcome-role evidence sufficient to substantiate the collected amount claimed.
  const auditableTierClaimed = req.confidenceUsed >= CURRENT_POLICY.proofThreshold;
  if (auditableTierClaimed) {
    const evidenceForGate: Evidence[] = evidenceRecords.map((e) => ({
      evidenceId: e.evidenceId,
      evidenceType: e.evidenceType,
      sourceSystem: e.sourceSystem,
      sourceRecordId: e.sourceRecordId,
      observedAt: e.observedAt,
      ingestedAt: e.ingestedAt,
      trustClassification: e.trustClassification,
      suppliedBy: e.ingestedBy,
      beneficiaryControl: e.beneficiaryControl,
    }));
    if (!hasIndependentEvidence(evidenceForGate)) {
      throw new ForbiddenError(
        "auditable claim requires at least one independent evidence reference (operator notes alone are insufficient)",
      );
    }
    if (outcomeItems.length === 0) {
      throw new ForbiddenError("auditable claim requires at least one outcome-role evidence reference");
    }
    if (outcomeItems.some((e) => e.currency !== req.currency)) {
      throw new ForbiddenError("outcome evidence currency does not match the proof currency");
    }
    const outcomeSum = outcomeItems.reduce((sum, e) => sum + (e.amountMinor ?? 0), 0);
    if (outcomeSum < req.collectedMinor) {
      throw new ForbiddenError("outcome evidence amount does not substantiate the collected amount claimed");
    }
  }

  const input: ProofApprovalInput = {
    proofId: req.proofId,
    recoveryCaseId: req.recoveryCaseId,
    approvedAt: new Date().toISOString(), // server-pinned, never client-suppliable
    collectedAmount: money(req.collectedMinor, req.currency),
    baselineAmount: money(snapshot.calculatedMinor, snapshot.currency), // from the locked snapshot only
    excludedRecoveryAmount: money(req.excludedRecoveryMinor, req.currency),
    exclusionStatement: req.exclusionStatement,
    recoveryReason: req.recoveryReason as ProofApprovalInput["recoveryReason"],
    attribution: req.attribution,
    evidenceRefs: req.evidenceIds,
    baselineId: snapshot.baselineId,
    baselineMethodId: snapshot.method,
    baselineVersion: snapshot.methodVersion,
    baselineLockPolicy: CURRENT_POLICY.baselineLockPolicy, // server-pinned
    policyVersion: CURRENT_POLICY.policyVersion, // server-pinned
    confidenceMethodologyVersion: CURRENT_POLICY.confidenceMethodologyVersion, // server-pinned
    proofThresholdUsed: CURRENT_POLICY.proofThreshold, // server-pinned
    confidenceUsed: req.confidenceUsed, // kept, but never alone sufficient — see the gate above
    approvedBy: actor.actorId, // identity from authentication, never from the body
  };
  // proof row + authority record are written atomically in one transaction.
  const proof = await approveProof(input, {
    recoveryCaseId: req.recoveryCaseId,
    actorId: actor.actorId,
    role: actor.role,
    action: "Approve",
    policyVersion: AUTHORITY_POLICY_VERSION,
  });
  return proof;
}

/** Create a linked correction/revision (an approver action; original never overwritten). */
export async function revise(
  actor: ActorContext,
  originalProofId: string,
  req: ReviseProofRequest,
): Promise<Proof> {
  requireCan(actor, "Approve");
  const existing = await getProofById(originalProofId);
  if (!existing) throw new NotFoundError(`proof ${originalProofId} not found`);
  await enforceSeparation(existing.recoveryCaseId, actor, "Approve", existing.collectedAmount.minor);
  const currency = req.currency ?? existing.currency;
  const revised = await reviseExistingProof(
    originalProofId,
    {
      newProofId: req.newProofId,
      status: req.status,
      at: new Date().toISOString(), // server-pinned, never client-suppliable
      approvedBy: actor.actorId,
      attribution: req.attribution,
      collectedAmount: req.collectedMinor !== undefined ? money(req.collectedMinor, currency) : undefined,
    },
    {
      recoveryCaseId: existing.recoveryCaseId,
      actorId: actor.actorId,
      role: actor.role,
      action: "Approve",
      policyVersion: AUTHORITY_POLICY_VERSION,
    },
  );
  return revised;
}

/** Independently verify a proof (a governance stamp — never changes the counted number). */
export async function verifyProof(actor: ActorContext, proofId: string): Promise<Proof> {
  requireCan(actor, "Verify");
  const proof = await getProofById(proofId);
  if (!proof) throw new NotFoundError(`proof ${proofId} not found`);
  await enforceSeparation(proof.recoveryCaseId, actor, "Verify");
  await recordAuthority(proof.recoveryCaseId, actor, "Verify", AUTHORITY_POLICY_VERSION);
  return proof;
}

/** Governance flag — Steward may flag/halt a case; it can never count. */
export async function flagCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Flag");
  await recordAuthority(recoveryCaseId, actor, "Flag", AUTHORITY_POLICY_VERSION);
}

/** Governance halt — Steward may halt a case; it can never count. */
export async function haltCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Halt");
  await recordAuthority(recoveryCaseId, actor, "Halt", AUTHORITY_POLICY_VERSION);
}

/**
 * Governance exclude — Steward may exclude a case from the auditable ledger. This is a
 * governance action that REDUCES/excludes; it never creates, approves, or counts a number.
 */
export async function excludeCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Exclude");
  await recordAuthority(recoveryCaseId, actor, "Exclude", AUTHORITY_POLICY_VERSION);
}

/**
 * EP-8.1 · H2: read one proof with its full frozen provenance. Provenance-bearing reads are
 * governed exactly like the `/audit/*` endpoints — a beneficiary (author/operator) may not
 * read another case's (or their own case's) frozen provenance through this path either.
 */
export async function getProof(actor: ActorContext, proofId: string): Promise<Proof> {
  requireCan(actor, "AuditRead");
  const proof = await getProofById(proofId);
  if (!proof) throw new NotFoundError(`proof ${proofId} not found`);
  return proof;
}

/** EP-8.1 · H2: read the full append-only revision history for a recovery case (governed). */
export async function getCaseChain(actor: ActorContext, caseId: string): Promise<Proof[]> {
  requireCan(actor, "AuditRead");
  return getCaseProofs(caseId);
}
