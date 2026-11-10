// Evidence-role derivation — the ONE implementation, in the pure domain.
//
// WHY IT LIVES HERE NOW. It was `server/domain/evidenceRole.ts`, and that was right while the only
// path that could mint a Proof was the governed HTTP route. It is not right any more: the pure
// approval path (`src/domain/approval.ts`) must ask the same question — WHICH of a case's evidence
// records is the executed correction — and a domain module may not import from `server/`. The
// alternatives were both worse than moving it. A second copy in `src/domain/` is two policies that
// can drift, which is the thing this slice exists to remove. An import from `server/` into
// `src/domain/` inverts the dependency and `check-domain-purity.mjs` now forbids it explicitly.
//
// `server/domain/evidenceRole.ts` is kept as a pure RE-EXPORT, so every existing server import path
// resolves to these exact bindings. `evidenceRoleSharing.test.ts` asserts that by identity — the
// server's `deriveEvidenceRole` must be the SAME function object, not merely one that agrees on the
// cases a fixture happens to supply. A finite agreement is necessary evidence of equivalence and
// never a proof of it; identity is the proof.
//
// `evidenceRole` ("outcome" | "correction" | "supporting") is a classification layered beside the
// domain's existing `trustClassification` (independent | beneficiary_controlled, ./evidence.ts). It
// is DERIVED from (sourceSystem, evidenceType) against a versioned allowlist — never accepted as a
// client assertion, mirroring `makeEvidence`'s own pattern: the caller's opinion of what an item
// "is" never survives on its own.
//
// ROLE_MAP_VERSION is stamped onto every ingested EvidenceRecord so a future change to this mapping
// can never reinterpret historical evidence — the classification a record received is frozen at
// ingestion time, exactly like a policy version stamped on a Proof.
//
// PURE: no clock, no I/O, no randomness. Moving the file changed no value, no key and no behaviour;
// `ROLE_MAP_VERSION` therefore does NOT move, because a version that signals a change which did not
// happen is its own defect.

// BUMPED for the `correction` role added by G1. The version is stamped on every ingested record, so
// historical rows keep the role they were classified with: a record ingested as `supporting` under
// 2026.1 stays `supporting` even where the same (sourceSystem, evidenceType) pair would now derive
// `correction`. That is exactly what this constant is for, and it is why adding a role reinterprets
// nothing — the classification is frozen at ingestion, like a policy version stamped on a Proof.
export const ROLE_MAP_VERSION = "evidence-role-2026.2";

export type EvidenceRole = "outcome" | "correction" | "supporting";

/** Which (sourceSystem, evidenceType) pairs count as evidence OF THE RECOVERED OUTCOME
 * (the collection fact itself) rather than merely supporting/contextual evidence. */
export const OUTCOME_EVIDENCE_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  billing: Object.freeze(["invoice_paid", "payment_received"]),
});

/**
 * G1 · Which pairs are evidence that THE CORRECTION WAS EXECUTED — the billing system's own statement
 * that it raised the corrective charge — rather than evidence of the money arriving afterwards.
 *
 * A CREDIT NOTE IS DELIBERATELY ABSENT. It corrects billing in the OPPOSITE direction: money the company
 * may owe back. Letting it substantiate an under-billing recovery would accept a refund as evidence that
 * a shortfall was fixed, which is the reconciliation sign convention inverted — `residual = expected −
 * observed`, where negative is a liability signal and never exposure.
 *
 * EXPORTED, because `correctionMapping.ts` now DERIVES its declared correction types from this rather
 * than restating them. The previous form carried the comment "Mirrors `CORRECTION_EVIDENCE_TYPES`",
 * and a mirror is two declarations that can disagree — the exact shape of defect this slice closes.
 */
const CORRECTION_TYPES_BY_SOURCE = Object.freeze({
  billing: Object.freeze(["corrective_invoice_issued", "billing_corrected"] as const),
});

/**
 * The literal union of every evidence type that derives the `correction` role. Declared as a type so
 * `correctionMapping.ts` can keep a precise `permitted` list rather than falling back to `string`:
 * deriving the vocabulary must not cost the type safety the hand-written mirror had.
 */
export type CorrectionEvidenceType =
  (typeof CORRECTION_TYPES_BY_SOURCE)[keyof typeof CORRECTION_TYPES_BY_SOURCE][number];

/** The (sourceSystem → types) view `deriveEvidenceRole` indexes with arbitrary caller strings. */
export const CORRECTION_EVIDENCE_TYPES: Readonly<Record<string, readonly string[]>> =
  CORRECTION_TYPES_BY_SOURCE;

/**
 * Every evidence type that derives the `correction` role, across all source systems, de-duplicated
 * and IN DECLARATION ORDER.
 *
 * Not sorted. Sorting would have reordered `DECLARED_CORRECTION_TYPES`, whose order
 * `correctionMapping.test.ts` already pins — and a cosmetic reordering inside a vocabulary a gate
 * reads is a diff that teaches a reader the list changed when it did not. Declaration order is also
 * the order the allowlist states, which is the thing being derived.
 */
export const ALL_CORRECTION_EVIDENCE_TYPES: readonly CorrectionEvidenceType[] = Object.freeze(
  [...new Set(Object.values(CORRECTION_TYPES_BY_SOURCE).flat())],
);

export function deriveEvidenceRole(sourceSystem: string, evidenceType: string): EvidenceRole {
  const outcomeTypes = OUTCOME_EVIDENCE_TYPES[sourceSystem];
  if (outcomeTypes?.includes(evidenceType)) return "outcome";
  const correctionTypes = CORRECTION_EVIDENCE_TYPES[sourceSystem];
  if (correctionTypes?.includes(evidenceType)) return "correction";
  return "supporting";
}
