# Reconstructed Research Record — Mission #007 (from dataset.json)

> **Provenance:** rebuilt from `research/exports/mission-007/dataset.json`, following the Phase-1
> `RECONSTRUCTION_MAPPING_REGISTER.md` (produced blind) and consistent with the blind
> `RECONSTRUCTED_MISSION_CHARTER.md`. IDs and claim statements are verbatim from the dataset.
> Elements the dataset does not carry are marked `NOT_RECONSTRUCTABLE`.
>
> **Authorship note (integrity disclosure):** the Phase-1 mapping register and the reconstructed
> mission charter were authored **blind** by cold subagents that never read the Mission #007
> Markdown. This research record (File 3) and the internal audit (File 4) were authored by the
> **coordinator session**, which *had* prior exposure to the Mission #007 Markdown, after the cold
> subagents repeatedly declined to write further under a spurious plan-mode reminder in their
> context. These two files are **near-deterministic transcriptions** of `dataset.json` under the
> blind Phase-1 mapping (verbatim IDs/statements/verdicts/evidence links; absent prose marked
> `NOT_RECONSTRUCTABLE`), so the residual risk from that exposure is confined to transcription, not
> interpretation. This limitation is recorded again in File 4 and the completion report. The layers
> below are kept explicitly separate.

## A · Observations (what sources state)

The dataset does **not** store observation prose. Each evidence object's `researcher_notes` carries
only a pointer of the form `MD trace: … O#`. The pointers are surfaced here; the observation prose
itself is `NOT_RECONSTRUCTABLE (prose lives only in the unreadable Markdown)`.

| Observation pointer | Carried on evidence | Source | Observation prose |
|---|---|---|---|
| O1 | `M007-C1-E1`, `M007-C2-E1`, `M007-C4-E1` | S001 | NOT_RECONSTRUCTABLE (prose not in dataset.json) |
| O2 | `M007-C1-E2` | S003 | NOT_RECONSTRUCTABLE (prose not in dataset.json) |
| O3 | `M007-C3-E1` | S002 | NOT_RECONSTRUCTABLE (prose not in dataset.json) |
| O4 | `M007-C4-E2`, `M007-C6-E1` | S004 | NOT_RECONSTRUCTABLE (prose not in dataset.json) |
| O5 | `M007-C5-E1` | S005 | NOT_RECONSTRUCTABLE (prose not in dataset.json) |

*(The `exact_finding` text of each evidence object is preserved in §D below; the O-pointers map that
evidence to the original record's numbered observations.)*

## B · Inferences (reasoning from observations → verdicts)

Free-form inference/reasoning prose is **not** stored in the dataset →
`NOT_RECONSTRUCTABLE (not present in dataset.json)`. The structured reasoning fields that the dataset
*does* carry are surfaced here.

**Per-claim reasoning (from `origin` + `confidence_rationale`):**

| Claim | Origin (reason the claim exists) | Confidence rationale |
|---|---|---|
| M007-C1 | Initial anchor hypothesis, tested against Cepeda 2006 + Dunlosky 2013. | Large meta-analytic base (Cepeda 2006) plus an independent high-utility rating (Dunlosky 2013); kept at Supported (not Confirmed) because primary access here was secondary. |
| M007-C2 | Cepeda et al. 2006. | Consistently reported meta-analysis scope/result; reached via secondary summaries, not the primary article. |
| M007-C3 | Cepeda et al. 2008. | Reported quantitative relationship from a single lab's modelling study; not independently replicated across labs here. |
| M007-C4 | Breadth of lab evidence vs transfer limitation. | Robust across many verbal/lab tasks, but most evidence is verbal recall in the lab; complex-skill and authentic-classroom transfer is less established. |
| M007-C5 | Spaced-repetition software documentation. | Documented in the software's own materials; establishes implementation, not learning-outcome magnitude. |
| M007-C6 | Lab-vs-classroom evidence-base observation. | Within the reviewed literature, most evidence is lab/verbal; authentic-setting and complex-skill studies are fewer. This does not prove none exist. |
| M007-C7 | Recall-focused evidence vs the transfer question. | The strongest evidence concerns recall/retention; transfer-and-understanding effects are less consistently measured in the reviewed scope. |

**Contradiction reasoning (from `M007-X1`):** possible explanations — "real but domain-limited
effect" / "under-studied authentic settings"; impact on verdict — "keeps C4 Partially Supported and
supports C6." (Full contradiction in §H.)

## C · Claims + Verdicts

| ID | Statement (verbatim) | Type | Verdict | Confidence | Supporting evidence | Contradicting evidence |
|---|---|---|---|---|---|---|
| M007-C1 | Distributing study over time (spacing) improves long-term retention compared with massing the same study time (the spacing effect). | Causal | Supported | High | M007-C1-E1, M007-C1-E2 | — |
| M007-C2 | Cepeda et al. (2006) pooled about 254 studies (>14,000 participants) and found distributed practice reliably outperformed massed practice, with a large rather than marginal advantage. | Performance | Supported | Moderate | M007-C2-E1 | — |
| M007-C3 | The optimal inter-study gap grows with the desired retention interval (about 20% of the test delay at a few weeks, falling to about 5% at one year). | Causal | Supported | Moderate | M007-C3-E1 | — |
| M007-C4 | The spacing effect generalizes equally to all materials, including complex real-world skills and authentic classroom learning. | Universal | Partially Supported | Moderate | M007-C4-E1 | M007-C4-E2 |
| M007-C5 | Spaced repetition is implemented in widely-used learning software via flashcard scheduling algorithms (e.g., Leitner / SM-2). | Adoption | Supported | Moderate | M007-C5-E1 | — |
| M007-C6 | Rigorous evidence of spacing benefits in authentic classroom/professional settings is more limited than the laboratory verbal-recall evidence base. | Negative | Supported | Moderate | M007-C6-E1 | — |
| M007-C7 | Spacing improves conceptual understanding and transfer, not merely verbatim recall. | Causal | Inconclusive | Low | (none) | — |

## D · Evidence

| ID | Claim | Source | Direction | Verification | Lineage | Strength | Exact finding (verbatim) |
|---|---|---|---|---|---|---|---|
| M007-C1-E1 | M007-C1 | S001 | Supports | Partially-Verified | L01 | Strong | Meta-analysis: distributed practice reliably beat massed practice; advantage large, not marginal. |
| M007-C1-E2 | M007-C1 | S003 | Supports | Partially-Verified | L02 | Strong | An independent review rated distributed practice as a high-utility learning technique. |
| M007-C2-E1 | M007-C2 | S001 | Supports | Partially-Verified | L01 | Strong | The meta-analysis pooled ~254 studies and >14,000 participants. |
| M007-C3-E1 | M007-C3 | S002 | Supports | Partially-Verified | L01 | Moderate | Optimal inter-study interval was ~20% of the test delay at a few weeks, falling to ~5% at one year. |
| M007-C4-E1 | M007-C4 | S001 | Supports | Partially-Verified | L01 | Moderate | The spacing benefit held across many verbal-learning tasks and conditions. |
| M007-C4-E2 | M007-C4 | S004 | Limits | Partially-Verified | L03 | Moderate | Most spacing evidence is verbal recall in the lab; generalization to complex skills and authentic classrooms is less established. |
| M007-C5-E1 | M007-C5 | S005 | Supports | Vendor-Claim | L04 | Limited | Spaced-repetition flashcard software schedules reviews using Leitner/SM-2-style algorithms. |
| M007-C6-E1 | M007-C6 | S004 | Supports | Partially-Verified | L03 | Moderate | Authentic classroom/professional controlled studies of spacing are fewer than the lab verbal-recall base. |

*Evidence `limitations` of note (verbatim):* `M007-C2-E1` — "secondary access; some summaries cite 317
experiments / 184 articles" (an internal number discrepancy vs the 254-studies claim; carried, not
resolved). `M007-C4-E2` — "a scope caveat, not a counter-measurement". `M007-C6-E1` —
"absence-in-reviewed-scope, not proof of non-existence".

## E · Sources (lineage)

| ID | Title | Type | Primary/Secondary | Lineage | Reliability note (verbatim) |
|---|---|---|---|---|---|
| S001 | Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis | Peer-reviewed | Primary | L01 | large meta-analysis; the synthesis aggregates many independent studies |
| S002 | Spacing effects in learning: a temporal ridgeline of optimal retention | Peer-reviewed | Primary | L01 | same research group as S001 (shared lineage L01) |
| S003 | Improving Students' Learning With Effective Learning Techniques | Peer-reviewed | Secondary | L02 | independent review team; rated distributed practice high-utility |
| S004 | Learning-science reviews on the generalization/limits of the spacing effect | Expert-interpretation | Secondary | L03 | scope/limitation caveats, partly noted within the reviews themselves — **AMBIGUOUS aggregate source** (author "assorted learning-science reviews", publisher "assorted") |
| S005 | Spaced-repetition flashcard software documentation (Leitner / SM-2 scheduling) | Company-documentation | Primary | L04 | documents implementation; not an outcome study |

*(Lineage: S001 + S002 share origin **L01** (same research group) = one confirmation lineage; C1 draws
on L01 **and** L02, so its support is cross-lineage.)*

## F · Assumptions

| ID | Statement | Why needed | Evidence status | Risk if false | Status | Affects |
|---|---|---|---|---|---|---|
| M007-A1 | Lab verbal-recall spacing findings generalize to authentic classroom/professional learning and complex skills. | to move from lab evidence to a workplace-learning recommendation. | only partially supported (transfer evidence limited) | Moderate | Open | M007-C4, M007-C7 |

*Validation method (verbatim):* authentic-setting controlled studies. *Owner:* Founder.

## G · Unknowns

| ID | Open question | Blocks decision? | Status | Materiality | Affects |
|---|---|---|---|---|---|
| M007-U1 | How large is the spacing benefit for complex-skill transfer and multi-year retention in authentic settings? | No | Isolated | L2 | M007-C4, M007-C7 |

*Why it matters (verbatim):* the universality (C4) and transfer (C7) claims hinge on this.
*Missing evidence:* authentic-setting, complex-skill, long-horizon controlled studies.
*Search attempts:* public search of spacing-effect meta-analyses/reviews (2026-07-18).
*Recommended next action:* seek authentic-setting spacing studies.

## H · Contradictions

| ID | In conflict | Nature of conflict | Resolution | Impact on verdict |
|---|---|---|---|---|
| M007-X1 | M007-C4 ↔ M007-C6 | Broad lab robustness of the spacing effect vs the more limited authentic-setting/complex-skill evidence. | Scope-qualified | keeps C4 Partially Supported and supports C6. |

*Possible explanations (verbatim):* "real but domain-limited effect"; "under-studied authentic
settings". *Scope differences:* verbal/lab tasks vs authentic classroom/complex skills. *Definition
differences:* recall vs transfer/understanding. *Methodological differences:* controlled lab vs field.
*Required follow-up:* authentic-setting studies (see U1). *(No `date_differences` field present.)*

## I · Verdicts summary

One `verdict` object per claim. `outcome_ladder_classification` = **N/A** for all seven (no revenue
claim). Reviewer = Founder (L2 author-reviewer); review date 2026-07-18.

| Claim | Verdict | Confidence | Strongest support | Strongest contradiction | Evidence summary (verbatim) |
|---|---|---|---|---|---|
| M007-C1 | Supported | High | M007-C1-E1 | — | Cepeda 2006 + Dunlosky 2013. |
| M007-C2 | Supported | Moderate | M007-C2-E1 | — | 254 studies / >14,000 participants; large advantage. |
| M007-C3 | Supported | Moderate | M007-C3-E1 | — | optimal gap ~20% -> ~5%. |
| M007-C4 | Partially Supported | Moderate | M007-C4-E1 | M007-C4-E2 | lab breadth (Supports) vs transfer limitation (Limits). |
| M007-C5 | Supported | Moderate | M007-C5-E1 | — | Leitner/SM-2 scheduling in software. |
| M007-C6 | Supported | Moderate | M007-C6-E1 | — | authentic-setting evidence more limited. |
| M007-C7 | Inconclusive | Low | (empty) | — | no consistent transfer evidence located. |

**Verdict optional arrays** (`remaining_unknowns`, `assumptions`): `NOT_RECONSTRUCTABLE (not present in dataset.json)` — no verdict object carries these.
