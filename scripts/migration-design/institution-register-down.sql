-- K5 · reverse of `institution-register-up.sql`.
--
-- SAFE ONLY BECAUSE THE TABLES ARE NEW AND NOTHING ELSE REFERENCES THEM. Dropping them destroys the
-- register's own history and nothing else: no existing table has a foreign key INTO them, no proof
-- cites them, and `institutionGovernance.ts` has no production importer. A rollback once a real
-- institution has been verified would be DESTRUCTION OF GOVERNANCE EVIDENCE, not a rollback — at that
-- point the correct reverse is to WITHDRAW or REVOKE through the ledger, which is what those
-- transitions are for.
--
-- Order matters: the verification references both the institution and a signing key, and the events
-- reference the institution.
DROP TRIGGER IF EXISTS governed_institution_verifications_no_truncate ON "governed_institution_verifications";
DROP TRIGGER IF EXISTS governed_institution_verifications_no_delete   ON "governed_institution_verifications";
DROP TRIGGER IF EXISTS governed_institution_verifications_no_update   ON "governed_institution_verifications";
DROP TRIGGER IF EXISTS governed_institution_verifications_second_person ON "governed_institution_verifications";
DROP TRIGGER IF EXISTS governed_institution_events_no_truncate ON "governed_institution_events";
DROP TRIGGER IF EXISTS governed_institution_events_no_delete   ON "governed_institution_events";
DROP TRIGGER IF EXISTS governed_institution_events_no_update   ON "governed_institution_events";
DROP TRIGGER IF EXISTS governed_institutions_no_truncate ON "governed_institutions";
DROP TRIGGER IF EXISTS governed_institutions_no_delete   ON "governed_institutions";
DROP TRIGGER IF EXISTS governed_institutions_no_update   ON "governed_institutions";

DROP TABLE IF EXISTS "governed_institution_verifications";
DROP TABLE IF EXISTS "governed_institution_events";
DROP TABLE IF EXISTS "governed_institutions";

DROP SEQUENCE IF EXISTS "governed_institution_events_seq";

-- The function is ours and is referenced by nothing else. `nh_reject_mutation()` is NOT dropped: it
-- belongs to the EP-2 immutability migration and other tables depend on it.
DROP FUNCTION IF EXISTS nh_institution_requires_second_person();
