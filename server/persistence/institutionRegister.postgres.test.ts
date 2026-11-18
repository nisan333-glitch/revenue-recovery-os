// K5 · the institution register against a REAL database: triggers, constraints and the second person.
//
// ON ITS OWN DATABASE, created and dropped by this test, because the schema lives in
// `scripts/migration-design/` and is deliberately NOT in `prisma/migrations/` — a file there is
// applied by `prisma migrate deploy` on every deploy, so committing one would BE the production
// schema change. This mirrors the settlement-key and obligation-attribution migration tests exactly.
//
// WHAT THIS TEST IS FOR, beyond a round trip. The service already refuses a proposer who verifies
// their own proposal, and `institutionGovernance.test.ts` proves that. THE CONSTRAINT IS THE CONTROL
// AND THE READ IS A DIAGNOSIS: the assertions below bypass the service entirely and write straight to
// the table, because a rule that only the service enforces is a rule a second write path can miss.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresInstitutionRegister } from "./institutionStore";
import { institutionSenderAuthority } from "../services/institutionSenderAuthority";
import { splitSqlStatements } from "./obligationAttributionMigration.postgres.test";
import {
  DECLARED_CONDITIONS,
  proposeInstitution,
  resolveInstitutionForUse,
  revokeInstitutionIdentityDoubted,
  verifyInstitution,
  withdrawInstitution,
  type KeyControlSource,
} from "../services/institutionGovernance";
import {
  INSTITUTION_AUTHORITY_CONDITIONS,
  institutionAuthorityCeiling,
  institutionStateAt,
} from "../../src/contract/institutionAuthority";
import { hashInstitution, type InstitutionFacts } from "../../src/contract/institutionIdentity";
import type { ActorContext } from "../auth/identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const KEY_UP = readFileSync(
  resolve(REPO, "scripts/migration-design/settlement-key-register-up.sql"), "utf8",
);
const UP = readFileSync(resolve(REPO, "scripts/migration-design/institution-register-up.sql"), "utf8");
const DOWN = readFileSync(
  resolve(REPO, "scripts/migration-design/institution-register-down.sql"), "utf8",
);

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
// `synthetic` as a distinct token, which the pilot harness's own guard requires and which keeps this
// unable to run against anything real even by accident.
const DB_NAME = `nh_synthetic_instreg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };
const client = (db: string) => new PrismaClient({ datasources: { db: { url: urlFor(db) } } });

let admin: PrismaClient;
let db: PrismaClient;

const BOUNDARY = "b-k5";
const FACTS: InstitutionFacts = Object.freeze({
  institutionId: "inst-1",
  boundaryId: BOUNDARY,
  sourceSystem: "synthetic-bank",
  sourceKind: "bank" as const,
  // SYNTHETIC. No real institution is named in this repository.
  legalEntityName: "Synthetic Test Bank (NOT A REAL INSTITUTION)",
  jurisdiction: "ZZ",
  registryIdentifier: "ZZ-SYNTHETIC-0000",
});

const ALICE: ActorContext = { actorId: "gov-alice", role: "steward", boundaryIds: [BOUNDARY] };
const BOB: ActorContext = { actorId: "gov-bob", role: "steward", boundaryIds: [BOUNDARY] };

const KEY_ID = "k-synthetic-bank";

/**
 * A key source bound to ONE institution's own source system.
 *
 * Per-institution rather than shared, because every fixture here uses a distinct `sourceSystem` (the
 * unique index below forbids two institutions claiming one sender) and a shared source would hand the
 * wrong sender's demonstrated control to whichever institution asked.
 */
const keysFor = (sourceSystem: string): KeyControlSource => ({
  async keyInForce(keyId) {
    return keyId === KEY_ID
      ? { boundaryId: BOUNDARY, sourceSystem, inForce: true }
      : null;
  },
});

const fullCitations = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of DECLARED_CONDITIONS) out[c] = `SYNTHETIC-DOC-1 · ${c}`;
  return out;
};

beforeAll(async () => {
  if (!HAS_DB) return;
  admin = client("postgres");
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  db = client(DB_NAME);
  // `nh_reject_mutation` comes from the EP-2 immutability migration, so the function must exist first.
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'append-only: % on % is rejected', TG_OP, TG_TABLE_NAME
       USING ERRCODE = 'restrict_violation'; END; $$ LANGUAGE plpgsql;`,
  );
  // THE KEY REGISTER FIRST: the verification table's foreign key points at a registered signing key,
  // which is what makes "control of a key" an established fact rather than a ticked box.
  for (const statement of splitSqlStatements(KEY_UP)) await db.$executeRawUnsafe(statement);
  for (const statement of splitSqlStatements(UP)) await db.$executeRawUnsafe(statement);
  // One registered key for the verification to name. Inserted directly: this test is about the
  // institution register, and the key register has its own suite.
  await db.$executeRawUnsafe(
    `INSERT INTO "settlement_signing_keys"
       ("key_id","boundary_id","source_system","source_kind","public_key","valid_from","valid_until",
        "key_witness","channel_independently_verified",
        "key_control_demonstrated","ceremony_recorded","registered_by_actor_id","registered_by_role")
     VALUES ($1,$2,$3,'bank','PUBKEY','2026-01-01'::timestamp,'2027-01-01'::timestamp,
             $4,true,true,true,'gov-alice','steward')`,
    KEY_ID, BOUNDARY, FACTS.sourceSystem, `sha256:${"a".repeat(64)}`,
  );
}, 90_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 60_000);

const reg = () => postgresInstitutionRegister(db);
/** The same register, named for the adapter's call sites so the two reads are visibly one store. */
const reg2 = () => postgresInstitutionRegister(db);
const fresh = (id: string): InstitutionFacts => ({ ...FACTS, institutionId: id, sourceSystem: `src-${id}` });

const bornAt = async (id: string): Promise<string> => (await reg().read(id))!.events[0]!.at;
const after = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

describe.skipIf(!HAS_DB)("K5 · the register on a real database", () => {
  it("is the positive control: propose then verify survives a round trip", async () => {
    const facts = fresh("inst-live");
    await proposeInstitution(reg(), ALICE, { facts, rationale: "registry lookup completed" });
    const t0 = await bornAt("inst-live");

    await verifyInstitution(reg(), keysFor(facts.sourceSystem), BOB, {
      institutionId: "inst-live",
      citations: fullCitations(),
      keyControlDemonstratedByKeyId: KEY_ID,
      rationale: "second-person verification",
      at: after(t0, 1000),
    });

    const row = await resolveInstitutionForUse(reg(), "inst-live");
    expect(row.facts).toEqual(facts);
    expect(row.witness).toBe(await hashInstitution(facts));
    expect(institutionStateAt(row.events, after(t0, 60_000))).toEqual({ ok: true, state: "VERIFIED" });
    expect(row.verification!.verifiedByActorId).toBe("gov-bob");
    expect(row.verification!.keyId).toBe(KEY_ID);
    for (const c of INSTITUTION_AUTHORITY_CONDITIONS) {
      expect(row.verification!.evidence[c], `${c} is not met after a complete ceremony`).toBe(true);
    }
    expect(institutionAuthorityCeiling(row.events, after(t0, 60_000)).ceiling).toBe("AUTHORITY_VERIFIED");
  });

  it("an unverified institution reads `verification: null`, not an all-false evidence set", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-unver"), rationale: "proposed only" });
    const row = await reg().read("inst-unver");
    expect(row!.verification).toBeNull();
  });
});

describe.skipIf(!HAS_DB)("the DATABASE enforces the second person, not only the service", () => {
  it("refuses a verification row written DIRECTLY where the proposer is the verifier", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-self"), rationale: "proposed" });
    // BYPASSING THE SERVICE ON PURPOSE. The service's refusal is a diagnosis; this is the control.
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
            "legal_entity_citation","regulatory_standing_citation","signatories_citation",
            "channel_citation","fingerprint_citation","ceremony_citation")
         VALUES ('inst-self','gov-alice','steward',$1,'a','b','c','d','e','f')`,
        KEY_ID,
      ),
    ).rejects.toThrow(/INSTITUTION_PROPOSER_MAY_NOT_VERIFY/);
  });

  it("permits the same row when a DIFFERENT identity verifies — so the trigger is not blanket", async () => {
    // A TRIGGER THAT REFUSED EVERYTHING WOULD SATISFY THE ASSERTION ABOVE AND BE USELESS.
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-ok"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
            "legal_entity_citation","regulatory_standing_citation","signatories_citation",
            "channel_citation","fingerprint_citation","ceremony_citation")
         VALUES ('inst-ok','gov-bob','steward',$1,'a','b','c','d','e','f')`,
        KEY_ID,
      ),
    ).resolves.toBeGreaterThan(0);
  });

  it("refuses a verification for an institution that was never proposed, BY NAME", async () => {
    // A BARE `.rejects.toThrow()` COULD NOT SAY WHICH GUARD FIRED, and that is how the first form of
    // this test let a mutation survive: with the trigger's null branch removed, the foreign key
    // refused the row instead and the loose assertion still passed. Two different mechanisms, one
    // indistinguishable pass.
    //
    // Postgres runs a BEFORE INSERT ROW trigger before constraint checks, so the trigger's own
    // message is what a caller sees — and asserting it proves the ORDER as well as the refusal.
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
            "legal_entity_citation","regulatory_standing_citation","signatories_citation",
            "channel_citation","fingerprint_citation","ceremony_citation")
         VALUES ('inst-ghost','gov-bob','steward',$1,'a','b','c','d','e','f')`,
        KEY_ID,
      ),
    ).rejects.toThrow(/INSTITUTION_NOT_PROPOSED/);
  });
});

describe.skipIf(!HAS_DB)("the constraints make the honest record unavoidable", () => {
  it("a blank citation cannot be written, so a bare tick is UNREPRESENTABLE", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-blank"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
            "legal_entity_citation","regulatory_standing_citation","signatories_citation",
            "channel_citation","fingerprint_citation","ceremony_citation")
         VALUES ('inst-blank','gov-bob','steward',$1,'   ','b','c','d','e','f')`,
        KEY_ID,
      ),
    ).rejects.toThrow(/citations_nonblank/);
  });

  it("key control cannot name an unregistered key — control of nothing demonstrates nothing", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-nokey"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
            "legal_entity_citation","regulatory_standing_citation","signatories_citation",
            "channel_citation","fingerprint_citation","ceremony_citation")
         VALUES ('inst-nokey','gov-bob','steward','k-does-not-exist','a','b','c','d','e','f')`,
      ),
    ).rejects.toThrow();
  });

  it("TWO INSTITUTIONS CANNOT CLAIM ONE SENDER in one boundary", async () => {
    // The attack this index exists to stop: a competing legal entity introduced for a source system
    // that is already verified, so that "which institution does this attestation come from?" would
    // depend on which row was read first.
    await proposeInstitution(reg(), ALICE, {
      facts: { ...FACTS, institutionId: "inst-sender-a", sourceSystem: "shared-sender" },
      rationale: "first",
    });
    await expect(
      proposeInstitution(reg(), ALICE, {
        facts: {
          ...FACTS, institutionId: "inst-sender-b", sourceSystem: "shared-sender",
          legalEntityName: "Different Entity (SYNTHETIC)",
        },
        rationale: "second",
      }),
    ).rejects.toThrow();
  });

  it("refuses a sourceKind the settlement path does not understand", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institutions"
           ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
            "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
            "proposed_by_role","proposal_rationale")
         VALUES ('inst-kind','b-k5','src-kind','clearing-house','E','ZZ','ZZ-1',$1,'a','steward','r')`,
        `sha256:${"b".repeat(64)}`,
      ),
    ).rejects.toThrow(/governed_institutions_kind/);
  });

  it("refuses a witness that is not sha256 plus 64 hex", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institutions"
           ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
            "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
            "proposed_by_role","proposal_rationale")
         VALUES ('inst-w','b-k5','src-w','bank','E','ZZ','ZZ-1','sha256:short','a','steward','r')`,
      ),
    ).rejects.toThrow(/witness_shape/);
  });

  it("refuses an event transition outside the four", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-tr"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_events"
           ("event_id","institution_id","transition","actor_id","actor_role","rationale")
         VALUES ('e-bad','inst-tr','UNVERIFY','gov-bob','steward','r')`,
      ),
    ).rejects.toThrow(/events_transition/);
  });

  it("refuses a transition with no stated reason", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-nr"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_events"
           ("event_id","institution_id","transition","actor_id","actor_role","rationale")
         VALUES ('e-nr','inst-nr','WITHDRAW','gov-bob','steward','  ')`,
      ),
    ).rejects.toThrow(/events_rationale/);
  });

  it("an institution is born once and verified once, enforced by the database", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-once"), rationale: "proposed" });
    // BEHAVIOURALLY, THEN STRUCTURALLY. The first form of this test matched the index NAME in the
    // error text; Prisma surfaces `Key (institution_id)=(...) already exists` and not the index's
    // name, so the assertion failed on a guard that was working. A uniqueness violation is what the
    // caller sees, and the catalogue query below is what says WHICH index produced it.
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_events"
           ("event_id","institution_id","transition","actor_id","actor_role","rationale")
         VALUES ('e-birth2','inst-once','PROPOSE','gov-bob','steward','again')`,
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "governed_institution_events"
           ("event_id","institution_id","transition","actor_id","actor_role","rationale")
         VALUES ('e-v1','inst-once','VERIFY','gov-bob','steward','v'),
                ('e-v2','inst-once','VERIFY','gov-carol','steward','v again')`,
      ),
    ).rejects.toThrow(/already exists/);

    const indexes = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'governed_institution_events'`,
    );
    const names = indexes.map((r) => r.indexname);
    expect(names).toContain("governed_institution_events_one_birth");
    expect(names).toContain("governed_institution_events_one_verification");
  });

  it("the birth and verification indexes are PARTIAL, so other transitions repeat freely", async () => {
    // A guard that forbade every repeated transition would satisfy the assertions above and would
    // break the register: WITHDRAW after a REVOKE, and a revocation of an already-withdrawn
    // institution, are both legitimate and both must stay writable.
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-partial"), rationale: "proposed" });
    const t0 = await bornAt("inst-partial");
    await withdrawInstitution(reg(), BOB, {
      institutionId: "inst-partial", rationale: "ended", at: after(t0, 1000),
    });
    await revokeInstitutionIdentityDoubted(reg(), BOB, {
      institutionId: "inst-partial", rationale: "impersonated", at: after(t0, 2000),
    });
    const row = await reg().read("inst-partial");
    expect(row!.events).toHaveLength(3);
  });
});

describe.skipIf(!HAS_DB)("the event log's order is the APPEND order, not a clock alone", () => {
  // `at` IS `timestamp(3)`, SO TIES ARE REAL. Ordering by it alone would be total and not
  // chronological — the execution-event log's own recorded defect, where 4 ties in 40 trials left 2
  // ordered wrongly and a finished execution read as `running`.
  it("two events stamped at the SAME instant come back in the order they were appended", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-tie"), rationale: "proposed" });
    const t0 = await bornAt("inst-tie");
    const tie = after(t0, 1000);
    // Appended in two separate statements, so `seq` genuinely records which came first.
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale","at")
       VALUES ('e-tie-1','inst-tie','WITHDRAW','gov-bob','steward','first',$1::timestamp)`,
      tie,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale","at")
       VALUES ('e-tie-2','inst-tie','REVOKE_IDENTITY_DOUBTED','gov-bob','steward','second',$1::timestamp)`,
      tie,
    );
    const row = await reg().read("inst-tie");
    expect(row!.events.map((e) => e.rationale)).toEqual(["proposed", "first", "second"]);
    // And the two tied events really do share an instant, so the assertion above is about the
    // tie-break rather than about the clock.
    expect(row!.events[1]!.at).toBe(row!.events[2]!.at);
  });

  it("the read's ORDER BY names `seq`, which is what actually decides a tie", async () => {
    // THE LOAD-BEARING HALF, AND IT IS THE STRUCTURAL ONE. The behavioural test above CANNOT induce
    // the failure: with `ORDER BY "at"` alone, Postgres is free to return the tied rows in any order
    // and on this data it happens to return them in heap order, which coincides with append order.
    // So it passes either way, and a reader counting passing assertions would credit the wrong one.
    // This is recorded here rather than left implicit — *a test that cannot fail is not a control.*
    const src = readFileSync(resolve(REPO, "server/persistence/institutionStore.ts"), "utf8");
    expect(src).toMatch(/ORDER BY\s+"at" ASC,\s*"seq" ASC/);
  });

  it("`seq` is NOT NULL here, because the table is new and nothing needed backfilling", async () => {
    // The execution-event log had to make its `seq` nullable: BIGSERIAL backfills in PHYSICAL HEAP
    // ORDER, committing a fabricated chronology for rows that already existed. There are no such rows
    // here, so every row's append order is genuinely recorded — and that difference is asserted
    // rather than assumed, since copying the nullable form would have been the easy mistake.
    const cols = await db.$queryRawUnsafe<{ is_nullable: string }[]>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'governed_institution_events' AND column_name = 'seq'`,
    );
    expect(cols).toEqual([{ is_nullable: "NO" }]);
  });
});

describe.skipIf(!HAS_DB)("append-only, by trigger", () => {
  it("an institution's facts cannot be edited — which would re-point every stored receipt", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-imm"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "governed_institutions" SET "source_system" = 'attacker' WHERE "institution_id" = 'inst-imm'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "governed_institutions" WHERE "institution_id" = 'inst-imm'`),
    ).rejects.toThrow(/append-only/);
  });

  it("a governance event cannot be rewritten or removed", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-ev"), rationale: "proposed" });
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "governed_institution_events" SET "rationale" = 'different' WHERE "institution_id" = 'inst-ev'`,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "governed_institution_events" WHERE "institution_id" = 'inst-ev'`),
    ).rejects.toThrow(/append-only/);
  });

  it("a verification cannot be amended — an amended admission is a NEW admission", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-am"), rationale: "proposed" });
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_verifications"
         ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",
          "legal_entity_citation","regulatory_standing_citation","signatories_citation",
          "channel_citation","fingerprint_citation","ceremony_citation")
       VALUES ('inst-am','gov-bob','steward',$1,'a','b','c','d','e','f')`,
      KEY_ID,
    );
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "governed_institution_verifications" SET "legal_entity_citation" = 'revised'
          WHERE "institution_id" = 'inst-am'`,
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(!HAS_DB)("governance can still stop what it has found", () => {
  it("a withdrawal and then an identity revocation both land, in order", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-stop"), rationale: "proposed" });
    const t0 = await bornAt("inst-stop");
    await withdrawInstitution(reg(), BOB, {
      institutionId: "inst-stop", rationale: "relationship ended", at: after(t0, 1000),
    });
    await revokeInstitutionIdentityDoubted(reg(), BOB, {
      institutionId: "inst-stop", rationale: "entity was impersonated", at: after(t0, 2000),
    });
    const row = await reg().read("inst-stop");
    expect(row!.events.map((e) => e.transition)).toEqual([
      "PROPOSE", "WITHDRAW", "REVOKE_IDENTITY_DOUBTED",
    ]);
    // THE CEILING IS HISTORICAL. Before the withdrawal the institution was merely PROPOSED, so it
    // never reached AUTHORITY_VERIFIED — and after the revocation it certainly does not.
    expect(institutionAuthorityCeiling(row!.events, after(t0, 9000)).ceiling).not.toBe(
      "AUTHORITY_VERIFIED",
    );
  });

  it("a row whose facts no longer match its witness authorises nothing but stays withdrawable", async () => {
    await proposeInstitution(reg(), ALICE, { facts: fresh("inst-tamper"), rationale: "proposed" });
    const t0 = await bornAt("inst-tamper");
    // MODELLED BY INSERTING THE ROW THE TAMPER WOULD HAVE PRODUCED, because the trigger forbids an
    // UPDATE — which is precisely the guarantee. A restore or a migration could still produce one.
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institutions"
         ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
          "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
          "proposed_by_role","proposal_rationale")
       VALUES ('inst-tampered','b-k5','src-tampered','bank','Attacker Entity','ZZ','ZZ-9',$1,
               'gov-alice','steward','a restored row')`,
      // A well-shaped witness that is not this row's.
      `sha256:${"c".repeat(64)}`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-t-birth','inst-tampered','PROPOSE','gov-alice','steward','restored')`,
    );
    await expect(resolveInstitutionForUse(reg(), "inst-tampered")).rejects.toThrow(
      /INSTITUTION_WITNESS_MISMATCH/,
    );
    await expect(
      withdrawInstitution(reg(), BOB, {
        institutionId: "inst-tampered", rationale: "witness mismatch found", at: after(t0, 3000),
      }),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)("B3 · an institution whose governance LOG is unusable authorises nothing", () => {
  // THE GAP A MUTATION FOUND. Nothing exercised the adapter's `!derived.ok` branch, so replacing it
  // with `if (false)` left 167 tests green: the verdict still refused, but with an undefined code and
  // a meaningless message. *A refusal that cannot say why is a refusal nobody can act on.*
  //
  // AND "UNREADABLE" IS NOT A STATE OF THE INSTITUTION. Reporting an unusable log as "not verified"
  // would say somebody looked at the lifecycle and found it incomplete, when in fact the lifecycle
  // cannot be read at all — two different things to go and fix.
  it("a log whose first event is not a birth yields RECORD_UNREADABLE, not a state", async () => {
    const facts = fresh("inst-nolog");
    // Written directly, because the governance service cannot produce this: it always writes PROPOSE
    // first. A restore, a partial migration or a bug could. The `one_birth` index does not require a
    // PROPOSE to exist, only that there is at most one.
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institutions"
         ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
          "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
          "proposed_by_role","proposal_rationale")
       VALUES ($1,$2,$3,'bank',$4,$5,$6,$7,'gov-alice','steward','restored without its birth')`,
      facts.institutionId, facts.boundaryId, facts.sourceSystem, facts.legalEntityName,
      facts.jurisdiction, facts.registryIdentifier, await hashInstitution(facts),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-nolog','inst-nolog','WITHDRAW','gov-bob','steward','no birth precedes this')`,
    );

    const verdict = await institutionSenderAuthority(reg2()).senderAuthority({
      boundaryId: facts.boundaryId, sourceSystem: facts.sourceSystem,
      at: new Date().toISOString(),
    });
    expect(verdict.authorised).toBe(false);
    if (verdict.authorised) throw new Error("unreachable");
    expect(verdict.code).toBe("KEY_INSTITUTION_RECORD_UNREADABLE");
    // THE CODE IS DEFINED AND THE DETAIL NAMES THE PROBLEM — which is what the surviving mutation
    // destroyed while still refusing.
    expect(verdict.detail).toMatch(/unusable governance log/);
    expect(verdict.detail).toMatch(/inst-nolog/);
    // And it is not reported as any of the four institution STATES.
    expect(verdict.code).not.toBe("KEY_INSTITUTION_NOT_VERIFIED");
    expect(verdict.code).not.toBe("KEY_INSTITUTION_AUTHORITY_WITHDRAWN");
  });

  it("the witness is checked BEFORE the log, so a changed row reports the change", async () => {
    // ORDER INSIDE THE ADAPTER: *"this row changed" outranks anything the row claims to be.* A row
    // that is BOTH tampered and missing its birth must report the tamper.
    const facts = fresh("inst-both");
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institutions"
         ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
          "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
          "proposed_by_role","proposal_rationale")
       VALUES ($1,$2,$3,'bank',$4,$5,$6,$7,'gov-alice','steward','tampered and birthless')`,
      facts.institutionId, facts.boundaryId, facts.sourceSystem, facts.legalEntityName,
      facts.jurisdiction, facts.registryIdentifier, `sha256:${"d".repeat(64)}`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-both','inst-both','WITHDRAW','gov-bob','steward','no birth precedes this')`,
    );
    const verdict = await institutionSenderAuthority(reg2()).senderAuthority({
      boundaryId: facts.boundaryId, sourceSystem: facts.sourceSystem,
      at: new Date().toISOString(),
    });
    if (verdict.authorised) throw new Error("unreachable");
    expect(verdict.code).toBe("KEY_INSTITUTION_RECORD_UNREADABLE");
    expect(verdict.detail).toMatch(/no longer hashes to its stored witness/);
    expect(verdict.detail).not.toMatch(/unusable governance log/);
  });
});

describe.skipIf(!HAS_DB)("the rollback script is reversible on a register holding nothing", () => {
  it("applies and re-applies cleanly, and the DOWN leaves no object behind", async () => {
    // ON A SEPARATE DATABASE, so the assertions above are untouched by a drop.
    const name = `${DB_NAME}_rollback`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    const other = client(name);
    try {
      await other.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'append-only'; END; $$ LANGUAGE plpgsql;`,
      );
      for (const s of splitSqlStatements(KEY_UP)) await other.$executeRawUnsafe(s);
      for (const s of splitSqlStatements(UP)) await other.$executeRawUnsafe(s);
      for (const s of splitSqlStatements(DOWN)) await other.$executeRawUnsafe(s);

      const left = await other.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE 'governed_institution%'`,
      );
      expect(left).toEqual([]);
      // And the shared immutability function SURVIVES: it belongs to the EP-2 migration and other
      // tables depend on it, so a DOWN that dropped it would break them.
      const fn = await other.$queryRawUnsafe<{ proname: string }[]>(
        `SELECT proname FROM pg_proc WHERE proname = 'nh_reject_mutation'`,
      );
      expect(fn.length).toBe(1);

      // RE-APPLICABLE: the UP runs again on the cleaned database, which is what makes the DOWN a
      // rollback rather than a one-way demolition.
      for (const s of splitSqlStatements(UP)) await other.$executeRawUnsafe(s);
      const back = await other.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE 'governed_institution%'`,
      );
      expect(back.map((r) => r.table_name).sort()).toEqual([
        "governed_institution_events", "governed_institution_verifications", "governed_institutions",
      ]);
    } finally {
      await other.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  }, 90_000);
});
