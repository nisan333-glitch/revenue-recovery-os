// EP-19 · Waiting for a governed execution — the rules that keep a screen honest.
//
// The one that matters: A TIMEOUT IS NOT A PASS. Everything else here exists to stop a plausible
// shortcut from creeping in later.
import { describe, it, expect, vi } from "vitest";
import { pollUntilSettled, timeoutMessage } from "./executionPolling";
import type { AssessmentExecutionView } from "../../data/pilotAssessmentClient";
import type { ExecutionState } from "../../contract/assessmentExecution";

const view = (state: ExecutionState | null): AssessmentExecutionView =>
  ({ state, executionId: "PAX-" + "0".repeat(32) }) as AssessmentExecutionView;

/** A sleep that records rather than waits, so the loop's shape is what is under test, not the clock. */
function recordingSleep() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

describe("EP-19 · polling settles only on a state the server actually reached", () => {
  it("returns the view once the execution completes", async () => {
    const read = vi.fn<() => Promise<AssessmentExecutionView>>()
      .mockResolvedValueOnce(view("queued"))
      .mockResolvedValueOnce(view("running"))
      .mockResolvedValueOnce(view("completed"));
    const { sleep } = recordingSleep();
    const outcome = await pollUntilSettled(read, { attempts: 5, delayMs: 1, sleep });
    expect(outcome.kind).toBe("settled");
    expect(outcome.kind === "settled" && outcome.view.state).toBe("completed");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("settles on blocked too — a refusal is a finished answer", async () => {
    const outcome = await pollUntilSettled(async () => view("blocked"), { attempts: 3, delayMs: 1 });
    expect(outcome.kind).toBe("settled");
    expect(outcome.kind === "settled" && outcome.view.state).toBe("blocked");
  });

  it("does NOT settle on failed — the runtime retries it, so the run is still in flight", async () => {
    const { slept, sleep } = recordingSleep();
    const outcome = await pollUntilSettled(async () => view("failed"), { attempts: 3, delayMs: 7, sleep });
    expect(outcome.kind).toBe("timeout");
    // Telling someone their run is over while a worker is about to pick it up again costs them a
    // re-upload they did not need.
    expect(slept).toEqual([7, 7]);
  });

  it("gives up rather than presenting an unfinished execution as a result", async () => {
    const outcome = await pollUntilSettled(async () => view("queued"), { attempts: 4, delayMs: 1 });
    expect(outcome.kind).toBe("timeout");
    if (outcome.kind !== "timeout") throw new Error("expected a timeout");
    expect(outcome.attempts).toBe(4);
    expect(outcome.lastState).toBe("queued");
    const message = timeoutMessage(outcome);
    expect(message).toMatch(/had not finished after 4 checks/);
    expect(message).toMatch(/last seen: queued/);
    expect(message).toMatch(/No result is shown because none was produced yet/);
    // It must not claim to have cancelled anything it did not cancel.
    expect(message).toMatch(/stopped waiting, it did not cancel/);
  });

  it("reads once before it ever sleeps, so an already-finished run is not made to wait", async () => {
    const { slept, sleep } = recordingSleep();
    const outcome = await pollUntilSettled(async () => view("completed"), { attempts: 9, delayMs: 500, sleep });
    expect(outcome.kind).toBe("settled");
    expect(slept).toEqual([]);
  });

  it("does not sleep after the final attempt — a delay nobody waits on is a slower failure", async () => {
    const { slept, sleep } = recordingSleep();
    await pollUntilSettled(async () => view("running"), { attempts: 3, delayMs: 5, sleep });
    expect(slept).toEqual([5, 5]);
  });

  it("surfaces a read failure instead of treating it as still waiting", async () => {
    const outcome = await pollUntilSettled(async () => {
      throw new Error("Something went wrong talking to the server. Please try again.");
    }, { attempts: 5, delayMs: 1 });
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.message).toMatch(/talking to the server/);
  });

  it("treats a null state as unsettled — no state recorded is not a result", async () => {
    const outcome = await pollUntilSettled(async () => view(null), { attempts: 2, delayMs: 1 });
    expect(outcome.kind).toBe("timeout");
    expect(timeoutMessage(outcome as Extract<typeof outcome, { kind: "timeout" }>)).toMatch(
      /no state recorded/,
    );
  });

  it("always makes at least one attempt, however the bound is abused", async () => {
    const read = vi.fn(async () => view("completed"));
    await pollUntilSettled(read, { attempts: 0, delayMs: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    await pollUntilSettled(read, { attempts: -5, delayMs: -1 });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
