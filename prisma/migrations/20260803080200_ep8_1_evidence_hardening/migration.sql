-- EP-8.1 · Harden EvidenceRecord into governed, pre-proof evidence ingestion.
-- Table confirmed empty (no writers exist before this EP) — safe to alter destructively.
-- `evidenceRole` and `trustClassification` are DERIVED server-side at ingestion (see
-- server/domain/evidenceRole.ts + the domain's makeEvidence) — never client-asserted.
-- `roleMapVersion` freezes which allowlist produced the classification, so a future mapping
-- change can never reinterpret historical evidence. `ingestedAt` (server clock) is the
-- authoritative timing signal; `observedAt` is recorded but is a claimed, non-authoritative
-- fact. The partial unique index makes an outcome-role source record single-use across
-- every recovery case, not just within one.

ALTER TABLE "EvidenceRecord" DROP COLUMN "ref";
ALTER TABLE "EvidenceRecord" RENAME COLUMN "persistedAt" TO "ingestedAt";

ALTER TABLE "EvidenceRecord"
  ADD COLUMN "sourceSystem"        TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sourceRecordId"      TEXT NOT NULL DEFAULT '',
  ADD COLUMN "evidenceType"        TEXT NOT NULL DEFAULT '',
  ADD COLUMN "observedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "amountMinor"         BIGINT,
  ADD COLUMN "currency"            TEXT,
  ADD COLUMN "trustClassification" TEXT NOT NULL DEFAULT 'beneficiary_controlled',
  ADD COLUMN "beneficiaryControl"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "evidenceRole"        TEXT NOT NULL DEFAULT 'supporting',
  ADD COLUMN "roleMapVersion"      TEXT NOT NULL DEFAULT '',
  ADD COLUMN "ingestedBy"          TEXT NOT NULL DEFAULT '',
  ADD COLUMN "ingestedByRole"      TEXT NOT NULL DEFAULT '';

-- The DEFAULTs above exist only to satisfy NOT NULL on an already-empty table during this
-- migration; every application-level insert (evidenceStore.ts) always supplies all of
-- these explicitly. Drop the defaults so future inserts cannot silently rely on them.
ALTER TABLE "EvidenceRecord"
  ALTER COLUMN "sourceSystem" DROP DEFAULT,
  ALTER COLUMN "sourceRecordId" DROP DEFAULT,
  ALTER COLUMN "evidenceType" DROP DEFAULT,
  ALTER COLUMN "observedAt" DROP DEFAULT,
  ALTER COLUMN "trustClassification" DROP DEFAULT,
  ALTER COLUMN "beneficiaryControl" DROP DEFAULT,
  ALTER COLUMN "evidenceRole" DROP DEFAULT,
  ALTER COLUMN "roleMapVersion" DROP DEFAULT,
  ALTER COLUMN "ingestedBy" DROP DEFAULT,
  ALTER COLUMN "ingestedByRole" DROP DEFAULT;

CREATE UNIQUE INDEX "EvidenceRecord_outcome_single_use"
  ON "EvidenceRecord" ("sourceSystem", "sourceRecordId")
  WHERE "evidenceRole" = 'outcome';
