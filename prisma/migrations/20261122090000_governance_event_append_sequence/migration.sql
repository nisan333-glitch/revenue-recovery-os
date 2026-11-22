-- GOVERNED ISSUE #4, PART 2 · a chronological order for the TWO governance lifecycle logs.
--
-- WHAT WAS MISSED. The 2026-10-06 migration gave `pilot_assessment_execution_events` a database-
-- allocated append order. Four sibling logs already had one or gained one: `institution_events`,
-- `settlement_signing_key_events`, `settlement_consumptions` and the execution log itself. TWO DID NOT,
-- and both carried the identical, identically-wrong comment — *"id breaks ties so ordering is total,
-- not merely stable"*:
--
--   • `pilot_analysis_terms_events`          (server/persistence/pilotAnalysisTermsStore.ts:159)
--   • `"PilotAdmissionPolicyEventRecord"`    (server/persistence/pilotPolicyGovernanceStore.ts:59)
--
-- Total is not chronological. `at` is timestamp(3) — MILLISECONDS — and `id` is a random uuid, so two
-- events appended inside one millisecond were ordered by a random string.
--
-- IT IS NOT COSMETIC, AND THE FAILURE IS WORSE HERE THAN IN THE EXECUTION LOG. `deriveState`
-- (src/contract/policyLifecycle.ts:63) is a fold gated by legality: ACTIVATED read FIRST finds
-- `state === null`, so `LEGAL_FROM` rejects it and the activation is SILENTLY DROPPED; the PROPOSED that
-- follows then sets DRAFT. An activated governed definition therefore reads as a draft, and
-- `mayEvaluate(DRAFT)` is false — so a correctly governed definition is refused with *"the policy is a
-- draft and has not been activated by pilot governance"*. Measured on a disposable database, same `at`,
-- the ONLY difference being which uuid sorts first:
--
--     proposed-id-sorts-first      order=[PROPOSED,ACTIVATED]  state=ACTIVE
--     activated-id-sorts-first     order=[ACTIVATED,PROPOSED]  state=DRAFT     <- the refusal
--
-- Observed in CI run 44990616435 as two 403s in test SETUP, on a host fast enough to put the propose
-- and the activate in one millisecond. 1 of 40 back-to-back append pairs tied on a slower machine.
--
-- `activatedAt` IS ALSO AFFECTED, and this is the half that reaches the Trust Invariant.
-- `policyGovernanceState` takes the LAST of the activations as the one in force, and
-- `pilotIntakeService` compares `governance.activatedAt > firstSeenAt` — the pre-registration test that
-- the baseline was blessed before the data was seen. With two activations tied on `at` the "latest" was
-- picked by a random uuid. Both candidates share the same millisecond, so no verdict could have changed
-- by more than that; it was still a trust-bearing comparison resting on an arbitrary order.
--
-- WHY A DATABASE SEQUENCE: unchanged from the 2026-10-06 file, which states the rejected alternatives
-- (an application counter trades a clock race for a write race; a time-sortable id still rests on the
-- clock; a random uuid is the defect itself). A sequence is allocated inside the inserting transaction,
-- is strictly increasing, involves no clock, and is total and deterministic across processes.
--
-- NULLABLE, AND NEVER BACKFILLED — the most important line in this file, as it was in the first.
--
-- `ADD COLUMN seq BIGINT` rewrites no existing row, so every event already recorded keeps `seq = NULL`,
-- meaning "appended before an append order was recorded". That is a DIFFERENT FACT from any number, and
-- the read surface reports it (`orderCertain` / `orderUncertainAt`) rather than implying a chronology
-- nobody recorded. `ADD COLUMN seq BIGSERIAL` would backfill in PHYSICAL HEAP ORDER — not append order,
-- not chronology — manufacturing a precise-looking history and committing it to disk. That is the exact
-- failure this migration exists to prevent.
--
-- ONE SEQUENCE PER LOG, not one shared. A shared sequence would interleave two independent logs and make
-- each one's numbers non-contiguous for no benefit; nothing compares a `seq` across logs.

-- ── 1 · the analysis-terms governance log ────────────────────────────────────────────────────────────
CREATE SEQUENCE "pilot_analysis_terms_events_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

ALTER TABLE "pilot_analysis_terms_events"
    ADD COLUMN "seq" BIGINT;

-- New writes always receive it, from the COLUMN DEFAULT rather than from application code — so no code
-- path, present or future, can append an event without an append order.
ALTER TABLE "pilot_analysis_terms_events"
    ALTER COLUMN "seq" SET DEFAULT nextval('pilot_analysis_terms_events_seq');

-- ADDITIVE: `pilot_analysis_terms_events_identity_idx` is deliberately KEPT. Dropping an index to tidy
-- up is a performance change smuggled into a correctness fix.
CREATE INDEX "pilot_analysis_terms_events_order_idx"
    ON "pilot_analysis_terms_events" ("boundary_id", "terms_id", "terms_version", "at", "seq");

-- ── 2 · the admission-policy governance log ──────────────────────────────────────────────────────────
--
-- NOTE THE TABLE NAME. This model carries no `@@map`, so its table is the Prisma default — mixed case,
-- and therefore quoted everywhere. Verified against pg_tables rather than inferred from the model name.
CREATE SEQUENCE "pilot_admission_policy_events_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

ALTER TABLE "PilotAdmissionPolicyEventRecord"
    ADD COLUMN "seq" BIGINT;

ALTER TABLE "PilotAdmissionPolicyEventRecord"
    ALTER COLUMN "seq" SET DEFAULT nextval('pilot_admission_policy_events_seq');

CREATE INDEX "pilot_policy_events_order_idx"
    ON "PilotAdmissionPolicyEventRecord" ("boundary_id", "policy_id", "policy_version", "at", "seq");

-- NOT TOUCHED, and listed so the next reader does not have to go looking:
--   • `pilot_analysis_terms_events_no_mutation` and `_no_truncate` stay. No historical row is mutated
--     here; ALTER TABLE is DDL and does not pass through a row trigger.
--   • `pilot_policy_events_no_mutation` stays.
--   • The admission-policy log has NO `_no_truncate` trigger where the terms log does. That asymmetry is
--     PRE-EXISTING and is deliberately left alone: adding one is a tightening with its own blast radius,
--     not part of an ordering fix. Reported, not bundled.
--   • No `admissionPolicyHash`, `PAD-`, `PAX-`, `findingHash` or any other witness preimage contains an
--     event, an event order or a `seq`, so no historical identity can move. Asserted by a test.
