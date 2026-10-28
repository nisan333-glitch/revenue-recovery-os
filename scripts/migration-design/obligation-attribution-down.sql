-- ROLLBACK for obligation-attribution-up.sql.
--
-- IT REFUSES RATHER THAN MERGES, and that refusal is the cutover gate.
--
-- Once any obligation-grained rows exist, two rows may share `(execution_id, source_ref)`. Restoring the
-- old primary key would then require DELETING one of them or MERGING their figures — and this table is
-- append-only by trigger precisely so that cannot happen silently. So the rollback checks first and
-- raises if the data has moved past the point where it is reversible. A rollback that quietly discarded
-- a recorded obligation would be worse than no rollback.
--
-- THE WINDOW IN WHICH IT SUCCEEDS IS EXACT: after the migration and before the first
-- SERVER_DERIVED_SINGLE_UNIT row is written. That window is what a cutover plan is for.

BEGIN;

DO $$
DECLARE
  collisions BIGINT;
  derived BIGINT;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT 1 FROM "pilot_assessment_entity_attributions"
     GROUP BY "execution_id", "source_ref" HAVING count(*) > 1
  ) AS dup;
  SELECT count(*) INTO derived FROM "pilot_assessment_entity_attributions"
   WHERE "obligation_provenance" = 'SERVER_DERIVED_SINGLE_UNIT';

  IF collisions > 0 THEN
    RAISE EXCEPTION 'rollback refused: % (execution_id, source_ref) group(s) now hold more than one obligation; restoring the old key would require deleting or merging a recorded attribution', collisions;
  END IF;

  -- Not an error: a derived identity with no collision is reversible, because dropping the column only
  -- loses the IDENTITY and never an amount. It is raised as a NOTICE so the operator knows what the
  -- rollback is discarding, rather than discovering it afterwards.
  IF derived > 0 THEN
    RAISE NOTICE 'rollback proceeding: % row(s) carry a server-derived obligation identity which this rollback DISCARDS. No amount, account or rule is lost; the obligation identity is.', derived;
  END IF;
END $$;

ALTER TABLE "pilot_assessment_entity_attributions"
  DROP CONSTRAINT "pilot_assessment_entity_attributions_pkey";
ALTER TABLE "pilot_assessment_entity_attributions"
  ADD CONSTRAINT "pilot_assessment_entity_attributions_pkey"
  PRIMARY KEY ("execution_id", "source_ref");

ALTER TABLE "pilot_assessment_entity_attributions"
  DROP CONSTRAINT "attributions_obligation_provenance_agrees",
  DROP CONSTRAINT "attributions_obligation_provenance_valid",
  DROP CONSTRAINT "attributions_obligation_ref_present";

-- DROP COLUMN is catalog-only and fires no row trigger, the same property the migration relies on.
ALTER TABLE "pilot_assessment_entity_attributions"
  DROP COLUMN "obligation_provenance",
  DROP COLUMN "obligation_identity_version",
  DROP COLUMN "obligation_ref";

COMMIT;
