import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import { AgentRuntime } from "./runtime";
import { ConfiguredAgentPolicyProvider, parseAgentProcessConfig } from "./config";
import { AgentWorker, AgentWorkerSupervisor, type AgentTaskRunner } from "./worker";
import { publishesCandidates, type AgentAuditSink, type AgentHandler } from "./types";
import { PostgresCandidateSignalWriter } from "./postgresCandidateSignalWriter";

export interface AgentProcess {
  start(): void;
  stop(): Promise<void>;
  readiness(): ReturnType<AgentWorkerSupervisor["readiness"]>;
}

export function createAgentProcessFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  handlers: readonly AgentHandler[],
): AgentProcess {
  const config = parseAgentProcessConfig(env);
  if (config.enabled && handlers.length === 0) {
    throw new Error("agents are enabled but no production agent handlers are registered");
  }
  // The registry requirement is scoped to the handlers that can actually publish, and NOT relaxed for
  // the ones that can. Before this, the guard was process-wide: it could not tell a detector from an
  // observation-only agent, so an assessment-only pilot had to invent a recovery type and a threshold
  // it would never use — a fabricated number in configuration, which is the habit this codebase
  // exists to break. Narrowing the guard to the handlers it is actually about removes the incentive
  // to fabricate without removing the guard from anything it previously covered.
  const candidateCapable = handlers.filter(publishesCandidates);
  if (config.enabled && candidateCapable.length > 0 && config.admissionPolicies.size === 0) {
    throw new Error(
      "agents are enabled but no candidate admission policies are configured for the candidate-publishing agents " +
        `(${candidateCapable.map((h) => h.agentId).join(", ")})`,
    );
  }
  assertUniqueAgentIds(handlers);

  const policy = new ConfiguredAgentPolicyProvider(config);
  const runtime = new AgentRuntime({
    store: createPostgresAgentTaskStore(
      undefined,
      // No publisher ⇒ no publication sink at all. `succeed()` calls it with `?.`, so its absence is
      // a no-op rather than a branch: an observation-only deployment has no code path to a candidate.
      config.enabled && candidateCapable.length > 0
        ? new PostgresCandidateSignalWriter(config.admissionPolicies)
        : undefined,
    ),
    policy,
    audit: NOOP_AUDIT,
    now: Date.now,
  });
  return createAgentProcess({
    enabled: config.enabled,
    boundaryIds: config.boundaryIds,
    handlers,
    runtime,
    idleDelayMs: config.idleDelayMs,
    errorDelayMs: policy.current().retryDelayMs,
    instanceId: `${hostname()}:${process.pid}:${randomUUID()}`,
  });
}

export function createAgentProcess(input: {
  readonly enabled: boolean;
  readonly boundaryIds: readonly string[];
  readonly handlers: readonly AgentHandler[];
  readonly runtime: AgentTaskRunner;
  readonly idleDelayMs: number;
  readonly errorDelayMs: (consecutiveErrors: number) => number;
  readonly instanceId: string;
}): AgentProcess {
  assertUniqueAgentIds(input.handlers);
  const workers = input.boundaryIds.flatMap((boundaryId) =>
    input.handlers.map((handler) => new AgentWorker({
      runtime: input.runtime,
      handler,
      workerId: `${input.instanceId}:${boundaryId}:${handler.agentId}`,
      boundaryId,
      idleDelayMs: input.idleDelayMs,
      errorDelayMs: input.errorDelayMs,
    })),
  );
  return new AgentWorkerSupervisor(input.enabled, workers);
}

const NOOP_AUDIT: AgentAuditSink = Object.freeze({
  append: async () => {
    // Durable task events are written atomically by PostgresAgentTaskStore.
  },
});

function assertUniqueAgentIds(handlers: readonly AgentHandler[]): void {
  const ids = handlers.map((handler) => handler.agentId);
  if (ids.some((id) => !id.trim())) throw new Error("production agent handlers require an agentId");
  if (new Set(ids).size !== ids.length) throw new Error("production agent handler ids must be unique");
}
