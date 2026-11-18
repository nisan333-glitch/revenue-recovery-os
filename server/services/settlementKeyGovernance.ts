// G2 · THE GOVERNED SETTLEMENT-KEY REGISTER · K1 Option A.
//
// WHAT THIS IS. Propose, activate, retire and revoke an external signing key, over a port so the
// decision logic is testable without a database and the Postgres implementation is testable against
// the real triggers and constraints.
//
// WHAT IT IS NOT, YET. Nothing here is reachable from `settlementVerification`, from the PROVEN gate
// or from any route. G2 builds the register; G4 is where the verifier stops reading an environment
// variable and starts resolving from it. Wiring it earlier would mean a verifier resolving against a
// register nothing has populated.
//
// THREE RULES THIS ENFORCES, AND WHERE EACH COMES FROM.
//
//   PROPOSER ≠ ACTIVATOR — `sourceAuthorityService.ts:52` already does this for a weaker object. A key
//   you register for yourself is the first input to a number you benefit from.
//
//   THE WITNESS IS RE-VERIFIED WHEREVER THE ROW IS RESOLVED FOR USE, never trusted as stored. That is
//   the 2026-10-04 register tamper-evidence decision, and the mistake the admission-policy register
//   had for weeks: the judging path trusted `stored.policyHash` while `policyHashMatches` had no
//   production caller at all.
//
//   A ROW THAT FAILS ITS WITNESS JUDGES NOTHING AND MAY NOT BE PUT IN FORCE — but governance may
//   always still RETIRE or REVOKE it, because refusing every transition would leave governance unable
//   to stop what it had just found.

import { ForbiddenError, NotFoundError } from "../http/errors";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { requireCan } from "../auth/authorityGate";
import {
  keyRegistrationRefusals,
  stateAt,
  type KeyRegistrationEvidence,
  type SettlementKeyEvent,
  type SettlementKeyFacts,
  type SettlementKeyState,
} from "../../src/contract/settlementKeyLifecycle";
import { hashSettlementKey, settlementKeyWitnessMatches } from "../../src/contract/settlementKeyWitness";
// TYPE ONLY. The verdict shape is a pure contract; the implementation that produces it is wired at the
// call site, so this module cannot reach the institution register for anything else.
import type { SenderAuthorityVerdict } from "../../src/contract/senderAuthority";

export interface RegisteredSettlementKey {
  readonly facts: SettlementKeyFacts;
  readonly witness: string;
  readonly evidence: KeyRegistrationEvidence;
  readonly registeredByActorId: string;
  readonly events: readonly SettlementKeyEvent[];
}

/** The persistence port. Its Postgres implementation is `settlementKeyStore.ts`. */
export interface SettlementKeyRegister {
  read(keyId: string): Promise<RegisteredSettlementKey | null>;
  insertKey(input: {
    readonly facts: SettlementKeyFacts;
    readonly witness: string;
    readonly evidence: KeyRegistrationEvidence;
    readonly actor: ActorContext;
    readonly rationale: string;
  }): Promise<void>;
  appendEvent(keyId: string, event: SettlementKeyEvent): Promise<void>;
}

/**
 * B3 · WHETHER THE SENDER'S INSTITUTION IS VERIFIED, as a NARROW PORT.
 *
 * A PORT RATHER THAN AN IMPORT OF THE REGISTER, and that is a layering decision rather than a
 * convenience. This module decides what a key may do; it has no business reaching an institution's
 * legal entity, its citations, its governance log or its witness. It asks one question and receives
 * one verdict, so the register can never be read from here for anything else.
 *
 * IT TAKES THE KEY'S OWN FACTS, NEVER A REQUEST FIELD. The sender is `(boundaryId, sourceSystem)` from
 * the stored, witness-verified key row — not something a caller names — so an activation cannot be
 * pointed at a different institution's admission than the one this key actually belongs to.
 */
export interface SenderAuthoritySource {
  senderAuthority(input: {
    readonly boundaryId: string;
    readonly sourceSystem: string;
    /** The instant to judge at, so the answer is as of the activation rather than as of "now". */
    readonly at: string;
  }): Promise<SenderAuthorityVerdict>;
}

export type KeyGovernanceRefusal =
  | "KEY_PROPOSER_MAY_NOT_ACTIVATE"
  | "KEY_WITNESS_MISMATCH"
  | "KEY_ALREADY_REGISTERED"
  | "KEY_REGISTRATION_INCOMPLETE"
  | "KEY_ILLEGAL_TRANSITION"
  /** B3 · the sender's institution does not authorise this key. The reason is the port's own code. */
  | "KEY_SENDER_NOT_AUTHORISED";

const refuse = (code: KeyGovernanceRefusal, detail: string): ForbiddenError =>
  new ForbiddenError(`${code}: ${detail}`);

/**
 * Resolve a key for USE, re-verifying its witness.
 *
 * SEPARATE FROM `resolveForGovernance` ON PURPOSE. A row whose witness fails must verify nothing, and
 * must still be retirable — so the two questions "may this judge?" and "may governance act on it?"
 * cannot share an entry point. Collapsing them would force a choice between a register that cannot be
 * stopped and one that silently keeps judging.
 */
export async function resolveForUse(
  register: SettlementKeyRegister,
  keyId: string,
): Promise<RegisteredSettlementKey> {
  const row = await register.read(keyId);
  if (row === null) throw new NotFoundError(`settlement key '${keyId}' is not registered`);
  if (!(await settlementKeyWitnessMatches(row.facts, row.witness))) {
    throw refuse(
      "KEY_WITNESS_MISMATCH",
      "the stored values do not hash to the stored witness; the record changed after it was " +
        "registered, so it judges nothing — investigate it rather than re-registering over it",
    );
  }
  return row;
}

/**
 * Resolve for a GOVERNANCE transition. Deliberately does NOT require the witness to match.
 *
 * EXPORTED FOR G6's INVESTIGATION READ as well, under this same name rather than an alias: a second
 * name for one function is a second thing that can drift from it. The property an incident read needs
 * is exactly the property this one states — a row whose witness fails must still be REACHABLE, or an
 * investigator could not see the exposure of the very key they have just found tampered with. The
 * caller reports the witness status beside the answer instead of refusing to answer.
 */
export async function resolveForGovernance(
  register: SettlementKeyRegister,
  keyId: string,
): Promise<RegisteredSettlementKey> {
  const row = await register.read(keyId);
  if (row === null) throw new NotFoundError(`settlement key '${keyId}' is not registered`);
  return row;
}

function proposerOf(events: readonly SettlementKeyEvent[]): string | null {
  return events.find((e) => e.transition === "PROPOSED")?.actorId ?? null;
}

function assertLegal(
  events: readonly SettlementKeyEvent[],
  next: SettlementKeyEvent,
  allowedFrom: readonly SettlementKeyState[],
): void {
  // Asked AS OF the new event's own instant, so a transition is judged against the state it is
  // actually being applied to rather than against "now".
  const derived = stateAt(events, next.at);
  if (!derived.ok) throw refuse("KEY_ILLEGAL_TRANSITION", derived.detail);
  if (derived.state === null || !allowedFrom.includes(derived.state)) {
    throw refuse(
      "KEY_ILLEGAL_TRANSITION",
      `${next.transition} may not be applied from ${String(derived.state)}`,
    );
  }
}

export async function proposeSettlementKey(
  register: SettlementKeyRegister,
  actor: ActorContext,
  input: {
    readonly facts: SettlementKeyFacts;
    readonly evidence: KeyRegistrationEvidence;
    readonly rationale: string;
  },
): Promise<{ readonly keyId: string; readonly witness: string }> {
  requireCan(actor, "ProposeSettlementKey");
  requireBoundaryAccess(actor, input.facts.boundaryId);
  if ((await register.read(input.facts.keyId)) !== null) {
    throw refuse("KEY_ALREADY_REGISTERED", "a key with this id is already registered; a change is a new key");
  }
  // THE WITNESS IS COMPUTED BY THE SERVER, NEVER SUPPLIED. A caller that could state its own row's
  // witness could state a witness for values it did not write.
  const witness = await hashSettlementKey(input.facts);
  await register.insertKey({ ...input, witness, actor });
  return Object.freeze({ keyId: input.facts.keyId, witness });
}

/**
 * Put a key in force.
 *
 * `institutions` IS REQUIRED, NOT OPTIONAL, AND THAT IS THE WHOLE POINT OF THE SIGNATURE CHANGE. An
 * optional dependency lets every existing caller keep its old, ungated behaviour by saying nothing —
 * which is exactly how the proof bypass arose, and why `CaseApprovalContext.recoveryType` was made
 * required. Required means `tsc` names every activation site, and a site that cannot supply an
 * institution source cannot activate a key.
 *
 * ORDER IS DELIBERATE AND EACH STEP OUTRANKS THE NEXT: the witness first, because *this row changed*
 * outranks everything else about it; then the boundary; then the separation of duties, because who you
 * are outranks what you declared; then the DECLARED conditions; then the TRANSITION'S OWN LEGALITY;
 * and the sender's institution last.
 *
 * THE SENDER IS LAST BECAUSE IT IS THE ONLY ANSWER THAT LIVES OUTSIDE THIS REGISTER, and every
 * refusal above it is about something the caller or this register can see. An operator told "your
 * sender is unverified" when the real problem is that they proposed the key themselves, or dated the
 * activation before the key existed, would go and talk to an institution for nothing — see the note
 * on `assertLegal` below, which a test discovered rather than a reading.
 */
export async function activateSettlementKey(
  register: SettlementKeyRegister,
  institutions: SenderAuthoritySource,
  actor: ActorContext,
  input: { readonly keyId: string; readonly rationale: string; readonly at?: string },
): Promise<void> {
  requireCan(actor, "ActivateSettlementKey");
  // FOR USE, not for governance: activation PUTS A KEY IN FORCE, so a row that fails its witness must
  // not reach it. This is the one transition where the stricter resolve is correct.
  const row = await resolveForUse(register, input.keyId);
  requireBoundaryAccess(actor, row.facts.boundaryId);

  if (proposerOf(row.events) === actor.actorId) {
    throw refuse(
      "KEY_PROPOSER_MAY_NOT_ACTIVATE",
      "the identity that proposed a key may not be the identity that puts it in force",
    );
  }
  const missing = keyRegistrationRefusals(row.evidence);
  if (missing.length > 0) {
    throw refuse(
      "KEY_REGISTRATION_INCOMPLETE",
      `the K5 ceremony's DECLARED conditions are incomplete: ${missing.join(", ")} — note that ` +
        "demonstrating control of a key proves nothing about who holds it",
    );
  }

  const at = input.at ?? new Date().toISOString();
  const event: SettlementKeyEvent = {
    transition: "ACTIVATED", actorId: actor.actorId, actorRole: actor.role,
    rationale: input.rationale, at,
  };

  // THE TRANSITION'S OWN LEGALITY COMES BEFORE THE SENDER, AND A TEST FOUND THAT THE HARD WAY.
  //
  // My first version asked the institution first. An activation DATED BEFORE THE KEY'S BIRTH then
  // came back `KEY_INSTITUTION_NOT_REGISTERED` — because the institution's own lifecycle has no event
  // in force at an instant that early either, so `institutionStateAt` answers `null` and `null` is a
  // refusal. The institution was verified; the request was backdated. The gate blamed the bank.
  //
  // That is the `NH-AX-1009` mistake in miniature — blaming the data for a claim the caller made —
  // and it is exactly what this module's own comment warns against: an operator told "your sender is
  // unverified" when the real problem is the instant they supplied would go and talk to an
  // institution for nothing. A malformed request about the KEY is answered about the key.
  //
  // Neither order is less safe: both refuse and neither writes. Only one of them is honest.
  assertLegal(row.events, event, ["DRAFT"]);

  // B3 · THE INSTITUTION CONDITION, DERIVED. Asked about the key's OWN sender, at the activation's own
  // instant, and the port's code is carried through verbatim: *no institution registered*, *not yet
  // verified*, *authority withdrawn*, *identity in doubt* and *record unreadable* are five different
  // positions, and an operator needs to know which one they are in.
  const authority = await institutions.senderAuthority({
    boundaryId: row.facts.boundaryId,
    sourceSystem: row.facts.sourceSystem,
    at,
  });
  if (!authority.authorised) {
    throw refuse(
      "KEY_SENDER_NOT_AUTHORISED",
      `${authority.code}: ${authority.detail}. A key is put in force for a SENDER, and who that ` +
        "sender is comes from the governed institution register — never from a boolean on the " +
        "request, which the party proposing the key would simply set to true",
    );
  }

  await register.appendEvent(input.keyId, event);
}

export async function retireSettlementKey(
  register: SettlementKeyRegister,
  actor: ActorContext,
  input: { readonly keyId: string; readonly rationale: string; readonly at?: string },
): Promise<void> {
  requireCan(actor, "RevokeSettlementKey");
  const row = await resolveForGovernance(register, input.keyId);
  requireBoundaryAccess(actor, row.facts.boundaryId);
  const event: SettlementKeyEvent = {
    transition: "RETIRED", actorId: actor.actorId, actorRole: actor.role,
    rationale: input.rationale, at: input.at ?? new Date().toISOString(),
  };
  assertLegal(row.events, event, ["DRAFT", "ACTIVE"]);
  await register.appendEvent(input.keyId, event);
}

/**
 * Revoke a key as COMPROMISED.
 *
 * `exposureFrom` IS REQUIRED AS AN EXPLICIT ARGUMENT AND MAY BE `null`. It is not optional, because an
 * omitted parameter and a stated "we do not know" are different claims and the caller must make one.
 * `null` means UNKNOWN, and the pure core then treats the WHOLE of the key's life as the window —
 * never the revocation date, which would silently clear every attestation the key ever signed.
 */
export async function revokeSettlementKeyAsCompromised(
  register: SettlementKeyRegister,
  actor: ActorContext,
  input: {
    readonly keyId: string;
    readonly rationale: string;
    readonly exposureFrom: string | null;
    readonly at?: string;
  },
): Promise<void> {
  requireCan(actor, "RevokeSettlementKey");
  // GOVERNANCE, not use: a key found to have a broken witness is EXACTLY a key worth revoking, so
  // requiring the witness here would make the register unstoppable at the moment it matters most.
  const row = await resolveForGovernance(register, input.keyId);
  requireBoundaryAccess(actor, row.facts.boundaryId);
  const event: SettlementKeyEvent = {
    transition: "REVOKED_COMPROMISED", actorId: actor.actorId, actorRole: actor.role,
    rationale: input.rationale, at: input.at ?? new Date().toISOString(),
    exposureFrom: input.exposureFrom,
  };
  assertLegal(row.events, event, ["DRAFT", "ACTIVE", "RETIRED"]);
  await register.appendEvent(input.keyId, event);
}
