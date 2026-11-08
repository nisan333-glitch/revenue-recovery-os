-- G1 · Admit the `correction` evidence role.
--
-- WHY A MIGRATION IS REQUIRED AT ALL, which is itself the finding. `evidenceRole` is a plain TEXT column
-- in the Prisma schema, so adding a role looked like a code-only change. It is not: the role VOCABULARY is
-- enforced by a database CHECK constraint (`EvidenceRecord_classification_valid`, added by
-- 20260913220000_ep12g_persistence_constraints), and an insert carrying 'correction' failed the constraint
-- and surfaced as a 500. That constraint is good design — the derived classification cannot drift to an
-- unknown value even through a direct write — and it means the vocabulary is schema, not convention.
--
-- WIDENING A CHECK CANNOT INVALIDATE HISTORY. Every existing row carries 'outcome' or 'supporting', both
-- of which still satisfy the new predicate, so no row is re-interpreted and no row can fail. The role each
-- record was classified with stays frozen at its ingestion-time value, which is what `roleMapVersion`
-- exists for: a record ingested as 'supporting' under evidence-role-2026.1 stays 'supporting' even where
-- the same (sourceSystem, evidenceType) pair now derives 'correction'.
--
-- NOTHING ELSE IN THE CONSTRAINT MOVES. `trustClassification` and the beneficiaryControl agreement are
-- reproduced verbatim from the original definition, so this migration changes exactly one list.
--
-- The partial unique index on (sourceSystem, sourceRecordId) WHERE evidenceRole='outcome' is deliberately
-- NOT extended to correction rows in this migration: a duplicated correction record would be counted by
-- nothing, because G1 asks whether one EXISTS rather than summing them, so the uniqueness it would buy is
-- not load-bearing. Stated here rather than left to be rediscovered.
ALTER TABLE "EvidenceRecord"
  DROP CONSTRAINT "EvidenceRecord_classification_valid";

ALTER TABLE "EvidenceRecord"
  ADD CONSTRAINT "EvidenceRecord_classification_valid" CHECK (
    "trustClassification" IN ('independent', 'beneficiary_controlled') AND
    "evidenceRole" IN ('outcome', 'correction', 'supporting') AND
    (("trustClassification" = 'beneficiary_controlled') = "beneficiaryControl")
  );
