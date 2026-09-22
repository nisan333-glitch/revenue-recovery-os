// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { CandidateReviewQueue } from "./CandidateReviewQueue";

const candidate = {
  candidateId: "CC-123",
  dedupeKey: "a".repeat(64),
  boundaryId: "pilot-a",
  agentId: "activation-deadline-v1",
  signal: {
    signalId: "SIG-1",
    boundaryId: "pilot-a",
    recoveryType: "ActivationMissed",
    sourceRef: "src-hmac",
    sourcePayloadHash: "b".repeat(64),
    detectorVersion: "activation-deadline-v1",
    observedAt: "2026-09-22T10:00:00.000Z",
    amountAtRiskMinor: 125000,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "next_invoice_paid",
  },
  status: "pending_review" as const,
  submittedAt: "2026-09-22T10:00:00.000Z",
  review: null,
  recoveryCaseId: null,
};

afterEach(() => vi.restoreAllMocks());

let previousActEnvironment: unknown;
beforeAll(() => {
  previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("CandidateReviewQueue", () => {
  it("requires an explicit boundary and keeps opportunity separate from returned revenue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([candidate]), { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(CandidateReviewQueue)));

    const load = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Load candidates")!;
    expect(load.disabled).toBe(true);
    const input = host.querySelector('input[placeholder="Enter the exact customer/pilot boundary"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "pilot-a");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(load.disabled).toBe(false);
    await act(async () => load.click());
    await flush();
    expect(host.textContent).toContain("ActivationMissed");
    expect(host.textContent).toContain("Loaded boundary: pilot-a");
    expect(host.textContent).toContain("Revenue Opportunity · not proven");
    expect(host.textContent).toContain("Revenue Returned$0.00");
    await act(async () => root.unmount());
  });

  it("accepts only with a reason, then requires a separate promotion", async () => {
    let accepted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/promote")) {
        return new Response(JSON.stringify({
          created: true,
          recoveryCase: {
            recoveryCaseId: "RC-1",
            boundaryId: "pilot-a",
            sourceCandidateId: candidate.candidateId,
            recoveryType: "ActivationMissed",
            sourceRef: "src-hmac",
            amountAtRiskMinor: 125000,
            currency: "USD",
            detectorVersion: "activation-deadline-v1",
            openedByActorId: "pilot-operator@company",
            openedByRole: "operator",
            policyVersion: "recovery-case-promotion-v1",
            openedAt: "2026-09-22T10:05:00.000Z",
          },
        }), { status: 201 });
      }
      if (url.includes("/review")) {
        accepted = true;
        return new Response(JSON.stringify({ decision: "accepted" }), { status: 201 });
      }
      if (url.includes("/agent-candidates?")) {
        return new Response(JSON.stringify([{ ...candidate, review: accepted ? { decision: "accepted" } : null }]), { status: 200 });
      }
      throw new Error(`unexpected ${init?.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(CandidateReviewQueue)));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    const boundary = host.querySelector('input[placeholder="Enter the exact customer/pilot boundary"]') as HTMLInputElement;
    await act(async () => { setter.call(boundary, "pilot-a"); boundary.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Load candidates")!.click());
    await flush();

    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Accept for case creation")!.click());
    expect(host.textContent).toContain("A review reason is required");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/review"))).toHaveLength(0);

    const reason = host.querySelector('input[placeholder="Required immutable review reason"]') as HTMLInputElement;
    await act(async () => { setter.call(reason, "Objective stall confirmed"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Accept for case creation")!.click());
    await flush();
    expect(host.textContent).toContain("Create Recovery Case");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/review"))).toBe(true);
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Create Recovery Case")!.click());
    await flush();
    expect(host.textContent).toContain("Recovery Case RC-1 created");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/promote"))).toBe(true);
    await act(async () => root.unmount());
  });
});
