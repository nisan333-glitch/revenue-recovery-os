# Analysis-terms governance — what the assessment measures, and who decides it

**Status: built 2026-09-26 (EP-26).** This is step 1 of the binding order of work in
[`ASSESSMENT_IDENTITY_V1.md`](ASSESSMENT_IDENTITY_V1.md) → *What must exist before the identity changes*.
The identity derivation is **unchanged**, the contract major version is **unchanged**, and no migration of
existing submissions exists. Steps 2 and 3 remain open.

## The gap this closes

`asOf` decides what information exists. `stallThresholdDays` decides what **stalled** means. Together they
are the definition a figure is measured under — and they arrived in a request body, chosen by the party who
benefits from the figure.

Meanwhile the admission bar, which only decides whether a dataset is *fit to judge at all*, already required
a proposal by one identity and an activation by another, with a stated reason, an append-only log and an
anti-tuning check. The system governed the smaller decision and left the larger one to whoever sent the
request. Trust Invariant rule 2 — *the baseline and recovery definition were established before the outcome
was known* — is what the analysis terms had slipped outside of.

## The invariant now proved

> An assessment's `asOf` and `stallThresholdDays` are never chosen by the requester. They are read from an
> **ACTIVE** registered version whose proposal and activation are **two different identities**, each recorded
> append-only with a stated reason. A change to either value is a **new version** with its own proposal and
> its own activation; it yields a **new execution identity** and can never re-grade a finding that already
> exists. **No request may carry either value.**

The last sentence is what makes the rest true rather than merely intended. `additionalProperties: false` on
the request's `policy` object means the transport itself refuses `stallThresholdDays` and `asOf` — so there
is no channel through which a cut-off can be chosen, rather than a guard that could be forgotten at one call
site. `analysisTermsGovernance.test.ts` **5** is where that is measured, on both endpoints, with three
smuggling attempts each.

## Why this is NOT the admission bar's anti-tuning rule

The bar carries an ordering rule: a policy activated **after** a dataset was first seen may never judge it
(`activatedAt > firstSeenAt` ⇒ refused). Someone could otherwise read a verdict, activate a laxer bar and
resubmit.

Copying that ordering to the analysis terms would forbid the one thing the constitution decision explicitly
permits — asking *"and how does this look as of a later date?"* — and would push an operator into editing the
export, changing data in order to ask a question about time. **So the guarantee here is structural, not
temporal:**

| | Admission bar | Analysis terms |
|---|---|---|
| Two identities, stated reason, append-only log | yes | yes |
| A change is a new version, never an edit | yes | yes |
| Temporal anti-tuning (`activatedAt > firstSeenAt`) | **yes** | **no — deliberately** |
| A new version can re-grade an existing result | no | **no** — it derives a new execution id |

A second reading of the same extract is therefore possible, and it is a **second, separately governed,
separately identified run standing beside the first** — which is still there, still saying what it said. That
is test **13**, which asserts two execution ids, two bindings, and the first stored execution unchanged.

## What is reused, and what is deliberately separate

Decided by inspection before any code was written.

**Reused, unchanged:**

* **`src/contract/policyLifecycle.ts`** — states, legal transitions, `deriveState`, `canTransition`,
  `mayEvaluate`, `whyCannotEvaluate`. It was already written about *a versioned governance object*, not about
  thresholds, so it needed no edit. Whether a governed object may act is the same question for both, and
  forking it would let the two drift apart.
* **The permissions** `ProposePilotPolicy` / `ActivatePilotPolicy` / `RetirePilotPolicy`. Both objects are
  decided by the same two parties, so a parallel triple would widen the authorization surface without adding
  a guarantee: whoever may put a fitness bar in force is the body that may put a cut-off in force.
* **`nh_reject_mutation()`**, the CHECK-constraint idiom, and the "state is derived from events, never stored
  as a column" shape.

**Separate, on purpose:**

* **Two new tables** (`pilot_analysis_terms`, `pilot_analysis_terms_events`) rather than a shared table with
  a kind column. One event table keyed by a single id would let an admission policy id **collide** with a
  terms id, so one governance act could read as the other.
* **Its own hash scheme** (`nh-analysis-terms-v1`), so no hash of one object can ever equal a hash of the
  other.
* **Its own refusal code**, `NH-AX-1010`, in the execution catalogue — which exists precisely for "the bar
  you were judged under has since been frozen" governance answers.
* **Its own UI panel** on the governance screen. An act on the fitness bar is not an act on the definition of
  *stalled*, and the screen must not let one read as the other. Both status rows are now `aria-label`led,
  because two governed objects on one screen use the same state vocabulary and an unscoped assertion on
  "ACTIVE" could be satisfied by the wrong panel.

## Where the definition comes from now

| | Before | After |
|---|---|---|
| Transport (`/pilot/datasets`, `/pilot/assessments`) | `policy: { stallThresholdDays, asOf, currency }` | `policy: { currency }` + `analysisTermsId` / `analysisTermsVersion` |
| Upload screen | a number box and a date picker | a **selector** of activated definitions, showing each one's `asOf` and N; non-ACTIVE rows are listed **with their state** rather than hidden |
| Cohort screen | a "Re-run with N" button | a statement that N is governed. **That button was the lever**: it let the beneficiary walk the threshold until the number looked right |
| Governance screen | the fitness bar only | the fitness bar **and** the definition, as two panels |
| Execution binding | `assessmentPolicyId: "policy-default"`, `assessmentPolicyVersion: "1"` | the **governed reference**, filling a hook that had been latent since EP-16 |

`currency` is still the caller's to state: it describes the file, not the reading of it. It is classified as
an identity field in `ASSESSMENT_IDENTITY_V1.md` and is **out of scope** for this slice.

## What the database refuses, independently of the application

Proved by test **10**, **11** and directly in `psql`:

* `UPDATE` / `DELETE` / `TRUNCATE` on either table — `append-only: … is rejected`. A registered definition is
  frozen forever, so no migration, restore or well-intentioned Prisma client can retroactively change what a
  historical finding measured.
* A cut-off that is not an ISO date, or not a real calendar date (`2026-02-30`), or a threshold outside
  `0…3650`, or an empty hash — refused by CHECK constraints, not only by the domain constructor.
* A duplicate `(boundary, terms id, terms version)` — refused by the primary key, and the stored definition
  is **not** overwritten (test **9**).
* An unknown transition, or a lifecycle row with a blank reason — refused by CHECK.

## Negative controls

Eight guards removed one at a time, each failing a **named and attributable** test. Full table in
[`EP19_NEGATIVE_CONTROLS.md`](EP19_NEGATIVE_CONTROLS.md) → NC-29 … NC-36. Two are worth naming here:

* **NC-31** (the transport accepts the two values again) fails **only** test 5. That is the point: every other
  test still passes with the lever restored, which is exactly why test 5 has to exist.
* **NC-34** (the proposal is no longer atomic) initially failed **nothing**. Adding the transport's
  non-whitespace guard had made the orphan-row path unreachable over HTTP, so the transaction was
  defence-in-depth with no test that could fail without it. Test **18** now calls the service directly — a
  public entry point the rehearsal agent uses — and catches it.

## What is NOT claimed

* **Nothing here is recovered money or proven returned revenue.** This slice creates no Recovery Event, no
  Case, no Proof and no revenue figure of any kind.
* **The identity derivation is unchanged.** A byte-identical dataset re-submitted under a new *label* is still
  accepted — that defect is recorded in `ASSESSMENT_IDENTITY_V1.md` and is step 3, not this step.
* **Tenant isolation is not strengthened here.** Dev-header actors still receive `boundaryIds: ["*"]`, so
  nothing in the browser evidence tests access control. Boundary scoping of the *register* is real and tested
  at service level (test 8): another tenant's version reads as **absent**, never as theirs.
* **The temporal anti-tuning rule is deliberately absent**, for the reason given above. An operator who has
  seen one reading can ask governance for another — what they cannot do is grant it to themselves, change the
  first, or obtain one without a second identity and a written reason on an append-only log.
* **One pre-existing defect of the same shape is left untouched and reported rather than fixed:**
  `registerPilotAdmissionPolicy` writes the policy row and its `PROPOSED` event **without a transaction**, so
  a failure between them leaves a registered bar with no lifecycle and no state. It is fail-closed
  (`deriveState([]) === null` ⇒ judges nothing) and out of scope for this slice.
