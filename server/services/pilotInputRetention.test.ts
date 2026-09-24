// EP-17 · Bounded, auditable retention for assessment-execution inputs — real PostgreSQL.
//
// The question here is not "does delete work" but "can a pseudonymised customer row be deleted at a
// moment, or by an actor, or for a reason that the durable record does not support" — and separately,
// "can it survive forever with nobody having decided that". Each case below is one of those two.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import {
  ABANDONED_RETENTION_VARIABLE,
  TERMINAL_GRACE_VARIABLE,
  InputRetentionFailure,
  parseInputRetentionPolicy,
  purgeEligibleInputs,
} from "./pilotInputRetention";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD_HEADERS = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

const steward = (boundaryIds: readonly string[]): ActorContext => ({
  actorId: "gov@company",
  role: "steward",
  boundaryIds: Object.freeze([...boundaryIds]),
});

/** Both required settings present. 0 means "eligible as soon as the rule's condition holds". */
const ELAPSED = { [TERMINAL_GRACE_VARIABLE]: "0", [ABANDONED_RETENTION_VARIABLE]: "0" };
const NOT_ELAPSED = { [TERMINAL_GRACE_VARIABLE]: "24", [ABANDONED_RETENTION_VARIABLE]: "30" };

describe("EP-17 · retention policy configuration is required, never defaulted", () => {
  it("reports both settings as missing rather than substituting a period", () => {
    const result = parseInputRetentionPolicy({});
    expect(result.policy).toBeNull();
    expect(result.defects).toHaveLength(2);
    expect(result.defects.join(" ")).toContain(TERMINAL_GRACE_VARIABLE);
    expect(result.defects.join(" ")).toContain(ABANDONED_RETENTION_VARIABLE);
  });

  it("refuses a half-configured policy — one setting is not a policy", () => {
    expect(parseInputRetentionPolicy({ [TERMINAL_GRACE_VARIABLE]: "24" }).policy).toBeNull();
    expect(parseInputRetentionPolicy({ [ABANDONED_RETENTION_VARIABLE]: "30" }).policy).toBeNull();
  });

  it("accepts zero, because 'purge as soon as the rule holds' is a real choice", () => {
    expect(parseInputRetentionPolicy(ELAPSED).policy).toEqual({
      terminalGraceHours: 0,
      abandonedRetentionDays: 0,
    });
  });

  it.each([" 24 ", "24"])("trims and accepts %j", (raw) => {
    expect(
      parseInputRetentionPolicy({ [TERMINAL_GRACE_VARIABLE]: raw, [ABANDONED_RETENTION_VARIABLE]: "1" }).policy
        ?.terminalGraceHours,
    ).toBe(24);
  });

  it.each(["+24", "24.0", "2e1", "-1", "twenty", "24h", ""])(
    "refuses the sloppy value %j rather than reading a period out of it",
    (raw) => {
      const result = parseInputRetentionPolicy({
        [TERMINAL_GRACE_VARIABLE]: raw,
        [ABANDONED_RETENTION_VARIABLE]: "30",
      });
      expect(result.policy).toBeNull();
      expect(result.defects).toHaveLength(1);
    },
  );

  it("caps a typo rather than accepting a century", () => {
    expect(
      parseInputRetentionPolicy({
        [TERMINAL_GRACE_VARIABLE]: "999999",
        [ABANDONED_RETENTION_VARIABLE]: "30",
      }).policy,
    ).toBeNull();
  });
});

describe.skipIf(!HAS_DB)("EP-17 · purging an execution input", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const taskStore = createPostgresAgentTaskStore();
  const agent = createPilotAssessmentAgent();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function runtime() {
    return new AgentRuntime({
      store: taskStore,
      policy: {
        current: () => ({
          globalEnabled: true,
          disabledAgents: new Set<string>(),
          maxAttempts: 3,
          leaseMs: 30_000,
          retryDelayMs: () => 5,
        }),
      },
      audit: { append: async () => {} },
      now: Date.now,
    });
  }

  /**
   * The whole governed lead-up, then a schedule. `freezePolicy` makes the execution BLOCK when the
   * worker reaches it, which is the other terminal state retention has to handle.
   */
  async function scheduled(options: { readonly freezePolicy?: boolean } = {}) {
    const boundaryId = `pb-${uid()}`;
    const policy = {
      policyId: `pol-${uid()}`,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      minAcceptedRows: 10,
      minDistinctEntities: 5,
      maxRejectionRate: 0.2,
      maxSingleReasonShare: 0.9,
      maxDuplicateRate: 0.05,
      minCoverageDays: 10,
      requiredLifecycleStates: ["stalled", "reference"],
      maxOrderingDefectRate: 0.05,
      maxMissingRecommendedColumns: 2,
      requireProvenanceDeclaration: true,
    };
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId, policy, rationale: "pilot design agreed with finance" },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD_HEADERS,
        payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);

    const base = {
      boundaryId,
      datasetId: `ds-${uid()}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40),
      policy: { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" },
      provenance: SYNTHETIC_PROVENANCE,
    };
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/datasets", headers: OPERATOR,
        payload: { ...base, admissionPolicyId: policy.policyId },
      })).json().admission.outcome,
    ).toBe("ADMISSIBLE");

    const out = (await app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: base,
    })).json();
    expect(out.scheduled).toBe(true);

    if (options.freezePolicy) {
      expect(
        (await app.inject({
          method: "POST", url: "/pilot/admission-policies/freeze", headers: STEWARD_HEADERS,
          payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "paused" },
        })).statusCode,
      ).toBe(200);
    }
    return { boundaryId, executionId: out.executionId as string, base };
  }

  const view = async (boundaryId: string, executionId: string) =>
    (await app.inject({
      method: "GET", url: `/pilot/assessments/${executionId}?boundaryId=${boundaryId}`, headers: OPERATOR,
    })).json();

  // ── Completed ───────────────────────────────────────────────────────────────────────────────────

  it("purges a COMPLETED execution's input and preserves everything that proves the finding", async () => {
    const { boundaryId, executionId } = await scheduled();
    expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");
    const before = await view(boundaryId, executionId);
    expect(before.state).toBe("completed");

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.purged).toBe(1);
    expect(report.verdicts[0]!.decision).toBe("purged_terminal_completed");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4001");

    // The input is gone.
    expect(
      await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } }),
    ).toBe(0);

    // Everything that makes the finding attributable and reproducible is untouched.
    const after = await view(boundaryId, executionId);
    expect(after.state).toBe("completed");
    expect(after.inputHash).toBe(before.inputHash);
    expect(after.bindingHash).toBe(before.bindingHash);
    expect(after.binding).toEqual(before.binding);
    expect(after.finding.findingHash).toBe(before.finding.findingHash);
    expect(after.finding.finding).toEqual(before.finding.finding);
    expect(after.events.map((e: { transition: string }) => e.transition)).toEqual(
      before.events.map((e: { transition: string }) => e.transition),
    );

    // And the purge itself is on the record, with the hash and count that were deleted.
    const purge = await prisma.pilotAssessmentInputPurgeRecord.findFirstOrThrow({ where: { executionId } });
    expect(purge.reason).toBe("terminal_completed");
    expect(purge.inputHash).toBe(before.inputHash);
    expect(purge.cycleCount).toBe(40);
    expect(purge.authorizedByActorId).toBe("gov@company");
    expect(purge.authorizedByRole).toBe("steward");
    expect(purge.terminalGraceHours).toBe(0);
  });

  it("retains a COMPLETED execution's input while the grace period is unelapsed", async () => {
    const { boundaryId, executionId } = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: NOT_ELAPSED });
    expect(report.purged).toBe(0);
    expect(report.verdicts[0]!.decision).toBe("retained_grace_not_elapsed");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4006");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  // ── Blocked ─────────────────────────────────────────────────────────────────────────────────────

  it("purges a BLOCKED execution's input — a refusal is terminal too", async () => {
    const { boundaryId, executionId } = await scheduled({ freezePolicy: true });
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);
    const before = await view(boundaryId, executionId);
    expect(before.state).toBe("blocked");
    expect(before.code).toBe("NH-AX-1007");
    expect(before.finding).toBeNull();

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.verdicts[0]!.decision).toBe("purged_terminal_blocked");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4002");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(0);

    // The refusal and its code survive the purge — that is the point of keeping the event log.
    const after = await view(boundaryId, executionId);
    expect(after.state).toBe("blocked");
    expect(after.code).toBe("NH-AX-1007");
  });

  // ── Retrying ────────────────────────────────────────────────────────────────────────────────────

  it("retains the input of an execution whose task is still claimable, however old the policy says", async () => {
    const { boundaryId, executionId } = await scheduled();
    // Never run: the task sits `queued`, which is claimable. Even with a zero-length policy the input
    // must stay — a run still in flight will need it.
    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.purged).toBe(0);
    expect(report.verdicts[0]!.decision).toBe("retained_in_flight");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4005");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  it("retains the input while the task is waiting to retry", async () => {
    const { boundaryId, executionId } = await scheduled();
    await prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET status = 'retry_wait' WHERE boundary_id = $1 AND idempotency_key = $2`,
      boundaryId, executionId,
    );
    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.verdicts[0]!.decision).toBe("retained_in_flight");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  it("retains the input while a worker actually holds the lease", async () => {
    const { boundaryId, executionId } = await scheduled();
    // A real claim, not a faked status: `agent_tasks_lease_shape` rightly refuses a `leased` row with
    // no owner or token, so the only honest way to reach that state is to take the lease.
    const claimed = await taskStore.claimDue({
      boundaryId,
      agentId: PILOT_ASSESSMENT_AGENT_ID,
      workerId: `holder-${uid()}`,
      now: Date.now(),
      leaseMs: 300_000,
      maxAttempts: 3,
    });
    expect(claimed?.leaseOwner).toBeTruthy();

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.verdicts[0]!.decision).toBe("retained_in_flight");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  // ── Abandoned ───────────────────────────────────────────────────────────────────────────────────

  it("purges an ABANDONED execution — never terminal, no claimable task, retention elapsed", async () => {
    const { boundaryId, executionId } = await scheduled();
    // The worker died on its last attempt and the task was terminalized. The execution never reached a
    // terminal state of its own, so no grace rule applies to it — only the abandoned rule does.
    await prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET status = 'dead_lettered' WHERE boundary_id = $1 AND idempotency_key = $2`,
      boundaryId, executionId,
    );
    const before = await view(boundaryId, executionId);
    expect(before.state).toBe("queued"); // scheduled, never claimed
    expect(before.finding).toBeNull();

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.verdicts[0]!.decision).toBe("purged_abandoned");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4003");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(0);

    const purge = await prisma.pilotAssessmentInputPurgeRecord.findFirstOrThrow({ where: { executionId } });
    expect(purge.reason).toBe("abandoned_retention_elapsed");
    expect(purge.abandonedRetentionDays).toBe(0);
  });

  it("retains an abandoned execution's input while its retention period is unelapsed", async () => {
    const { boundaryId, executionId } = await scheduled();
    await prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET status = 'dead_lettered' WHERE boundary_id = $1 AND idempotency_key = $2`,
      boundaryId, executionId,
    );
    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: NOT_ELAPSED });
    expect(report.verdicts[0]!.decision).toBe("retained_retention_not_elapsed");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4007");
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  // ── No policy ───────────────────────────────────────────────────────────────────────────────────

  it("deletes nothing with no policy configured, and says so rather than reporting a quiet success", async () => {
    const { boundaryId, executionId } = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);

    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: {} });
    expect(report.policy).toBeNull();
    expect(report.purged).toBe(0);
    expect(report.examined).toBe(1);
    expect(report.verdicts[0]!.decision).toBe("retained_no_policy");
    expect(report.verdicts[0]!.code.code).toBe("NH-AX-4004");
    expect(report.defects).toHaveLength(2);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  // ── Tenant isolation ────────────────────────────────────────────────────────────────────────────

  it("purges only the named boundary and leaves another tenant's input untouched", async () => {
    const a = await scheduled();
    const b = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, a.boundaryId);
    await runtime().runNext(agent, `w-${uid()}`, b.boundaryId);

    const report = await purgeEligibleInputs(steward([a.boundaryId]), {
      boundaryId: a.boundaryId, env: ELAPSED,
    });
    expect(report.purged).toBe(1);
    expect(report.verdicts.every((v) => v.boundaryId === a.boundaryId)).toBe(true);

    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: a.executionId } })).toBe(0);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: b.executionId } })).toBe(1);
    expect(await prisma.pilotAssessmentInputPurgeRecord.count({ where: { boundaryId: b.boundaryId } })).toBe(0);
  });

  it("refuses a purge scoped to a boundary the actor does not hold", async () => {
    const { boundaryId } = await scheduled();
    await expect(
      purgeEligibleInputs(steward(["some-other-tenant"]), { boundaryId, env: ELAPSED }),
    ).rejects.toThrow(/not authorized for this boundary/i);
  });

  it.each(["operator", "author", "approver", "verifier"] as const)(
    "refuses a purge by a %s — only a steward holds PurgeAssessmentInput",
    async (role) => {
      const { boundaryId } = await scheduled();
      await expect(
        purgeEligibleInputs({ actorId: "x", role, boundaryIds: ["*"] }, { boundaryId, env: ELAPSED }),
      ).rejects.toThrow(/may not perform 'PurgeAssessmentInput'/);
    },
  );

  // ── The database re-checks the decision ─────────────────────────────────────────────────────────

  it("refuses an authorization the event log does not support", async () => {
    const { boundaryId, executionId } = await scheduled();
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({ where: { executionId } });
    const base = {
      executionId,
      boundaryId,
      inputHash: input.inputHash,
      cycleCount: input.cycleCount,
      terminalGraceHours: 0,
      abandonedRetentionDays: 0,
      authorizedByActorId: "gov@company",
      authorizedByRole: "steward",
    };

    // Never completed, never blocked, and its task is still claimable.
    await expect(
      prisma.pilotAssessmentInputPurgeRecord.create({ data: { ...base, reason: "terminal_completed" } }),
    ).rejects.toThrow(/claimable task|COMPLETED event/i);
    await expect(
      prisma.pilotAssessmentInputPurgeRecord.create({ data: { ...base, reason: "abandoned_retention_elapsed" } }),
    ).rejects.toThrow(/claimable task/i);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  it("refuses to call a completed execution abandoned, and refuses an unelapsed grace period", async () => {
    const { boundaryId, executionId } = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({ where: { executionId } });
    const base = {
      executionId,
      boundaryId,
      inputHash: input.inputHash,
      cycleCount: input.cycleCount,
      authorizedByActorId: "gov@company",
      authorizedByRole: "steward",
    };

    await expect(
      prisma.pilotAssessmentInputPurgeRecord.create({
        data: { ...base, reason: "abandoned_retention_elapsed", terminalGraceHours: 0, abandonedRetentionDays: 0 },
      }),
    ).rejects.toThrow(/reached a terminal state/i);

    // A grace period recorded as 24h cannot authorize a purge one second after completion.
    await expect(
      prisma.pilotAssessmentInputPurgeRecord.create({
        data: { ...base, reason: "terminal_completed", terminalGraceHours: 24, abandonedRetentionDays: 0 },
      }),
    ).rejects.toThrow(/grace period has not elapsed/i);

    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  it("refuses an authorization for another tenant's execution", async () => {
    const { executionId } = await scheduled();
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({ where: { executionId } });
    await expect(
      prisma.pilotAssessmentInputPurgeRecord.create({
        data: {
          executionId,
          boundaryId: `pb-${uid()}`, // a boundary this execution does not belong to
          reason: "terminal_completed",
          inputHash: input.inputHash,
          cycleCount: input.cycleCount,
          terminalGraceHours: 0,
          abandonedRetentionDays: 0,
          authorizedByActorId: "gov@company",
          authorizedByRole: "steward",
        },
      }),
    ).rejects.toThrow(/names no execution in this boundary/i);
  });

  it("refuses a bare DELETE with no recorded authorization, and still refuses UPDATE outright", async () => {
    const { executionId } = await scheduled();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM pilot_assessment_execution_inputs WHERE execution_id = $1`, executionId),
    ).rejects.toThrow(/recorded purge authorization/i);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_execution_inputs SET cycle_count = 1 WHERE execution_id = $1`, executionId),
    ).rejects.toThrow(/append-only/i);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });

  it("keeps the purge record itself immutable", async () => {
    const { boundaryId, executionId } = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);
    await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_input_purges SET reason = 'terminal_blocked' WHERE execution_id = $1`, executionId),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM pilot_assessment_input_purges WHERE execution_id = $1`, executionId),
    ).rejects.toThrow(/append-only/i);
  });

  // ── A purged input is a distinct, legible outcome ───────────────────────────────────────────────

  it("blocks a later run on a purged input with NH-AX-2005, not the missing-input code", async () => {
    const { boundaryId, executionId } = await scheduled();
    await runtime().runNext(agent, `w-${uid()}`, boundaryId);
    await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });

    // Drive the handler directly: the task has already succeeded, so nothing would re-claim it.
    await agent.run(
      { executionId },
      { taskId: `TASK-${executionId}`, boundaryId, attempt: 2 },
    );
    const events = await prisma.pilotAssessmentExecutionEventRecord.findMany({
      where: { executionId, transition: "BLOCKED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.code).toBe("NH-AX-2005");
    expect(events[0]!.detail).toMatch(/purged under the retention policy \(terminal_completed\)/);
  });

  // ── TRUNCATE is no longer a way around any of this ─────────────────────────────────────────────

  it.each([
    "pilot_assessment_executions",
    "pilot_assessment_execution_inputs",
    "pilot_assessment_execution_events",
    "pilot_assessment_findings",
    "pilot_assessment_input_purges",
  ])("rejects TRUNCATE on %s", async (table) => {
    await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`)).rejects.toThrow(/append-only/i);
  });

  it("still has every row after the refused truncations", async () => {
    // A rejected TRUNCATE must roll back, not partially empty the table.
    const { executionId } = await scheduled();
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { executionId } })).toBe(1);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
  });
});

// ── EP-18 · The two defects found in review of EP-17 ───────────────────────────────────────────────
//
// Both were in the scan loop, and both made the retention job lie in a reassuring direction: one let
// eligible records sit behind an ineligible prefix forever, the other reported a database failure as a
// routine retention decision. Each test below fails against the previous implementation.

describe.skipIf(!HAS_DB)("EP-18 · the scan reaches records behind an ineligible prefix", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /**
   * Several executions in ONE boundary under one activated policy, oldest first.
   *
   * Each needs different bytes, or the second submission would be a duplicate of the first. The policy
   * is activated once, before any dataset is seen, so pre-registration is satisfied for all of them.
   */
  async function boundaryWithExecutions(rowCounts: readonly number[]) {
    const boundaryId = `pb-${uid()}`;
    const policy = {
      policyId: `pol-${uid()}`,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      minAcceptedRows: 10,
      minDistinctEntities: 5,
      maxRejectionRate: 0.2,
      maxSingleReasonShare: 0.9,
      maxDuplicateRate: 0.05,
      minCoverageDays: 10,
      requiredLifecycleStates: ["stalled", "reference"],
      maxOrderingDefectRate: 0.05,
      maxMissingRecommendedColumns: 2,
      requireProvenanceDeclaration: true,
    };
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId, policy, rationale: "pilot design agreed with finance" },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD_HEADERS,
        payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);

    const executionIds: string[] = [];
    for (const rows of rowCounts) {
      const base = {
        boundaryId,
        datasetId: `ds-${uid()}`,
        declaredVersion: PILOT_DATA_CONTRACT_VERSION,
        csvText: syntheticPilotCsv(rows),
        policy: { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" },
        provenance: SYNTHETIC_PROVENANCE,
      };
      expect(
        (await app.inject({
          method: "POST", url: "/pilot/datasets", headers: OPERATOR,
          payload: { ...base, admissionPolicyId: policy.policyId },
        })).json().admission.outcome,
      ).toBe("ADMISSIBLE");
      const out = (await app.inject({
        method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: base,
      })).json();
      expect(out.scheduled).toBe(true);
      executionIds.push(out.executionId as string);
    }
    return { boundaryId, executionIds };
  }

  /** Make an execution eligible under the abandoned rule by terminalizing its task. */
  const abandon = (boundaryId: string, executionId: string) =>
    prisma.$executeRawUnsafe(
      `UPDATE agent_tasks SET status = 'dead_lettered' WHERE boundary_id = $1 AND idempotency_key = $2`,
      boundaryId, executionId,
    );

  it("purges an eligible record that sits behind ineligible ones, and reports the stop reason", async () => {
    // A and B keep claimable tasks, so they are permanently ineligible. C and D are abandoned and
    // eligible. With a one-record page and a one-record purge budget, the previous implementation read
    // exactly one record and purged nothing — forever, on every run. This is that bug.
    const { boundaryId, executionIds } = await boundaryWithExecutions([40, 41, 42, 43]);
    const [a, b, c, d] = executionIds as [string, string, string, string];
    await abandon(boundaryId, c);
    await abandon(boundaryId, d);

    const first = await purgeEligibleInputs(steward([boundaryId]), {
      boundaryId, env: ELAPSED, limit: 1, scanPageSize: 1,
    });

    // It paged past A and B rather than stopping at the head of the queue.
    expect(first.examined).toBe(3);
    expect(first.purged).toBe(1);
    expect(first.retained).toBe(2);
    expect(first.reachedPurgeLimit).toBe(true);
    expect(first.scanComplete).toBe(false);
    expect(first.verdicts.filter((v) => v.purged).map((v) => v.executionId)).toEqual([c]);
    expect(first.countsByDecision).toEqual({ "NH-AX-4005": 2, "NH-AX-4003": 1 });

    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: c } })).toBe(0);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: d } })).toBe(1);

    // PROGRESS IS GUARANTEED. The next run starts from the oldest remaining record; C is gone, so the
    // same prefix no longer costs anything and D is reached.
    const second = await purgeEligibleInputs(steward([boundaryId]), {
      boundaryId, env: ELAPSED, limit: 1, scanPageSize: 1,
    });
    expect(second.purged).toBe(1);
    expect(second.verdicts.filter((v) => v.purged).map((v) => v.executionId)).toEqual([d]);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: d } })).toBe(0);

    // A and B are untouched throughout: they were never eligible, only in the way.
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: a } })).toBe(1);
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId: b } })).toBe(1);
  });

  it("reports scanComplete once it has reached the end, with a budget it never spends", async () => {
    const { boundaryId, executionIds } = await boundaryWithExecutions([40, 41]);
    await abandon(boundaryId, executionIds[1]!);

    const report = await purgeEligibleInputs(steward([boundaryId]), {
      boundaryId, env: ELAPSED, limit: 50, scanPageSize: 1,
    });
    expect(report.examined).toBe(2);
    expect(report.purged).toBe(1);
    expect(report.scanComplete).toBe(true);
    expect(report.reachedPurgeLimit).toBe(false);
    expect(report.verdictsTruncated).toBe(false);
  });

  it("keeps counts exact for every decision even though verdicts are a bounded sample", async () => {
    const { boundaryId } = await boundaryWithExecutions([40, 41]);
    const report = await purgeEligibleInputs(steward([boundaryId]), {
      boundaryId, env: ELAPSED, scanPageSize: 1,
    });
    // Both retained: their tasks are still claimable.
    expect(report.examined).toBe(2);
    expect(report.purged).toBe(0);
    expect(report.countsByDecision).toEqual({ "NH-AX-4005": 2 });
    expect(report.scanComplete).toBe(true);
  });

  it("reports the true total with no policy, not the size of one page", async () => {
    const { boundaryId } = await boundaryWithExecutions([40, 41, 42]);
    const report = await purgeEligibleInputs(steward([boundaryId]), {
      boundaryId, env: {}, scanPageSize: 1,
    });
    // The old implementation reported whatever one page held. Three inputs exist; three are reported.
    expect(report.examined).toBe(3);
    expect(report.retained).toBe(3);
    expect(report.countsByDecision).toEqual({ "NH-AX-4004": 3 });
    expect(report.policy).toBeNull();
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { boundaryId } })).toBe(3);
  });
});

describe.skipIf(!HAS_DB)("EP-18 · a database failure fails the run instead of reading as a retention decision", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const taskStore = createPostgresAgentTaskStore();
  const agent = createPilotAssessmentAgent();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function runtime() {
    return new AgentRuntime({
      store: taskStore,
      policy: {
        current: () => ({
          globalEnabled: true,
          disabledAgents: new Set<string>(),
          maxAttempts: 3,
          leaseMs: 30_000,
          retryDelayMs: () => 5,
        }),
      },
      audit: { append: async () => {} },
      now: Date.now,
    });
  }

  /** `run: false` leaves the task `queued`, which is genuinely claimable — no SQL surgery needed. */
  async function completedExecution(options: { readonly run?: boolean } = {}) {
    const boundaryId = `pb-${uid()}`;
    const policy = {
      policyId: `pol-${uid()}`,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      minAcceptedRows: 10,
      minDistinctEntities: 5,
      maxRejectionRate: 0.2,
      maxSingleReasonShare: 0.9,
      maxDuplicateRate: 0.05,
      minCoverageDays: 10,
      requiredLifecycleStates: ["stalled", "reference"],
      maxOrderingDefectRate: 0.05,
      maxMissingRecommendedColumns: 2,
      requireProvenanceDeclaration: true,
    };
    await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: { boundaryId, policy, rationale: "pilot design agreed with finance" },
    });
    await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD_HEADERS,
      payload: { boundaryId, policyId: policy.policyId, policyVersion: "1.0.0", rationale: "reviewed" },
    });
    const base = {
      boundaryId,
      datasetId: `ds-${uid()}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40),
      policy: { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" },
      provenance: SYNTHETIC_PROVENANCE,
    };
    await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...base, admissionPolicyId: policy.policyId },
    });
    const out = (await app.inject({
      method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: base,
    })).json();
    if (options.run !== false) {
      expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");
    }
    return { boundaryId, executionId: out.executionId as string };
  }

  it("throws InputRetentionFailure on an arbitrary database fault, deleting nothing", async () => {
    const { boundaryId, executionId } = await completedExecution();

    // A fault that is unambiguously NOT our authorization trigger refusing: a different SQLSTATE
    // entirely. This is the class the previous implementation labelled `retained_in_flight` — a
    // dropped connection or a constraint bug would have read the same way.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION nh_test_fault() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated storage fault' USING ERRCODE = 'io_error'; END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER nh_test_fault_trigger BEFORE INSERT ON "pilot_assessment_input_purges"
      FOR EACH ROW EXECUTE FUNCTION nh_test_fault();
    `);
    try {
      await expect(
        purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED }),
      ).rejects.toThrow(/input retention stopped on execution PAX-[a-f0-9]{32} after purging 0/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER nh_test_fault_trigger ON "pilot_assessment_input_purges";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION nh_test_fault();`);
    }

    // The input survives, no purge was recorded, and — the point of the fix — the run did not return
    // a report claiming the record was retained for a benign reason.
    expect(await prisma.pilotAssessmentExecutionInputRecord.count({ where: { executionId } })).toBe(1);
    expect(await prisma.pilotAssessmentInputPurgeRecord.count({ where: { executionId } })).toBe(0);
  });

  it("carries the execution and the count already purged, so the resulting state is knowable", async () => {
    const { boundaryId, executionId } = await completedExecution();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION nh_test_fault() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated storage fault' USING ERRCODE = 'io_error'; END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER nh_test_fault_trigger BEFORE INSERT ON "pilot_assessment_input_purges"
      FOR EACH ROW EXECUTE FUNCTION nh_test_fault();
    `);
    try {
      let thrown: unknown = null;
      try {
        await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
      } catch (e) {
        thrown = e;
      }
      const failure = thrown as InputRetentionFailure;
      expect(failure).toBeInstanceOf(InputRetentionFailure);
      expect(failure.name).toBe("InputRetentionFailure");
      expect(failure.executionId).toBe(executionId);
      expect(failure.purgedBeforeFailure).toBe(0);
      // The underlying database error is kept for diagnosis rather than discarded.
      expect(failure.databaseError).toBeTruthy();
      // And the message leaks nothing but an opaque identifier.
      expect(failure.message).not.toMatch(/synthetic-|entity|subscription/i);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER nh_test_fault_trigger ON "pilot_assessment_input_purges";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION nh_test_fault();`);
    }
  });

  it("fails on a conflicting purge row rather than calling it retained", async () => {
    const { boundaryId, executionId } = await completedExecution();
    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({ where: { executionId } });

    // A concurrent run already recorded the authorization. The second attempt collides on the primary
    // key — a real, reachable database error, and not one this function may translate into a verdict.
    await prisma.pilotAssessmentInputPurgeRecord.create({
      data: {
        executionId,
        boundaryId,
        reason: "terminal_completed",
        inputHash: input.inputHash,
        cycleCount: input.cycleCount,
        terminalGraceHours: 0,
        abandonedRetentionDays: 0,
        authorizedByActorId: "gov@company",
        authorizedByRole: "steward",
      },
    });

    await expect(
      purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED }),
    ).rejects.toBeInstanceOf(InputRetentionFailure);
  });

  it("still reports retained_in_flight for the case that genuinely is one", async () => {
    // The fix must not turn every retention into a failure. A claimable task is detected BEFORE any
    // write is attempted, so it stays a verdict rather than becoming an error. Left un-run, so the
    // task is `queued` on its own — forcing a status by hand is what a CHECK constraint rightly
    // refuses, and a fixture that fights the schema is testing the wrong thing.
    const { boundaryId } = await completedExecution({ run: false });
    const report = await purgeEligibleInputs(steward([boundaryId]), { boundaryId, env: ELAPSED });
    expect(report.purged).toBe(0);
    expect(report.retained).toBe(1);
    expect(report.verdicts[0]!.decision).toBe("retained_in_flight");
    expect(report.scanComplete).toBe(true);
  });
});
