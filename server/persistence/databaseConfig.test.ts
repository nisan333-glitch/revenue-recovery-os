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

describe("production database transport — verified TLS and no default credentials", () => {
  const base = { NODE_ENV: "production" } as const;
  const url = (query: string, auth = "app:Zk3-long-random-value", host = "db.prod.example.com") =>
    `postgresql://${auth}@${host}/app${query}`;

  it("accepts verified TLS forms only", () => {
    for (const q of ["?sslmode=verify-full", "?sslmode=verify-ca", "?sslmode=require&sslaccept=strict"]) {
      expect(() => assertProductionDatabaseConfiguration({ ...base, DATABASE_URL: url(q) }), q).not.toThrow();
    }
  });

  it("refuses unverified or absent TLS", () => {
    for (const q of ["", "?sslmode=require", "?sslmode=prefer", "?sslmode=disable", "?sslmode=allow", "?sslmode=no-verify"]) {
      expect(() => assertProductionDatabaseConfiguration({ ...base, DATABASE_URL: url(q) }), q).toThrow(/TLS|verify/);
    }
  });

  it("refuses accept_invalid_certs in every mode, including the private pilot", () => {
    expect(() => assertProductionDatabaseConfiguration({ ...base, DATABASE_URL: url("?sslmode=require&sslaccept=accept_invalid_certs") }))
      .toThrow(/verify the server certificate/);
    expect(() => assertProductionDatabaseConfiguration({
      ...base, NH_PRIVATE_PILOT: "true", HOST: "127.0.0.1",
      DATABASE_URL: url("?sslmode=require&sslaccept=accept_invalid_certs", "app:x", "db"),
    })).toThrow(/verify the server certificate/);
  });

  it("NH_PRIVATE_PILOT no longer excuses plain transport to a publicly routable database", () => {
    const pilot = { ...base, NH_PRIVATE_PILOT: "true", HOST: "127.0.0.1" };
    expect(() => assertProductionDatabaseConfiguration({ ...pilot, DATABASE_URL: url("", "app:x", "db.prod.example.com") })).toThrow(/TLS/);
    expect(() => assertProductionDatabaseConfiguration({ ...pilot, DATABASE_URL: url("", "app:x", "203.0.113.9") })).toThrow(/TLS/);
    expect(() => assertProductionDatabaseConfiguration({ ...pilot, DATABASE_URL: url("", "app:x", "db") })).not.toThrow();
    expect(() => assertProductionDatabaseConfiguration({ ...pilot, DATABASE_URL: url("", "app:x", "10.0.0.5") })).not.toThrow();
  });

  it("refuses placeholder and default passwords outside the supervised private pilot's private network", () => {
    for (const pw of ["pilot_only_change_me", "changeme", "postgres", "password", "ep9_test_only", "Example123"]) {
      expect(() => assertProductionDatabaseConfiguration({ ...base, DATABASE_URL: url("?sslmode=verify-full", `app:${pw}`) }), pw)
        .toThrow(/placeholder or default password/);
    }
    // The local compose pilot, on its isolated network, is the one allowed use.
    expect(() => assertProductionDatabaseConfiguration({
      ...base, NH_PRIVATE_PILOT: "true", HOST: "127.0.0.1",
      DATABASE_URL: "postgresql://pilot:pilot_only_change_me@db:5432/revenue_recovery_pilot?schema=public",
    })).not.toThrow();
  });
});
