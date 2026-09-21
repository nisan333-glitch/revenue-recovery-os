-- EP-12G · Direct-SQL integrity backstops for the governed persistence layer.
-- Application validation remains the first line; these checks keep authoritative rows
-- valid even when a privileged client bypasses the TypeScript services.

ALTER TABLE "Proof"
  ADD CONSTRAINT "Proof_identity_nonblank" CHECK (
    btrim("proofId") <> '' AND btrim("recoveryCaseId") <> '' AND btrim("chainId") <> '' AND
    btrim("baselineId") <> '' AND btrim("baselineMethodId") <> '' AND
    btrim("policyVersion") <> '' AND btrim("confidenceMethodologyVersion") <> '' AND
    btrim("approvedBy") <> '' AND btrim("exclusionStatement") <> '' AND
    btrim("recoveryReason") <> '' AND btrim("attribution") <> ''
  ),
  ADD CONSTRAINT "Proof_status_valid" CHECK ("status" IN ('Approved', 'Reversed', 'Superseded', 'Corrected')),
  ADD CONSTRAINT "Proof_currency_valid" CHECK ("currency" IN ('USD', 'EUR', 'GBP', 'ILS', 'JPY')),
  ADD CONSTRAINT "Proof_versions_positive" CHECK ("proofVersion" >= 1 AND "baselineVersion" >= 1),
  ADD CONSTRAINT "Proof_money_safe" CHECK (
    "collectedMinor" BETWEEN 0 AND 9007199254740991 AND
    "baselineMinor" BETWEEN 0 AND 9007199254740991 AND
    "revenueReturnedMinor" BETWEEN 0 AND 9007199254740991 AND
    "excludedRecoveryMinor" BETWEEN 0 AND 9007199254740991
  ),
  ADD CONSTRAINT "Proof_evidence_refs_valid" CHECK (
    cardinality("evidenceRefs") BETWEEN 1 AND 1000 AND
    array_position("evidenceRefs", '') IS NULL AND
    array_position("evidenceRefs", NULL) IS NULL
  ),
  ADD CONSTRAINT "Proof_confidence_valid" CHECK (
    "proofThresholdUsed" BETWEEN 0 AND 100 AND "confidenceUsed" BETWEEN 0 AND 100
  ),
  ADD CONSTRAINT "Proof_timestamps_ordered" CHECK ("approvedAt" >= "createdAt"),
  ADD CONSTRAINT "Proof_fields_bounded" CHECK (
    length("proofId") <= 256 AND length("recoveryCaseId") <= 256 AND length("chainId") <= 256 AND
    COALESCE(length("previousProofId"), 0) <= 256 AND length("currency") = 3 AND
    length("exclusionStatement") <= 4000 AND length("recoveryReason") <= 256 AND
    length("attribution") <= 4000 AND length("baselineId") <= 256 AND
    length("baselineMethodId") <= 256 AND length("baselineLockPolicy") <= 1000 AND
    length("policyVersion") <= 256 AND length("confidenceMethodologyVersion") <= 256 AND
    length("approvedBy") <= 256
  );

ALTER TABLE "BaselineSnapshot"
  ADD CONSTRAINT "BaselineSnapshot_identity_nonblank" CHECK (
    btrim("baselineId") <> '' AND btrim("recoveryCaseId") <> '' AND btrim("method") <> '' AND
    btrim("establishedBy") <> '' AND btrim("establishedByRole") <> ''
  ),
  ADD CONSTRAINT "BaselineSnapshot_amount_safe" CHECK ("calculatedMinor" BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT "BaselineSnapshot_currency_valid" CHECK ("currency" IN ('USD', 'EUR', 'GBP', 'ILS', 'JPY')),
  ADD CONSTRAINT "BaselineSnapshot_version_positive" CHECK ("methodVersion" >= 1),
  ADD CONSTRAINT "BaselineSnapshot_role_valid" CHECK ("establishedByRole" IN ('author', 'operator')),
  ADD CONSTRAINT "BaselineSnapshot_source_refs_valid" CHECK (
    cardinality("sourceRefs") BETWEEN 1 AND 1000 AND
    array_position("sourceRefs", '') IS NULL AND array_position("sourceRefs", NULL) IS NULL
  ),
  ADD CONSTRAINT "BaselineSnapshot_timestamps_ordered" CHECK ("lockedAt" >= "effectiveAt"),
  ADD CONSTRAINT "BaselineSnapshot_fields_bounded" CHECK (
    length("baselineId") <= 256 AND length("recoveryCaseId") <= 256 AND length("method") <= 256 AND
    length("establishedBy") <= 256 AND length("establishedByRole") <= 32 AND
    COALESCE(length("supersedes"), 0) <= 256
  );

ALTER TABLE "EvidenceRecord"
  ADD CONSTRAINT "EvidenceRecord_identity_nonblank" CHECK (
    btrim("evidenceId") <> '' AND btrim("recoveryCaseId") <> '' AND
    btrim("sourceSystem") <> '' AND btrim("sourceRecordId") <> '' AND
    btrim("evidenceType") <> '' AND btrim("roleMapVersion") <> '' AND
    btrim("ingestedBy") <> '' AND btrim("ingestedByRole") <> ''
  ),
  ADD CONSTRAINT "EvidenceRecord_classification_valid" CHECK (
    "trustClassification" IN ('independent', 'beneficiary_controlled') AND
    "evidenceRole" IN ('outcome', 'supporting') AND
    (("trustClassification" = 'beneficiary_controlled') = "beneficiaryControl")
  ),
  ADD CONSTRAINT "EvidenceRecord_role_valid" CHECK ("ingestedByRole" IN ('author', 'operator')),
  ADD CONSTRAINT "EvidenceRecord_amount_currency_pair" CHECK (
    ("amountMinor" IS NULL AND "currency" IS NULL) OR
    ("amountMinor" BETWEEN 0 AND 9007199254740991 AND "currency" IN ('USD', 'EUR', 'GBP', 'ILS', 'JPY'))
  ),
  ADD CONSTRAINT "EvidenceRecord_fields_bounded" CHECK (
    length("evidenceId") <= 256 AND length("recoveryCaseId") <= 256 AND
    COALESCE(length("proofId"), 0) <= 256 AND length("sourceSystem") <= 256 AND
    length("sourceRecordId") <= 2048 AND length("evidenceType") <= 256 AND
    length("roleMapVersion") <= 256 AND length("ingestedBy") <= 256 AND
    COALESCE(length("note"), 0) <= 4000
  );

ALTER TABLE "agent_tasks"
  ADD CONSTRAINT "agent_tasks_fields_bounded" CHECK (
    length("task_id") <= 256 AND length("boundary_id") <= 256 AND
    length("agent_id") <= 256 AND length("idempotency_key") <= 2048 AND
    octet_length("payload"::text) <= 1048576 AND
    ("result" IS NULL OR octet_length("result"::text) <= 1048576) AND
    COALESCE(length("last_error"), 0) <= 4000
  );

ALTER TABLE "agent_case_candidates"
  ADD CONSTRAINT "agent_case_candidates_fields_bounded" CHECK (
    length("candidate_id") <= 256 AND length("dedupe_key") = 64 AND
    length("boundary_id") <= 256 AND length("agent_id") <= 256
  );

ALTER TABLE "recovery_cases"
  ADD CONSTRAINT "recovery_cases_fields_bounded" CHECK (
    length("recovery_case_id") <= 256 AND length("boundary_id") <= 256 AND
    length("source_candidate_id") <= 256 AND length("recovery_type") <= 128 AND
    length("source_ref") <= 2048 AND length("detector_version") <= 256 AND
    length("opened_by_actor_id") <= 256 AND length("policy_version") <= 256
  );
