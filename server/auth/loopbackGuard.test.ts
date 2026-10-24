import { describe, expect, it } from "vitest";
import {
  assertDevHeadersBindSafe, assertLoopbackOnlyRequest, hostWithoutPort, isLoopbackHostHeader, isPrivateOrLoopbackAddress,
} from "./loopbackGuard";

const req = (headers: Record<string, string>, remoteAddress: string | null = "127.0.0.1") =>
  ({ headers, socket: { remoteAddress: remoteAddress ?? undefined } }) as unknown as Parameters<typeof assertLoopbackOnlyRequest>[0];

describe("dev-header identity — per-request loopback rule", () => {
  it("accepts a local client", () => {
    expect(() => assertLoopbackOnlyRequest(req({ host: "localhost:4000" }))).not.toThrow();
    expect(() => assertLoopbackOnlyRequest(req({ host: "127.0.0.1:4000" }, "::ffff:127.0.0.1"))).not.toThrow();
    expect(() => assertLoopbackOnlyRequest(req({ host: "[::1]:4000" }, "::1"))).not.toThrow();
    // Docker's published-port NAT presents the bridge gateway as the peer.
    expect(() => assertLoopbackOnlyRequest(req({ host: "127.0.0.1:4000" }, "172.18.0.1"))).not.toThrow();
  });

  it("refuses a public Host header", () => {
    expect(() => assertLoopbackOnlyRequest(req({ host: "app.example.com" }))).toThrow(/local private-pilot/);
    expect(() => assertLoopbackOnlyRequest(req({ host: "localhost.evil.example" }))).toThrow(/local private-pilot/);
    expect(() => assertLoopbackOnlyRequest(req({}))).toThrow(/local private-pilot/);
  });

  it.each(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip"])(
    "refuses any request carrying %s (the signature of a proxied, publicly reachable service)",
    (name) => {
      expect(() => assertLoopbackOnlyRequest(req({ host: "localhost:4000", [name]: "203.0.113.9" }))).toThrow(/local private-pilot/);
    },
  );

  it("refuses a public peer address even when Host claims localhost", () => {
    expect(() => assertLoopbackOnlyRequest(req({ host: "localhost:4000" }, "203.0.113.9"))).toThrow(/local private-pilot/);
    expect(() => assertLoopbackOnlyRequest(req({ host: "localhost:4000" }, "2001:db8::1"))).toThrow(/local private-pilot/);
    expect(() => assertLoopbackOnlyRequest(req({ host: "localhost:4000" }, null))).toThrow(/local private-pilot/);
  });

  it("classifies addresses", () => {
    for (const a of ["127.0.0.1", "127.9.9.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "::1", "::ffff:10.0.0.1", "fd00::1", "fe80::1"]) {
      expect(isPrivateOrLoopbackAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "203.0.113.9", "256.1.1.1", "2001:db8::1", "", undefined, 42]) {
      expect(isPrivateOrLoopbackAddress(a), String(a)).toBe(false);
    }
  });

  it("parses host headers", () => {
    expect(hostWithoutPort("LocalHost:4000")).toBe("localhost");
    expect(hostWithoutPort("[::1]:4000")).toBe("[::1]");
    expect(isLoopbackHostHeader("127.0.0.1:1")).toBe(true);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
    expect(isLoopbackHostHeader("0.0.0.0")).toBe(false);
  });
});

describe("dev-header identity — start-up bind rule (independent of NODE_ENV and NH_PRIVATE_PILOT)", () => {
  it("allows loopback, including the default", () => {
    expect(() => assertDevHeadersBindSafe({})).not.toThrow();
    expect(() => assertDevHeadersBindSafe({ HOST: "127.0.0.1" })).not.toThrow();
    expect(() => assertDevHeadersBindSafe({ HOST: "localhost" })).not.toThrow();
    expect(() => assertDevHeadersBindSafe({ HOST: "::1" })).not.toThrow();
  });

  it("refuses 0.0.0.0 and any public bind unless BOTH container flags are set", () => {
    expect(() => assertDevHeadersBindSafe({ HOST: "0.0.0.0" })).toThrow(/NH_AUTH_MODE=oidc/);
    expect(() => assertDevHeadersBindSafe({ HOST: "0.0.0.0", NH_PRIVATE_PILOT: "true" })).toThrow(/NH_AUTH_MODE=oidc/);
    expect(() => assertDevHeadersBindSafe({ HOST: "0.0.0.0", NH_TRUST_CONTAINER_NETWORK: "true" })).toThrow(/NH_AUTH_MODE=oidc/);
    expect(() => assertDevHeadersBindSafe({ HOST: "203.0.113.9", NH_PRIVATE_PILOT: "true", NH_TRUST_CONTAINER_NETWORK: "true" })).toThrow();
    expect(() => assertDevHeadersBindSafe({ HOST: "app.example.com", NH_PRIVATE_PILOT: "true", NH_TRUST_CONTAINER_NETWORK: "true" })).toThrow();
    expect(() => assertDevHeadersBindSafe({ HOST: "0.0.0.0", NH_PRIVATE_PILOT: "true", NH_TRUST_CONTAINER_NETWORK: "true" })).not.toThrow();
  });
});
