// EP-15 · Pilot admission policy lifecycle — who may set the bar, and when it binds.
//
// THE GOVERNANCE GAP THIS CLOSES. The admission gate made the fitness bar explicit; it did not say
// who is allowed to set it. A customer-authorized actor could register a policy and have it judge
// their own dataset in the same breath — and the customer is the beneficiary of a larger recovery
// number. That is the exact shape the trust invariant forbids: the beneficiary must never determine
// the number, and a bar you set for yourself is the number's first input.
//
// So proposing and activating are split. The customer side proposes — they know their data and
// their commercial reality, and pretending otherwise would just move the decision somewhere less
// informed. Governance activates. Neither can do the other's half.
//
// This module is PURE: states, legal transitions, and derivation of the current state from an
// append-only event log. It holds no storage and no authorization — the server enforces those, and
// keeping the rules here means they can be reasoned about without a database.

/** The four states. Only ACTIVE may judge a dataset. */
export type PolicyState = "DRAFT" | "ACTIVE" | "FROZEN" | "RETIRED";

/**
 * Transitions, recorded as events rather than status edits.
 *
 * `PROPOSED` is the birth event; the rest move an existing policy. There is deliberately no
 * "EDITED": a change to any threshold is a NEW VERSION with its own proposal and its own
 * activation, because editing a bar that has already judged something would silently re-grade it.
 */
export type PolicyTransition = "PROPOSED" | "ACTIVATED" | "FROZEN" | "UNFROZEN" | "RETIRED";

/** One append-only lifecycle event. */
export interface PolicyLifecycleEvent {
  readonly transition: PolicyTransition;
  readonly actorId: string;
  readonly actorRole: string;
  /** Why. Required on every transition — a governance decision with no stated reason is not one. */
  readonly rationale: string;
  readonly at: string;
}

/** State a transition may be applied from. Anything not listed is refused. */
const LEGAL_FROM: Readonly<Record<PolicyTransition, readonly PolicyState[]>> = Object.freeze({
  PROPOSED: Object.freeze([]), // birth: only valid when no prior event exists
  ACTIVATED: Object.freeze(["DRAFT", "FROZEN"] as PolicyState[]), // first activation, or resuming a pause
  FROZEN: Object.freeze(["ACTIVE"] as PolicyState[]),
  UNFROZEN: Object.freeze(["FROZEN"] as PolicyState[]),
  RETIRED: Object.freeze(["DRAFT", "ACTIVE", "FROZEN"] as PolicyState[]), // terminal from anywhere alive
});

const RESULTING_STATE: Readonly<Record<PolicyTransition, PolicyState>> = Object.freeze({
  PROPOSED: "DRAFT",
  ACTIVATED: "ACTIVE",
  FROZEN: "FROZEN",
  UNFROZEN: "ACTIVE",
  RETIRED: "RETIRED",
});

/**
 * Derive the current state from the event log.
 *
 * Fail-closed on an empty log: a policy with no events has never been proposed, and the answer is
 * "no state", not "assume the best". The caller treats null exactly as it treats DRAFT for the
 * purpose of evaluation — neither may judge anything.
 */
export function deriveState(events: readonly PolicyLifecycleEvent[]): PolicyState | null {
  if (events.length === 0) return null;
  let state: PolicyState | null = null;
  for (const event of events) {
    if (event.transition === "PROPOSED") {
      // A second PROPOSED on the same version is ignored rather than resetting an activated policy
      // back to DRAFT — a replay must never un-activate something governance already decided.
      if (state === null) state = "DRAFT";
      continue;
    }
    if (state !== null && LEGAL_FROM[event.transition].includes(state)) {
      state = RESULTING_STATE[event.transition];
    }
    // An illegal transition in the log is IGNORED, not applied. The store refuses to write one, so
    // seeing one here means the log was tampered with — and the safe reading of a tampered log is
    // the state the legal events produced, never the one the illegal event wanted.
  }
  return state;
}

/** May this transition be applied to this state? */
export function canTransition(from: PolicyState | null, transition: PolicyTransition): boolean {
  if (transition === "PROPOSED") return from === null;
  if (from === null) return false;
  return LEGAL_FROM[transition].includes(from);
}

/**
 * May a policy in this state judge a dataset?
 *
 * ACTIVE only. DRAFT has not been approved, FROZEN is a deliberate governance pause, and RETIRED is
 * over. Every other answer is fail-closed — there is no state that evaluates "by default".
 */
export function mayEvaluate(state: PolicyState | null): boolean {
  return state === "ACTIVE";
}

/** Human-readable reason a state cannot judge, for the refusal message. */
export function whyCannotEvaluate(state: PolicyState | null): string {
  switch (state) {
    case null:
      return "no such policy exists for this boundary";
    case "DRAFT":
      return "the policy is a draft and has not been activated by pilot governance";
    case "FROZEN":
      return "the policy is frozen by pilot governance and may not judge new datasets";
    case "RETIRED":
      return "the policy is retired";
    default:
      return "the policy is not active";
  }
}
