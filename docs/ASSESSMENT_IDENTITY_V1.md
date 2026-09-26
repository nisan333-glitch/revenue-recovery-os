# Assessment identity — what makes a submission the same, and what makes it new

**Status: decided at the constitution level on 2026-09-26. The identity derivation is NOT yet
implemented; its first prerequisite is.** The code still derives the old identity. Step 1 below —
governance for the analysis terms — was built on 2026-09-26 and is documented in
[`ANALYSIS_TERMS_GOVERNANCE.md`](ANALYSIS_TERMS_GOVERNANCE.md). Nothing in this document describes current behaviour except where it says so
explicitly. The binding summary is in [`CLAUDE.md`](../CLAUDE.md) → *Assessment identity and
analysis-terms governance decision*.

## Why this document exists

An audit of the pilot submission identity found that it is derived over

```
sha256(… ∥ PILOT_DATA_CONTRACT_REF ∥ boundaryId ∥ datasetId ∥ sha256(csvText))
```

where `datasetId` is the free-text **Dataset label** the uploader types. Byte-identical data in the same
boundary can therefore be submitted and assessed again by renaming it. This was measured through the
real UI, not inferred.

Three things made it a constitution question rather than a bug to patch:

1. **No recorded intent.** The label's inclusion appears in one commit with no rationale, no ADR, and no
   test asserting it. Rationales *are* recorded for the other two inputs.
2. **An internal contradiction.** The pre-registration record `pilot_dataset_sightings` is keyed
   `(boundaryId, datasetFingerprint)` with no label, so two mechanisms in the same service disagreed
   about what "the same dataset" means.
3. **Tightening it naively would have broken something legitimate.** With the label removed and nothing
   added, an extract could be assessed at exactly one cut-off, ever — see `asOf` below.

## The principle

> The submission identity contains the **stable identity of the data** plus only those parameters whose
> change **materially changes the meaning or the result-space** of the assessment. Purely descriptive or
> operator-controlled metadata never determines identity.

A parameter is not "material" because it appears in the execution binding. The binding *records* what a
run used, including values derived from the data; that is not evidence that a value is an input which may
legitimately create a second assessment.

## The decision on analysis terms

`asOf` and `stallThresholdDays` decide, respectively, the analysis cut-off and what "stalled" means.
They are the definition the assessment is measured under.

**Decided:** the same extract **may** be assessed again under new analysis terms — but **only when those
terms were pre-registered and governed the way the admission bar is governed.** An operator may not pick
a new cut-off or stall definition and obtain a fresh assessment on their own authority.

Rejected alternatives, with the reason:

* **One cut-off per extract, ever** (exclude the analysis terms). Too rigid: it forbids a legitimate
  "and how does this look now?" and would push an operator to edit the export — changing the data in
  order to ask a question about time.
* **Include them as they are** (operator-supplied, ungoverned). This is the more dangerous option. It
  would grant a re-assessment right through a channel with no propose/activate, no second identity and
  no pre-registration — the same shape as the defect under review, one level up. `stallThresholdDays`
  decides what "stalled" means and today arrives in a request body, while the admission bar, which is
  less load-bearing, requires two identities and an anti-tuning check.

This follows from Trust Invariant rule 2 — *the baseline and recovery definition were established before
the outcome was known* — which the analysis terms currently escape. The decision applies an existing
rule to a parameter that had slipped outside it; it does not invent a new principle.

## Field classification

Each row states where the field comes from and whether changing it, **with the bytes and the boundary
held constant**, can change the outcome.

### In the identity

| Field | Source | Why |
|---|---|---|
| `boundaryId` | authenticated context, never a body assertion | the same bytes under another tenant are a different exposure |
| `datasetFingerprint` | `sha256(csvText)` | it *is* the data |
| `locale` (`MDY`/`DMY`) | operator-supplied | feeds `normalizeDate`; `03/04/2026` is 3 April or 4 March, so dates, stall outcomes and row parseability all change |
| `amountFormat` (`US`/`EU`) | operator-supplied | feeds `normalizeAmount`; `1.234,56` is 1234.56 or 1.23456 — the monetary values themselves change |
| `currency` | operator-supplied | a row whose currency differs from the policy's is excluded outright, so a EUR file judged as USD loses every row |
| `asOf` | operator-supplied **— only once governed** | changes which cycles are Deviations |
| `stallThresholdDays` | operator-supplied **— only once governed** | changes what "stalled" means |

`locale` and `amountFormat` are **not independent**: one column can be read as a date or an amount, so
the pair describes one interpretation and moves together. `asOf` and `stallThresholdDays` likewise form
one analysis-terms tuple — a stall definition is meaningless without the cut-off it is measured to.

### Not in the identity

| Field | Why not |
|---|---|
| `datasetId` | descriptive. It reaches no validator, no evaluator and no cohort classification. Nothing reads it for meaning |
| `mappingId` | **derived from the bytes** — the column mapping is auto-detected and no mapping can be supplied over the API, so it cannot vary while the bytes are fixed. Including it would duplicate the fingerprint |
| `provenance` | it can flip acceptance, but only from rejected to accepted — and a rejected dataset writes no row, so a corrected resubmission is already a new submission with nothing to collide with. Once accepted, changing it changes no assessment |
| admission policy id / version / state / hash | the **anti-tuning rule already forbids** the case inclusion would enable: the first sighting of the bytes is recorded before the policy is resolved and never moves, so a bar activated afterwards can never judge them. Including the bar would mint a right another rule immediately refuses. Bar content cannot drift under a fixed version either — registration is append-only per `(boundary, id, version)` |
| `declaredVersion` | declaring an unsupported version refuses the dataset and writes no row; a supported older minor is interpreted identically. Neither produces a second assessment under a different meaning |
| `recoveryCaseId` | supplied at schedule time, not at intake. Not part of the submission identity at all |

### Still open

`calculationMethodVersion` is a build constant, not operator-controlled, and is **not** in the identity
today. A method change does change the result, and the implemented contract version is *already* inside
the identity — so build-version-in-identity is existing practice. Whether a calculation-method bump
should likewise grant a re-assessment is **not decided here** and needs its own answer.

## What must exist before the identity changes

Binding order. Each step is a prerequisite for the next.

1. ~~**Governance for analysis terms.**~~ **BUILT 2026-09-26 (EP-26)** —
   [`ANALYSIS_TERMS_GOVERNANCE.md`](ANALYSIS_TERMS_GOVERNANCE.md). `asOf` and `stallThresholdDays` are now a
   registered, versioned definition: proposed by one identity, activated by another, append-only, with a
   stated reason, and **removed from the request entirely** — the transport refuses both fields. One
   correction to what this step was expected to contain: it does **not** carry the admission bar's temporal
   anti-tuning rule (`activatedAt > firstSeenAt`), because that would forbid the re-reading the decision
   above explicitly permits. The guarantee is structural instead — a new definition yields a new execution
   identity and cannot re-grade an existing finding. The reasoning is in that document.
2. **A decision on the two-major compatibility window.** §10 of the data contract promises that two
   majors are supported concurrently for at least one pilot cycle. That promise has **no
   implementation**: the version check rejects any different major outright. Honouring it is larger work
   than the derivation change; amending it is a published-promise change. Either way it is decided
   *before*, not after.
3. **The derivation change itself**, as a major contract version, with the migration questions below
   answered explicitly.

## Migration questions to answer in step 3

* Historical keys are never rewritten — the table is append-only. Under any new derivation, an
  already-submitted dataset derives a **new** key and is no longer recognised as a duplicate of its own
  past submission: **one re-assessment per historical dataset at the cutover.**
* **This is not a new behaviour.** The implemented contract reference is already inside the identity, so
  the previous minor bump already had exactly this effect. Whether that was intended, or is a second
  unexamined consequence of version-in-identity, is itself unanswered.
* A dual-key lookup would be required only to *prevent* the free re-assessment. Whether to prevent it is
  a product decision, and the precedent above suggests the answer may be "no".
* No backfill is required for correctness; one would be required only for the dual-key behaviour.

## Tests required before the change lands

Same bytes + different label ⇒ duplicate · same bytes + different `locale` / `amountFormat` / `currency`
⇒ accepted, **and the report demonstrably differs**, not merely the key · same bytes + different governed
analysis terms ⇒ accepted; same bytes + **ungoverned** new terms ⇒ refused · a `(locale, amountFormat)`
pair test showing they are not independent · different boundary ⇒ accepted · different bytes ⇒ accepted ·
a provenance-corrected resubmission ⇒ accepted · migration: whether a pre-cutover row is recognised
afterwards, asserted either way · the existing idempotency unit test rewritten, since it asserts the
properties of the old identity · the browser discriminator inverted, so the journey proves the new rule.

## What is settled and unaffected

Concurrent submissions resolving to the same *current* identity already yield exactly one row, one
winner, and the contract's duplicate code for the loser. That is independent of this decision and
survives any formulation of it.
