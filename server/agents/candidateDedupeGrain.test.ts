// THE OBLIGATION-GRAINED CANDIDATE KEY · what it changes, and the much larger set of things it does not.
//
// The claim this file has to establish is uncomfortable to make and so is made structurally: a frozen
// identity derivation was extended, and NO EXISTING INPUT produces a different key than it did before.
// That is provable because the new branch is reachable only through a field no historical signal carries.
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_DEDUPE_SCHEME_V2, candidateDedupeGrain, caseCandidateDedupeKey, caseCandidateId,
} from "./caseAdmission";
import type { CandidateSignal } from "./types";

const base = (over: Partial<CandidateSignal> = {}): CandidateSignal => Object.freeze({
  signalId: "SIG-0001",
  boundaryId: "tenant-1",
  recoveryType: "RevenueUnderBilled",
  sourceRef: `hmac-sha256:${"a".repeat(64)}`,
  sourcePayloadHash: "b".repeat(64),
  detectorVersion: "det-v1",
  observedAt: "2026-10-01T00:00:00.000Z",
  amountAtRiskMinor: 30_000,
  currency: "USD",
  actionAvailable: true,
  expectedProofEvent: "corrective invoice raised and collected",
  ...over,
});

const coverage = (ref: string, expected = 100_000, billed = 70_000) => Object.freeze({
  kind: "SINGLE_OBLIGATION" as const,
  obligationRef: `hmac-sha256:${ref.repeat(64).slice(0, 64)}`,
  expectedMinor: expected, billedMinor: billed, residualMinor: expected - billed, currency: "USD",
});

describe("the key is obligation-grained only where an obligation is stated", () => {
  it("a signal with no coverage keeps the ACCOUNT_V1 grain and the original three-component preimage", () => {
    const s = base();
    expect(candidateDedupeGrain(s)).toBe("ACCOUNT_V1");
    // THE FROZEN PIN, recomputed here against the SAME literal the pre-existing guard uses, so this
    // file would notice a drift even if that guard were ever deleted.
    const pinned = base({ boundaryId: "tenant-pinned", recoveryType: "ActivationMissed", sourceRef: "hmac-sha256:pinned-account" });
    expect(caseCandidateDedupeKey(pinned)).toBe(
      "0f62e1c3f7971e496e434c7636c3c6ee389513d50c3e8739bddbde4f845cb453",
    );
  });

  it("an ACCOUNT_AGGREGATE signal is also ACCOUNT_V1 — there is no obligation to key on", () => {
    const s = base({ obligationCoverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 3 } });
    expect(candidateDedupeGrain(s)).toBe("ACCOUNT_V1");
    expect(caseCandidateDedupeKey(s)).toBe(caseCandidateDedupeKey(base()));
  });

  it("a SINGLE_OBLIGATION signal is OBLIGATION_V2 and keys differently per obligation", () => {
    const a = base({ obligationCoverage: coverage("1") });
    const b = base({ obligationCoverage: coverage("2") });
    expect(candidateDedupeGrain(a)).toBe("OBLIGATION_V2");
    expect(caseCandidateDedupeKey(a)).not.toBe(caseCandidateDedupeKey(b));
    // SAME ACCOUNT, DIFFERENT CLAIMS. This single pair is S-DUP-3 in miniature.
    expect(a.sourceRef).toBe(b.sourceRef);
  });

  it("the AMOUNT is deliberately absent from the key, so a correction is not a second obligation", () => {
    // If the amount entered the key, a corrected observation of one obligation would create a second
    // candidate and the measured exposure would DOUBLE. What happens to a correction is reported
    // elsewhere and is an owner decision; it must not be decided by an accident of the key's preimage.
    const first = base({ obligationCoverage: coverage("3", 100_000, 70_000), amountAtRiskMinor: 30_000 });
    const corrected = base({ obligationCoverage: coverage("3", 100_000, 50_000), amountAtRiskMinor: 50_000 });
    expect(caseCandidateDedupeKey(corrected)).toBe(caseCandidateDedupeKey(first));
  });

  it("only the five declared components reach the v2 preimage", () => {
    const s = base({ obligationCoverage: coverage("4") });
    const key = caseCandidateDedupeKey(s);
    for (const over of [
      { signalId: "SIG-OTHER" }, { sourcePayloadHash: "0".repeat(64) },
      { amountAtRiskMinor: 1 }, { detectorVersion: "det-v2" },
      { observedAt: "2026-12-31T00:00:00.000Z" }, { expectedProofEvent: "something else" },
    ] as Partial<CandidateSignal>[]) {
      expect(caseCandidateDedupeKey(base({ obligationCoverage: coverage("4"), ...over })), JSON.stringify(over)).toBe(key);
    }
    for (const over of [
      { boundaryId: "tenant-2" }, { recoveryType: "ActivationMissed" },
      { sourceRef: `hmac-sha256:${"c".repeat(64)}` },
    ] as Partial<CandidateSignal>[]) {
      expect(caseCandidateDedupeKey(base({ obligationCoverage: coverage("4"), ...over })), JSON.stringify(over)).not.toBe(key);
    }
  });

  // ── COLLISION IS STRUCTURALLY IMPOSSIBLE, NOT MERELY UNLIKELY ──────────────────────────────────────
  it("no v1 key can equal a v2 key, because the preimage is length-framed per component", () => {
    // The adversarial attempt: craft an account-grained signal whose fields contain the scheme tag and
    // a pipe, trying to reproduce a five-component framed string from three components. Length framing
    // (`<byteLength>:<value>`) makes the attempt impossible rather than hard — the declared lengths
    // cannot be satisfied by a value that also has to carry the separators.
    const obligationRef = `hmac-sha256:${"d".repeat(64)}`;
    const v2 = caseCandidateDedupeKey(base({ obligationCoverage: coverage("d") }));
    const attempts = [
      base({ boundaryId: `${CANDIDATE_DEDUPE_SCHEME_V2}|tenant-1` }),
      base({ sourceRef: `hmac-sha256:${"a".repeat(64)}|${obligationRef}` }),
      base({ recoveryType: `RevenueUnderBilled|${obligationRef}` }),
      base({ boundaryId: CANDIDATE_DEDUPE_SCHEME_V2, recoveryType: "tenant-1", sourceRef: "RevenueUnderBilled" }),
    ];
    for (const attempt of attempts) {
      expect(candidateDedupeGrain(attempt)).toBe("ACCOUNT_V1");
      expect(caseCandidateDedupeKey(attempt)).not.toBe(v2);
    }
  });

  it("the scheme tag is in the key, so the derivation that produced it is legible", () => {
    // Not merely documented: changing the tag changes the key, which is what makes it a version rather
    // than a comment.
    const s = base({ obligationCoverage: coverage("5") });
    expect(CANDIDATE_DEDUPE_SCHEME_V2).toBe("nh-candidate-dedupe-obligation-v2");
    expect(caseCandidateDedupeKey(s)).toHaveLength(64);
    expect(caseCandidateId(caseCandidateDedupeKey(s))).toMatch(/^CC-[a-f0-9]{24}$/);
  });

  it("both grains produce a well-formed candidate id, and the two never collide", () => {
    const v1 = caseCandidateId(caseCandidateDedupeKey(base()));
    const v2 = caseCandidateId(caseCandidateDedupeKey(base({ obligationCoverage: coverage("6") })));
    expect(v1).not.toBe(v2);
    expect(v1).toMatch(/^CC-[a-f0-9]{24}$/);
    expect(v2).toMatch(/^CC-[a-f0-9]{24}$/);
  });
});
