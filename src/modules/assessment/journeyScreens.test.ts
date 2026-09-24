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

  it("presents the starting thresholds as a conversation, never a recommendation", () => {
    expect(html).toMatch(/not a\s*<\/span>\s*recommendation|not a <!-- -->recommendation|not a\s+recommendation/);
    expect(html).toMatch(/Every threshold is required and the system has no default/);
    expect(html).toMatch(/commercial judgement/);
    // Absence must never read as permissiveness.
    expect(html).toMatch(/absence is never read as/i);
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
