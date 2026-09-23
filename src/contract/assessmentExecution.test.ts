import { describe, it, expect } from "vitest";
import {
  EXECUTION_PROJECTION_SCHEME,
  assessmentPolicyRef,
  canTransitionExecution,
  canonicalExecutionInput,
  deriveAdmissionDecisionId,
  deriveExecutionId,
  deriveExecutionState,
  hashExecutionBinding,
  hashExecutionInput,
  hashFinding,
  isTerminalExecutionState,
  projectExecutionInput,
  runProjectedAssessment,
  type ExecutionBinding,
  type ExecutionLifecycleEvent,
  type ExecutionTransition,
} from "./assessmentExecution";
import { EXECUTION_REFUSAL_CODES, allExecutionCodes, executionCode } from "./executionCodes";
import { makePolicy } from "../assessment/policy";
import type { ExpectationCycle } from "../assessment/types";

const POLICY = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

const BINDING: ExecutionBinding = Object.freeze({
  boundaryId: "synthetic-boundary-0001",
  datasetFingerprint: "a".repeat(64),
  admissionDecisionId: "PAD-" + "b".repeat(32),
  admissionPolicyId: "synthetic-pol",
  admissionPolicyVersion: "1.0.0",
  admissionPolicyHash: "sha256:" + "c".repeat(64),
  contractVersion: "1.1.0",
  assessmentPolicy: assessmentPolicyRef(POLICY),
  interpretation: Object.freeze({ mappingId: "map-1", amountFormat: "auto", dateLocale: "auto" }),
  recoveryCaseId: null,
});

function cycle(over: Partial<ExpectationCycle> = {}): ExpectationCycle {
  return {
    cycleId: "CUST-ACME::SUB-9",
    sourceRowId: "row-2",
    entityId: "CUST-ACME",
    expectationAt: "2026-01-01",
    observationAt: null,
    monetaryEvent: {
      dueAt: "2026-02-01",
      amount: { minor: 10_000, currency: "USD" },
      paidAt: null,
      paidAmount: null,
      refundedAt: null,
      cancelledAt: null,
    },
    currency: "USD",
    statusRaw: "active — Acme Corp primary contact jane@acme.example",
    attributes: { plan: "enterprise-acme", segment: "named-account-acme", paid_timing: "unknown_from_bool" },
    ...over,
  } as ExpectationCycle;
}

const event = (
  transition: ExecutionTransition,
  code: string | null = null,
): ExecutionLifecycleEvent => ({ transition, code, byId: "w1", at: "2026-03-01T00:00:00.000Z" });

describe("EP-16 · execution identity is deterministic and binds every governing input", () => {
  it("derives the same id for the same binding and a different id for every changed field", async () => {
    const base = await deriveExecutionId(BINDING);
    expect(base).toMatch(/^PAX-[a-f0-9]{32}$/);
    expect(await deriveExecutionId({ ...BINDING })).toBe(base);

    // Each of these changes what the run MEANS, so each must produce a different execution rather
    // than silently re-grading the first one.
    const variants: ExecutionBinding[] = [
      { ...BINDING, boundaryId: "other-boundary" },
      { ...BINDING, datasetFingerprint: "d".repeat(64) },
      { ...BINDING, admissionDecisionId: "PAD-" + "e".repeat(32) },
      { ...BINDING, admissionPolicyId: "other-pol" },
      { ...BINDING, admissionPolicyVersion: "2.0.0" },
      { ...BINDING, admissionPolicyHash: "sha256:" + "f".repeat(64) },
      { ...BINDING, contractVersion: "1.0.0" },
      { ...BINDING, recoveryCaseId: "RC-1" },
      {
        ...BINDING,
        assessmentPolicy: assessmentPolicyRef(
          makePolicy({ stallThresholdDays: 30, asOf: "2026-04-01", currency: "USD" }),
        ),
      },
      {
        ...BINDING,
        assessmentPolicy: assessmentPolicyRef(
          makePolicy({ stallThresholdDays: 45, asOf: "2026-03-01", currency: "USD" }),
        ),
      },
      { ...BINDING, interpretation: { ...BINDING.interpretation, mappingId: "map-2" } },
      { ...BINDING, interpretation: { ...BINDING.interpretation, amountFormat: "EU" } },
      { ...BINDING, interpretation: { ...BINDING.interpretation, dateLocale: "DMY" } },
    ];
    const ids = await Promise.all(variants.map(deriveExecutionId));
    expect(new Set([base, ...ids]).size).toBe(variants.length + 1);
  });

  it("derives an admission decision id that changes with every decision field", async () => {
    const ref = {
      boundaryId: "b1",
      idempotencyKey: "pds_" + "1".repeat(64),
      datasetFingerprint: "a".repeat(64),
      contractVersion: "1.1.0",
      outcome: "ADMISSIBLE",
      admissionPolicyId: "pol",
      admissionPolicyVersion: "1.0.0",
      admissionPolicyHash: "sha256:" + "c".repeat(64),
    };
    const base = await deriveAdmissionDecisionId(ref);
    expect(base).toMatch(/^PAD-[a-f0-9]{32}$/);
    // The outcome is part of the identity: a NOT_ADMISSIBLE decision can never be presented as the
    // ADMISSIBLE one just by changing the stored outcome, because the id would no longer match.
    expect(await deriveAdmissionDecisionId({ ...ref, outcome: "NOT_ADMISSIBLE" })).not.toBe(base);
    expect(await deriveAdmissionDecisionId({ ...ref, boundaryId: "b2" })).not.toBe(base);
    expect(await deriveAdmissionDecisionId({ ...ref, admissionPolicyHash: null })).not.toBe(base);
  });

  it("hashes the binding to a stable sha256 reference", async () => {
    const hash = await hashExecutionBinding(BINDING);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await hashExecutionBinding({ ...BINDING })).toBe(hash);
  });
});

describe("EP-16 · the five-state lifecycle is derived, fail-closed, and ignores illegal events", () => {
  it("returns null for an empty log rather than assuming queued", () => {
    expect(deriveExecutionState([])).toBeNull();
  });

  it("walks the ordinary path queued → running → completed", () => {
    expect(deriveExecutionState([event("SCHEDULED")])).toBe("queued");
    expect(deriveExecutionState([event("SCHEDULED"), event("CLAIMED")])).toBe("running");
    expect(
      deriveExecutionState([event("SCHEDULED"), event("CLAIMED"), event("COMPLETED")]),
    ).toBe("completed");
  });

  it("treats blocked and completed as terminal — nothing moves out of a verdict", () => {
    const blocked = [event("SCHEDULED"), event("CLAIMED"), event("BLOCKED", "NH-AX-2001")];
    expect(deriveExecutionState(blocked)).toBe("blocked");
    expect(deriveExecutionState([...blocked, event("CLAIMED"), event("COMPLETED")])).toBe("blocked");

    const done = [event("SCHEDULED"), event("CLAIMED"), event("COMPLETED")];
    expect(deriveExecutionState([...done, event("FAILED", "NH-AX-3001")])).toBe("completed");

    expect(isTerminalExecutionState("blocked")).toBe(true);
    expect(isTerminalExecutionState("completed")).toBe(true);
    expect(isTerminalExecutionState("running")).toBe(false);
    expect(isTerminalExecutionState(null)).toBe(false);
  });

  it("re-claims after a failure and after a lost lease, which is what retry and recovery look like", () => {
    expect(
      deriveExecutionState([
        event("SCHEDULED"),
        event("CLAIMED"),
        event("FAILED", "NH-AX-3001"),
        event("CLAIMED"),
        event("COMPLETED"),
      ]),
    ).toBe("completed");
    // Expired lease: the previous worker never released, so the log still reads `running` when the
    // next worker legitimately takes over.
    expect(
      deriveExecutionState([event("SCHEDULED"), event("CLAIMED"), event("CLAIMED"), event("COMPLETED")]),
    ).toBe("completed");
  });

  it("ignores an illegal transition rather than applying it", () => {
    // A COMPLETED with nothing claimed is not a completion; the safe reading of a tampered log is
    // the state its LEGAL events produced.
    expect(deriveExecutionState([event("SCHEDULED"), event("COMPLETED")])).toBe("queued");
    // A replayed SCHEDULED cannot reset a running execution back to queued.
    expect(
      deriveExecutionState([event("SCHEDULED"), event("CLAIMED"), event("SCHEDULED")]),
    ).toBe("running");
  });

  it("agrees with canTransitionExecution on every pair it allows", () => {
    expect(canTransitionExecution(null, "SCHEDULED")).toBe(true);
    expect(canTransitionExecution("queued", "SCHEDULED")).toBe(false);
    expect(canTransitionExecution("queued", "CLAIMED")).toBe(true);
    expect(canTransitionExecution("running", "COMPLETED")).toBe(true);
    expect(canTransitionExecution("running", "RELEASED")).toBe(true);
    expect(canTransitionExecution("blocked", "CLAIMED")).toBe(false);
    expect(canTransitionExecution("completed", "FAILED")).toBe(false);
    expect(canTransitionExecution(null, "CLAIMED")).toBe(false);
  });
});

describe("EP-16 · the execution input is de-identified and carries only accepted cycles", () => {
  it("replaces identifiers with ordinals and drops free-text customer fields", () => {
    const projected = projectExecutionInput([cycle()]);
    const only = projected.cycles[0]!;

    expect(projected.scheme).toBe(EXECUTION_PROJECTION_SCHEME);
    expect(only.cycleId).toBe("c-0001");
    expect(only.entityId).toBe("e-0001");
    expect(only.sourceRowId).toBe("r-0001");
    // statusRaw carried an email address in the fixture. It must not survive.
    expect(only.statusRaw).toBeNull();
    expect(only.attributes).toEqual({ paid_timing: "unknown_from_bool" });

    const serialized = canonicalExecutionInput(projected);
    for (const leak of ["CUST-ACME", "SUB-9", "jane@acme.example", "enterprise-acme", "named-account-acme", "row-2"]) {
      expect(serialized).not.toContain(leak);
    }
    // The arithmetic's inputs DO survive — dropping them would change the answer, not protect anyone.
    expect(only.monetaryEvent.amount).toEqual({ minor: 10_000, currency: "USD" });
    expect(only.expectationAt).toBe("2026-01-01");
  });

  it("preserves equality classes, so cycles that shared an entity still share one", () => {
    const projected = projectExecutionInput([
      cycle({ cycleId: "A::1", entityId: "E1", sourceRowId: "r1" }),
      cycle({ cycleId: "A::2", entityId: "E1", sourceRowId: "r2" }),
      cycle({ cycleId: "B::1", entityId: "E2", sourceRowId: "r3" }),
    ]);
    expect(projected.cycles.map((c) => c.entityId)).toEqual(["e-0001", "e-0001", "e-0002"]);
    expect(projected.cycles.map((c) => c.cycleId)).toEqual(["c-0001", "c-0002", "c-0003"]);
  });

  it("omits attributes entirely when the source carried no paid_timing marker", () => {
    const projected = projectExecutionInput([cycle({ attributes: { plan: "x", segment: "y" } })]);
    expect(projected.cycles[0]!.attributes).toEqual({});
  });

  it("hashes deterministically and changes when a single value is altered", async () => {
    const a = await hashExecutionInput(projectExecutionInput([cycle()]));
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await hashExecutionInput(projectExecutionInput([cycle()]))).toBe(a);

    const tampered = projectExecutionInput([cycle()]);
    const altered = {
      ...tampered,
      cycles: [
        {
          ...tampered.cycles[0]!,
          monetaryEvent: { ...tampered.cycles[0]!.monetaryEvent, amount: { minor: 10_001, currency: "USD" } },
        },
      ],
    };
    expect(await hashExecutionInput(altered)).not.toBe(a);
  });

  it("projects an empty list to an empty input rather than inventing a cycle", () => {
    expect(projectExecutionInput([]).cycles).toEqual([]);
  });
});

describe("EP-16 · a finding is an observation and never a proof or a revenue claim", () => {
  const input = projectExecutionInput([
    // Stalled: signed 2026-01-01, never activated, due 2026-02-01, threshold 30d, asOf 2026-03-01.
    cycle({ cycleId: "A::1", entityId: "E1", sourceRowId: "r1" }),
    // Reference: observed well within the threshold.
    cycle({ cycleId: "B::1", entityId: "E2", sourceRowId: "r2", observationAt: "2026-01-05" }),
  ]);

  const finding = runProjectedAssessment({
    executionId: "PAX-" + "0".repeat(32),
    binding: BINDING,
    input,
    policy: POLICY,
    createdAt: "2026-03-02T00:00:00.000Z",
  });

  it("reports cohorts and exact minor units over the accepted cycles", () => {
    expect(finding.acceptedCycleCount).toBe(2);
    expect(finding.stalledCount).toBe(1);
    expect(finding.referenceCount).toBe(1);
    expect(finding.currency).toBe("USD");
    expect(finding.observedUnpaidMinor).toBe(10_000);
    expect(Number.isSafeInteger(finding.observedUnpaidMinor)).toBe(true);
  });

  it("declares its claim boundary and exposes no proof, revenue or case field", () => {
    expect(finding.claimBoundary).toEqual({
      observationOnly: true,
      constitutesProof: false,
      constitutesRevenue: false,
      createsRecoveryCase: false,
    });
    // A structural sweep, not a spot check: no key anywhere in the finding may name a counted
    // concept. The claim-boundary flags are excluded because they are the DENIAL of those concepts.
    const forbidden = /proof|proven|auditable|revenuereturned|collected|recovered|baseline|ledger/i;
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (path === "" && key === "claimBoundary") continue;
        expect(`${path}.${key}`, `${path}.${key} names a counted concept`).not.toMatch(forbidden);
        walk(child, `${path}.${key}`);
      }
    };
    walk(finding, "");
  });

  it("is deterministic, so a retry re-derives byte-identical content", async () => {
    const again = runProjectedAssessment({
      executionId: "PAX-" + "0".repeat(32),
      binding: BINDING,
      input,
      policy: POLICY,
      // A different wall clock must not change the finding — otherwise a retry could never be
      // recognised as a repeat of the same answer.
      createdAt: "2027-11-11T11:11:11.111Z",
    });
    expect(await hashFinding(again)).toBe(await hashFinding(finding));
    expect(again.assessmentId).toBe(finding.assessmentId);
  });
});

describe("EP-16 · the refusal catalogue is total and stable", () => {
  it("gives every refusal a unique, well-formed code with a remediation", () => {
    const codes = allExecutionCodes();
    expect(codes.length).toBe(Object.keys(EXECUTION_REFUSAL_CODES).length);
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
    for (const spec of codes) {
      expect(spec.code).toMatch(/^NH-AX-[1-3]\d{3}$/);
      expect(spec.title.trim().length).toBeGreaterThan(0);
      expect(spec.remediation.trim().length).toBeGreaterThan(0);
    }
  });

  it("puts each code in the band its severity implies", () => {
    const band: Record<string, string> = { refused: "1", blocked: "2", failed: "3" };
    for (const spec of allExecutionCodes()) {
      expect(spec.code.slice("NH-AX-".length, "NH-AX-".length + 1)).toBe(band[spec.severity]);
    }
  });

  it("resolves every refusal reason — the map is total by construction", () => {
    for (const reason of Object.keys(EXECUTION_REFUSAL_CODES)) {
      expect(executionCode(reason as keyof typeof EXECUTION_REFUSAL_CODES).code).toMatch(/^NH-AX-/);
    }
  });
});
