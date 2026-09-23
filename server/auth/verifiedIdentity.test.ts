import { generateKeyPairSync, sign } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createIdentityResolverFromEnvironment, createOidcIdentityResolver } from "./verifiedIdentity";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", alg: "RS256", use: "sig", key_ops: ["verify"] };
const config = {
  issuer: "https://identity.example.test",
  audience: "nh-api",
  jwksUri: "https://identity.example.test/.well-known/jwks.json",
  roleClaim: "nh_role",
  clockSkewSeconds: 0,
  cacheTtlMs: 60_000,
  timeoutMs: 1_000,
};

function token(overrides: Record<string, unknown> = {}, key = privateKey): string {
  const header = encode({ alg: "RS256", kid: "key-1", typ: "JWT" });
  const claims = encode({
    iss: config.issuer,
    aud: config.audience,
    sub: "operator-1",
    nh_role: "operator",
    nh_boundaries: ["tenant-1"],
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), key).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function request(value: string): FastifyRequest {
  return { headers: { authorization: `Bearer ${value}` } } as FastifyRequest;
}

function jwksResponse(keys: unknown[] = [jwk]): typeof fetch {
  return async () => new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("verified OIDC identity", () => {
  it("accepts a valid signed identity", async () => {
    const resolve = createOidcIdentityResolver(config, jwksResponse());
    await expect(resolve(request(token()))).resolves.toEqual({
      actorId: "operator-1",
      role: "operator",
      boundaryIds: ["tenant-1"],
    });
  });

  it("rejects signature, issuer, audience, expiry and role failures", async () => {
    const resolve = createOidcIdentityResolver(config, jwksResponse());
    const good = token();
    const parts = good.split(".");
    parts[2] = `${parts[2]![0] === "A" ? "B" : "A"}${parts[2]!.slice(1)}`;
    await expect(resolve(request(parts.join(".")))).rejects.toThrow(/signature|token/);
    await expect(resolve(request(token({ iss: "https://attacker.test" })))).rejects.toThrow(/issuer/);
    await expect(resolve(request(token({ aud: "other-api" })))).rejects.toThrow(/audience/);
    await expect(resolve(request(token({ exp: 1 })))).rejects.toThrow(/expired/);
    await expect(resolve(request(token({ nh_role: "admin" })))).rejects.toThrow(/role/);
  });

  it("rejects duplicate signing ids, mismatched algorithms and oversized JWKS bodies", async () => {
    await expect(createOidcIdentityResolver(config, jwksResponse([jwk, jwk]))(request(token())))
      .rejects.toThrow(/duplicate/);
    await expect(createOidcIdentityResolver(config, jwksResponse([{ ...jwk, alg: "RS512" }]))(request(token())))
      .rejects.toThrow(/signing key/);
    const hugeFetch: typeof fetch = async () => new Response("x".repeat(1_048_577), { status: 200 });
    await expect(createOidcIdentityResolver(config, hugeFetch)(request(token()))).rejects.toThrow(/too large/);
  });

  it("fails closed when production OIDC configuration is incomplete", () => {
    expect(() => createIdentityResolverFromEnvironment({ NODE_ENV: "production" })).toThrow(/required/);
    expect(() => createIdentityResolverFromEnvironment({
      NODE_ENV: "production", NH_AUTH_MODE: "dev-headers", NH_PRIVATE_PILOT: "true", HOST: "0.0.0.0",
    })).toThrow(/loopback/);
  });

  it("rejects non-canonical subjects", async () => {
    const resolve = createOidcIdentityResolver(config, jwksResponse());
    await expect(resolve(request(token({ sub: " operator-1" })))).rejects.toThrow(/subject/);
  });

  it("requires a bounded, canonical and non-wildcard boundary scope", async () => {
    const resolve = createOidcIdentityResolver(config, jwksResponse());
    await expect(resolve(request(token({ nh_boundaries: undefined })))).rejects.toThrow(/boundary scope/);
    await expect(resolve(request(token({ nh_boundaries: [] })))).rejects.toThrow(/boundary scope/);
    await expect(resolve(request(token({ nh_boundaries: ["tenant-1", "tenant-1"] })))).rejects.toThrow(/duplicate/);
    await expect(resolve(request(token({ nh_boundaries: ["*"] })))).rejects.toThrow(/boundary scope/);
    await expect(resolve(request(token({ nh_boundaries: [" tenant-1"] })))).rejects.toThrow(/boundary scope/);
  });
});

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
