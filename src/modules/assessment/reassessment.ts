// What an operator may cite for a re-assessment, and why each other definition would be refused.
//
// WHY THIS EXISTS AS A PURE MODULE. The server is the gate, and nothing here changes that: every
// refusal below is one the server reaches on its own and reports with its own NH-AX-#### code. What
// the screen owes the operator is that they can SEE which definitions would work before submitting —
// otherwise choosing one is guesswork and the only way to learn is to be refused.
//
// IT NEVER WIDENS ANYTHING. Each predicate is derived from values the SERVER supplied (the governed
// terms list and the previous execution's own binding) and it can only mark a row ineligible, never
// eligible-despite. If this module were wrong in the permissive direction the submission would still
// be refused server-side; if it were wrong in the restrictive direction the operator would see a
// stated reason they could check. Neither failure mode can produce an execution the server declined.
//
// THE THREE REASONS, and they are the server's own, not invented here:
//   • not ACTIVE                               → NH-AX-1010, the terms resolve refuses it
//   • changes asOf / stall threshold / currency → NH-AX-1016, a different reading, re-submit instead
//   • names the method already used             → NH-AX-1017, nothing to do
import type { GovernedAnalysisTermsRow } from "../../data/pilotAnalysisTermsClient";
import type { ExecutionBindingView } from "../../data/pilotAssessmentClient";

/** Why a governed definition cannot be cited for THIS execution's re-assessment. */
export type TermsIneligibility =
  | { readonly kind: "NOT_ACTIVE"; readonly code: "NH-AX-1010"; readonly detail: string }
  | {
      readonly kind: "CHANGES_WHAT_IS_MEASURED";
      readonly code: "NH-AX-1016";
      readonly fields: readonly string[];
      readonly detail: string;
    }
  | { readonly kind: "SAME_METHOD"; readonly code: "NH-AX-1017"; readonly detail: string };

export interface TermsOption {
  readonly row: GovernedAnalysisTermsRow;
  /** Null when the definition may be cited. */
  readonly ineligible: TermsIneligibility | null;
}

/**
 * Classify one governed definition against the execution being revised.
 *
 * Order matters and is the server's order: a definition that is not in force is refused before anyone
 * asks what it measures, because an unapproved definition's values are not a proposal to evaluate.
 */
export function classifyTermsForRevision(
  row: GovernedAnalysisTermsRow,
  previous: ExecutionBindingView,
): TermsOption {
  if (!row.mayMeasure) {
    return {
      row,
      ineligible: {
        kind: "NOT_ACTIVE",
        code: "NH-AX-1010",
        detail: `this definition is ${row.state ?? "unapproved"} — only an ACTIVE definition may measure anything`,
      },
    };
  }

  // The three governed values that decide WHAT is measured. The admission was for this reading, and a
  // definition that moves any of them is a different reading the admission does not cover.
  const measured: readonly [string, string, string][] = [
    ["asOf", previous.assessmentPolicy.asOf, row.asOf],
    ["stallThresholdDays", String(previous.assessmentPolicy.stallThresholdDays), String(row.stallThresholdDays)],
    ["currency", previous.assessmentPolicy.currency, row.currency],
  ];
  const differing = measured.filter(([, before, after]) => before !== after).map(([name]) => name);
  if (differing.length > 0) {
    return {
      row,
      ineligible: {
        kind: "CHANGES_WHAT_IS_MEASURED",
        code: "NH-AX-1016",
        fields: Object.freeze(differing),
        detail: `this definition changes ${differing.join(", ")} — that changes what is measured, not how, so the extract must be re-submitted`,
      },
    };
  }

  if (row.calculationMethodVersion === previous.assessmentPolicy.calculationMethodVersion) {
    return {
      row,
      ineligible: {
        kind: "SAME_METHOD",
        code: "NH-AX-1017",
        detail: `this definition names ${row.calculationMethodVersion}, the method this execution already used — there is nothing to re-assess`,
      },
    };
  }

  return { row, ineligible: null };
}

/** Every definition this boundary holds, classified, in the order the server listed them. */
export function termsOptionsForRevision(
  rows: readonly GovernedAnalysisTermsRow[],
  previous: ExecutionBindingView,
): readonly TermsOption[] {
  return Object.freeze(rows.map((row) => classifyTermsForRevision(row, previous)));
}

export function eligibleTermsForRevision(
  rows: readonly GovernedAnalysisTermsRow[],
  previous: ExecutionBindingView,
): readonly GovernedAnalysisTermsRow[] {
  return Object.freeze(
    termsOptionsForRevision(rows, previous)
      .filter((o) => o.ineligible === null)
      .map((o) => o.row),
  );
}

/**
 * Is the submit action available, and if not, why not?
 *
 * ONE DECISION IN ONE PLACE. A disabled button whose condition is spread across three `&&`s in JSX is
 * how a screen ends up submitting while a request is already in flight. This returns the reason too,
 * so the screen can say why rather than leaving an operator clicking a dead control.
 */
export type SubmitGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function submitGate(input: {
  readonly selectedTermsRef: string;
  readonly reason: string;
  readonly inFlight: boolean;
  readonly settledExecutionId: string | null;
}): SubmitGate {
  if (input.inFlight) return { ok: false, reason: "a request is already in flight" };
  if (input.settledExecutionId !== null) {
    return { ok: false, reason: "this re-assessment has already been submitted" };
  }
  if (input.selectedTermsRef.trim() === "") return { ok: false, reason: "choose a governed definition" };
  if (input.reason.trim() === "") return { ok: false, reason: "state why this re-assessment exists" };
  return { ok: true };
}

/**
 * The body to send, frozen at the FIRST attempt and replayed verbatim on every retry.
 *
 * WHY IT IS FROZEN, and this is the subtle one. The new execution's identity is derived from its
 * binding, and the reason is NOT part of that binding — so a retry carrying a different reason would
 * create no second execution and would be answered with the first one, whose STORED reason is the
 * original. The screen would then show a revision labelled with text that is not what the record
 * holds. Replaying the exact attempted body keeps what is displayed and what is stored the same
 * sentence; changing the reason requires abandoning the attempt deliberately.
 */
export interface ReassessAttempt {
  readonly boundaryId: string;
  readonly executionId: string;
  readonly analysisTermsId: string;
  readonly analysisTermsVersion: string;
  readonly reason: string;
}

export function freezeAttempt(input: {
  readonly existing: ReassessAttempt | null;
  readonly boundaryId: string;
  readonly executionId: string;
  readonly selected: GovernedAnalysisTermsRow;
  readonly reason: string;
}): ReassessAttempt {
  if (input.existing !== null) return input.existing;
  // NORMALISED HERE, in one place. A stray space on a boundary or execution id is a not-found at best,
  // and trimming only the reason — as an earlier version did — leaves the caller responsible for the
  // rest, which is how one call site ends up sending a padded identifier nobody can explain.
  return Object.freeze({
    boundaryId: input.boundaryId.trim(),
    executionId: input.executionId.trim(),
    analysisTermsId: input.selected.termsId.trim(),
    analysisTermsVersion: input.selected.termsVersion.trim(),
    reason: input.reason.trim(),
  });
}

/**
 * What to tell someone whose request died before they saw an answer.
 *
 * NOT "it failed" and not "try again and hope". The endpoint resolves to the same execution for the
 * same binding, so a verbatim repeat either finds the execution the lost request created or creates
 * it once — there is no path on which retrying produces a second execution or a second revision link.
 * Saying so is the difference between an operator retrying and an operator re-uploading a file.
 */
export function uncertainResponseGuidance(message: string): string {
  return (
    `The request did not return an answer (${message}). It may or may not have reached the server. ` +
    "Retrying is safe and sends exactly the same request: a re-assessment is identified by what it " +
    "measures, so the server resolves a repeat to the same execution rather than creating a second " +
    "one. No file needs re-uploading, and nothing has been replaced either way."
  );
}
