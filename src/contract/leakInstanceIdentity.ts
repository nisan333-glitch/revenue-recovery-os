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

export interface LeakInstanceIdentityStatus {
  /** True only when the contract can establish a stable, distinguishing obligation identity. */
  readonly establishable: boolean;
  /** Why, in a sentence that names the gap rather than gesturing at it. Never echoes a customer value. */
  readonly detail: string;
}

/**
 * Can a leak-instance identity be established at all, under the contract this build implements?
 *
 * DELIBERATELY NOT A FUNCTION OF THE DATA. The gap is at the contract level, not in any particular
 * export: no customer can supply a field the contract does not declare. Keeping it data-independent is
 * also what lets the emitter ask the question WITHOUT the population, which is what makes its guard
 * genuinely independent of staging rather than a second reading of the same rows.
 */
export function leakInstanceIdentityStatus(): LeakInstanceIdentityStatus {
  if (OBLIGATION_IDENTITY_FIELDS.length === 0) {
    return Object.freeze({ establishable: false, detail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL });
  }
  return Object.freeze({
    establishable: true,
    detail: `obligation identity is carried by: ${[...OBLIGATION_IDENTITY_FIELDS].sort().join(", ")}`,
  });
}
