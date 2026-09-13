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
