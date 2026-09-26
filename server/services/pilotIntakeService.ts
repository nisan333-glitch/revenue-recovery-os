// EP-13 · Customer Pilot Intake — the authoritative server side of the data contract.
//
// WHY THIS EXISTS. Until now the intake ran entirely in the browser ("your file is read locally and
// never uploaded"). That is fine for a private assessment, but it means the rules a pilot depends on
// were enforced only where the customer could change them. Client validation cannot be authoritative
// for tenancy, limits, or duplicate detection: a client controls its own code.
//
// So the split is explicit, and the naming reflects it: the browser may run the SAME contract
// validator as PREFLIGHT ASSISTANCE, to give instant feedback before a large upload. This module is
// what decides. If the two ever disagree, this one is right.
//
// WHAT IT DOES NOT DO. It creates no RecoveryEvent, no Case, no Proof and no revenue claim. It does
// not touch Case Halt, the authority ledger, the baseline, evidence or the proof chain. A validated
// dataset is input to an observed assessment, and it reaches the governed world only by a human
// walking it through the existing Case → Evidence → Approval path.
import {
  validatePilotDataset,
  type ContractValidationReport,
  type DatasetSubmission,
} from "../../src/contract/validateDataset";
import {
  PILOT_DATA_CONTRACT_VERSION,
  type DatasetProvenance,
} from "../../src/contract/pilotDataContract";
import { IDENTITY_CODES } from "../../src/contract/rejectionCodes";
import { evaluateAdmission, type AdmissionDecision } from "../../src/contract/admissionGate";
import { POLICY_CODES } from "../../src/contract/admissionCodes";
import { makeAdmissionPolicy, type PilotAdmissionPolicy } from "../../src/contract/pilotAdmissionPolicy";
import { findAdmissionPolicy, registerAdmissionPolicy } from "../persistence/pilotAdmissionPolicyStore";
import { hashAdmissionPolicy } from "../../src/contract/policyHash";
import { deriveAdmissionDecisionId } from "../../src/contract/assessmentExecution";
import {
  canTransition,
  mayEvaluate,
  whyCannotEvaluate,
  type PolicyState,
  type PolicyTransition,
} from "../../src/contract/policyLifecycle";
import {
  appendPolicyEvent,
  policyGovernanceState,
  recordDatasetSighting,
} from "../persistence/pilotPolicyGovernanceStore";
import { makePolicy } from "../../src/assessment/policy";
import type { DateLocale } from "../../src/assessment/dateNormalize";
import type { AmountFormat } from "../../src/assessment/amountNormalize";
import { Prisma } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { findSubmission, recordSubmission } from "../persistence/pilotDatasetStore";

export interface PilotDatasetRequest {
  /**
   * The tenant boundary this upload is FOR. This is an authorization REQUEST, never an assertion:
   * `requireBoundaryAccess` refuses it unless the authenticated context already grants it, so a
   * client can only name a boundary it provably owns. Nothing in the CSV can influence tenancy —
   * the contract declares no tenant field, so a `tenant_id` column is rejected as undeclared.
   */
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly declaredVersion: string;
  readonly csvText: string;
  readonly policy: {
    readonly stallThresholdDays: number;
    readonly asOf: string;
    readonly currency: string;
  };
  readonly provenance: DatasetProvenance;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * Which versioned admission policy to judge fitness against. Omitting it does NOT mean "skip the
   * check" — it means NOT_ASSESSABLE (NH-AG-1001). There is no configuration in which a dataset is
   * admitted without an explicit bar.
   */
  readonly admissionPolicyId?: string;
  readonly admissionPolicyVersion?: string;
}

/**
 * What the UI receives. Deliberately NOT the full internal report: `acceptedCycles` carries raw
 * customer identifiers and Money objects and has no business crossing the wire — the browser
 * already holds the file it uploaded, and the server's job here is the verdict, not the data.
 */
export interface PilotIntakeResponse {
  readonly contractRef: string;
  readonly contractVersion: string;
  readonly declaredVersion: string;
  readonly boundaryId: string;
  readonly datasetId: string;
  readonly accepted: boolean;
  /** The flag the UI must gate progression on. `accepted` alone is never sufficient. */
  readonly usableForAssessment: boolean;
  readonly counts: ContractValidationReport["counts"];
  readonly datasetFindings: ContractValidationReport["datasetFindings"];
  readonly rowFindings: ContractValidationReport["rowFindings"];
  readonly datasetFingerprint: string;
  readonly idempotencyKey: string;
  readonly columnMapping: ContractValidationReport["columnMapping"];
  readonly mappingId: string;
  readonly claimBoundary: ContractValidationReport["claimBoundary"];
  /** Server-recorded submission time when the dataset was accepted and recorded; else null. */
  readonly recordedAt: string | null;
  /** EP-15 · lifecycle state of the policy consulted, or null when none was named/found. */
  readonly admissionPolicyState: PolicyState | null;
  /** EP-15 · deterministic hash of the bar this decision was judged under. */
  readonly admissionPolicyHash: string | null;
  /** EP-15 · set when governance refused to let the named policy judge this dataset. */
  readonly admissionGovernanceRefusal: string | null;
  /**
   * EP-14 · Pilot fitness — a THIRD verdict, additive and independent. `accepted` and
   * `usableForAssessment` keep their existing meanings exactly; this one answers whether the
   * dataset satisfies an explicit, versioned pilot policy.
   */
  readonly admission: AdmissionDecision;
}

/** The contract version this build serves. Advertised so a client can pin and compare. */
export const SERVED_CONTRACT_VERSION = PILOT_DATA_CONTRACT_VERSION;

function toResponse(
  report: ContractValidationReport,
  recordedAt: string | null,
  admission: AdmissionDecision,
  governance: {
    readonly state: PolicyState | null;
    readonly hash: string | null;
    readonly refusal: string | null;
  } = { state: null, hash: null, refusal: null },
): PilotIntakeResponse {
  return Object.freeze({
    contractRef: report.contractRef,
    contractVersion: report.contractVersion,
    declaredVersion: report.declaredVersion,
    boundaryId: report.boundaryId,
    datasetId: report.datasetId,
    accepted: report.accepted,
    usableForAssessment: report.usableForAssessment,
    counts: report.counts,
    datasetFindings: report.datasetFindings,
    rowFindings: report.rowFindings,
    datasetFingerprint: report.datasetFingerprint,
    idempotencyKey: report.idempotencyKey,
    columnMapping: report.columnMapping,
    mappingId: report.mappingId,
    claimBoundary: report.claimBoundary,
    recordedAt,
    admissionPolicyState: governance.state,
    admissionPolicyHash: governance.hash,
    admissionGovernanceRefusal: governance.refusal,
    admission,
  });
}

/** Distinct codes only — never a finding's `detail`, which can echo a customer value. */
function distinctCodes(report: ContractValidationReport): string[] {
  const codes = new Set<string>();
  for (const f of report.datasetFindings) codes.add(f.code);
  for (const f of report.rowFindings) codes.add(f.code);
  return [...codes].sort();
}

/**
 * Validate and (only if usable) record one customer pilot dataset.
 *
 * Order is the security design:
 *   1. least privilege — may this role submit at all;
 *   2. tenant authorization — is this actor entitled to THIS boundary;
 *   3. contract validation — limits, structure, PII, rows (the contract's rules, not a copy);
 *   4. duplicate detection — scoped to the authorized boundary;
 *   5. persistence — ONLY when the dataset is usable, and only counts and codes.
 *
 * Nothing is written before step 3 passes, so an invalid dataset and a rejected row never reach the
 * database at all.
 */
/**
 * Record a submission, translating the primary key's refusal into the contract's own duplicate code.
 *
 * The sequential repeat and the concurrent loser therefore receive the IDENTICAL classification, from
 * the identical code path — there is no second path that could drift from this one. `submittedAt` is
 * re-read from the winning row so the message carries the same detail either way; if that read comes
 * back empty (the row was removed between the conflict and the read, which the append-only triggers
 * forbid) the code is still returned, without inventing a timestamp.
 */
async function recordDuplicateAware(
  input: Parameters<typeof recordSubmission>[0],
): Promise<Awaited<ReturnType<typeof recordSubmission>>> {
  try {
    return await recordSubmission(input);
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    const prior = await findSubmission(input.idempotencyKey, input.boundaryId);
    const when = prior ? ` on ${prior.submittedAt}` : "";
    throw new ConflictError(
      `${IDENTITY_CODES.DUPLICATE_SUBMISSION.code}: this exact dataset was already submitted for this tenant${when}. ${IDENTITY_CODES.DUPLICATE_SUBMISSION.remediation}`,
    );
  }
}

export async function submitPilotDataset(
  actor: ActorContext,
  request: PilotDatasetRequest,
): Promise<PilotIntakeResponse> {
  requireCan(actor, "SubmitPilotDataset");
  // Authoritative tenancy. Everything downstream uses THIS value — never a body field, never a
  // CSV column, never a value echoed back from the client.
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  // A malformed policy is the caller's error, and its message must not echo customer data.
  let policy;
  try {
    policy = makePolicy({
      stallThresholdDays: request.policy.stallThresholdDays,
      asOf: request.policy.asOf,
      currency: request.policy.currency,
    });
  } catch {
    throw new ForbiddenError("assessment policy is invalid (stall threshold, as-of date or currency)");
  }

  const submission: DatasetSubmission = {
    declaredVersion: request.declaredVersion,
    boundary: { boundaryId, datasetId: request.datasetId },
    // Cross-check against the authorized boundary. They are equal by construction here; the check
    // stays so a future refactor that lets them diverge fails loudly instead of silently.
    ingestionBoundaryId: boundaryId,
    provenance: request.provenance,
    csvText: request.csvText,
    policy,
    adapterOptions: { locale: request.locale, amountFormat: request.amountFormat },
  };

  const report = await validatePilotDataset(submission);

  // EP-14 · Pilot fitness. The policy is loaded BOUNDARY-SCOPED, so a policy id belonging to
  // another tenant reads as absent and yields NOT_ASSESSABLE rather than judging this dataset by
  // someone else's bar. No policy named, or none found: NOT_ASSESSABLE. Never a default.
  //
  // EP-15 · PRE-REGISTRATION. Record that this boundary has seen this dataset BEFORE resolving the
  // policy. The first sighting is what the ordering rule compares against, and recording it first
  // means the act of looking at a dataset is itself on the record.
  const firstSeenAt = await recordDatasetSighting(boundaryId, report.datasetFingerprint);

  let admissionPolicy: PilotAdmissionPolicy | null = null;
  let policyHash: string | null = null;
  let policyState: PolicyState | null = null;
  let governanceRefusal: string | null = null;

  if (request.admissionPolicyId?.trim()) {
    const stored = await findAdmissionPolicy(
      boundaryId,
      request.admissionPolicyId.trim(),
      request.admissionPolicyVersion?.trim() || undefined,
    );
    if (stored) {
      const governance = await policyGovernanceState(boundaryId, stored.policy.policyId, stored.policy.policyVersion);
      policyState = governance.state;
      if (!mayEvaluate(governance.state)) {
        // DRAFT, FROZEN, RETIRED and "no lifecycle at all" all land here. A policy that governance
        // has not put in force does not judge anything, and no state falls through to "allowed".
        governanceRefusal = whyCannotEvaluate(governance.state);
      } else if (governance.activatedAt !== null && governance.activatedAt > firstSeenAt) {
        // THE ANTI-TUNING RULE. The bar must predate the data it judges. Activating a policy after
        // seeing a dataset — then resubmitting — is how a threshold gets fitted to a result that is
        // already known, which would make the whole gate ceremonial.
        governanceRefusal =
          "the policy was activated after this dataset was first submitted; a bar may not be set once the result is known";
      } else {
        admissionPolicy = stored.policy;
        policyHash = stored.policyHash;
      }
    }
  }

  const admission = evaluateAdmission(report, policy, admissionPolicy);

  void POLICY_CODES; // the codes the evaluator emits; referenced so the dependency is explicit

  // Persist ONLY a usable dataset. An invalid dataset, or one whose every row was rejected, leaves
  // no row behind: the uploader gets the findings and the database gets nothing. That also keeps a
  // corrected re-upload a genuinely new submission rather than a "duplicate" of a failure.
  const governance = { state: policyState, hash: policyHash, refusal: governanceRefusal };
  if (!report.usableForAssessment) {
    return toResponse(report, null, admission, governance);
  }

  // EP-16 · The decision's own identifier, derived from the fields being written in this same call.
  // Deriving it (rather than minting a random id) makes it falsifiable: an execution re-derives it
  // from the stored row and refuses if the two disagree, so a record altered after the fact cannot
  // quietly go on authorising runs.
  const admissionDecisionId = await deriveAdmissionDecisionId({
    boundaryId,
    idempotencyKey: report.idempotencyKey,
    datasetFingerprint: report.datasetFingerprint,
    contractVersion: report.contractVersion,
    outcome: admission.outcome,
    admissionPolicyId: admission.policyId,
    admissionPolicyVersion: admission.policyVersion,
    admissionPolicyHash: policyHash,
  });

  // DUPLICATE DETECTION IS THE INSERT ITSELF.
  //
  // This used to be a `findSubmission` check before the write — a check-then-act with no transaction
  // and no lock, so two concurrent identical submissions could both read "no prior" and both attempt
  // the insert. The primary key meant exactly one row survived, so the OUTCOME was never at risk; what
  // the loser got was a bare `P2002` that the error handler mapped to a generic uniqueness conflict
  // instead of the contract's own NH-DC-4003. A client routing on that code saw nothing it could use.
  // Test 5d reproduces it deterministically, by holding a real uncommitted INSERT open as the
  // concurrent winner and waiting for PostgreSQL to report a backend blocked on the lock.
  //
  // WHY NOT A LOCK OR A TRANSACTION. `caseGuard.ts` takes a per-case advisory lock because Halt versus
  // mutation is a genuine write skew across two tables — there is no single row for the two writers to
  // collide on, so the conflict has to be manufactured. Here the primary key IS the invariant: the
  // writers already collide on one row, and the database already serialises them. Adding a lock or a
  // transaction around a check that the insert performs anyway would buy no guarantee and would
  // serialise every submission for the same boundary behind one another.
  //
  // WHY NOT AN UPSERT. `upsert`/`ON CONFLICT DO NOTHING` would swallow the conflict, and a swallowed
  // conflict is exactly what must not happen: the caller has to learn that this dataset was already
  // submitted, and when. So the conflict is caught and CLASSIFIED, never absorbed.
  //
  // Matching on `P2002` alone is precise rather than broad: this call writes to one table, and that
  // table has exactly one uniqueness arbiter — its primary key — which test 5c asserts by exercising
  // it. Any other error, including a P2002 from anywhere else, is re-thrown untouched.
  const recorded = await recordDuplicateAware({
    idempotencyKey: report.idempotencyKey,
    boundaryId,
    datasetId: report.datasetId,
    contractVersion: report.contractVersion,
    datasetFingerprint: report.datasetFingerprint,
    accepted: report.accepted,
    usable: report.usableForAssessment,
    dataRows: report.counts.dataRows,
    acceptedRows: report.counts.acceptedRows,
    rejectedRows: report.counts.rejectedRows,
    warnedRows: report.counts.warnedRows,
    findingCodes: distinctCodes(report),
    // EP-15 · the exact bar this decision was judged under, frozen with the decision. Retiring or
    // superseding the policy later can never reach back and change these.
    admissionOutcome: admission.outcome,
    admissionPolicyId: admission.policyId,
    admissionPolicyVersion: admission.policyVersion,
    admissionPolicyHash: policyHash,
    admissionDecisionId,
    submittedByActorId: actor.actorId,
    submittedByRole: actor.role,
  });

  return toResponse(report, recorded.submittedAt, admission, governance);
}

export interface RegisterAdmissionPolicyRequest {
  readonly boundaryId: string;
  readonly policy: PilotAdmissionPolicy;
  /** Why this bar. Required — a threshold with no stated reasoning cannot be reviewed. */
  readonly rationale: string;
}

/**
 * Register a versioned admission policy for one boundary.
 *
 * Thresholds are the customer's commercial decision, so they must be able to state them — a policy
 * that could only be inserted by hand would push every pilot back to "the system decided". The
 * policy is validated by the domain constructor before it is written, and the (boundary, id,
 * version) primary key makes a published version immutable: a change is a new version.
 */
export async function registerPilotAdmissionPolicy(
  actor: ActorContext,
  request: RegisterAdmissionPolicyRequest,
): Promise<{
  readonly boundaryId: string;
  readonly policyRef: string;
  readonly policyHash: string;
  readonly state: PolicyState;
  readonly registeredAt: string;
}> {
  // EP-15 · Proposing is the CUSTOMER side: they know their data and their commercial reality, and
  // pretending otherwise would move the decision somewhere less informed. What they cannot do is
  // put it in force — that is `ActivatePilotPolicy`, which no customer-side role holds.
  requireCan(actor, "ProposePilotPolicy");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  let policy: PilotAdmissionPolicy;
  try {
    policy = makeAdmissionPolicy(request.policy);
  } catch {
    // The message is deliberately generic; the caller gets the per-field defects from the gate's
    // own codes rather than an exception string that could echo their input.
    throw new ForbiddenError("admission policy is incomplete or out of range — every threshold must be configured explicitly");
  }

  const policyHash = await hashAdmissionPolicy(policy);
  const stored = await registerAdmissionPolicy({
    boundaryId,
    policy,
    policyHash,
    registeredByActorId: actor.actorId,
    registeredByRole: actor.role,
  });
  await appendPolicyEvent({
    boundaryId,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    transition: "PROPOSED",
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: request.rationale,
  });
  return Object.freeze({
    boundaryId: stored.boundaryId,
    policyRef: `${stored.policy.policyId}@${stored.policy.policyVersion}`,
    policyHash: stored.policyHash,
    state: "DRAFT" as PolicyState,
    registeredAt: stored.registeredAt,
  });
}

export interface PolicyTransitionRequest {
  readonly boundaryId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly rationale: string;
}

/**
 * Move a policy through its lifecycle. Governance only.
 *
 * TWO INDEPENDENT SEPARATIONS, both enforced:
 *   1. ROLE — `ActivatePilotPolicy` is held by the steward alone. No customer-side role has it, and
 *      there is no administrator role that bypasses this.
 *   2. IDENTITY — the actor who proposed a policy may not be the one who activates it, even if some
 *      future permission change let one person hold both roles. This mirrors the kernel's own
 *      owner ≠ approver rule; belt and braces, because the cost of being wrong here is that a
 *      beneficiary sets the bar that judges them.
 */
export async function transitionPilotAdmissionPolicy(
  actor: ActorContext,
  transition: PolicyTransition,
  request: PolicyTransitionRequest,
): Promise<{
  readonly boundaryId: string;
  readonly policyRef: string;
  readonly state: PolicyState;
  readonly transition: PolicyTransition;
}> {
  requireCan(actor, transition === "RETIRED" ? "RetirePilotPolicy" : "ActivatePilotPolicy");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  // Boundary-scoped: a policy from another tenant reads as absent, never as theirs to govern.
  const stored = await findAdmissionPolicy(boundaryId, request.policyId, request.policyVersion);
  if (!stored) {
    throw new NotFoundError("no such admission policy version exists for this boundary");
  }

  const governance = await policyGovernanceState(boundaryId, request.policyId, request.policyVersion);
  if (governance.proposedBy !== null && governance.proposedBy === actor.actorId) {
    throw new ForbiddenError(
      "separation of duties: the actor who proposed an admission policy cannot be the one who puts it in force",
    );
  }
  if (!canTransition(governance.state, transition)) {
    throw new ConflictError(
      `admission policy cannot move from ${governance.state ?? "no state"} via ${transition}`,
    );
  }

  await appendPolicyEvent({
    boundaryId,
    policyId: request.policyId,
    policyVersion: request.policyVersion,
    transition,
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: request.rationale,
  });

  const after = await policyGovernanceState(boundaryId, request.policyId, request.policyVersion);
  return Object.freeze({
    boundaryId,
    policyRef: `${request.policyId}@${request.policyVersion}`,
    state: after.state as PolicyState,
    transition,
  });
}

/** Governed read of a policy's full lifecycle — who proposed, who activated, when and why. */
export async function readPilotAdmissionPolicyGovernance(
  actor: ActorContext,
  boundaryId: string,
  policyId: string,
  policyVersion: string,
) {
  requireCan(actor, "AuditRead");
  requireBoundaryAccess(actor, boundaryId);
  const stored = await findAdmissionPolicy(boundaryId.trim(), policyId, policyVersion);
  if (!stored) throw new NotFoundError("no such admission policy version exists for this boundary");
  const governance = await policyGovernanceState(boundaryId.trim(), policyId, policyVersion);
  return Object.freeze({
    boundaryId: stored.boundaryId,
    policyRef: `${policyId}@${policyVersion}`,
    policyHash: stored.policyHash,
    state: governance.state,
    proposedBy: governance.proposedBy,
    proposedAt: governance.proposedAt,
    activatedBy: governance.activatedBy,
    activatedAt: governance.activatedAt,
    events: governance.events,
  });
}
