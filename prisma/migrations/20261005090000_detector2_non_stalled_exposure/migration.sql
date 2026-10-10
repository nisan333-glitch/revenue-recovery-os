-- DETECTOR #2 · the non-stalled exposure reading, stored BESIDE the assessment finding.
--
-- WHY THESE ARE COLUMNS ON THE EXISTING TABLE AND NOT A NEW TABLE. The two artifacts are 1:1 with an
-- execution and are always produced together by the same agent run. Riding along in the SAME INSERT
-- inherits that path's idempotency, its atomicity and its append-only trigger, instead of duplicating
-- subtle conflict logic in a second table and a second store. The alternative — a sibling table — was
-- considered and rejected for exactly that reason.
--
-- WHAT STAYS UNTOUCHED, and this is the whole point of the slice. `finding` keeps exactly the serialised
-- AssessmentFinding and `finding_hash` keeps covering only the finding. The exposure gets its OWN hash
-- and its OWN method version, so a change to how exposure is computed can never alter a historical
-- assessment finding's witness, force a calculation-method bump, or require a governed terms version to
-- be re-blessed.
--
-- NULLABLE, DELIBERATELY. Every execution completed before this migration has a finding and no exposure.
-- NULL means "not computed for this execution" — which is a DIFFERENT FACT from zero exposure, and the
-- read surface and the UI are required to say so rather than rendering a reassuring 0.00.

ALTER TABLE "pilot_assessment_findings"
    ADD COLUMN "exposure"                JSONB,
    ADD COLUMN "exposure_hash"           TEXT,
    ADD COLUMN "exposure_method_version" TEXT;

-- All three together or none of them. A half-written exposure would be a reading nobody could verify:
-- a payload with no witness, or a witness with no payload.
ALTER TABLE "pilot_assessment_findings"
    ADD CONSTRAINT "pilot_assessment_findings_exposure_complete" CHECK (
        ("exposure" IS NULL AND "exposure_hash" IS NULL AND "exposure_method_version" IS NULL)
        OR ("exposure" IS NOT NULL AND "exposure_hash" IS NOT NULL AND "exposure_method_version" IS NOT NULL)
    );

-- The same witness shape the finding's own hash is held to, so one cannot drift from the other.
ALTER TABLE "pilot_assessment_findings"
    ADD CONSTRAINT "pilot_assessment_findings_exposure_hash_present" CHECK (
        "exposure_hash" IS NULL OR "exposure_hash" LIKE 'sha256:%'
    );
