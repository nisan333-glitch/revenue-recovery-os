// EP-3/EP-4 · Governed REST API. Routes are THIN: they authenticate (build an actor
// context), validate (JSON Schema), delegate to the application service, and shape the
// response. Authorization + separation of duties live in the service layer. Routes
// never touch Prisma directly. Controlled flow:
//   authenticated request → actor context → route → application service → authority gate
//   → domain kernel → persistence adapter → PostgreSQL.
import Fastify, { type FastifyInstance } from "fastify";
import * as proofService from "./services/proofService";
import type {
  ApproveProofRequest,
  ReviseProofRequest,
  EstablishBaselineRequest,
  IngestEvidenceRequest,
} from "./services/proofService";
import * as auditService from "./audit/auditService";
import * as pilotIntakeService from "./services/pilotIntakeService";
import * as pilotAssessmentService from "./services/pilotAssessmentService";
import type { SchedulePilotAssessmentRequest } from "./services/pilotAssessmentService";
import * as pilotAnalysisTermsService from "./services/pilotAnalysisTermsService";
import type {
  AnalysisTermsTransitionRequest,
  ProposeAnalysisTermsRequest,
} from "./services/pilotAnalysisTermsService";
import type {
  PilotDatasetRequest,
  RegisterAdmissionPolicyRequest,
  PolicyTransitionRequest,
} from "./services/pilotIntakeService";
import { INTAKE_LIMITS } from "../src/contract/pilotDataContract";
import { registerErrorHandler } from "./http/errors";
import { isDbReady } from "./health";
import { resolveActor, type IdentityResolver } from "./auth/actorContext";
import { assertProductionDatabaseConfiguration } from "./persistence/databaseConfig";
import {
  approveProofSchema,
  reviseProofSchema,
  proofIdParamsSchema,
  caseParamsSchema,
  establishBaselineSchema,
  ingestEvidenceSchema,
  candidateQueueSchema,
  candidateReviewSchema,
  candidatePromotionSchema,
  pilotDatasetSchema,
  admissionPolicySchema,
  analysisTermsGovernanceQuerySchema,
  analysisTermsListQuerySchema,
  analysisTermsSchema,
  analysisTermsTransitionSchema,
  policyTransitionSchema,
  policyGovernanceQuerySchema,
  schedulePilotAssessmentSchema,
  pilotAssessmentReadSchema,
  pilotAssessmentListSchema,
} from "./http/schemas";
import type { AgentWorkerReadiness } from "./agents/worker";
import { CandidateReviewService, type CandidateReviewDecision } from "./agents/candidateReview";
import { CandidatePromotionService } from "./agents/recoveryCase";
import { PostgresCandidateReviewStore } from "./agents/postgresCandidateReviewStore";
import { sourceVerifierFromEnvironment, type SourceVerifier } from "./services/sourceVerification";

// EP-10 · Requests that arrived with a leading "/api" and were rewritten below — kept so
// the production server's SPA-fallback handler can tell "an unmatched /api/* call" (must
// 404 as JSON) apart from "an unmatched UI route" (gets the SPA shell) even though, by the
// time a not-found handler runs, the URL itself no longer carries the prefix. A WeakSet
// keyed on the raw request releases each entry once that request is garbage-collected.
export const apiPrefixedRequests = new WeakSet<object>();

export interface BuildAppOptions {
  readonly sourceVerifier?: SourceVerifier;
  readonly agentReadiness?: () => AgentWorkerReadiness;
  readonly candidateReviewService?: CandidateReviewService;
  readonly candidatePromotionService?: CandidatePromotionService;
  readonly identityResolver?: IdentityResolver;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const sourceVerifier = options.sourceVerifier ?? sourceVerifierFromEnvironment(process.env);
  assertProductionDatabaseConfiguration(process.env);
  if (process.env.NODE_ENV === "production" && !options.identityResolver) {
    throw new Error("a verified production identity resolver is required");
  }
  const candidateStore = new PostgresCandidateReviewStore();
  const candidateReview = options.candidateReviewService ?? new CandidateReviewService(candidateStore);
  const candidatePromotion = options.candidatePromotionService ?? new CandidatePromotionService(candidateStore);
  // removeAdditional:false so `additionalProperties:false` REJECTS (400) an injected
  // field — e.g. a counted `revenueReturned` — instead of silently stripping it.
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    connectionTimeout: 30_000,
    keepAliveTimeout: 5_000,
    ajv: { customOptions: { removeAdditional: false } },
    // EP-10 · The frontend's apiClient calls same-origin `/api/...`; every route below is
    // registered unprefixed (as it always was, and as tests still call it via `.inject()`).
    // Stripping a leading "/api" here — instead of registering every route twice — is a
    // no-op for any path that doesn't start with "/api/", so it changes nothing for existing
    // `.inject()` calls (none of which use that prefix).
    rewriteUrl(req) {
      const url = req.url ?? "/";
      if (!url.startsWith("/api/")) return url;
      apiPrefixedRequests.add(req);
      return url.slice(4);
    },
  });
  registerErrorHandler(app);
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    reply.header("cache-control", "no-store");
    return payload;
  });

  // Public health probes — no authentication.
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    const up = await isDbReady();
    const agents = options.agentReadiness?.() ?? {
      status: "disabled" as const,
      configured: 0,
      running: 0,
    };
    const ready = up && agents.status !== "down";
    return reply.code(ready ? 200 : 503).send({ db: up ? "up" : "down", agents });
  });

  app.get<{ Querystring: { boundaryId: string } }>(
    "/agent-candidates",
    { schema: candidateQueueSchema },
    async (req, reply) => reply.send(await candidateReview.list(await resolveActor(req, options.identityResolver), req.query.boundaryId)),
  );

  app.post<{
    Params: { candidateId: string };
    Body: { boundaryId: string; decision: CandidateReviewDecision; reason: string };
  }>("/agent-candidates/:candidateId/review", { schema: candidateReviewSchema }, async (req, reply) => {
    const review = await candidateReview.decide(await resolveActor(req, options.identityResolver), {
      candidateId: req.params.candidateId,
      ...req.body,
    });
    return reply.code(201).send(review);
  });

  app.post<{ Params: { candidateId: string }; Body: { boundaryId: string } }>(
    "/agent-candidates/:candidateId/promote",
    { schema: candidatePromotionSchema },
    async (req, reply) => {
      const result = await candidatePromotion.promote(
        await resolveActor(req, options.identityResolver),
        req.params.candidateId,
        req.body.boundaryId,
      );
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );

  // EP-13 · Customer pilot dataset intake. SERVER-SIDE VALIDATION IS AUTHORITATIVE — the browser may
  // run the same contract validator as preflight assistance, but this is the decision. Creates no
  // RecoveryEvent, Case, Proof or revenue claim; it validates, and records only that a usable
  // dataset was submitted (counts and codes — never row content).
  // Fastify's default body limit is 1 MB — far below the contract's 10 MB dataset limit, so without
  // this a legitimate upload dies at the transport with no contract code at all. The limit is set
  // PER ROUTE, not globally: no other endpoint needs a large body, and raising it everywhere would
  // widen the denial-of-service surface for free. The headroom above INTAKE_LIMITS.maxBytes is
  // deliberate — a file between the two reaches the validator and is refused with the deterministic
  // NH-DC-1011 instead of a bare transport error. Neither path truncates.
  const pilotUploadTransportLimit = INTAKE_LIMITS.maxBytes + 2 * 1024 * 1024;

  app.post<{ Body: PilotDatasetRequest }>(
    "/pilot/datasets",
    { schema: pilotDatasetSchema, bodyLimit: pilotUploadTransportLimit },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const result = await pilotIntakeService.submitPilotDataset(actor, req.body);
      // 200, not 201: a dataset whose rows were rejected is a VALID answer, not a created resource.
      // The caller branches on `usableForAssessment`, never on the status code alone.
      return reply.code(200).send(result);
    },
  );

  // EP-14 · Register a versioned pilot admission policy for a boundary. The thresholds a dataset is
  // judged against are the customer's commercial decision; this is how they state them. Append-only
  // per (boundary, id, version) — a change is a new version, never an edit.
  app.post<{ Body: RegisterAdmissionPolicyRequest }>(
    "/pilot/admission-policies",
    { schema: admissionPolicySchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.code(201).send(await pilotIntakeService.registerPilotAdmissionPolicy(actor, req.body));
    },
  );

  // EP-15 · Policy lifecycle. Proposing is the customer side; activating, freezing, resuming and
  // retiring are governance. The split is the point: a bar you set for yourself is the first input
  // to the number you benefit from.
  const transitions = [
    ["activate", "ACTIVATED"],
    ["freeze", "FROZEN"],
    ["unfreeze", "UNFROZEN"],
    ["retire", "RETIRED"],
  ] as const;
  for (const [path, transition] of transitions) {
    app.post<{ Body: PolicyTransitionRequest }>(
      `/pilot/admission-policies/${path}`,
      { schema: policyTransitionSchema },
      async (req, reply) => {
        const actor = await resolveActor(req, options.identityResolver);
        return reply
          .code(200)
          .send(await pilotIntakeService.transitionPilotAdmissionPolicy(actor, transition, req.body));
      },
    );
  }

  // Governed read: who proposed a bar, who put it in force, when and why.
  app.get<{ Querystring: { boundaryId: string; policyId: string; policyVersion: string } }>(
    "/pilot/admission-policies/governance",
    { schema: policyGovernanceQuerySchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(
        await pilotIntakeService.readPilotAdmissionPolicyGovernance(
          actor,
          req.query.boundaryId,
          req.query.policyId,
          req.query.policyVersion,
        ),
      );
    },
  );

  // EP-26 · ANALYSIS-TERMS GOVERNANCE. The cut-off and the stall threshold define what an assessment
  // MEASURES, which makes them more load-bearing than the fitness bar — and until now they arrived in
  // a request body. Same split as the bar: the customer side proposes, governance activates, and no
  // actor may do both halves of one version.
  app.post<{ Body: ProposeAnalysisTermsRequest }>(
    "/pilot/analysis-terms",
    { schema: analysisTermsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.code(201).send(await pilotAnalysisTermsService.proposeAnalysisTerms(actor, req.body));
    },
  );

  for (const [path, transition] of transitions) {
    app.post<{ Body: AnalysisTermsTransitionRequest }>(
      `/pilot/analysis-terms/${path}`,
      { schema: analysisTermsTransitionSchema },
      async (req, reply) => {
        const actor = await resolveActor(req, options.identityResolver);
        return reply
          .code(200)
          .send(await pilotAnalysisTermsService.transitionAnalysisTerms(actor, transition, req.body));
      },
    );
  }

  // Governed read: who proposed a definition, who put it in force, when and why. AuditRead only.
  app.get<{ Querystring: { boundaryId: string; termsId: string; termsVersion: string } }>(
    "/pilot/analysis-terms/governance",
    { schema: analysisTermsGovernanceQuerySchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(
        await pilotAnalysisTermsService.readAnalysisTermsGovernance(
          actor,
          req.query.boundaryId,
          req.query.termsId,
          req.query.termsVersion,
        ),
      );
    },
  );

  // The MENU of definitions someone else approved — the opposite of a lever. Every role may read it,
  // because an operator who cannot see the cut-off their data will be read at cannot tell what the
  // figure they are shown means.
  app.get<{ Querystring: { boundaryId: string } }>(
    "/pilot/analysis-terms/list",
    { schema: analysisTermsListQuerySchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await pilotAnalysisTermsService.listGovernedAnalysisTerms(actor, req.query.boundaryId));
    },
  );

  // EP-16 · Schedule a governed assessment execution over an ALREADY-ADMITTED dataset.
  //
  // The CSV is re-supplied rather than held server-side: the intake deliberately persists no
  // uploaded bytes, so re-supplying them is what lets the fingerprint check prove that the file
  // being executed is the file that was admitted. Same per-route body limit and same reasoning as
  // the intake — a large body is needed here and nowhere else.
  app.post<{ Body: SchedulePilotAssessmentRequest }>(
    "/pilot/assessments",
    { schema: schedulePilotAssessmentSchema, bodyLimit: pilotUploadTransportLimit },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const result = await pilotAssessmentService.schedulePilotAssessment(actor, req.body);
      // 201 only when a NEW execution was created. A repeat of an identical binding is 200 (the
      // idempotent path), and a refusal is 200 with a deterministic NH-AX-#### code — a dataset
      // that may not be executed is a valid answer, exactly as a rejected dataset is at the intake.
      return reply.code(result.scheduled && result.created ? 201 : 200).send(result);
    },
  );

  // EP-16 · Read one execution: state, full lineage, and the finding if it produced one.
  app.get<{ Params: { executionId: string }; Querystring: { boundaryId: string } }>(
    "/pilot/assessments/:executionId",
    { schema: pilotAssessmentReadSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(
        await pilotAssessmentService.readPilotAssessment(actor, req.query.boundaryId, req.params.executionId),
      );
    },
  );

  // EP-16 · The status board: every execution for one boundary, newest first.
  app.get<{ Querystring: { boundaryId: string; limit?: number } }>(
    "/pilot/assessments",
    { schema: pilotAssessmentListSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(
        await pilotAssessmentService.listPilotAssessments(actor, req.query.boundaryId, req.query.limit),
      );
    },
  );

  // Record a case author/owner (the beneficiary).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/author",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      await proofService.authorCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "authored" });
    },
  );

  // EP-8.1 · Establish + lock a baseline snapshot (author/operator only; lockedAt server-stamped).
  app.post<{ Params: { caseId: string }; Body: EstablishBaselineRequest }>(
    "/cases/:caseId/baseline",
    { schema: establishBaselineSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const snapshot = await proofService.establishBaseline(actor, req.params.caseId, req.body);
      return reply.code(201).send(snapshot);
    },
  );

  // EP-8.1 · Record the governed Fix/intervention timing event (author/operator only).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/intervention",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      await proofService.recordIntervention(actor, req.params.caseId);
      return reply.code(201).send({ status: "intervened" });
    },
  );

  // EP-8.1 · Pre-proof evidence ingestion (author/operator only; role/independence derived server-side).
  app.post<{ Params: { caseId: string }; Body: IngestEvidenceRequest }>(
    "/cases/:caseId/evidence",
    { schema: ingestEvidenceSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const evidence = await proofService.ingestCaseEvidence(actor, req.params.caseId, req.body, sourceVerifier);
      return reply.code(201).send(evidence);
    },
  );

  // Approve a governed proof (the kernel computes the frozen number).
  app.post<{ Body: ApproveProofRequest }>("/proofs", { schema: approveProofSchema }, async (req, reply) => {
    const actor = await resolveActor(req, options.identityResolver);
    const proof = await proofService.approve(actor, req.body);
    return reply.code(201).send(proof);
  });

  // Create a linked correction/revision (original never overwritten).
  app.post<{ Params: { proofId: string }; Body: ReviseProofRequest }>(
    "/proofs/:proofId/revisions",
    { schema: reviseProofSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const revised = await proofService.revise(actor, req.params.proofId, req.body);
      return reply.code(201).send(revised);
    },
  );

  // Independently verify a proof (governance stamp — never changes the number).
  app.post<{ Params: { proofId: string } }>(
    "/proofs/:proofId/verify",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      const proof = await proofService.verifyProof(actor, req.params.proofId);
      return reply.code(200).send(proof);
    },
  );

  // Governance flag — Steward only.
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/flag",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      await proofService.flagCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "flagged" });
    },
  );

  // Governance halt — Steward only.
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/halt",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      await proofService.haltCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "halted" });
    },
  );

  // Governance exclude — Steward only (reduces/excludes; never counts).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/exclude",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      await proofService.excludeCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "excluded" });
    },
  );

  // Audit reads — authenticated AND authorized (AuditRead) in the service; read-only.
  app.get<{ Params: { proofId: string } }>(
    "/audit/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await auditService.reconstructProof(actor, req.params.proofId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/audit/cases/:caseId",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await auditService.caseAuditTrail(actor, req.params.caseId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/audit/cases/:caseId/cfo-export",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await auditService.cfoAuditExport(actor, req.params.caseId));
    },
  );

  // EP-9 · Full baseline history for a case (governed read; plural — never "latest only").
  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/baselines",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await auditService.listCaseBaselines(actor, req.params.caseId));
    },
  );

  // EP-9 · Every evidence record ingested for a case (governed read).
  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/evidence",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await auditService.listCaseEvidence(actor, req.params.caseId));
    },
  );

  // EP-8.1 · H2: provenance-bearing reads are governed (AuditRead) exactly like `/audit/*` —
  // a beneficiary (author/operator) may not read frozen proof provenance through this path either.
  app.get<{ Params: { proofId: string } }>(
    "/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await proofService.getProof(actor, req.params.proofId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/proofs",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = await resolveActor(req, options.identityResolver);
      return reply.send(await proofService.getCaseChain(actor, req.params.caseId));
    },
  );

  return app;
}
