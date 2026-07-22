// Mission #010 · Increments 2–3 — Guided Demo (observable customer behaviour).
// Server-rendered to a string via react-dom/server (an existing dependency, the same pattern the
// Assessment screen tests use), so it needs no jsdom/RTL and no config change. It asserts only what a
// customer sees in the rendered output — never internal structure, helper names, private state, or CSS.
// Increment 3 strengthens the observable two-ledger guard across the Guided Demo → CFO Proof View path.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryProvider } from "./state/RecoveryContext";
import { App } from "./App";
import { CFOProofView } from "./modules/CFOProofView";

// Render the CFO Proof View in isolation (inside the real provider) with an optional demo-continuity
// focus, exactly as App passes it — so the marked/unmarked row is observable without a click.
const renderCfo = (focusCaseId?: string) =>
  renderToStaticMarkup(
    createElement(
      RecoveryProvider,
      null,
      focusCaseId ? createElement(CFOProofView, { focusCaseId }) : createElement(CFOProofView),
    ),
  );

const DEMO_MARKER = "From your Guided Demo";
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// Render the real App inside the real provider (the provider seeds RE-1014 when storage is absent).
// `module` selects a view via App's optional, additive initialModule seam.
const render = (module?: "demo" | "cfo") =>
  renderToStaticMarkup(
    createElement(
      RecoveryProvider,
      null,
      module ? createElement(App, { initialModule: module }) : createElement(App),
    ),
  );

describe("Mission #010 · Increment 2 — Guided Demo", () => {
  it("shows the Guided Demo navigation entry", () => {
    expect(render()).toContain("Guided Demo — RE-1014");
  });

  it("opening the Guided Demo renders the existing RE-1014 story (EventDetail)", () => {
    const html = render("demo");
    expect(html).toContain("RE-1014"); // the case is on screen
    expect(html).toContain("PF-RE-1014"); // EventDetail rendered the live approved proof for the case
  });

  it("keeps forecast and proven revenue visibly separate (never one combined recovered amount)", () => {
    const html = render("demo");
    expect(html).toMatch(/forecast/i); // the recommended play is labelled a forecast
    expect(html).toMatch(/not proven/i); // explicitly not proven revenue
    expect(html).toMatch(/Revenue Returned/i); // proven returned shown as its own, separate concept
    expect(html).toMatch(/never combined/i); // the two are stated never to be combined
  });

  it("offers a CTA that continues to the CFO Proof View", () => {
    expect(render("demo")).toContain("Continue to CFO Proof View");
  });

  it("does not present a single combined forecast+proven 'recovered' total in the demo framing", () => {
    // Observable guard: the framing copy must not merge the ledgers into one headline number.
    expect(render("demo")).not.toMatch(/total recovered/i);
  });
});

describe("Mission #010 · Increment 3 — observable two-ledger guard across the demo → CFO path", () => {
  it("makes the recovery figures observable: baseline, collected, and Revenue Returned", () => {
    const html = render("demo");
    expect(html).toContain("2600"); // governed baseline is shown ($2,600)
    expect(html).toContain("13200"); // the collected second invoice is shown ($13,200)
    expect(html).toMatch(/10[,.]?600/); // Revenue Returned is shown ($10,600 = collected − baseline)
  });

  it("shows the auditable status for the recovery", () => {
    // Proven-and-auditable is stated where the customer can see it (the proof status banner).
    expect(render("demo")).toMatch(/auditable/i);
  });

  it("shows proof approval as visibly independent from case ownership (no self-approval)", () => {
    const html = render("demo");
    expect(html).toMatch(/distinct from owner/i); // approval is stated to come from a separate authority
    expect(html).toContain("Dana Levy"); // the case owner/beneficiary is shown, distinct from the approver
  });

  it("labels the forecast / at-risk figure separately from proven Revenue Returned", () => {
    const html = render("demo");
    expect(html).toMatch(/at risk|detected risk|opportunity|forecast/i); // forecast/opportunity is labelled
    expect(html).toMatch(/Revenue Returned/i); // proven returned is its own labelled figure
    expect(html).not.toMatch(/total recovered/i); // and the two are never merged into one total
  });

  it("continuing to the CFO Proof View shows the proven auditable recovery, with no forecast merged in", () => {
    const html = render("cfo");
    expect(html).toContain("PF-RE-1014"); // the auditable proof for the case appears in the CFO ledger
    expect(html).not.toMatch(/total recovered/i); // the proof view never merges forecast into recovered
  });
});

describe("Mission #010 · Increment 4 — Guided Demo → CFO Proof continuity", () => {
  it("the Guided Demo names the case and its proven Revenue Returned at the handoff", () => {
    const html = render("demo");
    expect(html).toContain("RE-1014"); // the case being handed off is named
    expect(html).toMatch(/Revenue Returned/i); // its proven figure is named (not the forecast)
    expect(html).toMatch(/10[,.]?600/); // the proven amount comes from context ($10,600)
  });

  it("marks exactly one CFO proof row — the one for the demo case — when opened from the demo", () => {
    const html = renderCfo("RE-1014");
    expect(html).toContain(DEMO_MARKER); // the demo case's proof row is visibly marked
    expect(countOf(html, DEMO_MARKER)).toBe(1); // and only that one row is marked, not another
    expect(html).toContain("PF-RE-1014"); // the marked ledger still shows the case's proof
  });

  it("shows no demo marker on direct CFO navigation (isolated component)", () => {
    expect(renderCfo()).not.toContain(DEMO_MARKER);
  });

  it("shows no demo marker when the CFO view is reached by direct navigation in the app", () => {
    // initialModule="cfo" is direct navigation (not the demo CTA), so App passes no focus.
    expect(render("cfo")).not.toContain(DEMO_MARKER);
  });

  it("marking a proof row never merges forecast into the proven total", () => {
    expect(renderCfo("RE-1014")).not.toMatch(/total recovered/i);
  });
});
