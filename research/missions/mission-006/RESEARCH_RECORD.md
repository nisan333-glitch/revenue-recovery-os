# Mission #006 — Research Record (human-readable; derived from dataset.json)

> Generated from `research/exports/mission-006/dataset.json` using the **same IDs**. All verdict/confidence/
> type/status/direction values are from the frozen NH-ROP controlled vocabularies. As-of 2026-07-18.

## Claims
| ID | Statement | Type | Verdict | Confidence | Supporting | Contradicting |
|---|---|---|---|---|---|---|
| M006-C1 | Organized researcher-evaluated 4-day-week (100-80-100) trials exist (UK 2022 61-company pilot). | Existence | Supported | High | E1, E2 | — |
| M006-C2 | UK pilot: ~92% (56/61) continued immediately; ~89% (54/61) one year on. | Adoption | Supported | Moderate | C2-E1 | — |
| M006-C3 | A four-day week **causes** maintained/improved productivity. | Causal | **Inconclusive** | Low | C3-E1 | C3-E2 |
| M006-C4 | UK pilot participants reported large wellbeing gains (~71% less burnout). | Customer | Supported | Moderate | C4-E1 | — |
| M006-C5 | The four-day week generalizes to **all** sectors/org types. | Universal | Partially Supported | Moderate | C5-E1 | C5-E2 (Limits) |
| M006-C6 | Rigorous RCT evidence with objective output isolating the causal effect is limited. | Negative | Supported | Moderate | C6-E1 | — |
| M006-C7 | A four-day week reduces a firm's total energy/carbon footprint. | Causal | **Unsupported** | Low | — | — |

## Evidence
| ID | Claim | Source | Direction | Verification | Lineage | Strength | Finding (short) |
|---|---|---|---|---|---|---|---|
| M006-C1-E1 | C1 | S001 | Supports | Partially-Verified | L01 | Strong | 61-company UK pilot 2022, academic-evaluated |
| M006-C1-E2 | C1 | S002 | Supports | **Unverified** | L02 | Limited | Iceland public-sector trials (recalled) |
| M006-C2-E1 | C2 | S001 | Supports | Partially-Verified | L01 | Strong | 56/61 then 54/61 continued |
| M006-C3-E1 | C3 | S001 | Supports | Partially-Verified | L01 | Limited | revenue "broadly stable" (self-reported) |
| M006-C3-E2 | C3 | S003 | **Contradicts** | Partially-Verified | L03 | Moderate | selection bias + self-report undermine causal inference |
| M006-C4-E1 | C4 | S001 | Supports | Partially-Verified | L01 | Moderate | 71% reduced burnout; 39% less stressed (self-reported) |
| M006-C5-E1 | C5 | S001 | Supports | Partially-Verified | L01 | Moderate | worked for participating firms |
| M006-C5-E2 | C5 | S003 | **Limits** | Partially-Verified | L03 | Moderate | participants skew office/knowledge work |
| M006-C6-E1 | C6 | S003 | Supports | Partially-Verified | L03 | Moderate | no qualifying RCT with objective output identified |

## Sources (lineage)
| ID | Title | Type | Primary? | COI | Lineage |
|---|---|---|---|---|---|
| S001 | UK four-day week pilot results (Autonomy / 4 Day Week Global / Boston College / Cambridge) | Industry-research | Primary | **advocacy (promotes the policy)** | L01 |
| S002 | Iceland public-sector reduced-hours trials | Industry-research | Secondary | advocacy | L02 |
| S003 | Methodological critique (selection bias; self-report; sector skew) | Expert-interpretation | Secondary | none identified | L03 |

*(UK pilot data + its academic analyses share origin **L01** = one confirmation; C1 additionally draws on
**L02** (Iceland). The critique is a distinct lineage **L03**.)*

## Assumptions
| ID | Statement | Risk if false | Status | Affects |
|---|---|---|---|---|
| M006-A1 | Volunteer-firm pilot results generalize to mandated adoption and non-office sectors. | **High** | **Open** | C3, C5 |

## Unknowns
| ID | Open question | Blocks decision? | Status | Affects |
|---|---|---|---|---|
| M006-U1 | Objective (non-self-reported) productivity output, esp. non-office sectors? | No | Isolated | C3, C6 |

## Contradictions
| ID | In conflict | Nature | Resolution |
|---|---|---|---|
| M006-X1 | C3 ↔ C6 | self-reported pilot signals vs limited rigorous causal evidence | **Methodologically-unresolved** → keeps C3 Inconclusive |

## Verdicts
One `verdict` object per claim in `dataset.json` (status/confidence mirror the claim; `outcome_ladder_classification` = N/A — no revenue claim). Founder = author-reviewer (L2).
