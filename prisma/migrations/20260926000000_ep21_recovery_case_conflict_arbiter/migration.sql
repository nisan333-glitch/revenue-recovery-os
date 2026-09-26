-- EP-21 · One candidate has one RecoveryCase globally. The unique source_candidate_id constraint
-- already guarantees that pairwise (source_candidate_id, boundary_id) values cannot repeat.
-- The redundant composite UNIQUE could win a concurrent insert before the named
-- ON CONFLICT (source_candidate_id) arbiter, surfacing a duplicate-key failure on a valid replay.
-- Preserve the global unique constraint and the candidate's composite foreign key.
ALTER TABLE "recovery_cases"
  DROP CONSTRAINT "recovery_cases_candidate_boundary_unique";
