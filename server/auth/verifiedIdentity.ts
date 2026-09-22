import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "../http/errors";
import { assertPrivatePilotHost } from "../persistence/databaseConfig";
import { actorFromRequest, type IdentityResolver } from "./actorContext";
import { isBackendRole, type ActorContext } from "./identity";

const MAX_TOKEN_BYTES = 16_384;
const MAX_JWKS_BYTES = 1_048_576;
const ALGORITHMS = Object.freeze({ RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512" });

interface OidcConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  roleClaim: string;
  boundaryClaim?: string;
  clockSkewSeconds: number;
  cacheTtlMs: number;
  timeoutMs: number;
}

interface JwtHeader { alg?: unknown; kid?: unknown; typ?: unknown }
interface JwtClaims { iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; nbf?: unknown; [key: string]: unknown }
interface Jwk { kty?: unknown; kid?: unknown; alg?: unknown; use?: unknown; key_ops?: unknown; [key: string]: unknown }

export function createIdentityResolverFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
): IdentityResolver {
  const mode = env.NH_AUTH_MODE?.trim() || (env.NODE_ENV === "production" ? "oidc" : "dev-headers");
  if (mode === "dev-headers") {
    if (env.NODE_ENV === "production") {
      if (env.NH_PRIVATE_PILOT !== "true") throw new Error("dev-header identity is forbidden in production");
      assertPrivatePilotHost(env);
    }
    return async (request) => actorFromRequest(request);
  }
  if (mode !== "oidc") throw new Error("NH_AUTH_MODE must be 'oidc' or 'dev-headers'");
  return createOidcIdentityResolver(readOidcConfig(env), fetchImpl);
}

export function createOidcIdentityResolver(config: OidcConfig, fetchImpl: typeof fetch = fetch): IdentityResolver {
  let cached: { expiresAt: number; keys: Map<string, { key: KeyObject; alg?: string }> } | null = null;

  const loadKeys = async (force = false) => {
    if (!force && cached && cached.expiresAt > Date.now()) return cached.keys;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(config.jwksUri, {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new UnauthorizedError("identity key service is unavailable");
      const declared = response.headers.get("content-length");
      if (declared && Number(declared) > MAX_JWKS_BYTES) throw new UnauthorizedError("identity key set is too large");
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_JWKS_BYTES) throw new UnauthorizedError("identity key set is too large");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new UnauthorizedError("identity key set is invalid"); }
      const values = (parsed as { keys?: unknown })?.keys;
      if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
        throw new UnauthorizedError("identity key set is invalid");
      }
      const keys = new Map<string, { key: KeyObject; alg?: string }>();
      for (const raw of values) {
        const jwk = raw as Jwk;
        if (jwk.kty !== "RSA" || typeof jwk.kid !== "string" || !jwk.kid.trim()) continue;
        if (jwk.use !== undefined && jwk.use !== "sig") continue;
        if (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify"))) continue;
        if (jwk.alg !== undefined && (typeof jwk.alg !== "string" || !(jwk.alg in ALGORITHMS))) continue;
        if (keys.has(jwk.kid)) throw new UnauthorizedError("identity key set contains duplicate ids");
        try {
          keys.set(jwk.kid, {
            key: createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]),
            alg: jwk.alg as string | undefined,
          });
        } catch { throw new UnauthorizedError("identity key set is invalid"); }
      }
      if (keys.size === 0) throw new UnauthorizedError("identity key set has no usable signing keys");
      cached = { keys, expiresAt: Date.now() + config.cacheTtlMs };
      return keys;
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError("identity verification is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  };

  return async (request: FastifyRequest): Promise<ActorContext> => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new UnauthorizedError("Bearer authentication required");
    }
    const token = authorization.slice(7);
    if (!token || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) throw new UnauthorizedError("invalid bearer token");
    const parts = token.split(".");
    if (parts.length !== 3) throw new UnauthorizedError("invalid bearer token");
    const header = parseSegment<JwtHeader>(parts[0]!);
    const claims = parseSegment<JwtClaims>(parts[1]!);
    if (typeof header.alg !== "string" || !(header.alg in ALGORITHMS) || typeof header.kid !== "string") {
      throw new UnauthorizedError("unsupported bearer token");
    }
    let keys = await loadKeys();
    let entry = keys.get(header.kid);
    if (!entry) {
      keys = await loadKeys(true);
      entry = keys.get(header.kid);
    }
    if (!entry || (entry.alg && entry.alg !== header.alg)) throw new UnauthorizedError("unknown signing key");
    const valid = verifySignature(
      ALGORITHMS[header.alg as keyof typeof ALGORITHMS],
      Buffer.from(`${parts[0]}.${parts[1]}`),
      entry.key,
      decodeBase64Url(parts[2]!),
    );
    if (!valid) throw new UnauthorizedError("invalid bearer token signature");
    validateClaims(claims, config);
    const actorId = claims.sub as string;
    const role = claims[config.roleClaim];
    if (!isBackendRole(role)) throw new UnauthorizedError("token has no valid NH role");
    const boundaryIds = parseBoundaryClaim(claims[config.boundaryClaim ?? "nh_boundaries"]);
    return Object.freeze({ actorId, role, boundaryIds });
  };
}

function readOidcConfig(env: Readonly<Record<string, string | undefined>>): OidcConfig {
  const issuer = requireHttpsUrl("NH_OIDC_ISSUER", env.NH_OIDC_ISSUER);
  const jwksUri = requireHttpsUrl("NH_OIDC_JWKS_URI", env.NH_OIDC_JWKS_URI);
  const audience = required("NH_OIDC_AUDIENCE", env.NH_OIDC_AUDIENCE);
  const roleClaim = env.NH_OIDC_ROLE_CLAIM?.trim() || "nh_role";
  const boundaryClaim = env.NH_OIDC_BOUNDARY_CLAIM?.trim() || "nh_boundaries";
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(roleClaim)) throw new Error("NH_OIDC_ROLE_CLAIM is invalid");
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(boundaryClaim)) throw new Error("NH_OIDC_BOUNDARY_CLAIM is invalid");
  return Object.freeze({
    issuer: issuer.replace(/\/$/, ""), jwksUri, audience, roleClaim, boundaryClaim,
    clockSkewSeconds: boundedInt("NH_OIDC_CLOCK_SKEW_SECONDS", env.NH_OIDC_CLOCK_SKEW_SECONDS, 60, 0, 300),
    cacheTtlMs: boundedInt("NH_OIDC_JWKS_TTL_SECONDS", env.NH_OIDC_JWKS_TTL_SECONDS, 300, 1, 3600) * 1000,
    timeoutMs: boundedInt("NH_OIDC_TIMEOUT_MS", env.NH_OIDC_TIMEOUT_MS, 3000, 100, 30000),
  });
}

function parseBoundaryClaim(raw: unknown): readonly string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    throw new UnauthorizedError("token has no valid NH boundary scope");
  }
  const boundaries: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256 || value === "*") {
      throw new UnauthorizedError("token has no valid NH boundary scope");
    }
    if (seen.has(value)) throw new UnauthorizedError("token has duplicate NH boundaries");
    seen.add(value);
    boundaries.push(value);
  }
  return Object.freeze(boundaries);
}

function validateClaims(claims: JwtClaims, config: OidcConfig): void {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer) throw new UnauthorizedError("token issuer is invalid");
  const audiences = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
  if (!audiences.includes(config.audience)) throw new UnauthorizedError("token audience is invalid");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now - config.clockSkewSeconds) {
    throw new UnauthorizedError("token is expired");
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + config.clockSkewSeconds)) {
    throw new UnauthorizedError("token is not active");
  }
  if (typeof claims.sub !== "string" || !claims.sub.trim() || claims.sub !== claims.sub.trim() || claims.sub.length > 256) {
    throw new UnauthorizedError("token subject is invalid");
  }
}

function parseSegment<T>(part: string): T {
  try { return JSON.parse(decodeBase64Url(part).toString("utf8")) as T; }
  catch { throw new UnauthorizedError("invalid bearer token"); }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new UnauthorizedError("invalid bearer token");
  return Buffer.from(value, "base64url");
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required for OIDC authentication`);
  return value.trim();
}

function requireHttpsUrl(name: string, value: string | undefined): string {
  const raw = required(name, value);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${name} must be a valid HTTPS URL`);
  return url.toString().replace(/\/$/, "");
}

function boundedInt(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is out of range`);
  return value;
}
