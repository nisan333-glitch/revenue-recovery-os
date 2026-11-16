// G2 · the Postgres implementation of the settlement-key register port.
//
// RAW SQL, NOT PRISMA MODELS, AND THAT IS FORCED RATHER THAN PREFERRED. The two tables live in
// `scripts/migration-design/settlement-key-register-up.sql` and deliberately NOT in
// `prisma/migrations/`: a file there is applied by `prisma migrate deploy` on every deploy, so
// committing one would BE the production schema change. Until that migration is authorised there is
// no Prisma model to generate, so the store speaks SQL and is tested against a database the test
// itself creates and applies the design script to.
//
// THE STATE IS NEVER READ FROM A COLUMN, because there is no column. It is derived by `stateAt` from
// the event rows this returns, which is also what lets the answer depend on the instant asked about.

import type { PrismaClient } from "@prisma/client";
import { prisma as sharedClient } from "../db";
import type { SettlementKeyEvent, SettlementKeyFacts } from "../../src/contract/settlementKeyLifecycle";
import type { RegisteredSettlementKey, SettlementKeyRegister } from "../services/settlementKeyGovernance";

interface KeyRow {
  readonly key_id: string;
  readonly boundary_id: string;
  readonly source_system: string;
  readonly source_kind: string;
  readonly public_key: string;
  readonly valid_from: Date;
  readonly valid_until: Date;
  readonly key_witness: string;
  readonly channel_independently_verified: boolean;
  readonly institution_identity_verified: boolean;
  readonly key_control_demonstrated: boolean;
  readonly ceremony_recorded: boolean;
  readonly registered_by_actor_id: string;
}

interface EventRow {
  readonly transition: string;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly rationale: string;
  readonly at: Date;
  readonly exposure_from: Date | null;
}

/**
 * THE CLIENT DEFAULTS HERE, NOT AT THE CALL SITE, and that is an architectural rule rather than a
 * convenience. `api.test.ts` asserts that `server/app.ts` contains no `prisma` and no import of
 * `./db` — route handlers must reach persistence through a service or a store, never hold a client
 * themselves. My first version passed the client in from `app.ts` and tripped that guard, which was
 * working exactly as intended. Every other store in this directory takes the same default.
 */
export function postgresSettlementKeyRegister(
  prisma: PrismaClient = sharedClient,
): SettlementKeyRegister {
  return {
    async read(keyId: string): Promise<RegisteredSettlementKey | null> {
      const keys = await prisma.$queryRawUnsafe<KeyRow[]>(
        `SELECT * FROM "settlement_signing_keys" WHERE "key_id" = $1`, keyId,
      );
      const row = keys[0];
      if (row === undefined) return null;

      // ORDERED BY (at, seq), WHICH IS THE APPEND ORDER. `at` is timestamp(3), so ties are real and
      // ordering by it alone would be total and not chronological — the execution-event log's defect.
      // `seq` is NOT NULL here because the table is new and no row needed backfilling.
      const events = await prisma.$queryRawUnsafe<EventRow[]>(
        `SELECT "transition","actor_id","actor_role","rationale","at","exposure_from"
           FROM "settlement_signing_key_events" WHERE "key_id" = $1 ORDER BY "at" ASC, "seq" ASC`,
        keyId,
      );

      const facts: SettlementKeyFacts = Object.freeze({
        keyId: row.key_id,
        boundaryId: row.boundary_id,
        sourceSystem: row.source_system,
        sourceKind: row.source_kind,
        publicKey: row.public_key,
        validFrom: row.valid_from.toISOString(),
        validUntil: row.valid_until.toISOString(),
      });

      return Object.freeze({
        facts,
        witness: row.key_witness,
        evidence: Object.freeze({
          channelIndependentlyVerified: row.channel_independently_verified,
          institutionIdentityVerified: row.institution_identity_verified,
          keyControlDemonstrated: row.key_control_demonstrated,
          ceremonyRecorded: row.ceremony_recorded,
        }),
        registeredByActorId: row.registered_by_actor_id,
        events: Object.freeze(events.map((e) => Object.freeze({
          transition: e.transition as SettlementKeyEvent["transition"],
          actorId: e.actor_id,
          actorRole: e.actor_role,
          rationale: e.rationale,
          at: e.at.toISOString(),
          // NULL ON A REVOCATION MEANS UNKNOWN, and the table's CHECK forbids the column anywhere
          // else, so this is unambiguous rather than merely conventional.
          ...(e.transition === "REVOKED_COMPROMISED"
            ? { exposureFrom: e.exposure_from === null ? null : e.exposure_from.toISOString() }
            : {}),
        }))),
      });
    },

    async insertKey(input): Promise<void> {
      // ONE TRANSACTION. A key row without its birth event would derive no state at all, and
      // `stateAt` would report KEY_NEVER_PROPOSED on a row that plainly exists.
      await prisma.$transaction([
        prisma.$executeRawUnsafe(
          `INSERT INTO "settlement_signing_keys"
             ("key_id","boundary_id","source_system","source_kind","public_key","valid_from",
              "valid_until","key_witness","channel_independently_verified",
              "institution_identity_verified","key_control_demonstrated","ceremony_recorded",
              "registered_by_actor_id","registered_by_role")
           VALUES ($1,$2,$3,$4,$5,$6::timestamp,$7::timestamp,$8,$9,$10,$11,$12,$13,$14)`,
          input.facts.keyId, input.facts.boundaryId, input.facts.sourceSystem, input.facts.sourceKind,
          input.facts.publicKey, input.facts.validFrom, input.facts.validUntil, input.witness,
          input.evidence.channelIndependentlyVerified, input.evidence.institutionIdentityVerified,
          input.evidence.keyControlDemonstrated, input.evidence.ceremonyRecorded,
          input.actor.actorId, input.actor.role,
        ),
        prisma.$executeRawUnsafe(
          `INSERT INTO "settlement_signing_key_events"
             ("event_id","key_id","transition","actor_id","actor_role","rationale")
           VALUES ($1,$2,'PROPOSED',$3,$4,$5)`,
          `ske-${input.facts.keyId}-proposed`, input.facts.keyId,
          input.actor.actorId, input.actor.role, input.rationale,
        ),
      ]);
    },

    async appendEvent(keyId: string, event: SettlementKeyEvent): Promise<void> {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "settlement_signing_key_events"
           ("event_id","key_id","transition","actor_id","actor_role","rationale","at","exposure_from")
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamp,$8::timestamp)`,
        `ske-${keyId}-${event.transition}-${event.at}`, keyId, event.transition,
        event.actorId, event.actorRole, event.rationale, event.at,
        event.exposureFrom ?? null,
      );
    },
  };
}
