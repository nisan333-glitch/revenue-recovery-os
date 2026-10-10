// EP-31c · Can the data contract establish a stable LEAK-INSTANCE identity?
//
// WHY THIS MODULE EXISTS, AND WHY IT IS THE ONLY PLACE THE GAP LIVES.
//
// A governed Recovery Case is about one leakage OCCURRENCE — `RECOVERY_CASE.md` §2 says "one Case per
// (account × leak instance)". Candidate emission therefore needs an identity that is BOTH:
//
//   • STABLE — the same obligation re-exported, or re-read under different governed analysis terms, must
//     resolve to the same identity, or one occurrence becomes two candidates; and
//   • DISTINGUISHING — two genuinely different obligations must resolve to different identities, or a
//     later real leakage event is permanently suppressed by the first.
//
// THE CURRENT CONTRACT CANNOT PROVIDE ONE. Established field by field over all 21 declared fields:
//
//   1. Nothing required distinguishes two obligations that share (entity_id, signed_at,
//      next_invoice_due_at). `subscription_id` is RECOMMENDED and `cycle_id` is OPTIONAL, so neither is
//      guaranteed present; `plan`/`segment`/`product` are optional and are not identifiers; and
//      `next_invoice_amount` is mutable for one obligation (a credit or correction changes it), so using
//      it would buy uniqueness by giving up stability.
//   2. NOTHING AT ALL distinguishes a RESCHEDULED due date from a new occurrence, and this is the
//      decisive gap: it is unknowable in principle from the declared fields, not merely collision-prone.
//      There is no obligation identifier that survives a due-date change, no `previous_due_at`, no
//      billing-period bounds, no sequence number, no reschedule event and no history — each row states
//      only the NEXT invoice. `status_effective_at` is the effective date of a terminal STATUS, and
//      `refunded_at`/`cancelled_at` are terminal states; none of them is a reschedule signal.
//
// So a stable source-system obligation identifier is the only thing that would resolve both — and the
// contract declares none. See `docs/GOVERNED_DETECTION_V1.md` for the full audit (Q1–Q5) and for the two
// open defects in the derived cycle identity (D1, D2) that must be settled alongside any extension.
//
// WHAT THIS MODULE IS NOT. It is not a refusal of ordinary assessment. An assessment does not need to
// identify occurrences: it measures a population as of a cut-off, and it is correct without this. Only
// CANDIDATE-CAPABLE staging and emission need it, and they are the only callers.

/**
 * Declared fields that would carry an authoritative obligation identity.
 *
 * EMPTY, and that emptiness is the finding rather than an omission. A field belongs here only once the
 * contract declares it to be:
 *   • an identifier of the OBLIGATION (not of the account, and not of the subscription); and
 *   • stable across re-exports AND across a reschedule of its own due date.
 *
 * `cycle_id` is deliberately NOT listed. It is optional, so it cannot be relied on; it has no synonyms in
 * the adapter's mapping spec, so a customer's `invoice_id`/`charge_id`/`invoice_number` column is never
 * auto-detected; it is ignored whenever `subscription_id` is present (defect D1); and it is nowhere
 * declared stable across a reschedule.
 *
 * Adding a name here is not sufficient on its own — the adapter must carry the value onto the cycle and
 * the emission path must be able to read it. That is why the status below is derived from this list
 * rather than asserted: an incomplete extension fails the negative controls instead of silently enabling
 * emission.
 */
export const OBLIGATION_IDENTITY_FIELDS: readonly string[] = Object.freeze([]);

/** The named reason a blocked decision carries, so callers do not invent wording of their own. */
export const LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL =
  "the pilot data contract declares no obligation-level identifier that is both guaranteed present and " +
  "stable across a reschedule of its own due date, so two obligations sharing (entity_id, signed_at, " +
  "next_invoice_due_at) cannot be distinguished and a rescheduled obligation cannot be told from a new " +
  "one; candidate emission is refused rather than counted under an unproven occurrence key";


// ── EP-31d commit 1 · The canonical candidate leak-instance identity ─────────────────────────────
//
// WHAT THIS ADDS, AND WHY IT IS SEPARATE FROM `cycleId`. The audit above says no DECLARED field can
// identify an obligation. This section defines the identity a candidate would be keyed on ONCE such a
// field exists, and it is deliberately not the adapter's `cycleId`:
//
//   • `cycleId` is a fallback hierarchy — `subscription_id ?? cycle_id ?? entity|signed|due` — so a
//     richer later export changes the identity of the same real obligation;
//   • it is SUBSCRIPTION-grained when `subscription_id` is present, and two cycles of one subscription
//     then collide into a mutual exclusion (`duplicate_cycle_id`, defect D2);
//   • it is the EXCLUSION grain: a collision there is a data-quality verdict on both rows, which is not
//     what a candidate key may mean;
//   • its derived form embeds normalised DATES, so a governed re-read under a different declared
//     `dateLocale` changes it for any ambiguous numeric date.
//
// WHAT IS IN THE IDENTITY, AND WHAT IS POINTEDLY NOT.
//
// `entityId` is NOT a component. The obligation reference already determines the account within its
// source system, and including the account would make identity depend on a value that can legitimately
// change while the obligation does not — an account merge or a CRM re-key would then split one
// obligation into two candidates. The account travels as an ATTRIBUTE of a candidate, never as identity.
//
// Also absent, each by decision rather than by oversight: `datasetFingerprint`, `datasetId`, the
// submission identity, `executionId`, the AssessmentPolicy and its `asOf`, the amount, the due date, the
// evidence verification `keyId`, and any HMAC key id or key material. The first six are properties of a
// READING of the data, not of the obligation, so including any of them would make a re-export, a
// re-submission or a governed re-reading look like a new leak. The amount and the due date are mutable
// for one obligation — a correction and a reschedule are exactly the events identity must survive. The
// two key identities belong to different layers entirely (see below).
//
// THREE IDENTITY LAYERS, AND THIS FILE KNOWS ONLY THE FIRST.
//
//   1. SOURCE NAMESPACE identity — `sourceNamespaceId`, a governed instance-grained namespace.
//   2. EVIDENCE VERIFICATION KEY identity — `keyId` in the Ed25519 source registry.
//   3. PSEUDONYMISATION KEY identity — the HMAC key that turns this identity into a stored `sourceRef`.
//
// Only (1) is a component here. That is what makes candidate identity independent of pseudonymisation:
// the canonical key below is plain, deterministic and re-derivable, and the pseudonymous `sourceRef` is
// computed FROM it elsewhere (`leakInstanceSourceRef.ts`) — never the other way round. This module has
// NO IMPORTS AT ALL, which is asserted structurally, so it cannot come to depend on either key layer.
//
// ONE PREREQUISITE CLOSED, ONE STILL OPEN — and keeping them separately named is what makes that legible.
// `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` is now TRUE: Step 5 built the governed registry, the per-boundary
// permitted set and the per-dataset binding, so an authoritative namespace CAN be resolved, and the
// uploader's `provenance.sourceSystems.billing` is cross-checked against it rather than believed.
// `OBLIGATION_IDENTITY_FIELDS` is still empty, because the data contract declares no obligation-level
// identifier — so the status predicate still refuses, now for exactly one reason instead of two. Closing the
// namespace gap did not and could not close the contract gap. See docs/GOVERNED_DETECTION_V1.md.

/** Version of the canonical derivation. A change here is a NEW scheme id, never a silent re-grade. */
export const LEAK_INSTANCE_IDENTITY_SCHEME = "nh-leak-instance-v1";

/**
 * Whether an authoritative source namespace can be resolved for a submission.
 *
 * FALSE, and separately named from the contract gap on purpose: the two are independent prerequisites
 * with different owners. The missing obligation identifier is a DATA CONTRACT gap the customer's export
 * must close; the missing namespace resolution is a GOVERNANCE gap that a registered `SourceNamespace`
 * plus a governed per-submission binding must close. Collapsing them into one boolean would hide which
 * one is being worked on, and would let closing either look like closing both.
 */
export const SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true;

/** Every way leak-instance identity can be refused. Callers never invent wording of their own. */
export type LeakInstanceIdentityRefusal =
  /** The data contract declares no obligation-level identifier at all. */
  | "leak_instance_identity_unavailable"
  /** No authoritative, governed source namespace can be resolved for the submission. */
  | "source_namespace_unresolved"
  /** Some accepted cycles carry an obligation reference and others do not. Refused WHOLE. */
  | "leak_instance_identity_incomplete"
  /** A reference is present but is not a well-formed component. */
  | "leak_instance_identity_malformed"
  /** One identity is claimed by more than one accepted cycle, so two obligations would merge. */
  | "leak_instance_identity_ambiguous";

/**
 * The identity a candidate is keyed on. Four components, none optional, no fallback of any kind.
 *
 * A fallback hierarchy is precisely the defect that makes `cycleId` unusable here, so an absent
 * component is a REFUSAL and never a substitution.
 */
export interface CandidateLeakInstanceIdentity {
  /** Tenant scope. From the authenticated server context only — never from a file or a request body. */
  readonly boundaryId: string;
  /** The leak class, a `PLAYBOOK` key. One obligation may leak in more than one class. */
  readonly recoveryType: string;
  /** The governed, instance-grained source namespace. NOT the class-grained evidence `sourceSystem`. */
  readonly sourceNamespaceId: string;
  /** The source system's own identifier for the billed obligation. */
  readonly obligationRef: string;
}

/** Ordered component names — the canonical order, and the only order. */
export const LEAK_INSTANCE_IDENTITY_COMPONENTS: readonly (keyof CandidateLeakInstanceIdentity)[] =
  Object.freeze(["boundaryId", "recoveryType", "sourceNamespaceId", "obligationRef"]);

/** Upper bound per component. Bounds the key and matches the transport limits used elsewhere. */
export const MAX_IDENTITY_COMPONENT_BYTES = 256;

/** UTF-8 byte length using only Web-standard APIs, so this file stays browser-safe. */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Why a component is unusable, or null. NEVER echoes the value — a refusal reason reaches operators.
 *
 * Rejecting control characters is a CORRECTNESS rule, not hygiene: the canonical key below is joined
 * with NUL, so a component containing NUL could make two different identities encode identically. With
 * NUL excluded from every component the join is injective, which is the property the whole key rests on.
 */
export function leakInstanceComponentProblem(component: string, value: unknown): string | null {
  if (typeof value !== "string") return `${component} must be a string`;
  if (value.trim() === "") return `${component} must not be empty`;
  if (value !== value.trim()) return `${component} must not be surrounded by whitespace`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return `${component} must not contain control characters`;
  // TextEncoder, not `Buffer`: this module is reachable from the browser bundle (see `fingerprint.ts`,
  // which chooses Web Crypto for the same reason), and `Buffer` is a Node global that would be undefined
  // there. Measuring BYTES rather than code units is deliberate — a bound in code units would let a
  // multi-byte reference exceed a byte-oriented column downstream.
  if (utf8ByteLength(value) > MAX_IDENTITY_COMPONENT_BYTES) {
    return `${component} must be at most ${MAX_IDENTITY_COMPONENT_BYTES} bytes`;
  }
  return null;
}

/** Every component problem, in canonical order. Empty means the identity can be encoded. */
export function leakInstanceIdentityProblems(identity: unknown): readonly string[] {
  // `unknown` rather than a shaped parameter: the point of this function is to be callable on values
  // that have NOT been validated yet — a partially-built identity, or one assembled from a source the
  // type system never saw. A typed parameter would push callers into a cast and skip the check.
  const record = (identity ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  for (const component of LEAK_INSTANCE_IDENTITY_COMPONENTS) {
    const problem = leakInstanceComponentProblem(component, record[component]);
    if (problem !== null) problems.push(problem);
  }
  return Object.freeze(problems);
}

/**
 * THE CANONICAL ENCODING, stated exactly:
 *
 *   scheme ‖ NUL ‖ boundaryId ‖ NUL ‖ recoveryType ‖ NUL ‖ sourceNamespaceId ‖ NUL ‖ obligationRef
 *
 * Five fields, scheme first, NUL-separated, injective because every component rejects NUL. The scheme is
 * INSIDE the key rather than a prefix on a derived string, so a future scheme cannot collide with this
 * one even under the same key material.
 *
 * Throws on an unusable component, and the message names the component and never the value. A caller
 * that cannot tolerate a throw asks `leakInstanceIdentityProblems` first — which is what the population
 * predicate does, so a malformed customer reference becomes a named refusal rather than an exception.
 */
export function canonicalLeakInstanceKey(identity: CandidateLeakInstanceIdentity): string {
  const problems = leakInstanceIdentityProblems(identity);
  if (problems.length > 0) {
    throw new Error(`candidate leak-instance identity is not encodable: ${problems.join("; ")}`);
  }
  return [
    LEAK_INSTANCE_IDENTITY_SCHEME,
    identity.boundaryId,
    identity.recoveryType,
    identity.sourceNamespaceId,
    identity.obligationRef,
  ].join("\u0000");
}

// ── The status predicate, now over TWO independent prerequisites ──────────────────────────────────

/** The named reason no authoritative namespace can be resolved. Carries no customer value. */
export const SOURCE_NAMESPACE_UNRESOLVED_DETAIL =
  "no governed source namespace can be resolved for a submission: there is no registered SourceNamespace " +
  "and no governed (boundary, dataset) source binding, and the uploader's declared billing source system " +
  "is free text with no authority; candidate emission is refused rather than keyed on a namespace the " +
  "beneficiary could choose";

export interface LeakInstanceIdentityStatus {
  /** True only when EVERY prerequisite is met. False while any one of them is not. */
  readonly establishable: boolean;
  /** The first unmet prerequisite, or null when establishable. */
  readonly reason: LeakInstanceIdentityRefusal | null;
  /** Why, in a sentence that names the gap rather than gesturing at it. Never echoes a customer value. */
  readonly detail: string;
}

/**
 * Can a leak-instance identity be established at all, under what this build implements?
 *
 * DELIBERATELY NOT A FUNCTION OF THE DATA. Both gaps are structural — no customer can supply a field the
 * contract does not declare, and no export can conjure a governed namespace binding. Keeping it
 * data-independent is also what lets the emitter ask the question WITHOUT the population, which is what
 * makes its guard genuinely independent of staging rather than a second reading of the same rows.
 *
 * THE ORDER IS THE ORDER OF DEPTH, not of convenience. The obligation identifier comes first because
 * without it there is nothing for a namespace to qualify: a namespace scopes an obligation reference, so
 * reporting "no namespace" while the reference itself does not exist would name the shallower gap and
 * send a reader to the wrong place.
 */
export function leakInstanceIdentityStatus(): LeakInstanceIdentityStatus {
  if (OBLIGATION_IDENTITY_FIELDS.length === 0) {
    return Object.freeze({
      establishable: false,
      reason: "leak_instance_identity_unavailable",
      detail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
    });
  }
  if (!SOURCE_NAMESPACE_RESOLUTION_AVAILABLE) {
    return Object.freeze({
      establishable: false,
      reason: "source_namespace_unresolved",
      detail: SOURCE_NAMESPACE_UNRESOLVED_DETAIL,
    });
  }
  return Object.freeze({
    establishable: true,
    reason: null,
    detail: `obligation identity is carried by: ${[...OBLIGATION_IDENTITY_FIELDS].sort().join(", ")}`,
  });
}
