-- Reverse of `prisma/migrations/20261122090000_governance_event_append_sequence/migration.sql`.
--
-- WHAT IT COSTS, STATED BEFORE THE STATEMENTS. Dropping `seq` discards the APPEND ORDER of every event
-- written while it existed and cannot be recovered: the column is the only record of it, `at` has
-- millisecond precision, and `id` is random. So this rollback does not merely remove a column — it
-- returns the two logs to the ambiguity the migration fixed, for new rows AND for rows already written
-- under it.
--
-- IT DESTROYS NO GOVERNANCE EVIDENCE OTHERWISE. Every other column is untouched: who proposed, who
-- activated, the rationale, the transition and the timestamp all remain, and no row is deleted. The
-- derived STATE becomes order-dependent again, which is a loss of certainty rather than a loss of facts.
--
-- NOTHING REFERENCES THE COLUMN OUTSIDE THE TWO READ PATHS. No foreign key, no view, no generated
-- column, no trigger and no witness preimage contains `seq` — so the drop cannot cascade. The
-- application code must be reverted in the same deployment: a build whose `orderBy` names `seq` against
-- a table without it fails every governance read, which is loud rather than silent and is the correct
-- failure mode.
--
-- AFTER REVERTING, `orderCertain` IS GONE TOO. A consumer that had started trusting it would stop being
-- told the order is uncertain while the uncertainty returns — which is the strongest argument for not
-- rolling this back once anything reads it.

DROP INDEX IF EXISTS "pilot_policy_events_order_idx";
ALTER TABLE "PilotAdmissionPolicyEventRecord" ALTER COLUMN "seq" DROP DEFAULT;
ALTER TABLE "PilotAdmissionPolicyEventRecord" DROP COLUMN IF EXISTS "seq";
DROP SEQUENCE IF EXISTS "pilot_admission_policy_events_seq";

DROP INDEX IF EXISTS "pilot_analysis_terms_events_order_idx";
ALTER TABLE "pilot_analysis_terms_events" ALTER COLUMN "seq" DROP DEFAULT;
ALTER TABLE "pilot_analysis_terms_events" DROP COLUMN IF EXISTS "seq";
DROP SEQUENCE IF EXISTS "pilot_analysis_terms_events_seq";

-- The identity indexes are NOT recreated because they were never dropped, and the append-only triggers
-- are not mentioned because the migration never touched them.
