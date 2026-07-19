# Mission #008 — Reconstruction Mapping Register (Phase 1)

> Traceability register mapping every field-group in `research/exports/mission-007/dataset.json`
> to the reconstructed Markdown. Built from the dataset alone. No Mission #007 Markdown was read.
>
> **Status legend:** DIRECT = value copied verbatim · MECHANICAL_FORMATTING = reformatted only
> (table cell / list) with no meaning change · NOT_RECONSTRUCTABLE = human-readable element cannot be
> produced because the JSON does not carry it · AMBIGUOUS = JSON carries it but its human meaning is
> under-determined.

## Mission object

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Charter → Identity | `M007` | `mission_id`, `title` | Copied into header/fields | DIRECT | None. |
| Charter → Decision & questions | `M007` | `decision_supported`, `research_question[]`, `question_type[]` | Array rendered as list | MECHANICAL_FORMATTING | None. |
| Charter → Scope | `M007` | `scope`, `out_of_scope`, `geographic_scope`, `industry_scope` | Copied into fields | DIRECT | None. |
| Charter → Materiality & confidence | `M007` | `materiality_level`, `required_confidence` | Copied into fields | DIRECT | None. |
| Charter → Dates | `M007` | `as_of_date`, `start_date` | Copied into fields | DIRECT | None. |
| Charter → People & status | `M007` | `owner`, `reviewer`, `status`, `completion_status` | Copied into fields | DIRECT | `reviewer` embeds a protocol rationale (NH-ROP §18) as free text; carried verbatim. |
| Charter → Cost if wrong | `M007` | `cost_if_wrong` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Time sensitivity | `M007` | `time_sensitivity` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Definitions | `M007` | `definitions` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Stakeholders | `M007` | `stakeholders` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Pre-research position (bias firewall) | `M007` | `pre_research_position` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Revision history | `M007` | `revision_history` (absent) | — | NOT_RECONSTRUCTABLE | Field not present in dataset.json. |
| Charter → Anchors | `M007` | (no such field) | — | NOT_RECONSTRUCTABLE | No `anchors` field exists in the mission schema or data. |

## Claims (7)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §C, §I — Claim C1 | `M007-C1` | `statement`, `claim_type`, `scope`, `materiality`, `current_verdict`, `confidence`, `confidence_rationale`, `overturn_conditions`, `origin`, `supporting_evidence[]`, `reviewer`, `last_reviewed` | Fields → table cells; `statement` verbatim | DIRECT / MECHANICAL_FORMATTING | `contradicting_evidence` absent for C1 (empty). |
| Record §C, §I — Claim C2 | `M007-C2` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. |
| Record §C, §I — Claim C3 | `M007-C3` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. |
| Record §C, §I — Claim C4 | `M007-C4` | same field set + `contradicting_evidence[]` | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | Only claim with `contradicting_evidence` (`M007-C4-E2`). |
| Record §C, §I — Claim C5 | `M007-C5` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. |
| Record §C, §I — Claim C6 | `M007-C6` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. |
| Record §C, §I — Claim C7 | `M007-C7` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `supporting_evidence` is an empty array — claim has no evidence (verdict Inconclusive). Carried as empty. |
| Claims → version_history | all `M007-C*` | `version_history` (absent) | — | NOT_RECONSTRUCTABLE | No claim carries version history in the dataset. |

## Evidence (8)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §D + §A pointer | `M007-C1-E1` | `source_id`, `claim_id`, `exact_finding`, `direction`, `evidence_type`, `extraction_method`, `quote_or_paraphrase`, `location`, `date_published`, `date_accessed`, `applicable_scope`, `limitations`, `researcher_notes`, `verification_status`, `independence_group`, `strength_category` | Fields → table cells; O-pointer surfaced in §A | DIRECT / MECHANICAL_FORMATTING | `researcher_notes` = "MD trace: RESEARCH_RECORD.md observation O1" points to prose in an unreadable file. |
| Record §D + §A pointer | `M007-C1-E2` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | O-pointer O2; target prose not in dataset. |
| Record §D + §A pointer | `M007-C2-E1` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | `limitations` note a number discrepancy: "some summaries cite 317 experiments / 184 articles" vs the 254-studies claim. Carried verbatim, flagged. |
| Record §D + §A pointer | `M007-C3-E1` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | O-pointer O3. |
| Record §D + §A pointer | `M007-C4-E1` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | O-pointer O1 (shared with C1-E1/C2-E1). |
| Record §D + §A pointer | `M007-C4-E2` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | `direction` = "Limits"; O-pointer O4. |
| Record §D + §A pointer | `M007-C5-E1` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | `verification_status` = "Vendor-Claim"; O-pointer O5. |
| Record §D + §A pointer | `M007-C6-E1` | same field set | Fields → table cells; O-pointer surfaced | DIRECT / MECHANICAL_FORMATTING | O-pointer O4 (shared with C4-E2). |
| Observation prose (§A) | all evidence | (observation text, absent) | — | NOT_RECONSTRUCTABLE | Only pointers O1..O5 exist in `researcher_notes`; the observation prose lives only in the Markdown. |
| Evidence → quality_dimensions | all evidence | `quality_dimensions` (absent) | — | NOT_RECONSTRUCTABLE | No evidence carries per-dimension 0–5 scores. |

## Sources (5)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §E — Source S001 | `S001` | `title`, `author_or_org`, `publisher`, `url_or_internal_location`, `publication_date`, `access_date`, `source_type`, `primary_or_secondary`, `commercial_interest`, `methodology_disclosed`, `data_availability`, `retraction_or_correction_status`, `independence_group`, `reliability_notes` | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `data_availability` notes primary article not fetched (secondary access). |
| Record §E — Source S002 | `S002` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `reliability_notes` records shared lineage L01 with S001. |
| Record §E — Source S003 | `S003` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. |
| Record §E — Source S004 | `S004` | same field set | Fields → table cells | AMBIGUOUS | Identity is an aggregate: "assorted learning-science reviews", publisher "assorted", location a description not a URL; single `publication_date` "2013" for a collection. |
| Record §E — Source S005 | `S005` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `commercial_interest` = "software vendors"; `methodology_disclosed` = "no". |

## Assumption (1)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §F — Assumption A1 | `M007-A1` | `statement`, `why_needed`, `claims_affected[]`, `evidence_status`, `risk_if_false`, `validation_method`, `owner`, `status` | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | None. Affects `M007-C4`, `M007-C7`. |

## Unknown (1)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §G — Unknown U1 | `M007-U1` | `exact_open_question`, `why_it_matters`, `claims_affected[]`, `materiality`, `search_attempts[]`, `missing_evidence`, `blocks_decision`, `recommended_next_action`, `status` | Fields → table cells; array → list | DIRECT / MECHANICAL_FORMATTING | `blocks_decision` = false; `status` = "Isolated". Affects `M007-C4`, `M007-C7`. |

## Contradiction (1)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §H — Contradiction X1 | `M007-X1` | `in_conflict[]`, `nature_of_conflict`, `possible_explanations[]`, `scope_differences`, `definition_differences`, `methodological_differences`, `resolution_status`, `impact_on_verdict`, `required_follow_up` | Fields → table cells; array → list | DIRECT / MECHANICAL_FORMATTING | `date_differences` absent (not present for X1). Conflict between `M007-C4` and `M007-C6`. |

## Verdicts (7)

| Reconstructed section | Source JSON object ID | Source JSON field(s) | Transformation applied | Status | Ambiguity / information loss |
|---|---|---|---|---|---|
| Record §I — Verdict C1 | verdict for `M007-C1` | `verdict_status`, `confidence`, `confidence_rationale`, `evidence_summary`, `strongest_support`, `scope_of_validity`, `overturn_conditions`, `outcome_ladder_classification`, `review_date`, `reviewer` | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `outcome_ladder_classification` = "N/A" (non-revenue claim). |
| Record §I — Verdict C2 | verdict for `M007-C2` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | outcome ladder "N/A". |
| Record §I — Verdict C3 | verdict for `M007-C3` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | outcome ladder "N/A". |
| Record §I — Verdict C4 | verdict for `M007-C4` | same field set + `strongest_contradiction` | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | Only verdict with `strongest_contradiction` (`M007-C4-E2`). outcome ladder "N/A". |
| Record §I — Verdict C5 | verdict for `M007-C5` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | outcome ladder "N/A". |
| Record §I — Verdict C6 | verdict for `M007-C6` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | outcome ladder "N/A". |
| Record §I — Verdict C7 | verdict for `M007-C7` | same field set | Fields → table cells | DIRECT / MECHANICAL_FORMATTING | `strongest_support` is empty string (no supporting evidence). outcome ladder "N/A". |
| Verdicts → remaining_unknowns / assumptions arrays | all verdicts | `remaining_unknowns`, `assumptions` (absent) | — | NOT_RECONSTRUCTABLE | No verdict carries these optional arrays in the dataset. |
