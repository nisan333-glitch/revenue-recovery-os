# Mission #008 — Reconstruction Charter (clean-room handoff validation)

> **Objective:** determine whether a reviewer can reconstruct a complete, faithful, human-readable NH
> research mission from the **machine-readable dataset alone**. Tests handoff, reproducibility, traceability,
> representational fidelity. **No new research; Mission #007's conclusions are not changed.**
> **Baseline commit:** `2dc53e38ab8262c26536e0b268dd2bc42da71ed9`.

## Canonical source (only input for Phases 1–3)
`research/exports/mission-007/dataset.json` + the frozen schemas (`research/schemas/`) + the Stage A
validator + NH-ROP controlled vocabulary (for interpretation only).

## Clean-room rule (Phases 1–3)
The Mission #007 Markdown artifacts (`MISSION_CHARTER.md`, `RESEARCH_RECORD.md`, `VALIDATOR_RUN_REPORT.md`,
`MISSION_007_COMPLETION_REPORT.md`) are **not read, inspected, searched, diffed, or quoted** until Phase 4.
No new claims/evidence/sources/assumptions/unknowns/contradictions/verdicts/confidence/conclusions are
introduced. Missing narrative is **not** inferred; it is marked `NOT_RECONSTRUCTABLE`.

## Independence limitation (stated honestly)
The same agent authored Mission #007. Therefore the "clean room" is **procedural** — the reconstruction is
built strictly from `dataset.json` fields, not from recollection — but this is **not** a truly independent
third-party reviewer. This limits how far the result certifies handoff to an *unfamiliar* reviewer, exactly
as prior missions' author-independence caveats note. (One mitigating fact: the dataset's own
`evidence.researcher_notes` fields carry structural pointers like "O1…O5", so the observation structure is
recoverable from the JSON itself, not from memory.)

## Outputs (additive, under `research/exports/mission-008/` only)
`RECONSTRUCTION_CHARTER.md` (this) · `RECONSTRUCTION_MAPPING_REGISTER.md` (Phase 1) ·
`RECONSTRUCTED_MISSION_CHARTER.md` + `RECONSTRUCTED_RESEARCH_RECORD.md` (Phase 2, blind) ·
`RECONSTRUCTION_COMPARISON_REPORT.md` (Phase 4–5) · `MISSION_008_COMPLETION_REPORT.md` (Phase 6).
**Nothing under `research/missions/mission-007/` is created or modified; the M007 dataset is not modified.**
