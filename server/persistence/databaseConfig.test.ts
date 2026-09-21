import { describe, expect, it } from "vitest";
import { assertPrivatePilotHost, assertProductionDatabaseConfiguration } from "./databaseConfig";

describe("production database boundary", () => {
  it("requires PostgreSQL TLS in production", () => {
    expect(() => assertProductionDatabaseConfiguration({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/app" }))
      .toThrow(/TLS/);
    expect(() => assertProductionDatabaseConfiguration({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db/app?sslmode=verify-full",
    })).not.toThrow();
  });

  it("allows a supervised private pilot without DB TLS only on a safe host", () => {
    expect(() => assertProductionDatabaseConfiguration({
      NODE_ENV: "production", NH_PRIVATE_PILOT: "true", HOST: "127.0.0.1",
      DATABASE_URL: "postgresql://db/app",
    })).not.toThrow();
  });

  it("rejects an explicit public private-pilot bind", () => {
    expect(() => assertPrivatePilotHost({ NH_PRIVATE_PILOT: "true", HOST: "0.0.0.0" })).toThrow(/loopback/);
  });

  it("allows an explicit isolated container-network bind", () => {
    expect(() => assertPrivatePilotHost({
      NH_PRIVATE_PILOT: "true", HOST: "0.0.0.0", NH_TRUST_CONTAINER_NETWORK: "true",
    })).not.toThrow();
  });
});
