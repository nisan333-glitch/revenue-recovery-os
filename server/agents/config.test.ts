import { describe, expect, it } from "vitest";
import { ConfiguredAgentPolicyProvider, parseAgentProcessConfig } from "./config";

describe("agent process configuration", () => {
  it("defaults to disabled with bounded operational values", () => {
    const config = parseAgentProcessConfig({});
    expect(config).toMatchObject({
      enabled: false,
      boundaryIds: [],
      idleDelayMs: 1_000,
      maxAttempts: 3,
      leaseMs: 30_000,
      admissionPolicies: new Map(),
    });
  });

  it("fails closed when enabled without an explicit boundary", () => {
    expect(() => parseAgentProcessConfig({ NH_AGENTS_ENABLED: "true" })).toThrow(/boundaries/i);
  });

  it("rejects ambiguous booleans, duplicate scopes and unsafe bounds", () => {
    expect(() => parseAgentProcessConfig({ NH_AGENTS_ENABLED: "yes" })).toThrow(/true.*false/i);
    expect(() => parseAgentProcessConfig({ NH_AGENT_BOUNDARIES: "a,a" })).toThrow(/duplicates/i);
    expect(() => parseAgentProcessConfig({ NH_AGENT_LEASE_MS: "100" })).toThrow(/between/i);
    expect(() => parseAgentProcessConfig({
      NH_AGENT_RETRY_BASE_MS: "1000",
      NH_AGENT_RETRY_CAP_MS: "100",
    })).toThrow(/greater than/i);
  });

  it("creates an immutable policy with capped exponential retry", () => {
    const config = parseAgentProcessConfig({
      NH_AGENTS_ENABLED: "true",
      NH_AGENT_BOUNDARIES: "tenant-1,tenant-2",
      NH_DISABLED_AGENTS: "renewal-detector",
      NH_AGENT_RETRY_BASE_MS: "100",
      NH_AGENT_RETRY_CAP_MS: "250",
    });
    const policy = new ConfiguredAgentPolicyProvider(config).current();
    expect(policy.globalEnabled).toBe(true);
    expect(policy.disabledAgents.has("renewal-detector")).toBe(true);
    expect([1, 2, 3, 4].map(policy.retryDelayMs)).toEqual([100, 200, 250, 250]);
  });

  it("parses explicit per-recovery admission thresholds", () => {
    const config = parseAgentProcessConfig({
      NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:10000,RenewalAtRisk:50000",
    });
    expect([...config.admissionPolicies.entries()]).toEqual([
      ["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }],
      ["RenewalAtRisk", { recoveryType: "RenewalAtRisk", economicThresholdMinor: 50_000 }],
    ]);
  });

  it("rejects malformed or duplicate admission policies", () => {
    expect(() => parseAgentProcessConfig({ NH_AGENT_ADMISSION_POLICIES: "ActivationMissed" })).toThrow(/format|entries/);
    expect(() => parseAgentProcessConfig({ NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:-1" })).toThrow(/invalid/);
    expect(() => parseAgentProcessConfig({ NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:1,ActivationMissed:2" }))
      .toThrow(/duplicate/);
  });
});
