// Negative / integration tests for the AUTHENTICATION BOUNDARY of the real Fastify app: no database needed,
// because every case below is decided (and refused) before any persistence is touched.
//   - production-style OIDC mode: unauthenticated, forged-header, tampered/expired/wrong-audience tokens,
//     wrong role, privilege escalation by header, wildcard / missing boundary scope;
//   - dev-header mode: refused for forwarded, non-loopback-Host and public-peer requests.
import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { fixtureVerifier } from "../test/sourceFixture";
import { createOidcIdentityResolver } from "./verifiedIdentity";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", alg: "RS256", use: "sig", key_ops: ["verify"] };
const config = {
  issuer: "https://identity.example.test", audience: "nh-api",
  jwksUri: "https://identity.example.test/.well-known/jwks.json",
  roleClaim: "nh_role", boundaryClaim: "nh_boundaries",
  clockSkewSeconds: 0, cacheTtlMs: 60_000, timeoutMs: 1_000,
};
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function token(overrides: Record<string, unknown> = {}, opts: { key?: typeof privateKey; header?: Record<string, unknown> } = {}): string {
  const header = enc({ alg: "RS256", kid: "key-1", typ: "JWT", ...opts.header });
  const claims = enc({
    iss: config.issuer, aud: config.audience, sub: "operator-1", nh_role: "operator", nh_boundaries: ["tenant-1"],
    exp: Math.floor(Date.now() / 1000) + 300, ...overrides,
  });
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), opts.key ?? privateKey).toString("base64url");
  return `${header}.${claims}.${sig}`;
}
const without = (claim: string): string => {
  const base: Record<string, unknown> = { iss: config.issuer, aud: config.audience, sub: "operator-1", nh_role: "operator", nh_boundaries: ["tenant-1"], exp: Math.floor(Date.now() / 1000) + 300 };
  delete base[claim];
  const header = enc({ alg: "RS256", kid: "key-1", typ: "JWT" });
  const claims = enc(base);
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url")}`;
};

const jwksFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("OIDC mode — authentication boundary of the real app", () => {
  const app = buildApp({
    sourceVerifier: fixtureVerifier,
    identityResolver: createOidcIdentityResolver(config, jwksFetch),
    syntheticDemo: null,
  });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  const whoami = (headers: Record<string, string> = {}, remoteAddress?: string) =>
    app.inject({ method: "GET", url: "/auth/whoami", headers, ...(remoteAddress ? { remoteAddress } : {}) });

  it("accepts a valid token and reports the SERVER's reading of it", async () => {
    const res = await whoami(bearer(token()));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actorId: "operator-1", role: "operator", boundaryIds: ["tenant-1"] });
  });

  it("unauthenticated requests are 401 on identity and on protected routes", async () => {
    expect((await whoami()).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/recovery-cases/RC-1" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/synthetic-demo/status" })).statusCode).toBe(401);
  });

  it("forged dev headers are IGNORED under OIDC, even from loopback and with no token", async () => {
    const forged = { "x-actor-id": "attacker@evil", "x-actor-role": "steward" };
    expect((await whoami(forged)).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/recovery-cases/RC-1", headers: forged })).statusCode).toBe(401);
  });

  it("PRIVILEGE ESCALATION by header: a valid operator token plus x-actor-role: steward stays an operator", async () => {
    const res = await whoami({ ...bearer(token()), "x-actor-id": "root@company", "x-actor-role": "steward" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ actorId: "operator-1", role: "operator" });
  });

  it("PRIVILEGE ESCALATION by claim: unknown roles are refused, not mapped", async () => {
    for (const role of ["admin", "root", "Steward", "steward ", "", null, 1, ["steward"]]) {
      expect((await whoami(bearer(token({ nh_role: role })))).statusCode, JSON.stringify(role)).toBe(401);
    }
    expect((await whoami(bearer(without("nh_role")))).statusCode).toBe(401);
  });

  it("WRONG ROLE: an operator cannot read oversight surfaces (AuditRead) — 403, before any lookup", async () => {
    const res = await app.inject({ method: "GET", url: "/recovery-cases/RC-1", headers: bearer(token()) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
  });

  it("wildcard, missing, empty or malformed boundary scope is refused", async () => {
    for (const nh_boundaries of [["*"], [], ["tenant-1", "*"], ["tenant-1", "tenant-1"], "tenant-1", null, [" tenant-1"], [""]]) {
      expect((await whoami(bearer(token({ nh_boundaries })))).statusCode, JSON.stringify(nh_boundaries)).toBe(401);
    }
    expect((await whoami(bearer(without("nh_boundaries")))).statusCode).toBe(401);
  });

  it("rejects tampered, foreign-key, expired, not-yet-valid, wrong-issuer and wrong-audience tokens", async () => {
    const good = token();
    const [h, p, s] = good.split(".");
    const forgedClaims = enc({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), nh_role: "steward" });
    expect((await whoami(bearer(`${h}.${forgedClaims}.${s}`))).statusCode).toBe(401); // payload swapped, signature kept
    expect((await whoami(bearer(token({}, { key: other.privateKey })))).statusCode).toBe(401); // signed by a stranger
    expect((await whoami(bearer(token({ exp: 1 })))).statusCode).toBe(401);
    expect((await whoami(bearer(token({ nbf: Math.floor(Date.now() / 1000) + 3600 })))).statusCode).toBe(401);
    expect((await whoami(bearer(token({ iss: "https://attacker.test" })))).statusCode).toBe(401);
    expect((await whoami(bearer(token({ aud: "someone-else" })))).statusCode).toBe(401);
    expect((await whoami(bearer(without("exp")))).statusCode).toBe(401);
    expect((await whoami(bearer(without("sub")))).statusCode).toBe(401);
  });

  it("rejects alg=none, symmetric and unknown-kid tokens and malformed Authorization headers", async () => {
    const claims = enc({ iss: config.issuer, aud: config.audience, sub: "x", nh_role: "steward", nh_boundaries: ["t"], exp: Math.floor(Date.now() / 1000) + 300 });
    expect((await whoami(bearer(`${enc({ alg: "none", kid: "key-1" })}.${claims}.`))).statusCode).toBe(401);
    expect((await whoami(bearer(`${enc({ alg: "HS256", kid: "key-1" })}.${claims}.AAAA`))).statusCode).toBe(401);
    expect((await whoami(bearer(token({}, { header: { kid: "unknown" } })))).statusCode).toBe(401);
    expect((await whoami({ authorization: `bearer ${token()}` })).statusCode).toBe(401);
    expect((await whoami({ authorization: `Basic ${Buffer.from("a:b").toString("base64")}` })).statusCode).toBe(401);
    expect((await whoami({ authorization: "Bearer " })).statusCode).toBe(401);
    expect((await whoami({ authorization: `Bearer ${"a".repeat(20_000)}` })).statusCode).toBe(401);
  });

  it("a token in the query string is not an identity", async () => {
    const res = await app.inject({ method: "GET", url: `/auth/whoami?access_token=${token()}` });
    expect(res.statusCode).toBe(401);
  });

  it("an unreachable key service fails closed (401), never open", async () => {
    const down = buildApp({
      sourceVerifier: fixtureVerifier, syntheticDemo: null,
      identityResolver: createOidcIdentityResolver(config, async () => { throw new Error("offline"); }),
    });
    await down.ready();
    const res = await down.inject({ method: "GET", url: "/auth/whoami", headers: bearer(token()) });
    expect(res.statusCode).toBe(401);
    await down.close();
  });

  it("/auth/config is public, carries no secrets and never reflects request input", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/config?client_secret=LEAK", headers: { "x-actor-id": "LEAK" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("LEAK");
    expect(res.body).not.toMatch(/secret|password|private/i);
  });

  it("every response is non-cacheable and carries the hardening headers", async () => {
    const res = await whoami(bearer(token()));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(String(res.headers["content-security-policy"])).toContain("script-src 'self'");
  });
});

describe("dev-header mode — fail closed outside a local client", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier, syntheticDemo: null });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });
  const dev = { "x-actor-id": "dana@company", "x-actor-role": "operator" };
  const call = (headers: Record<string, string>, remoteAddress?: string) =>
    app.inject({ method: "GET", url: "/auth/whoami", headers, ...(remoteAddress ? { remoteAddress } : {}) });

  it("serves a genuinely local client", async () => {
    const res = await call({ ...dev, host: "127.0.0.1:4000" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ actorId: "dana@company", role: "operator" });
  });

  it("refuses a proxied request (forwarding headers)", async () => {
    expect((await call({ ...dev, "x-forwarded-for": "203.0.113.9" })).statusCode).toBe(401);
    expect((await call({ ...dev, "x-forwarded-proto": "https" })).statusCode).toBe(401);
    expect((await call({ ...dev, forwarded: "for=203.0.113.9" })).statusCode).toBe(401);
  });

  it("refuses a public Host header and a public peer address", async () => {
    expect((await call({ ...dev, host: "app.example.com" })).statusCode).toBe(401);
    expect((await call({ ...dev, host: "localhost:4000" }, "203.0.113.9")).statusCode).toBe(401);
  });

  it("refuses incomplete or invalid dev credentials", async () => {
    expect((await call({})).statusCode).toBe(401);
    expect((await call({ "x-actor-id": "dana@company" })).statusCode).toBe(401);
    expect((await call({ "x-actor-id": "dana@company", "x-actor-role": "admin" })).statusCode).toBe(401);
  });
});
