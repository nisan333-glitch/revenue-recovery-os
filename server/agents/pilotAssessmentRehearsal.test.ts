// EP-16 · The synthetic rehearsal, executed for real: a real socket, the production worker loop and
// a real PostgreSQL database. If the orchestration only works when a test drives the runtime turn
// by turn, this is where that shows up.
import { describe, expect, it } from "vitest";
import { runPilotAssessmentRehearsal } from "./pilotAssessmentRehearsal";

describe.skipIf(!process.env.DATABASE_URL)("EP-16 · pilot assessment rehearsal", () => {
  it("runs the governed handoff end to end over HTTP and reports a synthetic-only observation", async () => {
    const report = await runPilotAssessmentRehearsal({ ...process.env, NH_SYNTHETIC_PILOT: "true" });

    expect(report).toMatchObject({
      schemaVersion: "nh-pilot-assessment-rehearsal-v1",
      syntheticOnly: true,
      containsRealCustomerData: false,
      claimsRealRevenue: false,
      transport: "http",
      policy: { state: "ACTIVE" },
      dataset: { admissionOutcome: "ADMISSIBLE", acceptedRows: 40, rejectedRows: 0 },
      execution: { agentId: "pilot-assessment-v1", state: "completed", ranOnRealWorker: true },
      observation: { constitutesProof: false, constitutesRevenue: false },
      governedObjectsCreated: { proofs: 0, recoveryCases: 0, authorityEvents: 0, caseCandidates: 0 },
    });

    // The two actors are different people in different roles — the whole point of the split.
    expect(report.policy.proposedBy).not.toBe(report.policy.activatedBy);
    expect(report.execution.transitions).toEqual(["SCHEDULED", "CLAIMED", "COMPLETED"]);
    expect(report.execution.executionId).toMatch(/^PAX-[a-f0-9]{32}$/);
    expect(report.observation.acceptedCycleCount).toBe(40);
    expect(Number.isSafeInteger(report.observation.observedUnpaidMinor)).toBe(true);
    expect(report.controlsVerified).toContain("real_http_transport");
    expect(report.controlsVerified).toContain("production_worker_loop_executed");
    expect(report.controlsVerified).toContain("no_governed_object_created");

    // A rehearsal must be self-evidently synthetic wherever its output is pasted.
    expect(report.boundaryId).toMatch(/^SYNTHETIC-/);
    expect(report.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, 40_000);
});
