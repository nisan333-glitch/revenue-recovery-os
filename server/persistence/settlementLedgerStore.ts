// G5 · THE DURABLE SETTLEMENT LEDGER.
//
// WHAT THIS MAKES TRUE THAT WAS ONLY DECIDED BEFORE. Stage 8's pure core already refuses a replayed
// nonce and an already-counted settlement — from two lists a caller supplies. That is a READ-THEN-
// CHECK, and under concurrency it is advisory rather than a control: two simultaneous approvals citing
// one nonce both read "not seen", both pass, and both proceed. The window is between the read and the
// write, and no amount of care in the decision layer can close it.
//
//   THE CONSTRAINT IS THE CONTROL. THE READ IS A DIAGNOSIS.
//
// So `claim` below does not ask permission and then act. It ATTEMPTS THE INSERT and lets the unique
// indexes decide, then reads back WHO WON. A refusal is therefore a fact about committed state rather
// than about a snapshot that may already be stale.
//
// AND IT DISTINGUISHES A RETRY FROM A DOUBLE COUNT, which stage 8's port could not. That port asked
// `identitiesAlreadySubstantiating(boundaryId)` with no notion of which claim was asking, so an
// idempotent retry of the very claim that recorded an arrival would have been refused as a double
// count. The ledger records `claim_ref`, so "already consumed BY ME" and "already consumed BY ANOTHER"
// are different answers.

import { PrismaClient } from "@prisma/client";
import { prisma as sharedClient } from "../db";
import { settlementIdentity, type ExternalSettlementFact } from "../../src/domain/externalSettlement";
import { sha256Hex } from "../../src/assessment/fingerprint";
import type { ArrivalRestingOnKey } from "../../src/contract/settlementCompromiseReport";

/** `sha256:<64 hex>` over the canonical settlement identity. A digest for uniqueness, not a pseudonym. */
export async function settlementDigest(fact: ExternalSettlementFact): Promise<string> {
  return `sha256:${await sha256Hex(settlementIdentity(fact))}`;
}

export type ClaimOutcome =
  /** Recorded now, by this claim. The arrival is counted once and it is counted here. */
  | { readonly outcome: "RECORDED"; readonly consumptionId: string }
  /** Already recorded BY THIS CLAIM. An idempotent retry, not a double count. */
  | { readonly outcome: "ALREADY_MINE"; readonly consumptionId: string }
  /** Already recorded by a DIFFERENT claim. One arrival of money may be counted once. */
  | { readonly outcome: "TAKEN_BY_ANOTHER_CLAIM"; readonly byClaimRef: string }
  /** This attestation's nonce was already used in this tenant. A signature is single-use. */
  | { readonly outcome: "NONCE_ALREADY_USED"; readonly byClaimRef: string };

export interface SettlementLedgerRecord {
  readonly boundaryId: string;
  readonly claimRef: string;
  readonly settlementDigest: string;
  readonly attestationNonce: string;
  readonly keyId: string;
  /**
   * G6 · when the INSTITUTION SIGNED the attestation, as a normalised ISO-8601 instant.
   *
   * REQUIRED, not optional, and that is the point. An optional field would let an existing caller keep
   * its old behaviour by saying nothing — which is how the proof bypass arose — and an arrival with no
   * recorded signing instant cannot be placed inside or outside a later exposure window. The shape of
   * the value is NOT re-validated here: the column is `TIMESTAMP(3)` and Postgres refuses anything that
   * is not an instant, which is the constraint-is-the-control answer rather than a second copy of the
   * check `verifySettlementAttestation` already performs.
   */
  readonly attestationIssuedAt: string;
}

interface Row {
  readonly consumption_id: string;
  readonly claim_ref: string;
}

/**
 * THE DURABLE LEDGER. Two operations and no third: claim an arrival, and read what a claim holds.
 *
 * There is deliberately NO `release` and NO `delete`. Freeing an arrival to be counted again is the one
 * thing this table exists to prevent, and the append-only triggers refuse it at the database even if a
 * future caller tried.
 */
export class PostgresSettlementLedger {
  constructor(private readonly prisma: PrismaClient = sharedClient) {}

  /**
   * Claim one arrival of money for one claim.
   *
   * ORDER OF DIAGNOSIS MATTERS. On a conflict the nonce is checked FIRST: a replayed signature is a
   * statement about the ATTESTATION, while a taken digest is a statement about the MONEY, and a caller
   * replaying a whole request would otherwise be told their money was already counted when the real
   * problem is that they sent the same signature twice.
   */
  async claim(record: SettlementLedgerRecord): Promise<ClaimOutcome> {
    const consumptionId = `sc-${await sha256Hex(
      `${record.boundaryId}\u0000${record.claimRef}\u0000${record.settlementDigest}`,
    )}`;

    // ON CONFLICT DO NOTHING, then read back. The insert either wins or loses to a committed row, and
    // the row that is there afterwards is the authority. `affected` is not consulted as a verdict on
    // its own: zero rows could mean either unique index fired, and the two are different answers.
    const inserted = await this.prisma.$executeRawUnsafe(
      `INSERT INTO "settlement_consumptions"
         ("consumption_id","boundary_id","claim_ref","settlement_digest","attestation_nonce","key_id",
          "attestation_issued_at")
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamp)
       ON CONFLICT DO NOTHING`,
      consumptionId, record.boundaryId, record.claimRef, record.settlementDigest,
      record.attestationNonce, record.keyId, record.attestationIssuedAt,
    );

    // `inserted` IS USED FOR THE ONE THING IT GENUINELY TELLS US — whether OUR insert landed — and is
    // NEVER used as a verdict on WHY it did not. Zero rows could mean either unique index fired, or
    // that our own deterministic id was already present, and those are three different answers.
    if (inserted === 1) {
      return Object.freeze({ outcome: "RECORDED" as const, consumptionId });
    }

    const mine = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT "consumption_id","claim_ref" FROM "settlement_consumptions" WHERE "consumption_id" = $1`,
      consumptionId,
    );
    if (mine[0] !== undefined) {
      // The row with OUR deterministic id is already there: an earlier identical call recorded it.
      // AN IDEMPOTENT RETRY, NOT A DOUBLE COUNT — the distinction stage 8's port could not express.
      return Object.freeze({ outcome: "ALREADY_MINE" as const, consumptionId });
    }

    // We lost. Find out to what — the nonce first, for the reason in the doc comment.
    const byNonce = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT "consumption_id","claim_ref" FROM "settlement_consumptions"
         WHERE "boundary_id" = $1 AND "attestation_nonce" = $2`,
      record.boundaryId, record.attestationNonce,
    );
    if (byNonce[0] !== undefined) {
      return Object.freeze({ outcome: "NONCE_ALREADY_USED" as const, byClaimRef: byNonce[0].claim_ref });
    }

    const byDigest = await this.prisma.$queryRawUnsafe<Row[]>(
      `SELECT "consumption_id","claim_ref" FROM "settlement_consumptions" WHERE "settlement_digest" = $1`,
      record.settlementDigest,
    );
    if (byDigest[0] !== undefined) {
      return Object.freeze({
        outcome: "TAKEN_BY_ANOTHER_CLAIM" as const, byClaimRef: byDigest[0].claim_ref,
      });
    }

    // FAIL CLOSED. The insert did not land and neither index explains it, so the state is not
    // understood — and an arrival of money must never be treated as claimed on an answer we cannot
    // account for.
    throw new Error(
      "settlement ledger: the consumption neither landed nor conflicted on a known index; refusing " +
        "to treat the arrival as claimed",
    );
  }

  /** Which of these nonces are already used in this tenant. Bounded by the input, never a full scan. */
  async nonceAlreadyUsed(boundaryId: string, nonces: readonly string[]): Promise<readonly string[]> {
    if (nonces.length === 0) return Object.freeze([]);
    const rows = await this.prisma.$queryRawUnsafe<{ attestation_nonce: string }[]>(
      `SELECT "attestation_nonce" FROM "settlement_consumptions"
         WHERE "boundary_id" = $1 AND "attestation_nonce" = ANY($2::text[])`,
      boundaryId, nonces,
    );
    return Object.freeze(rows.map((r) => r.attestation_nonce));
  }

  /**
   * Which of these digests are held by a claim OTHER than `claimRef`.
   *
   * THE EXCLUSION IS THE POINT. Without it an idempotent retry of the claim that recorded an arrival
   * would read as a double count — the defect in stage 8's claim-blind port.
   */
  async digestsTakenByOtherClaims(
    boundaryId: string, claimRef: string, digests: readonly string[],
  ): Promise<readonly string[]> {
    if (digests.length === 0) return Object.freeze([]);
    const rows = await this.prisma.$queryRawUnsafe<{ settlement_digest: string }[]>(
      `SELECT "settlement_digest" FROM "settlement_consumptions"
         WHERE "boundary_id" = $1 AND "claim_ref" <> $2 AND "settlement_digest" = ANY($3::text[])`,
      boundaryId, claimRef, digests,
    );
    return Object.freeze(rows.map((r) => r.settlement_digest));
  }

  /** Everything a claim holds, for an audit of what substantiated it. Read-only. */
  async digestsFor(boundaryId: string, claimRef: string): Promise<readonly string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ settlement_digest: string }[]>(
      `SELECT "settlement_digest" FROM "settlement_consumptions"
         WHERE "boundary_id" = $1 AND "claim_ref" = $2 ORDER BY "seq" ASC`,
      boundaryId, claimRef,
    );
    return Object.freeze(rows.map((r) => r.settlement_digest));
  }

  /**
   * Every arrival that rests on one key, for a compromise exposure query.
   *
   * THE QUESTION A COMPROMISED KEY FORCES. `compromiseAssessment` can say whether ONE attestation falls
   * in an exposure window; this says WHICH ARRIVALS to ask it about. Without it, revoking a key would
   * be an act with no way to enumerate what it touched.
   */
  async consumptionsForKey(keyId: string): Promise<readonly ArrivalRestingOnKey[]> {
    const rows = await this.prisma.$queryRawUnsafe<{
      boundary_id: string; claim_ref: string; settlement_digest: string; consumed_at: Date;
      attestation_issued_at: Date | null;
    }[]>(
      `SELECT "boundary_id","claim_ref","settlement_digest","consumed_at","attestation_issued_at"
         FROM "settlement_consumptions" WHERE "key_id" = $1 ORDER BY "seq" ASC`,
      keyId,
    );
    return Object.freeze(rows.map((r) => Object.freeze({
      boundaryId: r.boundary_id, claimRef: r.claim_ref,
      settlementDigest: r.settlement_digest, consumedAt: r.consumed_at.toISOString(),
      // `?? null` IS NOT DEFENSIVE CLUTTER against a NOT NULL column. It is the one place the reader
      // can express *the signing instant is not here*, and `settlementCompromiseReport` places such a
      // row as NOT_ESTABLISHABLE rather than as unaffected. A column constraint protects rows this
      // build writes; it says nothing about a row an older build, a restored dump or a future nullable
      // migration hands back — and reading that silence as "nothing to warn about" is how a deploy skew
      // deletes a warning.
      attestationIssuedAt: r.attestation_issued_at?.toISOString() ?? null,
    })));
  }
}

/**
 * The gate's `SettlementLedger` port, implemented over the durable table.
 *
 * IT TRANSLATES AT THE BOUNDARY, which is the whole reason it exists as a separate adapter: the
 * decision layer reasons in canonical IDENTITIES and the table stores DIGESTS of them. Hashing here
 * keeps the storage form out of the pure core, and returning the caller's own identity strings — not
 * the digests — is what lets the core's `includes()` actually match.
 *
 * AND IT IS A DIAGNOSIS, NOT A CONTROL. These two reads let a refusal name which rule failed before
 * the database has to raise; the unique indexes are what make the rules true. Keeping both is
 * deliberate, and so is saying which is which.
 */
export function settlementLedgerPort(
  ledger: PostgresSettlementLedger,
): import("../services/externalSettlementGate").SettlementLedger {
  return {
    async nonceAlreadyUsed(boundaryId, nonces) {
      if (nonces.length === 0) return Object.freeze([]);
      return ledger.nonceAlreadyUsed(boundaryId, nonces);
    },
    async identitiesSubstantiatingOtherClaims(boundaryId, claimRef, identities) {
      if (identities.length === 0) return Object.freeze([]);
      // Hash each identity, ask the table, and map the hits BACK to the identities the caller gave us.
      const byDigest = new Map<string, string>();
      for (const identity of identities) {
        byDigest.set(`sha256:${await sha256Hex(identity)}`, identity);
      }
      const taken = await ledger.digestsTakenByOtherClaims(boundaryId, claimRef, [...byDigest.keys()]);
      return Object.freeze(taken.map((d) => byDigest.get(d)!).filter((x) => x !== undefined));
    },
  };
}

/**
 * G6 · the ledger as an ARRIVAL READER, with "the table is not here" expressed as a value.
 *
 * WHY THIS ADAPTER EXISTS. The consumptions table lives in `scripts/migration-design/` and
 * deliberately not in `prisma/migrations/`, so a healthy deployment can hold the key register and no
 * ledger at all. Without this translation the governed read would raise a raw Postgres error and the
 * operator would get a 500 that names a relation — a crash where the honest answer is *we could not
 * look*.
 *
 * IT CLASSIFIES ON FAILURE, NEVER BEFORE IT. The happy path is one query. Only when that query fails
 * does it ASK the catalogue whether the table exists, and the distinction matters both ways: probing
 * first would be a read-then-check whose answer could be stale, and assuming "not provisioned" from
 * any failure would swallow a genuine outage as a tidy state. A failure with the table present is
 * RE-THROWN unchanged — fail closed, and let it be seen.
 */
export function ledgerArrivalReader(
  ledger: PostgresSettlementLedger,
  client: PrismaClient = sharedClient,
): import("../services/settlementCompromiseRead").SettlementArrivalReader {
  return {
    async enumerate(keyId) {
      try {
        return Object.freeze({ available: true as const, arrivals: await ledger.consumptionsForKey(keyId) });
      } catch (error) {
        const present = await client.$queryRawUnsafe<{ reg: string | null }[]>(
          `SELECT to_regclass('"settlement_consumptions"')::text AS reg`,
        );
        if (present[0]?.reg != null) throw error;
        return Object.freeze({
          available: false as const,
          reason: "ledger_not_provisioned" as const,
          detail:
            "the settlement consumptions table does not exist in this database, so the arrivals " +
            "resting on this key could not be enumerated; this is NOT a finding that the key signed " +
            "nothing — the ledger's schema is a migration design that has not been applied here",
        });
      }
    },
  };
}
