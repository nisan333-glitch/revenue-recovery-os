// Falsifiers for G1. One positive and one negative for every refusal, plus the two properties the rule
// exists for: a correction that did not precede the money establishes nothing, and causation is never
// claimed by any branch.
import { describe, expect, it } from "vitest";

import { executedCorrection, type CorrectionRecordFacts } from "./executedCorrection";

const fix = (over: Partial<CorrectionRecordFacts> = {}): CorrectionRecordFacts => ({
  evidenceId: "EV-FIX-1",
  sourceSystem: "billing",
  sourceRecordId: "CORRECTIVE-INVOICE-1",
  ingestedAt: "2026-11-08T10:00:00.000Z",
  sourceVerified: true,
  beneficiaryControl: false,
  trustClassification: "independent",
  ...over,
});

const ask = (over: Partial<Parameters<typeof executedCorrection>[0]> = {}) =>
  executedCorrection({
    corrections: [fix()],
    earliestOutcomeIngestedAt: "2026-11-08T12:00:00.000Z",
    ...over,
  });

describe("the positive case", () => {
  it("accepts an authenticated correction ingested before the collection", () => {
    const v = ask();
    expect(v.established).toBe(true);
    expect(v.established && v.correctionEvidenceId).toBe("EV-FIX-1");
    expect(v.established && v.correctionSourceRecordId).toBe("CORRECTIVE-INVOICE-1");
    expect(v.established && v.relationship).toBe("SAME_OBLIGATION_AND_CORRECTION_PRECEDES_COLLECTION");
  });

  it("picks the EARLIEST qualifying correction when several precede the money", () => {
    const v = ask({
      corrections: [
        fix({ evidenceId: "EV-LATE", ingestedAt: "2026-11-08T11:00:00.000Z" }),
        fix({ evidenceId: "EV-EARLY", ingestedAt: "2026-11-08T09:00:00.000Z" }),
      ],
    });
    expect(v.established && v.correctionEvidenceId).toBe("EV-EARLY");
  });

  it("ignores an unauthenticated record when an authenticated one also precedes the money", () => {
    const v = ask({
      corrections: [fix({ evidenceId: "EV-BAD", sourceVerified: false }), fix({ evidenceId: "EV-GOOD" })],
    });
    expect(v.established && v.correctionEvidenceId).toBe("EV-GOOD");
  });
});

describe("every refusal, each on its own", () => {
  it("NO_EXECUTED_CORRECTION_RECORD · nothing records that the billing was fixed", () => {
    const v = ask({ corrections: [] });
    expect(!v.established && v.code).toBe("NO_EXECUTED_CORRECTION_RECORD");
    expect(!v.established && v.reason).toContain("a recovery reason names a mechanism");
  });

  it("CORRECTION_NOT_AUTHENTICATED · each of the three ways, separately", () => {
    for (const over of [
      { sourceVerified: false },
      { beneficiaryControl: true },
      { trustClassification: "beneficiary_controlled" },
    ]) {
      const v = ask({ corrections: [fix(over)] });
      expect(!v.established && v.code, JSON.stringify(over)).toBe("CORRECTION_NOT_AUTHENTICATED");
    }
  });

  it("CORRECTION_NOT_BEFORE_OUTCOME · a fix recorded after the money cannot have caused it", () => {
    const v = ask({ corrections: [fix({ ingestedAt: "2026-11-08T13:00:00.000Z" })] });
    expect(!v.established && v.code).toBe("CORRECTION_NOT_BEFORE_OUTCOME");
  });

  it("CORRECTION_ORDER_NOT_ESTABLISHABLE · a tie is not evidence of lateness", () => {
    // KEPT DISTINCT FROM `NOT_BEFORE` deliberately. "It came after" is a finding; "we cannot tell" is the
    // absence of one, and `timestamp(3)` can place two writes in the same millisecond.
    const tied = ask({ corrections: [fix({ ingestedAt: "2026-11-08T12:00:00.000Z" })] });
    expect(!tied.established && tied.code).toBe("CORRECTION_ORDER_NOT_ESTABLISHABLE");
    const unreadable = ask({ corrections: [fix({ ingestedAt: "not a time" })] });
    expect(!unreadable.established && unreadable.code).toBe("CORRECTION_ORDER_NOT_ESTABLISHABLE");
  });

  it("CORRECTION_OUTCOME_TIME_NOT_ESTABLISHABLE · no collection time, no precedence", () => {
    for (const earliestOutcomeIngestedAt of [null, "not a time"]) {
      const v = ask({ earliestOutcomeIngestedAt });
      expect(!v.established && v.code, String(earliestOutcomeIngestedAt)).toBe("CORRECTION_OUTCOME_TIME_NOT_ESTABLISHABLE");
    }
  });

  it("a tie beside a genuinely LATE record still reports the tie, not lateness", () => {
    const v = ask({
      corrections: [
        fix({ evidenceId: "EV-TIED", ingestedAt: "2026-11-08T12:00:00.000Z" }),
        fix({ evidenceId: "EV-LATE", ingestedAt: "2026-11-08T13:00:00.000Z" }),
      ],
    });
    expect(!v.established && v.code).toBe("CORRECTION_ORDER_NOT_ESTABLISHABLE");
  });
});

describe("the properties the rule exists for", () => {
  it("causation is never established, on any accepting branch", () => {
    // The type is the literal `false`, so this is not a check that a value happens to be false — it is a
    // check that the only value the type permits is the one that claims nothing. The same device as
    // `independentlyAttested: false` and `constitutesProof: false as const`.
    for (const v of [ask(), ask({ corrections: [fix({ evidenceId: "EV-2" }), fix()] })]) {
      expect(v.established).toBe(true);
      expect(v.established && v.causationEstablished).toBe(false);
    }
  });

  it("STRUCTURAL: the verdict has no field in which a recovery reason could substitute for evidence", () => {
    const v = ask();
    expect(v.established).toBe(true);
    if (!v.established) return;
    expect(Object.keys(v).sort()).toEqual([
      "causationEstablished", "correctionEvidenceId", "correctionSourceRecordId", "established", "relationship",
    ]);
  });
});
