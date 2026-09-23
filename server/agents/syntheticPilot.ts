/**
 * Disposable, synthetic-only end-to-end pilot.
 *
 * This is an executable verification harness, not a revenue claim. It deliberately uses the
 * production worker, PostgreSQL stores, governed review/promotion routes and proof kernel while
 * refusing to run against a database that is not clearly named as disposable.
 */
import { createHash, createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { prisma } from "../db";
import { SourceVerifier, sourceSigningPayload, type EvidenceClaim } from "../services/sourceVerification";
import { ACTIVATION_AGENT_ID, configuredAgentHandlers } from "./activationDetector";
import { createAgentProcessFromEnvironment, type AgentProcess } from "./bootstrap";
import { CandidatePromotionService } from "./recoveryCase";
import { CandidateReviewService } from "./candidateReview";
import { PostgresCandidateReviewStore } from "./postgresCandidateReviewStore";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";

const PILOT_SCHEMA_VERSION = "nh-synthetic-pilot-v1";
const OPERATOR = Object.freeze({
  actorId: "SYNTHETIC-pilot-operator",
  role: "operator" as const,
  boundaryIds: Object.freeze(["*"]),
});
const AUTHOR = Object.freeze({ "x-actor-id": "SYNTHETIC-pilot-author", "x-actor-role": "author" });
const APPROVER = Object.freeze({ "x-actor-id": "SYNTHETIC-pilot-approver", "x-actor-role": "approver" });
const STEWARD = Object.freeze({ "x-actor-id": "SYNTHETIC-pilot-steward", "x-actor-role": "steward" });

export interface SyntheticPilotReport {
  readonly schemaVersion: typeof PILOT_SCHEMA_VERSION;
  readonly syntheticOnly: true;
  readonly containsRealCustomerData: false;
  readonly claimsRealRevenue: false;
  readonly runId: string;
  readonly boundaryId: string;
  readonly agent: {
    readonly agentId: typeof ACTIVATION_AGENT_ID;
    readonly taskId: string;
    readonly taskStatus: "succeeded";
    readonly candidateCount: 1;
  };
  readonly governedCase: {
    readonly candidateId: string;
    readonly recoveryCaseId: string;
    readonly humanReview: "accepted";
    readonly promotionReplayStable: true;
  };
  readonly syntheticAmounts: {
    readonly currency: "USD";
    readonly opportunityMinor: 10_000;
    readonly collectedMinor: 7_000;
    readonly baselineMinor: 2_000;
    readonly revenueReturnedMinor: 5_000;
    readonly auditableRevenueMinor: 5_000;
  };
  readonly proof: {
    readonly proofId: string;
    readonly evidenceId: string;
    readonly sourceVerificationMethod: "ed25519-v1";
    readonly sourceKeyId: "SYNTHETIC-pilot-billing";
  };
  readonly controlsVerified: readonly string[];
}

export function assertSyntheticPilotEnvironment(env: Readonly<Record<string, string | undefined>>): URL {
  if (env.NH_SYNTHETIC_PILOT !== "true") {
    throw new Error("NH_SYNTHETIC_PILOT=true is required; this command is synthetic-only");
  }
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  const database = new URL(env.DATABASE_URL);
  if (!/^postgres(ql)?:$/.test(database.protocol)) throw new Error("the synthetic pilot requires PostgreSQL");
  const name = database.pathname.replace(/^\//, "").toLowerCase();
  if (!/(^|[_-])(test|synthetic|pilot)([_-]|$)/.test(name)) {
    throw new Error("refusing to run: the database name must contain test, synthetic or pilot as a distinct token");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "db", "postgres"]);
  if (!localHosts.has(database.hostname)) {
    throw new Error("refusing to run: the synthetic pilot only accepts a local or disposable service host");
  }
  return database;
}

export async function runSyntheticPilot(
  env: Readonly<Record<string, string | undefined>>,
): Promise<SyntheticPilotReport> {
  assertSyntheticPilotEnvironment(env);
  const runId = randomUUID();
  const boundaryId = `SYNTHETIC-pilot-${runId}`;
  const taskId = `SYNTHETIC-task-${randomUUID()}`;
  const pilotEnv = Object.freeze({
    ...env,
    NH_AGENTS_ENABLED: "true",
    NH_ACTIVATION_DETECTOR_ENABLED: "true",
    NH_AGENT_BOUNDARIES: boundaryId,
    NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:10000",
    NH_AGENT_IDLE_DELAY_MS: "10",
  });
  const source = syntheticSourceVerifier();
  const app = buildApp({ sourceVerifier: source.verifier });
  const agents = createAgentProcessFromEnvironment(pilotEnv, configuredAgentHandlers(pilotEnv));

  try {
    const now = Date.now();
    const payload = Object.freeze({
      sourceRef: `hmac-sha256:${createHmac("sha256", randomUUID()).update(`SYNTHETIC-account-${runId}`).digest("hex")}`,
      signedAt: new Date(now - 14 * 86_400_000).toISOString(),
      activationDueAt: new Date(now - 7 * 86_400_000).toISOString(),
      activatedAt: null,
      observedAt: new Date(now - 60_000).toISOString(),
      amountAtRiskMinor: 10_000,
      currency: "USD",
      actionAvailable: true,
    });
    const queued = await createPostgresAgentTaskStore().enqueueIfAbsent({
      taskId,
      boundaryId,
      agentId: ACTIVATION_AGENT_ID,
      idempotencyKey: `SYNTHETIC-${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      payload,
      now,
    });
    if (!queued.created) throw new Error("synthetic pilot task unexpectedly collided with an existing task");

    agents.start();
    await waitForCandidate(boundaryId, agents);
    await agents.stop();

    const reviews = new PostgresCandidateReviewStore();
    const reviewService = new CandidateReviewService(reviews);
    const promotionService = new CandidatePromotionService(reviews);
    const queue = await reviewService.list(OPERATOR, boundaryId);
    if (queue.length !== 1) throw new Error(`expected one synthetic candidate, found ${queue.length}`);
    const candidateId = queue[0]!.candidateId;
    await reviewService.decide(OPERATOR, {
      candidateId,
      boundaryId,
      decision: "accepted",
      reason: "SYNTHETIC pilot governed review",
    });
    const promoted = await promotionService.promote(OPERATOR, candidateId, boundaryId);
    if (!promoted.created) throw new Error("synthetic pilot candidate was not newly promoted");
    const replay = await promotionService.promote(OPERATOR, candidateId, boundaryId);
    if (replay.created || replay.recoveryCase.recoveryCaseId !== promoted.recoveryCase.recoveryCaseId) {
      throw new Error("candidate promotion replay was not stable");
    }
    const recoveryCaseId = promoted.recoveryCase.recoveryCaseId;
    const proof = await completeGovernedProof(app, source, recoveryCaseId);
    const task = await prisma.agentTaskRecord.findUniqueOrThrow({ where: { taskId } });
    if (task.status !== "succeeded") throw new Error(`synthetic task ended in unexpected status '${task.status}'`);

    return Object.freeze({
      schemaVersion: PILOT_SCHEMA_VERSION,
      syntheticOnly: true,
      containsRealCustomerData: false,
      claimsRealRevenue: false,
      runId,
      boundaryId,
      agent: Object.freeze({ agentId: ACTIVATION_AGENT_ID, taskId, taskStatus: "succeeded", candidateCount: 1 }),
      governedCase: Object.freeze({ candidateId, recoveryCaseId, humanReview: "accepted", promotionReplayStable: true }),
      syntheticAmounts: Object.freeze({
        currency: "USD",
        opportunityMinor: 10_000,
        collectedMinor: 7_000,
        baselineMinor: 2_000,
        revenueReturnedMinor: proof.revenueReturnedMinor,
        auditableRevenueMinor: proof.auditableRevenueMinor,
      }),
      proof: Object.freeze({
        proofId: proof.proofId,
        evidenceId: proof.evidenceId,
        sourceVerificationMethod: "ed25519-v1",
        sourceKeyId: source.keyId,
      }),
      controlsVerified: Object.freeze([
        "production_worker_executed",
        "pseudonymous_source_reference",
        "economic_admission_threshold",
        "human_review_before_promotion",
        "idempotent_candidate_promotion",
        "baseline_locked_before_outcome",
        "separate_author_and_approver",
        "ephemeral_ed25519_source_attestation",
        "opportunity_not_counted_as_revenue",
        "cfo_audit_export_reconciled",
      ]),
    });
  } finally {
    await agents.stop();
    await app.close();
  }
}

function syntheticSourceVerifier(): {
  readonly verifier: SourceVerifier;
  readonly keyId: "SYNTHETIC-pilot-billing";
  attest(caseId: string, claim: EvidenceClaim): EvidenceClaim & {
    readonly sourceAttestation: { readonly keyId: string; readonly issuedAt: string; readonly signature: string };
  };
} {
  const keys = generateKeyPairSync("ed25519");
  const keyId = "SYNTHETIC-pilot-billing" as const;
  const verifier = new SourceVerifier([{
    keyId,
    sourceSystem: "billing",
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }]);
  return Object.freeze({
    verifier,
    keyId,
    attest(caseId: string, claim: EvidenceClaim) {
      const issuedAt = new Date().toISOString();
      return Object.freeze({
        ...claim,
        sourceAttestation: Object.freeze({
          keyId,
          issuedAt,
          signature: sign(null, sourceSigningPayload(caseId, claim, issuedAt), keys.privateKey).toString("base64"),
        }),
      });
    },
  });
}

async function waitForCandidate(boundaryId: string, agents: AgentProcess): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } }) === 1) return;
    if (agents.readiness().status === "down") throw new Error("synthetic agent worker stopped before producing a candidate");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("synthetic agent did not create a candidate within 5 seconds");
}

async function completeGovernedProof(
  app: FastifyInstance,
  source: ReturnType<typeof syntheticSourceVerifier>,
  recoveryCaseId: string,
): Promise<{ proofId: string; evidenceId: string; revenueReturnedMinor: 5_000; auditableRevenueMinor: 5_000 }> {
  await expectStatus(app, "POST", `/cases/${recoveryCaseId}/author`, AUTHOR, undefined, 201);
  const baselineId = `SYNTHETIC-baseline-${randomUUID()}`;
  await expectStatus(app, "POST", `/cases/${recoveryCaseId}/baseline`, AUTHOR, {
    baselineId,
    calculatedMinor: 2_000,
    currency: "USD",
    method: "synthetic_matched_historical_cohort",
    methodVersion: 1,
    sourceRefs: ["SYNTHETIC-baseline-source"],
    effectiveAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  }, 201);
  await expectStatus(app, "POST", `/cases/${recoveryCaseId}/intervention`, AUTHOR, undefined, 201);

  const evidenceId = `SYNTHETIC-evidence-${randomUUID()}`;
  const claim: EvidenceClaim = {
    evidenceId,
    sourceSystem: "billing",
    sourceRecordId: `SYNTHETIC-invoice-${randomUUID()}`,
    evidenceType: "invoice_paid",
    observedAt: new Date().toISOString(),
    amountMinor: 7_000,
    currency: "USD",
  };
  const evidence = await expectStatus(
    app,
    "POST",
    `/cases/${recoveryCaseId}/evidence`,
    AUTHOR,
    source.attest(recoveryCaseId, claim),
    201,
  );
  if (evidence.sourceVerification?.method !== "ed25519-v1") {
    throw new Error("synthetic evidence did not retain its verified source receipt");
  }

  const proofId = `SYNTHETIC-proof-${randomUUID()}`;
  const approved = await expectStatus(app, "POST", "/proofs", APPROVER, {
    proofId,
    recoveryCaseId,
    currency: "USD",
    collectedMinor: 7_000,
    excludedRecoveryMinor: 0,
    exclusionStatement: "synthetic pilot; no exclusions asserted",
    recoveryReason: "UsageActivation",
    attribution: "SYNTHETIC-pilot",
    evidenceIds: [evidenceId],
    baselineId,
    confidenceUsed: 95,
  }, 201);
  if (approved.revenueReturned?.minor !== 5_000) throw new Error("synthetic proof returned an unexpected amount");

  const exported = await expectStatus(
    app,
    "GET",
    `/audit/cases/${recoveryCaseId}/cfo-export`,
    STEWARD,
    undefined,
    200,
  );
  if (exported.provenRevenueReturnedMinor !== 5_000 || exported.auditableRevenueMinor !== 5_000) {
    throw new Error("synthetic CFO export did not reconcile to the governed proof");
  }
  return { proofId, evidenceId, revenueReturnedMinor: 5_000, auditableRevenueMinor: 5_000 };
}

async function expectStatus(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  headers: Readonly<Record<string, string>>,
  payload: object | undefined,
  expected: number,
): Promise<Record<string, any>> {
  const response = await app.inject({ method, url, headers, payload });
  if (response.statusCode !== expected) {
    throw new Error(`${method} ${url} failed: expected ${expected}, received ${response.statusCode}: ${response.body}`);
  }
  return response.json() as Record<string, unknown>;
}
