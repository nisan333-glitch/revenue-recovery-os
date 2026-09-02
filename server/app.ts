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
import { actorFromRequest } from "./auth/actorContext";
import {
  approveProofSchema,
  reviseProofSchema,
  proofIdParamsSchema,
  caseParamsSchema,
  establishBaselineSchema,
  ingestEvidenceSchema,
} from "./http/schemas";

// EP-10 · Requests that arrived with a leading "/api" and were rewritten below — kept so
// the production server's SPA-fallback handler can tell "an unmatched /api/* call" (must
// 404 as JSON) apart from "an unmatched UI route" (gets the SPA shell) even though, by the
// time a not-found handler runs, the URL itself no longer carries the prefix. A WeakSet
// keyed on the raw request releases each entry once that request is garbage-collected.
export const apiPrefixedRequests = new WeakSet<object>();

export function buildApp(): FastifyInstance {
  // removeAdditional:false so `additionalProperties:false` REJECTS (400) an injected
  // field — e.g. a counted `revenueReturned` — instead of silently stripping it.
  const app = Fastify({
    logger: false,
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

  // Public health probes — no authentication.
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    const up = await isDbReady();
    return reply.code(up ? 200 : 503).send({ db: up ? "up" : "down" });
  });

  // Record a case author/owner (the beneficiary).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/author",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      await proofService.authorCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "authored" });
    },
  );

  // EP-8.1 · Establish + lock a baseline snapshot (author/operator only; lockedAt server-stamped).
  app.post<{ Params: { caseId: string }; Body: EstablishBaselineRequest }>(
    "/cases/:caseId/baseline",
    { schema: establishBaselineSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      const snapshot = await proofService.establishBaseline(actor, req.params.caseId, req.body);
      return reply.code(201).send(snapshot);
    },
  );

  // EP-8.1 · Record the governed Fix/intervention timing event (author/operator only).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/intervention",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      await proofService.recordIntervention(actor, req.params.caseId);
      return reply.code(201).send({ status: "intervened" });
    },
  );

  // EP-8.1 · Pre-proof evidence ingestion (author/operator only; role/independence derived server-side).
  app.post<{ Params: { caseId: string }; Body: IngestEvidenceRequest }>(
    "/cases/:caseId/evidence",
    { schema: ingestEvidenceSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      const evidence = await proofService.ingestCaseEvidence(actor, req.params.caseId, req.body);
      return reply.code(201).send(evidence);
    },
  );

  // Approve a governed proof (the kernel computes the frozen number).
  app.post<{ Body: ApproveProofRequest }>("/proofs", { schema: approveProofSchema }, async (req, reply) => {
    const actor = actorFromRequest(req);
    const proof = await proofService.approve(actor, req.body);
    return reply.code(201).send(proof);
  });

  // Create a linked correction/revision (original never overwritten).
  app.post<{ Params: { proofId: string }; Body: ReviseProofRequest }>(
    "/proofs/:proofId/revisions",
    { schema: reviseProofSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      const revised = await proofService.revise(actor, req.params.proofId, req.body);
      return reply.code(201).send(revised);
    },
  );

  // Independently verify a proof (governance stamp — never changes the number).
  app.post<{ Params: { proofId: string } }>(
    "/proofs/:proofId/verify",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      const proof = await proofService.verifyProof(actor, req.params.proofId);
      return reply.code(200).send(proof);
    },
  );

  // Governance flag — Steward only.
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/flag",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      await proofService.flagCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "flagged" });
    },
  );

  // Governance halt — Steward only.
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/halt",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      await proofService.haltCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "halted" });
    },
  );

  // Governance exclude — Steward only (reduces/excludes; never counts).
  app.post<{ Params: { caseId: string } }>(
    "/cases/:caseId/exclude",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      await proofService.excludeCase(actor, req.params.caseId);
      return reply.code(201).send({ status: "excluded" });
    },
  );

  // Audit reads — authenticated AND authorized (AuditRead) in the service; read-only.
  app.get<{ Params: { proofId: string } }>(
    "/audit/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await auditService.reconstructProof(actor, req.params.proofId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/audit/cases/:caseId",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await auditService.caseAuditTrail(actor, req.params.caseId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/audit/cases/:caseId/cfo-export",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await auditService.cfoAuditExport(actor, req.params.caseId));
    },
  );

  // EP-9 · Full baseline history for a case (governed read; plural — never "latest only").
  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/baselines",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await auditService.listCaseBaselines(actor, req.params.caseId));
    },
  );

  // EP-9 · Every evidence record ingested for a case (governed read).
  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/evidence",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await auditService.listCaseEvidence(actor, req.params.caseId));
    },
  );

  // EP-8.1 · H2: provenance-bearing reads are governed (AuditRead) exactly like `/audit/*` —
  // a beneficiary (author/operator) may not read frozen proof provenance through this path either.
  app.get<{ Params: { proofId: string } }>(
    "/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await proofService.getProof(actor, req.params.proofId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/proofs",
    { schema: caseParamsSchema },
    async (req, reply) => {
      const actor = actorFromRequest(req);
      return reply.send(await proofService.getCaseChain(actor, req.params.caseId));
    },
  );

  return app;
}
