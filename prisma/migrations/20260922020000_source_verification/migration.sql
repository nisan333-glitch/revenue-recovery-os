-- Additive only: historical evidence and proof rows remain immutable and unchanged.
ALTER TABLE "EvidenceRecord" ADD COLUMN "sourceVerification" JSONB;
