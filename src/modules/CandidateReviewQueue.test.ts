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

// ── THE IDENTITY-GRAIN DISCLOSURE ON THE QUEUE · asserted on rendered markup ──────────────────────
//
// This is the screen where the promote decision is taken, so it is the screen where the disclosure has to
// arrive. Every assertion below reads the DOM the operator would see, not a payload field.
const GRAIN = {
  grain: "ACCOUNT_GRAINED_POTENTIAL" as const,
  mayCoverMultipleObligations: true,
  obligationUniquenessGuaranteed: false,
  reason: "leak_instance_identity_unavailable: the data contract declares no obligation identity field.",
  absorbedObservations: { checked: false as const },
  headline:
    "ACCOUNT-LEVEL IDENTITY. This case is identified by the customer account, not by the obligation, so " +
    "it may represent more than one contractual obligation and the figure above may cover more than one. " +
    "It is not a per-obligation claim.",
};

async function loadQueue(host: HTMLElement, root: ReturnType<typeof createRoot>): Promise<void> {
  await act(async () => root.render(createElement(CandidateReviewQueue)));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  const boundary = host.querySelector('input[placeholder="Enter the exact customer/pilot boundary"]') as HTMLInputElement;
  await act(async () => { setter.call(boundary, "pilot-a"); boundary.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Load candidates")!.click());
  await flush();
}

describe("CandidateReviewQueue · identity grain disclosure", () => {
  it("renders the account-level warning ABOVE the candidates it qualifies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ ...candidate, identityGrain: GRAIN }]), { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await loadQueue(host, root);

    const notice = host.querySelector('[data-testid="identity-grain-notice"]')!;
    expect(notice).not.toBeNull();
    expect(notice.getAttribute("data-grain")).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(notice.textContent).toContain("ACCOUNT-LEVEL IDENTITY");
    expect(notice.textContent).toContain("more than one contractual obligation");

    // POSITION IS PART OF THE DISCLOSURE. A qualification read after the amount has already been
    // believed is not a qualification, so the index comparison is on the markup itself.
    const markup = host.innerHTML;
    expect(markup.indexOf('data-testid="identity-grain-notice"')).toBeLessThan(markup.indexOf("ActivationMissed"));
    await act(async () => root.unmount());
  });

  it("says the absorption was NOT CHECKED, never that none was found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ ...candidate, identityGrain: GRAIN }]), { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await loadQueue(host, root);

    expect(host.querySelector('[data-testid="absorbed-not-checked"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="absorbed-count"]')).toBeNull();
    expect(host.textContent).toContain("not been checked");
    expect(host.textContent).toContain("exposure:absorbed");
    // Claiming none would assert work this read did not do.
    expect(host.textContent).not.toMatch(/no absorptions? (were |was )?found/i);
    await act(async () => root.unmount());
  });

  it("labels the source ref as an ACCOUNT pseudonym, not an obligation reference", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ ...candidate, identityGrain: GRAIN }]), { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await loadQueue(host, root);
    expect(host.textContent).toContain("account pseudonym, not an obligation");
    await act(async () => root.unmount());
  });

  it("AN ABSENT DISCLOSURE FAILS CLOSED — silence is not reassurance", async () => {
    // A rolling deploy, a cached payload or an unwired route can all drop the field. Rendering nothing
    // would let a deploy skew delete the warning, so the absent case warns too.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([candidate]), { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await loadQueue(host, root);

    const notice = host.querySelector('[data-testid="identity-grain-notice"]')!;
    expect(notice).not.toBeNull();
    expect(notice.getAttribute("data-grain")).toBe("NOT_STATED");
    expect(host.querySelector('[data-testid="grain-not-stated"]')).not.toBeNull();
    expect(notice.textContent).toContain("Absence is not reassurance");
    await act(async () => root.unmount());
  });

  it("the ALREADY-EXISTS promotion result does not read as reassurance", async () => {
    // The highest-value single fix in this slice. "no duplicate was created" is comfortable and, on an
    // account-grained key, also describes a second genuinely different obligation being folded in.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/promote")) {
        return new Response(JSON.stringify({
          created: false,
          recoveryCase: {
            recoveryCaseId: "RC-1", boundaryId: "pilot-a", sourceCandidateId: candidate.candidateId,
            recoveryType: "ActivationMissed", sourceRef: "src-hmac", amountAtRiskMinor: 125000,
            currency: "USD", detectorVersion: "activation-deadline-v1",
            openedByActorId: "pilot-operator@company", openedByRole: "operator",
            policyVersion: "recovery-case-promotion-v1", openedAt: "2026-09-22T10:05:00.000Z",
          },
        }), { status: 200 });
      }
      if (url.includes("/review")) return new Response(JSON.stringify({ decision: "accepted" }), { status: 201 });
      return new Response(JSON.stringify([{ ...candidate, identityGrain: GRAIN, review: { decision: "accepted" } }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    const root = createRoot(host);
    await loadQueue(host, root);

    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Create Recovery Case")!.click());
    await flush();

    expect(host.textContent).toContain("already exists for this ACCOUNT");
    expect(host.textContent).toContain("The record cannot tell them apart");
    expect(host.textContent).toContain("different obligation now folded into");
    // The old wording must be gone, not merely supplemented.
    expect(host.textContent).not.toContain("no duplicate was created");
    await act(async () => root.unmount());
  });
});
