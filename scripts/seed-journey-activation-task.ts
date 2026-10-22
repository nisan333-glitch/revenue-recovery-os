// JOURNEY SUPPORT ONLY · enqueue ONE activation-detector task for the browser journey's boundary.
//
// Run by `e2e/journey.mjs`, never by the application.
//
// WHY THE JOURNEY CANNOT DO THIS THROUGH A SCREEN. A detector task is enqueued by whatever observes
// the customer's system; NH has no screen that creates one, deliberately — a UI that let an operator
// hand-write a finding would let the beneficiary author the thing the review gate exists to judge. So
// the journey injects the OBSERVATION and nothing else. Everything after this line is the product: the
// real detector, the real worker, the real candidate store, the real review screen, the real promotion.
//
// WHAT IS INJECTED IS AN OBSERVATION, NOT A FINDING. The payload is the shape
// `activationDetector.run` reads; the detector decides whether it is a missed activation at all, and
// `assertCandidateSignal` validates what it emits. The script writes no candidate, no case, no
// authority row and no proof.
//
// SYNTHETIC. The account reference is an HMAC over a per-run uuid, not over anything real, and the
// at-risk amount is a request INPUT on this path rather than a figure derived from customer data —
// which is exactly why the journey never calls it recovered money.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { ACTIVATION_AGENT_ID } from "../server/agents/activationDetector";
import { createPostgresAgentTaskStore } from "../server/agents/prismaTaskDatabase";
import { prisma } from "../server/db";

const boundaryId = process.argv[2];
if (!boundaryId) {
  console.error("usage: seed-journey-activation-task.ts <boundaryId>");
  process.exit(2);
}

/** The at-risk figure this run uses. Echoed back so the journey asserts the screen's number, not a guess. */
const AMOUNT_AT_RISK_MINOR = 10_000;

async function main(): Promise<void> {
  const runId = randomUUID();
  const now = Date.now();
  const payload = Object.freeze({
    sourceRef: `hmac-sha256:${createHmac("sha256", randomUUID()).update(`JOURNEY-account-${runId}`).digest("hex")}`,
    signedAt: new Date(now - 21 * 86_400_000).toISOString(),
    activationDueAt: new Date(now - 7 * 86_400_000).toISOString(),
    activatedAt: null,
    observedAt: new Date(now - 60_000).toISOString(),
    amountAtRiskMinor: AMOUNT_AT_RISK_MINOR,
    currency: "USD",
    actionAvailable: true,
  });
  const taskId = `JOURNEY-activation-${runId}`;
  const queued = await createPostgresAgentTaskStore().enqueueIfAbsent({
    taskId,
    boundaryId,
    agentId: ACTIVATION_AGENT_ID,
    idempotencyKey: `JOURNEY-${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
    payload,
    now,
  });
  if (!queued.created) throw new Error("journey activation task collided with an existing task");
  console.log(JSON.stringify({ taskId, boundaryId, amountAtRiskMinor: AMOUNT_AT_RISK_MINOR, currency: "USD" }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
