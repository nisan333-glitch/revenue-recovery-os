// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyntheticPilotV2 } from "./SyntheticPilotV2";

describe("Synthetic Pilot v2 screen", () => {
  const render = () => renderToStaticMarkup(createElement(SyntheticPilotV2));

  it("shows all three scenarios and the synthetic-only boundary", () => {
    const html = render();
    expect(html).toContain("SYNTHETIC ONLY");
    expect(html).toContain("Verified recovery");
    expect(html).toContain("Human rejection");
    expect(html).toContain("Insufficient evidence");
    expect(html).toContain("no claim of real recovered revenue");
  });

  it("keeps opportunity visibly separate from returned and auditable revenue", () => {
    const html = render();
    expect(html).toContain("Revenue Opportunity");
    expect(html).toContain("Revenue Returned");
    expect(html).toContain("Auditable Revenue");
    expect(html).toContain("Opportunity is a forecast");
  });

  it("disables CFO export until a proof exists", () => {
    const html = render();
    expect(html).toMatch(/disabled=""[^>]*>Export CFO proof JSON/);
  });

  it("advances the verified scenario through all governed steps before enabling export", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const prior = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(SyntheticPilotV2)));
      const click = async (label: string) => {
        const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
        expect(button, `missing '${label}' button`).toBeTruthy();
        await act(async () => button!.click());
      };
      await click("Accept and open case");
      await click("Record activation play");
      await click("Submit outcome evidence");
      await click("Approve governed proof");
      expect(container.textContent).toContain("Proof approved");
      expect(container.textContent).toContain("$5,000.00");
      const exportButton = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Export CFO proof JSON"));
      expect(exportButton?.disabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = prior;
    }
  });

  it("rejects the second scenario without creating a case", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const prior = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(createElement(SyntheticPilotV2)));
      const scenario = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Human rejection"));
      await act(async () => scenario!.click());
      const reject = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Reject candidate"));
      await act(async () => reject!.click());
      expect(container.textContent).toContain("No Recovery Case, action or revenue claim was created");
    } finally {
      await act(async () => root.unmount());
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = prior;
    }
  });
});
