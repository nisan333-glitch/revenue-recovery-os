# The admission bar and the analysis terms are coupled — `NH-AG-2007`, investigated

**Status: investigation, 2026-09-27. No code changed. No remedy chosen.** This document answers one
question and deliberately stops there.

EP-29 ([`SYNTHETIC_VALIDATION_2026-09-27.md`](SYNTHETIC_VALIDATION_2026-09-27.md) §10) reported that the
governed re-reading route does not complete end to end: the same extract re-read under a later `asOf` was
admitted as a new submission and then refused by the fitness bar with
`NH-AG-2007 — undetermined: 0 undetermined cycle(s) present`. The question was which of two things that is:

1. a genuine contradiction between the C3 re-reading route and fitness semantics, or
2. the bar behaving correctly, with a missing *definition* of what fitness means for a re-reading.

## The answer

**Neither, quite — and the EP-29 headline was wrong.** The route **does** complete end to end. It completes
under the bar the product itself uses everywhere; it was blocked only by a bar the validation experiment
wrote. What is genuinely missing is not a re-assessment definition but a **stated invariant**, and what is
genuinely defective is a configuration option the product offers and its own rationale disowns.

> **An admission verdict is a property of `(extract, governed analysis terms)`, never of the extract alone.
> Every lifecycle-coverage requirement is therefore terms-relative.**
>
> This is why EP-28 putting the governed terms inside the submission identity was already correct — the
> admission decision is keyed per `(extract, terms)` because that is what it is *about*. The plumbing was
> right before anyone wrote the sentence down. This document writes it down.

## What the code says

Seven facts. The conclusion turns on these and nothing else, so each carries its location.

1. **`undetermined` is definitionally a function of the governed terms.** `src/assessment/cohort.ts:33-46` —
   with no observation visible at `asOf`, a cycle is `undetermined` iff `addDays(expectationAt, N) > asOf`.
   For a fixed extract that is **monotone non-increasing in `asOf`**, and it reaches zero once
   `asOf ≥ max(expectationAt) + N`. **For any extract there exists a cut-off beyond which `undetermined`
   is necessarily empty.** The mechanism is real and general.
2. **The fitness bar is evaluated *under* the governed terms.**
   `evaluateAdmission(report, assessmentPolicy, admissionPolicy)` —
   `src/contract/admissionGate.ts:207-211` — calls `splitCohorts(cycles, assessmentPolicy)` at `:266`,
   which feeds `lifecyclePresent` at `:267-271` and the per-state check at `:305-310`. The bar's own
   measurement is taken through the definition. This is the coupling, and it is structural.
3. **The coupling is symmetric, so this was never about `undetermined`.** By the same classification a bar
   requiring **`stalled`** is broken by a sufficiently *early* cut-off, where nothing has reached its
   deadline yet. Any lifecycle-coverage requirement can be emptied by some choice of governed terms.
4. **Nothing in the product requires `undetermined`.** `src/contract/syntheticPilotDataset.ts:269`
   (`SCENARIO_POLICY`, which labels itself "a FIXTURE, not a recommendation, and not a default"),
   `server/agents/pilotAssessmentRehearsal.ts:166` (the closest thing the repo has to a recommended
   configuration) and every one of ~14 server and contract test bars use `["stalled", "reference"]`.
   **Only the synthetic-validation scripts** — `scripts/synthetic-validation-2026-09-27/verify.mjs:160,167`
   and the 2026-09-26 original — require `undetermined`. **The blocking bar was authored by the
   experiment, not by the product.**
5. **The requirement contradicts the product's own stated rationale.** `NH-AG-2007`'s remediation
   (`src/contract/admissionCodes.ts:116-117`) argues for exactly two things: *"Without both stalled and
   non-deviant cycles there is nothing to compare, and a stalled-only extract cannot support any statement
   about what normal looks like."* It says nothing about `undetermined` — and
   `src/assessment/cohort.ts:54-57` documents `undetermined` as "**Not yet classifiable** … **NOT**
   confirmed non-deviant", with `reference` as "Confirmed non-deviant … the only valid basis for future
   matching". `reference` **is** the comparison group. Requiring the presence of *unclassifiable* data as a
   condition of fitness is backwards on the code's own terms.
6. **But it is reachable in production by configuration.** `server/http/schemas.ts:409-412` accepts the enum
   member and `src/modules/governance/PilotPolicyGovernance.tsx:287-288` renders it as a checkbox. A steward
   can put such a bar in force today, and nothing warns them that the requirement is terms-relative.
7. **There is no anti-tuning lever.**
   `recordDatasetSighting(boundaryId, report.datasetFingerprint)` —
   `server/services/pilotIntakeService.ts:279` — is keyed on the **fingerprint**, not on the submission
   identity, and `server/persistence/pilotPolicyGovernanceStore.ts:127` returns the **existing**
   `firstSeenAt` when one is already recorded. So a re-reading inherits the original sighting time and
   `activatedAt > firstSeenAt` (`pilotIntakeService.ts:299`) still bites. **An operator refused by
   `NH-AG-2007` cannot govern a laxer bar and resubmit.**

## What execution says

Facts 4 and 7 carry the conclusion and neither is provable by reading alone, so both were measured. A
throwaway script (not committed) drove the real path — propose terms as the operator, activate as the
steward, propose the bar, activate the bar, upload, schedule, poll — against a **fresh** `nh_ag2007_test`
database built with `prisma migrate deploy`, using the **frozen** `dataset.csv`
(`214bae69…`) unchanged as input. **Every expectation below was written before the run.** Both freezes were
verified INTACT before and after.

| | Bar | Terms | Expected | **Observed** |
|---|---|---|---|---|
| **A1** | product `[stalled, reference]` | 1.0.0 · `asOf 2026-06-30` | ADMISSIBLE | **ADMISSIBLE** · stalled 16 / undet. 1 / ref. 239 · execution `completed` |
| **A2** | product `[stalled, reference]` | 2.0.0 · `asOf 2026-07-31` | ADMISSIBLE ⇒ the route works | **ADMISSIBLE** · stalled 17 / undet. **0** / ref. 239 · execution `completed` |
| **B1** | experiment `[… , undetermined]` | 1.0.0 · `asOf 2026-06-30` | ADMISSIBLE | **ADMISSIBLE** · identical figures to A1 |
| **B2** | experiment `[… , undetermined]` | 2.0.0 · `asOf 2026-07-31` | NOT_ADMISSIBLE `NH-AG-2007` | **NOT_ADMISSIBLE `NH-AG-2007`** → schedule refused `NH-AX-1003` |
| **C** | a **second, laxer** bar activated in the same boundary *after* B2's refusal | 3.0.0 · `asOf 2026-08-31` | refused by the anti-tuning rule | **REFUSED** — *"the policy was activated after this dataset was first submitted; a bar may not be set once the result is known"* |
| **C-ctl** | product bar, activated *before* any sighting | 3.0.0 · `asOf 2026-08-31` | ADMISSIBLE | **ADMISSIBLE** · execution `completed` |

**A2 is the result that changes the EP-29 conclusion.** Under the bar the product actually uses, the
re-reading is admitted, scheduled, and the execution **completes with a finding**. The governed re-reading
route works end to end. EP-29 measured the experiment's bar and reported the route.

**B2 reproduced the refusal deterministically on a clean database**, so nothing about EP-29's observation was
environmental.

**C confirms fact 7 by execution, and C-control makes the attribution sound.** Without C-control, C's refusal
could have been credited to the laxer bar or to the third cut-off; C-control admits that exact reading under
that exact bar, so the only difference left is *when the bar was activated*. **No lever exists.**

### The delta is fully traced

A2 and C-control are not scored against any prediction — none exists under those cut-offs, and inventing one
after the run is exactly what the frozen method forbids. But the figures are not left as untraced aggregates:

`observedUnpaid` moved `$31,650.63 → $35,750.63`, a delta of exactly **$4,100.00**, while `undetermined` went
`1 → 0` and `stalled` went `16 → 17`. Reading the responsible row straight out of the frozen bytes:
`synthetic-n-not-yet-due` (scenario **S19**, `near_miss_inside_window`), `signed_at 2026-06-20`,
`next_invoice_amount 4100.00`, no observation, no terminal state. Its deadline is
`2026-06-20 + 30 = 2026-07-20`, so by `cohort.ts:43-45` it is `within_window_not_yet_due` — **undetermined** —
at `asOf 2026-06-30`, and `no_observation_past_deadline` — **stalled** — at `asOf 2026-07-31`, contributing its
full obligation. **One cycle moved, and it is the one the delta names.** Hand-derivable, with no scorer
involved.

`asOf 2026-08-31` then produced figures **identical** to `2026-07-31` (stalled 17, undetermined 0,
`observedUnpaid` `$35,750.63`), which is fact 1's monotonicity showing up as a plateau once nothing is left to
resolve.

## The two defects this leaves

Kept apart, because they are different kinds of thing.

### 1 · A latent configuration trap the product offers and its own rationale disowns

`undetermined` is offered as a requirable lifecycle state (fact 6) although the code that refuses on it argues
only for stalled + non-deviant (fact 5), the cohort it names is documented as *not classifiable* rather than
as a comparison group (fact 5), and the requirement is definitionally destroyed by a sufficiently late cut-off
(fact 1). No configuration in the repository uses it (fact 4). It is reachable, it is silent, and a steward
putting it in force today would be told nothing.

**Severity: real but bounded.** It cannot produce a wrong number — the refusal is conservative, and the system
declines to measure rather than measuring an unfit population. It cannot be exploited — fact 7 and measurement
C. What it can do is strand a legitimate question behind a refusal whose cause is not where the operator would
look, and the remediation text would point them at the export rather than at the bar.

### 2 · An overstatement in EP-29, corrected in place

EP-29 §10 said the finding was *"a real finding and not an artifact of the dataset … the mechanism is
general"*, and its executive summary said the route *"does not complete end to end"*. The **mechanism** is
general — fact 1 proves it, and this document keeps that claim. The **conclusion drawn from it was wrong**:
generality of a mechanism is not exposure of a product, no product configuration requires the state, and A2
shows the route completing. That is struck in place in EP-29 rather than reworded, and the original wording
stays readable there.

## Candidate remedies — listed, deliberately NOT chosen

Each changes what **admission means**, which per [`CLAUDE.md`](../CLAUDE.md) → *Changing this constitution*
makes it a core-definition decision that goes through the constitution **before** code. None is adopted here.

| Option | What it would change about the meaning of admission | Cost |
|---|---|---|
| **A · Remove `undetermined` from the requirable set** | Admission stops being able to ask "is this extract still live?" at all. Aligns the option surface with facts 5 and 3. | A **breaking, tightening** contract change: it invalidates any bar in force that names the state, and it hashes differently. Narrowest fix; also the bluntest. |
| **B · Scope `requiredLifecycleStates` to the original reading** | A re-reading inherits the fitness judgement of the reading it descends from. Admission becomes partly a property of a *lineage*, not of `(extract, terms)`. | Needs a notion of descent that does not exist, and risks carrying a stale fitness verdict forward — the thing rule 2 of the Trust Invariant exists to prevent. |
| **C · Pair a bar version with a terms version** | A bar is only ever in force *for* a definition, making the coupling explicit in the governance model rather than implicit in the evaluator. | The most honest model and the most work: two governed objects become one governed pair, with a migration for every bar already in force. |
| **D · A distinct re-assessment admission mode** | Admits that "is this extract fit to judge for the first time" and "is this extract fit to re-judge under new terms" are different questions. | A second admission semantics to keep in step with the first — the same auditability objection EP-27 used to reject a general two-major window. |
| **E · Document the coupling and warn at the point of choice** | Nothing. The invariant becomes stated and the UI stops being silent. | Does not remove the trap, only lights it. Cheapest, and composes with any of A–D. |

**What the evidence does and does not decide.** It rules out the framing that motivated the question: there is
no C3-versus-fitness contradiction to resolve, so **D is not forced**. It makes the stated invariant
non-optional, so **E is a floor rather than an option**. Between A and C it is silent, because that choice is
about what the product wants admission to *be*, not about what the code currently does.

## What this investigation does not establish

It does not decide the remedy. It does not establish that a bar requiring `undetermined` is *never*
reasonable — "your export must contain cycles still in flight" is a coherent commercial requirement, and the
finding is that such a bar is terms-relative, not that it is meaningless. It changes nothing about the EP-29
figures, the capability gap (**65.4% invisible**, unchanged) or either freeze. And nothing here is recovered
money or proven returned revenue: the executions that completed produced *Detected Revenue Opportunity* on a
synthetic file, and nothing was collected.
