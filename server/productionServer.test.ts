// EP-10 · Focused proof that the packaged private-pilot runtime (server/productionServer.ts)
// actually wires the SPA, the governed API under `/api`, and health/readiness onto one
// process the way the pilot needs — not a test of any business rule (those are covered
// elsewhere; this file never asserts on a recovered amount, a Tier, or a Proof shape).
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildProductionApp } from "./productionServer";

const DIST_INDEX = join(__dirname, "..", "dist", "index.html");
// The SPA-serving assertions need a real `npm run build` first, exactly like the existing
// `test:e2e` script already requires (`vite build && node e2e/smoke.mjs`) — this file follows
// the same `describe.skipIf` convention already used for HAS_DB elsewhere in this repo, so the
// portable `npm run test` suite stays green even without a prior build.
const HAS_BUILD = existsSync(DIST_INDEX);

describe("EP-10 · production runtime — /api reaches Fastify, health/ready are reachable", () => {
  let app: ReturnType<typeof buildProductionApp>;

  beforeAll(async () => {
    app = buildProductionApp();
    await app.ready();
  });

  it("GET /health is reachable and reports ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready is reachable and returns a db-status shape (regardless of DB availability)", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect([200, 503]).toContain(res.statusCode);
    expect(res.json()).toHaveProperty("db");
  });

  it("an unauthenticated /api/* call reaches the real governed route (401, not a 404 or html)", async () => {
    // Proves /api/* is actually routed into the Fastify app (actorFromRequest runs and
    // rejects it) rather than being swallowed by the static layer or the SPA fallback.
    const res = await app.inject({ method: "GET", url: "/api/cases/RE-1014/proofs" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("an unknown /api/* route 404s as JSON — the SPA fallback never swallows it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/this-route-does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).not.toMatch(/<!doctype html/i);
  });
});

describe.skipIf(!HAS_BUILD)("EP-10 · production runtime — SPA serving (requires `npm run build` first)", () => {
  let app: ReturnType<typeof buildProductionApp>;

  beforeAll(async () => {
    app = buildProductionApp();
    await app.ready();
  });

  it("GET / serves the built SPA shell", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('<div id="root">');
  });

  it("a missing static asset 404s — the SPA fallback never swallows /assets/*", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/this-file-does-not-exist.js" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(/<!doctype html/i);
  });

  it("an unmatched UI route falls back to the SPA shell (client-side route refresh)", async () => {
    const res = await app.inject({ method: "GET", url: "/queue/some-case-id" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('<div id="root">');
  });
});
