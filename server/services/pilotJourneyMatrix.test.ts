// EP-19 · The risk matrix, end to end: real HTTP, the production worker, real PostgreSQL.
//
// The pure scenario test (src/contract/syntheticScenarios.test.ts) checks what the CONTRACT says about
// each dataset. This checks what the SYSTEM does with it: whether an unfit dataset can reach an
// execution, whether a rejected row can reach a stored input, and whether the point-in-time rules
// survive the trip through a queue and a worker into a recorded finding.
//
// WHAT IS NOT DUPLICATED HERE. Tenant isolation, unauthorized roles, repeated submission, concurrent
// claims, lease recovery, frozen policy, halted case and retention are each already proved against this
// same stack by `pilotAssessmentOrchestration.test.ts`, `pilotAssessmentWorker.test.ts` and
// `pilotInputRetention.test.ts`. Re-asserting them here would add lines, not confidence; the few cases
// below that touch them do so because the SCENARIO is what is new, not the protection.
//
// NOTHING HERE SUPPORTS AN INFERENCE about ROI, precision, recall, causality or recovered revenue.
// These datasets are shaped to exercise rules. A rule-exercising fixture says nothing about how any
// real dataset behaves, and every figure below is Revenue Opportunity — an observation, never money.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import {
  SCENARIO_POLICY,
  SYNTHETIC_PROVENANCE,
  syntheticScenario,
  syntheticScenarios,
} from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { AgentRuntime } from "../agents/runtime";
import { createPilotAssessmentAgent } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

/** The same as-of the scenario expectations were written against. */
// EP-26 · Currency only. The cut-off and the threshold are the governed definition this suite activates
// per boundary (asOf 2026-03-01, N 30) and cites by reference at the top level of the request, not here.
const ASSESSMENT = { currency: "USD" };

describe.skipIf(!HAS_DB)("EP-19 · the risk matrix through the real stack", () => {
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
   * A boundary with an ACTIVE bar, proposed and activated by two different identities.
   *
   * `thresholds` overrides let a case remove a threshold entirely, which is how the "missing
   * threshold" row of the matrix is exercised without inventing a value to stand in for it.
   */
  async function boundaryWithActivePolicy(thresholds: Record<string, unknown> = {}) {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    const policy = {
      policyId,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      ...SCENARIO_POLICY,
      requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
      ...thresholds,
    };
    const proposed = await app.inject({
      method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
      payload: { boundaryId, policy, rationale: "risk matrix fixture" },
    });
    if (proposed.statusCode !== 201) return { boundaryId, policyId, proposed, activated: null };
    const activated = await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate", headers: STEWARD,
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
    });
    expect(activated.statusCode).toBe(200);
    return { boundaryId, policyId, proposed, activated };
  }

  const datasetBody = (boundaryId: string, csvText: string) => ({
    boundaryId,
    datasetId: `ds-${uid()}`,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText,
    policy: ASSESSMENT,
    ...GOVERNED_TERMS_FIELDS,
    provenance: SYNTHETIC_PROVENANCE,
  });

  const submit = async (body: object, policyId: string) => {
    const boundaryId = (body as { boundaryId?: string }).boundaryId;
    if (boundaryId) await ensureGovernedTerms(boundaryId, { asOf: "2026-03-01" });
    return app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR,
      payload: { ...body, admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0" },
    });
  };

  const schedule = async (body: object) => {
    const boundaryId = (body as { boundaryId?: string }).boundaryId;
    // The matrix reads as of 2026-03-01, which is the definition this boundary gets.
    if (boundaryId) await ensureGovernedTerms(boundaryId, { asOf: "2026-03-01" });
    return app.inject({ method: "POST", url: "/pilot/assessments", headers: OPERATOR, payload: body });
  };

  const read = (boundaryId: string, executionId: string) =>
    app.inject({
      method: "GET",
      url: `/pilot/assessments/${executionId}?boundaryId=${boundaryId}`,
      headers: OPERATOR,
    });

  // ── Every scenario, through intake and (where admissible) through a worker ──────────────────────

  it.each(syntheticScenarios().map((s) => [s.id, s] as const))(
    "scenario %s reaches exactly the outcome its expectation states",
    async (_id, scenario) => {
      const { boundaryId, policyId } = await boundaryWithActivePolicy();
      const body = datasetBody(boundaryId, scenario.csvText);

      const submitted = (await submit(body, policyId)).json();
      expect(submitted.counts.dataRows, scenario.label).toBe(scenario.expected.dataRows);
      expect(submitted.counts.acceptedRows, scenario.label).toBe(scenario.expected.acceptedRows);
      expect(submitted.counts.rejectedRows, scenario.label).toBe(scenario.expected.rejectedRows);
      expect(submitted.usableForAssessment, scenario.label).toBe(scenario.expected.usableForAssessment);
      expect(submitted.admission.outcome, scenario.label).toBe(scenario.expected.admission);

      const scheduled = (await schedule(body)).json();
      if (scenario.expected.admission !== "ADMISSIBLE") {
        // AN UNFIT DATASET MUST NOT REACH AN EXECUTION. This is the load-bearing assertion of the
        // whole matrix: every other refusal is upstream of a number, and this one is the last.
        expect(scheduled.scheduled, scenario.label).toBe(false);
        expect(
          await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } }),
          scenario.label,
        ).toBe(0);

        // TWO DIFFERENT REFUSALS, and which one fires is itself worth pinning. The intake persists
        // ONLY a usable dataset, so an unusable file leaves no submission behind at all and the
        // scheduler finds nothing to execute (NH-AX-1001). A file that IS usable but was judged
        // unfit leaves a submission carrying a non-ADMISSIBLE decision, and the scheduler refuses
        // on that decision (NH-AX-1003). Collapsing the two would hide the distinction an operator
        // needs: 1001 says fix the rows, 1003 says the rows are fine and the dataset is not enough.
        expect(scheduled.refusal.code, scenario.label).toBe(
          scenario.expected.usableForAssessment ? "NH-AX-1003" : "NH-AX-1001",
        );
        return;
      }

      expect(scheduled.scheduled, scenario.label).toBe(true);
      expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");
      const view = (await read(boundaryId, scheduled.executionId)).json();
      expect(view.state, scenario.label).toBe("completed");
      expect(view.finding.finding.acceptedCycleCount, scenario.label).toBe(
        scenario.expected.acceptedRows,
      );
    },
  );

  // ── Rejected rows never reach the stored input, per scenario ────────────────────────────────────

  it("keeps every rejected row out of the execution input, not merely out of the finding", async () => {
    const scenario = syntheticScenario("timezone-less");
    const { boundaryId, policyId } = await boundaryWithActivePolicy();
    const body = datasetBody(boundaryId, scenario.csvText);
    expect((await submit(body, policyId)).json().admission.outcome).toBe("ADMISSIBLE");
    const scheduled = (await schedule(body)).json();

    const input = await prisma.pilotAssessmentExecutionInputRecord.findFirstOrThrow({
      where: { executionId: scheduled.executionId },
    });
    expect(input.cycleCount).toBe(scenario.expected.acceptedRows);
    // The rejected row's identifier exists nowhere in what was stored.
    expect(JSON.stringify(input.cycles)).not.toContain("synthetic-account-0901");
    expect(JSON.stringify(input.cycles)).not.toContain("synthetic-sub-0901");
  });

  // ── Point-in-time: a reversal after the cutoff is invisible at that cutoff ──────────────────────

  it("classifies refunds, cancellations and partial payments as of the cutoff, not after it", async () => {
    const scenario = syntheticScenario("partial-payments");
    const { boundaryId, policyId } = await boundaryWithActivePolicy();
    const body = datasetBody(boundaryId, scenario.csvText);
    expect((await submit(body, policyId)).json().admission.outcome).toBe("ADMISSIBLE");
    const scheduled = (await schedule(body)).json();
    expect((await runtime().runNext(agent, `w-${uid()}`, boundaryId))?.status).toBe("succeeded");

    const finding = (await read(boundaryId, scheduled.executionId)).json().finding.finding;
    const states: Record<string, number> = finding.stateCounts;

    // ONE refund and ONE cancellation are visible at 2026-03-01; the June refund and the July
    // cancellation are not, because a state cannot be read from information that did not exist yet.
    expect(states.Refunded ?? 0).toBe(1);
    expect(states.Cancelled ?? 0).toBe(1);
    // The partially paid obligation is its own state and is NOT in the unpaid headline.
    expect(states.PartiallyPaid ?? 0).toBe(1);
    expect(finding.partialOutstandingMinor).toBe(60_000); // 1000.00 owed − 400.00 settled, exact minor units

    // The row whose refund lands after the cutoff still reads as settled, not refunded.
    expect(finding.observedUnpaidMinor).toBeGreaterThan(0);
    expect(Number.isSafeInteger(finding.observedUnpaidMinor)).toBe(true);
  });

  // ── Missing thresholds: NOT_ASSESSABLE naming the field, never a substituted value ──────────────

  // A missing threshold is refused TWICE, by two independent layers, and both are asserted because
  // either one alone would be a single point of failure on the rule that matters most here: the
  // system has no default bar, so an unanswered fitness question can never become a passing answer.
  //
  //   transport (Fastify schema) — the field is `required`; omitting it never reaches the handler
  //   domain (`makeAdmissionPolicy`) — catches anything that satisfies the schema and is still
  //                                    not a configured threshold
  //
  // Asserting only the outer layer would let the inner guard be deleted silently, and vice versa.
  it.each(["minAcceptedRows", "maxRejectionRate", "minCoverageDays"])(
    "refuses at the transport to register a policy with %s omitted",
    async (field) => {
      const { proposed, policyId } = await boundaryWithActivePolicy({ [field]: undefined });
      expect(proposed.statusCode).toBe(400);
      // The prose message is deliberately generic so the API never echoes a caller's payload back;
      // the field that is missing belongs in the structured details, and it must actually be there
      // or the operator is told only that something, somewhere, was wrong.
      const body = proposed.json();
      expect(body.error).toBe("invalid_request");
      expect(JSON.stringify(body.details)).toMatch(new RegExp(field));
      // And no policy was stored under that id, so nothing can later be activated by mistake.
      expect(await prisma.pilotAdmissionPolicyRecord.count({ where: { policyId } })).toBe(0);
    },
  );

  it("refuses in the domain when a threshold satisfies the schema but configures nothing", async () => {
    // A single space is a string of length 1, so the transport lets it through; the domain guard is
    // what stops it. This is the exact shape the inner layer exists for.
    const { proposed } = await boundaryWithActivePolicy({ calculationMethodVersion: " " });
    expect(proposed.statusCode).toBe(403);
    expect(proposed.json().message).toMatch(/every threshold must be configured explicitly/);
    // The refusal must not echo the caller's input back — the message is deliberately generic.
    expect(proposed.json().message).not.toMatch(/calculationMethodVersion/);
  });

  it("answers NOT_ASSESSABLE when no policy is named at all", async () => {
    const { boundaryId } = await boundaryWithActivePolicy();
    const body = datasetBody(boundaryId, syntheticScenario("valid").csvText);
    // Governed terms ARE active here: the NOT_ASSESSABLE below must come from the missing admission
    // policy, not from the analysis-terms gate.
    await ensureGovernedTerms(boundaryId, { asOf: "2026-03-01" });
    const submitted = (await app.inject({
      method: "POST", url: "/pilot/datasets", headers: OPERATOR, payload: body,
    })).json();
    expect(submitted.admission.outcome).toBe("NOT_ASSESSABLE");
    // And the dataset cannot then be executed on the strength of having been "accepted".
    expect((await schedule(body)).json().scheduled).toBe(false);
  });

  // ── Rejection concentration ─────────────────────────────────────────────────────────────────────

  it("refuses a dataset whose rejections all come from one reason, when the bar says so", async () => {
    // The scenario policy is deliberately loose on single-reason share; this case tightens exactly
    // that one threshold, so the refusal can only be attributed to concentration.
    const { boundaryId, policyId } = await boundaryWithActivePolicy({
      maxSingleReasonShare: 0.5,
      maxRejectionRate: 0.9,
    });
    const body = datasetBody(boundaryId, syntheticScenario("one-valid-row").csvText);
    const submitted = (await submit(body, policyId)).json();
    expect(submitted.admission.outcome).toBe("NOT_ADMISSIBLE");
    expect(submitted.admission.rates.largestSingleReasonShare).toBe(1);
    const concentration = submitted.admission.reasons.map((r: { code: string }) => r.code);
    expect(concentration.length).toBeGreaterThan(0);
  });

  // ── A frozen bar stops a dataset that was admitted under it ─────────────────────────────────────

  it("refuses a new execution once governance freezes the bar the dataset was admitted under", async () => {
    const { boundaryId, policyId } = await boundaryWithActivePolicy();
    const body = datasetBody(boundaryId, syntheticScenario("valid").csvText);
    expect((await submit(body, policyId)).json().admission.outcome).toBe("ADMISSIBLE");

    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies/freeze", headers: STEWARD,
        payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "paused" },
      })).statusCode,
    ).toBe(200);

    const scheduled = (await schedule(body)).json();
    expect(scheduled.scheduled).toBe(false);
    expect(scheduled.refusal.code).toBe("NH-AX-1007");
    expect(scheduled.admissionPolicyState).toBe("FROZEN");
  });

  // ── The governance split, at the level the UI depends on ────────────────────────────────────────

  it("refuses an activation by the identity that proposed the bar", async () => {
    const boundaryId = `pb-${uid()}`;
    const policyId = `pol-${uid()}`;
    const policy = {
      policyId, policyVersion: "1.0.0", calculationMethodVersion: ADMISSION_CALC_VERSION,
      ...SCENARIO_POLICY, requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
    };
    expect(
      (await app.inject({
        method: "POST", url: "/pilot/admission-policies", headers: OPERATOR,
        payload: { boundaryId, policy, rationale: "proposed" },
      })).statusCode,
    ).toBe(201);

    // Same actorId, steward role. The role alone is not the control — identity is checked too, which
    // is exactly why the UI puts proposing and activating on different screens under different actors.
    const selfActivated = await app.inject({
      method: "POST", url: "/pilot/admission-policies/activate",
      headers: { "x-actor-id": OPERATOR["x-actor-id"], "x-actor-role": "steward" },
      payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "self" },
    });
    expect(selfActivated.statusCode).toBe(403);
    expect(selfActivated.json().message).toMatch(/cannot be the one who puts it in force/);
  });
});
