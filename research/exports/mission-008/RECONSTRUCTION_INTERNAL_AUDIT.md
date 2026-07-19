# Mission #008 — Reconstruction Internal Audit (Phase 3)

> **This audit records the reconstruction's internal consistency against `dataset.json` and the
> repository state. Checks 1–6 and 9 are dataset-vs-reconstruction only; checks 7–8 are read-only
> repository observations. The comparison against the original Mission #007 Markdown is Phase 4 —
> it is NOT part of this audit and had not been performed at the time these checks were recorded for
> Files 1–2 (the blind artifacts).**
>
> **Authorship disclosure (carried from File 3):** Files 1 (`RECONSTRUCTION_MAPPING_REGISTER.md`) and
> 2 (`RECONSTRUCTED_MISSION_CHARTER.md`) were authored **blind** by cold subagents that never read
> the Mission #007 Markdown. Files 3 (`RECONSTRUCTED_RESEARCH_RECORD.md`) and 4 (this file) were
> authored by the **coordinator session**, which had prior exposure to the Mission #007 Markdown,
> after the cold subagents repeatedly declined to write further under a spurious plan-mode reminder.
> Files 3–4 are near-deterministic transcriptions of `dataset.json` under the blind Phase-1 mapping.
> This is a real limitation on the "blind authorship" property for Files 3–4 and is repeated in the
> completion report.

## Check 1 — Object counts derived from dataset.json

| Object | Reconstruction count | dataset.json count | Match |
|---|---|---|---|
| mission | 1 | 1 | ✅ |
| claims | 7 | 7 | ✅ |
| evidence | 8 | 8 | ✅ |
| sources | 5 | 5 | ✅ |
| assumptions | 1 | 1 | ✅ |
| unknowns | 1 | 1 | ✅ |
| contradictions | 1 | 1 | ✅ |
| verdicts | 7 | 7 | ✅ |

Expected profile 1/7/8/5/1/1/1/7 — **matched exactly.**

## Check 2 — Every referenced ID resolves to a JSON object
All IDs used in the reconstruction (`M007`; claims `M007-C1..C7`; evidence `M007-C1-E1, C1-E2, C2-E1,
C3-E1, C4-E1, C4-E2, C5-E1, C6-E1`; sources `S001..S005`; `M007-A1`; `M007-U1`; `M007-X1`; and one
verdict per claim) resolve to an object present in `dataset.json`. **PASS** — no dangling reference.

## Check 3 — No invented content
Every claim statement, verdict, confidence, evidence finding, source field, assumption, unknown, and
contradiction in the reconstruction is copied from `dataset.json`. No claim/evidence/source/number/
narrative was added. Human narrative the dataset lacks (observation prose, inference prose, charter
extras, per-dimension quality scores, verdict optional arrays) is marked `NOT_RECONSTRUCTABLE`, not
invented. **PASS.**

## Check 4 — Verdict + confidence per claim match the dataset

| Claim | Verdict | Confidence | Matches dataset |
|---|---|---|---|
| M007-C1 | Supported | High | ✅ |
| M007-C2 | Supported | Moderate | ✅ |
| M007-C3 | Supported | Moderate | ✅ |
| M007-C4 | Partially Supported | Moderate | ✅ |
| M007-C5 | Supported | Moderate | ✅ |
| M007-C6 | Supported | Moderate | ✅ |
| M007-C7 | Inconclusive | Low | ✅ |

Distribution: Supported ×5 · Partially Supported ×1 · Inconclusive ×1. Confidence: High ×1 · Moderate
×5 · Low ×1. **PASS.**

## Check 5 — Evidence→claim links and source lineages match
- Evidence→claim: E1/E2→C1, C2-E1→C2, C3-E1→C3, C4-E1/C4-E2→C4, C5-E1→C5, C6-E1→C6; C7 has no
  evidence (empty `supporting_evidence`). ✅
- Evidence→source: E1→S001, C1-E2→S003, C2-E1→S001, C3-E1→S002, C4-E1→S001, C4-E2→S004, C5-E1→S005,
  C6-E1→S004. ✅
- Lineages: S001+S002 = L01; S003 = L02; S004 = L03; S005 = L04. C1 draws on L01 **and** L02
  (cross-lineage). ✅
- Directions/verification preserved: `M007-C4-E2` = Limits; `M007-C5-E1` = Vendor-Claim. ✅

**PASS.**

## Check 6 — Assumptions / unknowns / contradictions carried exactly
- `M007-A1` — statement, risk Moderate, status Open, affects C4+C7. ✅
- `M007-U1` — question, `blocks_decision:false`, status Isolated, affects C4+C7. ✅
- `M007-X1` — in_conflict [C4, C6], nature, resolution Scope-qualified, impact "keeps C4 Partially
  Supported and supports C6", possible_explanations + scope/definition/methodological differences +
  required follow-up all carried. ✅

**PASS.**

## Check 7 — Stage A still validates the dataset (read-only)
Command: `node research/validator/cli.mjs research/exports/mission-007/dataset.json --json`
- **Exit code: 0**
- **errors: 0 · warnings: 0 · events_total: 0 · blocking: false**
- Validator counts: mission 1 / claims 7 / evidence 8 / sources 5 / assumptions 1 / unknowns 1 /
  contradictions 1 / verdicts 7 — identical to the reconstruction's derived counts.
The dataset was **not modified** (read-only run). **PASS.**

## Check 8 — Only mission-008 modified; no protected path touched
`git status --short` → `?? research/exports/mission-008/` (untracked) and nothing else. No change to
`dataset.json`, `research/missions/mission-007/`, other `research/exports/*`, NH-ROP,
`research/schemas/`, `research/templates/`, `research/validator/`, Missions #001–#006,
`RESEARCH_REGISTER.md`, `package.json`, `CLAUDE.md`, `docs/`, `src/`, `.claude/`. **PASS.**

## Check 9 — NOT_RECONSTRUCTABLE and AMBIGUOUS items encountered

**NOT_RECONSTRUCTABLE (dataset does not carry the element):**
- Charter: `cost_if_wrong`, `time_sensitivity`, `definitions`, `stakeholders`,
  `pre_research_position` (bias firewall), `revision_history`, `anchors`.
- Claims: `version_history`.
- Observations: the prose behind pointers O1–O5 (only the pointers exist, in `researcher_notes`).
- Inferences: free-form reasoning prose (only structured `origin` / `confidence_rationale` /
  contradiction fields exist).
- Evidence: `quality_dimensions` (no per-dimension 0–5 scores).
- Verdicts: `remaining_unknowns`, `assumptions` optional arrays.

**AMBIGUOUS (dataset carries it but human meaning is under-determined):**
- `S004` — aggregate identity ("assorted learning-science reviews" / publisher "assorted" / a
  description instead of a URL / a single `publication_date` "2013" for a collection).
- `M007-C2-E1` — internal number discrepancy in `limitations`: "some summaries cite 317 experiments /
  184 articles" vs the claim's "about 254 studies". Carried verbatim, not resolved.

## Audit result
All 9 checks **PASS**. The reconstruction is internally consistent with `dataset.json`; the dataset
still validates under Stage A (exit 0); and only `research/exports/mission-008/` was touched. The
open items are the `NOT_RECONSTRUCTABLE` gaps and two `AMBIGUOUS` presentations above — these are
handoff-fidelity findings for the Phase 4–5 comparison, not internal inconsistencies.
