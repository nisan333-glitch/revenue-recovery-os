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
  // THE MIRROR OF THE GUARD ABOVE, AND ITS ABSENCE WAS THE ONE TIER A VARIABLE THAT FAILED SILENTLY.
  //
  // Measured by `scripts/pilot-config/verify-config-chain.mjs`: of the five variables a detecting
  // deployment needs, four refuse at startup and `NH_AGENTS_ENABLED` did not. Drop it and the service
  // listens, `/health` returns 200, and the entire detection runtime is simply absent — so a
  // deployment that forgot the one variable that turns detection ON got a green service that finds
  // nothing, and nothing said so.
  //
  // WHY THIS IS A CONTRADICTION AND NOT A PREFERENCE. `configuredAgentHandlers` builds a handler ONLY
  // for a detector whose flag is explicitly `"true"` — `optIn` returns `[]` for absent and for
  // `"false"`. So a non-empty handler list means an operator explicitly asked for a detector, and
  // asking for a detector while the runtime that would run it is off is not a configuration anybody
  // means. Turning a detector OFF still works and still says so: set its own flag to `"false"`.
  //
  // DEFAULTING `NH_AGENTS_ENABLED` TO TRUE WAS THE OTHER OPTION AND IS REJECTED. It would start
  // detecting in every environment that merely has a database, which is a far larger change than the
  // defect. This refuses only the self-contradictory configuration and leaves every coherent one —
  // including "everything off" — exactly as it was.
  if (!config.enabled && handlers.length > 0) {
    throw new Error(
      "NH_AGENTS_ENABLED is not true, but detector handlers are explicitly enabled "
        + `(${handlers.map((h) => h.agentId).join(", ")}) — the agent runtime would not start and `
        + "nothing would be detected. Set NH_AGENTS_ENABLED=true, or set each detector's own flag to false",
    );
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
