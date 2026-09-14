-- EP-12F · Close direct-SQL gaps in the immutable authority ledger.
ALTER TABLE "AuthorityEvent"
  ADD CONSTRAINT "AuthorityEvent_identity_nonblank" CHECK (
    btrim("id") <> '' AND btrim("recoveryCaseId") <> '' AND
    btrim("actorId") <> '' AND btrim("policyVersion") <> ''
  ),
  ADD CONSTRAINT "AuthorityEvent_role_valid" CHECK (
    "role" IN ('author', 'operator', 'approver', 'verifier', 'steward')
  ),
  ADD CONSTRAINT "AuthorityEvent_action_valid" CHECK (
    "action" IN ('Author', 'Approve', 'Verify', 'Flag', 'Halt', 'Exclude', 'Intervene', 'PromoteCandidate')
  ),
  ADD CONSTRAINT "AuthorityEvent_fields_bounded" CHECK (
    length("id") <= 256 AND length("recoveryCaseId") <= 256 AND
    length("actorId") <= 256 AND length("role") <= 32 AND
    length("action") <= 64 AND length("policyVersion") <= 256
  );

CREATE FUNCTION nh_promote_event_requires_recovery_case() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."action" = 'PromoteCandidate' AND NOT EXISTS (
    SELECT 1 FROM "recovery_cases" WHERE "recovery_case_id" = NEW."recoveryCaseId"
  ) THEN
    RAISE EXCEPTION 'PromoteCandidate authority event requires a RecoveryCase root'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorityevent_require_recovery_case
  BEFORE INSERT ON "AuthorityEvent"
  FOR EACH ROW EXECUTE FUNCTION nh_promote_event_requires_recovery_case();
