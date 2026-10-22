// What an operator may cite, what the screen refuses to submit twice, and what a retry sends.
//
// The three claims this file is here to pin:
//
//   1. The eligibility reasons are the SERVER'S refusals, not invented labels. Each code is checked
//      against `executionCode()`'s own registry, so a drifting or mistyped code fails here rather than
//      appearing on screen next to a sentence that no longer matches what the server would say.
//   2. Submit cannot fire twice. One predicate, in one place, tested at each of its conditions.
//   3. A retry sends the ORIGINAL body. The reason is not part of the binding, so a retry carrying new
//      wording is answered with the execution already recorded — and the screen would then display a
//      sentence the record does not hold. The frozen attempt is what prevents that.
import { describe, it, expect } from "vitest";
import {
  classifyTermsForRevision,
  eligibleTermsForRevision,
  freezeAttempt,
  submitGate,
  termsOptionsForRevision,
  uncertainResponseGuidance,
} from "./reassessment";
import { executionCode } from "../../contract/executionCodes";
import type { GovernedAnalysisTermsRow } from "../../data/pilotAnalysisTermsClient";
import type { ExecutionBindingView } from "../../data/pilotAssessmentClient";

const OLDER_METHOD = "assess-2026.0-older";

const PREVIOUS: ExecutionBindingView = Object.freeze({
  boundaryId: "pb-1",
  datasetFingerprint: "f".repeat(64),
  admissionDecisionId: `PAD-${"a".repeat(32)}`,
  admissionPolicyId: "pol-1",
  admissionPolicyVersion: "1.0.0",
  admissionPolicyHash: `sha256:${"b".repeat(64)}`,
  contractVersion: "2.0.0",
  assessmentPolicy: Object.freeze({
    policyId: "terms-1",
    policyVersion: "0.9.0",
    calculationMethodVersion: OLDER_METHOD,
    asOf: "2026-04-15",
    stallThresholdDays: 30,
    currency: "USD",
  }),
  interpretation: Object.freeze({ mappingId: "m-1", amountFormat: "auto", dateLocale: "auto" }),
  recoveryCaseId: null,
});

/** A definition that differs from the previous reading only in the method it blesses. */
function row(over: Partial<GovernedAnalysisTermsRow> = {}): GovernedAnalysisTermsRow {
  return Object.freeze({
    termsRef: "terms-1@1.1.0",
    termsId: "terms-1",
    termsVersion: "1.1.0",
    asOf: "2026-04-15",
    stallThresholdDays: 30,
    currency: "USD",
    calculationMethodVersion: "assess-2026.1-thin",
    termsHash: `sha256:${"c".repeat(64)}`,
    state: "ACTIVE",
    mayMeasure: true,
    ...over,
  });
}

describe("which governed definitions may be cited for a re-assessment", () => {
  it("a definition that moves only the METHOD is eligible", () => {
    const option = classifyTermsForRevision(row(), PREVIOUS);
    expect(option.ineligible).toBeNull();
    expect(eligibleTermsForRevision([row()], PREVIOUS)).toHaveLength(1);
  });

  it("a definition that is not in force is ineligible, and FIRST — before anyone asks what it measures", () => {
    // Order matters and it is the server's order: an unapproved definition's values are not a proposal
    // to evaluate. A draft that ALSO changes the cut-off must report the governance reason, not the
    // measurement one, or an operator would go and fix the wrong thing.
    for (const state of ["DRAFT", "FROZEN", "RETIRED"] as const) {
      const option = classifyTermsForRevision(
        row({ state, mayMeasure: false, asOf: "2026-05-15" }),
        PREVIOUS,
      );
      expect(option.ineligible?.kind, state).toBe("NOT_ACTIVE");
      expect(option.ineligible?.code, state).toBe("NH-AX-1010");
      expect(option.ineligible?.detail, state).toContain(state);
    }
  });

  it("a definition that changes WHAT IS MEASURED is ineligible, and NAMES each field", () => {
    const cases: readonly [Partial<GovernedAnalysisTermsRow>, readonly string[]][] = [
      [{ asOf: "2026-05-15" }, ["asOf"]],
      [{ stallThresholdDays: 7 }, ["stallThresholdDays"]],
      [{ currency: "EUR" }, ["currency"]],
      [{ asOf: "2026-05-15", currency: "EUR" }, ["asOf", "currency"]],
    ];
    for (const [over, fields] of cases) {
      const option = classifyTermsForRevision(row(over), PREVIOUS);
      expect(option.ineligible?.kind, JSON.stringify(over)).toBe("CHANGES_WHAT_IS_MEASURED");
      expect(option.ineligible?.code).toBe("NH-AX-1016");
      expect(
        option.ineligible?.kind === "CHANGES_WHAT_IS_MEASURED" ? option.ineligible.fields : [],
      ).toEqual(fields);
      // The remedy is re-submission, and the sentence has to say so — this is the one refusal whose
      // answer is "supply the extract again", and an operator who is not told that will not guess it.
      expect(option.ineligible?.detail).toContain("re-submitted");
    }
  });

  it("a definition naming the method ALREADY USED is ineligible — there is nothing to re-assess", () => {
    // THE NO-OP CASE, and the reason this module exists. Without it, the obvious move — cite the
    // definition the execution already ran under — is answered by a refusal the operator could have
    // been shown in advance.
    const option = classifyTermsForRevision(row({ calculationMethodVersion: OLDER_METHOD }), PREVIOUS);
    expect(option.ineligible?.kind).toBe("SAME_METHOD");
    expect(option.ineligible?.code).toBe("NH-AX-1017");
    expect(option.ineligible?.detail).toContain(OLDER_METHOD);
    expect(eligibleTermsForRevision([row({ calculationMethodVersion: OLDER_METHOD })], PREVIOUS)).toEqual([]);
  });

  it("EVERY code it reports is one the SERVER'S OWN REGISTRY defines", () => {
    // The load-bearing check of this file. A code invented here, or mistyped, would put a refusal on
    // screen that the server never issues — and nothing else would notice.
    const expected: readonly [string, string][] = [
      ["analysis_terms_not_governed", "NH-AX-1010"],
      ["reassessment_terms_not_method_only", "NH-AX-1016"],
      ["reassessment_no_method_change", "NH-AX-1017"],
    ];
    for (const [refusal, code] of expected) {
      expect(executionCode(refusal as never).code, refusal).toBe(code);
    }
    const reported = new Set(
      termsOptionsForRevision(
        [
          row({ state: "DRAFT", mayMeasure: false }),
          row({ asOf: "2026-05-15" }),
          row({ calculationMethodVersion: OLDER_METHOD }),
        ],
        PREVIOUS,
      )
        .map((o) => o.ineligible?.code)
        .filter((c) => c !== undefined),
    );
    expect([...reported].sort()).toEqual(expected.map(([, c]) => c).sort());
  });

  it("classification preserves the server's order and classifies every row", () => {
    const rows = [row({ termsRef: "a", calculationMethodVersion: OLDER_METHOD }), row({ termsRef: "b" })];
    const options = termsOptionsForRevision(rows, PREVIOUS);
    expect(options.map((o) => o.row.termsRef)).toEqual(["a", "b"]);
    expect(options.map((o) => o.ineligible === null)).toEqual([false, true]);
  });
});

describe("submitting exactly once", () => {
  const base = { selectedTermsRef: "terms-1@1.1.0", reason: "the method moved", inFlight: false, settledExecutionId: null };

  it("permits a complete, idle, unanswered submission", () => {
    expect(submitGate(base)).toEqual({ ok: true });
  });

  it("refuses while a request is IN FLIGHT — the duplicate-click case", () => {
    const gate = submitGate({ ...base, inFlight: true });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("already in flight");
  });

  it("refuses once an answer exists, so a second submission cannot be made from a settled screen", () => {
    const gate = submitGate({ ...base, settledExecutionId: `PAX-${"d".repeat(32)}` });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("already been submitted");
  });

  it("refuses a blank selection and a blank or whitespace-only reason, each with its own sentence", () => {
    expect(submitGate({ ...base, selectedTermsRef: "  " }).ok).toBe(false);
    const blank = submitGate({ ...base, reason: "   " });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.reason).toContain("state why");
  });
});

describe("retrying after an uncertain response", () => {
  const selected = row();

  it("freezes the body on the FIRST attempt and replays it verbatim afterwards", () => {
    const first = freezeAttempt({
      existing: null, boundaryId: " pb-1 ", executionId: " PAX-1 ", selected, reason: "  the method moved  ",
    });
    expect(first).toEqual({
      boundaryId: "pb-1",
      executionId: "PAX-1",
      analysisTermsId: "terms-1",
      analysisTermsVersion: "1.1.0",
      reason: "the method moved",
    });

    // THE CASE THAT MATTERS. The operator edits the reason, or picks another definition, and retries.
    // The revision's identity comes from its binding, so the server answers with the execution the
    // lost request already created — whose stored reason is the first one. Replaying the frozen body
    // keeps what is displayed and what is stored the same sentence.
    const retry = freezeAttempt({
      existing: first,
      boundaryId: "pb-1",
      executionId: "PAX-1",
      selected: row({ termsVersion: "2.0.0" }),
      reason: "actually, finance asked for it",
    });
    expect(retry).toBe(first);
  });

  it("explains WHY a retry is safe, and never suggests re-uploading", () => {
    const text = uncertainResponseGuidance("fetch failed");
    expect(text).toContain("fetch failed");
    expect(text).toContain("Retrying is safe");
    expect(text).toContain("same execution");
    expect(text).toMatch(/No file needs re-uploading/);
    // "may or may not have reached the server" is the honest state. A message that claimed the request
    // failed would send an operator to re-supply a file the system still holds.
    expect(text).toContain("may or may not have reached the server");
  });
});
