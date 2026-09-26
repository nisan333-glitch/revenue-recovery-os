// EP-19 · The governance screen, and the local-preview relabelling.
//
// Two things are worth a test here, and neither is layout. First: the screen must never suggest a
// non-ACTIVE policy can judge a dataset, and must never present one identity doing both governance
// halves as normal. Second: the browser-computed result must be unmistakably a preview — that wording
// is the only thing standing between a demo figure and someone quoting it as an outcome.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PilotPolicyGovernance } from "../governance/PilotPolicyGovernance";
import { ObservedResultsScreen } from "./ObservedResultsScreen";
import { assessCsv } from "../../assessment/assess";
import { makePolicy } from "../../assessment/policy";
import { mayJudge, nextGovernanceAction } from "../../data/pilotPolicyClient";
import { STEWARD, operatorActorFor } from "../../data/devActor";
import type { PolicyState } from "../../contract/policyLifecycle";

const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

describe("EP-19 · only an ACTIVE policy may judge, and the screen says so", () => {
  it.each([
    [null, false],
    ["DRAFT", false],
    ["FROZEN", false],
    ["RETIRED", false],
    ["ACTIVE", true],
  ] as [PolicyState | null, boolean][])("mayJudge(%s) === %s", (state, expected) => {
    expect(mayJudge(state)).toBe(expected);
  });

  it("names the next action for every state, and never implies a paused bar is in force", () => {
    expect(nextGovernanceAction(null)).toMatch(/Nothing proposed yet/);
    expect(nextGovernanceAction("DRAFT")).toMatch(/must activate it/);
    expect(nextGovernanceAction("ACTIVE")).toMatch(/In force/);
    expect(nextGovernanceAction("FROZEN")).toMatch(/judges nothing until it is resumed/);
    expect(nextGovernanceAction("RETIRED")).toMatch(/Permanently ended/);
    // Distinct guidance per state: collapsing any two would hide which action is needed.
    const all = ([null, "DRAFT", "ACTIVE", "FROZEN", "RETIRED"] as (PolicyState | null)[]).map(
      nextGovernanceAction,
    );
    expect(new Set(all).size).toBe(5);
  });
});

describe("EP-19 · the governance screen", () => {
  const html = renderToStaticMarkup(createElement(PilotPolicyGovernance));

  it("offers propose and activate as acts by two DIFFERENT named identities", () => {
    const proposer = operatorActorFor(null);
    expect(html).toContain(`Propose as ${proposer.actorId}`);
    expect(html).toContain(`Activate as ${STEWARD.actorId}`);
    // The whole reason this screen is separate: the server refuses both halves from one actor.
    expect(proposer.actorId).not.toBe(STEWARD.actorId);
    expect(STEWARD.role).toBe("steward");
  });

  it("labels the identity switch as development-only and not authentication", () => {
    expect(html).toContain("dev-only identities");
    expect(html).toMatch(/not production authentication/);
    expect(html).toMatch(/enforced on the server and cannot be changed from here/);
  });

  it("starts with nothing proposed, and says that state judges nothing", () => {
    expect(html).toContain("not proposed");
    expect(html).toContain("judges nothing");
    expect(html).not.toContain("may judge a dataset");
  });

  it("starts with every commercial choice blank and refuses to propose one", () => {
    // The screen used to open with a full set of plausible thresholds. A seeded bar anchors the
    // judgement it claims not to make, and the bar is the first input to the number the pilot
    // benefits from — so nothing is pre-filled, and nothing incomplete can be sent.
    expect(html).toMatch(/Every threshold must be stated deliberately/);
    expect(html).toMatch(/commercial judgement/);
    expect(html).toMatch(/Blank is not zero and cannot be proposed/);
    // Kept from the previous wording: these two sentences are what tie this screen to the server's
    // no-default rule, which the server enforces at two layers and the server matrix pins.
    expect(html).toContain("The system has no default for any of them");
    expect(html).toMatch(/absence is never read as no limit/i);
    // Every numeric box empty, and all eight of them present.
    //
    // EP-26 · Scoped to the ADMISSION panel. The screen now carries a second governed object whose own
    // stall-threshold box is also a number input, so an unscoped count would rise to nine and the
    // assertion would stop meaning "the bar has all eight and none is seeded".
    const barPanel = html.slice(html.indexOf("Every threshold must be stated deliberately"));
    expect(barPanel).toMatch(/value=""[^>]*type="number"|type="number"[^>]*value=""/);
    expect((barPanel.match(/type="number"/g) ?? []).length).toBe(8);
    // And the definition's threshold is unseeded for the same reason the bar's are: a default cut-off
    // or a default N is a decision nobody made.
    const termsPanel = html.slice(
      html.indexOf("Analysis terms — what the assessment measures"),
      html.indexOf("Every threshold must be stated deliberately"),
    );
    expect(termsPanel).toContain("Stall threshold N (days)");
    expect((termsPanel.match(/type="number"[^>]*value=""|value=""[^>]*type="number"/g) ?? []).length).toBe(1);
    expect(termsPanel).toMatch(/type="date"[^>]*value=""|value=""[^>]*type="date"/);
    expect(html).toMatch(/disabled=""[^>]*>Propose as/);
  });

  it("makes an empty lifecycle selection a decision rather than an omission", () => {
    // Three unticked boxes on an untouched form say nothing at all. The review gate is what turns an
    // empty selection into "none required", so absence never reads as a deliberate zero.
    expect(html).toContain("I have reviewed lifecycle coverage");
    const fieldset = html.slice(html.indexOf("<fieldset"), html.indexOf("</fieldset>"));
    expect(fieldset).toContain("Required lifecycle states");
    for (const state of ["stalled", "reference", "undetermined"]) {
      // Asserted inside the fieldset, as a checkbox: `toContain(state)` against the whole page would
      // pass on any document containing the word "reference".
      expect(fieldset, state).toMatch(new RegExp(`<input[^>]*type="checkbox"[^>]*>\\s*${state}`));
    }
    // Until the gate is ticked the three states are unavailable — an untouched form cannot half-state
    // a policy. Four checkboxes in total: the gate plus the three states.
    expect((fieldset.match(/type="checkbox"/g) ?? []).length).toBe(4);
    expect((fieldset.match(/disabled=""/g) ?? []).length).toBe(3);
  });

  it("requires a stated rationale on every act", () => {
    expect(html).toContain("Rationale (required on every act)");
  });

  it("shows all four lifecycle transitions, so a freeze is visibly reversible and a retire is not", () => {
    for (const label of ["Freeze", "Resume", "Retire"]) expect(html).toContain(label);
  });
});

describe("EP-19 · the browser figure is a preview and is labelled as one", () => {
  async function preview() {
    return assessCsv(CSV, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), {
      createdAt: "2026-03-02T00:00:00.000Z",
    });
  }

  it("says it was computed in this browser, and is not an execution, Proof or Revenue Returned", async () => {
    const html = renderToStaticMarkup(
      createElement(ObservedResultsScreen, { result: await preview(), onBack: () => {} }),
    );
    expect(html).toContain("local preview");
    expect(html).toContain("Local preview — computed in this browser");
    expect(html).toMatch(/in this browser/);
    expect(html).toMatch(/not<\/span> an execution, a Proof, or Revenue Returned|not an execution, a Proof, or Revenue Returned/);
    expect(html).toMatch(/no execution binding, no policy hash and no audit lineage/);
    // The old title claimed authority the figure does not have.
    expect(html).not.toContain("Observed result</");
  });

  it("offers the governed run as the way to get an authoritative figure", async () => {
    const html = renderToStaticMarkup(
      createElement(ObservedResultsScreen, {
        result: await preview(),
        onBack: () => {},
        onRunGoverned: () => {},
      }),
    );
    expect(html).toContain("Run governed execution");
  });

  it("disables the governed run while one is already in flight", async () => {
    const html = renderToStaticMarkup(
      createElement(ObservedResultsScreen, {
        result: await preview(),
        onBack: () => {},
        onRunGoverned: () => {},
        running: true,
      }),
    );
    expect(html).toContain("disabled");
    expect(html).toContain("Running…");
  });

  it("omits the governed-run button entirely when no CSV is held, rather than offering a dead action", async () => {
    const html = renderToStaticMarkup(
      createElement(ObservedResultsScreen, { result: await preview(), onBack: () => {} }),
    );
    expect(html).not.toContain("Run governed execution");
  });
});
