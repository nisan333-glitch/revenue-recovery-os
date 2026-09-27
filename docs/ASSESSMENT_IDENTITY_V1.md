# Assessment identity — what makes a submission the same, and what makes it new

**Status: DECIDED and IMPLEMENTED. The derivation changed on 2026-09-27 (EP-28) as contract 2.0.0.**
All three prerequisites in the binding order are complete: step 1 — governance for the analysis terms —
[`ANALYSIS_TERMS_GOVERNANCE.md`](ANALYSIS_TERMS_GOVERNANCE.md); step 2 — §10's two-major window —
[`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md); step 3 — this derivation, below. Nothing in this document describes current behaviour except where it says so
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
| `currency` | **governed since EP-26b** — registered, not supplied | a row whose currency differs from the policy's is excluded outright, so a EUR file judged as USD loses every row. That it changes *which rows count* is why it joined the governed AssessmentPolicy rather than staying a request field |
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

1. ~~**Governance for analysis terms.**~~ **BUILT 2026-09-26 (EP-26, EP-26b)** —
   [`ANALYSIS_TERMS_GOVERNANCE.md`](ANALYSIS_TERMS_GOVERNANCE.md). `asOf`, `stallThresholdDays` **and
   `currency`** are now one registered, versioned AssessmentPolicy: proposed by one identity, activated by another, append-only, with a
   stated reason, and **removed from the request entirely** — the transport refuses both fields. One
   correction to what this step was expected to contain: it does **not** carry the admission bar's temporal
   anti-tuning rule (`activatedAt > firstSeenAt`), because that would forbid the re-reading the decision
   above explicitly permits. The guarantee is structural instead — a new definition yields a new execution
   identity and cannot re-grade an existing finding. The reasoning is in that document.
2. ~~**A decision on the two-major compatibility window.**~~ **DECIDED AND BUILT 2026-09-26 (EP-27)** —
   [`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md). Verdict: **honour the promise at the level it
   was made.** The 2.0.0 this repository is about to cut changes no field, no field meaning and no
   row-level rule — it changes the identity derivation and the request envelope — so a 1.x export validates
   identically under it. The window is therefore a checked per-major **declaration** that the older major's
   row semantics are unchanged, the declared version is now **persisted** so the claim is auditable, and the
   schedule-time check became compatibility-aware (it was exact string equality, which refused execution of
   every admitted dataset after a *patch* bump). Amending §10 was rejected: nothing forced it. A general
   two-major validator was rejected: there is no semantic difference to select between, so it would mean
   maintaining two paths that can silently drift.

   That document also answers, from evidence, two questions this one left open — see its §5 and §6, and the
   corrections below.
3. ~~**The derivation change itself**~~ **DONE 2026-09-27 (EP-28), as contract 2.0.0.** The implemented
   form, scheme `nh-pilot-dataset-v2`:

   ```
   pds_sha256(
     "nh-pilot-dataset-v2" ∥ "<contract id>@major-<N>" ∥ boundaryId ∥ datasetFingerprint
       ∥ dateLocale ∥ amountFormat ∥ currency ∥ asOf ∥ stallThresholdDays
   )
   ```

   `datasetId` is gone — the defect. The three governed fields come from the register, never the request
   (EP-26b). `mappingId`, `provenance`, the admission policy and `declaredVersion` stay out for the reasons
   already given above. **`calculationMethodVersion` remains explicitly OPEN and is still not in the
   identity** — this slice preserved its current state rather than deciding it.

   **Granularity finding, reviewable on its own.** The version component is the **major**, not the full
   version. v1 embedded `id@1.1.0`, so a *patch* bump reset every identity — which contradicts §10's own
   minor promise (*"a dataset valid under X.Y is still valid under X.(Y+1)"*), and §6 of
   [`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md) established with positive evidence that the
   granularity was never intentional. A major may redefine what a field means, so majors must not share an
   identity space; a patch may not, so patches must.

   **Workflow consequence, discovered by running the suites and documented rather than worked around.**
   Because the governed policy is inside the *submission* identity, an extract re-read under new terms must
   be **re-submitted** before it can be scheduled — the admission decision is looked up by the same key.
   That is a **strengthening**: an admission verdict computed under one definition no longer authorises an
   execution under another, which was the same defect as *"a decision made under one contract cannot
   authorise execution under another"*, one level down. It is also exactly what the required test below
   describes (*different governed terms ⇒ accepted*, at submission).

   **The derivation is now pinned by a golden vector** (`pilotDataContract.test.ts` **9c**). This was added
   because negative controls NC-47 and NC-48 — the full version in place of the major, and the scheme string
   left at v1 — initially **failed to fail**: every other assertion compared one derived key with another
   derived the same way, so a change that moved all of them together was invisible. A derivation with no
   absolute anchor is not pinned at all.

## Migration questions — ANSWERED (EP-28)

No migration SQL exists and none is needed: no column changed, and historical rows keep the keys they were
written with. The answers below are the ones step 3 was required to give.

* Historical keys are never rewritten — the table is append-only. Under any new derivation, an
  already-submitted dataset derives a **new** key and is no longer recognised as a duplicate of its own
  past submission: **one re-assessment per historical dataset at the cutover.** **CONFIRMED BY TEST
  (EP-28)** — `identityDerivation.test.ts` **9** writes a row under the v1 key, submits the identical bytes
  under the identical label, and asserts it is *accepted*; the historical row survives untouched with its
  own `contractVersion`/`declaredVersion`; and the free re-assessment is **exactly one**, because the second
  attempt under v2 is refused `NH-DC-4003` like any other repeat. Asserted either way, as required, rather
  than left to be discovered in production.
* **This is not a new behaviour.** The implemented contract reference is already inside the identity, so
  the previous minor bump already had exactly this effect. Whether that was intended, or is a second
  unexamined consequence of version-in-identity, is itself unanswered. **ANSWERED (EP-27): incidental, with
  positive evidence.** Commit `3f2de72` ("contract 1.1.0") reasoned explicitly *"no previously valid dataset
  newly rejected"* — and introduced `NH-DC-4003` duplicate submission in the same act, never mentioning that
  bumping the version resets every key. So one commit created a duplicate guarantee and silently reset its
  own scope. No test anywhere asserts the key's behaviour across versions.
* A dual-key lookup would be required only to *prevent* the free re-assessment. **ANSWERED (EP-27):
  not required, and deliberately not built.** The free re-assessment is only dangerous together with an
  operator who can also choose what the re-assessment *measures* — which was the situation until EP-26b.
  A second reading is now measured under an ACTIVE **governed** AssessmentPolicy the beneficiary cannot
  author or activate, and it produces a new execution identity standing beside the first. Rules 2, 5 and 9
  are satisfied without dual-key lookup. What remains, stated plainly: the duplicate-submission protection
  resets **once** at the cutover, and in exchange the derivation permanently removes the operator-supplied
  label from the identity. Reasoning: [`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md) §5.
* No backfill is required for correctness; one would be required only for the dual-key behaviour.
  **CONFIRMED (EP-28):** no migration SQL was written and no column changed.

## Tests required before the change lands — ALL PRESENT (EP-28)

`src/contract/pilotDataContract.test.ts` **9** (the label no longer moves the identity; every
meaning-changing field does; "auto" is its own choice), **9b** (major-granularity, and the cutover
consequence), **9c** (the golden vector); and `server/services/identityDerivation.test.ts` **1-11** for the
DB-backed half. The list below is the original requirement, kept verbatim as the record of what was asked.


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
