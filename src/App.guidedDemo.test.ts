// Mission #010 · Increment 2 — Guided Demo (observable customer behaviour).
// Server-rendered to a string via react-dom/server (an existing dependency, the same pattern the
// Assessment screen tests use), so it needs no jsdom/RTL and no config change. It asserts only what a
// customer sees in the rendered output — never internal structure, helper names, private state, or CSS.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryProvider } from "./state/RecoveryContext";
import { App } from "./App";

// Render the real App inside the real provider (the provider seeds RE-1014 when storage is absent).
// `demo` selects the Guided Demo view via App's optional, additive initialModule seam.
const render = (demo?: boolean) =>
  renderToStaticMarkup(
    createElement(
      RecoveryProvider,
      null,
      demo ? createElement(App, { initialModule: "demo" as const }) : createElement(App),
    ),
  );

describe("Mission #010 · Increment 2 — Guided Demo", () => {
  it("shows the Guided Demo navigation entry", () => {
    expect(render()).toContain("Guided Demo — RE-1014");
  });

  it("opening the Guided Demo renders the existing RE-1014 story (EventDetail)", () => {
    const html = render(true);
    expect(html).toContain("RE-1014"); // the case is on screen
    expect(html).toContain("PF-RE-1014"); // EventDetail rendered the live approved proof for the case
  });

  it("keeps forecast and proven revenue visibly separate (never one combined recovered amount)", () => {
    const html = render(true);
    expect(html).toMatch(/forecast/i); // the recommended play is labelled a forecast
    expect(html).toMatch(/not proven/i); // explicitly not proven revenue
    expect(html).toMatch(/Revenue Returned/i); // proven returned shown as its own, separate concept
    expect(html).toMatch(/never combined/i); // the two are stated never to be combined
  });

  it("offers a CTA that continues to the CFO Proof View", () => {
    expect(render(true)).toContain("Continue to CFO Proof View");
  });

  it("does not present a single combined forecast+proven 'recovered' total in the demo framing", () => {
    // Observable guard: the framing copy must not merge the ledgers into one headline number.
    expect(render(true)).not.toMatch(/total recovered/i);
  });
});
