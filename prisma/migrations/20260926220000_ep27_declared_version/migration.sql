-- EP-27 · Persist the version the CUSTOMER declared, alongside the version the build implemented.
--
-- §10 promises that two majors are supported concurrently. Honouring that means a decision has to record
-- WHICH contract it was accepted under — otherwise the promise is unauditable: nothing in the database can
-- say whether a given verdict came from the current major or from the previous one still inside its window.
-- The table already stored `contract_version`, which is the version the BUILD implemented, not the one the
-- export targeted. Those are the same today only because every client sends the build's own constant.
--
-- THE BACKFILL IS EXACT, NOT A GUESS, and the reasoning is recorded here because a backfill that silently
-- invents history is the thing this repository refuses to do. Both data clients
-- (`pilotIntakeClient.ts`, `pilotAssessmentClient.ts`) and the rehearsal agent send
-- `declaredVersion: PILOT_DATA_CONTRACT_VERSION` — the build constant — so for every row this product
-- created the declared and implemented versions are equal by construction.
--
-- The one case the backfill cannot distinguish is a direct-API caller who declared an OLDER MINOR of the
-- same major: such a row is recorded as having declared the implemented minor. That widening can never
-- grant an acceptance that was not already granted — an older minor of the same major is accepted anyway
-- (`acceptsOlderMinorOfSameMajor`) — so it cannot make a refused dataset look admissible. It is recorded
-- as a known imprecision rather than presented as certainty.
ALTER TABLE "pilot_dataset_submissions"
    ADD COLUMN "declared_version" TEXT;

UPDATE "pilot_dataset_submissions"
   SET "declared_version" = "contract_version"
 WHERE "declared_version" IS NULL;

-- Nullable on purpose: NOT NULL would require a default, and a default here would be a version nobody
-- declared. A row written before this column existed says so by being backfilled from the build version
-- above; a row written after it always carries the real declaration, because the service always supplies
-- one. The application treats NULL as "unknown declaration" and falls back to `contract_version`, which is
-- the same value the backfill used — never to an optimistic assumption of compatibility.
