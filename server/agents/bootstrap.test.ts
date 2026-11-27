import { describe, expect, it, vi } from "vitest";
import { createAgentProcess, createAgentProcessFromEnvironment } from "./bootstrap";
import type { AgentHandler } from "./types";

const handler: AgentHandler = { agentId: "detector", run: async () => [] };

describe("agent process bootstrap", () => {
  it("is inert and ready-as-disabled by default", () => {
    const process = createAgentProcessFromEnvironment({}, []);
    process.start();
    expect(process.readiness()).toEqual({ status: "disabled", configured: 0, running: 0 });
  });

  it("refuses an enabled deployment without a real registered handler", () => {
    expect(() => createAgentProcessFromEnvironment({
      NH_AGENTS_ENABLED: "true",
      NH_AGENT_BOUNDARIES: "tenant-1",
    }, [])).toThrow(/no production agent handlers/i);
  });

  it("refuses an enabled handler set without an admission policy registry", () => {
    expect(() => createAgentProcessFromEnvironment({
      NH_AGENTS_ENABLED: "true",
      NH_AGENT_BOUNDARIES: "tenant-1",
    }, [handler])).toThrow(/admission policies/i);
  });

  it("constructs one scoped serial worker per handler and boundary", async () => {
    const runNext = vi.fn(async () => null);
    const process = createAgentProcess({
      enabled: true,
      boundaryIds: ["tenant-1", "tenant-2"],
      handlers: [handler],
      runtime: { runNext },
      idleDelayMs: 60_000,
      errorDelayMs: () => 60_000,
      instanceId: "instance-1",
    });

    process.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(process.readiness()).toEqual({ status: "up", configured: 2, running: 2 });
    expect(runNext).toHaveBeenCalledTimes(2);
    expect(runNext.mock.calls.map((call) => call.slice(1))).toEqual([
      ["instance-1:tenant-1:detector", "tenant-1"],
      ["instance-1:tenant-2:detector", "tenant-2"],
    ]);
    await process.stop();
    expect(process.readiness()).toEqual({ status: "down", configured: 2, running: 0 });
  });

  it("rejects duplicate agent registrations", () => {
    expect(() => createAgentProcess({
      enabled: true,
      boundaryIds: ["tenant-1"],
      handlers: [handler, handler],
      runtime: { runNext: async () => null },
      idleDelayMs: 1,
      errorDelayMs: () => 1,
      instanceId: "instance-1",
    })).toThrow(/unique/i);
  });
});

// ── THE MASTER SWITCH · the one Tier A variable that used to fail silently ────────────────────────
//
// Measured by `scripts/pilot-config/verify-config-chain.mjs`: four of the five variables a detecting
// deployment needs refuse at startup; `NH_AGENTS_ENABLED` did not. Dropping it left the service
// listening with `/health` 200 and no detection runtime at all.
describe("NH_AGENTS_ENABLED · a detector enabled while the runtime is off", () => {
  it("refuses the contradiction, and names the detectors that would never run", () => {
    expect(() => createAgentProcessFromEnvironment({ NH_AGENT_BOUNDARIES: "tenant-1" }, [handler]))
      .toThrow(/NH_AGENTS_ENABLED is not true/);
    expect(() => createAgentProcessFromEnvironment({ NH_AGENT_BOUNDARIES: "tenant-1" }, [handler]))
      .toThrow(/detector/);
  });

  it("refuses it for an EXPLICIT false as well, not only for an absent value", () => {
    // `parseBoolean` defaults to false, so absent and `"false"` reach the same state — and an operator
    // who wrote `false` while leaving a detector on has made the same mistake.
    expect(() => createAgentProcessFromEnvironment(
      { NH_AGENTS_ENABLED: "false", NH_AGENT_BOUNDARIES: "tenant-1" }, [handler],
    )).toThrow(/NH_AGENTS_ENABLED is not true/);
  });

  // ── BACKWARD COMPATIBILITY · every coherent configuration is untouched ──────────────────────────
  it("everything off is still inert and still ready-as-disabled", () => {
    // THE CASE THAT MUST NOT MOVE. A deployment that runs no detectors at all is the common one, and
    // it has no handlers, so the new guard cannot see it.
    const p = createAgentProcessFromEnvironment({}, []);
    p.start();
    expect(p.readiness()).toEqual({ status: "disabled", configured: 0, running: 0 });
  });

  it("a fully enabled deployment CONSTRUCTS, which is the property the guard could have broken", () => {
    // NOT an assertion about readiness. A process that is constructed and never started reads `down`
    // — configured, nothing running — and asserting otherwise was my own misreading of the product
    // rather than a defect in it. What the new guard could plausibly have broken is CONSTRUCTION, so
    // that is what is asserted.
    expect(() => createAgentProcessFromEnvironment({
      NH_AGENTS_ENABLED: "true",
      NH_AGENT_BOUNDARIES: "tenant-1",
      NH_AGENT_ADMISSION_POLICIES: "RevenueUnderBilled:1",
    }, [handler])).not.toThrow();
  });

  it("the ORIGINAL guard still fires — the mirror did not replace it", () => {
    // A guard added beside another must be shown not to have displaced it: enabled with no handler is
    // still a refusal, and with its own message.
    expect(() => createAgentProcessFromEnvironment({
      NH_AGENTS_ENABLED: "true", NH_AGENT_BOUNDARIES: "tenant-1",
    }, [])).toThrow(/no production agent handlers/i);
  });
});
