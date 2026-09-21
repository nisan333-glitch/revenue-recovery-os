import { describe, expect, it, vi } from "vitest";
import { closeInOrder, installGracefulShutdown } from "./processLifecycle";
import type { AgentProcess } from "./agents/bootstrap";

describe("server process lifecycle", () => {
  it("drains agent claims before closing HTTP", async () => {
    const order: string[] = [];
    const agents: AgentProcess = {
      start: vi.fn(),
      readiness: () => ({ status: "up", configured: 1, running: 1 }),
      stop: async () => { order.push("agents"); },
    };
    const app = { close: async () => { order.push("http"); } };

    await closeInOrder(app as never, agents);
    expect(order).toEqual(["agents", "http"]);
  });

  it("still closes HTTP when agent draining fails", async () => {
    const close = vi.fn(async () => undefined);
    const agents: AgentProcess = {
      start: vi.fn(),
      readiness: () => ({ status: "down", configured: 1, running: 0 }),
      stop: async () => { throw new Error("drain failed"); },
    };

    await expect(closeInOrder({ close } as never, agents)).rejects.toThrow(/drain failed/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("forces a failed exit when graceful draining exceeds its deadline", async () => {
    const listeners = new Map<string, () => void>();
    const exit = vi.fn();
    const runtime = {
      once: (event: string, listener: () => void) => { listeners.set(event, listener); },
      removeListener: (event: string) => { listeners.delete(event); },
      exit,
    };
    const agents: AgentProcess = {
      start: vi.fn(),
      readiness: () => ({ status: "down", configured: 1, running: 0 }),
      stop: () => new Promise<void>(() => undefined),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installGracefulShutdown({ close: vi.fn() } as never, agents, runtime as never, 5);

    listeners.get("SIGTERM")?.();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/exceeded/) }));
    error.mockRestore();
  });
});
