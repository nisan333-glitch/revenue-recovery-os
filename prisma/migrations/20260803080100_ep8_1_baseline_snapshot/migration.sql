-- EP-8.1 · Immutable, append-only baseline snapshot table.
-- Establish + lock happen as one insert (`lockedAt` defaults to the server clock — never
-- client-suppliable). A proof's baseline amount/method/version come only from the locked
-- snapshot a case references; a correction is a new row (`supersedes`), never an overwrite.
-- Reuses the existing nh_reject_mutation() trigger function (defined in ep2_immutability) —
-- no redefinition.

CREATE TABLE "BaselineSnapshot" (
    "baselineId"        TEXT NOT NULL,
    "recoveryCaseId"    TEXT NOT NULL,
    "calculatedMinor"   BIGINT NOT NULL,
    "currency"          TEXT NOT NULL,
    "method"            TEXT NOT NULL,
    "methodVersion"     INTEGER NOT NULL,
    "sourceRefs"        TEXT[] NOT NULL,
    "effectiveAt"       TIMESTAMP(3) NOT NULL,
    "establishedBy"     TEXT NOT NULL,
    "establishedByRole" TEXT NOT NULL,
    "lockedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedes"        TEXT,

    CONSTRAINT "BaselineSnapshot_pkey" PRIMARY KEY ("baselineId")
);

CREATE INDEX "BaselineSnapshot_recoveryCaseId_idx" ON "BaselineSnapshot"("recoveryCaseId");

-- Append-only: reject UPDATE/DELETE/TRUNCATE at the database level, same as every other
-- historical table (Proof, AuthorityEvent, EvidenceRecord).
CREATE TRIGGER baselinesnapshot_no_update   BEFORE UPDATE   ON "BaselineSnapshot" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER baselinesnapshot_no_delete   BEFORE DELETE   ON "BaselineSnapshot" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER baselinesnapshot_no_truncate BEFORE TRUNCATE ON "BaselineSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
