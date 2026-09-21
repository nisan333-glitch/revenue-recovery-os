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
} from "./http/schemas";
import type { AgentWorkerReadiness } from "./agents/worker";
import { CandidateReviewService, type CandidateReviewDecision } from "./agents/candidateReview";
import { CandidatePromotionService } from "./agents/recoveryCase";
import { PostgresCandidateReviewStore } from "./agents/postgresCandidateReviewStore";

// EP-10 · Requests that arrived with a leading "/api" and were rewritten below — kept so
// the production server's SPA-fallback handler can tell "an unmatched /api/* call" (must
// 404 as JSON) apart from "an unmatched UI route" (gets the SPA shell) even though, by the
// time a not-found handler runs, the URL itself no longer carries the prefix. A WeakSet
// keyed on the raw request releases each entry once that request is garbage-collected.
export const apiPrefixedRequests = new WeakSet<object>();

export interface BuildAppOptions {
  readonly agentReadiness?: () => AgentWorkerReadiness;
  readonly candidateReviewService?: CandidateReviewService;
  readonly candidatePromotionService?: CandidatePromotionService;
  readonly identityResolver?: IdentityResolver;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
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
      const evidence = await proofService.ingestCaseEvidence(actor, req.params.caseId, req.body);
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
