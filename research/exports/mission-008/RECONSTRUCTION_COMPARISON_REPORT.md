# Mission #008 — Reconstruction Comparison & Fidelity Report (Phases 4–5)

> **Phase gate:** the Mission #007 Markdown (`research/missions/mission-007/MISSION_CHARTER.md`,
> `research/missions/mission-007/RESEARCH_RECORD.md`, and the completion report) was read for the
> **first time in this comparison phase** — it was not consulted while Files 1–4 were produced.
> Differences are classified, not silently corrected. The reconstruction (Files 2–3) is left exactly
> as authored; where a difference is found it is recorded here.

## Difference classification legend
`FORMAT_ONLY` · `ORIGINAL_CONTAINS_NON_JSON_NARRATIVE` (meaning present in original Markdown, not in
dataset.json) · `RECONSTRUCTION_OMISSION` (dataset had it, reconstruction dropped it) ·
`RECONSTRUCTION_ADDITION` (reconstruction added content absent from dataset) · `JSON_INFORMATION_LOSS`
(dataset cannot express something the original conveyed) · `ORIGINAL_JSON_MISMATCH` (original Markdown
contradicts the dataset) · `AMBIGUOUS_PRESENTATION` · `NO_MATERIAL_DIFFERENCE`.

## Phase 4 — Controlled comparison

### 4.1 Mission charter

| # | Element | Original Markdown | Reconstruction | Classification |
|---|---|---|---|---|
| 1 | ID / title / decision / question / question-type / materiality / scope / out-of-scope / dates / owner / reviewer / status / completion | present | present, verbatim from JSON | NO_MATERIAL_DIFFERENCE |
| 2 | Claim statements shown in charter/record | **abbreviated** (e.g. C1 "Spacing improves long-term retention vs massing (the spacing effect).") | **full canonical** statement from JSON (e.g. C1 "Distributing study over time (spacing) improves long-term retention compared with massing the same study time…") | FORMAT_ONLY — reconstruction is *more* complete; the original Markdown compressed for table width |
| 3 | "Initial anchors (hypotheses, not assumed): Cepeda 2006; Cepeda 2008" as a charter field | present as a labelled field | marked `NOT_RECONSTRUCTABLE`; anchor substance is partially present in claim `origin` (C1 "Initial anchor hypothesis, tested against Cepeda 2006 + Dunlosky 2013") | ORIGINAL_CONTAINS_NON_JSON_NARRATIVE (partially recoverable via `origin`) |
| 4 | "Pre-research position (bias firewall)" — the explicit "anchor tested, not assumed; verdicts could support / partially / contradict / reject" statement | present, a paragraph | marked `NOT_RECONSTRUCTABLE`; substance partially in C1 `origin` | ORIGINAL_CONTAINS_NON_JSON_NARRATIVE — a *material* research-integrity narrative that the dataset does not store as such |
| 5 | "Findings (plain language)" synthesis paragraph | present | not reproduced (no such field in JSON) | ORIGINAL_CONTAINS_NON_JSON_NARRATIVE — substance is recoverable from Claims+Verdicts (§C/§I), but the reader-facing synthesis prose is Markdown-only |

### 4.2 Research record

| # | Element | Original Markdown | Reconstruction | Classification |
|---|---|---|---|---|
| 6 | §A Observations O1–O5 **prose** | full sentences (e.g. O1 "Cepeda 2006 meta-analysis: distributed practice reliably beat massed; advantage large; pooled ~254 studies / >14,000 participants (some summaries: 317 experiments / 184 articles).") | O-pointers surfaced; prose marked `NOT_RECONSTRUCTABLE` | ORIGINAL_CONTAINS_NON_JSON_NARRATIVE — **but** the substance equals the evidence `exact_finding` + `limitations` that the reconstruction **does** carry verbatim in §D, so the informational content is preserved elsewhere |
| 7 | §B Inferences **prose** ("From O1+O2 (two independent lineages) → …") | narrative bullets | prose marked `NOT_RECONSTRUCTABLE`; `origin` + `confidence_rationale` + contradiction reasoning surfaced in §B | ORIGINAL_CONTAINS_NON_JSON_NARRATIVE — substance largely recoverable from the structured reasoning fields |
| 8 | §C Claims / §D Evidence / §E Sources / §F Assumptions / §G Unknowns / §H Contradictions / verdicts | tables with same IDs and relationships | same IDs, relationships, verdicts, confidence, directions, lineages, resolution | NO_MATERIAL_DIFFERENCE |
| 9 | S001+S002 shared lineage L01; C1 cross-lineage (L01+L02) note | present | present | NO_MATERIAL_DIFFERENCE |
| 10 | Number discrepancy "254 studies" vs "317 experiments / 184 articles" | in O1 prose + noted | carried in `M007-C2-E1` limitations + flagged AMBIGUOUS | NO_MATERIAL_DIFFERENCE (both surface it) |
| 11 | Any factual claim/verdict/confidence in original that the dataset contradicts | — | — | **No `ORIGINAL_JSON_MISMATCH` found** — every verdict, confidence, direction and relationship agrees |

### 4.3 Omissions / additions check
- **RECONSTRUCTION_OMISSION:** none found — every object and relationship in `dataset.json` appears in
  the reconstruction.
- **RECONSTRUCTION_ADDITION:** none found — the reconstruction introduced no claim, evidence, number,
  or narrative absent from `dataset.json` (gaps were marked `NOT_RECONSTRUCTABLE`, not filled).

## Phase 5 — Fidelity assessment

| Dimension | Result | Notes |
|---|---|---|
| ID fidelity | **FULL** | All mission/claim/evidence/source/assumption/unknown/contradiction/verdict IDs preserved verbatim. |
| Count fidelity | **FULL** | 1/7/8/5/1/1/1/7 exactly; confirmed by Stage A (exit 0). |
| Relationship fidelity | **FULL** | Evidence→claim, evidence→source, lineage grouping, contradiction conflict set, assumption/unknown "affects" all preserved. |
| Claim-text fidelity | **FULL (improved)** | Reconstruction carries the full canonical statements; the original Markdown had abbreviated them. |
| Evidence fidelity | **FULL** | Directions (incl. Limits), verification (incl. Vendor-Claim), strengths, findings verbatim. |
| Source-lineage fidelity | **FULL** | L01–L04 preserved; shared-lineage and cross-lineage notes preserved. |
| Verdict fidelity | **FULL** | All 7 verdicts + strongest support/contradiction + outcome-ladder N/A preserved. |
| Confidence fidelity | **FULL** | High×1 / Moderate×5 / Low×1 preserved with rationales. |
| Assumption / unknown / contradiction fidelity | **FULL** | Statements, risk, status, blocks_decision, resolution, impact all preserved. |
| Narrative fidelity | **PARTIAL** | Observation prose, inference prose, the bias-firewall statement, and the plain-language findings synthesis are **not stored in the dataset**. Their *substance* is largely recoverable from evidence findings + `origin`/`confidence_rationale`, but the reader-facing prose is Markdown-only. |
| Decision-usefulness fidelity | **SUBSTANTIAL** | A reader of the reconstruction alone gets every claim, verdict, confidence, evidence link, lineage, assumption, unknown and contradiction — enough to support the same decision — but loses the original's connective narrative and explicit bias-firewall framing. |

### Fidelity verdict

**RECONSTRUCTION_VALIDATED_WITH_LIMITATIONS.**

Rationale: the entire *structured* research core — every ID, count, relationship, claim statement,
verdict, confidence, evidence link, source lineage, assumption, unknown, and contradiction —
reconstructs from `dataset.json` alone with full fidelity (and, for claim statements, greater
completeness than the original Markdown). No `ORIGINAL_JSON_MISMATCH`, no
`RECONSTRUCTION_OMISSION`, no `RECONSTRUCTION_ADDITION` was found. However, some **material research
meaning exists only in the Markdown**: the plain-language findings synthesis, the pre-research
"bias-firewall" statement, and the observation/inference prose. Because that meaning is present in the
original and only *partially* recoverable from structured fields, the reconstruction cannot be graded
fully validated — hence *with limitations*.

### Root-cause of the narrative gap (a dataset-schema finding)
The gap is not an authoring error; it is structural. The frozen schemas store observations only as
`researcher_notes` **pointers** (O1–O5), store no free-form findings/inference/bias-firewall field on
the mission, and provide no dedicated MD↔JSON traceability field (shared IDs are the join key). A
JSON→Markdown handoff therefore preserves the auditable spine perfectly but drops the human synthesis
layer. This is the single most decision-relevant input to the Phase-6 development-implications
comparison (renderer vs dual-authoring vs schema strengthening).
