-- EP-15 · Pilot admission policy governance.
--
-- Splits proposing a fitness bar from activating it. The customer side may propose; only pilot
-- governance may activate. A bar you set for yourself is the first input to the number you benefit
-- from, which is precisely what the trust invariant forbids.

-- 1 · Every policy carries a deterministic hash of its thresholds.
-- Existing rows predate governance and have no decisions bound to them, so a sentinel is honest
-- here: it marks them as un-hashed rather than inventing a hash that would look verified.
ALTER TABLE "pilot_admission_policies"
    ADD COLUMN "policy_hash" TEXT NOT NULL DEFAULT 'sha256:unhashed-pre-ep15';
ALTER TABLE "pilot_admission_policies" ALTER COLUMN "policy_hash" DROP DEFAULT;

-- 2 · Append-only lifecycle log. Status is derived from these events, never stored as a column.
CREATE TABLE "PilotAdmissionPolicyEventRecord" (
    "id"             TEXT NOT NULL,
    "boundary_id"    TEXT NOT NULL,
    "policy_id"      TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "transition"     TEXT NOT NULL,
    "actor_id"       TEXT NOT NULL,
    "actor_role"     TEXT NOT NULL,
    "rationale"      TEXT NOT NULL,
    "at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotAdmissionPolicyEventRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_policy_events_identity_idx"
    ON "PilotAdmissionPolicyEventRecord" ("boundary_id", "policy_id", "policy_version", "at");

ALTER TABLE "PilotAdmissionPolicyEventRecord"
    ADD CONSTRAINT "pilot_policy_events_known_transition" CHECK (
        "transition" IN ('PROPOSED', 'ACTIVATED', 'FROZEN', 'UNFROZEN', 'RETIRED')
    ),
    -- A governance decision with no stated reason is not one.
    ADD CONSTRAINT "pilot_policy_events_rationale_present" CHECK (length(trim("rationale")) > 0);

CREATE TRIGGER "pilot_policy_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "PilotAdmissionPolicyEventRecord"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 3 · First sighting of a dataset per boundary. A policy activated AFTER a dataset was first seen
-- may not judge it — that ordering is what stops a bar being tuned to a result already observed.
-- Fingerprint only: no row content and no customer identifiers.
CREATE TABLE "PilotDatasetSightingRecord" (
    "boundary_id"         TEXT NOT NULL,
    "dataset_fingerprint" TEXT NOT NULL,
    "first_seen_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_dataset_sightings_pkey" PRIMARY KEY ("boundary_id", "dataset_fingerprint")
);

-- The FIRST sighting is the one that matters; a later submission must never move it later and
-- thereby make a newly-activated policy look pre-registered.
CREATE TRIGGER "pilot_dataset_sightings_no_mutation"
    BEFORE UPDATE OR DELETE ON "PilotDatasetSightingRecord"
    FOR EACH ROW EXECUTE FUNCTION nh_reject_mutation();

-- 4 · Each decision records the exact bar it was judged under. Nullable because a submission can be
-- refused before any policy is consulted; when present these three are frozen forever.
ALTER TABLE "pilot_dataset_submissions"
    ADD COLUMN "admission_outcome"        TEXT,
    ADD COLUMN "admission_policy_id"      TEXT,
    ADD COLUMN "admission_policy_version" TEXT,
    ADD COLUMN "admission_policy_hash"    TEXT;
