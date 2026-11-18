// B3 · WHETHER THIS SENDER'S INSTITUTION IS VERIFIED — DERIVED, NEVER DECLARED.
//
// WHAT THIS REPLACES, AND WHY IT HAD TO GO. `KeyRegistrationEvidence.institutionIdentityVerified`
// documented itself as *"the institution's identity, established independently of whoever supplied the
// key"* and arrived over HTTP as a **required boolean on the propose-key request** — no citation, no
// legal entity, no jurisdiction, no registry identifier, no second person, no lifecycle. And
// `ProposeSettlementKey` is held by `author` and `operator`: the BENEFICIARY side.
//
// It was not unchecked — a different identity activates and may refuse the whole registration. It was
// UNEVIDENCED: an activator looking at that row had nothing to check the claim against. Under the
// Trust Invariant's standing test that is the beneficiary authoring a fact about who they were talking
// to, which is exactly the design the test says to reject.
//
// SO THE PROPOSITION IS NOW ANSWERED BY A RECORD INSTEAD OF A TICK. The governed institution register
// already holds the answer: a legal entity verified against an independent registry, a regulator
// entry, a signatory schedule, a published channel, an out-of-band fingerprint, a recorded ceremony,
// key control resolved rather than asserted, and a second governance identity enforced by a database
// trigger. This module is the join: given the institution's lifecycle state for a key's own
// `(boundaryId, sourceSystem)`, may that key be put in force?
//
// THE FOUR NEGATIVE ANSWERS STAY DISTINGUISHABLE, and that is the point rather than a nicety. *No
// institution registered*, *registered but nobody has verified it*, *authority withdrawn* and
// *identity in doubt* are four different positions with four different remedies, and collapsing them
// into one `KEY_INSTITUTION_NOT_VERIFIED` would hide the only half of the answer that says what to go
// and get — the same reason `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE`
// are named apart, and the same reason `coverage.event` needed a third state.
//
// PURE, AND IT TOUCHES NO PROOF. This decides whether a KEY MAY BE ACTIVATED. It is deliberately not
// consulted when a settlement attestation is verified: `institutionAuthorityCeiling` answers
// historically, so what an attestation was authorised by at the time is what it stays authorised by,
// and a later withdrawal must change future decisions only. Wiring this into the verification path
// would be a change to `PROVEN` and is not in this slice.

import type { InstitutionAuthorityState } from "./institutionAuthority";

/** Version of this derivation. A change in what it permits is a NEW id. */
export const SENDER_AUTHORITY_VERSION = "sender-auth-2026.1";

export type SenderAuthorityRefusal =
  /**
   * No institution is registered for this key's boundary and source system at all.
   *
   * THE REFUSAL THAT FIRES TODAY ON EVERY KEY, and it is the correct answer rather than a missing
   * feature: nothing has established who this sender is. The remedy is an admission, not a flag.
   */
  | "KEY_INSTITUTION_NOT_REGISTERED"
  /** An institution exists and is still only PROPOSED — nobody independent has verified it. */
  | "KEY_INSTITUTION_NOT_VERIFIED"
  /** Verified once, and governance has since withdrawn its authority. */
  | "KEY_INSTITUTION_AUTHORITY_WITHDRAWN"
  /**
   * Its IDENTITY is in doubt, which is a different and heavier fact than a withdrawal.
   *
   * It says we are no longer sure who we were talking to, so it raises a question about everything
   * that institution ever signed — and it must never read as merely "inactive".
   */
  | "KEY_INSTITUTION_IDENTITY_DOUBTED"
  /**
   * The institution's own record could not be read for use — its stored values no longer hash to its
   * stored witness, or its governance log is unusable.
   *
   * SEPARATE FROM THE FOUR STATES, because "the record changed" is not a state of the institution: it
   * is a statement about the register, and it outranks whatever the row claims to be.
   */
  | "KEY_INSTITUTION_RECORD_UNREADABLE"
  /**
   * The institution register is not installed in this deployment at all.
   *
   * A DEPLOYMENT STATE, NOT A TRANSIENT OUTAGE, and not the same thing as an empty register. A
   * deployment that has the key register and not the institution register is a real and reachable
   * configuration — the schemas are separate design scripts and neither is in `prisma/migrations/` —
   * and before this code existed it produced an internal error from a missing relation rather than a
   * refusal. A gate that 500s is not failing closed; it is failing confusingly.
   *
   * IT IS RAISED ONLY FOR A MISSING RELATION. Every other database failure is RE-THROWN, because
   * filing a genuine outage as a tidy state is how a gate reports a clean answer it did not compute.
   */
  | "KEY_INSTITUTION_REGISTER_UNAVAILABLE";

export type SenderAuthorityVerdict =
  | {
      readonly authorised: true;
      /** Which institution's admission authorises this sender. Recorded, never inferred later. */
      readonly institutionId: string;
    }
  | {
      readonly authorised: false;
      readonly code: SenderAuthorityRefusal;
      readonly detail: string;
    };

const refuse = (code: SenderAuthorityRefusal, detail: string): SenderAuthorityVerdict =>
  Object.freeze({ authorised: false as const, code, detail });

/**
 * Map an institution's lifecycle state to whether a key naming that sender may be put in force.
 *
 * FAIL-CLOSED AND TOTAL. `null` — the state before any event, which `institutionStateAt` returns for
 * an instant earlier than the institution existed — is a refusal, not a pass. Every member of
 * `InstitutionAuthorityState` is handled explicitly rather than by a default branch, so adding a fifth
 * state is a compile error here instead of a silent admission.
 */
export function senderAuthorityFromState(
  state: InstitutionAuthorityState | null,
  institutionId: string,
): SenderAuthorityVerdict {
  switch (state) {
    case "VERIFIED":
      return Object.freeze({ authorised: true as const, institutionId });
    case "PROPOSED":
      return refuse(
        "KEY_INSTITUTION_NOT_VERIFIED",
        `institution '${institutionId}' is registered for this sender but is still only PROPOSED: a ` +
          "second governance identity has not verified it, and the ceremony's second-person condition " +
          "IS that verification rather than a box anyone can tick",
      );
    case "WITHDRAWN":
      return refuse(
        "KEY_INSTITUTION_AUTHORITY_WITHDRAWN",
        `institution '${institutionId}' had its authority withdrawn. A withdrawal says we no longer ` +
          "rely on this institution; it says nothing about what it previously attested, and there is " +
          "no re-verify — a renewed relationship is a new admission",
      );
    case "REVOKED_IDENTITY_DOUBTED":
      return refuse(
        "KEY_INSTITUTION_IDENTITY_DOUBTED",
        `institution '${institutionId}' is revoked because its IDENTITY is in doubt. That is heavier ` +
          "than a withdrawal: it raises a question about everything signed under its keys, so no " +
          "further key may be put in force for this sender",
      );
    case null:
      return refuse(
        "KEY_INSTITUTION_NOT_REGISTERED",
        `institution '${institutionId}' has no governance event in force at the instant asked about, ` +
          "so nothing has established who this sender is",
      );
  }
}

/**
 * The refusals a sender with NO registered institution leaves outstanding.
 *
 * DERIVED SO THE CLAIM CANNOT ROT. The honest statement today is that every settlement key refuses
 * here, because the institution register is empty — and that is a property of the evidence, not of
 * this code. A test asserts the refusal rather than the prose.
 */
export function unregisteredSenderRefusal(): SenderAuthorityRefusal {
  const verdict = senderAuthorityFromState(null, "(none)");
  // Unreachable by construction — `null` is the one input that cannot be authorised — and asserted
  // rather than assumed, because a function that returned `authorised: true` here would open every
  // key in the register.
  if (verdict.authorised) {
    throw new Error("senderAuthorityFromState authorised a sender with no institution");
  }
  return verdict.code;
}
