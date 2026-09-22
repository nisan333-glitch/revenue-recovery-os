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
      schemaVersion: "nh-synthetic-pilot-v1",
      syntheticOnly: true,
      containsRealCustomerData: false,
      claimsRealRevenue: false,
      agent: { agentId: "activation-deadline-v1", taskStatus: "succeeded", candidateCount: 1 },
      governedCase: { humanReview: "accepted", promotionReplayStable: true },
      syntheticAmounts: {
        opportunityMinor: 10_000,
        revenueReturnedMinor: 5_000,
        auditableRevenueMinor: 5_000,
      },
      proof: { sourceVerificationMethod: "ed25519-v1", sourceKeyId: "SYNTHETIC-pilot-billing" },
    });
    expect(report.controlsVerified).toContain("production_worker_executed");
    expect(report.controlsVerified).toContain("opportunity_not_counted_as_revenue");
  });
});
