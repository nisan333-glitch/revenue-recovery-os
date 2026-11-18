// K5 · IS THE COUNTERPARTY ACTUALLY A BANK? THE ONE QUESTION A SIGNATURE CANNOT ANSWER.
//
// WHAT THIS IS. The governed life of an INSTITUTION — not of a key. G1 governs keys: proposed,
// activated, retired, revoked, with a witness and an append-only log. That machinery establishes that a
// particular key was in force when it signed, and `settlementVerification` establishes that the
// signature is genuine. Neither establishes WHOSE key it is.
//
//   ANYONE CAN GENERATE AN Ed25519 PAIR AND SIGN ANYTHING THEY LIKE. A perfect signature chain over a
//   perfectly governed key proves CONTROL OF THAT KEY and nothing whatever about the identity of the
//   party controlling it. A pilot that read a green signature as "the bank confirmed this" would be
//   making the single largest unearned inference available in this system.
//
// WHY IT MATTERS HERE AND NOT ONLY IN PRINCIPLE. `sourceFactAuthority.ts` declares
// `THIRD_PARTY_RECONCILIATION` as a channel that reaches `AUTHORITY_VERIFIED`, and its defining
// property is that *"the third party is not party to the recovery claim"*. The settlement chain
// (G1-G10) is the mechanism that channel needs — but the property is a statement about WHO signed, so
// the channel cannot be declared implemented on the strength of the mechanism alone. This module is
// the missing half, and it is deliberately built so that:
//
//   THE CRYPTOGRAPHIC CONDITIONS CAN ALL BE SATISFIED AND THE INSTITUTION IS STILL NOT VERIFIED.
//
// That is not a policy expressed in prose. `CRYPTOGRAPHIC_CONDITIONS` is a named subset of the
// required set, the subset is a strict one, and `signatureAloneLeavesRefusals()` derives the proof from
// the two arrays rather than asserting it — so the day someone promotes a cryptographic condition into
// a sufficient one, the derivation changes and its test fails.
//
// NO IMPORTS. The decision is re-derivable from its inputs, like `settlementKeyLifecycle` and
// `leakInstanceIdentity`, so it cannot be wrong in a way that depends on ambient state.

/** Version of this institution-authority semantic. A change in meaning is a NEW id. */
export const INSTITUTION_AUTHORITY_VERSION = "inst-2026.1";

// ── The conditions ───────────────────────────────────────────────────────────────────────────────

/**
 * Every condition an institution must satisfy before its attestations may carry authority.
 *
 * SEPARATE BOOLEANS, NEVER ONE `verified` FLAG, for the reason K5 already established: a single flag
 * hides WHICH half is missing, and the half that is usually missing is the one a signature cannot
 * supply. Each is named for what it establishes, not for the artefact that evidences it.
 */
export interface InstitutionAuthorityEvidence {
  /** C1 · the legal entity exists and is who it claims, per a registry or regulator. */
  readonly legalEntityVerifiedIndependently: boolean;
  /** C2 · the entity is licensed or authorised to hold and settle client money. */
  readonly regulatoryStandingVerified: boolean;
  /** C3 · the individuals or systems empowered to sign for it are named by the institution itself. */
  readonly authorisedSignatoriesEstablished: boolean;
  /** C4 · the channel the key arrived through is the institution's own, found independently. */
  readonly channelIndependentlyVerified: boolean;
  /** C5 · challenge-response over a nonce NH chose. Control of a key, and nothing more. */
  readonly keyControlDemonstrated: boolean;
  /** C6 · the key's fingerprint was read back through the institution's own channel and confirmed. */
  readonly keyFingerprintConfirmedOutOfBand: boolean;
  /** C7 · the ceremony is recorded: channel, who confirmed, fingerprint, window, receipts, dates. */
  readonly ceremonyRecorded: boolean;
  /** C8 · a second authorised NH identity reviewed and approved the admission. */
  readonly secondPersonApproval: boolean;
}

export type InstitutionAuthorityCondition = keyof InstitutionAuthorityEvidence;

/** Every condition, in ceremony order. The ORDER is reported; the SET is what gates. */
export const INSTITUTION_AUTHORITY_CONDITIONS: readonly InstitutionAuthorityCondition[] =
  Object.freeze([
    "legalEntityVerifiedIndependently",
    "regulatoryStandingVerified",
    "authorisedSignatoriesEstablished",
    "channelIndependentlyVerified",
    "keyControlDemonstrated",
    "keyFingerprintConfirmedOutOfBand",
    "ceremonyRecorded",
    "secondPersonApproval",
  ]);

/**
 * The conditions a CRYPTOGRAPHIC operation can satisfy on its own.
 *
 * EXACTLY ONE, and that is the whole point of naming the subset. A challenge-response proves the
 * responder holds a private key. It cannot tell you the responder is a bank, that the bank is licensed,
 * that this person may sign for it, that the channel was the institution's own, or that anybody at NH
 * reviewed the admission. `keyFingerprintConfirmedOutOfBand` is deliberately NOT here: confirming a
 * fingerprint requires a second channel, and a second channel is not a cryptographic operation.
 */
export const CRYPTOGRAPHIC_CONDITIONS: readonly InstitutionAuthorityCondition[] =
  Object.freeze(["keyControlDemonstrated"]);

export type InstitutionAuthorityRefusal =
  | "INSTITUTION_LEGAL_ENTITY_NOT_VERIFIED"
  | "INSTITUTION_REGULATORY_STANDING_NOT_VERIFIED"
  | "INSTITUTION_SIGNATORIES_NOT_ESTABLISHED"
  | "INSTITUTION_CHANNEL_NOT_AUTHORITATIVE"
  | "INSTITUTION_KEY_CONTROL_NOT_DEMONSTRATED"
  | "INSTITUTION_FINGERPRINT_NOT_CONFIRMED"
  | "INSTITUTION_CEREMONY_RECORD_MISSING"
  | "INSTITUTION_SECOND_PERSON_APPROVAL_MISSING";

const REFUSAL_FOR: Readonly<Record<InstitutionAuthorityCondition, InstitutionAuthorityRefusal>> =
  Object.freeze({
    legalEntityVerifiedIndependently: "INSTITUTION_LEGAL_ENTITY_NOT_VERIFIED",
    regulatoryStandingVerified: "INSTITUTION_REGULATORY_STANDING_NOT_VERIFIED",
    authorisedSignatoriesEstablished: "INSTITUTION_SIGNATORIES_NOT_ESTABLISHED",
    channelIndependentlyVerified: "INSTITUTION_CHANNEL_NOT_AUTHORITATIVE",
    keyControlDemonstrated: "INSTITUTION_KEY_CONTROL_NOT_DEMONSTRATED",
    keyFingerprintConfirmedOutOfBand: "INSTITUTION_FINGERPRINT_NOT_CONFIRMED",
    ceremonyRecorded: "INSTITUTION_CEREMONY_RECORD_MISSING",
    secondPersonApproval: "INSTITUTION_SECOND_PERSON_APPROVAL_MISSING",
  });

/**
 * EVERY unmet condition, in ceremony order. Empty means the admission bar is met.
 *
 * ALL OF THEM, NEVER THE FIRST. An admission blocked on three grounds must say so, or closing one would
 * look like closing three — the same reason `keyRegistrationRefusals` returns a list.
 */
export function institutionAuthorityRefusals(
  evidence: InstitutionAuthorityEvidence,
): readonly InstitutionAuthorityRefusal[] {
  return Object.freeze(
    INSTITUTION_AUTHORITY_CONDITIONS.filter((c) => !evidence[c]).map((c) => REFUSAL_FOR[c]),
  );
}

/** Fail-closed: anything short of every condition is no. */
export function institutionMayBeVerified(evidence: InstitutionAuthorityEvidence): boolean {
  return institutionAuthorityRefusals(evidence).length === 0;
}

/** An evidence set in which ONLY the cryptographic conditions hold. Derived, never hand-written. */
export function cryptographicEvidenceOnly(): InstitutionAuthorityEvidence {
  const out = {} as Record<InstitutionAuthorityCondition, boolean>;
  for (const c of INSTITUTION_AUTHORITY_CONDITIONS) out[c] = CRYPTOGRAPHIC_CONDITIONS.includes(c);
  return Object.freeze(out) as InstitutionAuthorityEvidence;
}

/**
 * THE STRUCTURAL GUARANTEE: satisfying every cryptographic condition leaves refusals outstanding.
 *
 * DERIVED FROM THE TWO ARRAYS, not asserted beside them. If a future change promoted the cryptographic
 * subset to cover the required set — by adding a condition to `CRYPTOGRAPHIC_CONDITIONS`, or by
 * removing the non-cryptographic ones — this returns an empty list and its test fails. That is the
 * mechanism; the sentence below is only its explanation.
 *
 *   A DIGITAL SIGNATURE CANNOT VERIFY AN INSTITUTION. It establishes control of a key. Who holds that
 *   key is a question about the world, answered by a registry, a regulator, a published channel and two
 *   people at NH — none of which is a cryptographic operation.
 */
export function signatureAloneLeavesRefusals(): readonly InstitutionAuthorityRefusal[] {
  return institutionAuthorityRefusals(cryptographicEvidenceOnly());
}

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────
//
// FOUR STATES, and `WITHDRAWN` and `REVOKED_IDENTITY_DOUBTED` never collapse into one "inactive". An
// institution whose relationship simply ended raises no question about what it attested; one whose
// IDENTITY turned out to be in doubt raises one about everything it ever signed. Those are different
// facts, and a single state would hide which — the same reason `RETIRED` and `REVOKED_COMPROMISED` are
// separate on a key.

export type InstitutionAuthorityState =
  | "PROPOSED"
  | "VERIFIED"
  | "WITHDRAWN"
  | "REVOKED_IDENTITY_DOUBTED";

export const INSTITUTION_AUTHORITY_STATES: readonly InstitutionAuthorityState[] =
  Object.freeze(["PROPOSED", "VERIFIED", "WITHDRAWN", "REVOKED_IDENTITY_DOUBTED"]);

export type InstitutionAuthorityTransition =
  | "PROPOSE"
  | "VERIFY"
  | "WITHDRAW"
  | "REVOKE_IDENTITY_DOUBTED";

/** State a transition may be applied from. Anything unlisted is refused. */
const LEGAL_FROM: Readonly<Record<InstitutionAuthorityTransition, readonly InstitutionAuthorityState[]>> =
  Object.freeze({
    PROPOSE: Object.freeze([] as InstitutionAuthorityState[]), // birth only
    VERIFY: Object.freeze(["PROPOSED"] as InstitutionAuthorityState[]), // once; there is no re-verify
    WITHDRAW: Object.freeze(["PROPOSED", "VERIFIED"] as InstitutionAuthorityState[]),
    // GOVERNANCE MAY ALWAYS STILL WITHDRAW AUTHORITY. An institution already withdrawn can later be
    // found to have been impersonated, and refusing that transition would leave governance unable to
    // state what it just learned.
    REVOKE_IDENTITY_DOUBTED: Object.freeze(
      ["PROPOSED", "VERIFIED", "WITHDRAWN"] as InstitutionAuthorityState[],
    ),
  });

const RESULTING: Readonly<Record<InstitutionAuthorityTransition, InstitutionAuthorityState>> =
  Object.freeze({
    PROPOSE: "PROPOSED",
    VERIFY: "VERIFIED",
    WITHDRAW: "WITHDRAWN",
    REVOKE_IDENTITY_DOUBTED: "REVOKED_IDENTITY_DOUBTED",
  });

export interface InstitutionAuthorityEvent {
  readonly transition: InstitutionAuthorityTransition;
  readonly actorId: string;
  readonly actorRole: string;
  /** Why. Required on every transition — a governance decision with no stated reason is not one. */
  readonly rationale: string;
  readonly at: string;
}

export type InstitutionLifecycleProblem =
  | "INSTITUTION_NEVER_PROPOSED"
  | "INSTITUTION_PROPOSED_TWICE"
  | "INSTITUTION_ILLEGAL_TRANSITION"
  | "INSTITUTION_LOG_OUT_OF_ORDER"
  | "INSTITUTION_EVENT_TIME_MALFORMED";

export type InstitutionStateVerdict =
  | { readonly ok: true; readonly state: InstitutionAuthorityState | null }
  | { readonly ok: false; readonly problem: InstitutionLifecycleProblem; readonly detail: string };

/**
 * The institution's state as of `instant`, from the append-ordered log.
 *
 * THE ARRAY ORDER IS THE APPEND ORDER. This does not sort by `at`: a timestamp is `timestamp(3)` and
 * ties are real, so sorting by it would be total and not chronological — the defect the execution-event
 * log already had. An out-of-order log is REFUSED rather than silently repaired.
 *
 * TWO WALKS, ONE LOOP, as `stateAt` learned the hard way: legality is a property of the LOG and must be
 * judged against every event; the derived state is a property of the QUESTION and advances only while
 * the event precedes the instant asked about.
 */
export function institutionStateAt(
  events: readonly InstitutionAuthorityEvent[],
  instant: string,
): InstitutionStateVerdict {
  if (events.length === 0) {
    return Object.freeze({
      ok: false as const,
      problem: "INSTITUTION_NEVER_PROPOSED" as const,
      detail: "this institution has no governance events at all, so it has never been proposed",
    });
  }
  const target = Date.parse(instant);
  if (!Number.isFinite(target)) {
    return Object.freeze({
      ok: false as const,
      problem: "INSTITUTION_EVENT_TIME_MALFORMED" as const,
      detail: "the instant asked about is not a parseable date",
    });
  }
  if (events[0]!.transition !== "PROPOSE") {
    return Object.freeze({
      ok: false as const,
      problem: "INSTITUTION_ILLEGAL_TRANSITION" as const,
      detail: "the first event is not PROPOSE, so the log does not begin with a birth",
    });
  }

  let walk: InstitutionAuthorityState | null = null;
  let asOf: InstitutionAuthorityState | null = null;
  let previous = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) {
      return Object.freeze({
        ok: false as const,
        problem: "INSTITUTION_EVENT_TIME_MALFORMED" as const,
        detail: `event ${index} has an unparseable timestamp`,
      });
    }
    if (at < previous) {
      return Object.freeze({
        ok: false as const,
        problem: "INSTITUTION_LOG_OUT_OF_ORDER" as const,
        detail: `event ${index} is earlier than the event before it; the log's order cannot be trusted`,
      });
    }
    previous = at;
    if (event.transition === "PROPOSE" && index > 0) {
      return Object.freeze({
        ok: false as const,
        problem: "INSTITUTION_PROPOSED_TWICE" as const,
        detail: "a second PROPOSE appears; an institution is admitted once and a change is a new record",
      });
    }
    if (index > 0 && !LEGAL_FROM[event.transition].includes(walk as InstitutionAuthorityState)) {
      return Object.freeze({
        ok: false as const,
        problem: "INSTITUTION_ILLEGAL_TRANSITION" as const,
        detail: `${event.transition} may not be applied from ${String(walk)}`,
      });
    }
    walk = RESULTING[event.transition];
    if (at <= target) asOf = RESULTING[event.transition];
  }
  return Object.freeze({ ok: true as const, state: asOf });
}

// ── What authority an institution's attestation can carry ────────────────────────────────────────

/**
 * The highest authority rung an attestation from this institution may support.
 *
 * `AUTHORITY_VERIFIED` ONLY FROM A `VERIFIED` INSTITUTION, and `VERIFIED` is only reachable through
 * `institutionMayBeVerified`, which `signatureAloneLeavesRefusals` proves a signature cannot satisfy.
 * That is the chain requirement 5 asks for, expressed as types and derivations rather than as a rule
 * someone has to remember.
 *
 * The return type is deliberately the string literals rather than an import from
 * `sourceFactAuthority`: this module has no imports, so the ladder cannot change what this decides
 * without a visible edit here.
 */
export type InstitutionAuthorityCeiling =
  | "AUTHORITY_VERIFIED"
  /** The institution is on record but not verified; its attestations carry no authority. */
  | "AUTHORITY_UNVERIFIED";

export interface InstitutionCeilingVerdict {
  readonly ceiling: InstitutionAuthorityCeiling;
  readonly state: InstitutionAuthorityState | null;
  /** Why it stops where it stops. Always populated, including at the top rung. */
  readonly detail: string;
}

export function institutionAuthorityCeiling(
  events: readonly InstitutionAuthorityEvent[],
  instant: string,
): InstitutionCeilingVerdict {
  const derived = institutionStateAt(events, instant);
  if (!derived.ok) {
    return Object.freeze({
      ceiling: "AUTHORITY_UNVERIFIED" as const,
      state: null,
      detail: `${derived.problem}: ${derived.detail}`,
    });
  }
  if (derived.state === "VERIFIED") {
    return Object.freeze({
      ceiling: "AUTHORITY_VERIFIED" as const,
      state: derived.state,
      detail:
        "the institution was independently verified — legal entity, regulatory standing, authorised " +
        "signatories, channel, key control, out-of-band fingerprint, ceremony record and a second " +
        "person — and that verification was in force at this instant",
    });
  }
  return Object.freeze({
    ceiling: "AUTHORITY_UNVERIFIED" as const,
    state: derived.state,
    detail:
      derived.state === null
        ? "the institution did not exist on this record at that instant"
        : `the institution's state was ${derived.state}, not VERIFIED, so its attestations carry no ` +
          "authority: a signature establishes control of a key and never the identity of its holder",
  });
}
