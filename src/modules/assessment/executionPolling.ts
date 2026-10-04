// EP-19 · Waiting for a governed execution to settle.
//
// Extracted as a pure function so the rule that matters is testable without a DOM or a clock: A
// TIMEOUT IS NOT A PASS. A screen that polls until it gives up and then shows whatever state it last
// saw would present a queued execution as a result, which is exactly the shape of mistake this whole
// slice exists to prevent — the number on screen must be one the server actually produced.
//
// `failed` is deliberately NOT settled. The runtime retries a failed task, so a worker is probably
// about to pick it up again; treating it as final would tell someone their run is over when it is not,
// and cost them a re-upload they did not need.
import { isSettledState, type AssessmentExecutionView } from "../../data/pilotAssessmentClient";
import type { ExecutionState } from "../../contract/assessmentExecution";

export type PollOutcome =
  /** Reached `completed` or `blocked`. The only outcome a result screen may render. */
  | { readonly kind: "settled"; readonly view: AssessmentExecutionView }
  /** Ran out of attempts. Carries the last state seen, for the message — never for a result. */
  | { readonly kind: "timeout"; readonly attempts: number; readonly lastState: ExecutionState | null }
  /** The read itself failed. Never treated as "still waiting". */
  | { readonly kind: "error"; readonly message: string };

export interface PollOptions {
  /** Maximum reads. Bounded so a stuck worker cannot hold a screen open forever. */
  readonly attempts?: number;
  readonly delayMs?: number;
  /** Injected so tests need no real time and the loop's shape is what is under test. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 40;
const DEFAULT_DELAY_MS = 500;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read until the execution settles, or give up and say so.
 *
 * Reads once before ever sleeping: a run that is already complete must not be made to wait. Does not
 * sleep after the final attempt either — a delay nobody waits on is just a slower failure.
 */
export async function pollUntilSettled(
  read: () => Promise<AssessmentExecutionView>,
  options: PollOptions = {},
): Promise<PollOutcome> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? DEFAULT_DELAY_MS));
  const sleep = options.sleep ?? realSleep;

  let lastState: ExecutionState | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let view: AssessmentExecutionView;
    try {
      view = await read();
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
    lastState = view.state;
    if (isSettledState(view.state)) return { kind: "settled", view };
    if (attempt < attempts) await sleep(delayMs);
  }
  return { kind: "timeout", attempts, lastState };
}

/** What to tell someone whose run did not settle. Never implies a result exists. */
export function timeoutMessage(outcome: Extract<PollOutcome, { kind: "timeout" }>): string {
  const state = outcome.lastState ?? "no state recorded";
  return (
    `The execution had not finished after ${outcome.attempts} checks (last seen: ${state}). ` +
    "It may still be running — this screen stopped waiting, it did not cancel anything. " +
    "No result is shown because none was produced yet."
  );
}
