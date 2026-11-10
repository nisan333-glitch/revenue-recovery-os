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

// BUMPED to v2 on 2026-11-10. The report shape materially changed: this pilot's case is an
// ActivationMissed leak, no mechanism can prove one, and the proof leg is therefore a REFUSAL rather
// than a frozen figure. A consumer reading a v1 report expects `revenueReturnedMinor: 5_000`; a v2
// report says NOT COMPUTED and names why. Leaving the version alone would have let the two be confused.
const PILOT_SCHEMA_VERSION = "nh-synthetic-pilot-v2";
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
    /**
     * `null` MEANS NOT COMPUTED, and the literal type FORBIDS a number. This pilot cannot produce a
     * proven figure: its case is an ActivationMissed leak and no mechanism can prove one. A `0` here
     * would assert that a proof was found and summed to nothing — a different and false claim.
     */
    readonly revenueReturnedMinor: null;
    readonly auditableRevenueMinor: null;
  };
  /**
   * WHY NO PROOF EXISTS, named rather than left as an absence.
   *
   * The pilot still exercises the whole governed chain — worker, candidate, human review, promotion,
   * author, locked baseline, the source's executed-correction attestation and signed outcome evidence.
   * The last step is refused, and that refusal IS the demonstration: the loop reaches the ledger's door
   * and the door holds for a mechanism whose recovery nothing can attest.
   */
  readonly proofRefused: {
    readonly httpStatus: 403;
    readonly reasonClaimed: "UsageActivation";
    readonly code: "CORRECTION_CHANNEL_NOT_DECLARED";
    readonly evidenceId: string;
    readonly correctionEvidenceRole: "correction";
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
      // THE OBLIGATION THIS SYNTHETIC OBSERVATION CONCERNS, stated by the harness because the harness IS
      // the source here — this data is ours and nothing about a customer is being asserted. Without it
      // the claim would be account-level and the approved rule would refuse PROVEN, which is the correct
      // answer for an account-level claim and would make this pilot unable to demonstrate the loop.
      obligationRef: `hmac-sha256:${createHmac("sha256", randomUUID())
        .update(`SYNTHETIC-obligation-${runId}`).digest("hex")}`,
      expectedMinor: 10_000,
      billedMinor: 0,
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
        // NOT COMPUTED, never 0. There is no proof to sum.
        revenueReturnedMinor: null,
        auditableRevenueMinor: null,
      }),
      proofRefused: Object.freeze({
        httpStatus: 403,
        reasonClaimed: "UsageActivation",
        code: "CORRECTION_CHANNEL_NOT_DECLARED",
        evidenceId: proof.evidenceId,
        correctionEvidenceRole: "correction",
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
        // The CFO export is still read, and what it reconciles to is NOT COMPUTED rather than a figure.
        "cfo_audit_export_reports_not_computed",
        // The control this pilot now demonstrates, and the reason it is worth running: an unprovable
        // mechanism is refused at the ledger's door with every earlier leg of the loop satisfied.
        "unprovable_mechanism_refused_at_approval",
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
): Promise<{ evidenceId: string }> {
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
  // G1 · the Fix leg, evidenced. The intervention event above is the operator's governed timing record;
  // this is the SOURCE's attestation that the corrective charge was actually raised, which `approve()`
  // now requires. It is ingested before the settlement so the correction demonstrably precedes the money.
  const correctionClaim: EvidenceClaim = {
    evidenceId: `SYNTHETIC-correction-${randomUUID()}`,
    sourceSystem: "billing",
    sourceRecordId: `SYNTHETIC-corrective-${randomUUID()}`,
    // Derives role `correction` via the server's own allowlist; a caller cannot assert a role.
    //
    // REPORTED, NOT SOLVED: this case's reason is `UsageActivation`, and G1 does NOT yet require the
    // correction type to match the mechanism the reason names — so a billing-correction record currently
    // substantiates an activation recovery. That mapping is a governance decision (which source attests
    // to an activation?) and is proposed rather than invented here.
    evidenceType: "billing_corrected",
    observedAt: new Date().toISOString(),
  };
  const correction = await expectStatus(
    app,
    "POST",
    `/cases/${recoveryCaseId}/evidence`,
    AUTHOR,
    source.attest(recoveryCaseId, correctionClaim),
    201,
  );
  if (correction.evidenceRole !== "correction") {
    throw new Error(`synthetic correction evidence was classified '${correction.evidenceRole}', not 'correction'`);
  }

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

  // ── THE LEDGER'S DOOR, AND IT HOLDS ──────────────────────────────────────────────────────────────
  //
  // Every leg before this one succeeded: the production worker ran, a candidate was admitted on an
  // economic threshold, a human accepted it, promotion was idempotent, the baseline was locked before the
  // outcome, the source attested that the corrective charge was RAISED, and the source attested that the
  // money ARRIVED — signed Ed25519, with the private half never reaching this process.
  //
  // AND THE APPROVAL IS REFUSED, which is what this pilot now demonstrates. The case is an
  // ActivationMissed leak and `UsageActivation` is the CORRECT reason for it by the declared scope — but
  // no source system attests that an activation was performed. The correction record above is the billing
  // system's statement about BILLING; it attests nothing about an activation, and a proof is immutable,
  // so accepting it would freeze a disagreement that could never afterwards be corrected.
  //
  // UNTIL 2026-11-10 THIS PILOT MINTED $50.00 HERE, and the comment above the correction record had
  // already flagged it as "REPORTED, NOT SOLVED". The gate is not softened to let the demonstration
  // through: the demonstration is corrected to match the rule.
  const refused = await app.inject({
    method: "POST",
    url: "/proofs",
    headers: APPROVER,
    payload: {
      proofId: `SYNTHETIC-proof-${randomUUID()}`,
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
    },
  });
  if (refused.statusCode !== 403) {
    throw new Error(
      `synthetic pilot expected the approval to be REFUSED 403, received ${refused.statusCode}: ${refused.body}`,
    );
  }
  if (!refused.body.includes("CORRECTION_CHANNEL_NOT_DECLARED")) {
    throw new Error(`synthetic pilot refusal did not name the channel gap: ${refused.body}`);
  }

  // AND NOTHING WAS MINTED. Two further readings, because a 403 alone would not establish it: no proof
  // row at all, and a CFO export reading NOT COMPUTED on both ledgers rather than $0.00.
  const proofRows = await prisma.proof.count({ where: { recoveryCaseId } });
  if (proofRows !== 0) throw new Error(`synthetic pilot wrote ${proofRows} proof row(s) after a refusal`);

  const exported = await expectStatus(
    app,
    "GET",
    `/audit/cases/${recoveryCaseId}/cfo-export`,
    STEWARD,
    undefined,
    200,
  );
  if (exported.provenRevenueReturnedMinor !== null || exported.auditableRevenueMinor !== null) {
    throw new Error(
      "synthetic CFO export must read NOT COMPUTED after a refusal, never a figure and never a zero: " +
        JSON.stringify({
          proven: exported.provenRevenueReturnedMinor,
          auditable: exported.auditableRevenueMinor,
        }),
    );
  }
  return { evidenceId };
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
