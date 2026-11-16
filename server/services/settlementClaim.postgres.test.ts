// G7 · the claim inside a real transaction, against a real database, including real concurrency.
//
// THE TESTS THIS FILE EXISTS FOR ARE THE LAST TWO. Everything above them a read-then-check would also
// satisfy; only two simultaneous transactions can tell whether "one arrival of money is counted once"
// is a control or merely a decision — and only a deliberate rollback can tell whether a failed approval
// burns the arrival forever.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimCitedSettlements } from "./settlementClaim";
import { splitSqlStatements } from "../persistence/obligationAttributionMigration.postgres.test";
import { settlementDigest } from "../persistence/settlementLedgerStore";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";
import type { SettlementReceipt } from "./settlementVerification";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");

const BASE = process.env.DATABASE_URL ?? "";
const HAS_DB = BASE.length > 0;
const DB_NAME = `nh_synthetic_claim_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };

let admin: PrismaClient;
let db: PrismaClient;

const FACT: ExternalSettlementFact = Object.freeze({
  boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  externalSettlementRef: "CR-70001", finality: "BANK_CREDITED", amountMinor: 550000,
  currency: "USD", valueDate: "2026-03-10T00:00:00.000Z",
  correctiveInvoiceRef: "CN-9120", payerExternalRef: "PAYER-7781",
});

let n = 0;
const fact = (ref = `CR-${(n += 1)}`): ExternalSettlementFact => ({ ...FACT, externalSettlementRef: ref });

const receipt = (over: Partial<SettlementReceipt> = {}): SettlementReceipt => ({
  method: "ed25519-v1", scheme: "nh-settlement-v1", keyId: "k-bank-01",
  nonce: `nonce-${randomUUID().replace(/-/g, "").slice(0, 20)}`,
  issuedAt: "2026-03-11T09:30:00.000Z", verifiedAt: "2026-03-12T00:00:00.000Z",
  payloadSha256: `sha256:${"c".repeat(64)}`, signedPayload: "x", signature: "y", publicKeyPem: "z",
  ...over,
});

/** The shape of the real approval: claim the arrivals, then write the proof — in ONE transaction. */
async function approvalTransaction(
  claimRef: string,
  cited: readonly { fact: ExternalSettlementFact }[],
  receipts: readonly SettlementReceipt[],
  thenFail?: Error,
): Promise<readonly string[]> {
  return db.$transaction(async (tx) => {
    const claimed = await claimCitedSettlements(tx, { boundaryId: "b-alpha", claimRef, cited, receipts });
    if (thenFail) throw thenFail; // stands in for a halt, a kernel refusal or a crash after the claim
    return claimed.map((c) => c.settlementDigest);
  });
}

const rowsFor = async (digest: string): Promise<{ claim_ref: string }[]> =>
  db.$queryRawUnsafe<{ claim_ref: string }[]>(
    `SELECT "claim_ref" FROM "settlement_consumptions" WHERE "settlement_digest" = $1`, digest,
  );

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
}, 90_000);

afterAll(async () => {
  if (!HAS_DB) return;
  await db?.$disconnect();
  await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin?.$disconnect();
}, 90_000);

describe.skipIf(!HAS_DB)("G7 · claiming arrivals inside the proof's transaction", () => {
  it("is the positive control: a committed approval holds its arrival", async () => {
    const f = fact();
    const digest = await settlementDigest(f);
    await approvalTransaction("claim-ok", [{ fact: f }], [receipt()]);
    expect((await rowsFor(digest)).map((r) => r.claim_ref)).toEqual(["claim-ok"]);
  });

  it("records the SIGNING instant from the receipt, not the time of the claim", async () => {
    const f = fact();
    const signed = "2026-02-14T09:30:15.250Z";
    await approvalTransaction("claim-signed", [{ fact: f }], [receipt({ issuedAt: signed })]);
    const [row] = await db.$queryRawUnsafe<{ attestation_issued_at: Date; key_id: string }[]>(
      `SELECT "attestation_issued_at","key_id" FROM "settlement_consumptions" WHERE "settlement_digest" = $1`,
      await settlementDigest(f),
    );
    // The receipt is the only source of this. Taking it from the request would let a caller place an
    // arrival outside a future exposure window by saying so.
    expect(row!.attestation_issued_at.toISOString()).toBe(signed);
    expect(row!.key_id).toBe("k-bank-01");
  });

  // ── The two that a read-then-check would also pass, and must still hold ─────────────────────────

  it("an idempotent RETRY of the same claim records nothing new", async () => {
    const f = fact();
    const r = receipt();
    const digest = await settlementDigest(f);
    await approvalTransaction("claim-retry", [{ fact: f }], [r]);
    await approvalTransaction("claim-retry", [{ fact: f }], [r]); // replayed verbatim
    expect(await rowsFor(digest)).toHaveLength(1);
  });

  it("a DIFFERENT claim on the same arrival is refused, and names which rule", async () => {
    const f = fact();
    await approvalTransaction("claim-first", [{ fact: f }], [receipt()]);
    await expect(approvalTransaction("claim-second", [{ fact: f }], [receipt()]))
      .rejects.toThrow(/SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM/);
    expect((await rowsFor(await settlementDigest(f))).map((r) => r.claim_ref)).toEqual(["claim-first"]);
  });

  it("a REPLAYED nonce is refused under its own distinct code — the attestation, not the money", async () => {
    // Different money, same signature. Reporting this as "already counted" would send an operator to
    // look for a duplicate payment that does not exist.
    const r = receipt();
    await approvalTransaction("claim-n1", [{ fact: fact() }], [r]);
    await expect(approvalTransaction("claim-n2", [{ fact: fact() }], [r]))
      .rejects.toThrow(/SETTLEMENT_ATTESTATION_REPLAYED/);
  });

  it("refuses to pair receipts with facts by position when the counts disagree", async () => {
    await expect(approvalTransaction("claim-mismatch", [{ fact: fact() }, { fact: fact() }], [receipt()]))
      .rejects.toThrow(/refusing to pair them by position/);
  });

  // ── THE TWO THIS FILE EXISTS FOR ───────────────────────────────────────────────────────────────

  it("A FAILURE AFTER THE CLAIM BURNS NOTHING: the rollback releases the arrival", async () => {
    // The reason the claim lives in the proof's own transaction rather than before it. If the claim
    // committed separately, a halt or a crash between it and the proof would leave this arrival
    // consumed by a proof that does not exist — unclaimable forever, which is WORSE than the double
    // count the claim exists to prevent.
    const f = fact();
    const digest = await settlementDigest(f);
    await expect(
      approvalTransaction("claim-doomed", [{ fact: f }], [receipt()], new Error("case halted after claim")),
    ).rejects.toThrow(/case halted after claim/);
    expect(await rowsFor(digest)).toHaveLength(0);

    // And the arrival is genuinely still available to a later, successful approval.
    await approvalTransaction("claim-recovered", [{ fact: f }], [receipt()]);
    expect((await rowsFor(digest)).map((r) => r.claim_ref)).toEqual(["claim-recovered"]);
  });

  it("ALL OR NOTHING across several cited arrivals: one refusal releases the others", async () => {
    const taken = fact();
    const fresh = fact();
    await approvalTransaction("claim-owner", [{ fact: taken }], [receipt()]);

    await expect(
      approvalTransaction("claim-greedy", [{ fact: fresh }, { fact: taken }], [receipt(), receipt()]),
    ).rejects.toThrow(/SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM/);

    // The first arrival was claimed before the second was refused. Without the shared transaction it
    // would now be consumed by an approval that produced no proof.
    expect(await rowsFor(await settlementDigest(fresh))).toHaveLength(0);
  });

  it("TWO SIMULTANEOUS APPROVALS ON DIFFERENT CLAIMS: exactly one wins, and the database holds one row", async () => {
    // THE DEFECT THIS CLOSES. `withGovernedCaseMutation` locks THE CASE, so two approvals on two
    // different cases citing one arrival take different locks and do not serialise against each other
    // at all. Both would read "not substantiating anything" and both would write a proof. Only the
    // unique index decides it, and only because the claim shares the proof's transaction.
    const f = fact();
    const digest = await settlementDigest(f);
    const results = await Promise.allSettled([
      approvalTransaction("claim-race-A", [{ fact: f }], [receipt()]),
      approvalTransaction("claim-race-B", [{ fact: f }], [receipt()]),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason))
      .toMatch(/SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM/);

    const rows = await rowsFor(digest);
    expect(rows).toHaveLength(1);
    expect(["claim-race-A", "claim-race-B"]).toContain(rows[0]!.claim_ref);
  }, 30_000);

  it("TWO SIMULTANEOUS RETRIES OF THE SAME CLAIM both succeed, and still hold one row", async () => {
    // The mirror of the test above, and it must NOT refuse: a retry is not a double count, so a client
    // retrying under load must not be told its money was already counted.
    const f = fact();
    const r = receipt();
    const digest = await settlementDigest(f);
    const results = await Promise.allSettled([
      approvalTransaction("claim-same", [{ fact: f }], [r]),
      approvalTransaction("claim-same", [{ fact: f }], [r]),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(await rowsFor(digest)).toHaveLength(1);
  }, 30_000);
});
