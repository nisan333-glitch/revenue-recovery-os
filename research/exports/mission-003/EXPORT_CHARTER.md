# Mission #004 — Stage A Data-Readiness Pilot · Export Charter (Mission #003)

> **Purpose:** operationally test whether Mission #003's committed research record can be exported to a
> native, schema-conformant JSON view and validated by the committed Stage A deterministic validator —
> **without inventing, completing, or reinterpreting any research data.**
> **Date:** 2026-07-17 · **Owner:** Founder · **Target:** `research/missions/mission-003/` (read-only source).

## Source-of-truth rule (binding)
- The committed Mission #003 Markdown artifacts are the **authoritative historical record**. This export
  layer is a machine-readable *view* of them, never a replacement.
- **No Mission #003 file is modified.** No inference, invention, completion, or improvement of missing data.
  Unknown/unavailable information stays unknown or is recorded as a data-readiness gap.
- Every exported value must trace to a specific committed source record; every generated ID must map back.

## Scope
- **In scope:** read Mission #003 + the 8 frozen schemas + `research/validator/dataset.schema.json` + the
  Stage A validator; build a field-mapping register; record data-readiness gaps; determine exportability;
  if exportable without invention, produce `dataset.json` and run Stage A; report.
- **Out of scope (boundaries):** modifying NH-ROP, `research/schemas/`, `research/templates/`,
  Missions #001–#003, `research/validator/`, `RESEARCH_REGISTER.md`, `package.json`, `CLAUDE.md`, `docs/`,
  `src/`, `.claude/`. No Tier 1. No agent simulation. No PR, commit, or push.

## Output location (additive only)
`research/exports/mission-003/` — **separate** from the mission record. Never inside
`research/missions/mission-003/`.

## Outcome of this pilot (see the registers + completion report)
**DATASET_NOT_EXPORTABLE** for a claims-preserving dataset: Mission #003's committed artifacts do not contain,
in explicit machine-extractable form, several **per-claim fields the frozen `claim` schema requires**
(`materiality`; and at L3 `reviewer` / `confidence_rationale` / `last_reviewed`), and several claims carry
verdict / confidence / claim_type / ID values outside the frozen enums/patterns. Producing `dataset.json`
with those fields would require **invention**, which the source-of-truth rule forbids. Therefore, per the
implementation gate, **`dataset.json` was not created.** Evidence is in `FIELD_MAPPING_REGISTER.md` and
`DATA_READINESS_GAP_REGISTER.md`; the determination and its explicit scope limits are in
`MISSION_004_COMPLETION_REPORT.md`.

## Language discipline (carried into every artifact)
These are kept strictly distinct and never collapsed:
Stage A **implemented** · Stage A **tested on fixtures** · Stage A **run on a real exported mission** (—
**not** achieved in this pilot) · Mission #003 **structurally validated** (— not achieved) · Mission #003
**semantically correct** (out of scope) · NH-ROP **validated** (separate, prior) · integrated NH system
**validated** (— not; NOT EXECUTED).
