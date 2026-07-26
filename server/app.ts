// EP-2 · Minimal Fastify wiring — the smallest REST surface that proves the
// authoritative Postgres store is reachable through an API (EP-3 unblock check).
// It adds NO business logic: every number still comes from the domain kernel via
// the proof store. Auth/authorization/queues/workers are intentionally absent.
import Fastify, { type FastifyInstance } from "fastify";
import { approveProof, reviseExistingProof, getCaseProofs } from "./persistence/proofStore";
import { money } from "../src/domain/money";
import type { ProofApprovalInput } from "../src/domain/proof";

interface ApproveBody {
  proofId: string;
  recoveryCaseId: string;
  approvedAt: string;
  currency: string;
  collectedMinor: number;
  baselineMinor: number;
  excludedRecoveryMinor: number;
  exclusionStatement: string;
  recoveryReason: string;
  attribution: string;
  evidenceRefs: string[];
  baselineId: string;
  baselineMethodId: string;
  baselineVersion: number;
  baselineLockPolicy: string;
  policyVersion: string;
  confidenceMethodologyVersion: string;
  proofThresholdUsed: number;
  confidenceUsed: number;
  approvedBy: string;
}

// Note: the body carries collected/baseline amounts but NEVER revenueReturned —
// the number is derived by the kernel, so the API cannot be told the answer.
function toApprovalInput(b: ApproveBody): ProofApprovalInput {
  return {
    proofId: b.proofId,
    recoveryCaseId: b.recoveryCaseId,
    approvedAt: b.approvedAt,
    collectedAmount: money(b.collectedMinor, b.currency),
    baselineAmount: money(b.baselineMinor, b.currency),
    excludedRecoveryAmount: money(b.excludedRecoveryMinor, b.currency),
    exclusionStatement: b.exclusionStatement,
    recoveryReason: b.recoveryReason as ProofApprovalInput["recoveryReason"],
    attribution: b.attribution,
    evidenceRefs: b.evidenceRefs,
    baselineId: b.baselineId,
    baselineMethodId: b.baselineMethodId,
    baselineVersion: b.baselineVersion,
    baselineLockPolicy: b.baselineLockPolicy,
    policyVersion: b.policyVersion,
    confidenceMethodologyVersion: b.confidenceMethodologyVersion,
    proofThresholdUsed: b.proofThresholdUsed,
    confidenceUsed: b.confidenceUsed,
    approvedBy: b.approvedBy,
  };
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post<{ Body: ApproveBody }>("/proofs", async (req, reply) => {
    const proof = await approveProof(toApprovalInput(req.body));
    return reply.code(201).send(proof); // Proof uses plain Money objects — JSON-safe
  });

  app.post<{ Params: { proofId: string }; Body: Record<string, unknown> }>(
    "/proofs/:proofId/revisions",
    async (req, reply) => {
      const b = req.body as {
        newProofId: string;
        status: "Reversed" | "Superseded" | "Corrected";
        at: string;
        currency?: string;
        collectedMinor?: number;
        baselineMinor?: number;
        approvedBy: string;
        attribution?: string;
      };
      const cur = b.currency ?? "USD";
      const revised = await reviseExistingProof(req.params.proofId, {
        newProofId: b.newProofId,
        status: b.status,
        at: b.at,
        approvedBy: b.approvedBy,
        attribution: b.attribution,
        collectedAmount: b.collectedMinor !== undefined ? money(b.collectedMinor, cur) : undefined,
        baselineAmount: b.baselineMinor !== undefined ? money(b.baselineMinor, cur) : undefined,
      });
      return reply.code(201).send(revised);
    },
  );

  app.get<{ Params: { caseId: string } }>("/cases/:caseId/proofs", async (req, reply) => {
    return reply.send(await getCaseProofs(req.params.caseId));
  });

  return app;
}
