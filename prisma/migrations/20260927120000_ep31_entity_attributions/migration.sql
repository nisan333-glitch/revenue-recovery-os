-- EP-31 · Staged per-account at-risk attribution, for the governed signal emitter.
--
-- WHAT THIS TABLE IS FOR. The bridge from the aggregate assessment finding into the governed Recovery
-- Case lane needs a per-ACCOUNT figure, and the account identity exists only at schedule time: the
-- execution input replaces it with a first-appearance ordinal whose mapping is deliberately not stored
-- and not recoverable. So the attribution is derived where the identity still exists, written in the
-- SAME TRANSACTION as the execution, and left for the emitter to read afterwards.
--
-- IT IS A DERIVATION ARTEFACT, NOT A CLAIM. Nothing lists these rows in a review queue and nothing can
-- promote one. Only the emitter, and only for an execution that reached `completed`, turns them into
-- CandidateSignals. That ordering is the invariant: the execution is the governed artefact and the
-- candidate is strictly downstream of it. A candidate that existed before its execution completed would
-- point at no governed result — which is exactly the defect this table's placement prevents.
--
-- IDENTITY IS PSEUDONYMOUS, ENFORCED BY THE DATABASE. `source_ref` must match 'hmac-sha256:<64 hex>' —
-- the same scheme and key as secure CSV ingestion. A raw account identifier cannot be written here even
-- by a mistaken caller, because the CHECK refuses it. The pseudonym depends on nothing but the boundary
-- and the customer's own account id, so it is STABLE for one account across re-exports (row order, row
-- count, file bytes, `asOf` and the execution id all change without changing it) — which is what stops
-- one account becoming two candidates.
--
-- RETENTION. These are pseudonymised customer-derived rows of the same class as the execution input, so
-- they are covered by the SAME governed purge authorization rather than a second one: the DELETE trigger
-- below requires a recorded purge for the same (execution, boundary) that authorizes deleting the input.
-- One authorization, both tables, one transaction. A pseudonymised table outside that path would be a
-- retention hole.

CREATE TABLE "pilot_assessment_entity_attributions" (
    "execution_id"             TEXT      NOT NULL,
    "boundary_id"              TEXT      NOT NULL,
    "source_ref"               TEXT      NOT NULL,
    "amount_at_risk_minor"     BIGINT    NOT NULL,
    "currency"                 TEXT      NOT NULL,
    "contributing_cycle_count" INTEGER   NOT NULL,
    "attribution_rule"         TEXT      NOT NULL,
    "derived_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_assessment_entity_attributions_pkey" PRIMARY KEY ("execution_id", "source_ref")
);

CREATE INDEX "pilot_assessment_entity_attributions_boundary_idx"
    ON "pilot_assessment_entity_attributions" ("boundary_id", "execution_id");

ALTER TABLE "pilot_assessment_entity_attributions"
    -- Pseudonymity as a database rule, not a convention a caller may forget.
    ADD CONSTRAINT "pilot_assessment_attributions_pseudonymous"
        CHECK ("source_ref" ~ '^hmac-sha256:[a-f0-9]{64}$'),
    -- A zero at-risk figure is never staged: there is nothing at risk, and a zero-value candidate would
    -- be noise with a governed object wrapped around it. Negative is meaningless.
    ADD CONSTRAINT "pilot_assessment_attributions_positive"
        CHECK ("amount_at_risk_minor" > 0),
    -- At least one stalled cycle must have contributed, or the row describes nothing.
    ADD CONSTRAINT "pilot_assessment_attributions_has_cycles"
        CHECK ("contributing_cycle_count" > 0),
    ADD CONSTRAINT "pilot_assessment_attributions_currency"
        CHECK (char_length("currency") = 3 AND "currency" = upper("currency")),
    ADD CONSTRAINT "pilot_assessment_attributions_rule_present"
        CHECK (btrim("attribution_rule") <> '');

-- NO ATTRIBUTION WITHOUT ITS EXECUTION, enforced by the database rather than by the transaction alone.
-- The transaction already guarantees it on the write path; this guarantees it against every other path,
-- including a migration or a restore. Executions are themselves never deleted, so this reference cannot
-- be broken by the governed purge — which deletes the input and these rows, not the execution.
ALTER TABLE "pilot_assessment_entity_attributions"
    ADD CONSTRAINT "pilot_assessment_attributions_execution_fkey"
    FOREIGN KEY ("execution_id", "boundary_id")
    REFERENCES "pilot_assessment_executions" ("execution_id", "boundary_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Append-only, with the same purge route as the execution input ─────────────────────────────────

CREATE OR REPLACE FUNCTION nh_reject_attribution_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: UPDATE on pilot_assessment_entity_attributions is rejected (the figure a signal was derived from is never edited after the fact)'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pilot_assessment_entity_attributions_no_update"
    BEFORE UPDATE ON "pilot_assessment_entity_attributions"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_attribution_update();

-- The SAME authorization that permits deleting the execution input permits deleting its attribution.
-- Reusing it rather than inventing a second authorization means the two cannot drift apart, and an
-- operator cannot purge one while leaving the other behind.
CREATE OR REPLACE FUNCTION nh_assert_attribution_purge_recorded() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM "pilot_assessment_input_purges" p
     WHERE p.execution_id = OLD.execution_id AND p.boundary_id = OLD.boundary_id
  ) THEN
    RAISE EXCEPTION 'deletion of a staged attribution requires a recorded purge authorization'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pilot_assessment_entity_attributions_purge_only"
    BEFORE DELETE ON "pilot_assessment_entity_attributions"
    FOR EACH ROW EXECUTE FUNCTION nh_assert_attribution_purge_recorded();

CREATE TRIGGER "pilot_assessment_entity_attributions_no_truncate"
    BEFORE TRUNCATE ON "pilot_assessment_entity_attributions"
    FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
