-- K5 · THE GOVERNED INSTITUTION REGISTER · the half a signature cannot supply.
--
-- NOT IN `prisma/migrations/`, DELIBERATELY. A file there is applied by `prisma migrate deploy` on
-- every deploy, so committing it would BE the production schema change, pending nothing but a deploy —
-- and a production migration is not authorised. Same placement and same test strategy as the
-- obligation-attribution, settlement-key and settlement-ledger designs: applied only to a database the
-- test itself creates and drops.
--
-- WHY THIS TABLE EXISTS. `settlement_signing_keys` already proves that an attestation was signed under
-- a registered key. It cannot prove WHO HOLDS that key. The authority ladder's only channel reaching
-- `AUTHORITY_VERIFIED` is third-party reconciliation, whose defining property is that *the third party
-- is not party to the recovery claim* — a statement about who signed, which no quantity of signature
-- checks reaches. This table is where that question is answered, by a registry, a regulator, a
-- published channel and two people at NH.
--
-- AND WHAT IT REPLACES. `settlement_signing_keys.institution_identity_verified` is a BOOLEAN supplied
-- by whoever proposed the key, and `ProposeSettlementKey` is held by the beneficiary side. It is not
-- unchecked — a different identity activates — but it is UNEVIDENCED: an activator has nothing to
-- check it against. The intended end state is that the boolean is DERIVED from this register and
-- REFUSED as an input. That changes the HTTP contract, so it is a separate, owner-approved slice; this
-- script adds a table and alters nothing.

-- ── The institution: immutable facts only ───────────────────────────────────────────────────────
--
-- THERE IS NO `state` COLUMN, AND THAT IS THE POINT. A status column is a mutable cache of an
-- immutable ledger, which this repository has refused for admission decisions, analysis terms,
-- execution events, case status and signing keys alike. The state is DERIVED by `institutionStateAt`,
-- which also makes it a function of the instant asked about — a stored column could only ever answer
-- "now", and a frozen proof needs the answer as of when it was approved.
--
-- IT CARRIES NO PERSON. The authorised signatories are a CONDITION someone established out of band;
-- their names belong in that record, not in a row NH hashes and stores. Minimization, the same choice
-- `DatasetProvenance` and the attestation form both made.
CREATE TABLE "governed_institutions" (
    "institution_id"      TEXT NOT NULL,
    "boundary_id"         TEXT NOT NULL,

    -- THE LOAD-BEARING FIELD. A settlement fact names its source system, and the whole point of this
    -- register is that THAT name has been tied to an independently verified legal entity. If it could
    -- be edited after verification, a verified institution's authority would silently transfer to a
    -- different sender while every stored receipt still pointed here.
    "source_system"       TEXT NOT NULL,
    "source_kind"         TEXT NOT NULL,

    -- The entity as an INDEPENDENT registry names it, with the registry's own identifier so the
    -- lookup can be repeated. "We looked it up" with nothing to look up again is a recollection.
    "legal_entity_name"   TEXT NOT NULL,
    "jurisdiction"        TEXT NOT NULL,
    "registry_identifier" TEXT NOT NULL,

    -- `sha256:<64 hex>` over the seven immutable facts. Re-verified wherever the row is RESOLVED FOR
    -- USE, never trusted as stored — the 2026-10-04 register tamper-evidence rule.
    "institution_witness" TEXT NOT NULL,

    "proposed_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposed_by_actor_id"   TEXT NOT NULL,
    "proposed_by_role"       TEXT NOT NULL,
    "proposal_rationale"     TEXT NOT NULL,

    CONSTRAINT "governed_institutions_pkey" PRIMARY KEY ("institution_id")
);

ALTER TABLE "governed_institutions"
    ADD CONSTRAINT "governed_institutions_kind"
        CHECK ("source_kind" IN ('bank', 'psp')),
    ADD CONSTRAINT "governed_institutions_witness_shape"
        CHECK ("institution_witness" ~ '^sha256:[a-f0-9]{64}$'),
    ADD CONSTRAINT "governed_institutions_nonblank"
        CHECK (length(btrim("institution_id")) > 0 AND length(btrim("boundary_id")) > 0
               AND length(btrim("source_system")) > 0 AND length(btrim("legal_entity_name")) > 0
               AND length(btrim("jurisdiction")) > 0 AND length(btrim("registry_identifier")) > 0
               AND length(btrim("proposal_rationale")) > 0);

-- ONE INSTITUTION PER SENDER, PER BOUNDARY. Two rows claiming the same `(boundary, source_system)`
-- would make "which institution does this attestation come from?" depend on which row was read first
-- — and a second row is exactly how an attacker would introduce a competing legal entity for a sender
-- that is already verified. The constraint is the control; a read-then-check would be advisory.
CREATE UNIQUE INDEX "governed_institutions_one_per_sender"
    ON "governed_institutions" ("boundary_id", "source_system");

-- ── The authority ledger ────────────────────────────────────────────────────────────────────────
--
-- `seq` IS A PLAIN NOT-NULL SEQUENCE HERE, and the execution-event log's caution does not apply: that
-- log had to make `seq` nullable because BIGSERIAL backfills in physical heap order, committing a
-- FABRICATED chronology for rows that already existed. This table is NEW, so there is nothing to
-- backfill and every row's append order is genuinely recorded.
CREATE SEQUENCE "governed_institution_events_seq";

CREATE TABLE "governed_institution_events" (
    "event_id"       TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "transition"     TEXT NOT NULL,
    "actor_id"       TEXT NOT NULL,
    "actor_role"     TEXT NOT NULL,
    -- Required on every transition: a governance decision with no stated reason is not one.
    "rationale"      TEXT NOT NULL,
    "at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq"            BIGINT NOT NULL DEFAULT nextval('"governed_institution_events_seq"'),

    CONSTRAINT "governed_institution_events_pkey" PRIMARY KEY ("event_id")
);

ALTER TABLE "governed_institution_events"
    ADD CONSTRAINT "governed_institution_events_transition"
        CHECK ("transition" IN ('PROPOSE', 'VERIFY', 'WITHDRAW', 'REVOKE_IDENTITY_DOUBTED')),
    ADD CONSTRAINT "governed_institution_events_rationale"
        CHECK (length(btrim("rationale")) > 0),
    ADD CONSTRAINT "governed_institution_events_institution_fk"
        FOREIGN KEY ("institution_id") REFERENCES "governed_institutions" ("institution_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "governed_institution_events_institution_idx"
    ON "governed_institution_events" ("institution_id", "at", "seq");

-- AN INSTITUTION IS BORN ONCE, AND VERIFIED ONCE. `institutionStateAt` refuses a log with two births
-- or a second VERIFY, but refusing at read time is a diagnosis while refusing here makes it
-- unwritable. There is no re-verify: a withdrawn institution is proposed afresh, so the record says
-- which admission a given attestation rested on.
CREATE UNIQUE INDEX "governed_institution_events_one_birth"
    ON "governed_institution_events" ("institution_id")
    WHERE "transition" = 'PROPOSE';

CREATE UNIQUE INDEX "governed_institution_events_one_verification"
    ON "governed_institution_events" ("institution_id")
    WHERE "transition" = 'VERIFY';

-- ── The verification record ─────────────────────────────────────────────────────────────────────
--
-- A SEPARATE TABLE, NOT COLUMNS ON THE INSTITUTION. Two reasons, and both matter.
--
--   The institution row is append-only and its witness covers its own fields. Verification facts are
--   written LATER, so putting them on that row would need an UPDATE the trigger forbids — and if they
--   were in the witness preimage instead, a legitimate verification would read as tampering, which is
--   exactly what `settlementKeyWitness` leaves the lifecycle out to avoid.
--
--   ABSENCE MUST STAY DISTINGUISHABLE FROM ALL-FALSE. No row means NOBODY HAS VERIFIED THIS. Eight
--   `false` columns would say we examined eight conditions and found none met. "Not computed is not
--   zero", applied to a record.
--
-- THE SIX DECLARED CONDITIONS CARRY A CITATION AND NOT A BOOLEAN. NH cannot check a company register,
-- a regulator or a signatory list, so the only honest form of that evidence is a reference someone can
-- be asked about — and a NOT NULL non-blank citation makes a bare tick unrepresentable rather than
-- merely discouraged. That is the correction of what the key register's booleans got wrong.
CREATE TABLE "governed_institution_verifications" (
    "institution_id"        TEXT NOT NULL,
    "verified_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by_actor_id"  TEXT NOT NULL,
    "verified_by_role"      TEXT NOT NULL,

    -- C1–C6 · declared by a governance operator, each with its out-of-band record.
    "legal_entity_citation"          TEXT NOT NULL,
    "regulatory_standing_citation"   TEXT NOT NULL,
    "signatories_citation"           TEXT NOT NULL,
    "channel_citation"               TEXT NOT NULL,
    "fingerprint_citation"           TEXT NOT NULL,
    "ceremony_citation"              TEXT NOT NULL,

    -- C7 · key control, ESTABLISHED rather than ticked: the registered key whose control was
    -- demonstrated, so a later compromise of it can reach this verification.
    "key_control_key_id"             TEXT NOT NULL,

    -- C8 · the second person. THERE IS NO COLUMN FOR IT, and that is deliberate: it is DERIVED from
    -- the event ledger — the VERIFY actor is not the PROPOSE actor — and a column would be a place for
    -- a verifier to assert it about themselves. The constraint below enforces it at write time.
    CONSTRAINT "governed_institution_verifications_pkey" PRIMARY KEY ("institution_id")
);

ALTER TABLE "governed_institution_verifications"
    ADD CONSTRAINT "governed_institution_verifications_citations_nonblank"
        CHECK (length(btrim("legal_entity_citation")) > 0
               AND length(btrim("regulatory_standing_citation")) > 0
               AND length(btrim("signatories_citation")) > 0
               AND length(btrim("channel_citation")) > 0
               AND length(btrim("fingerprint_citation")) > 0
               AND length(btrim("ceremony_citation")) > 0
               AND length(btrim("key_control_key_id")) > 0),
    ADD CONSTRAINT "governed_institution_verifications_institution_fk"
        FOREIGN KEY ("institution_id") REFERENCES "governed_institutions" ("institution_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- The key must be a registered key. Control of an unregistered key demonstrates nothing, and NH
    -- would hold no public half to have verified anything with.
    ADD CONSTRAINT "governed_institution_verifications_key_fk"
        FOREIGN KEY ("key_control_key_id") REFERENCES "settlement_signing_keys" ("key_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- THE SEPARATION OF DUTIES, ENFORCED BY THE DATABASE AND NOT ONLY BY THE SERVICE.
--
-- The service refuses `INSTITUTION_PROPOSER_MAY_NOT_VERIFY` before writing anything, which is what
-- makes the refusal legible. This trigger is what makes it TRUE: a caller that bypasses the service,
-- a future second write path, or a bug in the ordering cannot produce a row where one identity both
-- proposed and verified. The constraint is the control; the service's check is the diagnosis — the
-- settlement ledger's own lesson, applied to a rule about people rather than about money.
CREATE FUNCTION nh_institution_requires_second_person() RETURNS trigger AS $$
DECLARE
    proposer TEXT;
BEGIN
    SELECT "proposed_by_actor_id" INTO proposer
      FROM "governed_institutions"
     WHERE "institution_id" = NEW."institution_id";

    IF proposer IS NULL THEN
        RAISE EXCEPTION 'INSTITUTION_NOT_PROPOSED: no institution row for %', NEW."institution_id";
    END IF;

    IF proposer = NEW."verified_by_actor_id" THEN
        RAISE EXCEPTION
            'INSTITUTION_PROPOSER_MAY_NOT_VERIFY: % both proposed and verified %',
            proposer, NEW."institution_id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER governed_institution_verifications_second_person
    BEFORE INSERT ON "governed_institution_verifications"
    FOR EACH ROW EXECUTE FUNCTION nh_institution_requires_second_person();

-- ── Append-only, by trigger rather than by convention ───────────────────────────────────────────
--
-- `nh_reject_mutation()` already exists from the EP-2 immutability migration. All three tables are
-- append-only: an institution's immutable facts may not be edited (editing them would silently
-- re-point every stored receipt at a different legal entity), a ledger event may not be rewritten, and
-- a verification record may not be amended — an amended verification is a NEW admission, so that the
-- record says which admission a given attestation rested on.
CREATE TRIGGER governed_institutions_no_update   BEFORE UPDATE   ON "governed_institutions"                FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institutions_no_delete   BEFORE DELETE   ON "governed_institutions"                FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institutions_no_truncate BEFORE TRUNCATE ON "governed_institutions"                FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_events_no_update   BEFORE UPDATE   ON "governed_institution_events"    FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_events_no_delete   BEFORE DELETE   ON "governed_institution_events"    FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_events_no_truncate BEFORE TRUNCATE ON "governed_institution_events"    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_verifications_no_update   BEFORE UPDATE   ON "governed_institution_verifications" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_verifications_no_delete   BEFORE DELETE   ON "governed_institution_verifications" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER governed_institution_verifications_no_truncate BEFORE TRUNCATE ON "governed_institution_verifications" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
