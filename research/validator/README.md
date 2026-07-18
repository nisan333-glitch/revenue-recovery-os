# NH Research Validator — Stage A (deterministic layer)

> **What this is:** a **deterministic**, zero-dependency, read-only layer that checks a mission's
> machine-readable research registries against the NH-ROP v1.0 schemas and the deterministically-enforceable
> subset of NH-ROP rules.
> **What this is NOT:** it is **not** the integrated NH multi-agent validation system, and must never be
> represented as such. It runs **no LLM**, **no agents**, and provides **no independent adversarial
> judgment**. Tier 1 (independent-model agents) and Tier 2 (human review) are separate and, where NH-ROP
> requires them, mandatory.

## Binding boundaries
- Deterministic code only — no model, no simulation.
- **Never writes** to research records (no silent auto-correction); it only reports.
- Does **not** replace the human gate: **L3 requires a Critical Reviewer distinct from the author; L4
  requires primary-source access + independent review + the applicable integrated-system validation gate.**
- Passing Stage A means the registries are **structurally and rule-consistent**, **not** that a verdict is
  *true*. A well-formed but wrong verdict can still pass.

## Run it
```
node research/validator/cli.mjs <dataset.json> [--json]     # validate a dataset
node --test research/validator/test/validator.test.mjs      # run the test suite
```
Exit codes: **0** = clean or advisory-warnings only · **1** = ≥1 blocking ERROR · **2** = load/parse failure
or unsupported schema keyword (fail-closed).

## Input contract
`dataset.json` — an envelope (see `dataset.schema.json`) grouping arrays of **existing** NH-ROP objects; each
element validates against its `research/schemas/*.schema.json`. Lineage uses existing `independence_group`
fields. **No parallel data model is invented.**

## Schema validation scope (not full Draft 2020-12)
The bundled subset validator supports exactly the keywords used by the 8 NH-ROP schemas:
`type, required, properties, additionalProperties, enum, pattern, format("date"), items, minItems, minLength,
minimum, maximum, allOf, if, then`. Any other validation-affecting keyword (`$ref, oneOf, anyOf, not, const,
propertyNames, $defs, …`) or a non-`date` format is **unsupported** and triggers a **blocking**
`SCHEMA_VALIDATOR_UNSUPPORTED_KEYWORD` — it is never silently ignored. This is **not** a general JSON-Schema
validator; it is complete **for these eight schemas** (verified by test).

## Rule enforceability (grounded in NH-ROP v1.0)
- **ENFORCEABLE (blocking, exit 1):** R-SCHEMA, R-SCHEMA-UNSUPPORTED-KEYWORD, R-ID-UNIQUE, R-XREF,
  R-UNSUPPORTED-REF, R-CONFIRMED-NEEDS-EVIDENCE, R-VERDICT-CEILING (when `strength_category` present),
  R-CONTRADICTION-MATERIAL (`Material-remains` only), R-ASSUMPTION-FATAL, R-UNKNOWN-BLOCKING.
- **ADVISORY (REVIEW_REQUIRED, exit 0):** R-LINEAGE-FALSE-INDEP, R-VERDICT-STRENGTH-UNKNOWN,
  R-CONTRADICTION-OPEN, R-CONFIDENCE-CONSISTENCY, R-REVENUE-PROVEN-REVIEW, R-ORPHAN-SOURCE. Where NH-ROP
  defines no deterministic threshold, Stage A emits a review warning rather than inventing one.
- **NOT ENFORCEABLE UNDER v1.0 (field absent — not implemented, not invented):** revenue components
  (baseline / attribution / collection / duplicate-exclusion / reversal — no `revenue_ladder` field exists),
  freshness-threshold / obsolete-risk auto-flag (no field/policy), deterministic "Proven"-proof (§12's three
  conditions are not v1.0 fields → any `Proven` classification is flagged REVIEW_REQUIRED), confidence-
  rationale *quality* (presence only, enforced via schema). These are documented data-readiness gaps.

## Thresholds are NH-ROP's, not invented
- Confirmed requires ≥1 supporting evidence of strength `Strong`/`Very strong` (NH-ROP §10/§7) — **not** an
  invented "≥2 lineages" rule.
- Only `Material-remains` contradictions block a Confirmed verdict; `Open`/`Methodologically-unresolved` →
  advisory (materiality is not a v1.0 boolean).

## Operational limitation (prominent)
No JSON registry instances exist in the repo yet — every real mission is Markdown. Therefore Stage A is
**implemented and tested against fixtures**, but is **not operationally validated against existing NH
missions**, and **does not prove that Mission #001, #002, or #003 passes deterministic validation.** Running
it on real missions requires future missions to emit schema-conformant JSON registry views (or a separately-
approved Markdown→JSON extractor — not built here).
