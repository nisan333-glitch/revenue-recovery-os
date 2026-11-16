-- G5 · THE SETTLEMENT LEDGER · what makes replay and one-arrival-counted-once ENFORCED.
--
-- NOT IN `prisma/migrations/`, DELIBERATELY. A file there is applied by `prisma migrate deploy` on
-- every deploy, so committing it would BE the production schema change. Owner approval for G5 covers
-- local development and isolated disposable test databases only. Same placement and same test strategy
-- as the obligation-attribution and settlement-key designs.
--
-- WHY THIS TABLE EXISTS AT ALL, AND WHY A READ WAS NEVER ENOUGH. Stage 8's pure core already DECIDES
-- that a replayed nonce and an already-counted settlement are refused. It decides it from two lists the
-- caller supplies. That is a READ-THEN-CHECK, and under concurrency it is advisory rather than a
-- control:
--
--   two simultaneous approvals citing one nonce both read "not seen", both pass the check, and both
--   proceed — and nothing in the decision layer can prevent it, because the window is between the read
--   and the write.
--
-- SO THE CONSTRAINT IS THE CONTROL AND THE READ IS A DIAGNOSIS. The unique indexes below are what make
-- the rule true; the pure core's check is what makes the refusal legible before the database has to
-- raise. Both are kept: the decision names WHICH rule failed, and the constraint guarantees it held.

CREATE SEQUENCE "settlement_consumptions_seq";

CREATE TABLE "settlement_consumptions" (
    "consumption_id" TEXT NOT NULL,
    "boundary_id"    TEXT NOT NULL,

    -- WHICH CLAIM CONSUMED THIS ARRIVAL OF MONEY. Without it the ledger cannot tell an IDEMPOTENT
    -- RETRY of one claim from a DOUBLE COUNT across two — the defect in stage 8's port, which asked
    -- only "is this identity already substantiating something" and would have refused a legitimate
    -- retry of the very claim that recorded it.
    "claim_ref"      TEXT NOT NULL,

    -- `sha256:<64 hex>` over the canonical settlement identity, which already contains the boundary,
    -- the source system and the external reference.
    --
    -- A DIGEST FOR UNIQUENESS, NOT A PSEUDONYM FOR PRIVACY, and the distinction is stated rather than
    -- implied. It keeps the external settlement reference out of the table while remaining
    -- deterministic, which is all uniqueness needs. It is NOT a keyed pseudonym: a plain digest over a
    -- guessable reference is brute-forceable, so if this value ever needs to resist an attacker holding
    -- the database it requires the same keyed treatment `sourceRef` gets — a deployment secret and a
    -- key-management decision, not something to invent here.
    "settlement_digest" TEXT NOT NULL,

    "attestation_nonce" TEXT NOT NULL,
    -- Which registered key verified it, so a later compromise can find every arrival that rests on it.
    "key_id"            TEXT NOT NULL,

    "consumed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A new table, so `seq` is NOT NULL with a sequence default: there are no pre-existing rows whose
    -- append order would have to be fabricated by a backfill.
    "seq"               BIGINT NOT NULL DEFAULT nextval('"settlement_consumptions_seq"'),

    CONSTRAINT "settlement_consumptions_pkey" PRIMARY KEY ("consumption_id")
);

ALTER TABLE "settlement_consumptions"
    ADD CONSTRAINT "settlement_consumptions_digest_shape"
        CHECK ("settlement_digest" ~ '^sha256:[a-f0-9]{64}$'),
    ADD CONSTRAINT "settlement_consumptions_nonce_shape"
        CHECK ("attestation_nonce" ~ '^[A-Za-z0-9_-]{16,128}$'),
    ADD CONSTRAINT "settlement_consumptions_nonblank"
        CHECK (length(btrim("boundary_id")) > 0 AND length(btrim("claim_ref")) > 0
               AND length(btrim("key_id")) > 0);

-- ── ONE ARRIVAL OF MONEY IS COUNTED ONCE ────────────────────────────────────────────────────────
--
-- GLOBAL, NOT PER TENANT, AND THAT NEEDS NO SCOPING CLAUSE: the canonical settlement identity already
-- contains the boundary, so a global unique index on its digest IS per-tenant uniqueness and cannot
-- collide across tenants by construction. Adding `boundary_id` to the index would be a second
-- statement of the same fact, and two statements of one rule can drift.
CREATE UNIQUE INDEX "settlement_consumptions_one_arrival"
    ON "settlement_consumptions" ("settlement_digest");

-- ── A SIGNATURE IS SINGLE-USE ───────────────────────────────────────────────────────────────────
--
-- SCOPED TO THE TENANT, and the reason is the opposite of the one above. The nonce is a value the
-- external source chose; the boundary is NOT inside it, it is beside it in the signed payload. So a
-- nonce value recurring in another tenant is a DIFFERENT signature over a DIFFERENT payload, and
-- refusing it as a replay would be a wrong diagnosis — it would report a weak nonce source as an
-- attack on this tenant. Scoping makes the index say exactly what replay means here.
CREATE UNIQUE INDEX "settlement_consumptions_one_use"
    ON "settlement_consumptions" ("boundary_id", "attestation_nonce");

-- A compromised key's exposure query: every arrival that rests on it.
CREATE INDEX "settlement_consumptions_key_idx"
    ON "settlement_consumptions" ("key_id", "consumed_at");

-- The claim's own view, for an idempotent retry and for an audit of what substantiated it.
CREATE INDEX "settlement_consumptions_claim_idx"
    ON "settlement_consumptions" ("boundary_id", "claim_ref");

-- ── Append-only, by trigger rather than by convention ───────────────────────────────────────────
--
-- A CONSUMPTION MAY NOT BE EDITED OR DELETED. Deleting one would silently free an arrival of money to
-- be counted a second time, which is the exact rule this table exists to hold — so the immutability is
-- not hygiene here, it is the control itself.
CREATE TRIGGER settlement_consumptions_no_update   BEFORE UPDATE   ON "settlement_consumptions" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_consumptions_no_delete   BEFORE DELETE   ON "settlement_consumptions" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER settlement_consumptions_no_truncate BEFORE TRUNCATE ON "settlement_consumptions" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
