import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syntheticScenario, SYNTHETIC_PROVENANCE } from "../../contract/syntheticPilotDataset";
import { validatePilotDataset } from "../../contract/validateDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../contract/pilotDataContract";
import { makePolicy } from "../../assessment/policy";
import { preflightAsResult } from "./intakeGate";
import { ValidationReportPanel } from "./ValidationReportPanel";

describe("preflight report has no policy authority", () => {
  it("shows the contract defect but no invented admission outcome", async () => {
    const report = await validatePilotDataset({
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      boundary: { boundaryId: "synthetic-test", datasetId: "all-rejected" },
      provenance: SYNTHETIC_PROVENANCE,
      csvText: syntheticScenario("all-rejected").csvText,
      policy: makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }),
    });
    expect(report.usableForAssessment).toBe(false);
    const html = renderToStaticMarkup(createElement(ValidationReportPanel, {
      result: preflightAsResult(report), preliminary: true,
    }));
    expect(html).toContain("NH-DC-2003");
    expect(html).toContain("No admission policy was read here");
    expect(html).toContain("pilot admission not evaluated");
    expect(html).not.toContain("Pilot admission</span>");
    expect(html).not.toContain("no policy configured");
    expect(html).not.toContain("not pilot-admissible");
  });
});
