# Mission #009 — Research & Engineering Record (human-readable)

> Records the build and validation of the deterministic JSON→Markdown renderer across five increments.
> Layers are kept explicitly separate. No claim or evidence beyond what the committed increments
> established is introduced here.

## Initial problem
NH authors each research mission in two forms — the machine-readable `dataset.json` and a
human-readable Markdown record. Two hand-authored forms can silently **drift**: a number, verdict, or
link can differ between them, which is fatal for a Trust-first system whose north star is "every
recovered dollar must be explainable." The problem: make the human record a provable function of the
one canonical source, with no drift.

## Mission #008 finding that triggered renderer development
Mission #008 (frozen `71ce373`) validated the JSON→Markdown handoff and returned
**RECONSTRUCTION_VALIDATED_WITH_LIMITATIONS**: the structured spine reconstructs from `dataset.json`
with full fidelity, but the human narrative layer was only partial. Its highest-leverage, lowest-risk
recommendation (alternative A) was a **deterministic renderer** — the object of Mission #009.

## A · Observations (what the increments established)
- **O1 — Increment 1 (`932fe9c`):** a zero-dependency renderer emits the Research Record §C–§I tables
  (claims, evidence, sources, assumptions, unknowns, contradictions, verdicts) with columns in schema
  property order and a uniform `NOT_POPULATED` marker; output is byte-identical across runs. 8 tests.
- **O2 — Increment 2 (`97d0c0b`):** added the Mission Charter renderer and Research Record §A
  (observation O#-pointers from `researcher_notes`) and §B (claim `origin`/`confidence_rationale` +
  contradiction reasoning); §A/§B precede the unchanged §C–§I. 15 tests total.
- **O3 — Increment 3 (`47c77bc`):** rendered #005/#006/#007 read-only and compared to the committed
  Markdown. All three: rendered (exit 0), deterministic (byte-identical), full structural fidelity;
  **0 renderer defects, 0 unexpected differences**. Global classification: PERFECT_MATCH ×3,
  NARRATIVE_ONLY ×3, AUTHOR_ONLY_INFORMATION ×2, SCHEMA_LIMITATION ×7. Canonical JSON report +
  derived Markdown report.
- **O4 — Increment 4 (`d71dd85`):** a fully-synthetic, schema-valid fixture (M900, counts
  1/3/4/3/1/1/1/3) exercises the whole surface with controlled `NOT_POPULATED`; its render is frozen
  as a byte-stable regression oracle. 21 tests total (15 + 6). Stage A on the fixture 0/0/0; no
  regression on #005/#006/#007.

## B · Inferences (reasoning from the observations)
- From O1+O2: the renderer covers the entire **currently supported structured surface** deterministically.
- From O3: because 0 renderer defects were found and every ID/count/relationship/verdict reproduced,
  the renderer faithfully reproduces the structured content of real missions — the differences are
  narrative/author/schema, not renderer faults.
- From O4: a frozen golden oracle turns "deterministic today" into a **regression guarantee** — future
  renderer changes that alter output will fail a test.
- Therefore the structured layer of the human record can be **generated**, not hand-authored, without
  drift.

## C · Decisions
- **D1:** `dataset.json` is treated as the **canonical structured source of truth**.
- **D2:** the Markdown structured layer is a **deterministic derived view** (renderer output).
- **D3:** manual **dual-authoring may stop for the currently supported structured surface**.
- **D4:** the **narrative layer stays out of scope** — no schema change this mission; deferred decision.
- **D5:** verdict **READY_FOR_FULL_MARKDOWN_RENDERING** (permitted: no renderer defect exists).

## D · Evidence produced (committed, reproducible)
- `research/renderer/{render.mjs, cli.mjs}` + `test/renderer.test.mjs` (Increments 1–2).
- `research/exports/mission-009/RENDERER_FIDELITY_REPORT.{json,md}` +
  `MISSION_009_INCREMENT_3_COMPLETION_REPORT.md` (Increment 3).
- `research/renderer/fixtures/{golden-dataset.json, golden-output.md}` +
  `research/renderer/test/golden.test.mjs` (Increment 4).

## Tests and validation gates (current, at closure)
- **node:test 21/21** (renderer 15 + golden 6) · **vitest 226/226** · **build clean**.
- **Stage A:** synthetic fixture 0/0/0; Missions #005/#006/#007 each exit 0 / 0 errors / 0 warnings.
- **Golden byte-match:** render == `golden-output.md`.
- **Renderer code** identical to Increment 2 (`97d0c0b`); Increment 3 & 4 artifacts unchanged.

## E · Assumptions
- **A1:** a newly spawned subagent executes without the parent's conversational context — used in
  Mission #008's clean room; **not independently verified** (procedural assumption only). Not re-tested
  here; noted for lineage.
- **A2:** the frozen schemas are the correct field contract for the human record (inherited, not
  re-litigated in #009).

## F · Unknowns
- **U1:** how a future `findings`/observation/inference schema field should be shaped so a renderer can
  carry the narrative layer — open; deferred to a separate constitution decision.

## G · Limitations
- **Narrative-layer caveat:** the renderer reproduces the **structured** content only. Plain-language
  findings, the pre-research bias-firewall, and observation/inference prose are **not** in the schema
  (SCHEMA_LIMITATION) or were left empty by the author (AUTHOR_ONLY_INFORMATION); a fully
  human-complete document still needs them, authored manually until the schema decision is made.
- **Scope of proof:** renderer **structurally validated** ≠ any research claim **semantically true**;
  and this mission does not validate NH-ROP, Tier 1, or the integrated product system.
- **Independence:** per A1, the Mission #008 oracle rests on a procedural (unverified) isolation
  assumption.

## Schema decision deferred
Whether to add schema fields for the narrative layer (findings synthesis / observation / inference) so
a future renderer can carry it — **not** done in #009; recorded as U1 for a separate decision.

## Final decision implications
The structured JSON→Markdown pipeline is proven drift-free and reproducible, so NH can adopt
single-source structured authoring now. Closing the narrative gap (schema work) and any product-track
work remain future, separately-governed decisions.
