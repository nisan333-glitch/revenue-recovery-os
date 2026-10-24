// Dev-header identity is a PRIVATE-PILOT convenience, never an authentication mechanism: it believes whatever
// `x-actor-id` / `x-actor-role` say. So it is fail-closed on TWO independent layers, and either one alone
// refuses:
//
//   1. START-UP  — `assertDevHeadersBindSafe`: the process may not listen on anything but loopback (or, for the
//      isolated-container pilot, 0.0.0.0 with BOTH explicit flags), whatever NODE_ENV says. Before this, the
//      check returned early whenever NH_PRIVATE_PILOT was unset, so a non-production process bound to 0.0.0.0
//      served header identity to the whole network.
//   2. PER REQUEST — `assertLoopbackOnlyRequest`: the request must LOOK like a local one. A public deployment
//      sits behind something (a load balancer, an ingress, a CDN) that adds forwarding headers, presents a
//      public Host, or connects from a public address — any of these refuses the header identity, so even a
//      mis-set environment variable cannot turn a reachable service into one that trusts headers.
//
// This is defence in depth, not a substitute for OIDC: a request genuinely made from the same machine (or the
// private container network) is, by definition, the supervised operator.
import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "../http/errors";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const FORWARDING_HEADERS = [
  "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip",
] as const;
const REFUSAL = "dev-header identity is available only to a local private-pilot client";

/** `127.0.0.1:4000` → `127.0.0.1`; `[::1]:4000` → `[::1]`; a bare host is returned as-is. */
export function hostWithoutPort(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.lastIndexOf(":");
  return colon !== -1 && value.indexOf(":") === colon ? value.slice(0, colon) : value;
}

export function isLoopbackHostHeader(hostHeader: unknown): boolean {
  return typeof hostHeader === "string" && LOOPBACK_HOSTS.has(hostWithoutPort(hostHeader));
}

/** Loopback, RFC 1918, link-local, or IPv6 unique-local — i.e. NOT a publicly routable peer. */
export function isPrivateOrLoopbackAddress(address: unknown): boolean {
  if (typeof address !== "string" || !address) return false;
  let a = address.trim().toLowerCase();
  if (a.startsWith("::ffff:")) a = a.slice(7); // IPv4-mapped IPv6
  if (a === "::1") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    if ([o1, o2, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a); // fc00::/7 and fe80::/10
}

export function assertLoopbackOnlyRequest(req: Pick<FastifyRequest, "headers" | "socket">): void {
  for (const name of FORWARDING_HEADERS) {
    if (req.headers[name] !== undefined) throw new UnauthorizedError(REFUSAL);
  }
  if (!isLoopbackHostHeader(req.headers.host)) throw new UnauthorizedError(REFUSAL);
  if (!isPrivateOrLoopbackAddress(req.socket?.remoteAddress)) throw new UnauthorizedError(REFUSAL);
}

/** Start-up rule for dev-header identity, independent of NODE_ENV and of NH_PRIVATE_PILOT. */
export function assertDevHeadersBindSafe(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (LOOPBACK_HOSTS.has(host.toLowerCase())) return;
  if (host === "0.0.0.0" && env.NH_PRIVATE_PILOT === "true" && env.NH_TRUST_CONTAINER_NETWORK === "true") return;
  throw new Error(
    "dev-header identity may only be served on loopback (or 0.0.0.0 inside an isolated container with " +
      "NH_PRIVATE_PILOT=true and NH_TRUST_CONTAINER_NETWORK=true); use NH_AUTH_MODE=oidc anywhere else",
  );
}
