import { describe, expect, it } from "vitest";
import { assertSyntheticPilotEnvironment, runSyntheticPilot } from "./syntheticPilot";

describe("synthetic pilot environment guard", () => {
  it("accepts only an explicit opt-in and a disposable local PostgreSQL database", () => {
    expect(assertSyntheticPilotEnvironment({
      NH_SYNTHETIC_PILOT: "true",
      DATABASE_URL: "postgresql://pilot:secret@localhost:5432/nh_synthetic_test?schema=public",
    }).pathname).toBe("/nh_synthetic_test");
  });

  it.each([
    [{ DATABASE_URL: "postgresql://pilot:secret@localhost:5432/nh_test" }, "NH_SYNTHETIC_PILOT=true"],
    [{ NH_SYNTHETIC_PILOT: "true" }, "DATABASE_URL is required"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "mysql://pilot:secret@localhost/nh_test" }, "requires PostgreSQL"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "postgresql://pilot:secret@localhost/revenue" }, "database name"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "postgresql://pilot:secret@example.com/nh_test" }, "local or disposable"],
  ])("refuses unsafe configuration %#", (env, message) => {
    expect(() => assertSyntheticPilotEnvironment(env)).toThrow(message);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("synthetic pilot PostgreSQL execution", () => {
  it("runs the real worker through governed proof and emits a synthetic-only report", async () => {
    const report = await runSyntheticPilot({ ...process.env, NH_SYNTHETIC_PILOT: "true" });
    expect(report).toMatchObject({
      schemaVersion: "nh-synthetic-pilot-v2",
      syntheticOnly: true,
      containsRealCustomerData: false,
      claimsRealRevenue: false,
      agent: { agentId: "activation-deadline-v1", taskStatus: "succeeded", candidateCount: 1 },
      governedCase: { humanReview: "accepted", promotionReplayStable: true },
      syntheticAmounts: {
        // The OPPORTUNITY is still identified and reported — detection works, and that is the half of
        // the loop this pilot still demonstrates end to end.
        opportunityMinor: 10_000,
        // AND NOTHING IS PROVEN. `null` is NOT COMPUTED; a `0` would assert that a proof was found and
        // summed to nothing, which is a different and false claim. This pilot's case is an
        // ActivationMissed leak, and no mechanism can prove one.
        revenueReturnedMinor: null,
        auditableRevenueMinor: null,
      },
      proofRefused: {
        httpStatus: 403,
        reasonClaimed: "UsageActivation",
        code: "CORRECTION_CHANNEL_NOT_DECLARED",
        correctionEvidenceRole: "correction",
        sourceVerificationMethod: "ed25519-v1",
        sourceKeyId: "SYNTHETIC-pilot-billing",
      },
    });
    // THE SHAPE FORBIDS THE OLD CLAIM. A v1 consumer read `report.proof.proofId`; there is no `proof`
    // key at all now, so no reader can silently keep treating this run as having produced one.
    expect("proof" in report).toBe(false);
    expect(report.syntheticAmounts.revenueReturnedMinor).toBeNull();
    expect(report.syntheticAmounts.auditableRevenueMinor).toBeNull();
    expect(report.controlsVerified).toContain("production_worker_executed");
    // The control this pilot exists to demonstrate as of 2026-11-10: every earlier leg satisfied, and
    // the ledger's door still shut for a mechanism whose recovery nothing can attest.
    expect(report.controlsVerified).toContain("unprovable_mechanism_refused_at_approval");
    expect(report.controlsVerified).toContain("cfo_audit_export_reports_not_computed");
    expect(report.controlsVerified).toContain("opportunity_not_counted_as_revenue");
  });
});
