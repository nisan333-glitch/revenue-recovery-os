import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "./bootstrap";
import { configuredAgentHandlers, ACTIVATION_AGENT_ID } from "./activationDetector";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";

describe.skipIf(!process.env.DATABASE_URL)("activation worker controlled operation", () => {
  afterAll(async () => { await prisma.$disconnect(); });
  it("runs a queued observation through the real worker into a candidate only", async () => {
    const boundaryId = `SYNTHETIC-worker-${randomUUID()}`;
    const env = { NH_AGENTS_ENABLED: "true", NH_ACTIVATION_DETECTOR_ENABLED: "true",
      NH_AGENT_BOUNDARIES: boundaryId, NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:10000", NH_AGENT_IDLE_DELAY_MS: "10" };
    const process = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
    await createPostgresAgentTaskStore().enqueueIfAbsent({ taskId: randomUUID(), boundaryId, agentId: ACTIVATION_AGENT_ID,
      idempotencyKey: randomUUID(), now: Date.now(), payload: {
        sourceRef: `hmac-sha256:${"a".repeat(64)}`, signedAt: "2026-01-01T00:00:00.000Z",
        activationDueAt: "2026-01-10T00:00:00.000Z", activatedAt: null,
        observedAt: "2026-01-11T00:00:00.000Z", amountAtRiskMinor: 10000, currency: "USD", actionAvailable: true,
      } });
    process.start();
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } }))) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(process.readiness().status).toBe("up");
      expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(1);
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);
    } finally { await process.stop(); }
    expect(process.readiness().status).toBe("down");
  });
});
