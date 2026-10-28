-- PROPOSED MIGRATION · obligation-grained attribution identity.
--
-- NOT IN prisma/migrations, DELIBERATELY. Gate C — owner approval for a production schema change — is
-- unapproved. A file under prisma/migrations is applied by `prisma migrate deploy` on every deploy, so
-- committing it there would BE the production schema change, pending nothing but a deploy. This file is
-- applied explicitly, by the isolated synthetic test and by nothing else.
--
-- ── WHY THE PRIMARY KEY MUST CHANGE ────────────────────────────────────────────────────────────────
-- `pilot_assessment_entity_attributions` is keyed `(execution_id, source_ref)` and `source_ref` is an
-- ACCOUNT pseudonym. Two obligations of one customer therefore collide on the key: the table cannot hold
-- obligation-grained rows whatever any contract declares. No additive index can fix that, because the
-- PRIMARY KEY itself forbids the second row.
--
-- ── WHY A SENTINEL AND NOT A NULLABLE COLUMN ───────────────────────────────────────────────────────
-- A nullable column was the obvious additive shape and it does not work here, for two independent
-- reasons. A PRIMARY KEY column cannot be NULL. And a UNIQUE INDEX would be worse than the PK: Postgres
-- treats NULLs as DISTINCT, so `(ex, ref, NULL)` could be inserted twice and the table would permit
-- duplicate legacy rows — losing a guarantee it has today. So legacy rows carry the explicit sentinel
-- 'UNRESOLVED', which is a STATEMENT THAT THE IDENTITY IS NOT KNOWN and is never mistaken for one:
-- `attributions_obligation_provenance_agrees` makes the sentinel and the provenance marker inseparable.
--
-- ── WHY NO BACKFILL STATEMENT APPEARS BELOW, AND THIS WAS MEASURED ─────────────────────────────────
-- A `BEFORE UPDATE` trigger (`nh_reject_attribution_update`) REFUSES every update to this table: measured
-- on a synthetic database, an ordinary `UPDATE ... SET currency='EUR'` raises "append-only: UPDATE on
-- pilot_assessment_entity_attributions is rejected". So a backfill by UPDATE is IMPOSSIBLE, and the
-- trigger is not disabled to work around it — disabling it is exactly the capability the trigger exists
-- to deny. `ADD COLUMN ... NOT NULL DEFAULT` is a catalog-only change in Postgres 11+: measured on the
-- same database, it succeeded, the legacy row read `obligation_ref=UNRESOLVED`, and its `currency`
-- stayed `USD` — proving no row was rewritten.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────────────────────────────
-- It resolves no legacy identity, derives no obligation from an account or an activation cycle, and
-- accepts no operator assertion: `obligation_provenance` has no 'OPERATOR_ASSERTED' value, so there is
-- no column in which a caller's claim could be stored. Historical rows keep the figure, the account and
-- the rule they were written with, and acquire one marker saying their obligation is UNRESOLVED.

BEGIN;

-- 1 · The identity, its derivation, and where it came from. Three columns, because "which obligation",
--     "by what derivation" and "on whose authority" are three questions and one column cannot answer
--     all three without being ambiguous about which it is answering.
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD COLUMN "obligation_ref" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  ADD COLUMN "obligation_identity_version" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "obligation_provenance" TEXT NOT NULL DEFAULT 'LEGACY_UNRESOLVED';

-- 2 · A non-blank reference. A blank would be a third way of saying "unknown", and three ways of saying
--     one thing is how a reader ends up believing they mean different things.
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD CONSTRAINT "attributions_obligation_ref_present"
  CHECK (btrim("obligation_ref") <> '');

-- 3 · A closed provenance vocabulary. SERVER_DERIVED_SINGLE_UNIT is the only way a real identity may
--     arrive: the server determined the claim covers one reconciliation unit when it read the customer's
--     own extracts. There is no value for an operator assertion, by construction.
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD CONSTRAINT "attributions_obligation_provenance_valid"
  CHECK ("obligation_provenance" IN ('LEGACY_UNRESOLVED', 'SERVER_DERIVED_SINGLE_UNIT'));

-- 4 · THE SENTINEL AND THE MARKER ARE INSEPARABLE, in both directions. A row may not carry a real
--     reference while claiming legacy provenance, and may not claim a derived identity while holding the
--     sentinel. This is what stops 'UNRESOLVED' from quietly becoming an identity.
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD CONSTRAINT "attributions_obligation_provenance_agrees"
  CHECK (
    ("obligation_provenance" = 'LEGACY_UNRESOLVED'
       AND "obligation_ref" = 'UNRESOLVED'
       AND "obligation_identity_version" = 'none')
    OR
    ("obligation_provenance" = 'SERVER_DERIVED_SINGLE_UNIT'
       AND "obligation_ref" ~ '^hmac-sha256:[a-f0-9]{64}$'
       AND btrim("obligation_identity_version") <> '')
  );

-- 5 · The key. The old one is dropped and the new one includes the obligation, so one account may hold
--     several obligations in one execution. Legacy rows remain unique under the new key because they all
--     share the sentinel, so `(execution_id, source_ref, 'UNRESOLVED')` is exactly as unique as
--     `(execution_id, source_ref)` was — no legacy row is merged, split or re-identified.
ALTER TABLE "pilot_assessment_entity_attributions"
  DROP CONSTRAINT "pilot_assessment_entity_attributions_pkey";
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD CONSTRAINT "pilot_assessment_entity_attributions_pkey"
  PRIMARY KEY ("execution_id", "source_ref", "obligation_ref");

-- 6 · The account-level lookup the old key also served. The new PK's leading columns still serve
--     `(execution_id, source_ref)` prefix lookups, so no extra index is created for that; this one
--     preserves the pre-existing boundary index untouched and is listed to make the omission deliberate
--     rather than forgotten.
--     (no statement — `pilot_assessment_entity_attributions_boundary_idx` is unchanged)

COMMIT;
