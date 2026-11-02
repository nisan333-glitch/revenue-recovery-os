// @vitest-environment jsdom
//
// THE CORRECTION LEDGER SCREEN · what it shows, and the four things it must never show.
//
// Each test is one of the rules the module is built from, asserted on the rendered markup rather than on
// a prop: a rule that holds in the component's logic and not on the page is not a rule a reviewer gets.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { CorrectionLedger } from "./CorrectionLedger";

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

const NOTICE =
  "CORRECTED AMOUNTS ARE REPORTED, NOT RESOLVED. Where several statements of one obligation's shortfall " +
  "were observed, every amount is listed and the governed store's figure is named — but which statement " +
  "is authoritative is NOT decided here and no approved business rule decides it. Nothing in this " +
  "report is recovered revenue, and no figure here may be summed into one.";

const record = (over: Record<string, unknown> = {}) => ({
  identityDigest: "a1b2c3d4e5f6a1b2c3d4e5f6",
  recoveryType: "RevenueUnderBilled",
  obligationGrained: true,
  state: "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED",
  orderCertain: true,
  observationCount: 2,
  observedAmountsMinor: [60_000, 80_000],
  storedMinor: 60_000,
  latestObservedMinor: 80_000,
  deltaMinor: 20_000,
  direction: "UPWARD",
  undecidedMagnitudeMinor: 20_000,
  currency: "USD",
  ...over,
});

const view = (over: Record<string, unknown> = {}) => ({
  scheme: "nh-candidate-corrections-read-v1",
  derivedFromScheme: "nh-candidate-corrections-v1",
  boundaryId: "pilot-a",
  result: { outcome: "REPORTED" },
  records: [record()],
  totals: {
    identities: 1, withCorrections: 1, repeatedIdentical: 0, orderNotEstablishable: 0,
    upwardUndecidedMinor: 20_000, downwardUndecidedMinor: 0,
  },
  claimBoundary: {
    observationOnly: true, constitutesProof: false, constitutesRevenue: false, precedenceApproved: false,
  },
  precedenceNotice: NOTICE,
  ...over,
});

async function render(payload: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status })));
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(CorrectionLedger)));
  const input = host.querySelector('input[aria-label="Pilot boundary ID"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "pilot-a");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const load = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Read ledger")!;
  await act(async () => load.click());
  await flush();
  return host;
}

describe("CorrectionLedger", () => {
  it("requires an explicit boundary before it will read anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(CorrectionLedger)));
    const load = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Read ledger")!;
    // A blank boundary must not read "all boundaries" — the same rule the server enforces.
    expect(load.disabled).toBe(true);
    expect(host.textContent).toContain("Requires the AuditRead capability");
  });

  it("shows the correction, every amount observed, and the stored figure — as separate facts", async () => {
    const host = await render(view());
    expect(host.querySelectorAll('[data-testid="correction-record"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="correction-record"]')!.getAttribute("data-state"))
      .toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
    expect(host.querySelector('[data-testid="observed-amounts"]')!.textContent).toBe("$600.00 · $800.00");
    expect(host.querySelector('[data-testid="stored-figure"]')!.textContent).toBe("$600.00");
    expect(host.querySelector('[data-testid="undecided-magnitude"]')!.textContent).toContain("$200.00");
    expect(host.textContent).toContain("Correction observed — precedence undecided");
    expect(host.textContent).toContain("Obligation-level");
  });

  // ── RULE 1 · NO AUTHORITATIVE AMOUNT ──────────────────────────────────────────────────────────────
  it("never presents an authoritative amount, and renders the server's notice verbatim", async () => {
    const host = await render(view());
    expect(host.querySelector('[data-testid="precedence-notice"]')!.textContent).toBe(NOTICE);
    for (const word of ["Corrected amount:", "Authoritative", "Effective amount", "Resolved amount"]) {
      expect(host.textContent, word).not.toContain(word);
    }
    // The screen says the dispute is open, in the server's words rather than its own paraphrase.
    expect(host.textContent).toContain("is NOT decided here");
  });

  // ── RULE 2 · NULL IS NOT ESTABLISHABLE, NEVER $0.00 ───────────────────────────────────────────────
  it("an unorderable identity shows NOT ESTABLISHABLE, never a monetary zero", async () => {
    const host = await render(view({
      records: [record({
        state: "ORDER_NOT_ESTABLISHABLE", orderCertain: false,
        storedMinor: null, latestObservedMinor: null, deltaMinor: null,
        direction: null, undecidedMagnitudeMinor: null,
      })],
      totals: {
        identities: 1, withCorrections: 0, repeatedIdentical: 0, orderNotEstablishable: 1,
        upwardUndecidedMinor: 0, downwardUndecidedMinor: 0,
      },
    }));
    expect(host.querySelector('[data-testid="stored-figure"]')!.textContent).toBe("NOT ESTABLISHABLE");
    expect(host.textContent).toContain("Refused — observation order not establishable");
    expect(host.textContent).toContain("cannot be established");
    // The amounts are still shown: the uncertainty is about ORDER, not about what was observed.
    expect(host.querySelector('[data-testid="observed-amounts"]')!.textContent).toBe("$600.00 · $800.00");
    // And the identity is excluded from both monetary figures, said in words.
    expect(host.querySelector('[data-testid="order-uncertain-count"]')!.textContent)
      .toContain("excluded from both figures");
  });

  // ── RULE 3 · THE TWO DIRECTIONS ARE NEVER NETTED ──────────────────────────────────────────────────
  it("shows an under-report and an over-statement as two figures and never their difference", async () => {
    const host = await render(view({
      totals: {
        identities: 2, withCorrections: 2, repeatedIdentical: 0, orderNotEstablishable: 0,
        upwardUndecidedMinor: 20_000, downwardUndecidedMinor: 40_000,
      },
    }));
    expect(host.querySelector('[data-testid="total-upward"]')!.textContent).toBe("$200.00");
    expect(host.querySelector('[data-testid="total-downward"]')!.textContent).toBe("$400.00");
    // The net would be -$200.00 and must appear nowhere.
    expect(host.textContent).not.toContain("-$200.00");
    expect(host.textContent).not.toContain("Net");
    expect(host.querySelector('[data-testid="no-net-notice"]')!.textContent).toContain("never netted");
  });

  // ── RULE 4 · NO MONEY-MOVEMENT CLAIM ──────────────────────────────────────────────────────────────
  it("claims no recovered money anywhere, on the page or on any card", async () => {
    const host = await render(view());
    // THE CLAIM, NOT THE TERM. The first form of this banned the bare phrase "Revenue Returned" and
    // failed on the screen's own footer — "never summed into Revenue Returned" — which is the sentence
    // that makes the point. A guard that matches a term rather than a claim is the trap this repository
    // keeps recording; so what is banned is an ASSERTION that money came back, in the shapes a screen
    // could make one.
    const text = host.textContent ?? "";
    for (const claim of [
      /Revenue Returned[^.]{0,20}\$/, /\bRecovered\b[^.]{0,20}\$/, /\bCollected\b[^.]{0,20}\$/,
      /was recovered/i, /money returned/i, /has been collected/i,
    ]) {
      expect(claim.test(text), claim.source).toBe(false);
    }
    // And the phrase that DOES appear appears only inside its own negation.
    expect(text).toContain("never summed into Revenue Returned");
    // And each card says what its figures are, so one row read in isolation still carries the boundary.
    expect(host.querySelector('[data-testid="correction-record"]')!.textContent)
      .toContain("OBSERVED exposure under dispute");
    expect(host.textContent).toContain("never summed into Revenue Returned");
  });

  it("a replay is shown as a replay rather than as a dispute", async () => {
    const host = await render(view({
      records: [record({
        state: "REPEATED_IDENTICAL_OBSERVATION", observedAmountsMinor: [60_000, 60_000],
        latestObservedMinor: 60_000, deltaMinor: 0, direction: null, undecidedMagnitudeMinor: 0,
      })],
      totals: {
        identities: 1, withCorrections: 0, repeatedIdentical: 1, orderNotEstablishable: 0,
        upwardUndecidedMinor: 0, downwardUndecidedMinor: 0,
      },
    }));
    expect(host.textContent).toContain("Replay — identical amount");
    expect(host.textContent).toContain("A replay is not a correction");
    expect(host.querySelector('[data-testid="undecided-magnitude"]')).toBeNull();
  });

  // ── THE REFUSAL AND THE AUTHORIZATION FAILURE ARE DIFFERENT THINGS ────────────────────────────────
  it("a dataset-level refusal is rendered with the server's reason, not as an error", async () => {
    const host = await render(view({
      result: { outcome: "REFUSED_ORDER_UNSAFE", reason: "the stored append sequence … not a server fault" },
      records: [],
      totals: {
        identities: 0, withCorrections: 0, repeatedIdentical: 0, orderNotEstablishable: 0,
        upwardUndecidedMinor: 0, downwardUndecidedMinor: 0,
      },
    }));
    expect(host.querySelector('[data-testid="refusal-reason"]')!.textContent).toContain("not a server fault");
    expect(host.textContent).toContain("REFUSED — ORDER UNSAFE");
    // A refusal is NOT an error: the error panel must stay absent, or a reviewer reads a governed
    // outcome as a broken feature.
    expect(host.querySelector('[data-testid="ledger-error"]')).toBeNull();
  });

  it("a 403 explains the capability instead of reading as a broken feature", async () => {
    const host = await render({ error: "forbidden", message: "role 'operator' may not perform 'AuditRead'" }, 403);
    const error = host.querySelector('[data-testid="ledger-error"]')!;
    expect(error.textContent).toContain("AuditRead capability");
    expect(error.textContent).toContain("must not be the one");
    expect(host.querySelector('[data-testid="correction-record"]')).toBeNull();
  });

  it("an empty ledger is not a finding that nothing was owed", async () => {
    const host = await render(view({
      records: [],
      totals: {
        identities: 0, withCorrections: 0, repeatedIdentical: 0, orderNotEstablishable: 0,
        upwardUndecidedMinor: 0, downwardUndecidedMinor: 0,
      },
    }));
    expect(host.querySelector('[data-testid="ledger-empty"]')!.textContent)
      .toContain("not a finding that nothing was owed");
  });

  it("the screen requests the AuditRead-capable actor, never an operator", async () => {
    // TYPED AS THE REAL `fetch`, not inferred. `vi.fn(async () => …)` infers a zero-argument signature,
    // so `mock.calls[0]![1]` is a type error that vitest never sees and the strict build does — the
    // "a type nobody checks is not a guard" lesson, in the one place the build does check.
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(view()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(createElement(CorrectionLedger)));
    const input = host.querySelector('input[aria-label="Pilot boundary ID"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "pilot-a");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "Read ledger")!.click());
    await flush();
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("x-actor-role")).toBe("approver");
    expect(headers.get("x-actor-role")).not.toBe("operator");
    // And the boundary is sent encoded, never interpolated raw.
    expect(calls[0]!.url).toContain("boundaryId=pilot-a");
  });
});
