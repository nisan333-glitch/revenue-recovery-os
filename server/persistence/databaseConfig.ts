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
  if (!isPrivatePilot(env)) {
    const sslMode = url.searchParams.get("sslmode");
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      throw new Error("production PostgreSQL transport must require TLS (sslmode=require or stronger)");
    }
  }
  assertPrivatePilotHost(env);
}
