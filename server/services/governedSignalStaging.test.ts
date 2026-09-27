// EP-31 · The staging half of the bridge: configuration, derivation, and the database consequences.
//
// The question these answer is not "does staging work" but "can a candidate ever exist without a
// governed execution behind it, or can a raw customer identifier reach the bridge". Every case below is
// an attempt at one of those.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS, TEST_ANALYSIS_TERMS } from "../test/governedTerms";
import { schedulePilotAssessment } from "./pilotAssessmentService";
import { createExecutionIfAbsent, findExecution } from "../persistence/pilotExecutionStore";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import {
  AttributionReconciliationError,
  deriveStagedAttributions,
  mayStage,
  resolveSignalStagingConfig,
  stagedSourceRef,
  SIGNAL_EMITTER_BOUNDARIES_VARIABLE,
  SIGNAL_EMITTER_ENABLED_VARIABLE,
  SOURCE_REF_KEY_VARIABLE,
  type SignalStagingConfig,
} from "./governedSignalStaging";
import { makePolicy } from "../../src/assessment/policy";
import { money } from "../../src/domain/money";
import type { ExpectationCycle } from "../../src/assessment/types";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "EP31-TEST-ONLY-KEY-NOT-FOR-CUSTOMERS-32+";
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };

// ══ 1 · Configuration — off by default, per boundary, key validated at boot ════════════════════════

describe("EP-31 · staging configuration", () => {
  it("1 · unset is OFF, and so is an explicit false", () => {
    expect(resolveSignalStagingConfig({})).toBeNull();
    expect(resolveSignalStagingConfig({ [SIGNAL_EMITTER_ENABLED_VARIABLE]: "false" })).toBeNull();
  });

  it("2 · any value other than true/false is a configuration error, never a silent default", () => {
    for (const value of ["TRUE", "1", "yes", "on", " true", ""]) {
      expect(() => resolveSignalStagingConfig({ [SIGNAL_EMITTER_ENABLED_VARIABLE]: value }), value)
        .toThrow(`${SIGNAL_EMITTER_ENABLED_VARIABLE} must be true or false`);
    }
  });

  it("3 · enabled with an EMPTY allowlist is off everywhere, and needs no key", () => {
    // The state a deployment passes through while a boundary is being enrolled. Deliberately not an error.
    const config = resolveSignalStagingConfig({ [SIGNAL_EMITTER_ENABLED_VARIABLE]: "true" });
    expect(config).not.toBeNull();
    expect(config!.boundaries.size).toBe(0);
    expect(mayStage(config, "any-boundary")).toBe(false);
  });

  it("4 · BOTH gates are required: the master switch AND the per-boundary allowlist", () => {
    const config = resolveSignalStagingConfig({
      [SIGNAL_EMITTER_ENABLED_VARIABLE]: "true",
      [SIGNAL_EMITTER_BOUNDARIES_VARIABLE]: " enrolled-a , enrolled-b ",
      [SOURCE_REF_KEY_VARIABLE]: KEY,
    });
    expect(mayStage(config, "enrolled-a")).toBe(true);
    expect(mayStage(config, "enrolled-b")).toBe(true);
    expect(mayStage(config, "not-enrolled")).toBe(false);
    // The switch alone is not enough, and the allowlist alone is not reachable — `null` means off.
    expect(mayStage(null, "enrolled-a")).toBe(false);
  });

  it("5 · an allowlisted boundary with a missing or short key is a STARTUP failure", () => {
    // Refused here rather than per request: a running server that silently stages nothing would be the
    // worse failure, because nobody would learn the bridge was configured and inert.
    for (const key of [undefined, "", "too-short", "a".repeat(31)]) {
      expect(() =>
        resolveSignalStagingConfig({
          [SIGNAL_EMITTER_ENABLED_VARIABLE]: "true",
          [SIGNAL_EMITTER_BOUNDARIES_VARIABLE]: "enrolled-a",
          ...(key === undefined ? {} : { [SOURCE_REF_KEY_VARIABLE]: key }),
        }),
      ).toThrow(new RegExp(`${SOURCE_REF_KEY_VARIABLE} must be at least 32 bytes`));
    }
    expect(() =>
      resolveSignalStagingConfig({
        [SIGNAL_EMITTER_ENABLED_VARIABLE]: "true",
        [SIGNAL_EMITTER_BOUNDARIES_VARIABLE]: "enrolled-a",
        [SOURCE_REF_KEY_VARIABLE]: "a".repeat(32),
      }),
    ).not.toThrow();
  });
});

// ══ 2 · Derivation — pseudonymity, stability, reconciliation ═══════════════════════════════════════

describe("EP-31 · staged attribution derivation", () => {
  const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });
  const config: SignalStagingConfig = { boundaries: new Set(["b1"]), sourceRefKey: KEY };

  const cycle = (id: string, entityId: string, amountMinor: number): ExpectationCycle => ({
    cycleId: id,
    sourceRowId: `row-${id}`,
    entityId,
    expectationAt: "2026-01-01",
    observationAt: null,
    currency: "USD",
    statusRaw: null,
    attributes: {},
    monetaryEvent: {
      dueAt: "2026-02-01",
      amount: money(amountMinor, "USD"),
      paidAt: null,
      paidAmount: null,
      refundedAt: null,
      cancelledAt: null,
    },
  });

  const aggregate = (unpaidMinor: number) => ({
    observedUnpaid: money(unpaidMinor, "USD"),
    partialOutstanding: money(0, "USD"),
  });

  it("6 · stages nothing for a boundary that is not enrolled", () => {
    const cycles = [cycle("c1", "acct-a", 50_000)];
    expect(deriveStagedAttributions(config, "not-enrolled", cycles, policy, aggregate(50_000))).toEqual([]);
    expect(deriveStagedAttributions(null, "b1", cycles, policy, aggregate(50_000))).toEqual([]);
  });

  it("7 · never writes a raw identifier — every reference is an hmac-sha256 pseudonym", () => {
    const rows = deriveStagedAttributions(config, "b1", [cycle("c1", "acct-a", 50_000)], policy, aggregate(50_000));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("acct-a");
  });

  it("8 · the pseudonym is STABLE for one account and depends on nothing but boundary and account id", () => {
    // This is the property that makes one account one candidate across re-exports. An ordinal-based
    // reference would change with row order and produce a second candidate for the same customer.
    const a = stagedSourceRef(KEY, "b1", "acct-a");
    expect(stagedSourceRef(KEY, "b1", "acct-a")).toBe(a);
    // Different account, different boundary and different key all diverge.
    expect(stagedSourceRef(KEY, "b1", "acct-b")).not.toBe(a);
    expect(stagedSourceRef(KEY, "b2", "acct-a")).not.toBe(a);
    expect(stagedSourceRef(`${KEY}x`, "b1", "acct-a")).not.toBe(a);
  });

  it("9 · row ORDER and row COUNT do not change an account's reference or its amount", () => {
    const first = deriveStagedAttributions(
      config, "b1",
      [cycle("c1", "acct-a", 40_000), cycle("c2", "acct-b", 10_000)],
      policy, aggregate(50_000),
    );
    // A second "export": reversed, and with an extra unrelated account.
    const second = deriveStagedAttributions(
      config, "b1",
      [cycle("cX", "acct-c", 7_000), cycle("c2", "acct-b", 10_000), cycle("c1", "acct-a", 40_000)],
      policy, aggregate(57_000),
    );
    const refOf = (rows: readonly { sourceRef: string; amountAtRiskMinor: number }[], n: number) =>
      rows.find((r) => r.sourceRef === stagedSourceRef(KEY, "b1", `acct-${n === 1 ? "a" : "b"}`))!;
    expect(refOf(second, 1).sourceRef).toBe(refOf(first, 1).sourceRef);
    expect(refOf(second, 1).amountAtRiskMinor).toBe(40_000);
    expect(refOf(second, 2).sourceRef).toBe(refOf(first, 2).sourceRef);
  });

  it("10 · REFUSES to stage when the per-account figures do not reconcile with the aggregate", () => {
    // Candidates nobody can tie back to the finding are worse than no candidates, so this throws rather
    // than staging a figure the assessment never reported.
    expect(() =>
      deriveStagedAttributions(config, "b1", [cycle("c1", "acct-a", 50_000)], policy, aggregate(49_999)),
    ).toThrow(AttributionReconciliationError);
  });
});

// ══ 3 · Database consequences ══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_DB)("EP-31 · staging, against a real database", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const actor = (boundaryId: string) =>
    ({ actorId: "pilot-operator@company", role: "operator" as const, boundaryIds: [boundaryId] });

  /** Admit a dataset through the real HTTP path, and return the body a schedule needs. */
  async function admitted(boundaryId: string) {
    await ensureGovernedTerms(boundaryId);
    const policyId = `pol-${uid()}`;
    const policy = {
      policyId, policyVersion: "1.0.0", calculationMethodVersion: ADMISSION_CALC_VERSION,
      minAcceptedRows: 10, minDistinctEntities: 5, maxRejectionRate: 0.2, maxSingleReasonShare: 0.9,
      maxDuplicateRate: 0.05, minCoverageDays: 10, requiredLifecycleStates: ["stalled", "reference"],
      maxOrderingDefectRate: 0.05, maxMissingRecommendedColumns: 2, requireProvenanceDeclaration: true,
    };
    await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: { boundaryId, policy, rationale: "EP-31 staging test" } as object,
    });
    await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" } as object,
    });
    const body = {
      boundaryId, datasetId: `ds-${uid()}`, declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40), ...GOVERNED_TERMS_FIELDS, provenance: SYNTHETIC_PROVENANCE,
    };
    const upload = await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...body, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" } as object,
    });
    expect(upload.json().admission.outcome).toBe("ADMISSIBLE");
    return body;
  }

  const rowsFor = (executionId: string) =>
    prisma.pilotAssessmentEntityAttributionRecord.findMany({ where: { executionId } });

  it("11 · OFF by default: a scheduled execution stages nothing at all", async () => {
    const boundaryId = `ep31-off-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never);
    expect(result.scheduled).toBe(true);
    expect(await rowsFor(result.executionId!)).toEqual([]);
  });

  it("12 · enrolled: stages one row per account, reconciling with the finding the worker later writes", async () => {
    const boundaryId = `ep31-on-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });
    expect(result.scheduled).toBe(true);
    const rows = await rowsFor(result.executionId!);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
      expect(Number(row.amountAtRiskMinor)).toBeGreaterThan(0);
      expect(row.currency).toBe(TEST_ANALYSIS_TERMS.currency);
      expect(row.contributingCycleCount).toBeGreaterThan(0);
      expect(row.boundaryId).toBe(boundaryId);
    }
    // NO RAW IDENTIFIER anywhere in the table — queried, not assumed.
    const serialized = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(serialized).not.toMatch(/synthetic-account|entity_id/i);
  });

  it("13 · a staged row is NOT a candidate: nothing appears in the review queue", async () => {
    const boundaryId = `ep31-queue-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });
    expect((await rowsFor(result.executionId!)).length).toBeGreaterThan(0);
    const queue = await app.inject({
      method: "GET", url: `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, headers: OPERATOR,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toEqual([]);
  });

  it("14 · the table is append-only and its rows cannot be edited", async () => {
    const boundaryId = `ep31-append-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });
    const [row] = await rowsFor(result.executionId!);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_assessment_entity_attributions SET amount_at_risk_minor = 1 WHERE execution_id = $1`,
        result.executionId!,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM pilot_assessment_entity_attributions WHERE execution_id = $1`,
        result.executionId!,
      ),
    ).rejects.toThrow(/requires a recorded purge authorization/i);
    await expect(
      prisma.$executeRawUnsafe(`TRUNCATE pilot_assessment_entity_attributions`),
    ).rejects.toThrow(/append-only/i);
    expect(Number(row!.amountAtRiskMinor)).toBeGreaterThan(0);
  });

  it("15 · the database refuses a raw identifier and a non-positive amount, whatever a caller intends", async () => {
    const boundaryId = `ep31-check-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });
    const insert = (sourceRef: string, minor: number, cycles = 1) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO pilot_assessment_entity_attributions
           (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency, contributing_cycle_count, attribution_rule)
         VALUES ($1, $2, $3, $4, 'USD', $5, 'nh-entity-attribution-v1')`,
        result.executionId!, boundaryId, sourceRef, minor, cycles,
      );
    // A raw account id is refused by the CHECK, not merely discouraged by convention.
    await expect(insert("synthetic-account-0001", 100)).rejects.toThrow(/pseudonymous/i);
    await expect(insert(`hmac-sha256:${"a".repeat(64)}`, 0)).rejects.toThrow(/positive/i);
    await expect(insert(`hmac-sha256:${"b".repeat(64)}`, -1)).rejects.toThrow(/positive/i);
    await expect(insert(`hmac-sha256:${"c".repeat(64)}`, 100, 0)).rejects.toThrow(/has_cycles/i);
    // And no attribution may exist without its execution.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO pilot_assessment_entity_attributions
           (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency, contributing_cycle_count, attribution_rule)
         VALUES ($1, $2, $3, 100, 'USD', 1, 'nh-entity-attribution-v1')`,
        `PAX-${"0".repeat(32)}`, boundaryId, `hmac-sha256:${"d".repeat(64)}`,
      ),
    ).rejects.toThrow(/foreign key|fkey/i);
  });

  it("16a · ATOMICITY · if the transaction fails, there is NO execution and NO staged row", async () => {
    // The control the review required, in the direction that matters: staging shares the execution's
    // transaction, so neither can survive the other's failure. Forced with a row the CHECK refuses —
    // a raw identifier — which the real path cannot produce but a mistaken caller could.
    const boundaryId = `ep31-atomic-${uid()}`;
    const body = await admitted(boundaryId);
    const good = await schedulePilotAssessment(actor(boundaryId), body as never);
    const binding = (await findExecution(good.executionId!, boundaryId))!.binding;

    // A DIFFERENT execution id, so this is a genuine create rather than the idempotent path.
    const executionId = `PAX-${"f".repeat(32)}`;
    await expect(
      createExecutionIfAbsent({
        executionId,
        binding,
        bindingHash: "sha256:" + "a".repeat(64),
        input: { scheme: "nh-pilot-assessment-projection-v1", cycles: [] } as never,
        inputHash: "sha256:" + "b".repeat(64),
        scheduledByActorId: "pilot-operator@company",
        scheduledByRole: "operator",
        attributions: [{
          sourceRef: "synthetic-account-0001", // refused by pilot_assessment_attributions_pseudonymous
          amountAtRiskMinor: 100, currency: "USD", contributingCycleCount: 1,
          attributionRule: "nh-entity-attribution-v1",
        }],
      }),
    ).rejects.toThrow();

    // NEITHER table has a row. That is the guarantee: no staged attribution without its execution, and
    // no execution left half-written by a staging failure.
    expect(await rowsFor(executionId)).toEqual([]);
    expect(await prisma.pilotAssessmentExecutionRecord.findMany({ where: { executionId } })).toEqual([]);
    // Observed rather than asserted as desirable: the store's race-recovery catch reports
    // "execution could not be created or re-read" for ANY transaction failure, so the message does not
    // name the real cause. Harmless here — nothing persisted — and recorded because a future reader
    // debugging a constraint violation will not be told which constraint it was.
  });

  it("16b · the staged total reconciles with the finding the WORKER actually wrote", async () => {
    // Invariant 10 against the real finding, not only against the schedule-time computation: the worker
    // re-derives everything from the de-identified projection, so this is the end-to-end check that the
    // two computations agree.
    const boundaryId = `ep31-recon-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });
    const staged = await rowsFor(result.executionId!);
    const stagedTotal = staged.reduce((sum, row) => sum + Number(row.amountAtRiskMinor), 0);

    const runtime = new AgentRuntime({
      store: createPostgresAgentTaskStore(),
      policy: {
        current: () => ({
          globalEnabled: true, disabledAgents: new Set<string>(), maxAttempts: 3,
          leaseMs: 30_000, retryDelayMs: () => 5,
        }),
      },
      audit: { append: async () => {} },
      now: Date.now,
    });
    await runtime.runNext(createPilotAssessmentAgent(), `w-${uid()}`, boundaryId);

    const view = await app.inject({
      method: "GET",
      url: `/pilot/assessments/${result.executionId!}?boundaryId=${encodeURIComponent(boundaryId)}`,
      headers: OPERATOR,
    });
    const finding = view.json().finding?.finding;
    expect(view.json().state).toBe("completed");
    expect(stagedTotal).toBe(finding.observedUnpaidMinor + finding.partialOutstandingMinor);
    expect(stagedTotal).toBeGreaterThan(0); // not a vacuous 0 === 0
  });

  it("16 · re-scheduling the same assessment stages no second set of rows", async () => {
    const boundaryId = `ep31-idem-${uid()}`;
    const body = await admitted(boundaryId);
    const deps = { signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY } };
    const first = await schedulePilotAssessment(actor(boundaryId), body as never, deps);
    const before = await rowsFor(first.executionId!);
    const second = await schedulePilotAssessment(actor(boundaryId), body as never, deps);
    expect(second.executionId).toBe(first.executionId);
    expect(await rowsFor(first.executionId!)).toHaveLength(before.length);
  });
});
