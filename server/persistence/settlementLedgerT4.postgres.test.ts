// T4 · the two settlement-ledger controls the existing suite does NOT cover.
//
// WHAT WAS ALREADY THERE, measured before writing anything: `settlementLedger.postgres.test.ts` is
// 61 tests on a database of its own with the design migration applied, and it already covers five of
// the owner's seven T4 cases — a first claim RECORDED, the same arrival refused to a DIFFERENT claim,
// two simultaneous claims with exactly one winner, the digest-key fingerprint mismatch refused, and
// tenant scoping on both the nonce and the digest. Rewriting those would be duplication, and a second
// implementation of one control is a second thing that can drift from it.
//
// WHAT WAS MISSING, and is here:
//
//   6 · TRANSACTION ROLLBACK AND RETRY. The existing file's "rollback hazard" describe is about the
//       MIGRATION's rollback, not about a claim whose transaction aborts. A claim that left a phantom
//       row behind would burn an arrival that was never counted; one that vanished without trace must
//       be re-claimable.
//
//   7 · ACCOUNT_V1 vs OBLIGATION_V2 OVERLAP AT THE MONEY LEVEL. `crossCaseOverlap.postgres.test.ts`
//       refuses the overlapping CANDIDATE at admission. This asks the question one layer down: if a
//       legacy account-grained case and a new obligation-grained case both reached a proof and both
//       cited the SAME arrival, does the ledger refuse the second? That is the backstop, and a
//       backstop nobody tested is an assumption.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresSettlementLedger, settlementDigest, settlementDigestKeyFingerprint,
  type SettlementLedgerRecord,
} from "./settlementLedgerStore";
import { splitSqlStatements } from "./obligationAttributionMigration.postgres.test";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");

const DIGEST_KEY = "nh-t4-settlement-digest-key-0123456789abcdef";
const FP = settlementDigestKeyFingerprint(DIGEST_KEY);
const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_t4_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

let admin: PrismaClient;
let db: PrismaClient;
let ledger: PostgresSettlementLedger;

const nonce = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

function arrival(boundaryId: string, ref: string): ExternalSettlementFact {
  return Object.freeze({
    boundaryId, sourceSystem: "synthetic-bank", sourceKind: "bank",
    externalSettlementRef: ref, finality: "BANK_CREDITED", amountMinor: 550_000,
    currency: "USD", valueDate: "2026-03-10T00:00:00.000Z",
    correctiveInvoiceRef: "CN-T4-0001", payerExternalRef: "PAYER-T4",
  });
}

const record = (
  boundaryId: string, claimRef: string, fact: ExternalSettlementFact, n = nonce(),
): SettlementLedgerRecord => Object.freeze({
  boundaryId, claimRef,
  settlementDigest: settlementDigest(fact, DIGEST_KEY),
  attestationNonce: n,
  keyId: "T4-SYNTHETIC-KEY",
  attestationIssuedAt: "2026-03-10T12:00:00.000",
  digestKeyFingerprint: FP,
});

beforeAll(async () => {
  if (!HAS_DB) return;
  // A DATABASE OF ITS OWN, because the schema lives in `scripts/migration-design/` and deliberately
  // NOT in `prisma/migrations/` — a file there would BE the production schema change.
  admin = new PrismaClient({ datasources: { db: { url: urlFor("postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  db = new PrismaClient({ datasources: { db: { url: urlFor(DB_NAME) } } });

  // ── THE PREREQUISITE, AND IT FAILED CLOSED IN MY FACE, WHICH IS T4 EVIDENCE ────────────────────
  //
  // My first form of this file asserted in a comment that `settlement-ledger-up.sql` creates its own
  // guard. IT DOES NOT — it DEPENDS on `nh_reject_mutation()` from the EP-2 immutability migration,
  // and applying it to a database without that function aborts with Postgres 42883 "function
  // nh_reject_mutation() does not exist". That is precisely what
  // `docs/PILOT_PRODUCTION_REQUIREMENTS_V1.md` §2.1 step 4 says to confirm before a production
  // target, and the migration refuses LOUDLY rather than creating unprotected tables — so the
  // prerequisite is verified by the attempt, not by a reading.
  //
  // Provisioned here the way the existing ledger suite provisions it: the function first, then the
  // design migration. A separate test below asserts the function and the triggers really are present,
  // because every refusal in this file would also "pass" against a table with no triggers at all.
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'append-only: % on % is rejected', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'restrict_violation'; END; $$ LANGUAGE plpgsql;`,
  );
  for (const stmt of splitSqlStatements(UP)) await db.$executeRawUnsafe(stmt);
  ledger = new PostgresSettlementLedger(db);
}, 120_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
});

describe.skipIf(!HAS_DB)("T4 prerequisites · the append-only protection is really there", () => {
  it("the guard function and both triggers exist on the table under test", async () => {
    // ASSERTED, NOT ASSUMED. Every refusal below would also "pass" against a table with no triggers
    // at all if the insert simply failed for another reason, so the protection is established first.
    const fn = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM pg_proc WHERE proname = 'nh_reject_mutation'`);
    expect(Number(fn[0]!.count)).toBeGreaterThan(0);
    const trg = await db.$queryRawUnsafe<{ tgname: string }[]>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'settlement_consumptions'::regclass AND NOT tgisinternal`);
    expect(trg.length).toBeGreaterThan(0);
  });
});

// ── CASE 6 · TRANSACTION ROLLBACK AND RETRY ──────────────────────────────────────────────────────
describe.skipIf(!HAS_DB)("T4-6 · a claim whose transaction rolls back leaves no phantom", () => {
  it("rolls back cleanly, and the SAME arrival is still claimable afterwards", async () => {
    const b = `t4-rb-${randomUUID().slice(0, 8)}`;
    const fact = arrival(b, `CR-RB-${randomUUID().slice(0, 6)}`);
    const rec = record(b, "PF-RB-1", fact);

    // The claim runs inside a transaction that is then deliberately aborted. A row surviving this
    // would BURN an arrival nobody counted: the money could never be claimed again, and the ledger
    // would be refusing a legitimate first claim forever.
    await expect(db.$transaction(async (tx) => {
      const inner = new PostgresSettlementLedger(tx as unknown as PrismaClient);
      const first = await inner.claim(rec);
      expect(first.outcome).toBe("RECORDED");
      throw new Error("deliberate abort after the claim");
    })).rejects.toThrow(/deliberate abort/);

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "settlement_consumptions" WHERE "boundary_id" = $1`, b);
    expect(Number(rows[0]!.count)).toBe(0);

    // THE RETRY IS THE POINT. Not merely "no row", but "the money is still claimable".
    const retry = await ledger.claim(rec);
    expect(retry.outcome).toBe("RECORDED");
  });

  it("and after the committed retry the arrival is taken — the rollback did not weaken the control", async () => {
    const b = `t4-rb2-${randomUUID().slice(0, 8)}`;
    const fact = arrival(b, `CR-RB2-${randomUUID().slice(0, 6)}`);
    expect((await ledger.claim(record(b, "PF-RB2-1", fact))).outcome).toBe("RECORDED");
    const second = await ledger.claim(record(b, "PF-RB2-2", fact));
    expect(second.outcome).toBe("TAKEN_BY_ANOTHER_CLAIM");
  });
});

// ── CASE 7 · ACCOUNT_V1 vs OBLIGATION_V2 OVERLAP, AT THE MONEY LEVEL ─────────────────────────────
describe.skipIf(!HAS_DB)("T4-7 · a legacy account-grained claim and a new obligation-grained claim", () => {
  it("REFUSES the second claim on one arrival, whatever grain the two cases were opened at", async () => {
    // THE SCENARIO: a boundary assessed before obligation-grained emission holds an account-level
    // case; the same extract re-assessed afterwards yields obligation-level cases. Admission now
    // refuses that overlap (`crossCaseOverlap.postgres.test.ts`). THIS asks what happens if it did
    // not — because a backstop is only a backstop if it holds when the thing in front of it fails.
    const b = `t4-grain-${randomUUID().slice(0, 8)}`;
    const fact = arrival(b, `CR-GRAIN-${randomUUID().slice(0, 6)}`);

    const legacy = await ledger.claim(record(b, "PF-ACCOUNT-AGGREGATE-era", fact));
    expect(legacy.outcome).toBe("RECORDED");

    const obligationGrained = await ledger.claim(record(b, "PF-OBLIGATION-GRAINED-era", fact));
    expect(obligationGrained.outcome).toBe("TAKEN_BY_ANOTHER_CLAIM");
    // AND IT NAMES WHO HOLDS THE MONEY, so an operator can see which case already counted it rather
    // than being told only that something did.
    // The field is `byClaimRef`. My first form invented `heldBy` and an outcome name of
    // `ALREADY_COUNTED_BY_ANOTHER_CLAIM`; the product's own names are `TAKEN_BY_ANOTHER_CLAIM` and
    // `byClaimRef`, and all three failures were my constants rather than its behaviour.
    expect(obligationGrained.outcome === "TAKEN_BY_ANOTHER_CLAIM"
      && obligationGrained.byClaimRef).toBe("PF-ACCOUNT-AGGREGATE-era");

    // EXACTLY ONE ROW. The money was counted once, by one claim.
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "settlement_consumptions" WHERE "boundary_id" = $1`, b);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("and it holds under CONCURRENCY — five claims at two grains, one winner", async () => {
    const b = `t4-grain-conc-${randomUUID().slice(0, 8)}`;
    const fact = arrival(b, `CR-GC-${randomUUID().slice(0, 6)}`);
    const refs = ["PF-AGG", "PF-OBL-1", "PF-OBL-2", "PF-OBL-3", "PF-OBL-4"];
    const results = await Promise.all(refs.map((r) => ledger.claim(record(b, r, fact))));
    expect(results.filter((r) => r.outcome === "RECORDED")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "TAKEN_BY_ANOTHER_CLAIM")).toHaveLength(4);
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "settlement_consumptions" WHERE "boundary_id" = $1`, b);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("the CONTROL: two DIFFERENT arrivals at two grains are both recorded", async () => {
    // Without this the suite above would be satisfied by a ledger that refused everything, and the
    // product would be useless. Two genuinely different arrivals must both count.
    const b = `t4-grain-ctl-${randomUUID().slice(0, 8)}`;
    const a1 = arrival(b, `CR-C1-${randomUUID().slice(0, 6)}`);
    const a2 = arrival(b, `CR-C2-${randomUUID().slice(0, 6)}`);
    expect((await ledger.claim(record(b, "PF-AGG", a1))).outcome).toBe("RECORDED");
    expect((await ledger.claim(record(b, "PF-OBL", a2))).outcome).toBe("RECORDED");
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "settlement_consumptions" WHERE "boundary_id" = $1`, b);
    expect(Number(rows[0]!.count)).toBe(2);
  });
});
