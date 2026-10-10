// What changed between an execution and the revision of it — computed, not narrated.
//
// WHY THIS IS A PURE MODULE. "Never silently replace a result" needs two things: the earlier result must
// survive, which the database enforces, and a reader must be able to see WHAT differs and WHY. The
// second is useless if it is a sentence someone wrote by hand, because a hand-written summary can be
// wrong about its own diff. So the delta is derived from the two bindings, and the REASON — which no
// computation can supply — is the only part a human states.
//
// DELIBERATELY NARROW. A revision may differ from its predecessor in the assessment policy and nothing
// else: same bytes, same admission, same interpretation. Anything else is a different reading of the
// data and requires a new admission, so a delta that reported it would be describing something the
// system refuses to create. `unexpectedChanges` exists for exactly that case — it should always be
// empty, and a reader is told when it is not rather than the difference being dropped.
import type { ExecutionBinding } from "./assessmentExecution";

export interface RevisionField {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface BindingRevisionDelta {
  /** The assessment-policy fields that differ. Empty means the two bindings measure identically. */
  readonly changed: readonly RevisionField[];
  /**
   * Fields that differ but MUST NOT, given what a revision is allowed to change.
   *
   * Always empty for a revision this system produced. Non-empty means a record was reached by a path
   * that should not exist, and a reader is shown it rather than being shown a tidy diff.
   */
  readonly unexpectedChanges: readonly RevisionField[];
}

function field(name: string, before: unknown, after: unknown): RevisionField | null {
  const b = String(before);
  const a = String(after);
  return b === a ? null : Object.freeze({ field: name, before: b, after: a });
}

/**
 * Compare a revision's binding against the one it revises.
 *
 * Reports the assessment-policy differences as `changed`, and anything else as `unexpectedChanges`. The
 * split is the point: the first list is what a revision is for, the second is evidence that something
 * went wrong.
 */
export function bindingRevisionDelta(
  previous: ExecutionBinding,
  next: ExecutionBinding,
): BindingRevisionDelta {
  const p = previous.assessmentPolicy;
  const n = next.assessmentPolicy;
  const changed = [
    field("calculationMethodVersion", p.calculationMethodVersion, n.calculationMethodVersion),
    field("assessmentPolicyId", p.policyId, n.policyId),
    field("assessmentPolicyVersion", p.policyVersion, n.policyVersion),
  ].filter((f): f is RevisionField => f !== null);

  // Everything a revision must hold constant. Listed explicitly rather than by object diff, so adding a
  // binding field forces a decision here instead of silently falling into one bucket or the other.
  const unexpected = [
    field("boundaryId", previous.boundaryId, next.boundaryId),
    field("datasetFingerprint", previous.datasetFingerprint, next.datasetFingerprint),
    field("admissionDecisionId", previous.admissionDecisionId, next.admissionDecisionId),
    field("admissionPolicyId", previous.admissionPolicyId, next.admissionPolicyId),
    field("admissionPolicyVersion", previous.admissionPolicyVersion, next.admissionPolicyVersion),
    field("admissionPolicyHash", previous.admissionPolicyHash, next.admissionPolicyHash),
    field("contractVersion", previous.contractVersion, next.contractVersion),
    field("asOf", p.asOf, n.asOf),
    field("stallThresholdDays", p.stallThresholdDays, n.stallThresholdDays),
    field("currency", p.currency, n.currency),
    field("mappingId", previous.interpretation.mappingId, next.interpretation.mappingId),
    field("amountFormat", previous.interpretation.amountFormat, next.interpretation.amountFormat),
    field("dateLocale", previous.interpretation.dateLocale, next.interpretation.dateLocale),
    field("recoveryCaseId", previous.recoveryCaseId ?? "", next.recoveryCaseId ?? ""),
  ].filter((f): f is RevisionField => f !== null);

  return Object.freeze({ changed: Object.freeze(changed), unexpectedChanges: Object.freeze(unexpected) });
}

/** Is this delta one a revision is allowed to have — something changed, and nothing forbidden did? */
export function isPermittedRevision(delta: BindingRevisionDelta): boolean {
  return delta.unexpectedChanges.length === 0 && delta.changed.length > 0;
}
