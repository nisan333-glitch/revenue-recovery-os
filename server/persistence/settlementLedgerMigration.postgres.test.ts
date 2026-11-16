// G7 · IS THE LEDGER MIGRATION SAFE TO APPLY TO A DATABASE THAT ALREADY HOLDS THE PRODUCT?
//
// NOT "does the SQL run". That is the easy half and it was already covered. The question a migration
// has to answer before anyone would run it against a real database is the other one:
//
//   DOES IT ADD EXACTLY ITS OWN OBJECTS AND ALTER NOTHING ELSE?
//
// So this test does not inspect the ledger table and declare victory. It takes a FULL CATALOGUE
// SNAPSHOT of a database carrying the entire Prisma schema — every table, every column with its type
// and nullability, every index with its definition, every constraint, every trigger — applies the
// migration, snapshots again, and requires the difference to be exactly the migration's own objects.
// A column quietly dropped, a type widened, an index renamed or a trigger lost anywhere else in the
// schema fails here, which is the only way "safe" can be a measurement rather than an intention.
//
// AND THE ROLLBACK IS HELD TO THE SAME BAR: after `down`, the snapshot must equal the ORIGINAL exactly.
// A rollback that leaves a sequence, an index or a trigger behind has not rolled back.
//
// ISOLATED ONLY. The database is created and dropped here. Nothing in this file touches
// `prisma/migrations/`, and the ledger's schema deliberately does not live there — a file there is
// applied by `prisma migrate deploy` on every deploy, so committing it WOULD BE the production change.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitSqlStatements } from "./obligationAttributionMigration.postgres.test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");
const DOWN = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-down.sql"), "utf8");

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_ledgermig_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

let admin: PrismaClient;
let db: PrismaClient;

/** Every structural fact the catalogue holds, as comparable strings. */
interface Catalogue {
  readonly columns: readonly string[];
  readonly indexes: readonly string[];
  readonly constraints: readonly string[];
  readonly triggers: readonly string[];
  readonly sequences: readonly string[];
}

async function snapshot(): Promise<Catalogue> {
  const rows = async <T>(sql: string): Promise<T[]> => db.$queryRawUnsafe<T[]>(sql);
  const columns = await rows<{ s: string }>(
    `SELECT table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable AS s
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`,
  );
  const indexes = await rows<{ s: string }>(
    `SELECT indexdef AS s FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`,
  );
  const constraints = await rows<{ s: string }>(
    `SELECT c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS s
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' ORDER BY 1`,
  );
  const triggers = await rows<{ s: string }>(
    `SELECT tgrelid::regclass || ' ' || tgname AS s FROM pg_trigger
       WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%' ORDER BY 1`,
  );
  const sequences = await rows<{ s: string }>(
    `SELECT sequence_name AS s FROM information_schema.sequences
       WHERE sequence_schema = 'public' ORDER BY 1`,
  );
  return {
    columns: columns.map((r) => r.s), indexes: indexes.map((r) => r.s),
    constraints: constraints.map((r) => r.s), triggers: triggers.map((r) => r.s),
    sequences: sequences.map((r) => r.s),
  };
}

const added = (before: readonly string[], after: readonly string[]): string[] =>
  after.filter((x) => !before.includes(x));
const removed = (before: readonly string[], after: readonly string[]): string[] =>
  before.filter((x) => !after.includes(x));

/** Everything the migration is ALLOWED to touch. Anything else is a finding. */
const OWN = (s: string): boolean => s.includes("settlement_consumptions");

let empty: Catalogue;
let withLedger: Catalogue;

beforeAll(async () => {
  if (!HAS_DB) return;
  admin = new PrismaClient({ datasources: { db: { url: urlFor("postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);

  // THE WHOLE PRODUCT'S SCHEMA, not a bare database. The question is whether the migration disturbs
  // what is already there, and a database with nothing in it cannot answer it.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: REPO, env: { ...process.env, DATABASE_URL: urlFor(DB_NAME) }, stdio: "pipe",
  });

  db = new PrismaClient({ datasources: { db: { url: urlFor(DB_NAME) } } });
  // The append-only trigger function the migration's triggers reference. In production it is created
  // by an earlier migration; here it is a prerequisite, and stating it is part of the safety answer.
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'append-only: % on % is rejected', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'restrict_violation'; END; $$ LANGUAGE plpgsql;`,
  );
  empty = await snapshot();
  for (const statement of splitSqlStatements(UP)) await db.$executeRawUnsafe(statement);
  withLedger = await snapshot();
}, 180_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 90_000);

describe.skipIf(!HAS_DB)("G7 · the ledger migration against the product's real schema", () => {
  it("is the positive control: it applied, and the product's schema was NOT empty beforehand", async () => {
    // A migration that "touched nothing" because there was nothing there would pass every assertion
    // below and prove none of them.
    expect(empty.columns.length).toBeGreaterThan(100);
    expect(empty.columns.some((c) => c.startsWith("Proof."))).toBe(true);
    expect(withLedger.columns.some((c) => c.startsWith("settlement_consumptions."))).toBe(true);
  });

  it("ADDS ONLY ITS OWN OBJECTS — every added column, index, constraint and trigger is the ledger's", () => {
    for (const [what, pair] of Object.entries({
      columns: [empty.columns, withLedger.columns],
      indexes: [empty.indexes, withLedger.indexes],
      constraints: [empty.constraints, withLedger.constraints],
      triggers: [empty.triggers, withLedger.triggers],
    } as Record<string, [readonly string[], readonly string[]]>)) {
      const foreign = added(pair[0], pair[1]).filter((s) => !OWN(s));
      expect(foreign, `${what} added outside the ledger`).toEqual([]);
    }
    // The sequence is named for the table but does not contain it in `sequence_name` alone, so it is
    // asserted by name rather than by the shared predicate.
    expect(added(empty.sequences, withLedger.sequences)).toEqual(["settlement_consumptions_seq"]);
  });

  it("REMOVES AND ALTERS NOTHING — not one pre-existing column, index, constraint or trigger moved", () => {
    // The assertion that makes this a safety test. A dropped column, a widened type, a renamed index
    // or a lost trigger ANYWHERE in the product's schema shows up here as a removal.
    expect(removed(empty.columns, withLedger.columns)).toEqual([]);
    expect(removed(empty.indexes, withLedger.indexes)).toEqual([]);
    expect(removed(empty.constraints, withLedger.constraints)).toEqual([]);
    expect(removed(empty.triggers, withLedger.triggers)).toEqual([]);
    expect(removed(empty.sequences, withLedger.sequences)).toEqual([]);
  });

  it("creates exactly the structure the design states, including the two DIFFERENTLY SCOPED indexes", () => {
    const own = withLedger.indexes.filter(OWN).join("\n");
    // One arrival of money is counted once: GLOBAL, because the canonical identity already contains
    // the boundary, so a global unique index IS per-tenant uniqueness.
    expect(own).toMatch(/UNIQUE INDEX settlement_consumptions_one_arrival[\s\S]*\(settlement_digest\)/);
    // A signature is single-use: SCOPED TO THE TENANT, because the nonce is a value the external source
    // chose and the boundary sits beside it in the signed payload, not inside it.
    expect(own).toMatch(/UNIQUE INDEX settlement_consumptions_one_use[\s\S]*\(boundary_id, attestation_nonce\)/);

    // The signing instant is NOT NULL with no default — see the column's own comment for why that is
    // only honest while there is no population to backfill.
    const col = withLedger.columns.find((c) => c.startsWith("settlement_consumptions.attestation_issued_at"));
    expect(col).toBeDefined();
    expect(col).toMatch(/null=NO/);

    // The rotation check reads this column; a nullable one would let it read `undefined` and wave the
    // next key through, so its nullability is asserted beside the signing instant's.
    const fp = withLedger.columns.find((c) => c.startsWith("settlement_consumptions.digest_key_fingerprint"));
    expect(fp).toBeDefined();
    expect(fp).toMatch(/null=NO/);

    expect(withLedger.triggers.filter(OWN)).toHaveLength(3); // update, delete, truncate
  });

  it("the ROLLBACK restores the schema EXACTLY — a leftover sequence or trigger is not a rollback", async () => {
    for (const statement of splitSqlStatements(DOWN)) await db.$executeRawUnsafe(statement);
    const after = await snapshot();
    expect(after).toEqual(empty);

    // And it is re-appliable: a migration that only works once is not a migration.
    for (const statement of splitSqlStatements(UP)) await db.$executeRawUnsafe(statement);
    expect(await snapshot()).toEqual(withLedger);
  }, 60_000);
});
