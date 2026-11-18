// K5 · THE GOVERNED INSTITUTION REGISTER.
//
// WHAT THIS IS. Propose, verify, withdraw and revoke a financial institution's AUTHORITY — over a port,
// so the decision logic is testable without a database and a Postgres implementation is testable
// against the real triggers.
//
// WHY IT EXISTS AT ALL, stated once. `settlementVerification` can prove that an attestation was signed
// by a key in NH's register. It cannot prove who holds that key. The ladder's only channel that reaches
// `AUTHORITY_VERIFIED` is third-party reconciliation, whose defining property is that *the third party
// is not party to the recovery claim* — a statement about WHO SIGNED. No quantity of signature checks
// reaches it. This register is where that question is answered, by a registry, a regulator, a published
// channel and two people at NH.
//
// WHAT IT IS NOT, YET. Nothing here is reachable from the PROVEN gate, from `settlementVerification` or
// from any route, and `THIRD_PARTY_RECONCILIATION.implemented` stays false. Wiring it now would mean a
// gate consulting a register nothing has populated, and the register cannot be populated without a real
// institution — which is an owner's decision, not a coding step. The order is the one the
// `obligation_ref` revert set: the slice that makes a field load-bearing ships its consumer with it.
//
// THREE RULES, AND WHERE EACH COMES FROM.
//
//   PROPOSER ≠ VERIFIER, BY IDENTITY AND NOT BY ROLE. Both capabilities sit with governance, because
//   the facts proposed are NH's own registry findings rather than a customer preference. The identity
//   check is what the ceremony's `secondPersonApproval` condition means.
//
//   THE SECOND-PERSON CONDITION IS DERIVED FROM THE LOG, NEVER SUPPLIED. A verifier who could tick
//   "a second person approved this" while verifying their own proposal would be the beneficiary
//   determining the number — the admission-policy provenance decision, one object across: *the
//   provenance recorded on a governed definition is stated by the server, never by a caller.*
//
//   THE WITNESS IS RE-VERIFIED WHEREVER THE ROW IS RESOLVED FOR USE, never trusted as stored — the
//   2026-10-04 register tamper-evidence decision. A row that fails its witness authorises nothing, and
//   governance may always still WITHDRAW or REVOKE it.

import { ForbiddenError, NotFoundError } from "../http/errors";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { requireCan } from "../auth/authorityGate";
import {
  institutionAuthorityRefusals,
  institutionStateAt,
  INSTITUTION_AUTHORITY_CONDITIONS,
  type InstitutionAuthorityCondition,
  type InstitutionAuthorityEvent,
  type InstitutionAuthorityEvidence,
  type InstitutionAuthorityState,
} from "../../src/contract/institutionAuthority";
import {
  hashInstitution,
  institutionFactsProblems,
  institutionWitnessMatches,
  type InstitutionFacts,
} from "../../src/contract/institutionIdentity";

/**
 * The six conditions an operator DECLARES, each needing a citation NH stores but cannot check.
 *
 * DERIVED by removing the two NH establishes itself, so adding a condition to the ceremony puts it
 * here automatically rather than silently escaping the citation requirement.
 */
export const SERVER_ESTABLISHED_CONDITIONS: readonly InstitutionAuthorityCondition[] = Object.freeze([
  /** Derived from the event log: the verifier is not the proposer. */
  "secondPersonApproval",
  /** Established by resolving a named key in the settlement-key register, not by a tick. */
  "keyControlDemonstrated",
]);

export const DECLARED_CONDITIONS: readonly InstitutionAuthorityCondition[] = Object.freeze(
  INSTITUTION_AUTHORITY_CONDITIONS.filter((c) => !SERVER_ESTABLISHED_CONDITIONS.includes(c)),
);

/**
 * What a verifier submits.
 *
 * `secondPersonApproval` AND `keyControlDemonstrated` ARE ABSENT FROM THE TYPE, not optional in it. An
 * optional field lets a caller keep the old behaviour by saying nothing, which is how the proof-bypass
 * arose; a field that does not exist cannot be supplied, and an injected one is refused by name.
 */
export interface InstitutionVerificationSubmission {
  /**
   * For each declared condition, the out-of-band record that establishes it.
   *
   * A CITATION, NOT A PROOF. NH cannot check a company register or a signatory list, so the honest
   * record is *who looked, at what, and when* — classified `UNCORROBORATED_CLAIM` exactly as the
   * provenance attestation classifies what it cannot check. Requiring it anyway is the difference
   * between a decision someone can be asked about and a tick.
   */
  readonly citations: Readonly<Partial<Record<InstitutionAuthorityCondition, string>>>;
  /**
   * The registered settlement key whose control the institution demonstrated.
   *
   * REQUIRED AND RESOLVED, never a boolean. The condition means *this institution produced a signature
   * under a key we hold the public half of*, so the evidence is a key that exists in the register, is
   * bound to this institution's own source system and boundary, and is in force.
   */
  readonly keyControlDemonstratedByKeyId: string;
  readonly rationale: string;
}

export interface RegisteredInstitution {
  readonly facts: InstitutionFacts;
  readonly witness: string;
  readonly proposedByActorId: string;
  readonly events: readonly InstitutionAuthorityEvent[];
  /** Recorded at verification. `null` until then — NOT an all-false evidence set, which would read
   * as "we looked and found nothing" rather than "nobody has verified this yet". */
  readonly verification: {
    readonly evidence: InstitutionAuthorityEvidence;
    readonly citations: Readonly<Partial<Record<InstitutionAuthorityCondition, string>>>;
    readonly keyId: string;
    readonly verifiedByActorId: string;
    /** The role the verifying identity held. WHO verified is half the record. */
    readonly verifiedByRole: string;
  } | null;
}

/** The persistence port. Its Postgres implementation is `institutionStore.ts`. */
export interface InstitutionRegister {
  read(institutionId: string): Promise<RegisteredInstitution | null>;
  /**
   * B3 · the institution registered for a SENDER, which is how a settlement key finds its own.
   *
   * ONE ROW OR NONE, GUARANTEED BY THE DATABASE rather than by this signature: the unique index on
   * `(boundary_id, source_system)` is what makes "the institution for this sender" a well-formed
   * question. Without it two rows could claim one sender and the answer would depend on which was
   * read first — which is precisely how a competing legal entity would be introduced for a sender
   * that is already verified.
   */
  findBySender(boundaryId: string, sourceSystem: string): Promise<RegisteredInstitution | null>;
  insertInstitution(input: {
    readonly facts: InstitutionFacts;
    readonly witness: string;
    readonly actor: ActorContext;
    readonly rationale: string;
  }): Promise<void>;
  appendEvent(institutionId: string, event: InstitutionAuthorityEvent): Promise<void>;
  recordVerification(
    institutionId: string,
    verification: NonNullable<RegisteredInstitution["verification"]>,
  ): Promise<void>;
}

/**
 * What the register needs to know about a settlement key, and nothing more.
 *
 * A NARROW PORT RATHER THAN THE KEY REGISTER ITSELF, so this module cannot reach the key material, the
 * lifecycle log or anything else it has no business reading. The caller wires the real register.
 */
export interface KeyControlSource {
  keyInForce(keyId: string): Promise<
    { readonly boundaryId: string; readonly sourceSystem: string; readonly inForce: boolean } | null
  >;
}

export type InstitutionGovernanceRefusal =
  | "INSTITUTION_PROPOSER_MAY_NOT_VERIFY"
  | "INSTITUTION_WITNESS_MISMATCH"
  | "INSTITUTION_ALREADY_REGISTERED"
  | "INSTITUTION_FACTS_MALFORMED"
  | "INSTITUTION_ILLEGAL_TRANSITION"
  | "INSTITUTION_CITATION_MISSING"
  | "INSTITUTION_KEY_NOT_IN_FORCE"
  | "INSTITUTION_KEY_NOT_BOUND_TO_INSTITUTION"
  /** A caller tried to state a condition the server establishes. A 400-shaped mistake, named. */
  | "INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED";

const refuse = (code: InstitutionGovernanceRefusal, detail: string): ForbiddenError =>
  new ForbiddenError(`${code}: ${detail}`);

/**
 * Resolve an institution for USE, re-verifying its witness.
 *
 * SEPARATE FROM `resolveForGovernance` for the same reason the key register separates them: a row whose
 * witness fails must authorise nothing and must still be withdrawable, so "may this authorise?" and
 * "may governance act on it?" cannot share an entry point.
 */
export async function resolveInstitutionForUse(
  register: InstitutionRegister,
  institutionId: string,
): Promise<RegisteredInstitution> {
  const row = await register.read(institutionId);
  if (row === null) throw new NotFoundError(`institution '${institutionId}' is not registered`);
  if (!(await institutionWitnessMatches(row.facts, row.witness))) {
    throw refuse(
      "INSTITUTION_WITNESS_MISMATCH",
      "the stored values do not hash to the stored witness; the record changed after it was " +
        "registered, so it authorises nothing — investigate it rather than re-registering over it",
    );
  }
  return row;
}

/** Resolve for a GOVERNANCE transition. Deliberately does NOT require the witness to match. */
export async function resolveInstitutionForGovernance(
  register: InstitutionRegister,
  institutionId: string,
): Promise<RegisteredInstitution> {
  const row = await register.read(institutionId);
  if (row === null) throw new NotFoundError(`institution '${institutionId}' is not registered`);
  return row;
}

function assertLegal(
  events: readonly InstitutionAuthorityEvent[],
  next: InstitutionAuthorityEvent,
  allowedFrom: readonly InstitutionAuthorityState[],
): void {
  // Asked AS OF the new event's own instant, so a transition is judged against the state it is
  // actually applied to rather than against "now".
  const derived = institutionStateAt(events, next.at);
  if (!derived.ok) throw refuse("INSTITUTION_ILLEGAL_TRANSITION", derived.detail);
  if (derived.state === null || !allowedFrom.includes(derived.state)) {
    throw refuse(
      "INSTITUTION_ILLEGAL_TRANSITION",
      `${next.transition} may not be applied from ${String(derived.state)}`,
    );
  }
}

export async function proposeInstitution(
  register: InstitutionRegister,
  actor: ActorContext,
  input: { readonly facts: InstitutionFacts; readonly rationale: string; readonly at?: string },
): Promise<{ readonly institutionId: string; readonly witness: string }> {
  requireCan(actor, "ProposeInstitution");
  const problems = institutionFactsProblems(input.facts);
  if (problems.length > 0) {
    throw refuse("INSTITUTION_FACTS_MALFORMED", `the institution's facts are unusable: ${problems.join("; ")}`);
  }
  requireBoundaryAccess(actor, input.facts.boundaryId);
  if ((await register.read(input.facts.institutionId)) !== null) {
    throw refuse(
      "INSTITUTION_ALREADY_REGISTERED",
      "an institution with this id is already registered; a change of legal entity, jurisdiction, " +
        "registry identifier or source system is a NEW institution, not an edit to this one",
    );
  }
  // THE WITNESS IS COMPUTED BY THE SERVER, NEVER SUPPLIED. A caller that could state its own row's
  // witness could state a witness for values it did not write.
  const witness = await hashInstitution(input.facts);
  await register.insertInstitution({ facts: input.facts, witness, actor, rationale: input.rationale });
  await register.appendEvent(input.facts.institutionId, {
    transition: "PROPOSE",
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: input.rationale,
    at: input.at ?? new Date().toISOString(),
  });
  return Object.freeze({ institutionId: input.facts.institutionId, witness });
}

/**
 * Verify an institution's authority. The one transition that puts authority IN FORCE.
 *
 * ORDER IS DELIBERATE AND IS THE WHOLE CONTROL. Identity re-derivation first, then the separation of
 * duties, then the key, then the ceremony — so "this row changed" outranks "you proposed it", which
 * outranks "the key is not in force", which outranks "a citation is missing". Each refusal is about a
 * different fact, and an operator told the wrong one looks in the wrong place.
 */
export async function verifyInstitution(
  register: InstitutionRegister,
  keys: KeyControlSource,
  actor: ActorContext,
  input: InstitutionVerificationSubmission & { readonly institutionId: string; readonly at?: string },
): Promise<void> {
  requireCan(actor, "VerifyInstitution");

  // AN INJECTED SERVER-ESTABLISHED CONDITION IS REFUSED BY NAME rather than silently stripped — the
  // same treatment EP-26b gave the `policy` object and G10's scheduling path gave `declaredVersion`.
  // A silent strip means a caller believes they set something they did not.
  for (const c of SERVER_ESTABLISHED_CONDITIONS) {
    if (Object.prototype.hasOwnProperty.call(input.citations, c)) {
      throw refuse(
        "INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED",
        `'${c}' is established by the server and may not be cited by a caller: ` +
          "the second person is derived from who proposed this institution, and key control is " +
          "established by resolving the named key in the settlement-key register",
      );
    }
  }

  // FOR USE, not for governance: verification puts authority in force, so a row that fails its witness
  // must not reach it. This is the one transition where the stricter resolve is correct.
  const row = await resolveInstitutionForUse(register, input.institutionId);
  requireBoundaryAccess(actor, row.facts.boundaryId);

  const proposer = row.events.find((e) => e.transition === "PROPOSE")?.actorId ?? row.proposedByActorId;
  if (proposer === actor.actorId) {
    throw refuse(
      "INSTITUTION_PROPOSER_MAY_NOT_VERIFY",
      "the identity that proposed an institution may not be the identity that verifies it. This is " +
        "not a formality: the ceremony's second-person condition IS this check, which is why it " +
        "cannot be stated as evidence by whoever is performing the verification",
    );
  }

  const key = await keys.keyInForce(input.keyControlDemonstratedByKeyId);
  if (key === null || !key.inForce) {
    throw refuse(
      "INSTITUTION_KEY_NOT_IN_FORCE",
      `key '${input.keyControlDemonstratedByKeyId}' is not a registered key in force, so control of ` +
        "it demonstrates nothing. Demonstrating control of a key proves control of a key; this " +
        "condition records WHICH key, so a later compromise can reach this verification",
    );
  }
  if (key.boundaryId !== row.facts.boundaryId || key.sourceSystem !== row.facts.sourceSystem) {
    throw refuse(
      "INSTITUTION_KEY_NOT_BOUND_TO_INSTITUTION",
      "the named key belongs to a different boundary or source system, so it attests for a different " +
        "sender. Accepting it would let one institution's demonstrated control stand in for another's",
    );
  }

  // THE EVIDENCE SET IS ASSEMBLED BY THE SERVER, from citations it stores and facts it established.
  const evidence = {} as Record<InstitutionAuthorityCondition, boolean>;
  const missingCitations: string[] = [];
  for (const c of DECLARED_CONDITIONS) {
    const cited = input.citations[c];
    const present = typeof cited === "string" && cited.trim().length > 0;
    if (!present) missingCitations.push(c);
    evidence[c] = present;
  }
  // Both established above: the separation check passed, and the key resolved and is bound here.
  evidence.secondPersonApproval = true;
  evidence.keyControlDemonstrated = true;

  if (missingCitations.length > 0) {
    throw refuse(
      "INSTITUTION_CITATION_MISSING",
      `these conditions carry no out-of-band record: ${missingCitations.join(", ")}. NH cannot check a ` +
        "company register, a regulator or a signatory list, so the only honest form of that evidence " +
        "is a citation someone can be asked about — a tick with nothing behind it is not evidence",
    );
  }

  const frozen = Object.freeze(evidence) as InstitutionAuthorityEvidence;
  const outstanding = institutionAuthorityRefusals(frozen);
  if (outstanding.length > 0) {
    // Unreachable while every condition is either cited or established above — asserted rather than
    // assumed, because a condition added to the ceremony and to neither list would otherwise verify
    // an institution on an incomplete bar.
    throw refuse(
      "INSTITUTION_CITATION_MISSING",
      `the admission bar is not met: ${outstanding.join(", ")}. A condition exists that is neither ` +
        "declared nor server-established, which is a gap in this module rather than in the submission",
    );
  }

  const event: InstitutionAuthorityEvent = {
    transition: "VERIFY",
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: input.rationale,
    at: input.at ?? new Date().toISOString(),
  };
  assertLegal(row.events, event, ["PROPOSED"]);
  await register.recordVerification(input.institutionId, {
    evidence: frozen,
    citations: Object.freeze({ ...input.citations }),
    keyId: input.keyControlDemonstratedByKeyId,
    verifiedByActorId: actor.actorId,
    verifiedByRole: actor.role,
  });
  await register.appendEvent(input.institutionId, event);
}

/**
 * Withdraw an institution's authority — the relationship ended, or we no longer rely on it.
 *
 * NEVER A STATEMENT ABOUT WHAT IT ATTESTED. That is the other transition, and the two are separate so
 * that reading the log says which happened.
 */
export async function withdrawInstitution(
  register: InstitutionRegister,
  actor: ActorContext,
  input: { readonly institutionId: string; readonly rationale: string; readonly at?: string },
): Promise<void> {
  requireCan(actor, "VerifyInstitution");
  // GOVERNANCE, not use: an institution whose witness is broken is exactly one worth withdrawing, so
  // requiring the witness here would make the register unstoppable at the moment it matters most.
  const row = await resolveInstitutionForGovernance(register, input.institutionId);
  requireBoundaryAccess(actor, row.facts.boundaryId);
  const event: InstitutionAuthorityEvent = {
    transition: "WITHDRAW",
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: input.rationale,
    at: input.at ?? new Date().toISOString(),
  };
  assertLegal(row.events, event, ["PROPOSED", "VERIFIED"]);
  await register.appendEvent(input.institutionId, event);
}

/**
 * Revoke because the institution's IDENTITY is in doubt.
 *
 * THE HEAVIEST TRANSITION IN THE REGISTER, and it is deliberately reachable from WITHDRAWN too: an
 * institution whose relationship ended can later be found to have been impersonated, and refusing that
 * would leave governance unable to state what it just learned.
 *
 * IT REVERSES NO PROOF AND RECOMPUTES NOTHING. `institutionAuthorityCeiling` answers historically, so
 * what an attestation was authorised by at the time is what it stays authorised by. Learning changes
 * future decisions only; the exposure is REPORTED, which is the settlement-compromise read's job.
 */
export async function revokeInstitutionIdentityDoubted(
  register: InstitutionRegister,
  actor: ActorContext,
  input: { readonly institutionId: string; readonly rationale: string; readonly at?: string },
): Promise<void> {
  requireCan(actor, "VerifyInstitution");
  const row = await resolveInstitutionForGovernance(register, input.institutionId);
  requireBoundaryAccess(actor, row.facts.boundaryId);
  const event: InstitutionAuthorityEvent = {
    transition: "REVOKE_IDENTITY_DOUBTED",
    actorId: actor.actorId,
    actorRole: actor.role,
    rationale: input.rationale,
    at: input.at ?? new Date().toISOString(),
  };
  assertLegal(row.events, event, ["PROPOSED", "VERIFIED", "WITHDRAWN"]);
  await register.appendEvent(input.institutionId, event);
}
