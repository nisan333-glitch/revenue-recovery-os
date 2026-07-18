# Mission #004 — Field Mapping Register (Mission #003 → frozen schemas)

> Maps every frozen-schema object type + required field to Mission #003's committed source, with mapping
> status: **DIRECT** · **DERIVED WITHOUT NEW JUDGMENT** (mechanical only) · **NOT AVAILABLE** · **AMBIGUOUS**.
> Required/optional fields are taken from `research/schemas/*.schema.json` (read this session). Source rows
> are committed Mission #003 files. **No value is derived from narrative implication.**

## Object type: `mission` (research-mission.schema.json) — **EXPORTABLE (all DIRECT)**
| Field (required) | Source (Mission #003) | Status | Transform | Limitation |
|---|---|---|---|---|
| `mission_id` "M003" | `MISSION_CHARTER.md` row "Mission ID" | DIRECT | — | matches `^M[0-9]{3,}$` |
| `title` | charter "Title" | DIRECT | — | — |
| `decision_supported` | charter "Decision supported" | DIRECT | — | — |
| `research_question` [array] | charter "Research question(s)" | DERIVED (mechanical) | wrap the single question string in a 1-element array | array required by schema |
| `scope` | charter "In scope" | DIRECT | — | — |
| `materiality_level` "L3" | charter "Materiality level" (**L3 Strategic**) | DIRECT | — | — |
| `as_of_date` "2026-07-17" | charter "Time boundary / as-of date" | DIRECT | — | ISO date already |
| `owner` | charter "Owner"/"Decision owner" (Founder) | DIRECT | — | — |
| `status` | `MISSION_003_COMPLETION_REPORT.md` (mission closed & committed) | DERIVED (mechanical) | charter said "Active" pre-closure; completion report states closure → `Closed` | explicit closure in a committed artifact |
| `completion_status` | completion report §11 DoD (conditions met) | DERIVED (mechanical) | → `Conditions-met` | explicit in completion report |

*(The `mission` object is fully populatable without invention. It is **not** exported on its own — see the
completion report — because a mission-only dataset preserves zero claims, failing Phase-2's preserve-all-claims
requirement, and the DATASET_NOT_EXPORTABLE completion path was directed.)*

## Object type: `claim` (claim.schema.json) — **NOT EXPORTABLE without invention**
Required (base): `claim_id, statement, claim_type, scope, materiality, current_verdict, confidence,
overturn_conditions`. Conditional (`allOf`, when `materiality ∈ {L3,L4}`): `reviewer, confidence_rationale,
last_reviewed`. Source: `CLAIM_VALIDATION_REGISTER.md` (33 rows) + `REPORT_0X_ANALYSIS.md`.

| Field | Status (across 33 claims) | Evidence / examples |
|---|---|---|
| `claim_id` | **NOT AVAILABLE** (all 33) | Source IDs are report-scoped `M003-R1-C1 … M003-R6-C5`; the frozen pattern is `^M[0-9]{3,}-C[0-9]+$` (no report segment) → none conform. A conforming export ID would be a *generated* renumber; deferred (gap G1). |
| `statement` | DIRECT (33) | `REPORT_0X_ANALYSIS.md` claim tables, "Claim" column |
| `claim_type` | mixed: DERIVED-mechanical (~24, first token of a compound in enum, e.g. `Financial/Outcome`→`Financial`) · **NOT AVAILABLE / out-of-enum (8)** | out-of-enum: `Market/Benchmark` (R1-C5), `Descriptive` (R2-C3), `Framing (meta)` (R2-C5), `Trend` (R3-C2), `Freshness (meta)` (R3-C5, R6-C5), `Meta/verification` (R5-C6), `Meta/method` (R6-C4) |
| `scope` | **NOT AVAILABLE as an explicit field** (33) | scope appears in prose (e.g. R1-C5 "Recurly merchants") but is not a discrete per-claim field; deriving one is judgment |
| `materiality` | **NOT AVAILABLE** (all 33) | Mission #003 assigned materiality at the mission level (L3) only; no per-claim materiality exists |
| `current_verdict` | DERIVED-mechanical for annotated bases (e.g. `Supported (scope)`→`Supported`); **NOT AVAILABLE (2: "Contested" R2-C4, R5-C2)**; **AMBIGUOUS (1: R4-C2 "Supported … ; magnitudes Not Assessable")** | `Contested` is not in the verdict enum; R4-C2 carries two statuses |
| `confidence` | DIRECT (~16 single enum values); **AMBIGUOUS (~14 compound: "Mod-High", "Low–Mod", "Mod (estimated)/Low (realized)")**; **NOT AVAILABLE (3: "—" at R4-C4, R5-C5, R6-C4)** | picking one endpoint of "Mod-High" is judgment; "—" is absent |
| `overturn_conditions` | **partial / NOT AVAILABLE** | per-claim overturn text exists for some claims in `REPORT_0X` "Overturn conditions" sections, not for all 33 |
| `reviewer` (L3) | **NOT AVAILABLE** (all 33) | no per-claim reviewer recorded (mission-level "Founder-as-Critical-Reviewer" only) |
| `confidence_rationale` (L3) | **NOT AVAILABLE** (all 33) | "Key reason" column concerns the verdict, not a distinct confidence rationale; not a per-claim field |
| `last_reviewed` (L3) | **NOT AVAILABLE** (all 33) | no per-claim review date recorded |

## Object types: `evidence`, `source`, `verdict`, `assumption`, `unknown`, `contradiction` — **NOT EXPORTABLE without invention**
| Type | Required fields (schema) | Status | Evidence |
|---|---|---|---|
| `evidence` | evidence_id, source_id, claim_id, exact_finding, direction, date_accessed, applicable_scope, verification_status, independence_group | **NOT AVAILABLE** | Mission #003 kept no structured per-evidence registry with these fields; evidence is described in prose + the `VALIDATION_EVENT_REGISTER.md` (validator-behaviour events, not `evidence` objects). `direction`/`independence_group`/`verification_status` are not recorded per item. |
| `source` | source_id, title, url_or_internal_location, source_type, primary_or_secondary, access_date, independence_group | **NOT AVAILABLE (as structured objects)** | sources appear in per-report prose/appendix, not as `source` records with `source_type`/`independence_group` fields |
| `verdict` | claim_id, verdict_status, confidence, confidence_rationale, scope_of_validity, overturn_conditions, review_date, reviewer | **NOT AVAILABLE** | same per-claim gaps as `claim` (reviewer/rationale/review_date/scope absent per claim; "Contested" out of enum) |
| `assumption` | assumption_id, statement, why_needed, risk_if_false, status | **partial** | one assumption exists (`M003-A0` author-COI, charter §Pre-research) but `risk_if_false`/`status` are not recorded in the frozen enum vocabulary per record |
| `unknown` | unknown_id, exact_open_question, why_it_matters, materiality, blocks_decision, status | **partial** | unknowns are discussed in prose (e.g. FN candidate) but not recorded as `unknown` objects with `blocks_decision`/`status` fields |
| `contradiction` | contradiction_id, in_conflict[≥2], nature_of_conflict, resolution_status | **partial** | contradictions (X1/X2/X3) are referenced in the report analyses but not maintained as `contradiction` objects with `resolution_status` enum values |

## Summary
Only the **`mission`** object is populatable without invention. Every `claim` (and the evidence/source/
verdict/assumption/unknown/contradiction registries) is missing ≥1 required field in explicit
machine-extractable form, or uses a value outside the frozen enum/pattern. Detailed gaps →
`DATA_READINESS_GAP_REGISTER.md`.
