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
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS, TEST_ANALYSIS_TERMS } from "../test/governedTerms";
import { schedulePilotAssessment } from "./pilotAssessmentService";
import { createExecutionIfAbsent, findExecution } from "../persistence/pilotExecutionStore";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import {
  deriveStagedAttributions,
  mayStage,
  resolveSignalStagingConfig,
  stagedSourceRef,
  SIGNAL_EMITTER_BOUNDARIES_VARIABLE,
  SIGNAL_EMITTER_ENABLED_VARIABLE,
  SOURCE_REF_KEY_VARIABLE,
  type SignalStagingConfig,
} from "./governedSignalStaging";
import {
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  leakInstanceIdentityStatus,
} from "../../src/contract/leakInstanceIdentity";
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

  it("6 · a boundary that is not enrolled is BLOCKED with its own named reason, not silently empty", () => {
    const cycles = [cycle("c1", "acct-a", 50_000)];
    for (const [cfg, where] of [[config, "not-enrolled"], [null, "b1"]] as const) {
      const decision = deriveStagedAttributions(cfg, where, cycles, policy, aggregate(50_000));
      expect(decision.staged).toBe(false);
      expect(decision.reason).toBe("boundary_not_enrolled");
      expect(decision.attributions).toEqual([]);
      expect(decision.detail).toMatch(/not enrolled/i);
    }
  });

  it("7 · an enrolled boundary is BLOCKED on leak-instance identity, and stages nothing", () => {
    // The standing blocker under the current data contract. `docs/GOVERNED_DETECTION_V1.md` records why:
    // no declared field can distinguish two obligations sharing (entity, signed_at, due_at), and nothing
    // at all distinguishes a rescheduled due date from a new occurrence.
    const decision = deriveStagedAttributions(config, "b1", [cycle("c1", "acct-a", 50_000)], policy, aggregate(50_000));
    expect(decision.staged).toBe(false);
    expect(decision.reason).toBe("leak_instance_identity_unavailable");
    expect(decision.attributions).toEqual([]);
    expect(decision.detail).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
    // It NEVER throws: a candidate-side limitation must not travel up the assessment path.
    expect(() => deriveStagedAttributions(config, "b1", [], policy, aggregate(0))).not.toThrow();
  });

  it("8b · the pseudonym function is unchanged and still order-, count- and file-independent", () => {
    // Kept at unit level because the staged-row path is blocked: the reference derivation itself is still
    // worth pinning, and it is the property that would make one account one candidate once identity exists.
    const a = stagedSourceRef(KEY, "b1", "acct-a");
    expect(a).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(stagedSourceRef(KEY, "b1", "acct-a")).toBe(a); // stable
    expect(a).not.toContain("acct-a"); // never a raw identifier
    expect(stagedSourceRef(KEY, "b1", "acct-b")).not.toBe(a);
    expect(stagedSourceRef(KEY, "b2", "acct-a")).not.toBe(a);
    expect(stagedSourceRef(`${KEY}x`, "b1", "acct-a")).not.toBe(a);
  });

  it("10 · RECONCILIATION DIVERGENCE is reported as its own reason, and never as a throw", () => {
    // Required regression. The check is deliberately evaluated BEFORE the identity gate so it stays live
    // rather than becoming dead code behind a permanent block — a divergence between the per-account
    // figures and the assessment total must keep being reported. Before EP-31c this THREW, which would
    // have aborted the whole schedule request for a candidate-side fault.
    const decision = deriveStagedAttributions(config, "b1", [cycle("c1", "acct-a", 50_000)], policy, aggregate(49_999));
    expect(decision.staged).toBe(false);
    expect(decision.reason).toBe("attribution_did_not_reconcile");
    expect(decision.attributions).toEqual([]);
    expect(decision.detail).toMatch(/do not sum to the assessment total \(expected 49999, got 50000\)/);
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
  const barFor = new Map<string, string>();

  async function admitted(boundaryId: string) {
    await ensureGovernedTerms(boundaryId);
    const policyId = `pol-${uid()}`;
    barFor.set(boundaryId, policyId);
    const policy = {
      policyId, policyVersion: "1.0.0",
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

  async function completeWorker(boundaryId: string) {
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
    return runtime.runNext(createPilotAssessmentAgent(), `w-${uid()}`, boundaryId);
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

  it("12 · CONTROL 1 · an ENROLLED boundary completes its assessment and stages NOTHING", async () => {
    // The control the whole slice exists for: enrolling a boundary must never turn missing leak-instance
    // identity into an assessment availability failure. The assessment is unaffected in every observable
    // respect; only the candidate path declines, with its reason named.
    const boundaryId = `ep31c-enrolled-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never, {
      signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY },
    });

    // Ordinary assessment: completely normal, and NO NH-AX refusal is fabricated for it.
    expect(result.scheduled).toBe(true);
    expect(result.refusal).toBeNull();
    expect(result.refusalDetail).toBeNull();
    expect(result.executionId).toBeTruthy();

    // The named identity-blocked outcome, on its OWN field.
    expect(result.candidateStaging).toEqual({
      staged: false,
      reason: "leak_instance_identity_unavailable",
      detail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
    });

    // Zero candidate-capable rows, and zero candidates.
    expect(await rowsFor(result.executionId!)).toEqual([]);
    const queue = await app.inject({
      method: "GET", url: `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, headers: OPERATOR,
    });
    expect(queue.json()).toEqual([]);

    // And the execution reaches COMPLETED with a finding, exactly as an unenrolled one does.
    expect((await completeWorker(boundaryId))?.status).toBe("succeeded");
    const view = (await app.inject({
      method: "GET",
      url: `/pilot/assessments/${result.executionId!}?boundaryId=${encodeURIComponent(boundaryId)}`,
      headers: OPERATOR,
    })).json();
    expect(view.state).toBe("completed");
    expect(view.finding.finding.acceptedCycleCount).toBeGreaterThan(0);
  });

  it("13 · CONTROL 3+5 · enrolment changes NOTHING about the finding, the projection or inputHash", async () => {
    // Two runs of the SAME bytes, one enrolled and one not. `inputHash` is computed over the projection
    // alone, so it is boundary-independent — which makes it the exact handle for "the projection did not
    // change". The finding's counts and all five money figures must match too.
    const plain = `ep31c-plain-${uid()}`;
    const enrolled = `ep31c-both-${uid()}`;
    const csvText = syntheticPilotCsv(40);

    const run = async (boundaryId: string, staging: boolean) => {
      const body = { ...(await admitted(boundaryId)), csvText };
      await app.inject({
        method: "POST", url: "/pilot/datasets", headers: OPERATOR,
        payload: { ...body, admissionPolicyId: barFor.get(boundaryId), admissionPolicyVersion: "1.0.0" } as object,
      });
      const scheduled = await schedulePilotAssessment(
        actor(boundaryId), body as never,
        staging ? { signalStaging: { boundaries: new Set([boundaryId]), sourceRefKey: KEY } } : {},
      );
      expect((await completeWorker(boundaryId))?.status).toBe("succeeded");
      const view = (await app.inject({
        method: "GET",
        url: `/pilot/assessments/${scheduled.executionId!}?boundaryId=${encodeURIComponent(boundaryId)}`,
        headers: OPERATOR,
      })).json();
      return { scheduled, view };
    };

    const off = await run(plain, false);
    const on = await run(enrolled, true);

    // CONTROL 5 · projection and inputHash identical.
    expect(on.view.inputHash).toBe(off.view.inputHash);
    // …and the finding itself, figure for figure.
    const figures = (f: Record<string, number>) => ({
      stalled: f.stalledCount, undetermined: f.undeterminedCount, reference: f.referenceCount,
      accepted: f.acceptedCycleCount, excludedCycles: f.excludedCycleCount,
      observedUnpaid: f.observedUnpaidMinor, partial: f.partialOutstandingMinor,
      excluded: f.excludedValueMinor, unknown: f.unknownValueMinor, gross: f.grossEligibleMinor,
    });
    expect(figures(on.view.finding.finding)).toEqual(figures(off.view.finding.finding));

    // CONTROL 3 · the unenrolled run behaves exactly as it always did.
    expect(off.scheduled.candidateStaging.reason).toBe("boundary_not_enrolled");
    expect(on.scheduled.candidateStaging.reason).toBe("leak_instance_identity_unavailable");
    // CONTROL 4 · no partial staging survives either decision.
    expect(await rowsFor(off.scheduled.executionId!)).toEqual([]);
    expect(await rowsFor(on.scheduled.executionId!)).toEqual([]);
  });

  it("14 · the table remains append-only, proved on a hand-inserted row", async () => {
    // Driven through the store rather than through staging, because staging is blocked. The table's
    // guarantees are independent of who wrote the row, and they are still worth pinning.
    const boundaryId = `ep31c-append-${uid()}`;
    const body = await admitted(boundaryId);
    const result = await schedulePilotAssessment(actor(boundaryId), body as never);
    await prisma.pilotAssessmentEntityAttributionRecord.create({
      data: {
        executionId: result.executionId!, boundaryId, sourceRef: `hmac-sha256:${"a".repeat(64)}`,
        amountAtRiskMinor: 4_242n, currency: "USD", contributingCycleCount: 1,
        attributionRule: "nh-entity-attribution-v1",
      },
    });
    await expect(prisma.$executeRawUnsafe(
      `UPDATE pilot_assessment_entity_attributions SET amount_at_risk_minor = 1 WHERE execution_id = $1`,
      result.executionId!,
    )).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM pilot_assessment_entity_attributions WHERE execution_id = $1`, result.executionId!,
    )).rejects.toThrow(/requires a recorded purge authorization/i);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE pilot_assessment_entity_attributions`))
      .rejects.toThrow(/append-only/i);
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

  /**
   * SUSPENDED COVERAGE, recorded rather than quietly dropped.
   *
   * Four end-to-end properties were proved at `95dc2bb` and are unreachable while staging is blocked,
   * because each needs a staged row to exist: the staged total reconciling with the finding the WORKER
   * wrote, idempotent re-staging, and (in the emitter suite) mid-batch atomicity and cross-export
   * pseudonym stability. They are not deleted from history — they are in the EP-31 commits — and they
   * become reachable again only when an authoritative leak-instance identity exists.
   *
   * Deliberately NOT preserved by adding an override that satisfies the identity gate: a seam capable of
   * turning the gate off is exactly what this slice exists to remove, and test coverage is not a reason
   * to build one.
   */
  it("SUSPENDED · end-to-end staged-row coverage awaits an authoritative leak-instance identity", () => {
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
  });
});
