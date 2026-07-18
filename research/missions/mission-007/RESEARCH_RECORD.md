# Mission #007 — Research Record (human-readable; derived from dataset.json)

> Generated from `research/exports/mission-007/dataset.json` using the **same IDs**. All verdict/confidence/
> type/status/direction values are from the frozen NH-ROP controlled vocabularies. As-of 2026-07-18.
> **Evidence was collected before verdicts were written.** The layers below are kept explicitly separate.

## A · Observations (what sources state — no interpretation)
| # | Observation | Source | Evidence ID |
|---|---|---|---|
| O1 | Cepeda et al. (2006) meta-analysis: distributed practice reliably beat massed; advantage large; pooled ~254 studies / >14,000 participants (some summaries: 317 experiments / 184 articles). | S001 | M007-C1-E1, M007-C2-E1, M007-C4-E1 |
| O2 | Dunlosky et al. (2013) rated distributed practice a **high-utility** learning technique. | S003 | M007-C1-E2 |
| O3 | Cepeda et al. (2008): optimal inter-study gap ≈ 20% of the test delay at a few weeks, falling to ≈ 5% at one year. | S002 | M007-C3-E1 |
| O4 | Learning-science reviews note most spacing evidence is verbal recall in the lab; authentic-classroom / complex-skill transfer is less established / less studied. | S004 | M007-C4-E2, M007-C6-E1 |
| O5 | Spaced-repetition software schedules reviews via Leitner / SM-2 algorithms. | S005 | M007-C5-E1 |

## B · Inferences (author's reasoning from observations → verdicts)
- From O1+O2 (two independent lineages) → the core spacing effect is **Supported** (C1), high confidence in
  *direction*; kept below Confirmed due to secondary access.
- From O1 → the meta-analysis scope/result claim is **Supported** (C2).
- From O3 → the gap/retention-interval relationship is **Supported** but single-lab (C3, Moderate).
- From O1 (breadth, but within verbal/lab) **vs** O4 (transfer limitation) → the **universal** claim is only
  **Partially Supported** (C4); and authentic-setting evidence is comparatively limited → **Supported**
  negative (C6).
- From O5 → implementation in software is **Supported** (C5) — implementation, not outcome magnitude.
- Recall evidence does **not** establish transfer/understanding → C7 **Inconclusive**.

## C · Claims (verdicts)
| ID | Statement | Type | Verdict | Confidence | Supporting | Contradicting |
|---|---|---|---|---|---|---|
| M007-C1 | Spacing improves long-term retention vs massing (the spacing effect). | Causal | Supported | High | E1, E2 | — |
| M007-C2 | Cepeda 2006 pooled ~254 studies/>14k participants; large reliable advantage. | Performance | Supported | Moderate | C2-E1 | — |
| M007-C3 | Optimal gap grows with retention interval (~20%→~5%). | Causal | Supported | Moderate | C3-E1 | — |
| M007-C4 | The spacing effect generalizes **equally to all** materials/settings. | Universal | **Partially Supported** | Moderate | C4-E1 | C4-E2 (Limits) |
| M007-C5 | Spaced repetition is implemented in widely-used software (Leitner/SM-2). | Adoption | Supported | Moderate | C5-E1 | — |
| M007-C6 | Authentic-setting evidence is more limited than the lab base. | Negative | Supported | Moderate | C6-E1 | — |
| M007-C7 | Spacing improves conceptual transfer/understanding (not just recall). | Causal | **Inconclusive** | Low | — | — |

## D · Evidence
| ID | Claim | Source | Direction | Verification | Lineage | Strength |
|---|---|---|---|---|---|---|
| M007-C1-E1 | C1 | S001 | Supports | Partially-Verified | L01 | Strong |
| M007-C1-E2 | C1 | S003 | Supports | Partially-Verified | L02 | Strong |
| M007-C2-E1 | C2 | S001 | Supports | Partially-Verified | L01 | Strong |
| M007-C3-E1 | C3 | S002 | Supports | Partially-Verified | L01 | Moderate |
| M007-C4-E1 | C4 | S001 | Supports | Partially-Verified | L01 | Moderate |
| M007-C4-E2 | C4 | S004 | **Limits** | Partially-Verified | L03 | Moderate |
| M007-C5-E1 | C5 | S005 | Supports | **Vendor-Claim** | L04 | Limited |
| M007-C6-E1 | C6 | S004 | Supports | Partially-Verified | L03 | Moderate |

## E · Sources (lineage)
| ID | Title | Type | Lineage | Note |
|---|---|---|---|---|
| S001 | Cepeda et al. 2006 meta-analysis | Peer-reviewed | L01 | synthesis of many independent studies |
| S002 | Cepeda et al. 2008 (optimal-gap) | Peer-reviewed | **L01** | same research group as S001 → one lineage |
| S003 | Dunlosky et al. 2013 review | Peer-reviewed | L02 | independent review team |
| S004 | Generalization/limits reviews | Expert-interpretation | L03 | scope caveats |
| S005 | Spaced-repetition software docs | Company-documentation | L04 | implementation only |

*(S001 + S002 share origin **L01** = one confirmation lineage; C1 draws on L01 **and** L02, so its support is
cross-lineage.)*

## F · Assumptions (explicit — separated from evidence)
| ID | Statement | Risk if false | Status | Affects |
|---|---|---|---|---|
| M007-A1 | Lab verbal-recall findings generalize to authentic/complex learning. | Moderate | **Open** | C4, C7 |

## G · Unknowns (explicit; not converted to certainty)
| ID | Open question | Blocks decision? | Status | Affects |
|---|---|---|---|---|
| M007-U1 | Magnitude of spacing benefit for complex-skill transfer & multi-year authentic retention? | No | Isolated | C4, C7 |

## H · Contradictions
| ID | In conflict | Nature | Resolution |
|---|---|---|---|
| M007-X1 | C4 ↔ C6 | broad lab robustness vs limited authentic/complex evidence | **Scope-qualified** → keeps C4 Partially Supported, supports C6 |

## Verdicts
One `verdict` object per claim in `dataset.json` (mirrors claim status/confidence; `outcome_ladder_classification` = N/A — no revenue claim). Founder = author-reviewer (L2).
