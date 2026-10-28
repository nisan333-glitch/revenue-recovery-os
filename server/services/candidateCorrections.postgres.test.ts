// S-DUP-4 ON THE PRODUCTION PATH · an upward and a downward correction, detected from stored data.
//
// The subject is not the summariser's arithmetic (that is covered purely, without a database); it is
// that the corrected observation IS ALREADY IN THE DATABASE and the report reads it. The first draft of
// S-DUP-4 concluded that an absorbed correction "reaches no figure"; that was true of the CANDIDATE and
// false of the RECORD, and the difference is what this file establishes.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "../agents/bootstrap";
import { configuredAgentHandlers } from "../agents/activationDetector";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE } from "../agents/reconciliationObserver";
import {
  BILLING_COLUMNS, DUP4_EXPECTATION, EXPECTATION_COLUMNS, SCENARIO_CURRENCY, dup4Billing,
} from "../agents/fixtures/reconciliation.scenarios.data";
import {
  CANDIDATE_CORRECTIONS_SQL, observationsFromRows, summariseCorrections,
  type RawCorrectionRow,
} from "./candidateCorrections";

describe.skipIf(!process.env.DATABASE_URL)("S-DUP-4 · corrections are detected from the record", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  const run = async (billedAmounts: readonly string[]) => {
    const boundaryId = `SYNTHETIC-corr-${randomUUID()}`;
    const env = {
      NH_AGENTS_ENABLED: "true", NH_RECONCILIATION_OBSERVER_ENABLED: "true",
      NH_RECONCILER_PSEUDONYM_KEY: `test-${randomUUID()}-${randomUUID()}`,
      NH_AGENT_BOUNDARIES: boundaryId,
      NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:1000`,
      NH_AGENT_IDLE_DELAY_MS: "10",
    };
    const worker = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
    const store = createPostgresAgentTaskStore();
    worker.start();
    try {
      for (const [i, billed] of billedAmounts.entries()) {
        await store.enqueueIfAbsent({
          taskId: randomUUID(), boundaryId, agentId: RECONCILIATION_AGENT_ID,
          idempotencyKey: randomUUID(), now: Date.now(),
          payload: {
            expectation: { columns: [...EXPECTATION_COLUMNS], rows: DUP4_EXPECTATION },
            billing: { columns: [...BILLING_COLUMNS], rows: dup4Billing(billed) },
            currency: SCENARIO_CURRENCY,
            observedAt: new Date(Date.now() - 60_000).toISOString(),
            actionAvailable: true,
          },
        });
        // SEQUENTIAL, and waited on. Two corrections enqueued together would leave their append order
        // to the worker's scheduling, and the report's whole claim is about order.
        const deadline = Date.now() + 15_000;
        const done = () => prisma.agentTaskRecord.count({ where: { boundaryId, status: "succeeded" } });
        while (Date.now() < deadline && (await done()) < i + 1) await new Promise((r) => setTimeout(r, 25));
        expect(await done()).toBe(i + 1);
      }
      const raw = await prisma.$queryRawUnsafe<RawCorrectionRow[]>(CANDIDATE_CORRECTIONS_SQL, boundaryId);
      const report = summariseCorrections(observationsFromRows(raw));
      const candidates = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
      return { boundaryId, report, candidates };
    } finally { await worker.stop(); }
  };

  it("an UPWARD correction is detected, its magnitude reported, and the stored figure left alone", async () => {
    // Expected 1000.00. Billed 400.00 then restated as 200.00, so the shortfall goes 600.00 -> 800.00.
    const { report, candidates } = await run(["400.00", "200.00"]);

    expect(candidates).toHaveLength(1);
    expect((candidates[0]!.signal as { amountAtRiskMinor: number }).amountAtRiskMinor).toBe(60_000);

    expect(report.totals.identities).toBe(1);
    expect(report.totals.withCorrections).toBe(1);
    const r = report.records[0]!;
    expect(r.state).toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
    expect(r.observationCount).toBe(2);
    // EVERY AMOUNT EVER OBSERVED, in append order and none discarded. This is the field that makes
    // "preserved" a property of the report rather than a promise about the database.
    expect(r.observedAmountsMinor).toEqual([60_000, 80_000]);
    expect(r.storedMinor).toBe(60_000);
    expect(r.latestObservedMinor).toBe(80_000);
    expect(r.direction).toBe("UPWARD");
    expect(r.undecidedMagnitudeMinor).toBe(20_000);
    expect(report.totals.upwardUndecidedMinor).toBe(20_000);
    expect(report.totals.downwardUndecidedMinor).toBe(0);
    // AND THE IDENTITY IS OBLIGATION-GRAINED, which is why the correction stayed ONE identity instead of
    // becoming a second obligation: the amount is not in the key.
    expect(r.obligationGrained).toBe(true);
    expect(r.obligationRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
  }, 60_000);

  it("a DOWNWARD correction is detected and reported as overstatement, not netted against anything", async () => {
    // Billed 400.00 then restated as 800.00, so the shortfall goes 600.00 -> 200.00 and the stored
    // candidate overstates exposure by 400.00.
    const { report, candidates } = await run(["400.00", "800.00"]);

    expect(candidates).toHaveLength(1);
    expect((candidates[0]!.signal as { amountAtRiskMinor: number }).amountAtRiskMinor).toBe(60_000);

    const r = report.records[0]!;
    expect(r.state).toBe("CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
    expect(r.observedAmountsMinor).toEqual([60_000, 20_000]);
    expect(r.direction).toBe("DOWNWARD");
    expect(r.undecidedMagnitudeMinor).toBe(40_000);
    expect(report.totals.downwardUndecidedMinor).toBe(40_000);
    expect(report.totals.upwardUndecidedMinor).toBe(0);
    // NO NET FIGURE EXISTS. An understatement and an overstatement are two problems; reporting their
    // sum would report zero problems, which is false.
    expect(report.netIsDeliberatelyAbsent).toBe(true);
    expect(Object.keys(report.totals)).not.toContain("netMinor");
  }, 60_000);

  it("an identical replay is REPEATED_IDENTICAL_OBSERVATION, not a correction", async () => {
    const { report } = await run(["400.00", "400.00"]);
    const r = report.records[0]!;
    expect(r.state).toBe("REPEATED_IDENTICAL_OBSERVATION");
    expect(r.observationCount).toBe(2);
    expect(r.deltaMinor).toBe(0);
    expect(r.direction).toBeNull();
    expect(report.totals.withCorrections).toBe(0);
    expect(report.totals.repeatedIdentical).toBe(1);
  }, 60_000);

  it("a single observation decides nothing and is reported as such", async () => {
    const { report } = await run(["400.00"]);
    expect(report.records[0]!.state).toBe("SINGLE_OBSERVATION");
    expect(report.totals.withCorrections).toBe(0);
  }, 60_000);

  it("the report names no corrected exposure — a precedence decision has no field to hide in", async () => {
    const { report } = await run(["400.00", "200.00"]);
    const keys = new Set(Object.keys(report.records[0]!));
    for (const forbidden of ["correctedMinor", "authoritativeMinor", "effectiveMinor", "resolvedMinor"]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    // Structural rather than a convention: the module must not contain such a field at all.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "candidateCorrections.ts"), "utf8",
    ) as string;
    expect(/readonly\s+(corrected|authoritative|effective|resolved)Minor/.test(src)).toBe(false);
  }, 60_000);
});
