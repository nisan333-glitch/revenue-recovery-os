-- S4a · The admission snapshot: record the interpretation facts a decision was made under.
--
-- THE GAP THIS CLOSES. Nine components make up the submission identity (`pds`). Only three were
-- recoverable from this row: `boundary_id`, `dataset_fingerprint`, and the contract MAJOR via
-- `contract_version`. The other six — `dateLocale`, `amountFormat`, and the governed `currency`,
-- `asOf` and `stallThresholdDays` — were committed by the hash and stored nowhere, so learning them
-- meant enumerating candidates until one reproduced the digest. That finds a hash preimage; it does
-- not establish provenance. `pilot_assessment_executions` does store them, but that row is CREATED BY
-- SCHEDULING, so it cannot be read before scheduling has decided anything.
--
-- WHAT EACH COLUMN IS FOR.
--   snapshot_date_locale / snapshot_amount_format
--     IDENTITY-BEARING: these two ARE `pds` components. Recorded verbatim as declared ("auto" is
--     itself a declaration, not an absence).
--   snapshot_terms_id / snapshot_terms_version
--     LINEAGE: the governed analysis-terms register is append-only and already holds `currency`,
--     `as_of` and `stall_threshold_days` forever — retiring or superseding a version never mutates the
--     definition row. What was missing was the ADDRESS, not the data. These are deliberately NOT
--     identity-bearing: the `pds` preimage commits the governed VALUES, and two terms versions holding
--     identical values are intentionally one submission identity.
--
-- NULLABLE ON PURPOSE, AND NEVER BACKFILLED. A default here would be a value nobody declared, and a
-- backfill would invent history: for a row written before these columns existed, the locale and format
-- are genuinely unknown to this database. NULL therefore states a fact about the schema epoch — "this
-- row predates the snapshot" — which is verifiable, rather than a guess about semantics. The service
-- writes all four on every submission from this point on, so NULL and present are unambiguous.
--
-- NO IDENTITY MOVES. No derivation reads these columns. `pds`, PAD and PAX are untouched, and every
-- historical row keeps exactly the values it was recorded with.
ALTER TABLE "pilot_dataset_submissions"
    ADD COLUMN "snapshot_date_locale"   TEXT,
    ADD COLUMN "snapshot_amount_format" TEXT,
    ADD COLUMN "snapshot_terms_id"      TEXT,
    ADD COLUMN "snapshot_terms_version" TEXT;
