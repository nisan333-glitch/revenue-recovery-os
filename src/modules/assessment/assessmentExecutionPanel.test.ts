// EP-16 · What the execution panel must show, and what it must never show.
//
// Rendered to a string with react-dom/server (an existing dependency), so this needs no jsdom and
// no config change — the same approach the other screen tests use.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssessmentExecutionPanel } from "./AssessmentExecutionPanel";
import {
  EXECUTION_STATE_LABELS,
  isSettledState,
  truncateRef,
  type AssessmentExecutionView,
} from "../../data/pilotAssessmentClient";
import type { ExecutionState } from "../../contract/assessmentExecution";

const BINDING: AssessmentExecutionView["binding"] = {
  boundaryId: "pb-1",
  datasetFingerprint: "f".repeat(64),
  admissionDecisionId: "PAD-" + "a".repeat(32),
  admissionPolicyId: "pol-7",
  admissionPolicyVersion: "1.0.0",
  admissionPolicyHash: "sha256:" + "b".repeat(64),
  contractVersion: "1.1.0",
  assessmentPolicy: {
    policyId: "assess-activation-v1",
    policyVersion: "1.0.0",
    calculationMethodVersion: "assess-2026.1-thin",
    asOf: "2026-04-15",
    stallThresholdDays: 30,
    currency: "EUR",
  },
  interpretation: { mappingId: "map-1", amountFormat: "auto", dateLocale: "auto" },
  recoveryCaseId: null,
};

function view(over: Partial<AssessmentExecutionView> = {}): AssessmentExecutionView {
  return {
    executionId: "PAX-" + "c".repeat(32),
    boundaryId: "pb-1",
    state: "completed",
    code: null,
    binding: BINDING,
    bindingHash: "sha256:" + "d".repeat(64),
    inputHash: "sha256:" + "e".repeat(64),
    scheduledByActorId: "operator@company",
    scheduledByRole: "operator",
    scheduledAt: "2026-04-16T09:00:00.000Z",
    events: [
      { transition: "SCHEDULED", code: null, byId: "operator@company", at: "2026-04-16T09:00:00.000Z" },
      { transition: "CLAIMED", code: null, byId: "TASK-x#1", at: "2026-04-16T09:00:01.000Z" },
      { transition: "COMPLETED", code: null, byId: "TASK-x#1", at: "2026-04-16T09:00:02.000Z" },
    ],
    finding: {
      findingHash: "sha256:" + "9".repeat(64),
      producedBy: "pilot-assessment-v1",
      recordedAt: "2026-04-16T09:00:02.000Z",
      finding: {
        executionId: "PAX-" + "c".repeat(32),
        assessmentId: "A-1234abcd",
        calculationMethodVersion: "assess-2026.1-thin",
        acceptedCycleCount: 40,
        excludedCycleCount: 0,
        exclusionCodes: [],
        stalledCount: 12,
        undeterminedCount: 8,
        referenceCount: 20,
        currency: "EUR",
        observedUnpaidMinor: 1_234_567,
        grossEligibleMinor: 2_000_000,
        partialOutstandingMinor: 0,
        excludedValueMinor: 5_000,
        unknownValueMinor: 0,
        stateCounts: { Unpaid: 12 },
        claimBoundary: {
          observationOnly: true,
          constitutesProof: false,
          constitutesRevenue: false,
          createsRecoveryCase: false,
        },
      },
    },
    claimBoundary: {
      observationOnly: true,
      constitutesProof: false,
      constitutesRevenue: false,
      createsRecoveryCase: false,
    },
    ...over,
  };
}

const render = (v: AssessmentExecutionView) =>
  renderToStaticMarkup(createElement(AssessmentExecutionPanel, { execution: v }));

describe("EP-16 · the execution panel distinguishes all five states", () => {
  it.each(["queued", "running", "blocked", "completed", "failed"] as ExecutionState[])(
    "renders %s as its own distinct label",
    (state) => {
      const html = render(view({ state, code: state === "blocked" || state === "failed" ? "NH-AX-1007" : null }));
      expect(html).toContain(EXECUTION_STATE_LABELS[state]);
    },
  );

  it("gives every state a distinct label — none collapses into another", () => {
    const labels = Object.values(EXECUTION_STATE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(5);
  });

  it("tells a blocked run apart from a failed one, because the responses differ", () => {
    const blocked = render(view({ state: "blocked", code: "NH-AX-2001", finding: null }));
    expect(blocked).toContain("NH-AX-2001");
    expect(blocked).toContain("refused by a check");
    expect(blocked).toMatch(/retrying cannot change the answer/i);

    const failed = render(view({ state: "failed", code: "NH-AX-3001", finding: null }));
    expect(failed).toContain("NH-AX-3001");
    expect(failed).toMatch(/retried automatically/i);
    expect(failed).not.toMatch(/retrying cannot change the answer/i);
  });

  it("shows no refusal banner when nothing was refused", () => {
    const html = render(view());
    expect(html).not.toContain("NH-AX-");
    expect(html).not.toMatch(/refused by a check/i);
  });
});

describe("EP-16 · the panel never presents an observation as money returned", () => {
  it("labels the figures as Revenue Opportunity and denies proof and revenue in words", () => {
    const html = render(view());
    expect(html).toMatch(/Revenue Opportunity/);
    expect(html).toContain("observation only — not proof, not revenue");
    expect(html).toMatch(/no dollar here has been recovered, proven, or counted/i);
    expect(html).toMatch(/created no recovery case/i);
  });

  it("renders exact minor units in the finding's OWN currency, never a hardcoded one", () => {
    const html = render(view());
    // 1_234_567 minor EUR = €12,345.67 — exact, and not re-denominated into dollars.
    expect(html).toContain("12,345.67");
    expect(html).toMatch(/€/);
    expect(html).not.toContain("$");
  });

  it("never claims a proven or auditable figure anywhere in the markup", () => {
    const html = render(view());
    for (const forbidden of ["Revenue Returned", "Auditable Revenue", "Proven", "Recovered"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe("EP-16 · the panel shows the binding and lineage without exposing raw PII", () => {
  it("shows every governing reference, truncated but attributable", () => {
    const html = render(view());
    expect(html).toContain("pol-7@1.0.0");
    expect(html).toContain(truncateRef(BINDING.datasetFingerprint));
    expect(html).toContain(truncateRef(BINDING.admissionPolicyHash));
    expect(html).toContain("2026-04-15");
    expect(html).toContain("30 days");
    expect(html).toContain("contract 1.1.0");
  });

  it("renders the full append-only lineage in order", () => {
    const html = render(view());
    const order = ["SCHEDULED", "CLAIMED", "COMPLETED"].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/append-only/i);
  });

  it("shows a linked case only when one is bound", () => {
    expect(render(view())).not.toContain("Linked case");
    const linked = render(
      view({ binding: { ...BINDING, recoveryCaseId: "RC-42" } }),
    );
    expect(linked).toContain("Linked case");
    expect(linked).toContain("RC-42");
  });
});

describe("EP-16 · client helpers", () => {
  it("treats only completed and blocked as settled — a failed run is still in flight", () => {
    expect(isSettledState("completed")).toBe(true);
    expect(isSettledState("blocked")).toBe(true);
    expect(isSettledState("failed")).toBe(false);
    expect(isSettledState("queued")).toBe(false);
    expect(isSettledState("running")).toBe(false);
    expect(isSettledState(null)).toBe(false);
  });

  it("truncates a reference without pretending the short form is the identity", () => {
    expect(truncateRef(`sha256:${"a".repeat(64)}`)).toBe(`${"a".repeat(12)}…`);
    expect(truncateRef("short")).toBe("short");
  });
});
