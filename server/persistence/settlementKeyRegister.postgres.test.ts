// G2 · the register against a REAL database: triggers, constraints and unique indexes.
//
// ON ITS OWN DATABASE, created and dropped by this test, because the schema lives in
// `scripts/migration-design/` and is deliberately NOT in `prisma/migrations/` — a file there is
// applied by `prisma migrate deploy` on every deploy, so committing one would BE the production
// schema change. This mirrors the obligation-attribution migration test exactly.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSettlementKeyRegister } from "./settlementKeyStore";
// REUSED, NOT REWRITTEN. My first attempt split on /;\s*\n/ and dropped only statements that BEGIN
// with `--`, so a statement preceded by comment lines carried them in and the whole script failed to
// apply. The repository already has a dollar-quote-aware splitter that is exported and tested
// directly rather than trusted — a second implementation of one rule is a second thing that can drift.
import { splitSqlStatements } from "./obligationAttributionMigration.postgres.test";
import {
  activateSettlementKey, proposeSettlementKey, resolveForUse, revokeSettlementKeyAsCompromised,
} from "../services/settlementKeyGovernance";
// B3 · THE REAL COMPOSITION, WITH NO DOUBLE. This is the suite that stands behind every permissive
// `senderVerified()` elsewhere: the key register and the institution register, both on this database,
// joined by the production adapter. If the doubles were the only thing behind the gate, the gate
// would be a convention.
import { institutionSenderAuthority } from "../services/institutionSenderAuthority";
import { postgresInstitutionRegister } from "./institutionStore";
import {
  proposeInstitution, verifyInstitution, withdrawInstitution,
  revokeInstitutionIdentityDoubted, DECLARED_CONDITIONS,
} from "../services/institutionGovernance";
import { compromiseAssessment, stateAt, validAt, type SettlementKeyFacts }
  from "../../src/contract/settlementKeyLifecycle";
import type { ActorContext } from "../auth/identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-key-register-up.sql"), "utf8");
const INSTITUTION_UP = readFileSync(
  resolve(REPO, "scripts/migration-design/institution-register-up.sql"), "utf8",
);

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
// `synthetic` as a distinct token, which the pilot harness's own guard requires and which keeps this
// unable to run against anything real even by accident.
const DB_NAME = `nh_synthetic_keyreg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };
const client = (db: string) => new PrismaClient({ datasources: { db: { url: urlFor(db) } } });

let admin: PrismaClient;
let db: PrismaClient;

const FACTS: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
});
const COMPLETE = Object.freeze({
  channelIndependentlyVerified: true,
  keyControlDemonstrated: true, ceremonyRecorded: true,
});
const OPERATOR: ActorContext = { actorId: "op-1", role: "operator", boundaryIds: ["b-alpha"] };
const STEWARD: ActorContext = { actorId: "st-1", role: "steward", boundaryIds: ["b-alpha"] };

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
  for (const statement of splitSqlStatements(UP)) {
    await db.$executeRawUnsafe(statement);
  }
  // B3 · the institution register lives on this database too, because the activation gate now joins
  // the two. Its own constraints are tested in `institutionRegister.postgres.test.ts`; here it is the
  // real answer behind a real activation.
  for (const statement of splitSqlStatements(INSTITUTION_UP)) {
    await db.$executeRawUnsafe(statement);
  }
}, 90_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 60_000);

const reg = () => postgresSettlementKeyRegister(db);
const institutions = () => postgresInstitutionRegister(db);
/**
 * Admitted ONCE for the whole suite, because the register's unique index on
 * `(boundary_id, source_system)` forbids a second institution for this sender — which is the property
 * that makes "the institution for this sender" a well-formed question in the first place.
 */
let senderAdmitted = false;
async function ensureVerifiedSender(): Promise<void> {
  if (senderAdmitted) return;
  // The institution's own verification names a key whose control was demonstrated. It is proposed
  // first and NOT activated: the institution is verified before the keys it authorises go into force,
  // which is the correct order and also avoids a circular dependency.
  await proposeSettlementKey(reg(), OPERATOR, {
    facts: freshKey("k-control-witness"), evidence: COMPLETE, rationale: "challenge-response recorded",
  });
  await verifiedSender(FACTS.sourceSystem, "k-control-witness");
  senderAdmitted = true;
}
const senders = () => institutionSenderAuthority(institutions());

/** Governance identities for the institution register. Proposer ≠ verifier, by identity. */
const GOV_A: ActorContext = { actorId: "gov-a", role: "steward", boundaryIds: ["b-alpha"] };
const GOV_B: ActorContext = { actorId: "gov-b", role: "steward", boundaryIds: ["b-alpha"] };

/**
 * Admit and verify the institution that owns `acme-bank` in `b-alpha`, so the keys below have a
 * sender whose identity is established rather than ticked.
 *
 * SYNTHETIC. The legal entity names itself as not real, and the jurisdiction is `ZZ`.
 */
async function verifiedSender(sourceSystem = FACTS.sourceSystem, keyForControl = "k-live"): Promise<string> {
  const institutionId = `inst-${sourceSystem}`;
  await proposeInstitution(institutions(), GOV_A, {
    facts: {
      institutionId, boundaryId: "b-alpha", sourceSystem, sourceKind: "bank",
      legalEntityName: "Synthetic Test Bank (NOT A REAL INSTITUTION)",
      jurisdiction: "ZZ", registryIdentifier: `ZZ-SYNTHETIC-${sourceSystem}`,
    },
    rationale: "registry lookup completed",
  });
  const citations: Record<string, string> = {};
  for (const c of DECLARED_CONDITIONS) citations[c] = `SYNTHETIC-DOC · ${c}`;
  await verifyInstitution(institutions(), senders0(), GOV_B, {
    institutionId, citations, keyControlDemonstratedByKeyId: keyForControl,
    rationale: "second-person verification",
  });
  return institutionId;
}

/**
 * The key-control source the INSTITUTION's own verification needs — a key that is registered and in
 * force. Deliberately a small local implementation rather than the key register itself: the
 * institution's verification happens before the key it authorises is activated, so asking the key
 * register whether that key is in force would be circular.
 */
const senders0 = () => ({
  async keyInForce(keyId: string) {
    const row = await reg().read(keyId);
    if (row === null) return null;
    return { boundaryId: row.facts.boundaryId, sourceSystem: row.facts.sourceSystem, inForce: true };
  },
});
const freshKey = (id: string): SettlementKeyFacts => ({ ...FACTS, keyId: id });

/**
 * Times derived from the PROPOSAL'S OWN STORED INSTANT, never hardcoded.
 *
 * My first version of this file activated at a fixed `2026-02-02`, while the store stamps the birth
 * event with the database's `CURRENT_TIMESTAMP`. So the activation was dated BEFORE the proposal and
 * the service refused it — correctly: `stateAt` reports `null` at an instant before the key existed,
 * and ACTIVATED may not be applied from `null`. The code was right and the test was wrong, which is
 * why the property is now asserted on purpose further down rather than tripped over.
 */
const after = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const bornAt = async (keyId: string): Promise<string> => {
  const row = (await reg().read(keyId))!;
  return row.events[0]!.at;
};

describe.skipIf(!HAS_DB)("G2 · the register on a real database", () => {
  it("is the positive control: the whole lifecycle survives a round trip", async () => {
    const facts = freshKey("k-live");
    await proposeSettlementKey(reg(), OPERATOR, { facts, evidence: COMPLETE, rationale: "ceremony done" });
    const t0 = await bornAt("k-live");
    await ensureVerifiedSender();
    await activateSettlementKey(reg(), senders(), STEWARD, { keyId: "k-live", rationale: "reviewed", at: after(t0, 1000) });

    const row = await resolveForUse(reg(), "k-live");
    expect(row.facts).toEqual(facts);
    expect(row.evidence).toEqual(COMPLETE);
    expect(stateAt(row.events, after(t0, 60_000))).toEqual({ ok: true, state: "ACTIVE" });
    // The pure validity question, answered end to end from stored rows. The key's declared window is
    // 2026, and the proposal is stamped with the real clock, so the signing instant is inside the
    // window only if the test asks about one — this asserts the lifecycle, not the calendar.
    expect(validAt({ ...row.facts, validUntil: after(t0, 86_400_000) }, row.events, after(t0, 60_000)).valid)
      .toBe(true);
  });

  it("stores an UNKNOWN exposure as NULL and the pure core flags the whole lifetime", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-unk"), evidence: COMPLETE, rationale: "r" });
    const t0 = await bornAt("k-unk");
    await ensureVerifiedSender();
    await activateSettlementKey(reg(), senders(), STEWARD, { keyId: "k-unk", rationale: "r", at: after(t0, 1000) });
    await revokeSettlementKeyAsCompromised(reg(), STEWARD, {
      keyId: "k-unk", rationale: "suspected", exposureFrom: null, at: after(t0, 10_000),
    });
    const row = (await reg().read("k-unk"))!;
    const revocation = row.events.at(-1)!;
    expect(revocation.exposureFrom).toBeNull();
    // The earliest possible attestation is still flagged — unknown is not the revocation date.
    const a = compromiseAssessment(row.events, after(t0, 1000));
    expect(a.status).toBe("FLAGGED_COMPROMISED_WINDOW");
    expect(a.exposureStartUnknown).toBe(true);
  });

  it("round-trips a KNOWN exposure start", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-known"), evidence: COMPLETE, rationale: "r" });
    const t0 = await bornAt("k-known");
    await ensureVerifiedSender();
    const exposure = after(t0, 5000);
    await activateSettlementKey(reg(), senders(), STEWARD, { keyId: "k-known", rationale: "r", at: after(t0, 1000) });
    await revokeSettlementKeyAsCompromised(reg(), STEWARD, {
      keyId: "k-known", rationale: "forensics", exposureFrom: exposure, at: after(t0, 10_000),
    });
    const row = (await reg().read("k-known"))!;
    expect(row.events.at(-1)!.exposureFrom).toBe(exposure);
    expect(compromiseAssessment(row.events, after(t0, 1000)).status).toBe("UNAFFECTED");
    expect(compromiseAssessment(row.events, after(t0, 7000)).status).toBe("FLAGGED_COMPROMISED_WINDOW");
  });

  it("derives the state and stores NO state column", async () => {
    const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'settlement_signing_keys'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain("state");
    expect(names).not.toContain("status");
    expect(names).not.toContain("revoked_at");
  });
});

describe.skipIf(!HAS_DB)("G2 · append-only by trigger, not by convention", () => {
  it("refuses an UPDATE to a key row", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-upd"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(
      `UPDATE "settlement_signing_keys" SET "public_key" = 'x' WHERE "key_id" = 'k-upd'`,
    )).rejects.toThrow(/append-only/);
  });

  it("refuses a DELETE of a key row", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-del"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(`DELETE FROM "settlement_signing_keys" WHERE "key_id" = 'k-del'`))
      .rejects.toThrow(/append-only/);
  });

  it("refuses an UPDATE and a DELETE of a lifecycle event", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-ev"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(
      `UPDATE "settlement_signing_key_events" SET "rationale" = 'x' WHERE "key_id" = 'k-ev'`,
    )).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "settlement_signing_key_events" WHERE "key_id" = 'k-ev'`))
      .rejects.toThrow(/append-only/);
  });

  // S7 · BYPASSING THE APPROVAL PROCESS. A direct INSERT is the obvious route around the service, and
  // the database refuses the shapes that matter even when the service is skipped entirely.
  it("refuses a SECOND birth and a SECOND activation, written directly", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-two"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events" ("event_id","key_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-x','k-two','PROPOSED','a','operator','r')`,
    )).rejects.toThrow();
    await ensureVerifiedSender();
    await activateSettlementKey(reg(), senders(), STEWARD, { keyId: "k-two", rationale: "r", at: after(await bornAt("k-two"), 1000) });
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events" ("event_id","key_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-y','k-two','ACTIVATED','b','steward','r')`,
    )).rejects.toThrow();
  });

  it("refuses an event for a key that does not exist", async () => {
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events" ("event_id","key_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-z','k-ghost','ACTIVATED','a','steward','r')`,
    )).rejects.toThrow();
  });
});

describe.skipIf(!HAS_DB)("G2 · the constraints restate the contract in the database", () => {
  const insertRaw = (over: Record<string, string>) => {
    const v = {
      key_id: "'k-raw'", boundary_id: "'b'", source_system: "'s'", source_kind: "'bank'",
      public_key: "'p'", valid_from: "'2026-01-01'", valid_until: "'2027-01-01'",
      key_witness: `'sha256:${"a".repeat(64)}'`, ...over,
    };
    return db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_keys"
         ("key_id","boundary_id","source_system","source_kind","public_key","valid_from","valid_until",
          "key_witness","channel_independently_verified",
          "key_control_demonstrated","ceremony_recorded","registered_by_actor_id","registered_by_role")
       VALUES (${v.key_id},${v.boundary_id},${v.source_system},${v.source_kind},${v.public_key},
               ${v.valid_from},${v.valid_until},${v.key_witness},true,true,true,'a','operator')`,
    );
  };

  it.each([
    ["an unknown source kind", { source_kind: "'wallet'" }],
    ["an inverted validity window", { valid_from: "'2027-01-01'", valid_until: "'2026-01-01'" }],
    ["a zero-length window", { valid_from: "'2026-01-01'", valid_until: "'2026-01-01'" }],
    ["a malformed witness", { key_witness: "'nope'" }],
    ["a blank key id", { key_id: "'  '" }],
    ["a blank public key", { public_key: "''" }],
  ])("refuses %s", async (_name, over) => {
    await expect(insertRaw(over)).rejects.toThrow();
  });

  // AN EXPOSURE START IS MEANINGFUL ONLY ON A REVOCATION, so NULL elsewhere is unambiguous.
  it("refuses an exposure start on a non-revocation event", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-exp"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events"
         ("event_id","key_id","transition","actor_id","actor_role","rationale","exposure_from")
       VALUES ('e-exp','k-exp','RETIRED','a','steward','r','2026-05-01')`,
    )).rejects.toThrow();
  });

  it("refuses an unknown transition and a blank rationale", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-bad"), evidence: COMPLETE, rationale: "r" });
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events" ("event_id","key_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-b1','k-bad','PAUSED','a','steward','r')`,
    )).rejects.toThrow();
    await expect(db.$executeRawUnsafe(
      `INSERT INTO "settlement_signing_key_events" ("event_id","key_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-b2','k-bad','RETIRED','a','steward','   ')`,
    )).rejects.toThrow();
  });
});

describe.skipIf(!HAS_DB)("G2 · a key cannot be activated before it was proposed", () => {
  // THE PROPERTY MY OWN BROKEN FIXTURE DISCOVERED. The store stamps the birth with the database clock,
  // so an activation dated earlier is an activation of a key that did not yet exist — and `stateAt`
  // answers `null` at that instant rather than DRAFT. Asserted deliberately now, because a property
  // learned by tripping over it is a property nothing is guarding.
  it("refuses an activation dated before the birth event", async () => {
    await proposeSettlementKey(reg(), OPERATOR, { facts: freshKey("k-early"), evidence: COMPLETE, rationale: "r" });
    const t0 = await bornAt("k-early");
    // THE SENDER IS AUTHORISED ON PURPOSE, so the refusal this asserts is the ordering one rather
    // than the institution one. A test that passes for a reason other than the one it names cannot
    // detect the removal of the mechanism it claims to prove.
    await ensureVerifiedSender();
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-early", rationale: "r", at: after(t0, -60_000),
    })).rejects.toThrow(/KEY_ILLEGAL_TRANSITION: ACTIVATED may not be applied from null/);
  });
});

describe.skipIf(!HAS_DB)("B3 · the institution condition, through the REAL composition", () => {
  // NO DOUBLE ANYWHERE IN THIS SUITE. The key register, the institution register and the production
  // adapter, all on this database. Everything a `senderVerified()` double asserts elsewhere rests on
  // what happens here.
  it("refuses activation when NOTHING is registered for the sender", async () => {
    // A sender with no institution at all, and declared conditions complete — which is exactly the
    // state that activated a key before B3, on an operator's tick.
    const facts = { ...freshKey("k-b3-none"), sourceSystem: "nobody-bank" };
    await proposeSettlementKey(reg(), OPERATOR, { facts, evidence: COMPLETE, rationale: "r" });
    const t0 = await bornAt("k-b3-none");
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-none", rationale: "r", at: after(t0, 1000),
    })).rejects.toThrow(/KEY_SENDER_NOT_AUTHORISED.*KEY_INSTITUTION_NOT_REGISTERED/s);
    const row = (await reg().read("k-b3-none"))!;
    expect(row.events.map((e) => e.transition)).toEqual(["PROPOSED"]);
  });

  it("refuses when the institution is registered but only PROPOSED — nobody verified it", async () => {
    const sourceSystem = "proposed-only-bank";
    const facts = { ...freshKey("k-b3-proposed"), sourceSystem };
    await proposeSettlementKey(reg(), OPERATOR, { facts, evidence: COMPLETE, rationale: "r" });
    await proposeInstitution(institutions(), GOV_A, {
      facts: {
        institutionId: `inst-${sourceSystem}`, boundaryId: "b-alpha", sourceSystem, sourceKind: "bank",
        legalEntityName: "Synthetic Proposed Bank (NOT A REAL INSTITUTION)",
        jurisdiction: "ZZ", registryIdentifier: "ZZ-SYNTHETIC-PROP",
      },
      rationale: "proposed, not yet verified",
    });
    const t0 = await bornAt("k-b3-proposed");
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-proposed", rationale: "r", at: after(t0, 1000),
    })).rejects.toThrow(/KEY_INSTITUTION_NOT_VERIFIED/);
  });

  it("permits activation once a SECOND governance identity has verified it", async () => {
    // THE POSITIVE CONTROL FOR THE WHOLE SLICE, end to end with no double: propose the institution,
    // verify it as a different identity, then put the key in force.
    const sourceSystem = "verified-bank";
    const facts = { ...freshKey("k-b3-ok"), sourceSystem };
    await proposeSettlementKey(reg(), OPERATOR, { facts, evidence: COMPLETE, rationale: "r" });
    await verifiedSender(sourceSystem, "k-b3-ok");
    const t0 = await bornAt("k-b3-ok");
    await activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-ok", rationale: "reviewed", at: after(t0, 1000),
    });
    const row = (await reg().read("k-b3-ok"))!;
    expect(stateAt(row.events, after(t0, 60_000))).toEqual({ ok: true, state: "ACTIVE" });
  });

  it("a WITHDRAWN institution cannot put a further key in force", async () => {
    const sourceSystem = "withdrawn-bank";
    await proposeSettlementKey(reg(), OPERATOR, {
      facts: { ...freshKey("k-b3-w1"), sourceSystem }, evidence: COMPLETE, rationale: "r",
    });
    const institutionId = await verifiedSender(sourceSystem, "k-b3-w1");
    await withdrawInstitution(institutions(), GOV_B, {
      institutionId, rationale: "relationship ended",
    });
    await proposeSettlementKey(reg(), OPERATOR, {
      facts: { ...freshKey("k-b3-w2"), sourceSystem }, evidence: COMPLETE, rationale: "r",
    });
    const t0 = await bornAt("k-b3-w2");
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-w2", rationale: "r", at: after(t0, 1000),
    })).rejects.toThrow(/KEY_INSTITUTION_AUTHORITY_WITHDRAWN/);
  });

  it("an institution whose IDENTITY is doubted refuses under its OWN code, not the withdrawal's", async () => {
    // THE TWO MUST STAY DISTINGUISHABLE. A withdrawal says we no longer rely on this institution; a
    // doubted identity says we are not sure who we were talking to, which raises a question about
    // everything it ever signed. One code for both would hide which happened.
    const sourceSystem = "doubted-bank";
    await proposeSettlementKey(reg(), OPERATOR, {
      facts: { ...freshKey("k-b3-d1"), sourceSystem }, evidence: COMPLETE, rationale: "r",
    });
    const institutionId = await verifiedSender(sourceSystem, "k-b3-d1");
    await revokeInstitutionIdentityDoubted(institutions(), GOV_B, {
      institutionId, rationale: "the entity was impersonated",
    });
    await proposeSettlementKey(reg(), OPERATOR, {
      facts: { ...freshKey("k-b3-d2"), sourceSystem }, evidence: COMPLETE, rationale: "r",
    });
    const t0 = await bornAt("k-b3-d2");
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-d2", rationale: "r", at: after(t0, 1000),
    })).rejects.toThrow(/KEY_INSTITUTION_IDENTITY_DOUBTED/);
  });

  it("an institution row that no longer matches its witness authorises NOTHING", async () => {
    // Modelled by inserting the row the tamper would have produced, because the append-only trigger
    // forbids an UPDATE — which is the guarantee. A restore or a migration could still produce one.
    const sourceSystem = "tampered-bank";
    await proposeSettlementKey(reg(), OPERATOR, {
      facts: { ...freshKey("k-b3-t"), sourceSystem }, evidence: COMPLETE, rationale: "r",
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institutions"
         ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
          "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
          "proposed_by_role","proposal_rationale")
       VALUES ('inst-tampered','b-alpha',$1,'bank','Attacker Entity (SYNTHETIC)','ZZ','ZZ-9',$2,
               'gov-a','steward','a restored row')`,
      sourceSystem, `sha256:${"c".repeat(64)}`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-t-b','inst-tampered','PROPOSE','gov-a','steward','restored')`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "governed_institution_events"
         ("event_id","institution_id","transition","actor_id","actor_role","rationale")
       VALUES ('e-t-v','inst-tampered','VERIFY','gov-b','steward','restored')`,
    );
    const t0 = await bornAt("k-b3-t");
    // IT READS AS VERIFIED AND IS STILL REFUSED, which is the point: "this row changed" outranks
    // whatever state the row claims to be in.
    await expect(activateSettlementKey(reg(), senders(), STEWARD, {
      keyId: "k-b3-t", rationale: "r", at: after(t0, 1000),
    })).rejects.toThrow(/KEY_INSTITUTION_RECORD_UNREADABLE/);
  });

  it("the retired column is GONE from the table, so no row can carry the old claim", async () => {
    const cols = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'settlement_signing_keys'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("institution_identity_verified");
    // And the three DECLARED conditions are still there, each in its own column — never one flag.
    expect(names).toContain("channel_independently_verified");
    expect(names).toContain("key_control_demonstrated");
    expect(names).toContain("ceremony_recorded");
  });
});
