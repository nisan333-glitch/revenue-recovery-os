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
//   SOURCE_ATTESTED     the customer's data-owning ROLE is on record as declaring each export's origin,
//                       method, window and row count, and every claim NH can check agrees with the files.
//                       Stronger than SOURCE_NATIVE because an accountable declarant exists at all and
//                       because the two files are mutually consistent in ways the declaration does not
//                       control. Weaker than AUTHORITY_VERIFIED because the declaration and the files
//                       arrive together from the same party, so NOTHING here establishes completeness.
//   AUTHORITY_VERIFIED  the fact is evidenced by a channel the BENEFICIARY CANNOT UNILATERALLY ALTER
//
// and one terminal state:
//
//   AUTHORITY_UNVERIFIED  the rung above could not be reached. Stated explicitly, never implied by
//                         silence, and never rounded up to the rung below it.
//
// WHY SOURCE_ATTESTED IS A RUNG AND NOT A ROUNDING, proved rather than asserted. It cannot be
// AUTHORITY_VERIFIED: the attestation is written by the submitting side, which is on the beneficiary side
// of a larger recovery number — the Trust Invariant's standing test names the customer explicitly — and
// this repository's one implementation of that rung (`server/services/sourceVerification.ts`) requires an
// Ed25519 key the SOURCE SYSTEM holds and the submitter does not.
//
// It also cannot stay SOURCE_NATIVE, and the reason had to be CORRECTED. The first version argued
// wrongly that a pre-committed row count made a later trim detectable; it does not, because the declaration and the file
// arrive together from the same party. What survives that objection is narrower and real:
//
//   • an ACCOUNTABLE ROLE is on record, which nothing at SOURCE_NATIVE has at all;
//   • the declaration is internally consistent with the files received;
//   • the two files are MUTUALLY CONSISTENT IN WAYS THE DECLARATION DOES NOT CONTROL — the attestation
//     never states the payer overlap or the obligation join, so NH derives both from the two exports
//     independently. Defeating those means repairing the join itself across both files, not editing a
//     number, which is a different and much larger thing to ask of a bad actor.
//
// And the two may not be collapsed, because the unavailable states stay DISTINGUISHABLE — collapsing
// hides which half is missing, which is the only part of the answer that says what to go and get.
//
// IT IS DELIBERATELY NOT NAMED "VERIFIED_FOR_PILOT". A rung whose name contains VERIFIED gets quoted
// without its qualifier, and this repository has already paid for that once: `settled_at` recorded a
// charge being raised and was read as a payment until it was renamed. The name says who acted — the
// source side attested — and claims nothing about verification.
//
// THE RULE THAT DOES THE WORK:
//
//   **Structural presence is not authority, and a request parameter can never declare a source
//   authoritative.** The caller is the beneficiary of a larger number. A field named `authoritative`,
//   `verified`, `trusted` or `signed_by` arriving in a request is the beneficiary vouching for
//   themselves, which Trust Invariant rules 1 and 8 forbid outright.
//
// WHERE THIS STOPS, stated rather than aspired to: **no fact can reach AUTHORITY_VERIFIED**, because no
// channel the beneficiary cannot alter exists here — no signed export, no machine-issued system-of-record
// attestation, no direct fetch NH performed itself. The ceiling is SOURCE_ATTESTED when an attestation
// accompanies the submission and corroborates, SOURCE_NATIVE when it does not, and in BOTH cases
// authority is unverified and every readiness level resting on it is reported PROVISIONAL. The path FAILS
// CLOSED at the named state. This is the capability-reporting rule one layer out: a layer may not declare
// what it cannot establish.

import type { AttestationCorroboration } from "./provenanceAttestation";

export type SourceFactAuthority =
  | "PRESENT"
  | "VALID_FORMAT"
  | "SOURCE_NATIVE"
  | "SOURCE_ATTESTED"
  | "AUTHORITY_VERIFIED"
  | "AUTHORITY_UNVERIFIED";

/** Ordered weakest to strongest. `AUTHORITY_UNVERIFIED` is terminal and deliberately outside the order. */
export const AUTHORITY_LADDER: readonly SourceFactAuthority[] = Object.freeze([
  "PRESENT", "VALID_FORMAT", "SOURCE_NATIVE", "SOURCE_ATTESTED", "AUTHORITY_VERIFIED",
]);

/**
 * The channels that COULD establish authority, declared so the gap has a shape rather than being a
 * vague future. Exactly ONE is implemented — DATA_OWNER_ATTESTATION, which reaches SOURCE_ATTESTED —
 * and the other four remain the only routes to AUTHORITY_VERIFIED. `reaches` is what the ceiling test
 * reads, because "implemented" alone would let a weak channel imply a strong rung.
 */
export type ProvenanceChannel =
  | "DATA_OWNER_ATTESTATION"
  | "SIGNED_EXPORT"
  | "SYSTEM_OF_RECORD_ATTESTATION"
  | "NH_PERFORMED_FETCH"
  | "THIRD_PARTY_RECONCILIATION";

export interface ProvenanceChannelSpec {
  readonly channel: ProvenanceChannel;
  readonly whatItWouldEstablish: string;
  /**
   * Why the beneficiary cannot alter it — and for the ONE implemented channel, the honest admission that
   * they partly can. A channel that reaches AUTHORITY_VERIFIED must answer this with no caveat.
   */
  readonly whyTheBeneficiaryCannotAlterIt: string;
  readonly implemented: boolean;
  /** The highest rung this channel can establish. Only an unalterable channel may name AUTHORITY_VERIFIED. */
  readonly reaches: SourceFactAuthority;
  /**
   * WHAT THE SUBMITTING PARTY STILL CONTROLS once this channel has done its work. Structural rather than
   * prose, because prose about a residual weakness can be rewritten into optimism and a required
   * non-empty list cannot. A channel reaching AUTHORITY_VERIFIED must declare `[]` — that is what the
   * rung means — and a channel reaching SOURCE_ATTESTED must declare what remains in the submitter's
   * hands, which is why it stops where it stops.
   */
  readonly submitterStillControls: readonly string[];
}

export const PROVENANCE_CHANNELS: readonly ProvenanceChannelSpec[] = Object.freeze([
  Object.freeze({
    channel: "DATA_OWNER_ATTESTATION" as const,
    whatItWouldEstablish:
      "That the customer's data-owning role is on record as declaring each export's origin, extraction method, coverage window and row count, and that every claim NH can check agrees with the files received.",
    whyTheBeneficiaryCannotAlterIt:
      "THEY LARGELY CAN, which is why this channel reaches SOURCE_ATTESTED and never AUTHORITY_VERIFIED. The declaration and the files arrive together from the same party, so a matching row count shows the two are consistent and establishes NOTHING about completeness — an export with rows removed and a number adjusted to match reads as a perfect agreement. What survives is narrower: an accountable role exists at all, and the two files are mutually consistent in ways the declaration does not control, because the attestation never states the payer overlap or the obligation join and NH derives both independently.",
    implemented: true,
    reaches: "SOURCE_ATTESTED" as const,
    submitterStillControls: Object.freeze([
      "the declaration itself, which they write",
      "the exported files, which they may alter before sending",
      "whether rows were removed before export — nothing here can see it",
    ]),
  }),
  Object.freeze({
    channel: "SIGNED_EXPORT" as const,
    whatItWouldEstablish: "That these bytes left the named source system unaltered.",
    whyTheBeneficiaryCannotAlterIt:
      "The signature is made by the source system's key, which the party assembling the submission does not hold. Editing a row invalidates it.",
    implemented: false,
    reaches: "AUTHORITY_VERIFIED" as const,
    submitterStillControls: Object.freeze([]),
  }),
  Object.freeze({
    channel: "SYSTEM_OF_RECORD_ATTESTATION" as const,
    // NOT the same channel as DATA_OWNER_ATTESTATION, and kept separate on purpose: here the SYSTEM
    // asserts it, machine-issued, which is why this one can reach AUTHORITY_VERIFIED and a person's
    // declaration about the system cannot. Collapsing them would let the weaker one wear the stronger
    // one's guarantee.
    whatItWouldEstablish: "That the system of record ITSELF asserts this extract is its own complete statement for the period.",
    whyTheBeneficiaryCannotAlterIt:
      "The SYSTEM issues the attestation, so the submitter never holds it: it names the period and the row count in a form they cannot rewrite, and a later trim is therefore detectable — the pre-registration shape the admission bar uses. This is exactly the sentence DATA_OWNER_ATTESTATION may NOT borrow. There, the submitter writes the declaration and holds the file, so the same words would be false. The committed artefact must pass beyond the committer's reach for pre-registration to mean anything, and only this channel does that.",
    implemented: false,
    reaches: "AUTHORITY_VERIFIED" as const,
    submitterStillControls: Object.freeze([]),
  }),
  Object.freeze({
    channel: "NH_PERFORMED_FETCH" as const,
    whatItWouldEstablish: "That NH read the facts from the source system itself rather than receiving a file.",
    whyTheBeneficiaryCannotAlterIt: "There is no intermediate step in which a row can be changed.",
    implemented: false,
    reaches: "AUTHORITY_VERIFIED" as const,
    submitterStillControls: Object.freeze([]),
  }),
  Object.freeze({
    channel: "THIRD_PARTY_RECONCILIATION" as const,
    whatItWouldEstablish: "That a settled amount agrees with an independent record such as a payment processor or bank.",
    whyTheBeneficiaryCannotAlterIt: "The third party is not party to the recovery claim.",
    implemented: false,
    reaches: "AUTHORITY_VERIFIED" as const,
    submitterStillControls: Object.freeze([]),
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
  /** True only if some channel that REACHES AUTHORITY_VERIFIED evidenced it. Nothing can set this yet. */
  readonly provenanceEstablished?: boolean;
  /**
   * The corroboration NH COMPUTED from the files, never a flag a caller set. The whole defence against
   * self-vouching is this asymmetry: the caller supplies a DECLARATION, and the layer above derives this
   * object from the declaration and the data before calling here.
   */
  readonly attestation?: AttestationCorroboration;
}): AuthorityAssessment {
  /** Channels that could raise whatever rung we end up reporting. */
  const toVerified = Object.freeze(
    PROVENANCE_CHANNELS.filter((c) => c.reaches === "AUTHORITY_VERIFIED").map((c) => c.channel),
  );
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
  // AN ATTESTATION THAT CONTRADICTS THE FILES IS WORSE THAN NO ATTESTATION, so it does not merely fail to
  // lift the rung: the contradiction is named in the ceiling reason. Silently falling back to
  // SOURCE_NATIVE would discard the most interesting thing NH learned.
  if (input.attestation !== undefined) {
    if (input.attestation.allRungBearingClaimsPassed) {
      return Object.freeze({
        reached: "SOURCE_ATTESTED",
        ceilingReason:
          `the data-owning role ${input.attestation.dataOwnerRole} is on record declaring each export's origin, method, window and row count, and every claim NH can check agrees with the files received. Authority is still UNVERIFIED and every level resting on it is PROVISIONAL. The declaration and the files came together from the same party, so this establishes an accountable declarant and internal consistency — NOT that either export is the complete, untrimmed output of the system named.`,
        wouldBeLiftedBy: toVerified,
      });
    }
    return Object.freeze({
      reached: "SOURCE_NATIVE",
      ceilingReason: input.attestation.contradictions.length > 0
        ? `an attestation accompanied the submission and CONTRADICTS the files on: ${input.attestation.contradictions.join(", ")}. That is worse than no attestation, and no implemented provenance channel evidences these bytes — authority is UNVERIFIED and every level resting on it is PROVISIONAL.`
        : `an attestation accompanied the submission but a claim NH must check could not be checked, so it fails closed. No implemented provenance channel evidences these bytes — authority is UNVERIFIED and every level resting on it is PROVISIONAL.`,
      wouldBeLiftedBy: lifted,
    });
  }
  return Object.freeze({
    reached: "SOURCE_NATIVE",
    ceilingReason:
      "no attestation accompanied the submission and no implemented provenance channel evidences these bytes. The file is the source system's own shape and values as far as NH can check, and NOTHING establishes that it left that system unaltered — so authority is UNVERIFIED and every level resting on it is PROVISIONAL.",
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
