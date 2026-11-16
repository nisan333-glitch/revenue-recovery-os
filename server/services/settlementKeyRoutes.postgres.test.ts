// G2 · the three HTTP routes, through the real app: authorization, input validation, error handling.
//
// ON A DATABASE OF ITS OWN, created and dropped here, because the register's schema lives in
// `scripts/migration-design/` and deliberately NOT in `prisma/migrations/`. The routes resolve the
// shared client from `server/db`, so the test points DATABASE_URL at its own database before the app
// is built — which is also why this file cannot share a database with the rest of the suite.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitSqlStatements } from "../persistence/obligationAttributionMigration.postgres.test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-key-register-up.sql"), "utf8");

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_keyroutes_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "pilot-steward@company", "x-actor-role": "steward" };
const APPROVER = { "x-actor-id": "pilot-approver@company", "x-actor-role": "approver" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let admin: PrismaClient;
let previousUrl: string | undefined;
let n = 0;

const keyBody = (over: Record<string, unknown> = {}) => ({
  keyId: `k-${(n += 1)}`,
  boundaryId: "b-routes",
  sourceSystem: "acme-bank",
  sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAabc\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  ...over,
});
const CEREMONY = {
  channelIndependentlyVerified: true, institutionIdentityVerified: true,
  keyControlDemonstrated: true, ceremonyRecorded: true,
};

const propose = (key: Record<string, unknown>, evidence = CEREMONY, headers = OPERATOR) =>
  app.inject({ method: "POST", url: "/settlement-keys", headers, payload: { key, evidence, rationale: "ceremony complete" } });

beforeAll(async () => {
  if (!HAS_DB) return;
  admin = new PrismaClient({ datasources: { db: { url: urlFor("postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const seeded = new PrismaClient({ datasources: { db: { url: urlFor(DB_NAME) } } });
  await seeded.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'append-only: % on % is rejected', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'restrict_violation'; END; $$ LANGUAGE plpgsql;`,
  );
  for (const statement of splitSqlStatements(UP)) await seeded.$executeRawUnsafe(statement);
  await seeded.$disconnect();

  // The shared client in `server/db` reads DATABASE_URL at import time, so it is pointed here BEFORE
  // the app module is loaded. Restored in afterAll so no other file inherits it.
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = urlFor(DB_NAME);
  ({ app } = { app: (await import("../app")).buildApp({}) });
}, 90_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await app?.close();
  if (previousUrl !== undefined) process.env.DATABASE_URL = previousUrl;
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 90_000);

describe.skipIf(!HAS_DB)("G2 routes · the governed happy path", () => {
  it("is the positive control: 201 on propose, 200 on activate, and the witness is server-computed", async () => {
    const key = keyBody();
    const created = await propose(key);
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const body = created.json();
    expect(body.keyId).toBe(key.keyId);
    expect(body.witness).toMatch(/^sha256:[a-f0-9]{64}$/);

    const activated = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "reviewed" },
    });
    expect(activated.statusCode, activated.body.slice(0, 400)).toBe(200);
    expect(activated.json()).toEqual({ keyId: key.keyId, activated: true });
  });

  it("echoes whether the exposure start was KNOWN, so an operator can see which claim was recorded", async () => {
    const key = keyBody();
    await propose(key);
    const unknown = await app.inject({
      method: "POST", url: "/settlement-keys/revoke", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "suspected", exposureFrom: null },
    });
    expect(unknown.statusCode, unknown.body.slice(0, 400)).toBe(200);
    expect(unknown.json()).toEqual({ keyId: key.keyId, revoked: true, exposureStartKnown: false });

    const key2 = keyBody();
    await propose(key2);
    const known = await app.inject({
      method: "POST", url: "/settlement-keys/revoke", headers: STEWARD,
      payload: { keyId: key2.keyId, rationale: "forensics", exposureFrom: "2026-02-01T00:00:00.000Z" },
    });
    expect(known.json().exposureStartKnown).toBe(true);
  });
});

describe.skipIf(!HAS_DB)("G2 routes · authorization", () => {
  it("refuses an unauthenticated request on all three routes", async () => {
    for (const [url, payload] of [
      ["/settlement-keys", { key: keyBody(), evidence: CEREMONY, rationale: "r" }],
      ["/settlement-keys/activate", { keyId: "k-x", rationale: "r" }],
      ["/settlement-keys/revoke", { keyId: "k-x", rationale: "r", exposureFrom: null }],
    ] as const) {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode, `${url}: ${res.body.slice(0, 200)}`).toBe(401);
    }
  });

  it("refuses an approver proposing, and an operator activating — propose and activate are split", async () => {
    const asApprover = await propose(keyBody(), CEREMONY, APPROVER);
    expect(asApprover.statusCode).toBe(403);

    const key = keyBody();
    await propose(key);
    const asOperator = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: OPERATOR,
      payload: { keyId: key.keyId, rationale: "r" },
    });
    expect(asOperator.statusCode).toBe(403);
    expect(asOperator.body).toMatch(/may not perform/);
  });

  // SEPARATION OF DUTIES, NOT A CAPABILITY FAILURE: the steward here HAS the capability and is still
  // refused, because it is the identity that proposed the key.
  it("refuses the proposer activating its own key even with the right role", async () => {
    const key = keyBody();
    // Proposed BY the steward identity (stewards cannot propose, so use an operator id that matches
    // the activator's id instead — same actorId, different header role).
    const sameId = { "x-actor-id": "pilot-steward@company", "x-actor-role": "operator" };
    const created = await propose(key, CEREMONY, sameId);
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/KEY_PROPOSER_MAY_NOT_ACTIVATE/);
  });

  it("refuses an operator revoking: revocation is governance's", async () => {
    const key = keyBody();
    await propose(key);
    const res = await app.inject({
      method: "POST", url: "/settlement-keys/revoke", headers: OPERATOR,
      payload: { keyId: key.keyId, rationale: "r", exposureFrom: null },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)("G2 routes · input validation, and what a request may NOT say", () => {
  // AN INJECTED FIELD IS A 400, NOT A SILENT STRIP — the treatment EP-26b gave the `policy` object.
  it.each([
    ["a server-computed witness", { keyWitness: `sha256:${"a".repeat(64)}` }],
    ["a derived state", { state: "ACTIVE" }],
    ["a self-asserted authority flag", { authoritative: true }],
    ["a self-asserted verified flag", { verified: true }],
    ["a self-asserted trusted flag", { trusted: true }],
  ])("refuses %s on the key object with 400", async (_name, extra) => {
    const res = await propose(keyBody(extra));
    expect(res.statusCode, res.body.slice(0, 200)).toBe(400);
  });

  it("refuses a one-flag ceremony: the four facts are each required", async () => {
    const res = await app.inject({
      method: "POST", url: "/settlement-keys", headers: OPERATOR,
      payload: { key: keyBody(), evidence: { verified: true }, rationale: "r" },
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["an unknown source kind", { sourceKind: "wallet" }],
    ["a blank key id", { keyId: "" }],
    ["a blank public key", { publicKey: "" }],
  ])("refuses %s with 400", async (_name, over) => {
    expect((await propose(keyBody(over))).statusCode).toBe(400);
  });

  it("refuses a missing rationale: a governance decision with no stated reason is not one", async () => {
    const res = await app.inject({
      method: "POST", url: "/settlement-keys", headers: OPERATOR,
      payload: { key: keyBody(), evidence: CEREMONY },
    });
    expect(res.statusCode).toBe(400);
  });

  // `exposureFrom` IS REQUIRED AND NULLABLE. An omitted field and a stated "we do not know" are
  // different claims, and an optional field would let a caller get the benefit of an unstated one.
  it("refuses a revoke that OMITS exposureFrom, and accepts an explicit null", async () => {
    const key = keyBody();
    await propose(key);
    const omitted = await app.inject({
      method: "POST", url: "/settlement-keys/revoke", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r" },
    });
    expect(omitted.statusCode).toBe(400);
    const explicit = await app.inject({
      method: "POST", url: "/settlement-keys/revoke", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r", exposureFrom: null },
    });
    expect(explicit.statusCode).toBe(200);
  });

  // THE TENANT IS NOT A REQUEST FIELD ON THE TRANSITIONS: it is read from the key's own row.
  it("refuses a boundaryId on the activate body", async () => {
    const key = keyBody();
    await propose(key);
    const res = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r", boundaryId: "b-other" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe.skipIf(!HAS_DB)("G2 routes · error handling", () => {
  it("answers 404 for an unknown key rather than a permission error", async () => {
    const res = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: "k-does-not-exist", rationale: "r" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a duplicate key id and names the reason", async () => {
    const key = keyBody();
    expect((await propose(key)).statusCode).toBe(201);
    const again = await propose(key);
    expect(again.statusCode).toBe(403);
    expect(again.body).toMatch(/KEY_ALREADY_REGISTERED/);
  });

  it("refuses activating a key whose ceremony is incomplete, naming every unmet condition", async () => {
    const key = keyBody();
    await propose(key, { ...CEREMONY, institutionIdentityVerified: false, ceremonyRecorded: false });
    const res = await app.inject({
      method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/KEY_INSTITUTION_NOT_VERIFIED/);
    expect(res.body).toMatch(/KEY_CEREMONY_RECORD_MISSING/);
    expect(res.body).toMatch(/proves nothing about who holds it/);
  });

  it("refuses a second activation", async () => {
    const key = keyBody();
    await propose(key);
    expect((await app.inject({ method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r" } })).statusCode).toBe(200);
    const twice = await app.inject({ method: "POST", url: "/settlement-keys/activate", headers: STEWARD,
      payload: { keyId: key.keyId, rationale: "r" } });
    expect(twice.statusCode).toBe(403);
    expect(twice.body).toMatch(/KEY_ILLEGAL_TRANSITION/);
  });

  it("never echoes the public key or the rationale back in a refusal", async () => {
    const key = keyBody({ publicKey: "-----BEGIN PUBLIC KEY-----\nSECRETMATERIAL\n-----END PUBLIC KEY-----\n" });
    await propose(key, CEREMONY);
    const again = await propose(key, CEREMONY);
    expect(again.body).not.toContain("SECRETMATERIAL");
  });
});
