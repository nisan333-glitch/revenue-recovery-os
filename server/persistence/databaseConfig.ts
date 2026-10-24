import { isPrivateOrLoopbackAddress } from "../auth/loopbackGuard";

export function isPrivatePilot(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NH_PRIVATE_PILOT === "true";
}

export function assertPrivatePilotHost(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!isPrivatePilot(env)) return;
  const host = env.HOST;
  if (!host || ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return;
  if (host === "0.0.0.0" && env.NH_TRUST_CONTAINER_NETWORK === "true") return;
  throw new Error("private pilot runtime must bind to loopback unless an isolated container network is explicit");
}

const PLAIN_SSL_MODES = new Set(["disable", "allow", "prefer", "no-verify"]);
// Passwords that are placeholders, defaults or test values. A production database must never be reached with one.
const PLACEHOLDER_PASSWORD = /change[_-]?me|placeholder|example|_only$|^(password|passwd|postgres|secret|admin|root|test|pilot)$/i;

/** Single-label names (`db`, a compose/k8s service), loopback, private/link-local IPs, and unix-socket style hosts. */
export function isPrivateDatabaseHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host.startsWith("/")) return true; // unix socket directory
  if (host === "localhost") return true;
  if (!host.includes(".") && !host.includes(":")) return true; // single-label service name
  return isPrivateOrLoopbackAddress(host);
}

export function assertProductionDatabaseConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required in production");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL in production");
  }
  const sslMode = url.searchParams.get("sslmode");
  const sslAccept = url.searchParams.get("sslaccept");
  // Never, in any mode: encryption without verification is encryption to whoever answers.
  if (sslAccept === "accept_invalid_certs" || sslMode === "no-verify") {
    throw new Error("production PostgreSQL transport must verify the server certificate (no accept_invalid_certs / no-verify)");
  }
  const verifiedTls = sslMode === "verify-ca" || sslMode === "verify-full" || (sslMode === "require" && sslAccept === "strict");
  // Plain transport is possible ONLY for the supervised private pilot AND only to a database on a private network.
  // NH_PRIVATE_PILOT no longer excuses TLS towards a publicly routable database host.
  const plainAllowed = isPrivatePilot(env) && isPrivateDatabaseHost(url.hostname);
  if (!verifiedTls && !plainAllowed) {
    if (sslMode && PLAIN_SSL_MODES.has(sslMode)) {
      throw new Error("production PostgreSQL transport must require verified TLS (sslmode=" + sslMode + " is not acceptable)");
    }
    throw new Error(
      "production PostgreSQL transport must require verified TLS (sslmode=verify-full or verify-ca, or sslmode=require&sslaccept=strict)",
    );
  }
  // Placeholder / default credentials are never acceptable outside the supervised private pilot's private network.
  const password = decodeURIComponent(url.password);
  if (password && PLACEHOLDER_PASSWORD.test(password) && !plainAllowed) {
    throw new Error("DATABASE_URL uses a placeholder or default password; production credentials must come from a secret store");
  }
  assertPrivatePilotHost(env);
}
