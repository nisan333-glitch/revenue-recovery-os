// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DayTradingCenter } from "./DayTradingCenter";
describe("trading research screen", () => {
  it("starts without invented results, exposes all eleven skills, and clears the example", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    await act(async () => root.render(createElement(DayTradingCenter)));
    const click = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
      expect(button).toBeTruthy(); await act(async () => button!.click());
    };
    expect(host.textContent).toContain("טרם נטען דוח");
    expect(host.textContent).not.toContain("$0.00");
    await click("הצג דוגמה סינתטית");
    expect(host.textContent).toContain("בדיקת תוכנה בלבד"); expect(host.textContent).toContain("$1.00");
    expect(host.textContent).toContain("אינה נתוני שוק או תוצאת מנוע");
    await click("11 הסקילים"); expect(host.querySelectorAll("tbody tr")).toHaveLength(11);
    expect(host.textContent).toContain("טרם הותקנו או הורצו");
    await click("מוכנות למסחר"); expect(host.textContent).toContain("מגבלת הפסד אישית");
    expect(host.textContent).toContain("טרם חוברו");
    await click("דוחות ויומן"); await click("נקה דוח"); expect(host.textContent).toContain("טרם נטען דוח");
    await act(async () => root.unmount());
  });
  it("clears a prior report when a replacement import fails", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    await act(async () => root.render(createElement(DayTradingCenter)));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "הצג דוגמה סינתטית")!.click());
    const input = host.querySelector("input")!;
    Object.defineProperty(input, "files", { value: [{ size: 20, text: async () => "not json" }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("אינו תקין");
    expect(host.textContent).toContain("טרם נטען דוח"); expect(host.textContent).not.toContain("$1.00");
    await act(async () => root.unmount());
  });
});
