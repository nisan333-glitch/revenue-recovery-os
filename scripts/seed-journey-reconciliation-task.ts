// JOURNEY SUPPORT ONLY · enqueue ONE reconciliation-observation task for the browser journey's boundary.
//
// Run by `e2e/journey.mjs`, never by the application.
//
// WHAT IS INJECTED. Two raw extracts — "what the contract system says is owed" and "what the billing
// system raised" — and nothing derived from them. The real reconciler, running in the real worker,
// decides which units are under-billed; `assertCandidateSignal` validates what it emits; the real
// admission bar admits it. This script writes no candidate, no case, no authority row and no proof, and
// it holds NO pseudonym key: the payer references are pseudonymised by the API process, which is the
// only place the deployment secret lives.
//
// SYNTHETIC. Every row comes from `server/agents/fixtures/reconciliation.synthetic.ts`, whose
// identifiers carry the word DEMO on purpose. It is a labelled demonstration book, not a customer's.
import { createHash, randomUUID } from "node:crypto";
import { RECONCILIATION_AGENT_ID } from "../server/agents/reconciliationObserver";
import {
  BILLING_COLUMNS,
  DEMO_BILLING_ROWS,
  DEMO_CURRENCY,
  DEMO_EXPECTATION_ROWS,
  EXPECTATION_COLUMNS,
  SYNTHETIC_LABEL,
} from "../server/agents/fixtures/reconciliation.synthetic";
import { createPostgresAgentTaskStore } from "../server/agents/prismaTaskDatabase";
import { prisma } from "../server/db";

const boundaryId = process.argv[2];
if (!boundaryId) {
  console.error("usage: seed-journey-reconciliation-task.ts <boundaryId>");
  process.exit(2);
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const now = Date.now();
  const payload = Object.freeze({
    expectation: { columns: [...EXPECTATION_COLUMNS], rows: DEMO_EXPECTATION_ROWS },
    billing: { columns: [...BILLING_COLUMNS], rows: DEMO_BILLING_ROWS },
    currency: DEMO_CURRENCY,
    observedAt: new Date(now - 60_000).toISOString(),
    actionAvailable: true,
  });
  const taskId = `JOURNEY-reconciliation-${runId}`;
  const queued = await createPostgresAgentTaskStore().enqueueIfAbsent({
    taskId,
    boundaryId,
    agentId: RECONCILIATION_AGENT_ID,
    idempotencyKey: `JOURNEY-${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
    payload,
    now,
  });
  if (!queued.created) throw new Error("journey reconciliation task collided with an existing task");
  console.log(JSON.stringify({ taskId, boundaryId, label: SYNTHETIC_LABEL, currency: DEMO_CURRENCY }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
