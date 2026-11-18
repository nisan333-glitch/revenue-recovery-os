// K5 · the Postgres implementation of the institution register port.
//
// RAW SQL, NOT PRISMA MODELS, AND THAT IS FORCED RATHER THAN PREFERRED. The three tables live in
// `scripts/migration-design/institution-register-up.sql` and deliberately NOT in
// `prisma/migrations/`: a file there is applied by `prisma migrate deploy` on every deploy, so
// committing one would BE the production schema change. Until that migration is authorised there is
// no Prisma model to generate, so the store speaks SQL and is tested against a database the test
// itself creates and applies the design script to.
//
// THE STATE IS NEVER READ FROM A COLUMN, because there is no column. It is derived by
// `institutionStateAt` from the event rows this returns, which is also what lets the answer depend on
// the instant asked about — and a frozen proof needs the answer as of when it was approved.
//
// THE SIX CITATIONS ARE COLUMNS AND THE CONDITIONS ARE DERIVED FROM THEM. The table stores what
// someone cited; `true` is what a non-blank citation MEANS. Storing the booleans as well would be two
// representations of one fact, and the one that could disagree is the one that would be read.

import type { PrismaClient } from "@prisma/client";
import { prisma as sharedClient } from "../db";
import type {
  InstitutionAuthorityCondition,
  InstitutionAuthorityEvent,
  InstitutionAuthorityEvidence,
} from "../../src/contract/institutionAuthority";
import type { InstitutionFacts } from "../../src/contract/institutionIdentity";
import type { InstitutionRegister, RegisteredInstitution } from "../services/institutionGovernance";

interface InstitutionRow {
  readonly institution_id: string;
  readonly boundary_id: string;
  readonly source_system: string;
  readonly source_kind: string;
  readonly legal_entity_name: string;
  readonly jurisdiction: string;
  readonly registry_identifier: string;
  readonly institution_witness: string;
  readonly proposed_by_actor_id: string;
}

interface EventRow {
  readonly transition: string;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly rationale: string;
  readonly at: Date;
}

interface VerificationRow {
  readonly verified_by_actor_id: string;
  readonly verified_by_role: string;
  readonly legal_entity_citation: string;
  readonly regulatory_standing_citation: string;
  readonly signatories_citation: string;
  readonly channel_citation: string;
  readonly fingerprint_citation: string;
  readonly ceremony_citation: string;
  readonly key_control_key_id: string;
}

/**
 * Which column holds which condition's citation.
 *
 * ONE MAP, USED IN BOTH DIRECTIONS. The read and the write both go through it, so a column renamed on
 * one side cannot silently disagree with the other — two hand-written mappings of the same six facts
 * is two things that can drift.
 */
const CITATION_COLUMN: Readonly<Record<string, InstitutionAuthorityCondition>> = Object.freeze({
  legal_entity_citation: "legalEntityVerifiedIndependently",
  regulatory_standing_citation: "regulatoryStandingVerified",
  signatories_citation: "authorisedSignatoriesEstablished",
  channel_citation: "channelIndependentlyVerified",
  fingerprint_citation: "keyFingerprintConfirmedOutOfBand",
  ceremony_citation: "ceremonyRecorded",
});

/** The column order the INSERT uses, fixed so the placeholder list cannot drift from it. */
const CITATION_COLUMNS: readonly string[] = Object.freeze(Object.keys(CITATION_COLUMN));

/**
 * THE CLIENT DEFAULTS HERE, NOT AT THE CALL SITE, and that is an architectural rule rather than a
 * convenience: `api.test.ts` asserts that `server/app.ts` holds no client and imports no `./db`, so a
 * route must reach persistence through a service or a store. Every other store here does the same.
 */
export function postgresInstitutionRegister(
  prisma: PrismaClient = sharedClient,
): InstitutionRegister {
  return {
    async findBySender(boundaryId: string, sourceSystem: string): Promise<RegisteredInstitution | null> {
      // RESOLVED TO AN ID AND THEN READ THROUGH THE SAME PATH, never a second assembly of the row.
      // Two readers of one table is two things that can drift, and the one that disagreed would be the
      // one a key's activation consulted.
      const rows = await prisma.$queryRawUnsafe<{ institution_id: string }[]>(
        `SELECT "institution_id" FROM "governed_institutions"
          WHERE "boundary_id" = $1 AND "source_system" = $2`,
        boundaryId, sourceSystem,
      );
      if (rows.length === 0) return null;
      if (rows.length > 1) {
        // UNREACHABLE WHILE THE UNIQUE INDEX EXISTS, and asserted rather than assumed: silently taking
        // the first would let a second row decide which legal entity authorises a sender, by position.
        throw new Error(
          `institution register: ${rows.length} institutions claim sender '${sourceSystem}' in this ` +
            "boundary; the unique index that forbids this is missing or was dropped",
        );
      }
      return this.read(rows[0]!.institution_id);
    },

    async read(institutionId: string): Promise<RegisteredInstitution | null> {
      const rows = await prisma.$queryRawUnsafe<InstitutionRow[]>(
        `SELECT * FROM "governed_institutions" WHERE "institution_id" = $1`, institutionId,
      );
      const row = rows[0];
      if (row === undefined) return null;

      // ORDERED BY (at, seq), WHICH IS THE APPEND ORDER. `at` is timestamp(3), so ties are real and
      // ordering by it alone would be total and not chronological — the execution-event log's defect.
      // `seq` is NOT NULL here because the table is new and no row needed backfilling.
      const events = await prisma.$queryRawUnsafe<EventRow[]>(
        `SELECT "transition","actor_id","actor_role","rationale","at"
           FROM "governed_institution_events" WHERE "institution_id" = $1
          ORDER BY "at" ASC, "seq" ASC`,
        institutionId,
      );

      const verifications = await prisma.$queryRawUnsafe<VerificationRow[]>(
        `SELECT * FROM "governed_institution_verifications" WHERE "institution_id" = $1`,
        institutionId,
      );
      const v = verifications[0];

      const facts: InstitutionFacts = Object.freeze({
        institutionId: row.institution_id,
        boundaryId: row.boundary_id,
        sourceSystem: row.source_system,
        sourceKind: row.source_kind as InstitutionFacts["sourceKind"],
        legalEntityName: row.legal_entity_name,
        jurisdiction: row.jurisdiction,
        registryIdentifier: row.registry_identifier,
      });

      return Object.freeze({
        facts,
        witness: row.institution_witness,
        proposedByActorId: row.proposed_by_actor_id,
        events: Object.freeze(events.map((e) => Object.freeze({
          transition: e.transition as InstitutionAuthorityEvent["transition"],
          actorId: e.actor_id,
          actorRole: e.actor_role,
          rationale: e.rationale,
          at: e.at.toISOString(),
        }))),
        // NO ROW MEANS NOBODY HAS VERIFIED THIS — `null`, never an all-false evidence set, which would
        // claim eight conditions were examined and none met. "Not computed is not zero", on a record.
        verification: v === undefined ? null : Object.freeze({
          evidence: evidenceFrom(v),
          citations: citationsFrom(v),
          keyId: v.key_control_key_id,
          verifiedByActorId: v.verified_by_actor_id,
          verifiedByRole: v.verified_by_role,
        }),
      });
    },

    async insertInstitution(input): Promise<void> {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "governed_institutions"
           ("institution_id","boundary_id","source_system","source_kind","legal_entity_name",
            "jurisdiction","registry_identifier","institution_witness","proposed_by_actor_id",
            "proposed_by_role","proposal_rationale")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        input.facts.institutionId, input.facts.boundaryId, input.facts.sourceSystem,
        input.facts.sourceKind, input.facts.legalEntityName, input.facts.jurisdiction,
        input.facts.registryIdentifier, input.witness, input.actor.actorId, input.actor.role,
        input.rationale,
      );
    },

    async appendEvent(institutionId: string, event: InstitutionAuthorityEvent): Promise<void> {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "governed_institution_events"
           ("event_id","institution_id","transition","actor_id","actor_role","rationale","at")
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamp)`,
        `gie-${institutionId}-${event.transition}-${event.at}`,
        institutionId, event.transition, event.actorId, event.actorRole, event.rationale, event.at,
      );
    },

    async recordVerification(institutionId, verification): Promise<void> {
      // THE SECOND-PERSON RULE IS ENFORCED BY THE TRIGGER, not by this INSERT. There is no column for
      // it, so there is nothing here that could assert it — which is the point: a verifier cannot
      // state that a second person approved their own verification, because the only thing that
      // decides it is the proposer's own stored actor id.
      const values = CITATION_COLUMNS.map((c) => {
        const condition = CITATION_COLUMN[c]!;
        return verification.citations[condition] ?? "";
      });
      // `verified_by_role` IS NOT NULL IN THE TABLE, and the first version of this INSERT omitted it —
      // caught by the positive control against the real database rather than by a reading. A column
      // the service does not supply is the sort of defect only the real schema can report, and it is
      // why a store without a Postgres-backed positive control is not tested.
      const placeholders = CITATION_COLUMNS.map((_, i) => `$${i + 5}`).join(",");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "governed_institution_verifications"
           ("institution_id","verified_by_actor_id","verified_by_role","key_control_key_id",${
             CITATION_COLUMNS.map((c) => `"${c}"`).join(",")
           })
         VALUES ($1,$2,$3,$4,${placeholders})`,
        institutionId, verification.verifiedByActorId, verification.verifiedByRole,
        verification.keyId, ...values,
      );
    },
  };
}

function citationsFrom(v: VerificationRow): Readonly<Partial<Record<InstitutionAuthorityCondition, string>>> {
  const out: Partial<Record<InstitutionAuthorityCondition, string>> = {};
  for (const [column, condition] of Object.entries(CITATION_COLUMN)) {
    out[condition] = (v as unknown as Record<string, string>)[column]!;
  }
  return Object.freeze(out);
}

/**
 * The evidence set, DERIVED from what is stored rather than stored alongside it.
 *
 * The two server-established conditions are `true` on any row that exists at all: the trigger refuses
 * an insert where the verifier is the proposer, and the foreign key refuses one naming an unregistered
 * key. So a verification row's existence IS the evidence for those two, and there is no column whose
 * value could contradict it.
 */
function evidenceFrom(v: VerificationRow): InstitutionAuthorityEvidence {
  const out = {} as Record<InstitutionAuthorityCondition, boolean>;
  for (const [column, condition] of Object.entries(CITATION_COLUMN)) {
    const cited = (v as unknown as Record<string, string>)[column];
    out[condition] = typeof cited === "string" && cited.trim().length > 0;
  }
  out.secondPersonApproval = true;
  out.keyControlDemonstrated = true;
  return Object.freeze(out) as InstitutionAuthorityEvidence;
}
