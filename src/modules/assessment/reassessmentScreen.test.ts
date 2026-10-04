// @vitest-environment jsdom
// What the re-assessment screen must show, and what it must never show.
//
// Rendered to a string with react-dom/server, like every other screen test here. The deps are
// injected, so each test asserts what the screen does with ONE shape of server answer — which is the
// only thing this component decides. Nothing here is a test of the server's rules; those are proven in
// `server/services/reassessment.test.ts`. These are the claims a reader of the screen is making.
import { describe, it, expect } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ReassessmentScreen } from "./ReassessmentScreen";
import { executionCode } from "../../contract/executionCodes";
import type { GovernedAnalysisTermsRow } from "../../data/pilotAnalysisTermsClient";
import type {
  AssessmentExecutionView,
  ReassessAssessmentResult,
} from "../../data/pilotAssessmentClient";

const OLDER_METHOD = "assess-2026.0-older";
const CURRENT_METHOD = "assess-2026.1-thin";
const PREV_ID = `PAX-${"a".repeat(32)}`;
const NEW_ID = `PAX-${"b".repeat(32)}`;
const CLAIM = Object.freeze({
  observationOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  createsRecoveryCase: false as const,
});

function binding(method: string, policyVersion: string): AssessmentExecutionView["binding"] {
  return {
    boundaryId: "pb-1",
    datasetFingerprint: "f".repeat(64),
    admissionDecisionId: `PAD-${"c".repeat(32)}`,
    admissionPolicyId: "pol-1",
    admissionPolicyVersion: "1.0.0",
    admissionPolicyHash: `sha256:${"d".repeat(64)}`,
    contractVersion: "2.0.0",
    assessmentPolicy: {
      policyId: "terms-1",
      policyVersion,
      calculationMethodVersion: method,
      asOf: "2026-04-15",
      stallThresholdDays: 30,
      currency: "USD",
    },
    interpretation: { mappingId: "m-1", amountFormat: "auto", dateLocale: "auto" },
    recoveryCaseId: null,
  };
}

function finding(assessmentId: string, unpaidMinor: number) {
  return {
    findingHash: `sha256:${"e".repeat(64)}`,
    producedBy: "pilot-assessment-v1",
    recordedAt: "2026-04-16T09:00:02.000Z",
    finding: {
      executionId: PREV_ID,
      assessmentId,
      calculationMethodVersion: OLDER_METHOD,
      acceptedCycleCount: 40,
      excludedCycleCount: 0,
      exclusionCodes: [],
      stalledCount: 9,
      undeterminedCount: 11,
      referenceCount: 20,
      currency: "USD",
      observedUnpaidMinor: unpaidMinor,
      grossEligibleMinor: 500_000,
      partialOutstandingMinor: 0,
      excludedValueMinor: 0,
      unknownValueMinor: 0,
      stateCounts: { stalled: 9 },
      claimBoundary: CLAIM,
    },
  };
}

function execution(over: Partial<AssessmentExecutionView> = {}): AssessmentExecutionView {
  return {
    executionId: PREV_ID,
    boundaryId: "pb-1",
    state: "completed",
    code: null,
    binding: binding(OLDER_METHOD, "0.9.0"),
    bindingHash: `sha256:${"7".repeat(64)}`,
    inputHash: `sha256:${"8".repeat(64)}`,
    scheduledByActorId: "operator@company",
    scheduledByRole: "operator",
    scheduledAt: "2026-04-16T09:00:00.000Z",
    events: [{ transition: "COMPLETED", code: null, byId: "TASK-x#1", at: "2026-04-16T09:00:02.000Z" }],
    finding: finding("A-old00001", 123_400),
    revises: null,
    claimBoundary: CLAIM,
    ...over,
  };
}

function termsRow(over: Partial<GovernedAnalysisTermsRow> = {}): GovernedAnalysisTermsRow {
  return {
    termsRef: "terms-1@1.1.0",
    termsId: "terms-1",
    termsVersion: "1.1.0",
    asOf: "2026-04-15",
    stallThresholdDays: 30,
    currency: "USD",
    calculationMethodVersion: CURRENT_METHOD,
    termsHash: `sha256:${"9".repeat(64)}`,
    state: "ACTIVE",
    mayMeasure: true,
    ...over,
  };
}

/**
 * Render with injected answers and let the mount effect's reads settle.
 *
 * `renderToStaticMarkup` is synchronous and does not run effects, so the initial load is performed
 * here and the resolved view is passed in as the already-loaded state would be — which is what the
 * screen's own `initialBoundaryId`/`initialExecutionId` path produces in the browser.
 */
const render = (props: Parameters<typeof ReassessmentScreen>[0]) =>
  renderToStaticMarkup(createElement(ReassessmentScreen, props));

/**
 * Mount the screen and drive the operator's own path: type the two identifiers, click Load.
 *
 * `renderToStaticMarkup` runs no effects, so the regions that appear only after the execution and the
 * definitions have been read need a client render. Typing and clicking Load — rather than using the
 * deep-link props — is what an operator actually does: they arrive with an execution id, not a URL.
 *
 * React still prints one "update ... not wrapped in act" warning per test here, as it does in
 * `App.guidedDemo.test.ts`, because the component awaits real I/O across `act` boundaries. The flush
 * loops below are what the assertions actually rely on; the warning is stderr noise, and these tests
 * are deterministic with or without it.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function mount(props: Parameters<typeof ReassessmentScreen>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ReassessmentScreen, { ...props, initialBoundaryId: "", initialExecutionId: "" }));
  });

  const textInputs = () =>
    Array.from(container.querySelectorAll('input:not([type="radio"])')) as HTMLInputElement[];
  await act(async () => {
    const [boundary, executionInput] = textInputs();
    setInputValue(boundary!, props.initialBoundaryId ?? "pb-1");
    setInputValue(executionInput!, props.initialExecutionId ?? PREV_ID);
  });

  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    // The handler is async and awaits a request and then a read, so its state updates arrive over
    // several microtask turns. Flushing them here is what keeps the assertions from sampling a
    // half-settled screen.
    for (let i = 0; i < 4; i += 1) await act(async () => {});
  };
  const fillReason = async (text: string) => {
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const chooseEligible = async () => {
    const radios = Array.from(container.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    const eligible = radios.filter((r) => !r.disabled);
    await act(async () => {
      eligible[0]!.click();
    });
    return eligible;
  };
  const submit = () => click("Re-assess under this definition");
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
  const teardown = () => {
    root.unmount();
    container.remove();
  };
  await click("Load this execution");
  return { container, click, fillReason, chooseEligible, submit, button, teardown };
}

describe("the re-assessment screen, before anything is submitted", () => {
  it("states the claim boundary ABOVE the figures, and never claims proof or revenue", () => {
    const html = render({});
    expect(html).toContain("pilot assessment");
    expect(html).toMatch(/Neither is proof of recovered revenue/);
    expect(html).toContain("Revenue Returned");
    expect(html).toMatch(/No recovery case is created/);
    // The one thing it must not say. A revision does not make the earlier figure wrong.
    expect(html).toMatch(/does not make the earlier figure wrong/);
  });

  it("offers NO file picker — the retained input is reused, not re-supplied", () => {
    // The structural claim of the whole feature, asserted on the markup rather than trusted: there is
    // nothing on this screen that could take a CSV, so "without re-upload" is a property of the
    // screen and not a promise in a comment.
    const html = render({});
    expect(html).not.toContain('type="file"');
    expect(html.toLowerCase()).not.toContain("csv");
  });

  it("asks for the execution and the tenant, and blocks the read until both are given", () => {
    const html = render({});
    expect(html).toContain("Re-assessment tenant");
    expect(html).toContain("Execution to re-assess");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Load this execution/);
  });
});

describe("the loaded screen, through a real client render", () => {
  const LISTED = [
    termsRow({ termsRef: "terms-1@1.0.0", termsVersion: "1.0.0", calculationMethodVersion: OLDER_METHOD }),
    termsRow({ termsRef: "terms-1@2.0.0", termsVersion: "2.0.0", asOf: "2026-05-15" }),
    termsRow({ termsRef: "terms-1@0.5.0", termsVersion: "0.5.0", state: "DRAFT" as const, mayMeasure: false }),
    termsRow(),
  ];
  const listTerms = async () => ({ boundaryId: "pb-1", terms: LISTED });

  const REVISION = execution({
    executionId: NEW_ID,
    binding: binding(CURRENT_METHOD, "1.1.0"),
    finding: finding("A-new00001", 456_700),
    revises: {
      executionId: PREV_ID,
      reason: "the calculation method moved",
      delta: {
        changed: [
          { field: "calculationMethodVersion", before: OLDER_METHOD, after: CURRENT_METHOD },
          { field: "assessmentPolicyVersion", before: "0.9.0", after: "1.1.0" },
        ],
        unexpectedChanges: [],
      },
      previousFindingExists: true,
    },
  });

  it("renders without throwing when a deep link supplies the tenant and the execution", () => {
    expect(render({ initialBoundaryId: "pb-1", initialExecutionId: PREV_ID })).toContain(
      "Re-assess a retained dataset",
    );
  });

  it("shows the previous result, every definition CLASSIFIED, the delta, and both observations", async () => {
    const screen = await mount({
      initialBoundaryId: "pb-1",
      initialExecutionId: PREV_ID,
      deps: {
        read: async (_b: string, id: string) => (id === NEW_ID ? REVISION : execution()),
        listTerms,
        reassess: async (): Promise<ReassessAssessmentResult> => ({
          reassessed: true, created: true, executionId: NEW_ID, revisesExecutionId: PREV_ID,
          boundaryId: "pb-1", state: "queued", binding: REVISION.binding,
          delta: REVISION.revises!.delta, refusal: null, refusalDetail: null, claimBoundary: CLAIM,
        }),
      },
    });

    // THE PREVIOUS RESULT, under its own method, and said to be untouched.
    expect(screen.container.innerHTML).toContain(OLDER_METHOD);
    expect(screen.container.innerHTML).toMatch(/never written to/);

    // EVERY DEFINITION CLASSIFIED, each ineligible one carrying the code the server would answer with.
    for (const code of ["NH-AX-1017", "NH-AX-1016", "NH-AX-1010"]) {
      expect(screen.container.innerHTML, code).toContain(code);
    }
    // The no-op reason is the one that proves a real method change is required, not assumed.
    expect(screen.container.innerHTML).toMatch(/nothing to re-assess/);
    // Submit is shut until a definition and a reason exist, and it says which is missing.
    expect(screen.button("Re-assess under this definition")!.disabled).toBe(true);
    expect(screen.container.innerHTML).toMatch(/choose a governed definition|state why/);

    // EXACTLY ONE definition is selectable: the three refusable ones are offered as reading, not as
    // choices, so an operator cannot submit something the server has already told them it refuses.
    const eligible = await screen.chooseEligible();
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.value).toBe("terms-1@1.1.0");

    await screen.fillReason("the calculation method moved");
    expect(screen.button("Re-assess under this definition")!.disabled).toBe(false);
    await screen.submit();

    // THE DELTA, derived, with both values and the stated reason.
    expect(screen.container.innerHTML).toContain("calculationMethodVersion");
    expect(screen.container.innerHTML).toContain(CURRENT_METHOD);
    expect(screen.container.innerHTML).toContain("the calculation method moved");

    // BOTH OBSERVATIONS, side by side — the claim that makes this a revision and not a replacement.
    expect(screen.container.innerHTML).toContain("A-old00001");
    expect(screen.container.innerHTML).toContain("A-new00001");
    expect(screen.container.innerHTML).toMatch(/the earlier one is preserved, not replaced/i);
    expect(screen.container.innerHTML).toMatch(/still stored and still reproducible/);

    // AND SUBMIT IS NOW SHUT, so a settled answer cannot be submitted a second time from this screen.
    expect(screen.button("Re-assess under this definition")!.disabled).toBe(true);
    expect(screen.container.innerHTML).toMatch(/already been submitted/);
    // The reason is locked, with the reason it must not change on a retry.
    expect((screen.container.querySelector("textarea") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.container.innerHTML).toMatch(/sentence the record does not hold/);

    screen.teardown();
  });

  it("submits ONCE for a double click — the request is in flight before the second lands", async () => {
    // The duplicate-click case, driven rather than reasoned about. The handler is held open so the
    // second click arrives while the first is still unanswered, which is exactly the real race.
    let calls = 0;
    let release: (() => void) | null = null;
    const screen = await mount({
      initialBoundaryId: "pb-1",
      initialExecutionId: PREV_ID,
      deps: {
        read: async (_b: string, id: string) => (id === NEW_ID ? REVISION : execution()),
        listTerms,
        reassess: async (): Promise<ReassessAssessmentResult> => {
          calls += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {
            reassessed: true, created: true, executionId: NEW_ID, revisesExecutionId: PREV_ID,
            boundaryId: "pb-1", state: "queued", binding: REVISION.binding,
            delta: REVISION.revises!.delta, refusal: null, refusalDetail: null, claimBoundary: CLAIM,
          };
        },
      },
    });
    await screen.chooseEligible();
    await screen.fillReason("the method moved");

    const button = screen.button("Re-assess under this definition")!;
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });
    expect(calls).toBe(1);
    // While it is in flight the control says so and is shut — the label changes, which is why it is
    // found by the in-flight text rather than the idle text.
    expect(screen.button("Re-assess under this definition")).toBeUndefined();
    expect(screen.button("Submitting…")!.disabled).toBe(true);
    expect(screen.container.innerHTML).toMatch(/already in flight/);

    await act(async () => {
      release?.();
    });
    for (let i = 0; i < 3; i += 1) await act(async () => {});
    expect(calls).toBe(1);
    screen.teardown();
  });

  it("renders a REFUSAL with its code, detail and remedy, and no figure", async () => {
    const refusal = executionCode("policy_not_active");
    const screen = await mount({
      initialBoundaryId: "pb-1",
      initialExecutionId: PREV_ID,
      deps: {
        read: async () => execution(),
        listTerms: async () => ({ boundaryId: "pb-1", terms: [termsRow()] }),
        reassess: async (): Promise<ReassessAssessmentResult> => ({
          reassessed: false, created: false, executionId: null, revisesExecutionId: PREV_ID,
          boundaryId: "pb-1", state: null, binding: null, delta: null,
          refusal, refusalDetail: "the admission policy is FROZEN", claimBoundary: CLAIM,
        }),
      },
    });
    await screen.chooseEligible();
    await screen.fillReason("re-score");
    await screen.submit();

    expect(screen.container.innerHTML).toContain("NH-AX-1007");
    expect(screen.container.innerHTML).toContain(refusal.title);
    expect(screen.container.innerHTML).toContain("the admission policy is FROZEN");
    expect(screen.container.innerHTML).toContain(refusal.remediation);
    // NOTHING WAS CREATED, said rather than implied — and no second observation is rendered.
    expect(screen.container.innerHTML).toMatch(/Nothing was created and nothing was changed/);
    expect(screen.container.innerHTML).not.toContain("A-new00001");
    // A refusal is an answer, not a transport failure. Retrying cannot change it, so it is not offered.
    expect(screen.button("Retry the same request")).toBeUndefined();

    screen.teardown();
  });

  it("renders an UNCERTAIN response as retryable, and the retry sends the SAME body", async () => {
    let calls = 0;
    const sent: unknown[] = [];
    const screen = await mount({
      initialBoundaryId: "pb-1",
      initialExecutionId: PREV_ID,
      deps: {
        read: async () => execution(),
        listTerms: async () => ({ boundaryId: "pb-1", terms: [termsRow()] }),
        reassess: async (body: unknown): Promise<ReassessAssessmentResult> => {
          sent.push(body);
          calls += 1;
          throw new Error("fetch failed");
        },
      },
    });
    await screen.chooseEligible();
    await screen.fillReason("the method moved");
    await screen.submit();

    expect(screen.container.innerHTML).toMatch(/No result is shown, because none was confirmed/);
    expect(screen.container.innerHTML).toMatch(/may or may not have reached the server/);
    expect(screen.container.innerHTML).toMatch(/Retrying is safe/);
    expect(screen.container.innerHTML).not.toContain("A-new00001");
    // It must never send someone back to the file they still have on the server.
    expect(screen.container.innerHTML).toMatch(/No file needs re-uploading/);

    await screen.click("Retry the same request");
    expect(calls).toBe(2);
    // BYTE FOR BYTE. A retry carrying different wording would be answered with the execution already
    // recorded, whose stored reason is the first one — and the screen would show a sentence the record
    // does not hold.
    expect(sent[1]).toEqual(sent[0]);

    screen.teardown();
  });
});
