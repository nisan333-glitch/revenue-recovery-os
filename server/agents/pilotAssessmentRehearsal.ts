/**
 * EP-16 · Disposable, synthetic-only end-to-end pilot assessment rehearsal.
 *
 * An executable verification harness, not a revenue claim. It deliberately uses the REAL pieces —
 * a real listening HTTP server reached over a real socket with `fetch`, the production Fastify app,
 * the production agent worker loop, the production PostgreSQL stores, and the governed policy,
 * intake and orchestration routes — while refusing to run against a database that is not clearly
 * named as disposable.
 *
 * WHY A REHEARSAL AND NOT JUST TESTS. The integration tests reach the app through `inject()`, which
 * exercises routing, schemas and hooks but never a socket, and they drive the runtime one turn at a
 * time. This runs the whole thing the way a pilot would: a real port, real HTTP, and a real
 * `AgentWorker` polling on its own until the execution completes. If the wiring only works when a
 * test drives it by hand, that is worth finding here rather than in front of a customer.
 *
 * EVERY VALUE IS SYNTHETIC. The dataset comes from the contract's deterministic generator, whose
 * identifiers carry a literal "synthetic-" prefix; there is no real customer behind any of it, and
 * nothing it computes is Revenue Returned, Auditable Revenue, or any financial claim.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { AgentWorker } from "./worker";
import { AgentRuntime } from "./runtime";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import { createPilotAssessmentAgent, PILOT_ASSESSMENT_AGENT_ID } from "./pilotAssessmentAgent";
import { assertSyntheticPilotEnvironment } from "./syntheticPilot";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import type { ExecutionState } from "../../src/contract/assessmentExecution";

const REHEARSAL_SCHEMA_VERSION = "nh-pilot-assessment-rehearsal-v1";

/**
 * Three DIFFERENT actors, because the governance split is part of what is being rehearsed. The
 * operator proposes the bar and submits the data; only the steward may put the bar in force; and
 * the fact that neither can do the other's half is the point, not an inconvenience to work around.
 */
const OPERATOR = Object.freeze({ "x-actor-id": "SYNTHETIC-rehearsal-operator", "x-actor-role": "operator" });
const STEWARD = Object.freeze({ "x-actor-id": "SYNTHETIC-rehearsal-steward", "x-actor-role": "steward" });

export interface PilotAssessmentRehearsalReport {
  readonly schemaVersion: typeof REHEARSAL_SCHEMA_VERSION;
  readonly syntheticOnly: true;
  readonly containsRealCustomerData: false;
  readonly claimsRealRevenue: false;
  readonly runId: string;
  readonly boundaryId: string;
  readonly transport: "http";
  readonly origin: string;
  readonly policy: {
    readonly policyRef: string;
    readonly proposedBy: string;
    readonly activatedBy: string;
    readonly state: "ACTIVE";
  };
  readonly dataset: {
    readonly datasetFingerprint: string;
    readonly admissionOutcome: "ADMISSIBLE";
    readonly acceptedRows: number;
    readonly rejectedRows: number;
  };
  readonly execution: {
    readonly executionId: string;
    readonly agentId: typeof PILOT_ASSESSMENT_AGENT_ID;
    readonly state: ExecutionState;
    readonly transitions: readonly string[];
    readonly ranOnRealWorker: true;
  };
  readonly observation: {
    readonly assessmentId: string;
    readonly acceptedCycleCount: number;
    readonly stalledCount: number;
    readonly currency: string;
    /** Revenue OPPORTUNITY. A forecast-side observation — never counted, never returned. */
    readonly observedUnpaidMinor: number;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
  readonly governedObjectsCreated: {
    readonly proofs: 0;
    readonly recoveryCases: 0;
    readonly authorityEvents: 0;
    readonly caseCandidates: 0;
  };
  readonly controlsVerified: readonly string[];
}

/** One JSON call over a real socket. Non-2xx is surfaced with its body, never swallowed. */
async function call<T>(
  origin: string,
  method: "GET" | "POST",
  path: string,
  headers: Readonly<Record<string, string>>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 512)}`);
  }
  return JSON.parse(text) as T;
}

export async function runPilotAssessmentRehearsal(
  env: Readonly<Record<string, string | undefined>>,
): Promise<PilotAssessmentRehearsalReport> {
  assertSyntheticPilotEnvironment(env);
  const runId = randomUUID();
  const boundaryId = `SYNTHETIC-assessment-${runId}`;
  const policyId = `SYNTHETIC-pol-${runId.slice(0, 8)}`;

  const app: FastifyInstance = buildApp();
  // Port 0 asks the OS for a free port, so a rehearsal never collides with a running dev server.
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("the rehearsal server did not bind a port");
  const origin = `http://127.0.0.1:${address.port}`;

  // The production worker loop, polling on its own — not a test driving one turn at a time.
  const worker = new AgentWorker({
    runtime: new AgentRuntime({
      store: createPostgresAgentTaskStore(),
      policy: {
        current: () => ({
          globalEnabled: true,
          disabledAgents: new Set<string>(),
          maxAttempts: 3,
          leaseMs: 30_000,
          retryDelayMs: () => 25,
        }),
      },
      audit: { append: async () => {} },
      now: Date.now,
    }),
    handler: createPilotAssessmentAgent(),
    workerId: `SYNTHETIC-worker-${runId}`,
    boundaryId,
    idleDelayMs: 25,
    errorDelayMs: () => 50,
  });

  try {
    // 1 · The customer side PROPOSES a fitness bar. It is a DRAFT and can judge nothing.
    const proposed = await call<{ policyRef: string; state: string }>(
      origin, "POST", "/api/pilot/admission-policies", OPERATOR,
      {
        boundaryId,
        rationale: "synthetic rehearsal — thresholds are invented, not benchmarks",
        policy: {
          policyId,
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
        },
      },
    );
    if (proposed.state !== "DRAFT") throw new Error("a proposed policy must start as a DRAFT");

    // 2 · GOVERNANCE — a different actor, holding a different role — puts it in force.
    const activated = await call<{ state: string }>(
      origin, "POST", "/api/pilot/admission-policies/activate", STEWARD,
      { boundaryId, policyId, policyVersion: "1.0.0", rationale: "synthetic rehearsal activation" },
    );
    if (activated.state !== "ACTIVE") throw new Error("activation did not put the policy in force");

    // 3 · Submit the synthetic dataset and have it judged against that bar.
    const datasetRequest = {
      boundaryId,
      datasetId: `SYNTHETIC-ds-${runId.slice(0, 8)}`,
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText: syntheticPilotCsv(40),
      policy: { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" },
      provenance: SYNTHETIC_PROVENANCE,
    };
    const submitted = await call<{
      admission: { outcome: string };
      datasetFingerprint: string;
      counts: { acceptedRows: number; rejectedRows: number };
    }>(origin, "POST", "/api/pilot/datasets", OPERATOR, {
      ...datasetRequest,
      admissionPolicyId: policyId,
      admissionPolicyVersion: "1.0.0",
    });
    if (submitted.admission.outcome !== "ADMISSIBLE") {
      throw new Error(`the synthetic dataset was not admitted: ${submitted.admission.outcome}`);
    }

    // 4 · Schedule the governed execution. Note what is NOT sent: no policy id, no thresholds, no
    // outcome. The bar comes from the decision that admitted the data.
    const scheduledRun = await call<{ scheduled: boolean; executionId: string; state: string }>(
      origin, "POST", "/api/pilot/assessments", OPERATOR, datasetRequest,
    );
    if (!scheduledRun.scheduled) throw new Error("the rehearsal execution was refused");

    // 5 · Start the real worker and wait for it to reach a terminal state on its own.
    worker.start();
    const view = await waitForTerminalState(origin, boundaryId, scheduledRun.executionId);
    if (view.state !== "completed") {
      throw new Error(`the rehearsal execution ended as ${view.state} (${view.code ?? "no code"})`);
    }
    if (view.finding === null) throw new Error("a completed execution produced no observation");

    // 6 · Prove, against the database, that nothing governed was created along the way.
    const [proofs, recoveryCases, authorityEvents, caseCandidates] = await Promise.all([
      prisma.proof.count({ where: { recoveryCaseId: { startsWith: boundaryId } } }),
      prisma.recoveryCaseRecord.count({ where: { boundaryId } }),
      prisma.authorityEvent.count({ where: { recoveryCaseId: { startsWith: boundaryId } } }),
      prisma.agentCaseCandidateRecord.count({ where: { boundaryId } }),
    ]);
    if (proofs + recoveryCases + authorityEvents + caseCandidates !== 0) {
      throw new Error("an assessment execution created a governed object; it must create none");
    }

    const finding = view.finding.finding;
    return Object.freeze({
      schemaVersion: REHEARSAL_SCHEMA_VERSION,
      syntheticOnly: true as const,
      containsRealCustomerData: false as const,
      claimsRealRevenue: false as const,
      runId,
      boundaryId,
      transport: "http" as const,
      origin,
      policy: Object.freeze({
        policyRef: proposed.policyRef,
        proposedBy: OPERATOR["x-actor-id"],
        activatedBy: STEWARD["x-actor-id"],
        state: "ACTIVE" as const,
      }),
      dataset: Object.freeze({
        datasetFingerprint: submitted.datasetFingerprint,
        admissionOutcome: "ADMISSIBLE" as const,
        acceptedRows: submitted.counts.acceptedRows,
        rejectedRows: submitted.counts.rejectedRows,
      }),
      execution: Object.freeze({
        executionId: scheduledRun.executionId,
        agentId: PILOT_ASSESSMENT_AGENT_ID,
        state: view.state,
        transitions: Object.freeze(view.events.map((e) => e.transition)),
        ranOnRealWorker: true as const,
      }),
      observation: Object.freeze({
        assessmentId: finding.assessmentId,
        acceptedCycleCount: finding.acceptedCycleCount,
        stalledCount: finding.stalledCount,
        currency: finding.currency,
        observedUnpaidMinor: finding.observedUnpaidMinor,
        constitutesProof: false as const,
        constitutesRevenue: false as const,
      }),
      governedObjectsCreated: Object.freeze({
        proofs: 0 as const,
        recoveryCases: 0 as const,
        authorityEvents: 0 as const,
        caseCandidates: 0 as const,
      }),
      controlsVerified: Object.freeze([
        "real_http_transport",
        "production_worker_loop_executed",
        "policy_proposed_and_activated_by_different_actors",
        "execution_bound_to_immutable_admission_decision",
        "rejected_rows_never_entered_the_execution",
        "observation_is_not_proof_or_revenue",
        "no_governed_object_created",
      ]),
    });
  } finally {
    await worker.stop();
    await app.close();
  }
}

interface ExecutionView {
  readonly state: ExecutionState;
  readonly code: string | null;
  readonly events: readonly { readonly transition: string }[];
  readonly finding: {
    readonly finding: {
      readonly assessmentId: string;
      readonly acceptedCycleCount: number;
      readonly stalledCount: number;
      readonly currency: string;
      readonly observedUnpaidMinor: number;
    };
  } | null;
}

/**
 * Poll until the execution reaches a terminal state. Bounded, and a timeout is a FAILURE rather
 * than a report of whatever state it happened to be in — "still queued after ten seconds" is not a
 * successful rehearsal, and reporting it as one would be the exact failure this harness exists to
 * catch.
 */
async function waitForTerminalState(
  origin: string,
  boundaryId: string,
  executionId: string,
  timeoutMs = 15_000,
): Promise<ExecutionView> {
  const deadline = Date.now() + timeoutMs;
  let last: ExecutionView | null = null;
  while (Date.now() < deadline) {
    last = await call<ExecutionView>(
      origin,
      "GET",
      `/api/pilot/assessments/${executionId}?boundaryId=${encodeURIComponent(boundaryId)}`,
      OPERATOR,
    );
    if (last.state === "completed" || last.state === "blocked") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the rehearsal execution did not reach a terminal state within ${timeoutMs}ms (last: ${last?.state ?? "unknown"})`,
  );
}
