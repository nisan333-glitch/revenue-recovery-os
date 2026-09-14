-- EP-12E · Candidate review and authoritative RecoveryCase root.
-- Detection remains non-authoritative. Only an immutable accepted human review can be
-- promoted, and the root plus its authority event commit atomically.

CREATE TABLE "agent_case_candidates" (
  "candidate_id" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "boundary_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "signal" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_review',
  "submitted_at" timestamptz(3) NOT NULL,
  "persisted_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "agent_case_candidates_pkey" PRIMARY KEY ("candidate_id"),
  CONSTRAINT "agent_case_candidates_dedupe_key_key" UNIQUE ("dedupe_key"),
  CONSTRAINT "agent_case_candidates_identity_boundary_unique" UNIQUE ("candidate_id", "boundary_id"),
  CONSTRAINT "agent_case_candidates_identity_nonblank" CHECK (
    btrim("candidate_id") <> '' AND btrim("dedupe_key") <> '' AND
    btrim("boundary_id") <> '' AND btrim("agent_id") <> ''
  ),
  CONSTRAINT "agent_case_candidates_status_valid" CHECK ("status" = 'pending_review'),
  CONSTRAINT "agent_case_candidates_signal_object" CHECK (jsonb_typeof("signal") = 'object'),
  CONSTRAINT "agent_case_candidates_signal_bounded" CHECK (octet_length("signal"::text) <= 65536)
);

CREATE INDEX "agent_case_candidates_review_queue_idx"
  ON "agent_case_candidates" ("boundary_id", "status", "submitted_at");

CREATE TABLE "agent_case_candidate_reviews" (
  "review_id" text NOT NULL,
  "candidate_id" text NOT NULL,
  "boundary_id" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "actor_id" text NOT NULL,
  "actor_role" text NOT NULL,
  "policy_version" text NOT NULL,
  "decided_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "agent_case_candidate_reviews_pkey" PRIMARY KEY ("review_id"),
  CONSTRAINT "agent_case_candidate_reviews_candidate_key" UNIQUE ("candidate_id"),
  CONSTRAINT "agent_case_candidate_reviews_candidate_fkey"
    FOREIGN KEY ("candidate_id", "boundary_id")
    REFERENCES "agent_case_candidates" ("candidate_id", "boundary_id")
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "agent_case_candidate_reviews_identity_nonblank" CHECK (
    btrim("review_id") <> '' AND btrim("candidate_id") <> '' AND btrim("boundary_id") <> '' AND
    btrim("reason") <> '' AND btrim("actor_id") <> '' AND btrim("policy_version") <> ''
  ),
  CONSTRAINT "agent_case_candidate_reviews_decision_valid" CHECK ("decision" IN ('accepted', 'rejected')),
  CONSTRAINT "agent_case_candidate_reviews_role_valid" CHECK ("actor_role" = 'operator')
);

CREATE INDEX "agent_case_candidate_reviews_boundary_idx"
  ON "agent_case_candidate_reviews" ("boundary_id", "decided_at");

CREATE TABLE "recovery_cases" (
  "recovery_case_id" text NOT NULL,
  "boundary_id" text NOT NULL,
  "source_candidate_id" text NOT NULL,
  "recovery_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "amount_at_risk_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "detector_version" text NOT NULL,
  "opened_by_actor_id" text NOT NULL,
  "opened_by_role" text NOT NULL,
  "policy_version" text NOT NULL,
  "opened_at" timestamptz(3) NOT NULL,
  "persisted_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "recovery_cases_pkey" PRIMARY KEY ("recovery_case_id"),
  CONSTRAINT "recovery_cases_source_candidate_key" UNIQUE ("source_candidate_id"),
  CONSTRAINT "recovery_cases_candidate_boundary_unique" UNIQUE ("source_candidate_id", "boundary_id"),
  CONSTRAINT "recovery_cases_candidate_fkey"
    FOREIGN KEY ("source_candidate_id", "boundary_id")
    REFERENCES "agent_case_candidates" ("candidate_id", "boundary_id")
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "recovery_cases_identity_nonblank" CHECK (
    btrim("recovery_case_id") <> '' AND btrim("boundary_id") <> '' AND
    btrim("source_candidate_id") <> '' AND btrim("recovery_type") <> '' AND
    btrim("source_ref") <> '' AND btrim("detector_version") <> '' AND
    btrim("opened_by_actor_id") <> '' AND btrim("policy_version") <> ''
  ),
  CONSTRAINT "recovery_cases_amount_valid" CHECK (
    "amount_at_risk_minor" >= 0 AND "amount_at_risk_minor" <= 9007199254740991
  ),
  CONSTRAINT "recovery_cases_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "recovery_cases_opener_role_valid" CHECK ("opened_by_role" = 'operator')
);

CREATE INDEX "recovery_cases_boundary_opened_idx"
  ON "recovery_cases" ("boundary_id", "opened_at");

CREATE FUNCTION nh_recovery_case_requires_accepted_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "agent_case_candidate_reviews"
     WHERE "candidate_id" = NEW."source_candidate_id"
       AND "boundary_id" = NEW."boundary_id"
       AND "decision" = 'accepted'
  ) THEN
    RAISE EXCEPTION 'RecoveryCase requires an accepted candidate review'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recovery_cases_require_accepted_review
  BEFORE INSERT ON "recovery_cases"
  FOR EACH ROW EXECUTE FUNCTION nh_recovery_case_requires_accepted_review();

CREATE TRIGGER agent_case_candidates_no_update BEFORE UPDATE ON "agent_case_candidates"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER agent_case_candidates_no_delete BEFORE DELETE ON "agent_case_candidates"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER agent_case_candidates_no_truncate BEFORE TRUNCATE ON "agent_case_candidates"
  FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER agent_case_candidate_reviews_no_update BEFORE UPDATE ON "agent_case_candidate_reviews"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER agent_case_candidate_reviews_no_delete BEFORE DELETE ON "agent_case_candidate_reviews"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER agent_case_candidate_reviews_no_truncate BEFORE TRUNCATE ON "agent_case_candidate_reviews"
  FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER recovery_cases_no_update BEFORE UPDATE ON "recovery_cases"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER recovery_cases_no_delete BEFORE DELETE ON "recovery_cases"
  FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER recovery_cases_no_truncate BEFORE TRUNCATE ON "recovery_cases"
  FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();
