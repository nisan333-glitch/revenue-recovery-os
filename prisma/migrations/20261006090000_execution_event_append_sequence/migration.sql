-- GOVERNED ISSUE #4 · a chronological order for the execution lifecycle log.
--
-- THE DEFECT. `executionEvents` ordered by (at, id). `at` is timestamp(3) — MILLISECONDS — and `id` is
-- `PXE-<random uuid>`, so two events appended inside one millisecond were ordered by a random string.
-- Measured before the fix: 4 same-millisecond ties in 40 trials, 2 of them ordered wrongly.
--
-- AND IT WAS NOT COSMETIC. `deriveExecutionState` applies transitions in sequence, gated by legality,
-- and stops at a terminal state. Reversing CLAIMED and COMPLETED does not merely reorder them: COMPLETED
-- becomes illegal from `queued` and is DROPPED, after which CLAIMED yields `running`. A finished
-- execution reads as still running. The retention service then takes the abandoned branch for an
-- execution that completed — contained only because the purge trigger below refuses that combination.
--
-- WHY A DATABASE SEQUENCE AND NOT THE ALTERNATIVES.
--   • An application-allocated counter needs read-then-write to find the maximum, so two workers racing
--     allocate the same value unless a lock is added. That replaces a clock race with a write race.
--   • A time-sortable id (UUIDv7 / ULID) still rests on the clock, does not guarantee intra-millisecond
--     monotonicity across processes, and would change the format of an existing primary key.
--   • A random UUID as the tie-breaker is the defect itself.
-- A sequence is allocated inside the inserting transaction, is strictly increasing, involves no clock,
-- and is total and deterministic across processes.
--
-- NULLABLE, AND NEVER BACKFILLED — the most important line in this file.
--
-- `ADD COLUMN seq BIGINT` rewrites no existing row, so every event already recorded keeps `seq = NULL`,
-- which means "appended before an append order was recorded". That is a DIFFERENT FACT from any number,
-- and the read surface reports it as such rather than implying a chronology nobody recorded.
--
-- `ADD COLUMN seq BIGSERIAL` would have been one word shorter and WRONG: it backfills existing rows in
-- PHYSICAL table order, which is not append order and is not chronology. It would have manufactured a
-- precise-looking history out of whatever order the heap happened to hold — the exact failure this
-- migration exists to prevent, committed to disk.
--
-- This follows the precedent of the Detector #2 migration: "NULLABLE, DELIBERATELY ... NULL means 'not
-- computed for this execution' — which is a DIFFERENT FACT from zero exposure."

CREATE SEQUENCE "pilot_assessment_execution_events_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

ALTER TABLE "pilot_assessment_execution_events"
    ADD COLUMN "seq" BIGINT;

-- New writes always receive it, from the COLUMN DEFAULT rather than from application code — so no code
-- path, present or future, can append an event without an append order.
ALTER TABLE "pilot_assessment_execution_events"
    ALTER COLUMN "seq" SET DEFAULT nextval('pilot_assessment_execution_events_seq');

-- The read path's index. ADDITIVE: `pilot_assessment_events_identity_idx` is deliberately KEPT, because
-- dropping an index to tidy up is a performance change smuggled into a correctness fix.
CREATE INDEX "pilot_assessment_events_order_idx"
    ON "pilot_assessment_execution_events" ("boundary_id", "execution_id", "at", "seq");

-- NOT TOUCHED, and listed so the next reader does not have to go looking:
--   • `pilot_assessment_execution_events_no_mutation` (BEFORE UPDATE OR DELETE) stays. No historical row
--     is mutated here; ALTER TABLE is DDL and does not pass through it.
--   • `pilot_assessment_execution_events_no_truncate` stays.
--   • `nh_assert_input_purge_authorized` stays unchanged. It reads `max(at)` and event EXISTENCE, never
--     order, so it was never exposed to this defect — and it is what kept a mis-branched purge from
--     being authorized while the defect was live.
