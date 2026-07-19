# Mission Charter — M009 · Deterministic JSON→Markdown Renderer

> Engineering mission (not a research mission). Builds and validates a deterministic renderer so the
> human-readable proof is a reproducible, drift-free derivation of the canonical `dataset.json`.

| Field | Value |
|---|---|
| Mission ID | `M009` |
| Title | Deterministic JSON→Markdown Renderer (build + validation + closure) |
| Type | Engineering / tooling (serves **Prove**: reproducible, auditable explainability) |
| Owner / Reviewer | Founder (author-reviewer) |
| Status / completion | Closed / Conditions-met |

## Mission objective
Build a deterministic, zero-dependency renderer that turns a validated `dataset.json` into the
human-readable **Mission Charter** and **Research Record** Markdown, rendering only schema-supported
content with a uniform `NOT_POPULATED` marker, and validate that it reproduces the structured content
of real prior missions faithfully and byte-stably.

## Decision being supported
Whether NH can treat `dataset.json` as the **canonical structured source of truth** and generate the
Markdown as a **deterministic derived view** — i.e. whether manual dual-authoring of the structured
layer can stop.

## Scope
- A new additive module `research/renderer/` (CLI + pure render functions + `node:test` + fixtures).
- Rendering the two human artifacts (Charter, Research Record §A–§I) from the frozen schemas.
- Fidelity validation against committed datasets #005/#006/#007 and a synthetic golden fixture.

## Explicit exclusions
- No schema change; no `findings`/observation/inference field added.
- No modification to NH-ROP, `research/schemas/`, `research/templates/`, `research/validator/`,
  Missions #001–#008, `research/RESEARCH_REGISTER.md`, `package.json`, `CLAUDE.md`, `docs/`, `src/`,
  `.claude/`.
- No product/UI code; no Tier 1; no Mission #010; no PR.
- The renderer does not synthesize narrative absent from the dataset — absent ⇒ marked, not invented.

## Dependencies (used read-only)
- **Frozen schemas** (`research/schemas/`): the field contract the renderer targets.
- **Stage A validator** (`research/validator/`): renderer renders only Stage-A-valid inputs; reuses its
  `load.mjs` (`loadDataset`, `normalise`, `loadSchemas`) read-only.
- **Mission #008 Files 2–3** (frozen `71ce373`): the blind-reconstruction fidelity oracle.
- **Datasets #005/#006/#007**: read-only fidelity corpus.

## Success criteria
1. Deterministic, byte-identical output for a given input.
2. Structured-spine fidelity vs committed records (IDs, counts, relationships, verdicts, confidence,
   evidence links, lineage) with no invented content.
3. Uniform `NOT_POPULATED` for every absent/empty field.
4. Zero runtime dependencies; `node:test`; `npm run test` + `npm run build` clean; Stage A unchanged.
5. A synthetic golden fixture locks output as a byte-stable regression oracle.

## Risks (and mitigations)
- **Build-Filter drift** (tooling, not product) → justified strictly as Prove-reproducibility; kept tiny.
- **Second source of truth** → renderer output becomes the only sanctioned human artifact; Markdown
  becomes a diff target, not a parallel author.
- **Non-determinism** → pure functions, schema-ordered fields, no clock/random; byte-identical tests.
- **Protected-path drift** → additive-only; pre-flight `git status` gate each increment.

## Validation plan
`node:test` (unit + golden), full `vitest`, `npm run build`, Stage A on the fixture and #005/#006/#007,
byte-determinism, and cross-mission fidelity classification (Increment 3). Every increment gated and
committed separately.

## Frozen increment commits
| Increment | Commit | Content |
|---|---|---|
| 1 | `932fe9cbc00cd4ed8e7fc8465d1d69f2cc813ceb` | §C–§I deterministic renderer + tests |
| 2 | `97d0c0bccfad12aa78bb8737a57a7376b1c9b19c` | Charter + Research Record §A–§B renderer |
| 3 | `47c77bce43050c1da5f87038878197e758ba5aba` | Cross-mission fidelity validation (#005/#006/#007) |
| 4 | `d71dd8553d2d525597ccb13df2d670302ff1b3e8` | Synthetic golden fixture + regression oracle |
| 5 | (this proof pack) | Mission #009 records + completion report |

## Protected-path boundaries
Additive only under `research/renderer/`, `research/missions/mission-009/`,
`research/exports/mission-009/`. Everything listed under **Explicit exclusions** is untouched.

## What this mission does not prove
- It does **not** validate NH-ROP as a whole, Tier 1, or the integrated product system.
- It does **not** reproduce the **narrative layer** (plain-language findings, bias-firewall,
  observation/inference prose) — that is a separate constitution-level schema decision.
- Renderer **structurally validated** ≠ any research claim **semantically true**.
