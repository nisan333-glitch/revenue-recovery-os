// WHICH EXECUTED CORRECTION MAY EVIDENCE WHICH RECOVERY? A declared mapping, failing closed on anything
// it does not declare.
//
// WHY THIS IS NEEDED. G1 requires a source-attested executed-correction record before a case may reach
// PROVEN, and the only correction evidence types that exist are BILLING ones —
// `(billing, corrective_invoice_issued)` and `(billing, billing_corrected)`. Nothing checked that the
// correction supplied matched the mechanism the recovery reason NAMED. So a `UsageActivation` recovery
// could be evidenced by a corrective invoice: an activation was missed, nothing was mis-billed, and a
// billing artefact was accepted as proof that the activation happened. The reason and its evidence
// disagreed, and the proof is immutable, so the disagreement could never be corrected afterwards.
//
// EVERY ENTRY IS INVENTORIED FROM THE CODEBASE, NOT INVENTED. The eight reasons are
// `RECOVERY_REASONS`' own keys; the two correction evidence types are `CORRECTION_EVIDENCE_TYPES`' own
// entries in `server/domain/evidenceRole.ts`. No category is added here, and a reason whose correction
// channel does not exist is DECLARED as not existing rather than quietly permitted.
//
// FAIL CLOSED, IN THREE DIFFERENT WAYS, because the three are different situations:
//
//   · an UNKNOWN reason — not in the vocabulary at all — is refused outright;
//   · a reason with NO DECLARED CHANNEL is refused, and the refusal says the channel does not exist, so
//     the remedy is a governance decision rather than a different upload;
//   · a reason paired with a correction type its channel does not permit is refused as INCOMPATIBLE.
//
// IT CANNOT BE BYPASSED BY THE REQUEST. The reason is read from the approval request — it has to be, it
// is the claim being made — but the CORRECTION TYPE comes from an ingested evidence record whose role the
// server derived and whose source signed it. A caller cannot supply a correction type, cannot set a
// confidence that changes which mapping applies, and cannot label a record into a different channel.
//
// PURE: no clock, no I/O, no randomness.
import { ALL_CORRECTION_EVIDENCE_TYPES, type CorrectionEvidenceType } from "./evidenceRole";

/**
 * The correction evidence types that exist — DERIVED from the role allowlist, not restated.
 *
 * The previous form was a hand-written list carrying the comment "Mirrors
 * `CORRECTION_EVIDENCE_TYPES`". A mirror is two declarations that can disagree, and the day they
 * disagree the channel gate is deciding on a vocabulary the ingestion path does not use. Deriving it
 * makes the disagreement unrepresentable, which is strictly stronger than a test that compares them.
 * `correctionMapping.test.ts` still pins the resulting values, so a change to the allowlist is a
 * visible change here rather than a silent one.
 */
export const DECLARED_CORRECTION_TYPES: readonly CorrectionEvidenceType[] =
  ALL_CORRECTION_EVIDENCE_TYPES;
export type DeclaredCorrectionType = CorrectionEvidenceType;

/**
 * What each recovery reason's executed correction may be.
 *
 * `permitted: []` means NO CORRECTION CHANNEL EXISTS for that mechanism — not that anything goes. The
 * seven relationship and activation mechanisms are in that state because no source attests them: a
 * corrective invoice says the billing changed, and it says nothing whatsoever about an onboarding being
 * restarted, a milestone being reached or a usage flag being switched on. `why` records that, so a reader
 * is told why the list is empty instead of inferring that nobody filled it in.
 */
export interface ReasonChannel {
  readonly reason: string;
  readonly permitted: readonly DeclaredCorrectionType[];
  readonly why: string;
}

export const CORRECTION_CHANNELS: readonly ReasonChannel[] = Object.freeze([
  {
    reason: "BillingCorrection",
    permitted: Object.freeze([...DECLARED_CORRECTION_TYPES]),
    why: "the mechanism IS a billing change, and both declared correction types are the billing system's "
      + "own statement that it made one",
  },
  ...(["OnboardingReboot", "MilestoneNudge", "EnablementSession", "CSMOutreach", "ExecBusinessReview",
    "RenewalOutreach", "UsageActivation"] as const).map((reason) => Object.freeze({
    reason,
    permitted: Object.freeze([] as DeclaredCorrectionType[]),
    why: "no source-attested correction channel exists for this mechanism: the only declared correction "
      + "types are the billing system's statements about billing, and they attest nothing about whether "
      + "this action was taken. Declaring a channel for it — and naming which source may attest it — is a "
      + "governance decision and is not taken here",
  })),
]);

const CHANNEL_BY_REASON: ReadonlyMap<string, ReasonChannel> =
  new Map(CORRECTION_CHANNELS.map((c) => [c.reason, c]));

export type CorrectionMappingCode =
  /** The reason is not in the declared vocabulary at all. */
  | "RECOVERY_REASON_UNKNOWN"
  /** The reason is declared and no correction channel exists for its mechanism. */
  | "CORRECTION_CHANNEL_NOT_DECLARED"
  /** A correction record exists, and its type is not one this reason's channel permits. */
  | "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON";

export type CorrectionMappingVerdict =
  | { readonly ok: true; readonly reason: string; readonly correctionType: DeclaredCorrectionType }
  | { readonly ok: false; readonly code: CorrectionMappingCode; readonly detail: string };

const deny = (code: CorrectionMappingCode, detail: string): CorrectionMappingVerdict =>
  Object.freeze({ ok: false as const, code, detail });

/**
 * May this executed correction evidence this recovery?
 *
 * `correctionType` is the `evidenceType` of the correction-role record the server found on the case —
 * never a value from the request. A null means no correction record was found, which G1 already refuses
 * on its own ground; this function is not that check and says so rather than duplicating it.
 */
export function correctionMapping(
  recoveryReason: string,
  correctionType: string | null,
): CorrectionMappingVerdict {
  const channel = CHANNEL_BY_REASON.get(recoveryReason);
  if (channel === undefined) {
    return deny(
      "RECOVERY_REASON_UNKNOWN",
      `'${recoveryReason}' is not a declared recovery reason, so no correction can be matched to it`,
    );
  }
  if (channel.permitted.length === 0) {
    return deny(
      "CORRECTION_CHANNEL_NOT_DECLARED",
      `${channel.reason}: ${channel.why}`,
    );
  }
  if (correctionType === null) {
    return deny(
      "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON",
      `${channel.reason} requires an executed correction of type ${channel.permitted.join(" or ")}, and no `
        + "correction type was established",
    );
  }
  if (!(channel.permitted as readonly string[]).includes(correctionType)) {
    return deny(
      "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON",
      `${channel.reason} permits ${channel.permitted.join(" or ")}; the correction on this case is `
        + `'${correctionType}', which attests a different mechanism`,
    );
  }
  return Object.freeze({ ok: true as const, reason: channel.reason, correctionType: correctionType as DeclaredCorrectionType });
}

/**
 * Does this reason have a declared correction channel AT ALL?
 *
 * A DIFFERENT QUESTION FROM `correctionMapping`, and the difference is load-bearing. That function
 * asks whether a PARTICULAR correction may evidence a reason, so it needs the correction's type and
 * answers `CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON` when none was established. This asks whether any
 * correction could ever satisfy the reason — which the ledger predicates in `invariants.ts` must ask,
 * because a `RecoveryEvent` carries no evidence list and calling `correctionMapping(reason, null)`
 * there would refuse a perfectly provable `BillingCorrection` case for want of an argument it cannot
 * supply.
 *
 * Both read the same `CHANNEL_BY_REASON`, so this is a second QUESTION over one policy, never a
 * second policy.
 */
export function reasonHasDeclaredChannel(recoveryReason: string): boolean {
  const channel = CHANNEL_BY_REASON.get(recoveryReason);
  return channel !== undefined && channel.permitted.length > 0;
}

/** Why a reason has no declared channel, for a refusal that must explain itself. */
export function channelAbsenceReason(recoveryReason: string): string {
  const channel = CHANNEL_BY_REASON.get(recoveryReason);
  if (channel === undefined) {
    return `'${recoveryReason}' is not a declared recovery reason, so no correction can be matched to it`;
  }
  return `${channel.reason}: ${channel.why}`;
}

/**
 * Which refusals BLOCK an approval today, and which are reported without blocking.
 *
 * THE SPLIT IS A GOVERNANCE BOUNDARY, NOT A CONVENIENCE, and it is declared here rather than buried in the
 * service so that moving it is a visible change to a named constant.
 *
 * BLOCKING, because each is decidable from the record with no decision outstanding:
 *   · `RECOVERY_REASON_UNKNOWN` — a reason outside the vocabulary names no mechanism at all.
 *   · `CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON` — the reason HAS a declared channel and the correction
 *     supplied is not in it. Measured: enforcing this breaks nothing, because nothing in the repository
 *     pairs `BillingCorrection` with a non-billing correction.
 *
 * ALSO BLOCKING, SINCE THE OWNER DECIDED IT ON 2026-11-10:
 *   · `CORRECTION_CHANNEL_NOT_DECLARED` — seven of the eight reasons have no correction channel at all.
 *
 *     THIS WAS DELIBERATELY NOT ENFORCED UNTIL THE DECISION WAS MADE, and the history is kept because it
 *     explains the shape. Enforcing it makes PROVEN unreachable for every mechanism except a billing
 *     correction, which is a visible product consequence rather than a tidy-up: it refuses the synthetic
 *     pilot's own `ActivationMissed` → `UsageActivation` demonstration, where `UsageActivation` is the
 *     CORRECT reason by the declared scope. Taking that by implementation would have been deciding for
 *     the owner. Permitting it silently let a billing artefact stand in as proof that an activation
 *     happened — the failure the constitution names in those words.
 *
 *     The owner approved enforcement, so the refusal now blocks. The synthetic pilot moved to a billing
 *     case rather than the gate being softened to accommodate it: a demonstration is adjusted to the
 *     rule, never the rule to the demonstration.
 */
export const BLOCKING_MAPPING_CODES: readonly CorrectionMappingCode[] = Object.freeze([
  "RECOVERY_REASON_UNKNOWN",
  "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON",
  // Owner-approved 2026-11-10. Every declared refusal now blocks, so the set is exhaustive over
  // `CorrectionMappingCode` — a mapping verdict that is not `ok` cannot mint Revenue Returned.
  "CORRECTION_CHANNEL_NOT_DECLARED",
]);

/**
 * EVERY refusal blocks, as of the owner's decision. Kept as a named, asserted property rather than left
 * implicit in the list above: if a future code is added to `CorrectionMappingCode` and NOT to
 * `BLOCKING_MAPPING_CODES`, a new unsupported mechanism could mint money while every existing test still
 * passed. The test on this constant is what makes that impossible to do quietly.
 */
export const ALL_MAPPING_REFUSALS_BLOCK = true as const;

/** Does this verdict block an approval today? Pure, and the only place the split is applied. */
export function mappingBlocksApproval(verdict: CorrectionMappingVerdict): boolean {
  return !verdict.ok && BLOCKING_MAPPING_CODES.includes(verdict.code);
}

/** Every declared reason, for a report or a test that must enumerate rather than guess. */
export const DECLARED_REASONS: readonly string[] = Object.freeze(CORRECTION_CHANNELS.map((c) => c.reason));
