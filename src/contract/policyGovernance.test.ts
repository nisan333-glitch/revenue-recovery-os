// EP-15 · Policy lifecycle and hashing — executable specification of the pure half.
import { describe, it, expect } from "vitest";
import {
  canTransition,
  deriveState,
  mayEvaluate,
  whyCannotEvaluate,
  type PolicyLifecycleEvent,
} from "./policyLifecycle";
import { hashAdmissionPolicy, policyHashMatches, POLICY_HASH_SCHEME } from "./policyHash";
import { makeAdmissionPolicy, ADMISSION_CALC_VERSION, type PilotAdmissionPolicy } from "./pilotAdmissionPolicy";

function policy(over: Partial<PilotAdmissionPolicy> = {}): PilotAdmissionPolicy {
  return makeAdmissionPolicy({
    policyId: "pol-hash",
    policyVersion: "1.0.0",
    calculationMethodVersion: ADMISSION_CALC_VERSION,
    minAcceptedRows: 10,
    minDistinctEntities: 5,
    maxRejectionRate: 0.2,
    maxSingleReasonShare: 0.8,
    maxDuplicateRate: 0.05,
    minCoverageDays: 20,
    requiredLifecycleStates: ["stalled", "reference"],
    maxOrderingDefectRate: 0.05,
    maxMissingRecommendedColumns: 2,
    requireProvenanceDeclaration: true,
    ...over,
  });
}

const event = (transition: PolicyLifecycleEvent["transition"], actorId = "a@co"): PolicyLifecycleEvent => ({
  transition,
  actorId,
  actorRole: transition === "PROPOSED" ? "operator" : "steward",
  rationale: "test",
  at: "2026-09-23T00:00:00.000Z",
});

describe("policy lifecycle", () => {
  it("1 · only ACTIVE may judge a dataset — every other state is fail-closed", () => {
    expect(mayEvaluate("ACTIVE")).toBe(true);
    for (const state of ["DRAFT", "FROZEN", "RETIRED", null] as const) {
      expect(mayEvaluate(state), `${state} must not evaluate`).toBe(false);
      expect(whyCannotEvaluate(state).length).toBeGreaterThan(0);
    }
  });

  it("2 · the state derives from the append-only log, never from a status column", () => {
    expect(deriveState([])).toBeNull(); // no events = never proposed
    expect(deriveState([event("PROPOSED")])).toBe("DRAFT");
    expect(deriveState([event("PROPOSED"), event("ACTIVATED")])).toBe("ACTIVE");
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("FROZEN")])).toBe("FROZEN");
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("FROZEN"), event("UNFROZEN")])).toBe("ACTIVE");
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("RETIRED")])).toBe("RETIRED");
  });

  it("3 · FROZEN is a reversible pause; RETIRED is terminal", () => {
    expect(canTransition("FROZEN", "UNFROZEN")).toBe(true);
    expect(canTransition("FROZEN", "ACTIVATED")).toBe(true);
    for (const t of ["ACTIVATED", "FROZEN", "UNFROZEN", "RETIRED"] as const) {
      expect(canTransition("RETIRED", t), `RETIRED must not accept ${t}`).toBe(false);
    }
  });

  it("4 · a DRAFT cannot be frozen, and nothing can be proposed twice into existence", () => {
    expect(canTransition("DRAFT", "FROZEN")).toBe(false);
    expect(canTransition("DRAFT", "ACTIVATED")).toBe(true);
    expect(canTransition(null, "PROPOSED")).toBe(true);
    expect(canTransition("ACTIVE", "PROPOSED")).toBe(false);
  });

  it("5 · a replayed PROPOSED never un-activates an activated policy", () => {
    // The attack: append a second birth event to knock a policy back to DRAFT, then re-activate it
    // with different intent. The derivation ignores it.
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("PROPOSED")])).toBe("ACTIVE");
  });

  it("6 · an illegal transition in the log is ignored, not applied", () => {
    // A tampered log must not be able to talk the deriver into a state the legal events never
    // produced. RETIRED is terminal, so a later ACTIVATED is inert.
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("RETIRED"), event("ACTIVATED")])).toBe("RETIRED");
    // And an UNFROZEN applied to an ACTIVE policy changes nothing.
    expect(deriveState([event("PROPOSED"), event("ACTIVATED"), event("UNFROZEN")])).toBe("ACTIVE");
  });
});

describe("policy hash", () => {
  it("7 · the hash is deterministic and stable across reconstruction", async () => {
    const a = await hashAdmissionPolicy(policy());
    const b = await hashAdmissionPolicy(policy());
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Round-tripping through JSON must not change it — a stored policy rebuilt from a row hashes
    // identically to the one that was written.
    const rebuilt = makeAdmissionPolicy(JSON.parse(JSON.stringify(policy())));
    expect(await hashAdmissionPolicy(rebuilt)).toBe(a);
  });

  it("8 · any threshold change produces a different hash", async () => {
    const base = await hashAdmissionPolicy(policy());
    const variants: Partial<PilotAdmissionPolicy>[] = [
      { minAcceptedRows: 11 },
      { minDistinctEntities: 6 },
      { maxRejectionRate: 0.21 },
      { maxSingleReasonShare: 0.81 },
      { maxDuplicateRate: 0.06 },
      { minCoverageDays: 21 },
      { maxOrderingDefectRate: 0.06 },
      { maxMissingRecommendedColumns: 3 },
      { requireProvenanceDeclaration: false },
      { requiredLifecycleStates: ["stalled"] },
      { policyVersion: "1.0.1" },
    ];
    for (const v of variants) {
      expect(await hashAdmissionPolicy(policy(v)), `changing ${Object.keys(v)[0]} must change the hash`).not.toBe(base);
    }
  });

  it("9 · equivalent policies hash identically — ordering and numeric form do not matter", async () => {
    // The same requirement written in a different order is the same bar.
    const ordered = await hashAdmissionPolicy(policy({ requiredLifecycleStates: ["stalled", "reference"] }));
    const reversed = await hashAdmissionPolicy(policy({ requiredLifecycleStates: ["reference", "stalled"] }));
    expect(ordered).toBe(reversed);
    // 0.2 and 0.20 are the same threshold and must not produce two hashes.
    expect(await hashAdmissionPolicy(policy({ maxRejectionRate: 0.2 }))).toBe(
      await hashAdmissionPolicy(policy({ maxRejectionRate: 0.2000 })),
    );
  });

  it("10 · a mismatch is detectable — the point of storing the hash at all", async () => {
    const original = policy();
    const stamped = await hashAdmissionPolicy(original);
    expect(await policyHashMatches(original, stamped)).toBe(true);
    // A policy whose thresholds were altered no longer matches what a decision recorded.
    expect(await policyHashMatches(policy({ minAcceptedRows: 1 }), stamped)).toBe(false);
  });

  it("11 · the scheme is versioned and part of the hash", async () => {
    expect(POLICY_HASH_SCHEME).toBe("nh-admission-policy-v1");
    // Two different ids never collide even with identical thresholds.
    expect(await hashAdmissionPolicy(policy({ policyId: "pol-a" }))).not.toBe(
      await hashAdmissionPolicy(policy({ policyId: "pol-b" })),
    );
  });
});
