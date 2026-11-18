-- G2 · THE GOVERNED SETTLEMENT-KEY REGISTER · K1 Option A.
--
-- NOT IN `prisma/migrations/`, DELIBERATELY. A file there is applied by `prisma migrate deploy` on
-- every deploy, so committing it would BE the production schema change, pending nothing but a deploy —
-- and a production migration is not authorised. This is the same placement the obligation-attribution
-- migration design took, and it is tested the same way: against a database the test itself creates,
-- applies this script to, and drops.
--
-- WHY A REGISTER AND NOT A KMS. NH holds NO private key on this path: the bank or PSP signs and NH only
-- verifies. A KMS protects secrets; a public key is not a secret — it needs INTEGRITY and PROVENANCE.
-- The question this table answers is which public key is genuinely the institution's, who said so, and
-- when it was in force.

-- ── The key: immutable facts only ───────────────────────────────────────────────────────────────
--
-- THERE IS NO `state` COLUMN, AND THAT IS THE POINT. A status column is a mutable cache of an immutable
-- ledger, which this repository has refused for admission decisions, analysis terms, execution events
-- and case status alike. The state is DERIVED from the event table by `stateAt`, which also makes it a
-- function of the instant asked about — a stored column could only ever answer "now".
CREATE TABLE "settlement_signing_keys" (
    "key_id"        TEXT NOT NULL,
    "boundary_id"   TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_kind"   TEXT NOT NULL,
    "public_key"    TEXT NOT NULL,
    "valid_from"    TIMESTAMP(3) NOT NULL,
    "valid_until"   TIMESTAMP(3) NOT NULL,
    -- `sha256:<64 hex>` over the seven immutable facts. Re-verified wherever the row is RESOLVED FOR
    -- USE, never trusted as stored — the register tamper-evidence rule.
    "key_witness"   TEXT NOT NULL,

    -- K5 · the ceremony's DECLARED facts, as THREE separate columns.
    --
    -- Never one `verified` flag. A challenge-response proves CONTROL OF A KEY and nothing about who
    -- holds it, so `key_control_demonstrated` may never stand in for the institution's identity.
    -- Separate columns make that substitution unrepresentable rather than merely discouraged.
    --
    -- ── B3 · `institution_identity_verified` WAS REMOVED FROM THIS CREATE TABLE, 2026-11-18 ──────
    --
    -- It was a BOOLEAN supplied by whoever proposed the key, and `ProposeSettlementKey` is held by
    -- `author` and `operator` — the BENEFICIARY side. Not unchecked (a different identity activates)
    -- but UNEVIDENCED: an activator had nothing to check the claim against. It is now DERIVED from
    -- `governed_institutions` at activation by `senderAuthorityFromState`, which is strictly
    -- stronger — see `src/contract/senderAuthority.ts` and `docs/K5_INSTITUTION_ADMISSION_V1.md`.
    --
    -- REMOVED RATHER THAN LEFT INERT, on the premise this file already states and which still holds,
    -- proved three ways: nothing in `prisma/migrations/` creates this table, its only consumers are
    -- disposable per-test databases that recreate it from these bytes on every run, and there is no
    -- deployed instance to migrate. So there are no historical rows whose value would need
    -- preserving. A retained column would have to carry a value on every new row, and both
    -- candidates are claims nobody makes: `true` asserts an operator verification that no longer
    -- happens, `false` asserts they declined. The honest form is no column.
    --
    -- THE MOMENT ANY DURABLE DATABASE HOLDS THIS TABLE, that licence ends: the correct form is then
    -- an ALTER that leaves historical values in place and relabels them, exactly as
    -- `ADMISSION_CALC_VERSION` was retained because stored rows carry it.
    "channel_independently_verified" BOOLEAN NOT NULL,
    "key_control_demonstrated"       BOOLEAN NOT NULL,
    "ceremony_recorded"              BOOLEAN NOT NULL,

    "registered_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_by_actor_id" TEXT NOT NULL,
    "registered_by_role"     TEXT NOT NULL,

    CONSTRAINT "settlement_signing_keys_pkey" PRIMARY KEY ("key_id")
);

-- The shape the pure contract enforces, restated here so a caller that bypasses the service cannot
-- write a row the verifier would then have to reject at read time.
ALTER TABLE "settlement_signing_keys"
    ADD CONSTRAINT "settlement_signing_keys_kind"
        CHECK ("source_kind" IN ('bank', 'psp')),
    ADD CONSTRAINT "settlement_signing_keys_window"
        CHECK ("valid_from" < "valid_until"),
    ADD CONSTRAINT "settlement_signing_keys_witness_shape"
        CHECK ("key_witness" ~ '^sha256:[a-f0-9]{64}$'),
    ADD CONSTRAINT "settlement_signing_keys_nonblank"
        CHECK (length(btrim("key_id")) > 0 AND length(btrim("boundary_id")) > 0
               AND length(btrim("source_system")) > 0 AND length(btrim("public_key")) > 0);

-- Resolution is by key id; this index serves the tenant-scoped listing a steward needs.
CREATE INDEX "settlement_signing_keys_boundary_idx"
    ON "settlement_signing_keys" ("boundary_id", "source_system");

-- ── The lifecycle ledger ────────────────────────────────────────────────────────────────────────
--
-- `seq` IS A PLAIN NOT-NULL SEQUENCE HERE, AND THE EARLIER CAUTION DOES NOT APPLY. The execution-event
-- log had to make its `seq` nullable because BIGSERIAL backfills in physical heap order, committing a
-- FABRICATED chronology for rows that already existed. This table is NEW, so there are no rows to
-- backfill and every row's append order is genuinely recorded.
CREATE SEQUENCE "settlement_signing_key_events_seq";

CREATE TABLE "settlement_signing_key_events" (
    "event_id"   TEXT NOT NULL,
    "key_id"     TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "actor_id"   TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    -- Required on every transition: a governance decision with no stated reason is not one.
    "rationale"  TEXT NOT NULL,
    "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq"        BIGINT NOT NULL DEFAULT nextval('"settlement_signing_key_events_seq"'),

    -- NULL ON A REVOCATION MEANS *UNKNOWN*, AND IT IS UNAMBIGUOUS BECAUSE THE CHECK BELOW FORBIDS THE
    -- COLUMN ANYWHERE ELSE. Unknown is not "no exposure" and is never read as the revocation date:
    -- the whole of the key's life is then the window.
    "exposure_from" TIMESTAMP(3),

    CONSTRAINT "settlement_signing_key_events_pkey" PRIMARY KEY ("event_id")
);

ALTER TABLE "settlement_signing_key_events"
    ADD CONSTRAINT "settlement_signing_key_events_transition"
        CHECK ("transition" IN ('PROPOSED', 'ACTIVATED', 'RETIRED', 'REVOKED_COMPROMISED')),
    -- An exposure start is meaningful ONLY on a revocation. Elsewhere NULL means "not applicable" and
    -- a value would be a claim nothing could interpret.
    ADD CONSTRAINT "settlement_signing_key_events_exposure_scope"
        CHECK ("transition" = 'REVOKED_COMPROMISED' OR "exposure_from" IS NULL),
    ADD CONSTRAINT "settlement_signing_key_events_rationale"
        CHECK (length(btrim("rationale")) > 0),
    ADD CONSTRAINT "settlement_signing_key_events_key_fk"
        FOREIGN KEY ("key_id") REFERENCES "settlement_signing_keys" ("key_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "settlement_signing_key_events_key_idx"
    ON "settlement_signing_key_events" ("key_id", "at", "seq");

-- A key is BORN ONCE. Two PROPOSED rows for one key would make the derived state depend on which was
-- read first, and `stateAt` refuses such a log — but refusing it at read time is a diagnosis, while
-- refusing it here makes it unwritable.
CREATE UNIQUE INDEX "settlement_signing_key_events_one_birth"
    ON "settlement_signing_key_events" ("key_id")
    WHERE "transition" = 'PROPOSED';

-- There is no resume, so there is at most one activation.
CREATE UNIQUE INDEX "settlement_signing_key_events_one_activation"
    ON "settlement_signing_key_events" ("key_id")
    WHERE "transition" = 'ACTIVATED';

-- ── Append-only, by trigger rather than by convention ───────────────────────────────────────────
--
-- `nh_reject_mutation()` already exists from the EP-2 immutability migration. Both tables are
-- append-only: a key's immutable facts may not be edited (editing them would silently re-point a
-- historical receipt at different key material) and a lifecycle event may not be rewritten.
CREATE TRIGGER settlement_keys_no_update   BEFORE UPDATE   ON "settlement_signing_keys"       FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_keys_no_delete   BEFORE DELETE   ON "settlement_signing_keys"       FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_keys_no_truncate BEFORE TRUNCATE ON "settlement_signing_keys"       FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_key_events_no_update   BEFORE UPDATE   ON "settlement_signing_key_events" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_key_events_no_delete   BEFORE DELETE   ON "settlement_signing_key_events" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_key_events_no_truncate BEFORE TRUNCATE ON "settlement_signing_key_events" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
