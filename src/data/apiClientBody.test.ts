import { describe, expect, it, afterEach } from "vitest";
import { apiRequest } from "./apiClient";

// A body-less POST must not claim to be JSON: Fastify rejects an empty body with `content-type:
// application/json` (400 FST_ERR_CTP_EMPTY_JSON_BODY). That broke every body-less governed POST made from
// the browser until the synthetic-demo journey exercised one.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function capture(): { headers: () => Record<string, string>; body: () => unknown } {
  let seen: { headers?: Record<string, string>; body?: unknown } = {};
  globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    seen = { headers: init?.headers, body: init?.body };
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;
  return { headers: () => seen.headers ?? {}, body: () => seen.body };
}

describe("apiRequest · content-type follows the body", () => {
  it("sends no content-type and no body when there is no body", async () => {
    const c = capture();
    await apiRequest("POST", "/x", { actorId: "a@company", role: "operator" }, undefined);
    expect(Object.keys(c.headers()).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(c.body()).toBeUndefined();
  });

  it("sends application/json when there is a body", async () => {
    const c = capture();
    await apiRequest("POST", "/x", { actorId: "a@company", role: "operator" }, { a: 1 });
    expect(c.headers()["content-type"]).toBe("application/json");
    expect(c.body()).toBe('{"a":1}');
  });
});
