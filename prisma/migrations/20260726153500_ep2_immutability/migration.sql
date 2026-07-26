-- EP-2 · Database-level append-only immutability.
-- Historical evidence and approved proofs cannot be overwritten or deleted, even by
-- direct SQL. Corrections must instead INSERT a new linked revision (kernel `reviseProof`).
-- This enforces the Foundation guarantee below the application layer.

CREATE OR REPLACE FUNCTION nh_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is rejected (historical records are immutable; create a linked revision instead)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- Proof: reject row updates/deletes and table truncation.
CREATE TRIGGER proof_no_update    BEFORE UPDATE ON "Proof"          FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER proof_no_delete    BEFORE DELETE ON "Proof"          FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER proof_no_truncate  BEFORE TRUNCATE ON "Proof"        FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

-- EvidenceRecord: same append-only guarantee.
CREATE TRIGGER evidence_no_update   BEFORE UPDATE ON "EvidenceRecord"   FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER evidence_no_delete   BEFORE DELETE ON "EvidenceRecord"   FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER evidence_no_truncate BEFORE TRUNCATE ON "EvidenceRecord" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
