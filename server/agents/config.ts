import type { AgentPolicyProvider, AgentPolicySnapshot } from "./types";
import type { RecoveryTypeAdmissionPolicy } from "./admission";

export interface AgentProcessConfig {
  readonly enabled: boolean;
  readonly boundaryIds: readonly string[];
  readonly disabledAgents: ReadonlySet<string>;
  readonly idleDelayMs: number;
  readonly maxAttempts: number;
  readonly leaseMs: number;
  readonly retryBaseMs: number;
  readonly retryCapMs: number;
  readonly admissionPolicies: ReadonlyMap<string, RecoveryTypeAdmissionPolicy>;
}

export function parseAgentProcessConfig(
  env: Readonly<Record<string, string | undefined>>,
): AgentProcessConfig {
  const enabled = parseBoolean("NH_AGENTS_ENABLED", env.NH_AGENTS_ENABLED, false);
  const boundaryIds = parseList(env.NH_AGENT_BOUNDARIES);
  const disabledAgents = new Set(parseList(env.NH_DISABLED_AGENTS));
  const idleDelayMs = parseInteger("NH_AGENT_IDLE_DELAY_MS", env.NH_AGENT_IDLE_DELAY_MS, 1_000, 1, 60_000);
  const maxAttempts = parseInteger("NH_AGENT_MAX_ATTEMPTS", env.NH_AGENT_MAX_ATTEMPTS, 3, 1, 20);
  const leaseMs = parseInteger("NH_AGENT_LEASE_MS", env.NH_AGENT_LEASE_MS, 30_000, 3_000, 300_000);
  const retryBaseMs = parseInteger("NH_AGENT_RETRY_BASE_MS", env.NH_AGENT_RETRY_BASE_MS, 1_000, 1, 300_000);
  const retryCapMs = parseInteger("NH_AGENT_RETRY_CAP_MS", env.NH_AGENT_RETRY_CAP_MS, 60_000, 1, 3_600_000);
  const admissionPolicies = parseAdmissionPolicies(env.NH_AGENT_ADMISSION_POLICIES);

  if (retryCapMs < retryBaseMs) {
    throw new Error("NH_AGENT_RETRY_CAP_MS must be greater than or equal to NH_AGENT_RETRY_BASE_MS");
  }
  if (enabled && boundaryIds.length === 0) {
    throw new Error("NH_AGENT_BOUNDARIES is required when agents are enabled");
  }

  return Object.freeze({
    enabled,
    boundaryIds: Object.freeze(boundaryIds),
    disabledAgents,
    idleDelayMs,
    maxAttempts,
    leaseMs,
    retryBaseMs,
    retryCapMs,
    admissionPolicies,
  });
}

function parseAdmissionPolicies(raw: string | undefined): ReadonlyMap<string, RecoveryTypeAdmissionPolicy> {
  if (!raw?.trim()) return new Map();
  const policies = new Map<string, RecoveryTypeAdmissionPolicy>();
  for (const entry of raw.split(",")) {
    const parts = entry.split(":");
    if (parts.length !== 2) throw new Error("NH_AGENT_ADMISSION_POLICIES must use RecoveryType:threshold entries");
    const recoveryType = parts[0]!.trim();
    const thresholdText = parts[1]!.trim();
    if (!recoveryType || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(recoveryType) || !/^\d+$/.test(thresholdText)) {
      throw new Error("NH_AGENT_ADMISSION_POLICIES contains an invalid entry");
    }
    const economicThresholdMinor = Number(thresholdText);
    if (!Number.isSafeInteger(economicThresholdMinor)) throw new Error("admission threshold must be a safe integer");
    if (policies.has(recoveryType)) throw new Error("NH_AGENT_ADMISSION_POLICIES cannot contain duplicate recovery types");
    policies.set(recoveryType, Object.freeze({ recoveryType, economicThresholdMinor }));
  }
  return policies;
}

export class ConfiguredAgentPolicyProvider implements AgentPolicyProvider {
  private readonly snapshot: AgentPolicySnapshot;

  constructor(config: AgentProcessConfig) {
    this.snapshot = Object.freeze({
      globalEnabled: config.enabled,
      disabledAgents: new Set(config.disabledAgents),
      maxAttempts: config.maxAttempts,
      leaseMs: config.leaseMs,
      retryDelayMs: (attempt: number) => {
        if (!Number.isSafeInteger(attempt) || attempt < 1) {
          throw new Error("attempt must be a positive safe integer");
        }
        return Math.min(config.retryCapMs, config.retryBaseMs * (2 ** (attempt - 1)));
      },
    });
  }

  current(): AgentPolicySnapshot {
    return this.snapshot;
  }
}

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly 'true' or 'false'`);
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !value)) throw new Error("agent configuration lists cannot contain blanks");
  if (new Set(values).size !== values.length) throw new Error("agent configuration lists cannot contain duplicates");
  return values;
}
