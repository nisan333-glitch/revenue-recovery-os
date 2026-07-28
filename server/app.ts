// EP-3 · Governed REST API. Route handlers are THIN: they validate (via JSON Schema),
// delegate to the application service, and shape the response. They contain no
// recovery/proof/revenue math and never touch Prisma directly. The controlled flow is:
//   REST route → application service → domain kernel → persistence adapter → PostgreSQL.
import Fastify, { type FastifyInstance } from "fastify";
import * as proofService from "./services/proofService";
import type { ApproveProofRequest, ReviseProofRequest } from "./services/proofService";
import { registerErrorHandler } from "./http/errors";
import { isDbReady } from "./health";
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

  // Liveness — the process is up.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness — reports actual database connectivity.
  app.get("/ready", async (_req, reply) => {
    const up = await isDbReady();
    return reply.code(up ? 200 : 503).send({ db: up ? "up" : "down" });
  });

  // Approve a governed proof (the kernel computes the frozen number).
  app.post<{ Body: ApproveProofRequest }>("/proofs", { schema: approveProofSchema }, async (req, reply) => {
    const proof = await proofService.approve(req.body);
    return reply.code(201).send(proof);
  });

  // Create a linked correction/revision (original never overwritten).
  app.post<{ Params: { proofId: string }; Body: ReviseProofRequest }>(
    "/proofs/:proofId/revisions",
    { schema: reviseProofSchema },
    async (req, reply) => {
      const revised = await proofService.revise(req.params.proofId, req.body);
      return reply.code(201).send(revised);
    },
  );

  // Read one proof with its full frozen provenance.
  app.get<{ Params: { proofId: string } }>(
    "/proofs/:proofId",
    { schema: proofIdParamsSchema },
    async (req, reply) => {
      return reply.send(await proofService.getProof(req.params.proofId));
    },
  );

  // Read the append-only revision history for a case.
  app.get<{ Params: { caseId: string } }>(
    "/cases/:caseId/proofs",
    { schema: caseParamsSchema },
    async (req, reply) => {
      return reply.send(await proofService.getCaseChain(req.params.caseId));
    },
  );

  return app;
}
