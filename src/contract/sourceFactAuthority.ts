// SOURCE-FACT AUTHORITY — how far NH can honestly vouch for a fact a customer supplied.
//
// NAMED TO BE UNCONFUSABLE with `src/domain/authority.ts`, which is about ACTORS: who may approve a
// proof, and the rule that no beneficiary is the sole author, approver or verifier of their own claim.
// This module is about SOURCES: whether a fact in a file can be relied on at all. Two different
// questions that would be dangerous to blur, because an authorised actor uploading an unverified file
// is exactly the case that must not read as trustworthy.
//
// THE LADDER, and each rung is a strictly stronger claim than the one below it:
//
//   PRESENT             the column exists and the cell is non-blank
//   VALID_FORMAT        it parses as the kind the contract declares
//   SOURCE_NATIVE       it is the SOURCE SYSTEM'S OWN identifier or value, not something NH or the
//                       operator composed. Establishable from the contract: a field declared
//                       source-native and carrying no NH-derived component.
//   AUTHORITY_VERIFIED  the fact is evidenced by a channel the BENEFICIARY CANNOT UNILATERALLY ALTER
//
// and one terminal state:
//
//   AUTHORITY_UNVERIFIED  the rung above could not be reached. Stated explicitly, never implied by
//                         silence, and never rounded up to the rung below it.
//
// THE RULE THAT DOES THE WORK:
//
//   **Structural presence is not authority, and a request parameter can never declare a source
//   authoritative.** The caller is the beneficiary of a larger number. A field named `authoritative`,
//   `verified`, `trusted` or `signed_by` arriving in a request is the beneficiary vouching for
//   themselves, which Trust Invariant rules 1 and 8 forbid outright.
//
// WHERE THIS SLICE ACTUALLY STOPS, stated rather than aspired to: **no fact can reach
// AUTHORITY_VERIFIED today**, because no provenance channel exists — no signed export, no
// system-of-record attestation, no direct fetch NH performed itself. The ceiling is therefore
// SOURCE_NATIVE + AUTHORITY_UNVERIFIED, every readiness level that depends on it is reported
// PROVISIONAL, and the path FAILS CLOSED at that named state. This is the capability-reporting rule one
// layer out: a layer may not declare what it cannot establish.

export type SourceFactAuthority =
  | "PRESENT"
  | "VALID_FORMAT"
  | "SOURCE_NATIVE"
  | "AUTHORITY_VERIFIED"
  | "AUTHORITY_UNVERIFIED";

/** Ordered weakest to strongest. `AUTHORITY_UNVERIFIED` is terminal and deliberately outside the order. */
export const AUTHORITY_LADDER: readonly SourceFactAuthority[] = Object.freeze([
  "PRESENT", "VALID_FORMAT", "SOURCE_NATIVE", "AUTHORITY_VERIFIED",
]);

/**
 * The channels that COULD establish authority, declared so the gap has a shape rather than being a
 * vague future. None is implemented, and `implemented: false` is what the ceiling test reads.
 */
export type ProvenanceChannel =
  | "SIGNED_EXPORT"
  | "SYSTEM_OF_RECORD_ATTESTATION"
  | "NH_PERFORMED_FETCH"
  | "THIRD_PARTY_RECONCILIATION";

export interface ProvenanceChannelSpec {
  readonly channel: ProvenanceChannel;
  readonly whatItWouldEstablish: string;
  readonly whyTheBeneficiaryCannotAlterIt: string;
  readonly implemented: false;
}

export const PROVENANCE_CHANNELS: readonly ProvenanceChannelSpec[] = Object.freeze([
  Object.freeze({
    channel: "SIGNED_EXPORT" as const,
    whatItWouldEstablish: "That these bytes left the named source system unaltered.",
    whyTheBeneficiaryCannotAlterIt:
      "The signature is made by the source system's key, which the party assembling the submission does not hold. Editing a row invalidates it.",
    implemented: false as const,
  }),
  Object.freeze({
    channel: "SYSTEM_OF_RECORD_ATTESTATION" as const,
    whatItWouldEstablish: "That the system of record asserts this extract is its own complete statement for the period.",
    whyTheBeneficiaryCannotAlterIt:
      "The attestation names the period and the row count before the result is known, so a later trim is detectable — the same pre-registration shape the admission bar uses.",
    implemented: false as const,
  }),
  Object.freeze({
    channel: "NH_PERFORMED_FETCH" as const,
    whatItWouldEstablish: "That NH read the facts from the source system itself rather than receiving a file.",
    whyTheBeneficiaryCannotAlterIt: "There is no intermediate step in which a row can be changed.",
    implemented: false as const,
  }),
  Object.freeze({
    channel: "THIRD_PARTY_RECONCILIATION" as const,
    whatItWouldEstablish: "That a settled amount agrees with an independent record such as a payment processor or bank.",
    whyTheBeneficiaryCannotAlterIt: "The third party is not party to the recovery claim.",
    implemented: false as const,
  }),
]);

/** Parameter names that a caller might use to vouch for their own file. Refused, not honoured. */
export const SELF_ASSERTED_AUTHORITY_PARAMETERS: readonly string[] = Object.freeze([
  "authoritative", "authority", "verified", "trusted", "attested", "signed",
  "isAuthoritative", "authorityVerified", "sourceVerified", "signedBy",
]);

export interface AuthorityAssessment {
  readonly reached: SourceFactAuthority;
  /** Why the next rung was not reached. Never blank when `reached` is not AUTHORITY_VERIFIED. */
  readonly ceilingReason: string;
  /** The channels that would lift it, named so the customer conversation has somewhere to go. */
  readonly wouldBeLiftedBy: readonly ProvenanceChannel[];
}

/**
 * Assess how far a supplied fact climbs.
 *
 * It takes only facts NH can check for itself. There is deliberately NO parameter by which a caller can
 * assert authority — the refusal is STRUCTURAL rather than a validation, because a field that exists
 * and is rejected still invites someone to wonder what it would take to be accepted.
 */
export function assessSourceFactAuthority(input: {
  readonly present: boolean;
  readonly validFormat: boolean;
  /** Declared by the CONTRACT, not by the caller: is this field the source system's own value? */
  readonly declaredSourceNative: boolean;
  /** True only if some implemented provenance channel evidenced it. Always false in this slice. */
  readonly provenanceEstablished?: boolean;
}): AuthorityAssessment {
  const lifted = Object.freeze(PROVENANCE_CHANNELS.filter((c) => !c.implemented).map((c) => c.channel));
  if (!input.present) {
    return Object.freeze({
      reached: "AUTHORITY_UNVERIFIED",
      ceilingReason: "the fact is absent, so no rung applies",
      wouldBeLiftedBy: Object.freeze([]),
    });
  }
  if (!input.validFormat) {
    return Object.freeze({
      reached: "PRESENT",
      ceilingReason: "the value does not parse as the kind this contract declares",
      wouldBeLiftedBy: Object.freeze([]),
    });
  }
  if (!input.declaredSourceNative) {
    return Object.freeze({
      reached: "VALID_FORMAT",
      ceilingReason: "the contract does not declare this field as the source system's own value",
      wouldBeLiftedBy: Object.freeze([]),
    });
  }
  if (input.provenanceEstablished === true) {
    return Object.freeze({
      reached: "AUTHORITY_VERIFIED",
      ceilingReason: "",
      wouldBeLiftedBy: Object.freeze([]),
    });
  }
  return Object.freeze({
    reached: "SOURCE_NATIVE",
    ceilingReason:
      "no implemented provenance channel evidences these bytes. The file is the source system's own shape and values as far as NH can check, and NOTHING establishes that it left that system unaltered — so authority is UNVERIFIED and every level resting on it is PROVISIONAL.",
    wouldBeLiftedBy: lifted,
  });
}

/** True when a submission attempts to vouch for itself. Such a key is refused, never read. */
export function declaresOwnAuthority(payload: Readonly<Record<string, unknown>>): readonly string[] {
  const lower = new Map(Object.keys(payload).map((k) => [k.toLowerCase(), k]));
  return Object.freeze(
    SELF_ASSERTED_AUTHORITY_PARAMETERS
      .map((p) => lower.get(p.toLowerCase()))
      .filter((k): k is string => k !== undefined),
  );
}
