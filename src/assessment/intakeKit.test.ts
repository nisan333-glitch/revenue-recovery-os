import { describe, expect, it } from "vitest";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";
import {
  EMPTY_PILOT_DECLARATIONS,
  assessPilotReadiness,
  buildDataRequestGuide,
  buildIntakeManifest,
  serializeIntakeManifest,
} from "./intakeKit";

const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";

async function result() {
  return assessCsv(CSV, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), {
    createdAt: "2026-03-02T00:00:00.000Z",
  });
}

describe("Pilot Data Intake Kit", () => {
  it("remains conditional until every pilot declaration is confirmed", async () => {
    const readiness = assessPilotReadiness(await result(), EMPTY_PILOT_DECLARATIONS);
    expect(readiness.status).toBe("conditional");
    expect(readiness.confirmedCount).toBe(0);
    expect(readiness.gates.some((gate) => gate.id === "stalled_cohort" && gate.status === "pass")).toBe(true);
  });

  it("only reaches ready_for_pilot_design with data gates and all declarations", async () => {
    const declarations = {
      activationDefinitionConfirmed: true,
      stableJoinKeyConfirmed: true,
      sourceOwnershipDocumented: true,
      untreatedHistoryAvailable: true,
      interventionHistoryAvailable: true,
      reversalCoverageConfirmed: true,
      baselinePreRegistered: true,
    } as const;
    const readiness = assessPilotReadiness(await result(), declarations);
    expect(readiness.status).toBe("ready_for_pilot_design");
    expect(readiness.confirmedCount).toBe(readiness.requiredConfirmationCount);
  });

  it("blocks when the stamped policy finds no stalled cohort", async () => {
    const activated = CSV.replace("E1,2026-01-01,,", "E1,2026-01-01,2026-01-05,");
    const r = await assessCsv(
      activated,
      makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }),
      { createdAt: "2026-03-02T00:00:00.000Z" },
    );
    expect(assessPilotReadiness(r, EMPTY_PILOT_DECLARATIONS).status).toBe("blocked");
  });

  it("exports an explicit observed-only claim boundary", async () => {
    const manifest = buildIntakeManifest(await result(), EMPTY_PILOT_DECLARATIONS);
    expect(manifest.claimBoundary).toEqual({
      observedOnly: true,
      claimsRealRevenue: false,
      claimsCausality: false,
    });
    expect(JSON.parse(serializeIntakeManifest(manifest)).assessmentId).toBe(manifest.assessmentId);
  });

  it("generates a data request that distinguishes intake from proof", () => {
    const guide = buildDataRequestGuide();
    expect(guide).toContain("Source-of-record map");
    expect(guide).toContain("cannot claim causality");
    expect(guide).toContain("Revenue Returned");
  });
});
