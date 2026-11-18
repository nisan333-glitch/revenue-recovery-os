// G7 · THE WHOLE CHAIN, END TO END, ON A REAL DATABASE.
//
// Every slice from stage 8 to G7 has been proved in isolation. This is the first thing that runs them
// AS ONE PATH, in the order a real pilot would, with nothing stubbed between them:
//
//   an institution's key is PROPOSED by one identity and ACTIVATED by another (G2 governance)
//     → the institution SIGNS an attestation over a settlement fact with a key NH never holds
//       → NH VERIFIES it against the governed register (G4: valid-when-signed, then permitted-now)
//         → stage 8 DECIDES sufficiency from server-held facts only
//           → the arrival is CLAIMED in the same transaction that writes the proof (G7)
//             → a second claim on the same arrival is REFUSED, and the proof is never written
//
// WHAT MAKES IT EVIDENCE RATHER THAN A DEMO. The private key is generated per run and is held by this
// file alone — it is never registered, never persisted, and never reachable by the server modules under
// test. So every signature NH accepts was produced by a party NH could not impersonate, which is the
// one property the whole chain exists to establish. The Trust Invariant's standing test, answered by
// construction: the beneficiary cannot mint the evidence.
//
// SYNTHETIC. The bank is a keypair in this process. No institution is verified, no customer data is
// touched, and no observed amount becomes Revenue Returned.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitSqlStatements } from "../persistence/obligationAttributionMigration.postgres.test";
import { postgresSettlementKeyRegister } from "../persistence/settlementKeyStore";
import {
  activateSettlementKey,
  proposeSettlementKey,
  revokeSettlementKeyAsCompromised,
} from "./settlementKeyGovernance";
import { senderUnregistered, senderVerified } from "../test/senderAuthorityDoubles";
import { verifySettlementAgainstRegister } from "./registerBackedSettlementVerification";
import { runExternalSettlementGate } from "./externalSettlementGate";
import { claimCitedSettlements } from "./settlementClaim";
import { readSettlementCompromise } from "./settlementCompromiseRead";
import {
  PostgresSettlementLedger,
  ledgerArrivalReader,
  settlementDigest,
  settlementLedgerPort,
} from "../persistence/settlementLedgerStore";

const DIGEST_KEY = "nh-test-settlement-digest-key-0123456789abcdef";
import { settlementSigningPayload, SettlementVerifier } from "./settlementVerification";
import type { SettlementAttestation, SettlementReceipt } from "./settlementVerification";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";
import type { ActorContext } from "../auth/identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const KEYS_UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-key-register-up.sql"), "utf8");
const LEDGER_UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_e2e_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

let admin: PrismaClient;
let db: PrismaClient;
let register: ReturnType<typeof postgresSettlementKeyRegister>;
let ledger: PostgresSettlementLedger;

// THE INSTITUTION'S KEY. Generated per run; the private half never leaves this module and is never
// given to any server module. NH can verify what it signed and could not have produced it.
const BANK = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey };
})();
const IMPOSTOR = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey };
})();

const BOUNDARY = "b-pilot";
const OPERATOR: ActorContext = { actorId: "pilot-operator@company", role: "operator", boundaryIds: [BOUNDARY] };
const STEWARD: ActorContext = { actorId: "pilot-steward@company", role: "steward", boundaryIds: [BOUNDARY] };
const AUDITOR: ActorContext = { actorId: "pilot-approver@company", role: "approver", boundaryIds: [BOUNDARY] };

const CEREMONY = {
  channelIndependentlyVerified: true,
  keyControlDemonstrated: true, ceremonyRecorded: true,
};

// EVERY INSTANT IS DERIVED FROM THE KEY'S OWN STORED BIRTH, never hardcoded.
//
// `PROPOSED` is stamped with the DATABASE's `CURRENT_TIMESTAMP`, so a fixture that picks a signing
// instant in advance picks one BEFORE the key exists and is refused `SETTLEMENT_KEY_NOT_YET_ACTIVE` —
// which is the register being right and the fixture being wrong. G2's own tests met this exact trap.
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let refSeq = 0;
const settlementFact = (over: Partial<ExternalSettlementFact> = {}): ExternalSettlementFact => ({
  boundaryId: BOUNDARY, sourceSystem: "acme-bank", sourceKind: "bank",
  externalSettlementRef: `CR-E2E-${(refSeq += 1)}`, finality: "BANK_CREDITED",
  amountMinor: 550_000, currency: "USD",
  // DERIVED, NOT FIXED. The gate requires `correctionRaisedAt <= valueDate <= now`, and every instant
  // in this file hangs off the database-stamped key birth — so a hardcoded value date is a fixture
  // that drifts out of the window the moment the clock moves. The first draft of this file had one
  // eight months in the past and the gate refused it, correctly.
  valueDate: new Date().toISOString(),
  correctiveInvoiceRef: "CN-9120", payerExternalRef: "PAYER-7781",
  ...over,
});

/** The institution signs. NH is not in this function. */
const institutionSigns = (
  fact: ExternalSettlementFact,
  keyId: string,
  opts: { issuedAt: string; nonce?: string; by?: typeof BANK },
): SettlementAttestation => {
  const issuedAt = opts.issuedAt;
  const nonce = opts.nonce ?? `nonce-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  return {
    keyId, issuedAt, nonce,
    signature: sign(null, settlementSigningPayload(fact, nonce, issuedAt), (opts.by ?? BANK).privateKey)
      .toString("base64"),
  };
};

interface KeyTimes {
  /** When the register recorded the key as ACTIVE, read back from the stored log. */
  readonly activatedAt: string;
  /** A signing instant the key is genuinely in force at. */
  readonly signedAt: string;
  /** "Now", inside the verifier's signature max-age window. */
  readonly now: string;
}

async function registerAndActivateKey(keyId: string, pem: string): Promise<KeyTimes> {
  await proposeSettlementKey(register, OPERATOR, {
    facts: {
      keyId, boundaryId: BOUNDARY, sourceSystem: "acme-bank", sourceKind: "bank",
      publicKey: pem,
      // A window that genuinely contains the database-stamped birth, derived from the process clock
      // rather than asserted — the register checks the signing instant against BOTH this window and
      // the key's state, and reports which one failed.
      validFrom: plus(new Date().toISOString(), -30 * DAY),
      validUntil: plus(new Date().toISOString(), 365 * DAY),
    },
    evidence: CEREMONY,
    rationale: "synthetic pilot ceremony",
  });
  // THE PROPOSER MAY NOT ACTIVATE. A different identity, enforced by the register, not by this test.
  // B3 · a double for the sender-authority port; the refusing case is exercised below so this file
  // does not quietly make the new gate vacuous.
  await activateSettlementKey(register, senderVerified(), STEWARD, { keyId, rationale: "reviewed" });

  const row = await register.read(keyId);
  const activatedAt = row!.events.find((e) => e.transition === "ACTIVATED")!.at;
  return { activatedAt, signedAt: plus(activatedAt, MINUTE), now: plus(activatedAt, HOUR) };
}

/** The approval shape: verify → decide → claim and write the proof in ONE transaction. */
async function approveWithSettlement(
  claimRef: string,
  cited: readonly { fact: ExternalSettlementFact; attestation: SettlementAttestation }[],
  now: string,
): Promise<{ readonly settledMinor: number; readonly proofId: string }> {
  // 1 · VERIFY against the governed register. Throws on a forged signature, an unregistered key, a key
  //     that was not in force when it signed, or one whose support has since been withdrawn.
  const receipts: SettlementReceipt[] = [];
  for (const { fact, attestation } of cited) {
    receipts.push((await verifySettlementAgainstRegister(register, fact, attestation, now)).receipt);
  }

  // 2 · DECIDE. Every authoritative input is server-held; the request asserts none of them.
  const outcome = await runExternalSettlementGate(
    {
      enabled: true,
      boundaryId: BOUNDARY,
      claimedCollectedMinor: cited.reduce((t, c) => t + c.fact.amountMinor, 0),
      currency: "USD",
      caseCorrectiveInvoiceRef: "CN-9120",
      casePayerExternalRef: "PAYER-7781",
      correctionRaisedAt: plus(now, -5 * DAY),
      claimRef,
      cited,
    },
    new SettlementVerifier([{
      keyId: cited[0]!.attestation.keyId, boundaryId: BOUNDARY, sourceSystem: "acme-bank",
      sourceKind: "bank", publicKey: BANK.pem,
    }], () => Date.parse(now)),
    settlementLedgerPort(ledger, DIGEST_KEY),
  );
  const verdict = outcome.verdict;
  if (!verdict.sufficient) throw new Error(`${verdict.code}: ${verdict.reason}`);
  // Bound to a local BEFORE the transaction closure: narrowing does not survive the closure boundary,
  // and the alternative — asserting the shape inside — would be a cast where a narrowing belongs.
  const settledMinor = verdict.settledMinor;

  // 3 · CLAIM AND WRITE, ATOMICALLY. The proof here is a marker row standing in for the governed
  //     `Proof`, because this database carries the settlement schemas rather than the whole product;
  //     what is being proved is that the claim and the write share a transaction, not what the row is.
  const proofId = `PF-${claimRef}`;
  await db.$transaction(async (tx) => {
    await claimCitedSettlements(tx, { boundaryId: BOUNDARY, claimRef, cited, receipts }, DIGEST_KEY);
    await tx.$executeRawUnsafe(
      `INSERT INTO "e2e_proof" ("proof_id","claim_ref","collected_minor") VALUES ($1,$2,$3)`,
      proofId, claimRef, settledMinor,
    );
  });
  return { settledMinor, proofId };
}

const proofCount = async (): Promise<number> => {
  const [r] = await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "e2e_proof"`);
  return Number(r!.c);
};

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
  for (const s of splitSqlStatements(KEYS_UP)) await db.$executeRawUnsafe(s);
  for (const s of splitSqlStatements(LEDGER_UP)) await db.$executeRawUnsafe(s);
  await db.$executeRawUnsafe(
    `CREATE TABLE "e2e_proof" ("proof_id" TEXT PRIMARY KEY, "claim_ref" TEXT NOT NULL,
       "collected_minor" BIGINT NOT NULL)`,
  );
  register = postgresSettlementKeyRegister(db);
  ledger = new PostgresSettlementLedger(db);
}, 120_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 90_000);

describe.skipIf(!HAS_DB)("B3 · the sender-authority gate is NOT vacuous in this suite", () => {
  // Every key activated above goes through `senderVerified()`, so without this the new gate could be
  // deleted and this file would stay green. The refusal runs on the same real register.
  it("a key whose sender has no registered institution never reaches ACTIVE", async () => {
    const register = postgresSettlementKeyRegister();
    const keyId = `k-b3-e2e-${randomUUID().slice(0, 8)}`;
    await proposeSettlementKey(register, OPERATOR, {
      facts: {
        keyId, boundaryId: BOUNDARY, sourceSystem: "unknown-bank", sourceKind: "bank",
        publicKey: BANK.pem,
        validFrom: plus(new Date().toISOString(), -30 * DAY),
        validUntil: plus(new Date().toISOString(), 365 * DAY),
      },
      evidence: CEREMONY,
      rationale: "declared conditions complete, institution unknown",
    });
    await expect(
      activateSettlementKey(register, senderUnregistered(), STEWARD, { keyId, rationale: "reviewed" }),
    ).rejects.toThrow(/KEY_INSTITUTION_NOT_REGISTERED/);
    const row = await register.read(keyId);
    expect(row!.events.map((e) => e.transition)).toEqual(["PROPOSED"]);
  });
});

describe.skipIf(!HAS_DB)("G7 · end to end · an external attestation becomes a counted arrival, once", () => {
  it("THE POSITIVE CONTROL: ceremony → signature → verification → decision → claim → proof", async () => {
    const keyId = `k-bank-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);

    const fact = settlementFact();
    const attestation = institutionSigns(fact, keyId, { issuedAt: t.signedAt });
    const before = await proofCount();

    const { settledMinor, proofId } = await approveWithSettlement("claim-e2e-1", [{ fact, attestation }], t.now);

    expect(settledMinor).toBe(550_000);
    expect(await proofCount()).toBe(before + 1);

    // The arrival is recorded against the key that verified it and the instant the INSTITUTION signed.
    const [row] = await db.$queryRawUnsafe<{ key_id: string; claim_ref: string; attestation_issued_at: Date }[]>(
      `SELECT "key_id","claim_ref","attestation_issued_at" FROM "settlement_consumptions"
         WHERE "settlement_digest" = $1`,
      settlementDigest(fact, DIGEST_KEY),
    );
    expect(row).toMatchObject({ key_id: keyId, claim_ref: "claim-e2e-1" });
    expect(row!.attestation_issued_at.toISOString()).toBe(t.signedAt);
    expect(proofId).toBe("PF-claim-e2e-1");
  }, 60_000);

  it("THE SAME ARRIVAL CANNOT BE COUNTED BY A SECOND CLAIM, and no second proof is written", async () => {
    const keyId = `k-bank-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);
    const fact = settlementFact();

    await approveWithSettlement(
      "claim-once-A", [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: t.signedAt }) }], t.now,
    );
    const after = await proofCount();

    // A DIFFERENT claim, a FRESH signature over the same money. The attestation verifies perfectly —
    // it is the ARRIVAL that is already spent, which is the distinction the ledger exists to hold.
    await expect(
      approveWithSettlement(
        "claim-once-B", [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: t.signedAt }) }], t.now,
      ),
    ).rejects.toThrow(/SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM|SETTLEMENT_ALREADY_SUBSTANTIATED/);

    expect(await proofCount()).toBe(after);
  }, 60_000);

  it("A FORGED SIGNATURE NEVER REACHES THE LEDGER: verification throws before any claim", async () => {
    const keyId = `k-bank-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);
    const fact = settlementFact();
    const forged = institutionSigns(fact, keyId, { issuedAt: t.signedAt, by: IMPOSTOR });
    const before = await proofCount();

    await expect(approveWithSettlement("claim-forged", [{ fact, attestation: forged }], t.now))
      .rejects.toThrow(/does not verify/);

    expect(await proofCount()).toBe(before);
    expect(await ledger.consumptionsForKey(keyId)).toEqual([]);
  }, 60_000);

  it("AN UNREGISTERED KEY IS A 404, NOT A SILENT PASS", async () => {
    const fact = settlementFact();
    const now = new Date().toISOString();
    await expect(
      approveWithSettlement(
        "claim-unknown",
        [{ fact, attestation: institutionSigns(fact, "k-never-registered", { issuedAt: now }) }],
        now,
      ),
    ).rejects.toThrow(/is not registered/);
  }, 60_000);

  it("A KEY STILL IN DRAFT CANNOT SUPPORT A PROOF — proposing is not activating", async () => {
    const keyId = `k-draft-${randomUUID().slice(0, 8)}`;
    await proposeSettlementKey(register, OPERATOR, {
      facts: {
        keyId, boundaryId: BOUNDARY, sourceSystem: "acme-bank", sourceKind: "bank",
        publicKey: BANK.pem,
        validFrom: plus(new Date().toISOString(), -30 * DAY),
        validUntil: plus(new Date().toISOString(), 365 * DAY),
      },
      evidence: CEREMONY,
      rationale: "proposed but deliberately not activated",
    });
    const fact = settlementFact();
    const now = new Date().toISOString();
    await expect(
      approveWithSettlement("claim-draft", [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: now }) }], now),
    ).rejects.toThrow(/SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING|NOT_YET_ACTIVE/);
  }, 60_000);

  it("A REVOKED KEY SUPPORTS NO NEW PROOF, AND THE ARRIVALS IT ALREADY SIGNED ARE ENUMERATED", async () => {
    const keyId = `k-revoked-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);

    // One good arrival BEFORE the compromise is discovered.
    const early = settlementFact();
    await approveWithSettlement(
      "claim-pre-revoke", [{ fact: early, attestation: institutionSigns(early, keyId, { issuedAt: t.signedAt }) }],
      t.now,
    );

    // Governance learns the key was compromised, with an exposure start AFTER that signature.
    await revokeSettlementKeyAsCompromised(register, STEWARD, {
      // The exposure window opens AFTER the signature above, so that arrival is outside it.
      keyId, rationale: "forensics", exposureFrom: plus(t.signedAt, 10 * MINUTE),
      at: plus(t.signedAt, 20 * MINUTE),
    });

    // No NEW proof may rest on it.
    const later = settlementFact();
    await expect(
      approveWithSettlement(
        "claim-post-revoke",
        [{ fact: later, attestation: institutionSigns(later, keyId, { issuedAt: plus(t.signedAt, 30 * MINUTE) }) }],
        t.now,
      ),
    ).rejects.toThrow();

    // AND THE COMPROMISE REPORT ENUMERATES WHAT IT TOUCHED — which is only answerable because the
    // ledger records the instant the institution signed, not the instant NH recorded it.
    const view = await readSettlementCompromise(
      register, ledgerArrivalReader(ledger, db), AUDITOR, keyId, t.now,
    );
    expect(view.compromise).toMatchObject({ declared: true, exposureFrom: plus(t.signedAt, 10 * MINUTE) });
    expect(view.report?.arrivalsExamined).toBe(1);
    // Signed ten minutes before the window opened: outside it, and the report says so rather than
    // flagging every arrival the key ever touched.
    expect(view.report).toMatchObject({ unaffected: 1, flagged: 0, notEstablishable: 0, coverage: "COMPLETE" });
  }, 60_000);

  it("AN UNKNOWN EXPOSURE START FLAGS THE ARRIVAL INSTEAD — unknown is not 'the revocation date'", async () => {
    const keyId = `k-unknown-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);
    const fact = settlementFact();
    await approveWithSettlement(
      "claim-unknown-exposure",
      [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: t.signedAt }) }], t.now,
    );

    await revokeSettlementKeyAsCompromised(register, STEWARD, {
      keyId, rationale: "no forensic start established", exposureFrom: null,
      at: plus(t.signedAt, 20 * MINUTE),
    });

    const view = await readSettlementCompromise(
      register, ledgerArrivalReader(ledger, db), AUDITOR, keyId, t.now,
    );
    expect(view.compromise).toMatchObject({ declared: true, exposureStartUnknown: true });
    expect(view.report).toMatchObject({ flagged: 1, unaffected: 0 });
    // The proof itself is untouched: a flagged arrival raises a question about evidence and reverses
    // nothing. This is the constitution's per-row marker, not a rewrite of history.
    const [p] = await db.$queryRawUnsafe<{ collected_minor: bigint }[]>(
      `SELECT "collected_minor" FROM "e2e_proof" WHERE "claim_ref" = 'claim-unknown-exposure'`,
    );
    expect(Number(p!.collected_minor)).toBe(550_000);
  }, 60_000);

  it("TWO SIMULTANEOUS APPROVALS ON ONE ARRIVAL: one proof, one consumption, one refusal", async () => {
    const keyId = `k-race-${randomUUID().slice(0, 8)}`;
    const t = await registerAndActivateKey(keyId, BANK.pem);
    const fact = settlementFact();
    const before = await proofCount();

    const results = await Promise.allSettled([
      approveWithSettlement(
        "claim-race-1", [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: t.signedAt }) }], t.now,
      ),
      approveWithSettlement(
        "claim-race-2", [{ fact, attestation: institutionSigns(fact, keyId, { issuedAt: t.signedAt }) }], t.now,
      ),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await proofCount()).toBe(before + 1);
    const [c] = await db.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*) AS c FROM "settlement_consumptions" WHERE "settlement_digest" = $1`,
      settlementDigest(fact, DIGEST_KEY),
    );
    expect(Number(c!.c)).toBe(1);
  }, 60_000);

  it("THE PRIVATE KEY IS NEVER PERSISTED: the register holds only the public half", async () => {
    // The property that makes every acceptance above meaningful. If NH could reach the private key the
    // chain would prove nothing, because NH could have produced the signature itself.
    const rows = await db.$queryRawUnsafe<{ public_key: string }[]>(
      `SELECT "public_key" FROM "settlement_signing_keys"`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.public_key).toContain("BEGIN PUBLIC KEY");
      expect(r.public_key).not.toContain("PRIVATE KEY");
    }
    const priv = BANK.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(rows.map((r) => r.public_key).join("\n")).not.toContain(priv);
  }, 60_000);
});
