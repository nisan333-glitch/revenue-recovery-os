// A `ModelPort` that answers from a script instead of from a provider.
//
// WHY IT EXISTS. The live port needs a credential this environment does not have, and a sequence that can
// only be exercised with a credential cannot be tested at all. So every guard, every refusal and the whole
// task sequence is proven against this. `implementation` says `stub-...` on every record it produces, so a
// stub run can never be read as a live one — and the status view says so in as many words.
//
// IT IS NOT A SIMULATION OF A MODEL. It replays answers a test author wrote. Nothing it returns is evidence
// about what a real provider would say.

import type { ModelPort, ModelRequest, ModelResponse } from "./modelPort.ts";

export class StubModelPort implements ModelPort {
  readonly implementation = "stub-scripted";
  readonly provider = "stub";
  /** Every request this port was asked to make, in order — so a test can assert it was NOT called. */
  readonly requests: ModelRequest[] = [];
  #queue: ModelResponse[];

  constructor(responses: readonly ModelResponse[]) {
    this.#queue = [...responses];
  }

  get callCount(): number {
    return this.requests.length;
  }

  invoke(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.#queue.shift();
    if (next === undefined) return Promise.resolve({ ok: false, error: "STUB_EXHAUSTED", retryable: false });
    return Promise.resolve(next);
  }
}

/** A well-formed answer in the declared shape. */
export function stubOk(summary: string, notes: readonly string[] = [], tokens = { promptTokens: 100, completionTokens: 50 }): ModelResponse {
  return { ok: true, text: JSON.stringify({ summary, notes }), usage: tokens, providerRequestId: "stub-req" };
}

/** A port that throws rather than returning, to prove the engine does not crash on one. */
export class ThrowingModelPort implements ModelPort {
  readonly implementation = "stub-throwing";
  readonly provider = "stub";
  callCount = 0;
  invoke(): Promise<ModelResponse> {
    this.callCount += 1;
    throw new Error("the port exploded");
  }
}
