// EP-26 · The governed lifecycle of analysis terms: who may define what an assessment measures.
//
// Proposing is the CUSTOMER side — they know their commercial calendar, and pretending otherwise would
// move the decision somewhere less informed. Activating is GOVERNANCE. Neither may do the other's half,
// and the separation is enforced on the actor id, not on the role alone: an actor who holds both
// permissions still cannot activate a definition they proposed themselves.
//
// The permissions are the ADMISSION BAR'S — `ProposePilotPolicy` / `ActivatePilotPolicy` /
// `RetirePilotPolicy` — reused rather than duplicated. Both are versioned governance objects decided by
// the same two parties, so a parallel triple would widen the authorization surface without adding a
// guarantee: anyone who may put a fitness bar in force is the same body that may put a cut-off in force.
// What is NOT shared is the storage and the identity space (see the store).
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import {
  analysisTermsHashMatches,
  analysisTermsRef,
  hashAnalysisTerms,
  makeAnalysisTerms,
  type AnalysisTerms,
} from "../../src/contract/analysisTerms";
import {
  canTransition,
  mayEvaluate,
  whyCannotEvaluate,
  type PolicyState,
  type PolicyTransition,
} from "../../src/contract/policyLifecycle";
import {
  analysisTermsGovernanceState,
  findAnalysisTerms,
  listAnalysisTerms,
  appendAnalysisTermsEvent,
  registerAnalysisTerms,
  type StoredAnalysisTerms,
} from "../persistence/pilotAnalysisTermsStore";

export interface ProposeAnalysisTermsRequest {
  /** Authorization REQUEST, never an assertion — `requireBoundaryAccess` decides. */
  readonly boundaryId: string;
  readonly terms: {
    readonly termsId: string;
    readonly termsVersion: string;
    readonly asOf: string;
    readonly stallThresholdDays: number;
  };
  readonly rationale: string;
}

export interface AnalysisTermsTransitionRequest {
  readonly boundaryId: string;
  readonly termsId: string;
  readonly termsVersion: string;
  readonly rationale: string;
}

/**
 * Register a new analysis-terms version as a DRAFT.
 *
 * A draft measures nothing. Until governance activates it, naming it anywhere is refused exactly as
 * naming a non-existent version is — there is no state in which an unapproved definition is used
 * "because it is the only one".
 */
export async function proposeAnalysisTerms(
  actor: ActorContext,
  request: ProposeAnalysisTermsRequest,
): Promise<{
  readonly boundaryId: string;
  readonly termsRef: string;
  readonly termsHash: string;
  readonly state: PolicyState;
  readonly registeredAt: string;
}> {
  requireCan(actor, "ProposePilotPolicy");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  let terms: AnalysisTerms;
  try {
    terms = makeAnalysisTerms(request.terms);
  } catch {
    // Deliberately generic: the message must not echo a submitted value back into a response.
    throw new ForbiddenError(
      "analysis terms are incomplete or out of range — a real cut-off date and a non-negative stall threshold are both required, and neither has a default",
    );
  }

  const termsHash = await hashAnalysisTerms(terms);
  let stored: StoredAnalysisTerms;
  try {
    // ONE TRANSACTION, because a registration with no PROPOSED event is not a proposal — it is a row
    // that occupies its own (boundary, id, version) forever, derives no state, and therefore blocks the
    // legitimate proposal of that version while measuring nothing. Found by test 15: a whitespace-only
    // rationale passed the transport, wrote the definition, and only then failed the log's CHECK.
    stored = await prisma.$transaction(async (tx) => {
      const row = await registerAnalysisTerms(
        {
          boundaryId,
          terms,
          termsHash,
          registeredByActorId: actor.actorId,
          registeredByRole: actor.role,
        },
        tx,
      );
      await appendAnalysisTermsEvent(
        {
          boundaryId,
          termsId: terms.termsId,
          termsVersion: terms.termsVersion,
          transition: "PROPOSED",
          actorId: actor.actorId,
          actorRole: actor.role,
          rationale: request.rationale,
        },
        tx,
      );
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // The primary key is the arbiter, not a pre-check: two concurrent proposals of the same version
      // cannot both win, and the loser is told so rather than silently overwriting a definition.
      throw new ConflictError(
        `analysis terms ${analysisTermsRef(terms)} are already registered for this boundary — a change is a new version, never an edit`,
      );
    }
    // Anything else — a blank rationale reaching the log's CHECK, for instance — is refused with
    // NOTHING written. The generic wording keeps a submitted value out of the response.
    throw new ForbiddenError(
      "the analysis-terms proposal was refused: a definition and a stated reason are both required, and neither was recorded",
    );
  }
  return Object.freeze({
    boundaryId: stored.boundaryId,
    termsRef: analysisTermsRef(stored.terms),
    termsHash: stored.termsHash,
    state: "DRAFT" as PolicyState,
    registeredAt: stored.registeredAt,
  });
}

/**
 * Move a terms version through its lifecycle: activate, freeze, resume, retire.
 *
 * Freezing is not decorative — a frozen definition may not measure a new dataset, and the schedule
 * path re-checks the state at the moment it runs rather than trusting the state at intake.
 */
export async function transitionAnalysisTerms(
  actor: ActorContext,
  transition: PolicyTransition,
  request: AnalysisTermsTransitionRequest,
): Promise<{
  readonly boundaryId: string;
  readonly termsRef: string;
  readonly state: PolicyState | null;
  readonly transition: PolicyTransition;
}> {
  requireCan(actor, transition === "RETIRED" ? "RetirePilotPolicy" : "ActivatePilotPolicy");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();

  // Boundary-scoped: a version from another tenant reads as absent, never as theirs to govern.
  const stored = await findAnalysisTerms(boundaryId, request.termsId, request.termsVersion);
  if (!stored) {
    throw new NotFoundError("no such analysis-terms version exists for this boundary");
  }

  const governance = await analysisTermsGovernanceState(boundaryId, request.termsId, request.termsVersion);
  if (governance.proposedBy !== null && governance.proposedBy === actor.actorId) {
    throw new ForbiddenError(
      "separation of duties: the actor who proposed an analysis-terms version cannot be the one who puts it in force",
    );
  }
  if (!canTransition(governance.state, transition)) {
    throw new ConflictError(
      `analysis terms cannot move from ${governance.state ?? "no state"} via ${transition}`,
    );
  }

  await appendAnalysisTermsEvent({
    boundaryId,
    termsId: request.termsId,
    termsVersion: request.termsVersion,
    transition,
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: request.rationale,
  });

  const after = await analysisTermsGovernanceState(boundaryId, request.termsId, request.termsVersion);
  return Object.freeze({
    boundaryId,
    termsRef: `${request.termsId}@${request.termsVersion}`,
    state: after.state,
    transition,
  });
}

/** Governed read: who proposed a definition, who put it in force, when and why. */
export async function readAnalysisTermsGovernance(
  actor: ActorContext,
  boundaryId: string,
  termsId: string,
  termsVersion: string,
) {
  requireCan(actor, "AuditRead");
  requireBoundaryAccess(actor, boundaryId);
  const trimmed = boundaryId.trim();
  const stored = await findAnalysisTerms(trimmed, termsId, termsVersion);
  if (!stored) throw new NotFoundError("no such analysis-terms version exists for this boundary");
  const governance = await analysisTermsGovernanceState(trimmed, termsId, termsVersion);
  return Object.freeze({
    boundaryId: stored.boundaryId,
    termsRef: analysisTermsRef(stored.terms),
    termsHash: stored.termsHash,
    asOf: stored.terms.asOf,
    stallThresholdDays: stored.terms.stallThresholdDays,
    calculationMethodVersion: stored.terms.calculationMethodVersion,
    state: governance.state,
    proposedBy: governance.proposedBy,
    proposedAt: governance.proposedAt,
    activatedBy: governance.activatedBy,
    activatedAt: governance.activatedAt,
    events: governance.events,
  });
}

/**
 * Which definitions this boundary may currently cite, with their values.
 *
 * Held by every role, like `ReadPilotAssessment`: a cut-off carries no counted dollar and no customer
 * row, and an operator who cannot see the cut-off their data will be read at is not being protected
 * from anything — they simply cannot tell what the number they are shown means. The list is the
 * OPPOSITE of a lever: it is the menu of definitions someone else approved.
 */
export async function listGovernedAnalysisTerms(actor: ActorContext, boundaryId: string) {
  requireCan(actor, "ReadPilotAssessment");
  requireBoundaryAccess(actor, boundaryId);
  const trimmed = boundaryId.trim();
  const all = await listAnalysisTerms(trimmed);
  const rows = await Promise.all(
    all.map(async (stored) => {
      const governance = await analysisTermsGovernanceState(
        trimmed,
        stored.terms.termsId,
        stored.terms.termsVersion,
      );
      return Object.freeze({
        termsRef: analysisTermsRef(stored.terms),
        termsId: stored.terms.termsId,
        termsVersion: stored.terms.termsVersion,
        asOf: stored.terms.asOf,
        stallThresholdDays: stored.terms.stallThresholdDays,
        termsHash: stored.termsHash,
        state: governance.state,
        mayMeasure: mayEvaluate(governance.state),
      });
    }),
  );
  return Object.freeze({ boundaryId: trimmed, terms: Object.freeze(rows) });
}

/** What a caller gets when it asks the register for the definition to use. */
export type ResolvedAnalysisTerms =
  | { readonly ok: true; readonly stored: StoredAnalysisTerms; readonly state: PolicyState }
  | { readonly ok: false; readonly state: PolicyState | null; readonly reason: string };

/**
 * Resolve the analysis terms an operation must run under — the single door every path uses.
 *
 * FAIL-CLOSED AND NO DEFAULT. An unnamed, unknown, unapproved, frozen or retired definition all
 * resolve the same way: refused. There is deliberately no branch in which a missing register means
 * "carry on with whatever was supplied", because that branch IS the defect — it would let the
 * requester state the definition again the moment governance was inconvenient.
 */
export async function resolveGovernedAnalysisTerms(
  boundaryId: string,
  termsId: string | undefined,
  termsVersion: string | undefined,
): Promise<ResolvedAnalysisTerms> {
  const id = termsId?.trim();
  const version = termsVersion?.trim();
  if (!id || !version) {
    return Object.freeze({
      ok: false as const,
      state: null,
      reason:
        "no analysis-terms version was named. The cut-off and stall threshold are not request parameters: propose a version and have governance activate it, then cite it by id and version",
    });
  }
  const stored = await findAnalysisTerms(boundaryId, id, version);
  if (!stored) {
    // Boundary-scoped absence. Another tenant's version reads as "no such version", never as theirs.
    return Object.freeze({
      ok: false as const,
      state: null,
      reason: `no analysis-terms version ${id}@${version} exists for this boundary`,
    });
  }
  // TAMPER EVIDENCE, checked here rather than trusted. The row is append-only and the hash was
  // computed from the definition when it was proposed, so a stored hash that no longer matches the
  // stored values means the row changed after it was blessed — by a migration, a restore or a bug.
  // Recomputing and carrying on would launder that change into the next finding.
  if (!(await analysisTermsHashMatches(stored.terms, stored.termsHash))) {
    return Object.freeze({
      ok: false as const,
      state: null,
      reason: `analysis terms ${id}@${version} no longer hash to the definition they were registered with`,
    });
  }
  const governance = await analysisTermsGovernanceState(boundaryId, id, version);
  if (!mayEvaluate(governance.state)) {
    return Object.freeze({
      ok: false as const,
      state: governance.state,
      reason: `analysis terms ${id}@${version}: ${whyCannotEvaluate(governance.state)}`,
    });
  }
  return Object.freeze({ ok: true as const, stored, state: governance.state as PolicyState });
}
