// G1 · THE PURE SETTLEMENT-KEY LIFECYCLE.
//
// WHAT THIS IS. The governed life of ONE external signing key — a bank's or a PSP's — expressed as a
// state derived from an append-only event log, plus the two questions a verifier must ask of it:
//
//   1. WAS THIS KEY VALID AT THE INSTANT THE ATTESTATION WAS SIGNED?  `validAt(issuedAt)`
//   2. IS A PROOF THAT RESTS ON IT INSIDE A COMPROMISE WINDOW?       `compromiseAssessment(...)`
//
// WHAT THIS IS NOT. It is not a store, not a route, not a verifier and not wired to anything. G1 is
// the pure half on purpose: every later slice depends on it, and it cannot be wrong in a way that
// touches the product. There are NO IMPORTS AT ALL, exactly as `leakInstanceIdentity.ts` has none, so
// the decision is re-derivable from its inputs with no ambient state and no clock of its own.
//
// WHY `validAt(issuedAt)` AND NEVER "IS IT VALID NOW". A proof is immutable and reproducible FOREVER
// (Trust Invariant rule 5). If verification asked whether the key is valid *now*, re-verifying a frozen
// proof after the key expired would answer differently from the day it was approved, and the historical
// proof would stop reproducing. So the question is always about the signing instant, and a key retired
// on schedule still verifies what it signed while it was in force — which is also what rotation needs.

/** Version of this lifecycle's semantics. A change in meaning is a NEW id, never a silent re-grade. */
export const SETTLEMENT_KEY_LIFECYCLE_VERSION = "skl-2026.1";

// ── States ───────────────────────────────────────────────────────────────────────────────────────
//
// FOUR STATES, AND `RETIRED` / `REVOKED_COMPROMISED` MUST NEVER COLLAPSE INTO ONE "INACTIVE".
// A key retired on schedule raises NO question about its past attestations. A key revoked AS
// COMPROMISED raises one about every attestation it ever signed. Those are different facts, and a
// single inactive state would hide which — the same reason `leakInstanceIdentityStatus` and
// `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart.
//
// THERE IS DELIBERATELY NO `FROZEN`. The admission-policy lifecycle has one because a bar can be paused
// and resumed; a signing key cannot be meaningfully paused — either an attestation signed at an instant
// is acceptable or it is not, and a pause would make that answer depend on when the question was asked.

export type SettlementKeyState = "DRAFT" | "ACTIVE" | "RETIRED" | "REVOKED_COMPROMISED";

export const SETTLEMENT_KEY_STATES: readonly SettlementKeyState[] =
  Object.freeze(["DRAFT", "ACTIVE", "RETIRED", "REVOKED_COMPROMISED"]);

export type SettlementKeyTransition = "PROPOSED" | "ACTIVATED" | "RETIRED" | "REVOKED_COMPROMISED";

export const SETTLEMENT_KEY_TRANSITIONS: readonly SettlementKeyTransition[] =
  Object.freeze(["PROPOSED", "ACTIVATED", "RETIRED", "REVOKED_COMPROMISED"]);

/** State a transition may be applied from. Anything not listed is refused. */
const LEGAL_FROM: Readonly<Record<SettlementKeyTransition, readonly SettlementKeyState[]>> = Object.freeze({
  PROPOSED: Object.freeze([] as SettlementKeyState[]), // birth: valid only when no prior event exists
  ACTIVATED: Object.freeze(["DRAFT"] as SettlementKeyState[]), // once; there is no resume
  RETIRED: Object.freeze(["DRAFT", "ACTIVE"] as SettlementKeyState[]),
  // GOVERNANCE MAY ALWAYS STILL WITHDRAW. A key already retired can later be found to have been
  // compromised, and refusing that transition would leave governance unable to state what it just
  // learned — the same reason the admission-policy register still permits FROZEN and RETIRED after a
  // witness failure.
  REVOKED_COMPROMISED: Object.freeze(["DRAFT", "ACTIVE", "RETIRED"] as SettlementKeyState[]),
});

const RESULTING_STATE: Readonly<Record<SettlementKeyTransition, SettlementKeyState>> = Object.freeze({
  PROPOSED: "DRAFT",
  ACTIVATED: "ACTIVE",
  RETIRED: "RETIRED",
  REVOKED_COMPROMISED: "REVOKED_COMPROMISED",
});

/** One append-only lifecycle event. */
export interface SettlementKeyEvent {
  readonly transition: SettlementKeyTransition;
  readonly actorId: string;
  readonly actorRole: string;
  /** Why. Required on every transition — a governance decision with no stated reason is not one. */
  readonly rationale: string;
  readonly at: string;
  /**
   * On `REVOKED_COMPROMISED` only: the earliest instant the key may have been in the wrong hands.
   *
   * `null` means UNKNOWN, and that is a materially different claim from "the exposure began when we
   * declared it". See `compromiseAssessment`.
   */
  readonly exposureFrom?: string | null;
}

// ── The key's immutable facts ────────────────────────────────────────────────────────────────────

export interface SettlementKeyFacts {
  readonly keyId: string;
  /** Tenant scope. A key is registered for ONE boundary. */
  readonly boundaryId: string;
  readonly sourceSystem: string;
  /** `bank` or `psp`; the registry binds it so a key cannot assert what its kind could not know. */
  readonly sourceKind: string;
  /** Ed25519 SPKI PEM. A PUBLIC key — it needs integrity and provenance, never secrecy. */
  readonly publicKey: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

// ── K5 · the registration evidence, kept DISTINGUISHABLE ─────────────────────────────────────────
//
// THE OWNER'S CORRECTION, 2026-11-15, MADE STRUCTURAL: do not assume a challenge-response alone proves
// the institution's identity. It does not, and the reason is simple enough that a single "verified"
// flag would hide it:
//
//   A CHALLENGE-RESPONSE PROVES CONTROL OF A KEY. IT PROVES NOTHING ABOUT WHO HOLDS IT.
//
// Anyone can generate an Ed25519 pair and answer a nonce challenge perfectly. So `keyControlDemonstrated`
// may NEVER substitute for `institutionIdentityVerified`, and the four conditions below are four
// separate required booleans rather than one. An earlier draft of the plan called the challenge-response
// "the only step that makes the rest more than a form", which overstated it: it is the only
// CRYPTOGRAPHIC step, and the identity check is the one that says whose key it is.

export interface KeyRegistrationEvidence {
  /** C1 · the key arrived through a channel the institution controls and publishes. */
  readonly channelIndependentlyVerified: boolean;
  /** C2 · the institution's identity, established independently of whoever supplied the key. */
  readonly institutionIdentityVerified: boolean;
  /** C3 · challenge-response over a nonce NH chose. Control of the key, and nothing more. */
  readonly keyControlDemonstrated: boolean;
  /** C4 · the ceremony is recorded: channel, who confirmed, fingerprint, window, receipt. */
  readonly ceremonyRecorded: boolean;
}

export type KeyRegistrationRefusal =
  | "KEY_CHANNEL_NOT_AUTHORITATIVE"
  | "KEY_INSTITUTION_NOT_VERIFIED"
  | "KEY_OWNERSHIP_NOT_DEMONSTRATED"
  | "KEY_CEREMONY_RECORD_MISSING";

/**
 * Every unmet registration condition, in ceremony order. Empty means the ceremony is complete.
 *
 * ALL FOUR, NEVER A SUBSET. Returning the full list rather than the first failure is deliberate: a
 * registration blocked on two grounds should say so, or closing one would look like closing both.
 */
export function keyRegistrationRefusals(
  evidence: KeyRegistrationEvidence,
): readonly KeyRegistrationRefusal[] {
  const refusals: KeyRegistrationRefusal[] = [];
  if (!evidence.channelIndependentlyVerified) refusals.push("KEY_CHANNEL_NOT_AUTHORITATIVE");
  if (!evidence.institutionIdentityVerified) refusals.push("KEY_INSTITUTION_NOT_VERIFIED");
  if (!evidence.keyControlDemonstrated) refusals.push("KEY_OWNERSHIP_NOT_DEMONSTRATED");
  if (!evidence.ceremonyRecorded) refusals.push("KEY_CEREMONY_RECORD_MISSING");
  return Object.freeze(refusals);
}

/** May this key be activated at all? Fail-closed: anything short of all four conditions is no. */
export function keyMayBeActivated(evidence: KeyRegistrationEvidence): boolean {
  return keyRegistrationRefusals(evidence).length === 0;
}

// ── Deriving the state AS OF an instant ──────────────────────────────────────────────────────────

export type LifecycleProblem =
  /** The log is empty: the key has never been proposed. Not "assume the best". */
  | "KEY_NEVER_PROPOSED"
  /** A `PROPOSED` event appears after the first event. A key is born once. */
  | "KEY_PROPOSED_TWICE"
  /** A transition was applied from a state it may not be applied from. */
  | "KEY_ILLEGAL_TRANSITION"
  /** The log is not in non-decreasing time order, so its order cannot be trusted. */
  | "KEY_LOG_OUT_OF_ORDER"
  /** An event timestamp is not a parseable instant. */
  | "KEY_EVENT_TIME_MALFORMED";

export type StateAtVerdict =
  | { readonly ok: true; readonly state: SettlementKeyState | null }
  | { readonly ok: false; readonly problem: LifecycleProblem; readonly detail: string };

/**
 * The state as of `instant`, from the append-ordered log.
 *
 * THE ARRAY ORDER IS THE APPEND ORDER AND IS AUTHORITATIVE. This module does NOT sort by `at`: a
 * timestamp is `timestamp(3)` in the database and ties are real, so sorting by it would be total and
 * not chronological — the defect the execution-event log already had. Instead the log is CHECKED for
 * non-decreasing time and an out-of-order log is REFUSED rather than silently repaired, because
 * repairing it would invent a chronology nothing recorded.
 *
 * `null` means the key did not exist yet at that instant. A caller treats it exactly as DRAFT for the
 * purpose of verifying — which is to say, it verifies nothing.
 */
export function stateAt(events: readonly SettlementKeyEvent[], instant: string): StateAtVerdict {
  if (events.length === 0) {
    return Object.freeze({
      ok: false as const,
      problem: "KEY_NEVER_PROPOSED" as const,
      detail: "the key has no lifecycle events at all, so it has never been proposed",
    });
  }
  const target = Date.parse(instant);
  if (!Number.isFinite(target)) {
    return Object.freeze({
      ok: false as const,
      problem: "KEY_EVENT_TIME_MALFORMED" as const,
      detail: "the instant asked about is not a parseable date",
    });
  }
  if (events[0]!.transition !== "PROPOSED") {
    return Object.freeze({
      ok: false as const,
      problem: "KEY_ILLEGAL_TRANSITION" as const,
      detail: "the first lifecycle event is not PROPOSED, so the log does not begin with a birth",
    });
  }

  // TWO WALKS, ONE LOOP, AND THEY MUST NOT SHARE A VARIABLE.
  //
  // `walkState` advances on EVERY event and is what legality is judged against; `asOf` advances only
  // while the event precedes the instant asked about. The first draft of this function used one
  // variable for both, so asking about an instant BEFORE activation left the state at `null` when
  // ACTIVATED was reached and the legality check wrongly reported KEY_ILLEGAL_TRANSITION on a
  // perfectly well-formed log. My own negative control caught it: "reads null before the key existed".
  // Legality is a property of the LOG; the derived state is a property of the QUESTION.
  let walkState: SettlementKeyState | null = null;
  let asOf: SettlementKeyState | null = null;
  let previous = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) {
      return Object.freeze({
        ok: false as const,
        problem: "KEY_EVENT_TIME_MALFORMED" as const,
        detail: `lifecycle event ${index} has an unparseable timestamp`,
      });
    }
    if (at < previous) {
      return Object.freeze({
        ok: false as const,
        problem: "KEY_LOG_OUT_OF_ORDER" as const,
        detail: `lifecycle event ${index} is earlier than the event before it; the log's order cannot be trusted`,
      });
    }
    previous = at;
    if (event.transition === "PROPOSED" && index > 0) {
      return Object.freeze({
        ok: false as const,
        problem: "KEY_PROPOSED_TWICE" as const,
        detail: "a second PROPOSED event appears; a key is born once and a change is a new key",
      });
    }
    if (index > 0 && !LEGAL_FROM[event.transition].includes(walkState as SettlementKeyState)) {
      return Object.freeze({
        ok: false as const,
        problem: "KEY_ILLEGAL_TRANSITION" as const,
        detail: `${event.transition} may not be applied from ${String(walkState)}`,
      });
    }
    walkState = RESULTING_STATE[event.transition];
    // THE WHOLE LOG IS VALIDATED, not only the part before `instant`. A log that becomes illegal later
    // is a broken log now, and answering from its earlier prefix would report a state derived from a
    // record we have just established cannot be trusted.
    if (at <= target) asOf = RESULTING_STATE[event.transition];
  }
  return Object.freeze({ ok: true as const, state: asOf });
}

// ── validAt ──────────────────────────────────────────────────────────────────────────────────────

export type KeyValidityRefusal =
  | "SETTLEMENT_KEY_NOT_YET_ACTIVE"
  | "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING"
  | "SETTLEMENT_KEY_EXPIRED"
  | "SETTLEMENT_KEY_BEFORE_VALID_FROM"
  | "SETTLEMENT_KEY_WINDOW_MALFORMED";

export type KeyValidityVerdict =
  | { readonly valid: true; readonly stateAtSigning: "ACTIVE" }
  | {
      readonly valid: false;
      readonly code: KeyValidityRefusal | LifecycleProblem;
      readonly detail: string;
    };

const invalid = (
  code: KeyValidityRefusal | LifecycleProblem,
  detail: string,
): KeyValidityVerdict => Object.freeze({ valid: false as const, code, detail });

/**
 * Was this key valid at the instant the attestation was signed?
 *
 * TWO INDEPENDENT CONDITIONS, BOTH REQUIRED, AND KEPT SEPARATE SO THE REFUSAL SAYS WHICH ONE FAILED:
 * the key's STATE at `issuedAt` was ACTIVE, and `issuedAt` falls inside the declared
 * [validFrom, validUntil] window. A key can be ACTIVE and outside its window — an institution's
 * stated validity period is not the same fact as our governance having activated it — and reporting
 * one problem when the other is the cause sends an operator to the wrong place.
 *
 * `SETTLEMENT_KEY_EXPIRED` IS DISTINCT FROM NOT BEING REGISTERED, on purpose: an operator must be able
 * to tell *we do not know this key* from *we knew it and its window has closed*.
 */
export function validAt(
  facts: SettlementKeyFacts,
  events: readonly SettlementKeyEvent[],
  issuedAt: string,
): KeyValidityVerdict {
  const from = Date.parse(facts.validFrom);
  const until = Date.parse(facts.validUntil);
  const signed = Date.parse(issuedAt);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) {
    return invalid(
      "SETTLEMENT_KEY_WINDOW_MALFORMED",
      "the key's validity window is not two ordered, parseable instants",
    );
  }
  if (!Number.isFinite(signed)) {
    return invalid("SETTLEMENT_KEY_WINDOW_MALFORMED", "the signing instant is not a parseable date");
  }

  const derived = stateAt(events, issuedAt);
  if (!derived.ok) return invalid(derived.problem, derived.detail);
  if (derived.state === null) {
    return invalid(
      "SETTLEMENT_KEY_NOT_YET_ACTIVE",
      "the key did not exist at the signing instant: no lifecycle event precedes it",
    );
  }
  if (derived.state !== "ACTIVE") {
    return invalid(
      "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING",
      `the key's state at the signing instant was ${derived.state}, not ACTIVE`,
    );
  }
  if (signed < from) {
    return invalid(
      "SETTLEMENT_KEY_BEFORE_VALID_FROM",
      "the attestation was signed before the key's declared validity window opened",
    );
  }
  if (signed > until) {
    return invalid(
      "SETTLEMENT_KEY_EXPIRED",
      "the attestation was signed after the key's declared validity window closed",
    );
  }
  return Object.freeze({ valid: true as const, stateAtSigning: "ACTIVE" as const });
}

// ── Retroactive compromise ───────────────────────────────────────────────────────────────────────

export type CompromiseStatus =
  /** The key was never revoked as compromised. */
  | "NOT_APPLICABLE"
  /** Revoked as compromised, and this attestation was signed before the exposure window opened. */
  | "UNAFFECTED"
  /** Revoked as compromised, and this attestation falls inside the exposure window. */
  | "FLAGGED_COMPROMISED_WINDOW";

export interface CompromiseAssessment {
  readonly status: CompromiseStatus;
  /** The exposure start the assessment used, or null when it is UNKNOWN. */
  readonly exposureFrom: string | null;
  /** True when the status rests on an UNKNOWN exposure start — the whole lifetime being the window. */
  readonly exposureStartUnknown: boolean;
  readonly detail: string;
}

/**
 * Is a proof resting on this attestation inside a compromise window?
 *
 * A FROZEN PROOF IS NEVER RECOMPUTED. What this re-derives is a TRUST STATUS beside it. The proof's
 * own bytes, amount, reason and approval stand untouched: rule 5 says historical proof is immutable
 * and reproducible forever, and rule 6 says learning may change FUTURE decisions only. The remedy for
 * a compromised key is a per-row marker, never a rewrite of history.
 *
 * AND THIS IS THE RULE THAT MATTERS MOST: AN UNKNOWN `exposureFrom` MUST NOT DEFAULT TO `revokedAt`.
 * That default would silently clear every attestation the key ever signed, which is the flattering
 * direction. Unknown means THE WHOLE OF THE KEY'S LIFE IS THE WINDOW — "not computed is not zero",
 * applied to time rather than to money. `exposureStartUnknown` travels with the answer so a reader
 * cannot mistake a conservative flag for a measured one.
 */
export function compromiseAssessment(
  events: readonly SettlementKeyEvent[],
  attestationIssuedAt: string,
): CompromiseAssessment {
  const revocation = events.find((e) => e.transition === "REVOKED_COMPROMISED");
  if (revocation === undefined) {
    return Object.freeze({
      status: "NOT_APPLICABLE" as const,
      exposureFrom: null,
      exposureStartUnknown: false,
      detail: "the key has never been revoked as compromised",
    });
  }

  const exposureFrom = revocation.exposureFrom ?? null;
  if (exposureFrom === null) {
    return Object.freeze({
      status: "FLAGGED_COMPROMISED_WINDOW" as const,
      exposureFrom: null,
      exposureStartUnknown: true,
      detail:
        "the key was revoked as compromised with an UNKNOWN exposure start, so its whole lifetime is " +
        "the window and every attestation it signed is flagged; an unknown start is not the revocation " +
        "date, and defaulting to that date would silently clear every past attestation",
    });
  }

  const start = Date.parse(exposureFrom);
  const signed = Date.parse(attestationIssuedAt);
  if (!Number.isFinite(start) || !Number.isFinite(signed)) {
    // FAIL CLOSED. An unparseable date is not evidence that the attestation is outside the window.
    return Object.freeze({
      status: "FLAGGED_COMPROMISED_WINDOW" as const,
      exposureFrom,
      exposureStartUnknown: true,
      detail:
        "the exposure start or the signing instant is not a parseable date, so the attestation cannot " +
        "be placed outside the window and is flagged",
    });
  }

  if (signed < start) {
    return Object.freeze({
      status: "UNAFFECTED" as const,
      exposureFrom,
      exposureStartUnknown: false,
      detail: "the attestation was signed before the exposure window opened",
    });
  }
  return Object.freeze({
    status: "FLAGGED_COMPROMISED_WINDOW" as const,
    exposureFrom,
    exposureStartUnknown: false,
    detail: "the attestation was signed at or after the exposure window opened",
  });
}
