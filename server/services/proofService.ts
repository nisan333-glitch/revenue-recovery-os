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
import { getEvidenceByIds, getEvidenceForCase, ingestEvidence, type IngestedEvidence } from "../persistence/evidenceStore";
import { money } from "../../src/domain/money";
import { ENFORCED_REASON_SCOPE, reasonScopeViolation } from "../../src/domain/reasons";
import { prisma } from "../db";
import { caseProvenEligibility } from "./caseProvenGate";
import { financialOutcomeSufficiency } from "../../src/domain/outcomeEvidence";
import { executedCorrection } from "../../src/domain/executedCorrection";
import { correctionMapping, mappingBlocksApproval } from "../../src/domain/correctionMapping";
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
import { assertCaseNotHalted, withCaseHalt, withGovernedCaseMutation } from "./caseGuard";
import { SourceVerifier, type SourceAttestation } from "./sourceVerification";

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
  sourceAttestation?: SourceAttestation;
  evidenceId: string;
  sourceSystem: string;
  sourceRecordId: string;
  evidenceType: string;
  observedAt: string;
  amountMinor?: number;
  currency?: string;
  note?: string;
}

/**
 * Record a case's author/owner (the beneficiary). Requires the Author permission.
 *
 * EP-11 · Gate order is deliberate and is the same in every governed mutation below:
 * least privilege (`requireCan`) → separation of duties → the halt gate. Role denial must
 * still answer 403 even on a halted case — a Steward attempting to approve is refused because
 * they may never count, not because the case happens to be halted.
 */
export async function authorCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Author");
  await enforceSeparation(recoveryCaseId, actor, "Author");
  await withGovernedCaseMutation(recoveryCaseId, "Author", (tx) =>
    recordAuthority(recoveryCaseId, actor, "Author", AUTHORITY_POLICY_VERSION, tx),
  );
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
  return withGovernedCaseMutation(recoveryCaseId, "EstablishBaseline", (tx) =>
    establishAndLockBaseline(
      {
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
      },
      tx,
    ),
  );
}

/**
 * EP-8.1 · Record the governed Fix/intervention timing event. This is the ONLY source the
 * baseline-ordering trust gate (below) and the audit-time gap check ever read for "when was
 * the fix taken" — never a client-supplied timestamp on the approval request.
 */
export async function recordIntervention(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Intervene");
  await withGovernedCaseMutation(recoveryCaseId, "Intervene", (tx) =>
    recordAuthority(recoveryCaseId, actor, "Intervene", AUTHORITY_POLICY_VERSION, tx),
  );
}

/**
 * EP-8.1 · Pre-proof evidence ingestion. `evidenceRole`/`trustClassification` are DERIVED here
 * (see persistence/evidenceStore.ts) — the caller supplies only raw, falsifiable facts.
 */
export async function ingestCaseEvidence(
  actor: ActorContext,
  recoveryCaseId: string,
  req: IngestEvidenceRequest,
  sourceVerifier: SourceVerifier = new SourceVerifier([]),
): Promise<IngestedEvidence> {
  requireCan(actor, "IngestEvidence");
  const sourceVerification = sourceVerifier.verify(recoveryCaseId, req, req.sourceAttestation);
  return withGovernedCaseMutation(recoveryCaseId, "IngestEvidence", (tx) =>
    ingestEvidence(
      {
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
        sourceVerification,
      },
      tx,
    ),
  );
}

/** Approve a governed proof. Authorization + separation + trust gates run before the kernel. */
export async function approve(actor: ActorContext, req: ApproveProofRequest): Promise<Proof> {
  requireCan(actor, "Approve");

  // EP-11 · Halted cases are refused before the (expensive) trust-gate chain runs. This is the
  // fast path only — the binding check runs inside the write transaction at the end.
  await assertCaseNotHalted(req.recoveryCaseId, "Approve");

  // C2 · fail closed: an unowned case (no Author event ever recorded) can never be approved.
  // `ownerId === null` must never be silently treated as "no separation conflict."
  const history = await authorityFor(req.recoveryCaseId);
  if (!history.some((h) => h.action === "Author")) {
    throw new ForbiddenError(
      "no authoritative case author/owner exists yet — an unowned case cannot be approved",
    );
  }

  await enforceSeparation(req.recoveryCaseId, actor, "Approve", req.collectedMinor);

  // Reason scope · a proof is immutable, so a reason that names a mechanism the case never had cannot be
  // corrected afterwards. Only reasons in ENFORCED_REASON_SCOPE are checked (today: BillingCorrection); the
  // case's recovery type is read from its governed root, never from the request, and a case with no root
  // has no recorded type, which fails closed for an enforced reason. Other reasons skip the lookup entirely.
  if (Object.prototype.hasOwnProperty.call(ENFORCED_REASON_SCOPE, req.recoveryReason)) {
    const root = await prisma.recoveryCaseRecord.findUnique({
      where: { recoveryCaseId: req.recoveryCaseId },
      select: { recoveryType: true },
    });
    const violation = reasonScopeViolation(req.recoveryReason, root?.recoveryType ?? null);
    if (violation !== null) throw new ForbiddenError(violation);
  }

  // OBLIGATION-IDENTITY ELIGIBILITY · the approved mandatory rule:
  //
  //   > PROVEN must never be assigned at account level when the identity of the specific underlying
  //   > obligation has not been established with sufficient evidence.
  //
  // Placed HERE, before the duplicate-chain check and before any write, because an ineligible claim must
  // be refused rather than merely left uncounted — a case that reached the write transaction and was
  // rolled back would still have consumed the one chain root its claim is allowed.
  //
  // EVERY INPUT IS READ FROM THE RECORD. `caseProvenEligibility` takes the case id and nothing else: the
  // coverage comes from the candidate signal the detector wrote, the absorption from the append-only
  // event log. The request cannot assert either, so a beneficiary cannot widen their own eligibility.
  //
  // THE REFUSAL NAMES ITS CODE, because "ambiguous cases must remain unproven with an explicit reason"
  // is half the rule, and a generic 403 would satisfy the gate while failing the requirement.
  const eligibility = await caseProvenEligibility(req.recoveryCaseId);
  if (!eligibility.eligible) {
    throw new ForbiddenError(
      `PROVEN is not available for this case — ${eligibility.code}: ${eligibility.reason}`,
    );
  }

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

  // G2 · VERIFIED FINANCIAL OUTCOME EVIDENCE, AT EVERY TIER.
  //
  //   > Every PROVEN revenue outcome requires sufficient verified financial outcome evidence, REGARDLESS
  //   > of confidence tier. `confidenceUsed` may influence the Auditable classification only.
  //
  // These six checks used to run only inside `if (req.confidenceUsed >= CURRENT_POLICY.proofThreshold)`,
  // and `confidenceUsed` is a field on THIS REQUEST — so the submitter chose which evidence bar applied
  // to their own claim. Measured on the real governed path before it was changed: the same
  // supporting-role evidence carrying no amount was refused 403 at confidence 80 and accepted 201 at 79,
  // minting Revenue Returned either way. A number that selects its own evidence bar is the
  // beneficiary-determines-the-number shape, and rule 10 is "claimed revenue is not proven revenue".
  //
  // CONFIDENCE KEEPS ITS ONE LEGITIMATE JOB. `isAuditable` reads `confidence >= PROOF_THRESHOLD`, so the
  // Auditable subset of Revenue Returned is still decided by confidence. What confidence no longer
  // decides is whether the money had to be evidenced at all.
  //
  // THE DECISION IS PURE AND LIVES ELSEWHERE (`src/domain/outcomeEvidence.ts`), so a refusal cannot be
  // invented here where no unit test would look for it — the same split `caseProvenGate` uses.
  const evidenceForGate: Evidence[] = evidenceRecords.map((e) => ({
    evidenceId: e.evidenceId,
    evidenceType: e.evidenceType,
    sourceSystem: e.sourceSystem,
    sourceRecordId: e.sourceRecordId,
    observedAt: e.observedAt,
    ingestedAt: e.ingestedAt,
    trustClassification: e.sourceVerification ? e.trustClassification : "beneficiary_controlled",
    suppliedBy: e.ingestedBy,
    beneficiaryControl: !e.sourceVerification || e.beneficiaryControl,
  }));
  const sufficiency = financialOutcomeSufficiency({
    claimedCollectedMinor: req.collectedMinor,
    currency: req.currency,
    anyIndependent: hasIndependentEvidence(evidenceForGate),
    outcomeItems: outcomeItems.map((e) => ({
      evidenceId: e.evidenceId,
      amountMinor: e.amountMinor,
      currency: e.currency,
      // A source attestation the SERVER recorded, never the caller's opinion of its own evidence.
      sourceVerified: !!e.sourceVerification,
      beneficiaryControl: !e.sourceVerification || e.beneficiaryControl,
      trustClassification: e.sourceVerification ? e.trustClassification : "beneficiary_controlled",
    })),
  });
  if (!sufficiency.sufficient) {
    // THE REFUSAL NAMES ITS CODE, so a caller can tell "you cited nothing independent" from "your
    // outcome records total less than you claimed" — a generic 403 satisfies a gate and fails a reader.
    throw new ForbiddenError(
      `PROVEN requires verified financial outcome evidence — ${sufficiency.code}: ${sufficiency.reason}`,
    );
  }

  // G1 · A VERIFIED EXECUTED CORRECTION, AUDITABLY RELATED TO THE MONEY.
  //
  //   > PROVEN must require a verified executed-correction record, verified financial collection
  //   > evidence, and an auditable relationship between the correction and the financial outcome.
  //
  // Before this, a case reached PROVEN with no `Intervene` event ever recorded: the intervention was read
  // only for the baseline-lock ordering, and that check passes on absence. `BillingCorrection` is a
  // recovery REASON — it establishes that the claim is about a correction, never that one happened.
  //
  // THE CORRECTION IS READ FROM THE CASE, NOT CITED BY THE REQUEST. A caller who could choose which
  // correction substantiates their claim would be choosing their own evidence; and the whole case's
  // evidence is already case-scoped by `getEvidenceForCase`, so there is no field to assert here at all.
  //
  // RELATIONSHIP, AND ITS LIMIT. Leg A has already refused unless this case's identity covers exactly one
  // reconciliation unit, so correction and collection concern the same obligation; the correction must
  // additionally PRECEDE the collection by the server's own clock. That is necessary evidence of the
  // relationship and never proof of causation — `causationEstablished` is the literal `false`.
  const caseEvidence = await getEvidenceForCase(req.recoveryCaseId);
  const correction = executedCorrection({
    earliestOutcomeIngestedAt: outcomeObservedAt,
    corrections: caseEvidence
      .filter((e) => e.evidenceRole === "correction")
      .map((e) => ({
        evidenceId: e.evidenceId,
        sourceSystem: e.sourceSystem,
        sourceRecordId: e.sourceRecordId,
        ingestedAt: e.ingestedAt,
        sourceVerified: !!e.sourceVerification,
        beneficiaryControl: !e.sourceVerification || e.beneficiaryControl,
        trustClassification: e.sourceVerification ? e.trustClassification : "beneficiary_controlled",
      })),
  });
  if (!correction.established) {
    throw new ForbiddenError(
      `PROVEN requires a verified executed correction — ${correction.code}: ${correction.reason}`,
    );
  }

  // THE CORRECTION MUST EVIDENCE THE MECHANISM THE REASON NAMES.
  //
  // G1 above establishes that A correction happened. It does not establish that the correction has
  // anything to do with the recovery being claimed: the only declared correction types are the billing
  // system's statements about billing, so without this check a `UsageActivation` recovery could be
  // evidenced by a corrective invoice — an activation was missed, nothing was mis-billed, and a billing
  // artefact stood in as proof that the activation happened. A proof is immutable, so that disagreement
  // could never be corrected afterwards.
  //
  // THE TYPE COMES FROM THE RECORD, NOT THE REQUEST. `executedCorrection` chose the earliest qualifying
  // correction; its `evidenceType` was derived server-side at ingestion from (sourceSystem, evidenceType)
  // and signed by the source. The request supplies the REASON — it has to, that is the claim — and can
  // supply nothing that changes which channel applies to it.
  const chosenCorrection = caseEvidence.find((e) => e.evidenceId === correction.correctionEvidenceId);
  //
  // WHICH REFUSALS BLOCK is declared in `BLOCKING_MAPPING_CODES`, not decided here. ALL THREE BLOCK as
  // of the owner's D3 decision (2026-11-10), so a mapping verdict that is not `ok` cannot mint Revenue
  // Returned by any route.
  //
  // THIS COMMENT SAID THE OPPOSITE UNTIL 2026-11-10, and the correction is recorded rather than quietly
  // applied. It read that `CORRECTION_CHANNEL_NOT_DECLARED` — seven of eight reasons having no channel
  // at all — "is reported rather than enforced, because enforcing it would take that decision by
  // implementation". That was true when written and became false the moment the owner took the
  // decision and the code added it to the blocking set. A comment describing the opposite of the gate
  // beside it is worse than no comment: a reader reasoning about what this route permits would have
  // concluded, from the authoritative-looking prose, that an unattestable mechanism still reaches
  // PROVEN here. Measured at the time: enforcing it gave 41 failed / 905 passed against 946 passed,
  // and 905 + 41 = 946, so nothing else moved. See `docs/CORRECTION_TYPE_MAPPING_V1.md` §6.
  //
  // The same gate now also runs in `src/domain/approval.ts`, from these same two functions, so the
  // governed route and the pure approval path cannot answer one claim differently.
  const mapping = correctionMapping(req.recoveryReason, chosenCorrection?.evidenceType ?? null);
  if (mappingBlocksApproval(mapping)) {
    throw new ForbiddenError(
      `PROVEN requires a correction that evidences the reason claimed — ${!mapping.ok ? mapping.code : ""}: `
        + `${!mapping.ok ? mapping.detail : ""}`,
    );
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
  // EP-11 · halt re-check + proof row + authority record are written atomically in ONE
  // transaction, under the per-case lock. A Halt committed before this point rejects the
  // approval and leaves NO row behind; a Halt arriving after it commits does not reach back
  // into an approved proof (immutability).
  return withGovernedCaseMutation(req.recoveryCaseId, "Approve", (tx) =>
    approveProof(
      input,
      {
        recoveryCaseId: req.recoveryCaseId,
        actorId: actor.actorId,
        role: actor.role,
        action: "Approve",
        policyVersion: AUTHORITY_POLICY_VERSION,
      },
      tx,
    ),
  );
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
  // EP-11 · a revision is a governed mutation of the case's counted history — a halted case
  // accepts none. Fast path here; binding re-check inside the transaction below.
  await assertCaseNotHalted(existing.recoveryCaseId, "Revise");
  await enforceSeparation(existing.recoveryCaseId, actor, "Approve", existing.collectedAmount.minor);
  const currency = req.currency ?? existing.currency;
  return withGovernedCaseMutation(existing.recoveryCaseId, "Revise", (tx) =>
    reviseExistingProof(
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
      tx,
    ),
  );
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

/**
 * Governance flag — Steward may flag/halt a case; it can never count.
 *
 * EP-11 · Deliberately NOT halt-gated. Flag/Halt/Exclude and the Verify stamp are oversight
 * actions that never create or change a counted number; blocking them on a halted case would
 * strand it — a Steward could halt a case and then be unable to exclude or annotate it.
 */
export async function flagCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Flag");
  await recordAuthority(recoveryCaseId, actor, "Flag", AUTHORITY_POLICY_VERSION);
}

/**
 * Governance halt — Steward may halt a case; it can never count.
 *
 * EP-11 · Recorded under the SAME per-case advisory lock every governed mutation takes, so
 * Halt-vs-mutation is serialized rather than racing: see services/caseGuard.ts. Re-halting an
 * already-halted case is intentionally allowed (idempotent) — the ledger is append-only, and a
 * second Steward's halt is itself an audit fact worth recording.
 */
export async function haltCase(actor: ActorContext, recoveryCaseId: string): Promise<void> {
  requireCan(actor, "Halt");
  await withCaseHalt(recoveryCaseId, (tx) =>
    recordAuthority(recoveryCaseId, actor, "Halt", AUTHORITY_POLICY_VERSION, tx),
  );
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
