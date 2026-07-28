// EP-3/EP-4 · Governed REST API. Routes are THIN: they authenticate (build an actor
// context), validate (JSON Schema), delegate to the application service, and shape the
// response. Authorization + separation of duties live in the service layer. Routes
// never touch Prisma directly. Controlled flow:
//   authenticated request → actor context → route → application service → authority gate
//   → domain kernel → persistence adapter → PostgreSQL.
import Fastify, { type FastifyInstance } from "fastify";
import * as proofService from "./services/proofService";
import type { ApproveProofRequest, ReviseProofRequest } from "./services/proofService";
import { registerErrorHandler } from "./http/errors";
import { isDbReady } from "./health";
import { actorFromRequest } from "./auth/actorContext";
import {
  approveProofSchema,
  reviseProofSchema,
  proofIdParamsSchema,
  caseParamsSchema,
} from "./http/schemas";

export function buildApp(): FastifyInstance {
  // removeAdditional:false so `additionalProperties:false` REJECTS (400) an injected
  // field — e.g. a counted `revenueReturned` — instead of silently stripping it.
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
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

  // Reads — authentication required (any valid actor), no role restriction.
  app.get<{ Params: { proofId: string } }>(
    "/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      actorFromRequest(req);
      return reply.send(await proofService.getProof(req.params.proofId));
    },
  );

  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/proofs",
    { schema: caseParamsSchema },
    async (req, reply) => {
      actorFromRequest(req);
      return reply.send(await proofService.getCaseChain(req.params.caseId));
    },
  );

  return app;
}
