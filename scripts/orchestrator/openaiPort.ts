// The live OpenAI implementation of `ModelPort`.
//
// WHY IT IS ITS OWN FILE. Everything else in this directory is pure and testable with no credential and no
// network. This file is the only one that speaks HTTP, so the engine can be exercised end to end against a
// stub and this module is the single place a credential is read.
//
// THE CREDENTIAL NEVER LEAVES THIS MODULE. It is read from the environment at construction, held in a closure,
// and placed only in an outgoing Authorization header. It is not returned, not logged, not put on a record,
// and not included in an error message: a failure reports the HTTP status and the provider's own message, and
// `redactedKeyHint` exists so a human can tell WHICH key is configured without the value being printed.
//
// AND IT IS NOT THE OWNER'S CHATGPT. This calls a model over an API. It has no access to, and no connection
// with, the owner's personal ChatGPT conversation: it cannot read it, cannot post to it, and cannot wake it.
// Anything that claimed otherwise would be false. `channel` is `openai-api` on every record for this reason.

import type { ModelPort, ModelRequest, ModelResponse } from "./modelPort.ts";

export const OPENAI_HOST = "api.openai.com";
export const OPENAI_URL = `https://${OPENAI_HOST}/v1/chat/completions`;
export const OPENAI_KEY_ENV = "OPENAI_API_KEY";

export interface OpenAiPortOptions {
  /** The credential. Read from the environment by `openAiPortFromEnv`; never defaulted to a literal. */
  apiKey: string;
  /** Injected so the module can be tested without a real network. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OpenAiModelPort implements ModelPort {
  readonly implementation = "openai-chat-completions";
  readonly provider = "openai";
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: OpenAiPortOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.trim().length === 0) {
      throw new Error(`${OPENAI_KEY_ENV} is empty; refusing to construct a port with no credential`);
    }
    this.#apiKey = options.apiKey;
    const f = options.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") throw new Error("no fetch implementation is available");
    this.#fetch = f;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** A hint a human can read without the value: length and last four characters only. */
  redactedKeyHint(): string {
    return `len=${this.#apiKey.length} …${this.#apiKey.slice(-4)}`;
  }

  async invoke(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          // The one place the credential is used. It is never put anywhere else.
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          // The provider is asked for the declared JSON shape `readModelOutput` requires. If it answers with
          // anything else the reading REFUSES it, so this is a request and never a guarantee.
          messages: [
            {
              role: "system",
              content:
                "Answer with a single JSON object and nothing else: " +
                '{"summary": "<one paragraph>", "notes": ["<short point>", ...]}. ' +
                "No prose outside the JSON.",
            },
            { role: "user", content: request.prompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          // Status and the provider's own message only. No header, no credential, no request body.
          error: `PROVIDER_HTTP_${res.status}: ${body.slice(0, 500)}`,
          retryable: res.status === 429 || res.status >= 500,
        };
      }
      const json = (await res.json()) as unknown;
      const obj = (json ?? {}) as Record<string, unknown>;
      const choices = Array.isArray(obj.choices) ? obj.choices : [];
      const first = (choices[0] ?? {}) as Record<string, unknown>;
      const message = (first.message ?? {}) as Record<string, unknown>;
      const text = typeof message.content === "string" ? message.content : null;
      if (text === null) return { ok: false, error: "PROVIDER_NO_CONTENT", retryable: false };
      const u = (obj.usage ?? null) as Record<string, unknown> | null;
      const usage =
        u !== null && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number"
          ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
          : null;
      return {
        ok: true,
        text,
        usage,
        providerRequestId: typeof obj.id === "string" ? obj.id : null,
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `TRANSPORT_${name}: ${msg.slice(0, 300)}`, retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type PortAvailability =
  | { available: true; port: OpenAiModelPort }
  | { available: false; reason: string; remedy: string };

/**
 * Build the live port from the environment, or say precisely why it cannot be built.
 *
 * Returns a reason rather than throwing, because "no credential" is the expected state of this repository
 * today and the caller's job is to report it, not to crash. The remedy is stated so the report says what to
 * do rather than that something is missing.
 */
export function openAiPortFromEnv(env: Record<string, string | undefined>): PortAvailability {
  const key = env[OPENAI_KEY_ENV];
  if (typeof key !== "string" || key.trim().length === 0) {
    return {
      available: false,
      reason: `NO_CREDENTIAL: ${OPENAI_KEY_ENV} is not set in this environment`,
      remedy:
        `Add a network secret for ${OPENAI_HOST} to this environment. Saving it also opens the host, ` +
        "so no allowlist change is needed. The value is never written to a file, a record, a log line or a " +
        "GitHub comment. Only the owner may make this change.",
    };
  }
  try {
    return { available: true, port: new OpenAiModelPort({ apiKey: key }) };
  } catch (err) {
    return {
      available: false,
      reason: `PORT_CONSTRUCTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
      remedy: "Check that the configured credential is a non-empty string.",
    };
  }
}
