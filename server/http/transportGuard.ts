// Secure-transport contract for the HTTP edge.
//
// THE APP SPEAKS PLAIN HTTP. TLS for browsers is terminated by a trusted reverse proxy / load balancer in front
// of it (this repository ships and chooses none — see docs/SECURITY_DEPLOYMENT_CONTRACT_V1.md). That is only
// safe if three things hold, and this module enforces the parts the application can enforce:
//
//   1. START-UP  — `assertTransportContract`: in production the process refuses to start unless it was told
//      (NH_TLS_TERMINATION=proxy) that a TLS-terminating proxy fronts it, OR it is the supervised
//      private-pilot (dev-headers, loopback / isolated container) which the identity layer already confines.
//      There is no flag that means "production, plain HTTP, public": that combination cannot be expressed.
//   2. PER REQUEST — `registerTransportGuard`: behind a proxy, a request that did not arrive over HTTPS
//      (`x-forwarded-proto` is not exactly `https`) is refused 403 before any handler runs, except the two
//      unauthenticated liveness probes a load balancer must make from inside the network.
//   3. RESPONSE  — HSTS on every response in that mode, so a browser that has seen the site once refuses to
//      downgrade.
//
// WHAT THIS CANNOT DO, STATED. `x-forwarded-proto` is only trustworthy if the application port is reachable
// ONLY from the proxy (network policy / private subnet / security group) and the proxy overwrites the header.
// That is a deployment property the application cannot verify; it is an owner obligation in the contract.
import type { FastifyInstance } from "fastify";
import { authModeFromEnvironment } from "../auth/verifiedIdentity";

export type TransportMode = "proxy-tls" | "private-plaintext";

const HSTS = "max-age=31536000; includeSubDomains";
const PROBE_PATHS = new Set(["/health", "/ready"]);

export function transportModeFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): TransportMode {
  const value = env.NH_TLS_TERMINATION?.trim();
  if (!value || value === "none") return "private-plaintext";
  if (value === "proxy") return "proxy-tls";
  throw new Error("NH_TLS_TERMINATION must be 'proxy' or 'none'");
}

export function assertTransportContract(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (transportModeFromEnvironment(env) === "proxy-tls") return;
  if (authModeFromEnvironment(env) === "dev-headers" && env.NH_PRIVATE_PILOT === "true") return;
  throw new Error(
    "production requires TLS termination: set NH_TLS_TERMINATION=proxy (a trusted reverse proxy terminating HTTPS " +
      "and setting X-Forwarded-Proto). Plain HTTP is permitted only for the supervised dev-header private pilot",
  );
}

/** Path without query, and without the SPA's `/api` prefix, for probe matching. */
function probePath(rawUrl: string | undefined): string {
  const path = (rawUrl ?? "/").split("?")[0] ?? "/";
  return path.startsWith("/api/") ? path.slice(4) : path;
}

export function isHttpsForwarded(header: unknown): boolean {
  // Exactly one value, exactly "https". A list ("https, http") means a hop downgraded it — refuse.
  return typeof header === "string" && header.trim().toLowerCase() === "https";
}

export function registerTransportGuard(app: FastifyInstance, mode: TransportMode): void {
  if (mode !== "proxy-tls") return;
  app.addHook("onRequest", async (request, reply) => {
    if (PROBE_PATHS.has(probePath(request.raw.url))) return;
    if (!isHttpsForwarded(request.headers["x-forwarded-proto"])) {
      return reply.code(403).send({ error: "forbidden", message: "HTTPS is required." });
    }
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("strict-transport-security", HSTS);
    return payload;
  });
}
