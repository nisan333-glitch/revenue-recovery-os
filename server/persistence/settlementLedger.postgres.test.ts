// G5 · the settlement ledger against a REAL database, including genuine concurrency.
//
// ON A DATABASE OF ITS OWN, created and dropped here, because the schema lives in
// `scripts/migration-design/` and deliberately NOT in `prisma/migrations/`.
//
// THE CONCURRENCY TESTS ARE THE POINT OF THIS FILE. Everything else here could be satisfied by a
// read-then-check; only two simultaneous claims can tell whether the rule is a control or merely a
// decision.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSettlementLedger, settlementDigest, settlementLedgerPort, type SettlementLedgerRecord }
  from "./settlementLedgerStore";
import { splitSqlStatements } from "./obligationAttributionMigration.postgres.test";
import { settlementIdentity, type ExternalSettlementFact } from "../../src/domain/externalSettlement";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_ledger_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

let admin: PrismaClient;
let db: PrismaClient;
let ledger: PostgresSettlementLedger;

const FACT: ExternalSettlementFact = Object.freeze({
  boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  externalSettlementRef: "CR-99001", finality: "BANK_CREDITED", amountMinor: 550000,
  currency: "USD", valueDate: "2026-03-10T00:00:00.000Z",
  correctiveInvoiceRef: "CN-9120", payerExternalRef: "PAYER-7781",
});

let n = 0;
const rec = async (over: Partial<SettlementLedgerRecord> = {}): Promise<SettlementLedgerRecord> => ({
  boundaryId: "b-alpha",
  claimRef: `claim-${(n += 1)}`,
  settlementDigest: await settlementDigest({ ...FACT, externalSettlementRef: `CR-${n}` }),
  attestationNonce: `nonce-${String(n).padStart(16, "0")}`,
  keyId: "k-bank-01",
  ...over,
});

beforeAll(async () => {
  if (!HAS_DB) return;
  admin = new PrismaClient({ datasources: { db: { url: urlFor("postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  db = new PrismaClient({ datasources: { db: { url: urlFor(DB_NAME) } } });
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'append-only: % on % is rejected', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'restrict_violation'; END; $$ LANGUAGE plpgsql;`,
  );
  for (const statement of splitSqlStatements(UP)) await db.$executeRawUnsafe(statement);
  ledger = new PostgresSettlementLedger(db);
}, 90_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 90_000);

describe.skipIf(!HAS_DB)("G5 · claiming an arrival of money", () => {
  it("is the positive control: a first claim is RECORDED", async () => {
    const r = await rec();
    expect(await ledger.claim(r)).toMatchObject({ outcome: "RECORDED" });
    expect(await ledger.digestsFor(r.boundaryId, r.claimRef)).toEqual([r.settlementDigest]);
  });

  // AN IDEMPOTENT RETRY IS NOT A DOUBLE COUNT — the distinction stage 8's port could not express,
  // because it asked only "is this identity already substantiating something".
  it("answers ALREADY_MINE on an identical retry, with the same consumption id", async () => {
    const r = await rec();
    const first = await ledger.claim(r);
    const second = await ledger.claim(r);
    expect(first.outcome).toBe("RECORDED");
    expect(second).toMatchObject({ outcome: "ALREADY_MINE" });
    if (first.outcome !== "RECORDED" || second.outcome !== "ALREADY_MINE") throw new Error("x");
    expect(second.consumptionId).toBe(first.consumptionId);
    // And the arrival is still counted ONCE for that claim.
    expect(await ledger.digestsFor(r.boundaryId, r.claimRef)).toHaveLength(1);
  });

  it("refuses the SAME arrival claimed by a DIFFERENT claim, and names who holds it", async () => {
    const first = await rec();
    await ledger.claim(first);
    const second = await rec({
      settlementDigest: first.settlementDigest,
      attestationNonce: "nonce-9999999999999999",
    });
    const out = await ledger.claim(second);
    expect(out).toMatchObject({ outcome: "TAKEN_BY_ANOTHER_CLAIM", byClaimRef: first.claimRef });
  });

  // THE NONCE IS DIAGNOSED FIRST. A caller replaying a whole request must be told their signature was
  // reused, not that their money was already counted — the real problem is the attestation.
  it("reports NONCE_ALREADY_USED ahead of the digest when a whole request is replayed", async () => {
    const first = await rec();
    await ledger.claim(first);
    const sameNonceDifferentMoney = await rec({
      claimRef: `claim-other-${n}`, attestationNonce: first.attestationNonce,
    });
    const out = await ledger.claim(sameNonceDifferentMoney);
    expect(out).toMatchObject({ outcome: "NONCE_ALREADY_USED", byClaimRef: first.claimRef });
  });

  // MUTATION L11 SURVIVED THE FIRST FORM OF THIS SUITE, and the gap was in my test rather than the
  // code. The test above replays a nonce with a DIFFERENT digest, so the digest lookup finds nothing
  // and falls through to the nonce whichever order they are in. ORDER ONLY MATTERS WHEN BOTH COLLIDE,
  // and nothing constructed that case: same nonce, same arrival, a different claim.
  //
  // THE SAME SHAPE AS EVERY ORDERING TEST I HAVE GOT WRONG IN THIS SESSION: asserting that A is
  // reported proves A is reported, not that A OUTRANKS B — for which B must also be true.
  it("reports NONCE_ALREADY_USED, not the digest, when BOTH collide at once", async () => {
    const first = await rec();
    await ledger.claim(first);
    // Same nonce AND same arrival, different claim: the deterministic id differs, so the insert is
    // attempted and conflicts on BOTH unique indexes. Only the diagnosis order decides the answer.
    const both = await ledger.claim({ ...first, claimRef: `claim-both-${(n += 1)}` });
    expect(both).toMatchObject({ outcome: "NONCE_ALREADY_USED", byClaimRef: first.claimRef });
    // A replayed signature is a statement about the ATTESTATION; a taken digest is a statement about
    // the MONEY. Told the second, a caller would go looking for a double count that is not the problem.
    expect(both.outcome).not.toBe("TAKEN_BY_ANOTHER_CLAIM");
  });

  it("scopes nonce reuse to the TENANT, because the signature binds the tenant beside the nonce", async () => {
    const alpha = await rec();
    await ledger.claim(alpha);
    const beta = await rec({ boundaryId: "b-beta", attestationNonce: alpha.attestationNonce });
    // A nonce value recurring in another tenant is a DIFFERENT signature over a DIFFERENT payload.
    expect(await ledger.claim(beta)).toMatchObject({ outcome: "RECORDED" });
  });

  it("holds one-arrival-counted-once ACROSS tenants without a scoping clause", async () => {
    // The canonical identity already contains the boundary, so the digest differs per tenant by
    // construction — asserted rather than assumed, because the index has no boundary column.
    const a = await settlementDigest(FACT);
    const b = await settlementDigest({ ...FACT, boundaryId: "b-beta" });
    expect(a).not.toBe(b);
    expect(settlementIdentity(FACT)).toContain("b-alpha");
  });
});

describe.skipIf(!HAS_DB)("G5 · concurrency · the constraint is the control", () => {
  // THE TEST THIS FILE EXISTS FOR. A read-then-check passes both of these; only a constraint stops
  // the second one landing.
  it("lets exactly ONE of two simultaneous claims on one arrival win", async () => {
    const digest = await settlementDigest({ ...FACT, externalSettlementRef: `CR-conc-${(n += 1)}` });
    const a: SettlementLedgerRecord = {
      boundaryId: "b-alpha", claimRef: "claim-A", settlementDigest: digest,
      attestationNonce: "nonce-aaaaaaaaaaaaaaaa", keyId: "k-bank-01",
    };
    const b: SettlementLedgerRecord = { ...a, claimRef: "claim-B", attestationNonce: "nonce-bbbbbbbbbbbbbbbb" };

    const [ra, rb] = await Promise.all([ledger.claim(a), ledger.claim(b)]);
    const outcomes = [ra.outcome, rb.outcome].sort();
    expect(outcomes).toEqual(["RECORDED", "TAKEN_BY_ANOTHER_CLAIM"]);

    // And the database holds exactly one row for that arrival.
    const rows = await db.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*) AS c FROM "settlement_consumptions" WHERE "settlement_digest" = $1`, digest,
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("lets exactly ONE of two simultaneous uses of one nonce win", async () => {
    const nonce = "nonce-cccccccccccccccc";
    const a: SettlementLedgerRecord = {
      boundaryId: "b-alpha", claimRef: "claim-N1", attestationNonce: nonce, keyId: "k-bank-01",
      settlementDigest: await settlementDigest({ ...FACT, externalSettlementRef: `CR-n1-${(n += 1)}` }),
    };
    const b: SettlementLedgerRecord = {
      ...a, claimRef: "claim-N2",
      settlementDigest: await settlementDigest({ ...FACT, externalSettlementRef: `CR-n2-${(n += 1)}` }),
    };
    const [ra, rb] = await Promise.all([ledger.claim(a), ledger.claim(b)]);
    expect([ra.outcome, rb.outcome].sort()).toEqual(["NONCE_ALREADY_USED", "RECORDED"]);
    const rows = await db.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*) AS c FROM "settlement_consumptions"
         WHERE "boundary_id" = 'b-alpha' AND "attestation_nonce" = $1`, nonce,
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("is idempotent under simultaneous IDENTICAL retries: one row, and no refusal", async () => {
    const r = await rec({ claimRef: "claim-idem" });
    const results = await Promise.all([ledger.claim(r), ledger.claim(r), ledger.claim(r)]);
    const outcomes = results.map((x) => x.outcome).sort();
    // One wins the insert; the others see our own deterministic id. NONE is a double-count refusal.
    expect(outcomes.filter((o) => o === "RECORDED")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "ALREADY_MINE")).toHaveLength(2);
    expect(await ledger.digestsFor(r.boundaryId, r.claimRef)).toHaveLength(1);
  });
});

describe.skipIf(!HAS_DB)("G5 · append-only, and the rollback hazard it guards", () => {
  it("refuses an UPDATE and a DELETE of a consumption", async () => {
    const r = await rec();
    await ledger.claim(r);
    await expect(db.$executeRawUnsafe(
      `UPDATE "settlement_consumptions" SET "claim_ref" = 'x' WHERE "settlement_digest" = $1`,
      r.settlementDigest,
    )).rejects.toThrow(/append-only/);
    // DELETING ONE WOULD SILENTLY FREE AN ARRIVAL TO BE COUNTED A SECOND TIME. The immutability here
    // is not hygiene, it is the control itself.
    await expect(db.$executeRawUnsafe(
      `DELETE FROM "settlement_consumptions" WHERE "settlement_digest" = $1`, r.settlementDigest,
    )).rejects.toThrow(/append-only/);
  });

  it("refuses a TRUNCATE", async () => {
    await expect(db.$executeRawUnsafe(`TRUNCATE "settlement_consumptions"`)).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(!HAS_DB)("G5 · the constraints restate the contract in the database", () => {
  const raw = (over: Record<string, string>) => {
    const v = {
      consumption_id: "'sc-raw'", boundary_id: "'b'", claim_ref: "'c'",
      settlement_digest: `'sha256:${"a".repeat(64)}'`, attestation_nonce: "'nonce-0000000000000000'",
      key_id: "'k'", ...over,
    };
    return db.$executeRawUnsafe(
      `INSERT INTO "settlement_consumptions"
         ("consumption_id","boundary_id","claim_ref","settlement_digest","attestation_nonce","key_id")
       VALUES (${v.consumption_id},${v.boundary_id},${v.claim_ref},${v.settlement_digest},
               ${v.attestation_nonce},${v.key_id})`,
    );
  };

  it.each([
    ["a malformed digest", { settlement_digest: "'nope'" }],
    ["an uppercase-hex digest", { settlement_digest: `'sha256:${"A".repeat(64)}'` }],
    ["a short nonce", { attestation_nonce: "'abc'" }],
    ["a nonce with illegal characters", { attestation_nonce: "'nonce with spaces!!'" }],
    ["a blank boundary", { boundary_id: "'  '" }],
    ["a blank claim ref", { claim_ref: "''" }],
    ["a blank key id", { key_id: "'   '" }],
  ])("refuses %s", async (_name, over) => {
    await expect(raw(over)).rejects.toThrow();
  });
});

describe.skipIf(!HAS_DB)("G5 · the exposure query a compromised key forces", () => {
  it("enumerates every arrival that rests on one key, in append order", async () => {
    const keyId = `k-exposed-${randomUUID().slice(0, 8)}`;
    const first = await rec({ keyId, claimRef: "claim-x1" });
    const second = await rec({ keyId, claimRef: "claim-x2" });
    await ledger.claim(first);
    await ledger.claim(second);
    const found = await ledger.consumptionsForKey(keyId);
    // `compromiseAssessment` can say whether ONE attestation falls in an exposure window; this says
    // WHICH arrivals to ask it about. Without it, revoking a key would be an act with no way to
    // enumerate what it touched.
    expect(found.map((f) => f.claimRef)).toEqual(["claim-x1", "claim-x2"]);
    expect(found.every((f) => /^\d{4}-/.test(f.consumedAt))).toBe(true);
  });

  it("returns nothing for a key that consumed nothing, rather than guessing", async () => {
    expect(await ledger.consumptionsForKey("k-never-used")).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)("G5 · the gate port over the durable ledger", () => {
  // THE TEST FOR THE BUG THAT WOULD HAVE BEEN SILENT. My first port signature returned DIGESTS while
  // the pure core compares raw `settlementIdentity(...)` strings — type-compatible and semantically
  // unable to ever match. A check that cannot match is worse than no check: it reports a rule as
  // enforced while passing everything. This asserts the round trip identity -> digest -> identity.
  it("returns the caller's own IDENTITY strings, not digests, so the core's check can match", async () => {
    const port = settlementLedgerPort(ledger);
    const fact = { ...FACT, externalSettlementRef: `CR-port-${(n += 1)}` };
    const identity = settlementIdentity(fact);
    const digest = await settlementDigest(fact);

    await ledger.claim({
      boundaryId: "b-alpha", claimRef: "claim-owner", settlementDigest: digest,
      attestationNonce: `nonce-port${String(n).padStart(6, "0")}`, keyId: "k-bank-01",
    });

    const taken = await port.identitiesSubstantiatingOtherClaims("b-alpha", "claim-other", [identity]);
    expect(taken).toEqual([identity]);
    // And it is NOT the digest — the exact mistake this test exists for.
    expect(taken[0]).not.toBe(digest);
    expect(taken[0]!.startsWith("nh-settlement-v1\u0000")).toBe(true);
  });

  it("excludes the asking claim's own arrivals, so a retry is not a double count", async () => {
    const port = settlementLedgerPort(ledger);
    const fact = { ...FACT, externalSettlementRef: `CR-self-${(n += 1)}` };
    await ledger.claim({
      boundaryId: "b-alpha", claimRef: "claim-self", settlementDigest: await settlementDigest(fact),
      attestationNonce: `nonce-self${String(n).padStart(6, "0")}`, keyId: "k-bank-01",
    });
    expect(await port.identitiesSubstantiatingOtherClaims("b-alpha", "claim-self", [settlementIdentity(fact)]))
      .toEqual([]);
  });

  it("reports only the nonces that are actually used, and is bounded by its input", async () => {
    const port = settlementLedgerPort(ledger);
    const used = `nonce-used${String((n += 1)).padStart(6, "0")}`;
    await ledger.claim({
      boundaryId: "b-alpha", claimRef: `claim-nonce-${n}`,
      settlementDigest: await settlementDigest({ ...FACT, externalSettlementRef: `CR-nu-${n}` }),
      attestationNonce: used, keyId: "k-bank-01",
    });
    expect(await port.nonceAlreadyUsed("b-alpha", [used, "nonce-neverseen00000"])).toEqual([used]);
    // Empty in, empty out — never a full scan standing in for an answer.
    expect(await port.nonceAlreadyUsed("b-alpha", [])).toEqual([]);
    expect(await port.identitiesSubstantiatingOtherClaims("b-alpha", "c", [])).toEqual([]);
  });

  it("is tenant-scoped on both questions", async () => {
    const port = settlementLedgerPort(ledger);
    const fact = { ...FACT, externalSettlementRef: `CR-tenant-${(n += 1)}` };
    const nonce = `nonce-ten${String(n).padStart(7, "0")}`;
    await ledger.claim({
      boundaryId: "b-alpha", claimRef: "claim-t", settlementDigest: await settlementDigest(fact),
      attestationNonce: nonce, keyId: "k-bank-01",
    });
    expect(await port.nonceAlreadyUsed("b-beta", [nonce])).toEqual([]);
    expect(await port.identitiesSubstantiatingOtherClaims("b-beta", "claim-x", [settlementIdentity(fact)]))
      .toEqual([]);
  });
});
