import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { fixtureVerifier } from "../test/sourceFixture";
import { assertTransportContract, isHttpsForwarded, transportModeFromEnvironment } from "./transportGuard";

describe("transport contract — start-up", () => {
  it("is not enforced outside production", () => {
    expect(() => assertTransportContract({})).not.toThrow();
    expect(() => assertTransportContract({ NODE_ENV: "test", NH_AUTH_MODE: "oidc" })).not.toThrow();
  });

  it("production OIDC must declare TLS termination; plain HTTP cannot be expressed", () => {
    expect(() => assertTransportContract({ NODE_ENV: "production" })).toThrow(/TLS termination/);
    expect(() => assertTransportContract({ NODE_ENV: "production", NH_TLS_TERMINATION: "none" })).toThrow(/TLS termination/);
    expect(() => assertTransportContract({ NODE_ENV: "production", NH_AUTH_MODE: "oidc", NH_PRIVATE_PILOT: "true" })).toThrow(/TLS termination/);
    expect(() => assertTransportContract({ NODE_ENV: "production", NH_TLS_TERMINATION: "proxy" })).not.toThrow();
  });

  it("plain HTTP is allowed only for the supervised dev-header private pilot", () => {
    expect(() => assertTransportContract({ NODE_ENV: "production", NH_AUTH_MODE: "dev-headers", NH_PRIVATE_PILOT: "true" })).not.toThrow();
    expect(() => assertTransportContract({ NODE_ENV: "production", NH_AUTH_MODE: "dev-headers" })).toThrow(/TLS termination/);
  });

  it("rejects an unknown value", () => {
    expect(() => transportModeFromEnvironment({ NH_TLS_TERMINATION: "yes" })).toThrow(/'proxy' or 'none'/);
    expect(transportModeFromEnvironment({})).toBe("private-plaintext");
    expect(transportModeFromEnvironment({ NH_TLS_TERMINATION: "proxy" })).toBe("proxy-tls");
  });

  it("accepts exactly one forwarded protocol value, https", () => {
    expect(isHttpsForwarded("https")).toBe(true);
    expect(isHttpsForwarded(" HTTPS ")).toBe(true);
    for (const v of ["http", "https, http", "http, https", "", undefined, ["https"]]) expect(isHttpsForwarded(v), String(v)).toBe(false);
  });
});

describe("transport contract — per request behind a TLS-terminating proxy", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier, syntheticDemo: null, transport: "proxy-tls" });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("refuses a request that did not arrive over HTTPS, before any handler", async () => {
    for (const headers of [{}, { "x-forwarded-proto": "http" }, { "x-forwarded-proto": "https, http" }]) {
      const res = await app.inject({ method: "GET", url: "/auth/config", headers });
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
      expect(res.json().error).toBe("forbidden");
    }
    expect((await app.inject({ method: "GET", url: "/api/auth/config" })).statusCode).toBe(403);
  });

  it("serves HTTPS requests with HSTS", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/config", headers: { "x-forwarded-proto": "https" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=31536000/);
  });

  it("leaves the liveness probes reachable from inside the network", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });
});

describe("transport contract — private plaintext pilot", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier, syntheticDemo: null, transport: "private-plaintext" });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });
  it("does not claim HSTS it cannot back", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/config" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });
});
