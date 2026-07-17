# NH Research — index & governance

This directory holds NH's independent research and the standard that governs it.

## Start here
- **[`NH_RESEARCH_OPERATING_PROTOCOL.md`](NH_RESEARCH_OPERATING_PROTOCOL.md)** — **NH-ROP**, the mandatory
  operating standard for all future NH research missions. Read this first. The fundamental unit of research
  is the **Claim**, not a document, company, product, or search result.
- **[`RESEARCH_REGISTER.md`](RESEARCH_REGISTER.md)** — one-row-per-mission operational index.

## What lives where (single source of truth)

| You want… | Go to |
|---|---|
| The rules (how to research) | `NH_RESEARCH_OPERATING_PROTOCOL.md` |
| Blank artifact templates | `templates/` |
| Machine-readable object contracts | `schemas/*.schema.json` |
| A specific mission's evidence | `missions/mission-0XX/` (or a mission's canonical report) |
| Mission #001 (frozen v1.1) | `MISSION_001_GLOBAL_CAPABILITY_LANDSCAPE.md` |
| Mission index / status | `RESEARCH_REGISTER.md` |

## Canonical artifacts per mission (NH-ROP §15)
Mission Charter · Claim Registry · Evidence Registry · Source Registry · Assumption Registry · Unknown
Registry · Contradiction Registry · Research Verdict · Research Revision Log · Completion Record.
Templates for each are in `templates/`. Proportionality applies (§18): an L1 mission may collapse the
minor registries into the Verdict and say so; an L3/L4 mission produces the full set.

## Object model (NH-ROP §4)
`Mission → Question → Hypothesis → Claim → Evidence → Source (grouped by Lineage)`, with `Assumption`,
`Unknown`, `Contradiction`, and `Verdict` as first-class objects. Each has a stable, mission-scoped,
human-readable ID (`M001-C1`, `M001-C1-E3`, `S014`, `L01`, …) and a version history.

## Schemas (NH-ROP §16)
`schemas/` holds JSON Schema (draft 2020-12) contracts for the eight core objects. They are the contract
that the Markdown registries are filled against, and support future machine validation.

**Validation is intentionally not wired at runtime yet** — no consumer requires it and it would add an
`ajv` dependency, which conflicts with the repo's "no infra before a consumer" rule
(`playbooks/ENGINEERING_REGISTER.md` → `DEF-RECWIRE`). To wire it when a mission maintains JSON views: add
`ajv` (dev), add a `research:validate` script that asserts each registry's JSON against its schema, and
gate it in CI.

## Non-negotiables (NH-ROP §1, condensed)
Reality over ideas · persuasion ≠ evidence · repetition ≠ independent confirmation · vendor claim ≠ proof ·
absence of evidence ≠ proof of absence · Unknown stays Unknown until evidence changes it · every conclusion
links to supporting **and** contradicting evidence · confidence reflects evidence strength, not writing
confidence · revise without erasing · quality over source count.

## Relationship to the Product Constitution
NH-ROP is **not** part of the Product Constitution (`CLAUDE.md`) and never modifies product code. Where
research touches product-truth concepts (revenue-proof claims, the two ledgers, the Trust Invariant), it
**inherits** them (NH-ROP §3, §12) — it does not restate or weaken them.

## Governance
Missions close under objective completion conditions (§14), freeze as read-only canonical baselines, and
change only by supersession (new version + Revision Log; prior version preserved in git). **No commit or
push of research changes without the founder's explicit approval.**
