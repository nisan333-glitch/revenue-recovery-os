# Mission Charter — rendered from dataset.json (NH deterministic renderer)

> Derived exclusively from `dataset.json` (mission object) + the frozen schema. Field order = schema property order. Absent or empty fields render as `NOT_POPULATED`. No content is inferred or copied from any hand-authored Markdown.

| field | value |
| --- | --- |
| mission_id | M900 |
| title | Synthetic Renderer Golden Fixture (fully-populated; not a real research mission) |
| decision_supported | Whether the deterministic renderer emits stable Markdown across the full supported surface. |
| cost_if_wrong | None — synthetic fixture; no real decision depends on it. |
| research_question | Does the renderer reproduce every object type deterministically and stably? |
| question_type | Technical-feasibility |
| scope | Synthetic objects only; renderer-surface coverage. No real-world claim. |
| out_of_scope | Any real research conclusion; any real entity, product, or study. |
| definitions | lumen_drift: a fictional metric used only for fixture content; Zephyr_coating: a fictional treatment used only for fixture content |
| stakeholders | Renderer maintainer (synthetic); Fixture reviewer (synthetic) |
| materiality_level | L2 |
| required_confidence | Moderate |
| time_sensitivity | None (synthetic). |
| geographic_scope | N/A (synthetic) |
| industry_scope | N/A (synthetic) |
| start_date | 2026-01-01 |
| as_of_date | 2026-01-01 |
| owner | Fixture Author (synthetic) |
| reviewer | Fixture Reviewer (synthetic) |
| status | Closed |
| completion_status | Conditions-met |
| pre_research_position | anchor: synthetic anchor, tested not assumed; bias_firewall: no real position is held |
| revision_history | NOT_POPULATED |

# Research Record — rendered from dataset.json (NH deterministic renderer)

> Derived exclusively from `dataset.json` + the frozen schemas. Column order = schema property order; section order = envelope contract. Absent or empty fields render as `NOT_POPULATED`. No content is inferred or copied from any hand-authored Markdown.

**Mission:** M900

## Observations (§A)

> Observation pointers surfaced from evidence `researcher_notes`. Observation prose is not stored in the dataset -> `NOT_POPULATED`.

| pointer | evidence | sources | observation_prose |
| --- | --- | --- | --- |
| O1 | M900-C1-E1 | S901 | NOT_POPULATED |
| O2 | M900-C1-E2 | S902 | NOT_POPULATED |
| O3 | M900-C2-E1 | S903 | NOT_POPULATED |
| O4 | M900-C2-E2 | S903 | NOT_POPULATED |

## Inferences (§B)

> Free-form inference prose is not stored in the dataset -> `NOT_POPULATED`. The structured reasoning fields that do exist are surfaced below.

### Per-claim reasoning

| claim_id | origin | confidence_rationale |
| --- | --- | --- |
| M900-C1 | Fixture-designed anchor to exercise the §B reasoning surface. | Two synthetic cross-lineage items (LG-A, LG-B); kept Moderate by design. |
| M900-C2 | Breadth-vs-limitation design, to exercise a contradiction. | One supporting and one limiting synthetic item. |
| M900-C3 | Drift-vs-understanding analogue, deliberately left without evidence. | No synthetic evidence by design; deliberately Inconclusive. |

### Contradiction reasoning

| contradiction_id | possible_explanations | impact_on_verdict |
| --- | --- | --- |
| M900-X1 | real-but-limited synthetic effect; under-tested synthetic panel types | keeps M900-C2 Partially Supported (synthetic). |

## Claims (3)

| claim_id | statement | claim_type | scope | subject | predicate | time_period | geography | population_or_market | materiality | origin | related_hypothesis | supporting_evidence | contradicting_evidence | dependencies | assumptions | current_verdict | confidence | confidence_rationale | reviewer | last_reviewed | overturn_conditions | version_history |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-C1 | Applying the fictional Zephyr coating is associated with lower synthetic lumen drift in test panels (fixture claim). | Causal | Synthetic test panels. | Zephyr coating (synthetic) | is associated with lower lumen drift (synthetic) | synthetic 2026 | N/A (synthetic) | synthetic test panels | L2 | Fixture-designed anchor to exercise the §B reasoning surface. | Synthetic hypothesis H-1. | M900-C1-E1; M900-C1-E2 | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | Supported | Moderate | Two synthetic cross-lineage items (LG-A, LG-B); kept Moderate by design. | Fixture Reviewer (synthetic) | 2026-01-01 | A synthetic item showing no association. | NOT_POPULATED |
| M900-C2 | The synthetic effect generalizes to all fictional panel types (fixture universal claim). | Universal | All synthetic panel types. | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | L2 | Breadth-vs-limitation design, to exercise a contradiction. | NOT_POPULATED | M900-C2-E1 | M900-C2-E2 | NOT_POPULATED | NOT_POPULATED | Partially Supported | Moderate | One supporting and one limiting synthetic item. | Fixture Reviewer (synthetic) | 2026-01-01 | Broad synthetic counter-evidence. | NOT_POPULATED |
| M900-C3 | The synthetic effect improves fictional panel understanding beyond drift (fixture inconclusive claim). | Causal | Synthetic understanding outcomes. | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | L2 | Drift-vs-understanding analogue, deliberately left without evidence. | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | NOT_POPULATED | Inconclusive | Low | No synthetic evidence by design; deliberately Inconclusive. | NOT_POPULATED | NOT_POPULATED | Consistent synthetic transfer evidence. | NOT_POPULATED |

## Evidence (4)

| evidence_id | source_id | claim_id | exact_finding | direction | evidence_type | extraction_method | quote_or_paraphrase | location | date_published | date_accessed | applicable_scope | limitations | independence_group | researcher_notes | verification_status | quality_dimensions | strength_category | gating_flaw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-C1-E1 | S901 | M900-C1 | Synthetic dataset A: coated panels showed lower lumen drift than uncoated. | Supports | synthetic-experiment | fixture-authored | coated < uncoated drift (synthetic) | Synthetic Source 1 | 2026 | 2026-01-01 | synthetic panels | synthetic; illustrative only | LG-A | fixture trace: O1 / M900-C1-E1 | Partially-Verified | NOT_POPULATED | Strong | NOT_POPULATED |
| M900-C1-E2 | S902 | M900-C1 | Synthetic review B rated the coating a plausible driver of lower drift. | Supports | synthetic-review | fixture-authored | plausible driver (synthetic) | Synthetic Source 2 | 2026 | 2026-01-01 | synthetic panels | synthetic; secondary | LG-B | fixture trace: O2 / M900-C1-E2 | Partially-Verified | NOT_POPULATED | Moderate | NOT_POPULATED |
| M900-C2-E1 | S903 | M900-C2 | Synthetic breadth note: the effect held across several synthetic panel types. | Supports | synthetic-breadth | fixture-authored | held across types (synthetic) | Synthetic Source 3 | 2026 | 2026-01-01 | synthetic panel types | synthetic; within one lineage | LG-C | fixture trace: O3 / M900-C2-E1 | Partially-Verified | NOT_POPULATED | Moderate | NOT_POPULATED |
| M900-C2-E2 | S903 | M900-C2 | Synthetic limitation note: generalization to exotic synthetic panels is untested. | Limits | synthetic-limitation | fixture-authored | exotic panels untested (synthetic) | Synthetic Source 3 | 2026 | 2026-01-01 | generalization of the synthetic effect | synthetic; a scope caveat | LG-C | fixture trace: O4 / M900-C2-E2 | Partially-Verified | NOT_POPULATED | Moderate | NOT_POPULATED |

## Sources (3)

| source_id | title | author_or_org | publisher | url_or_internal_location | publication_date | access_date | source_type | primary_or_secondary | commercial_interest | methodology_disclosed | data_availability | retraction_or_correction_status | independence_group | reliability_notes | version_or_archive_info |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S901 | Synthetic Source 1 — coated-panel drift dataset (fictional) | Synthetic Lab A | Synthetic Publisher A | synthetic://source-1 | 2026 | 2026-01-01 | Original-data-or-inspectable-system | Primary | none (synthetic) | yes | synthetic dataset | none (synthetic) | LG-A | fictional primary dataset | synthetic v1 archived |
| S902 | Synthetic Source 2 — coating review (fictional) | Synthetic Review Team B | Synthetic Publisher B | synthetic://source-2 | 2026 | 2026-01-01 | Peer-reviewed | Secondary | none (synthetic) | yes | synthetic summary | none (synthetic) | LG-B | fictional independent review team | NOT_POPULATED |
| S903 | Synthetic Source 3 — generalization commentary (fictional) | Synthetic Commentators C | Synthetic Publisher C | synthetic://source-3 | 2026 | 2026-01-01 | Expert-interpretation | Secondary | none (synthetic) | partial | synthetic commentary | none (synthetic) | LG-C | fictional scope commentary | NOT_POPULATED |

## Assumptions (1)

| assumption_id | statement | why_needed | claims_affected | evidence_status | risk_if_false | validation_method | owner | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-A1 | Synthetic lab results generalize to all fictional field panels. | to move the fixture from lab-analogue evidence to a universal-analogue claim. | M900-C2; M900-C3 | only partially supported (synthetic) | Moderate | synthetic field check | Fixture Author (synthetic) | Open |

## Unknowns (1)

| unknown_id | exact_open_question | why_it_matters | claims_affected | materiality | search_attempts | missing_evidence | blocks_decision | recommended_next_action | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-U1 | How large is the synthetic effect for exotic panels and long-horizon drift? | the universal (M900-C2) and understanding (M900-C3) claims hinge on this. | M900-C3 | L2 | synthetic search 2026-01-01 | synthetic exotic-panel, long-horizon data | false | author a synthetic exotic-panel study | Isolated |

## Contradictions (1)

| contradiction_id | in_conflict | nature_of_conflict | possible_explanations | scope_differences | date_differences | definition_differences | methodological_differences | resolution_status | impact_on_verdict | required_follow_up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-X1 | M900-C1; M900-C2 | Synthetic core support vs synthetic generalization limitation. | real-but-limited synthetic effect; under-tested synthetic panel types | core panels vs all panels (synthetic) | NOT_POPULATED | drift vs understanding (synthetic) | controlled vs field (synthetic) | Scope-qualified | keeps M900-C2 Partially Supported (synthetic). | synthetic follow-up (see M900-U1) |

## Verdicts (3)

| claim_id | verdict_revision | claim_statement | verdict_status | evidence_summary | strongest_support | strongest_contradiction | scope_of_validity | confidence | confidence_rationale | remaining_unknowns | assumptions | outcome_ladder_classification | overturn_conditions | review_date | reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M900-C1 | NOT_POPULATED | NOT_POPULATED | Supported | Two synthetic cross-lineage items. | M900-C1-E1 | NOT_POPULATED | synthetic panels | Moderate | cross-lineage synthetic support; secondary access by design. | NOT_POPULATED | NOT_POPULATED | N/A | a synthetic item showing no association. | 2026-01-01 | Fixture Reviewer (synthetic) |
| M900-C2 | NOT_POPULATED | NOT_POPULATED | Partially Supported | One supporting, one limiting synthetic item. | M900-C2-E1 | M900-C2-E2 | synthetic panel types | Moderate | breadth vs limitation, by design. | NOT_POPULATED | NOT_POPULATED | N/A | broad synthetic counter-evidence. | 2026-01-01 | Fixture Reviewer (synthetic) |
| M900-C3 | NOT_POPULATED | NOT_POPULATED | Inconclusive | No synthetic evidence by design. | NOT_POPULATED | NOT_POPULATED | synthetic understanding | Low | deliberately without evidence. | NOT_POPULATED | NOT_POPULATED | N/A | consistent synthetic transfer evidence. | 2026-01-01 | Fixture Reviewer (synthetic) |
