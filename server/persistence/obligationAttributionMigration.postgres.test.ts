// GATE B · the proposed obligation-attribution migration, applied and rolled back on an ISOLATED
// synthetic PostgreSQL database, with the invariants measured before and after.
//
// WHAT THIS IS NOT. It is not a deployment and it is not a production schema change: the SQL lives in
// `scripts/migration-design/` and NOT in `prisma/migrations`, so nothing applies it but this test. Gate C
// — owner approval for a production schema change — is unapproved and this file does not approach it.
//
// WHY IT RUNS AGAINST ITS OWN DATABASE. The migration alters a PRIMARY KEY. Running it against the
// database the rest of the suite shares would leave every later test on a schema no migration produced,
// and a green suite would then be evidence about a schema that exists nowhere. So this test creates its
// own database, migrates it with `prisma migrate deploy`, applies the proposal, and drops it afterwards.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A PrismaClient pointed at an ARBITRARY database, via a datasource override.
 *
 * `pg` is not a direct dependency of this repository and adding one for a test would be a production
 * dependency acquired for a non-production reason. The generated Prisma client already speaks to any
 * url, and `$queryRawUnsafe`/`$executeRawUnsafe` carry the DDL this test needs.
 */
type Db = {
  /** SELECT, parameterised. */
  query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => Promise<T[]>;
  /** One parameterised write. Prisma prepares it, so it must be a SINGLE statement. */
  write: (sql: string, ...params: unknown[]) => Promise<void>;
  /**
   * A whole SQL SCRIPT, through `psql`, the way an operator would apply it.
   *
   * NOT through Prisma, and the reason is a measured one: `$executeRawUnsafe` prepares the statement,
   * so a multi-statement migration raises "cannot insert multiple commands into a prepared statement"
   * and a `DO $$ ... $$` block cannot be split on semicolons without corrupting it. Running the real
   * file through the real client is also the more faithful rehearsal.
   */
  script: (sql: string) => Promise<void>;
  end: () => Promise<void>;
};

const ROOT = resolve(__dirname, "../..");
const UP = readFileSync(resolve(ROOT, "scripts/migration-design/obligation-attribution-up.sql"), "utf8");
const DOWN = readFileSync(resolve(ROOT, "scripts/migration-design/obligation-attribution-down.sql"), "utf8");

/** The base URL is reused only for its connection parameters; the DATABASE is this test's own. */
const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
// The name carries `synthetic` as a distinct token, which the pilot harness's own guard requires and
// which keeps this unable to run against anything real even by accident.
const DB_NAME = `nh_synthetic_migtest_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

const urlFor = (db: string) => {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
};

const connect = async (db: string): Promise<Db> => {
  const c = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  return {
    query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
      c.$queryRawUnsafe<T[]>(sql, ...params),
    write: async (sql: string, ...params: unknown[]) => { await c.$executeRawUnsafe(sql, ...params); },
    script: async (sql: string) => {
      const file = resolve(tmpdir(), `nh-mig-${randomUUID()}.sql`);
      writeFileSync(file, sql);
      try {
        execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-f", file, urlFor(db)], {
          stdio: "pipe", encoding: "utf8",
        });
      } catch (err) {
        const e = err as { stderr?: string; stdout?: string; message?: string };
        // psql's own message is what the assertions read, so a refusal raised by the script's own
        // `RAISE EXCEPTION` arrives verbatim instead of wrapped by a driver.
        throw new Error(`${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`);
      } finally {
        rmSync(file, { force: true });
      }
    },
    end: () => c.$disconnect(),
  };
};

const EXEC = "EX-mig-1";
const BOUNDARY = "B-mig-1";
const ACCOUNT = `hmac-sha256:${"a".repeat(64)}`;
const OBLIGATION_1 = `hmac-sha256:${"1".repeat(64)}`;
const OBLIGATION_2 = `hmac-sha256:${"2".repeat(64)}`;

async function seedLegacyRow(c: Db): Promise<void> {
  await c.write(
    `INSERT INTO pilot_assessment_executions
       (execution_id, boundary_id, dataset_fingerprint, admission_decision_id, admission_policy_id,
        admission_policy_version, admission_policy_hash, contract_version, assessment_policy_id,
        assessment_policy_version, calculation_method_version, as_of, stall_threshold_days, currency,
        mapping_id, amount_format, date_locale, binding_hash, input_hash, scheduled_by_actor_id,
        scheduled_by_role)
     VALUES ($1,$2,'fp','PAD-1','pol-1','1.0.0','h','2.0.0','ap-1','1.0.0','calc-1','2026-01-01',30,
             'USD','map-1','plain','iso','sha256:aa','sha256:bb','ops','operator')`,
    EXEC, BOUNDARY,
  );
  await c.write(
    `INSERT INTO pilot_assessment_entity_attributions
       (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
        contributing_cycle_count, attribution_rule, source_ref_key_id)
     VALUES ($1,$2,$3,1000,'USD',1,'rule-v1','k1')`,
    EXEC, BOUNDARY, ACCOUNT,
  );
}

const pk = async (c: Db): Promise<readonly string[]> => {
  const rows = await c.query<{ attname: string }>(
    `SELECT a.attname
       FROM pg_constraint AS con
       JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute AS a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE con.conrelid = 'pilot_assessment_entity_attributions'::regclass
        AND con.contype = 'p'
      ORDER BY k.ord`,
  );
  return rows.map((x) => x.attname);
};

const rowFacts = async (c: Db) => {
  return c.query(
    `SELECT execution_id, source_ref, amount_at_risk_minor::text AS amount, currency,
            contributing_cycle_count::text AS cycles, attribution_rule, source_ref_key_id
       FROM pilot_assessment_entity_attributions
      ORDER BY execution_id, source_ref`,
  );
};

describe.skipIf(!HAS_DB)("Gate B · obligation-attribution migration on an isolated database", () => {
  let admin: Db;
  let db: Db;
  /** Every pre-existing fact about the legacy row, captured before the migration touches anything. */
  let before: Awaited<ReturnType<typeof rowFacts>>;

  beforeAll(async () => {
    admin = await connect("postgres");
    await admin.script(`CREATE DATABASE ${DB_NAME}`);
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: ROOT, env: { ...process.env, DATABASE_URL: urlFor(DB_NAME) }, stdio: "pipe",
    });
    db = await connect(DB_NAME);
    await seedLegacyRow(db);
    before = await rowFacts(db);
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.script(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  });

  it("BEFORE · the key is account-grained and a second obligation is impossible", async () => {
    expect(await pk(db)).toEqual(["execution_id", "source_ref"]);
    expect(before).toHaveLength(1);
    // THE DEFECT, measured rather than asserted: a second row for the same account is refused by the
    // primary key, so the table cannot hold two obligations of one customer at all.
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id)
       VALUES ($1,$2,$3,2000,'USD',1,'rule-v1','k1')`,
      EXEC, BOUNDARY, ACCOUNT,
    )).rejects.toThrow(/already exists|duplicate key|pilot_assessment_entity_attributions_pkey/);
  });

  it("the append-only trigger refuses an UPDATE, which is why no backfill statement exists", async () => {
    await expect(db.write(
      `UPDATE pilot_assessment_entity_attributions SET currency = 'EUR' WHERE execution_id = $1`, EXEC,
    )).rejects.toThrow(/append-only: UPDATE on pilot_assessment_entity_attributions is rejected/);
  });

  it("UP · the migration applies, and every legacy fact is byte-identical afterwards", async () => {
    await db.script(UP);
    expect(await pk(db)).toEqual(["execution_id", "source_ref", "obligation_ref"]);

    // NO ROW WAS REWRITTEN. Every pre-existing column of the legacy row compares equal, which is the
    // claim `ADD COLUMN ... DEFAULT` makes and which is measured here rather than trusted.
    expect(await rowFacts(db)).toEqual(before);

    const legacy = await db.query<{ obligation_ref: string; obligation_provenance: string; obligation_identity_version: string }>(
      `SELECT obligation_ref, obligation_provenance, obligation_identity_version
         FROM pilot_assessment_entity_attributions WHERE execution_id = $1`, EXEC,
    );
    // AND THE LEGACY ROW SAYS ITS IDENTITY IS NOT KNOWN, rather than acquiring one.
    expect(legacy[0]).toEqual({
      obligation_ref: "UNRESOLVED",
      obligation_provenance: "LEGACY_UNRESOLVED",
      obligation_identity_version: "none",
    });
  }, 60_000);

  it("AFTER · two obligations of ONE account now coexist, which is the whole point", async () => {
    for (const [ref, amount] of [[OBLIGATION_1, 700], [OBLIGATION_2, 300]] as const) {
      await db.write(
        `INSERT INTO pilot_assessment_entity_attributions
           (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
            contributing_cycle_count, attribution_rule, source_ref_key_id,
            obligation_ref, obligation_identity_version, obligation_provenance)
         VALUES ($1,$2,$3,$4,'USD',1,'rule-v1','k1',$5,'oblig-2026.1','SERVER_DERIVED_SINGLE_UNIT')`,
        EXEC, BOUNDARY, ACCOUNT, amount, ref,
      );
    }
    const r = await db.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, sum(amount_at_risk_minor)::text AS total
         FROM pilot_assessment_entity_attributions
        WHERE source_ref = $1 AND obligation_provenance = 'SERVER_DERIVED_SINGLE_UNIT'`, ACCOUNT,
    );
    expect(r[0]!.n).toBe("2");
    // NEITHER AMOUNT WAS LOST. 700 + 300 against one account, separately identified.
    expect(r[0]!.total).toBe("1000");
  });

  it("the SAME obligation twice is still refused — splitting the key did not weaken idempotency", async () => {
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id,
          obligation_ref, obligation_identity_version, obligation_provenance)
       VALUES ($1,$2,$3,9999,'USD',1,'rule-v1','k1',$4,'oblig-2026.1','SERVER_DERIVED_SINGLE_UNIT')`,
      EXEC, BOUNDARY, ACCOUNT, OBLIGATION_1,
    )).rejects.toThrow(/already exists|duplicate key|pilot_assessment_entity_attributions_pkey/);
  });

  it("the sentinel cannot become an identity, in either direction", async () => {
    // A real reference with legacy provenance.
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id,
          obligation_ref, obligation_identity_version, obligation_provenance)
       VALUES ($1,$2,$3,10,'USD',1,'r','k',$4,'none','LEGACY_UNRESOLVED')`,
      EXEC, BOUNDARY, `hmac-sha256:${"b".repeat(64)}`, `hmac-sha256:${"9".repeat(64)}`,
    )).rejects.toThrow(/attributions_obligation_provenance_agrees|violates check constraint/);

    // The sentinel claiming a derived identity.
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id,
          obligation_ref, obligation_identity_version, obligation_provenance)
       VALUES ($1,$2,$3,10,'USD',1,'r','k','UNRESOLVED','oblig-2026.1','SERVER_DERIVED_SINGLE_UNIT')`,
      EXEC, BOUNDARY, `hmac-sha256:${"c".repeat(64)}`,
    )).rejects.toThrow(/attributions_obligation_provenance_agrees|violates check constraint/);

    // A raw identifier, which would be a customer value in a pseudonym's place.
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id,
          obligation_ref, obligation_identity_version, obligation_provenance)
       VALUES ($1,$2,$3,10,'USD',1,'r','k','ENT-REAL-0001','oblig-2026.1','SERVER_DERIVED_SINGLE_UNIT')`,
      EXEC, BOUNDARY, `hmac-sha256:${"d".repeat(64)}`,
    )).rejects.toThrow(/attributions_obligation_provenance_agrees|violates check constraint/);

    // And there is NO provenance value by which an operator could assert an identity.
    await expect(db.write(
      `INSERT INTO pilot_assessment_entity_attributions
         (execution_id, boundary_id, source_ref, amount_at_risk_minor, currency,
          contributing_cycle_count, attribution_rule, source_ref_key_id,
          obligation_ref, obligation_identity_version, obligation_provenance)
       VALUES ($1,$2,$3,10,'USD',1,'r','k',$4,'v','OPERATOR_ASSERTED')`,
      EXEC, BOUNDARY, `hmac-sha256:${"e".repeat(64)}`, `hmac-sha256:${"8".repeat(64)}`,
    )).rejects.toThrow(/attributions_obligation_provenance_valid|violates check constraint/);
  });

  it("DOWN · the rollback REFUSES while an account holds two obligations, naming the reason", async () => {
    // THE CUTOVER GATE, measured. Restoring the old key here would require deleting or merging a
    // recorded attribution, so the rollback raises instead of doing it quietly.
    await expect(db.script(DOWN)).rejects.toThrow(/rollback refused: 1 \(execution_id, source_ref\) group/);
    // And it left the schema exactly as it was — a refused rollback is not a partial rollback.
    expect(await pk(db)).toEqual(["execution_id", "source_ref", "obligation_ref"]);
  });

  it("removing a collision needs the FULL governed purge chain, which a rollback cannot manufacture", async () => {
    // FIVE INDEPENDENT CONTROLS stand between this table and a silent delete, and they are asserted in
    // the order an operator meets them rather than read off the schema. The last one is the reason the
    // rollback's "delete the collision" route is NOT the reversible path: a purge claiming completion
    // must be corroborated by a real COMPLETED event, and a rollback rehearsal has no business
    // manufacturing one.
    await expect(db.write(
      `DELETE FROM pilot_assessment_entity_attributions WHERE obligation_ref = $1`, OBLIGATION_2,
    )).rejects.toThrow(/requires a recorded purge authorization/);

    await expect(db.write(
      `INSERT INTO pilot_assessment_input_purges
         (execution_id, boundary_id, reason, input_hash, cycle_count, terminal_grace_hours,
          abandoned_retention_days, authorized_by_actor_id, authorized_by_role)
       VALUES ($1,$2,'gate B rehearsal','sha256:bb',1,24,30,'ops','operator')`,
      EXEC, BOUNDARY,
    )).rejects.toThrow(/input purge reason .* is not recognised/);

    await expect(db.write(
      `INSERT INTO pilot_assessment_input_purges
         (execution_id, boundary_id, reason, input_hash, cycle_count, terminal_grace_hours,
          abandoned_retention_days, authorized_by_actor_id, authorized_by_role)
       VALUES ($1,$2,'terminal_completed','sha256:bb',1,24,30,'ops','operator')`,
      EXEC, BOUNDARY,
    )).rejects.toThrow(/claims completion but no COMPLETED event exists/);

    // SO THE ROW IS STILL THERE, and the rollback is still refused. That pair is the finding: once a
    // derived obligation has been recorded, reversal is a GOVERNANCE action with its own evidence
    // requirements, not a schema operation.
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pilot_assessment_entity_attributions WHERE obligation_ref = $1`,
      OBLIGATION_2,
    );
    expect(n[0]!.n).toBe("1");
    await expect(db.script(DOWN)).rejects.toThrow(/rollback refused/);
  }, 60_000);
});

// ── THE REVERSIBLE WINDOW, ON ITS OWN DATABASE ───────────────────────────────────────────────────────
//
// The cutover plan's claim is narrow and exact: UP is reversible AFTER it is applied and BEFORE the first
// server-derived obligation row is written. That window needs no delete, which is why it is the window —
// and it is rehearsed here on a SECOND isolated database so the first one's derived rows cannot reach it.
describe.skipIf(!HAS_DB)("Gate B · UP then DOWN inside the reversible window is a no-op on history", () => {
  const WINDOW_DB = `nh_synthetic_migwin_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: Db;
  let db: Db;
  let before: Awaited<ReturnType<typeof rowFacts>>;

  beforeAll(async () => {
    admin = await connect("postgres");
    await admin.script(`CREATE DATABASE ${WINDOW_DB}`);
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: ROOT, env: { ...process.env, DATABASE_URL: urlFor(WINDOW_DB) }, stdio: "pipe",
    });
    db = await connect(WINDOW_DB);
    await seedLegacyRow(db);
    before = await rowFacts(db);
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.script(`DROP DATABASE IF EXISTS ${WINDOW_DB} WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  });

  it("applies, reverses, and leaves the schema and the history exactly as they were", async () => {
    expect(await pk(db)).toEqual(["execution_id", "source_ref"]);

    await db.script(UP);
    expect(await pk(db)).toEqual(["execution_id", "source_ref", "obligation_ref"]);
    expect(await rowFacts(db)).toEqual(before);

    // NO derived row is written, so the rollback's precondition holds and it does not refuse.
    await db.script(DOWN);

    // THE SCHEMA IS BACK.
    expect(await pk(db)).toEqual(["execution_id", "source_ref"]);
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'pilot_assessment_entity_attributions'
          AND column_name LIKE 'obligation%'`,
    );
    expect(cols).toEqual([]);
    const constraints = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'pilot_assessment_entity_attributions'::regclass
          AND conname LIKE '%obligation%'`,
    );
    expect(constraints).toEqual([]);

    // AND SO IS THE HISTORY, byte for byte. A migration and its rollback together must change nothing
    // about what was already recorded, and that is the invariant a cutover gate rests on.
    expect(await rowFacts(db)).toEqual(before);

    // The pre-existing protections survived the round trip: the append-only trigger still refuses.
    await expect(db.write(
      `UPDATE pilot_assessment_entity_attributions SET currency = 'EUR' WHERE execution_id = $1`, EXEC,
    )).rejects.toThrow(/append-only: UPDATE on pilot_assessment_entity_attributions is rejected/);
  }, 120_000);
});
