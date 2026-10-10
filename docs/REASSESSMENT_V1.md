# Explicit re-assessment of a retained input · v1

**Decided and built 2026-10-04.** No identity derivation changed. `pds`, `PAD-`, `PAX-` and every hash
scheme are untouched; the contract stays at `2.0.0`. One additive migration, two nullable columns, two
CHECK constraints, no backfill.

> A dataset already admitted and already assessed may be assessed **again** under a newly governed
> calculation method, **without re-supplying the file**, when the retained input is present and verifies
> against its own recorded hash. The result is a **new execution and a new finding, linked** to the
> previous one and carrying a stated reason. The earlier execution and finding are never written to.

## 1 · Why this exists at all

A pre-bump execution **cannot run on this build**. Its binding froze an older
`calculationMethodVersion`, and the run-time compatibility gate blocks it `NH-AX-2006` *before anything is
computed* ([`CALCULATION_METHOD_COMPATIBILITY_V1.md`](CALCULATION_METHOD_COMPATIBILITY_V1.md)). So there is
no "just re-run it", and the alternatives were: make the customer re-upload a file the system still holds,
or leave the number permanently unanswerable under the current method.

This is asserted, not assumed — test **0** of `server/services/reassessment.test.ts` hands such an
execution to this build and watches it block. It is also why that suite's fixture *records* the historical
result rather than driving the worker: driving it would assert the opposite of what is true.

## 2 · Why reusing the admission is sound

> **The admission verdict does not depend on the calculation method.**

`evaluateAdmission` reads the assessment policy only to `splitCohorts`, and never reads its
`calculationMethodVersion`. An admission reached under one method would have been **identical** under
another. Reusing it therefore reuses a decision that was never about the thing that changed — which is a
derivation from the code, not a convenience.

What re-assessment does **not** reuse is the *authorization*. Every governance fact is re-read and
re-checked **now**, in the same order the scheduling path uses it:

| Re-checked at re-assessment | Refusal when it fails |
|---|---|
| the actor holds `SchedulePilotAssessment` and the boundary | `403` |
| the previous execution hashes to its own identifier | `NH-AX-1005` |
| the retained input is present | `NH-AX-1015` |
| the retained input hashes to its own record, and to the execution's | `NH-AX-1015` |
| the cited analysis terms are governed, ACTIVE and hash-witnessed | `NH-AX-1010` |
| the bound admission decision still resolves and is `ADMISSIBLE` | `NH-AX-1001` / `NH-AX-1003` |
| the decision re-derives to its own `PAD-` | `NH-AX-1005` |
| the admission policy row still hashes to its registered definition | `NH-AX-1003` |
| the admission policy is still ACTIVE (not frozen, not retired) | `NH-AX-1007` |

A frozen bar refuses a revision (test **9**). Authorization is current, not inherited.

## 3 · What a revision may change — exactly one thing

`src/contract/assessmentRevision.ts` is pure and derives the delta from the two bindings rather than
trusting a narration. `bindingRevisionDelta` reports:

* **`changed`** — `calculationMethodVersion`, `assessmentPolicyId`, `assessmentPolicyVersion`. These move
  because a new governed terms version is what blesses the new method.
* **`unexpectedChanges`** — the **fourteen** fields a revision must hold constant: the boundary, the
  dataset fingerprint, the admission decision and its policy identity and hash, the contract version, the
  interpretation (mapping, amount format, date locale), the recovery case, and the three governed values
  that decide what is measured.

`isPermittedRevision` requires `unexpectedChanges` to be empty **and** `changed` to be non-empty, and the
service refuses the revision if it is not. `src/contract/assessmentRevision.test.ts` runs in the
**no-database** gate and proves the two lists together cover the **whole** binding — it perturbs every
leaf in turn and requires the delta to name exactly one field for each, so a binding field added later
cannot fall silently between the two buckets. 3 + 14 = 17 leaves, the claim stated from both directions. That check is unreachable given the gates above it — and it is
checked rather than asserted away, because a revision that changed something it must not is the one
outcome that would make "what changed" untrustworthy.

### `asOf`, `stallThresholdDays`, `currency` — refused, with the remedy named

Those three decide **what** is measured, and the admission was for that reading. Terms that change any of
them are refused `NH-AX-1016` and the extract must be **re-submitted** — the same conclusion
[`ASSESSMENT_IDENTITY_V1.md`](ASSESSMENT_IDENTITY_V1.md) reached for new governed terms generally: *a
verdict computed under one definition does not authorise an execution under another.*

## 4 · The four new refusals

| Code | Reason | Remedy |
|---|---|---|
| `NH-AX-1015` | the retained input is absent, was purged, or does not verify | **re-submit the dataset** |
| `NH-AX-1016` | the cited terms change what is measured, not how | **re-submit the extract** under the new terms |
| `NH-AX-1017` | the cited terms name the method this execution already used | nothing to do |
| `NH-AX-1018` | the revision's binding already exists as an independent execution | read that execution |

`NH-AX-1015` distinguishes **purged** from **absent** in its detail, because "collected on schedule under
the retention policy" is a different fact from "there is no input and no record of one" — and a customer
reading the refusal needs to know which. The purge path is reachable only the way the database permits it:
a recorded, trigger-validated purge authorization — checked against the event log, the task state and an
elapsed bound — and only then the DELETE. The input table rejects UPDATE unconditionally, so an input is
never *edited* into unverifiability; it is either there and verifiable, or purged with a record saying so.

### `NH-AX-1018` was found by a fixture, not by design

An execution's identity **is** its binding, so a revision can land on a row someone scheduled directly —
and a test whose fixture cited the terms the original execution already used arrived at exactly that
collision. Writing a revision link onto that row would claim it was produced by re-assessing this
execution, which it was not, and there is no second identity available for identical content. So it is
refused, and the pre-existing row is **not relabelled** (test **10b** asserts `revisesExecutionId` stays
null on it). Only a collision that *already* revises this same execution is treated as an idempotent
repeat.

## 5 · Nothing is replaced — the preservation claims, and how each is proven

Trust Invariant **rule 9** requires a revision to be a new linked record and **rule 5** requires the
historical proof to stay reproducible. Both hold by construction, because the previous rows are never
written to — and both are asserted on the rows rather than on the intention:

| Claim | Proof |
|---|---|
| the earlier execution row is byte-identical afterwards | test **2**, full-row `toEqual` before/after |
| the earlier finding row is byte-identical afterwards | test **2**, full-row `toEqual` before/after |
| the earlier execution is still readable at its own id, with its own method | test **2** |
| two findings exist, with two distinct `assessmentId`s | test **2** |
| the revision link is on the **row**, not merely in the response | test **1** (F37 proved the response alone is not enough) |
| the revision carries the **same input**, byte-identical, with no file re-supplied | test **1** |
| the read reports what changed, why, and that the earlier finding survives | test **3** |
| asking twice yields one execution | test **11** |

The database refuses the alternative outright. `pilot_assessment_executions` and
`pilot_assessment_findings` reject UPDATE and DELETE, so "silently replace a result" is not a thing the
application could do carelessly — it is a thing the storage layer declines.

The new columns are constrained rather than conventional:

```sql
CHECK (revises_execution_id IS NULL AND revision_reason IS NULL
    OR revises_execution_id IS NOT NULL AND length(trim(revision_reason)) > 0)
CHECK (revises_execution_id IS NULL OR revises_execution_id <> execution_id)
```

A revision with no stated reason cannot be stored, and nothing can revise itself. The reason is the only
part a human supplies, because no computation can produce it; a blank one is refused at the transport
(`\S` pattern, `400`) and again in the service.

### The input is written again, not shared

The revision gets **its own** input row with the same bytes. Not moved and not referenced: the previous
execution keeps its own, so purging one never strands the other and the earlier finding stays reproducible
from its own rows.

### No attribution is re-staged

EP-31 candidate staging belongs to the **first** assessment of these bytes. A revision stages none —
staging it again would double-count the same at-risk accounts.

## 6 · What the reader sees

`GET /pilot/assessments/:id` reports, for a revision:

```ts
revises: {
  executionId: string;              // the earlier result, readable at its own id
  reason: string;                   // the only human-authored part
  delta: BindingRevisionDelta;      // DERIVED from the two bindings, field by field, before → after
  previousFindingExists: boolean;   // the claim that makes this a revision rather than a replacement
} | null
```

`previousFindingExists` is reported rather than left to be taken on trust: a reader being told "this
revises an earlier result" should not have to go and check that the earlier result is still there.

## 6b · The operator flow — BUILT 2026-10-04

`src/modules/assessment/ReassessmentScreen.tsx`, its own nav entry under **Assess**, because it acts on
an execution that already exists rather than on a file being uploaded — and the operator reaching it has
usually come back days later because a method moved.

**What it cannot do is the design.** There is no file picker on the screen at all, asserted on the markup
rather than promised in a comment, so *"without re-upload"* is a property of the thing. No threshold,
cut-off, currency or method can be typed: the operator cites a governed definition and the server reads
the values from it.

**What it shows before submitting.** Every definition the tenant holds, each either selectable or
carrying the code the server would answer with and the reason in plain words:

| Shown in advance | Code | Why |
|---|---|---|
| not in force | `NH-AX-1010` | only an ACTIVE definition may measure anything |
| changes `asOf` / `stallThresholdDays` / `currency` | `NH-AX-1016` | a different reading — **re-submit the extract** |
| names the method already used | `NH-AX-1017` | nothing to re-assess |

`src/modules/assessment/reassessment.ts` is pure, and its header is explicit that **it is not a gate**:
each predicate is derived from values the *server* supplied and can only mark a row ineligible, never
eligible-despite. A permissive bug is still refused server-side; a restrictive bug shows a stated reason
the operator can check. A refusal that arrives anyway is rendered with its own code, detail and remedy.
Ordering is the server's ordering: not-in-force is reported before anyone asks what a definition
measures, so a draft that *also* moves the cut-off reports the governance reason and does not send an
operator to fix the wrong thing.

### Submitting exactly once, and retrying safely

**`submitGate` alone was not enough, and its test is what proved it.** Three clicks dispatched before
React re-rendered all passed the gate, because `setInFlight(true)` does not take effect until the next
render — so the disabled attribute had not been applied, the handler ran three times, and three requests
went out. **A disabled button is a display of the rule, never the rule.** A synchronous ref latch is;
`submitGate` keeps its real job, which is deciding what the control looks like and saying why it is shut.

For an uncertain response the screen says the request **may or may not** have reached the server and that
retrying is safe — because the revision's identity is derived from its binding, so a repeat resolves to
the same execution. It never sends anyone back to a file the server still holds.

**The frozen attempt, which is the subtle part.** The body is captured on the first attempt and replayed
verbatim. The reason is **not** part of the binding, so a retry carrying different wording creates no
second execution and is answered with the first — whose *stored* reason is the original. The screen would
then display a sentence the record does not hold. Changing the reason requires abandoning the attempt
deliberately ("Start over").

### Stated where the eye lands

Both figures are a **pilot assessment** — Revenue Opportunity — and the banner sits above them, not
below. A revision does not supersede the earlier answer, does not make it wrong, and does not make the
newer one proven. Both findings are shown side by side, with the server's own `previousFindingExists`
reported rather than taken on trust.

### One read widened

The governed-terms list now reports each definition's `calculationMethodVersion`. It is **server-stamped
at registration** (`makeAnalysisTerms` fills it; no request can state it), so it adds no
caller-controlled input — and without it an operator cannot tell a real method change from a no-op and
would learn `NH-AX-1017` only by being refused.

## 6c · The browser journey — BUILT 2026-10-04

`e2e/journey.mjs` §11b drives it through the screen, the API, the database and the worker, and asserts
the persisted link, the preservation, the visible change and a governance refusal. 120/120 checks.

**The database lifecycle is deliberate, and the harness states its own contract.** Every identifier the
journey writes under is derived per run — the tenant boundary, the admission-policy id, the
analysis-terms id — so two runs against one database occupy two disjoint tenants, and every count it
asserts is scoped to its own boundary. That makes a second run on the **same** database the
repeat/idempotency case rather than a convenience, and §1a measures the claim instead of assuming it:
this run's tenant must hold nothing before the run writes anything, so a leaked row, a reused
identifier or a boundary that outlived a previous run fails there by name. Verified by running it twice
without recreating the database: 120/120 both times, two boundaries each holding exactly three
executions, two methods and one revision — the same shape — with every submission key, execution
identity and finding hash distinct across both runs, and the register sweep clean over the shared
database. The harness does not clean up after itself and is not required to: rows accumulate, which is
correct for append-only storage, and they accumulate in tenants this run cannot see.

**Why history has to be seeded, and it is the one unavoidable fixture.** A re-assessment only means
something across a method change, and the method is a build constant: every definition the governance
screen can register is stamped with the method this build implements. A result from *before* the bump is
a fact about the past. `scripts/seed-journey-prebump.ts` records one the way the pre-bump build did, and
its header says why it is written and not run — §1's point, from the harness's side.

| Claim | How the journey measures it |
|---|---|
| the revision link is persisted | read back from the **record**, not from the response the screen was handed |
| the stated reason is persisted | `revises.reason` equals what was typed |
| historical preservation | the earlier finding's **hash** is identical before and after — stronger than "the row is still there" — and it is still readable, still names its own method, and is not relabelled as a revision |
| the result changed visibly | two distinct `assessmentId`s, and the delta on screen with both values |
| a governance refusal | the bar is frozen and the re-assessment refused `NH-AX-1007` **on screen**, on a dataset admitted while it was ACTIVE — which is the proof governance is re-checked rather than inherited |
| a genuine method change, not a no-op | every definition on offer names a method **different** from the one the result was computed with |
| `NH-AX-1017` where a browser can reach it | the journey's original execution, already on this build's method, shows every definition as refusable and **nothing selectable at all** |
| the claim boundary | the pilot-not-proof sentence is on the result screen |

### Three defects it found, all in the code it was written to exercise

1. **`Panel` accepts only `children` and `className`**, so an `aria-label` handed to it is silently
   dropped. The refusal region looked named in the source and was unfindable. Wrapped in labelled
   sections instead.
2. **The completion wait matched any occurrence of the sentence**, which the *previous* execution's panel
   already carries — so it returned instantly, every read ran while the worker was still going, and five
   checks failed describing a revision that completed a second later. Scoping it to the revision's panel
   was not enough either: that panel carries **two** state pills, the locator resolved two elements,
   Playwright's strict mode threw, and the `catch` read a finished revision as one that never finished.
   One named region, one match.
3. **The `NH-AX-1017` check had its premise backwards.** It expected the pre-bump method to appear as a
   refusable definition; no registered definition names it, so it never could. The evidence runs the
   other way, and the no-op case moved to the target where it is reachable.

Each was a false reading of a system that was behaving correctly — which is the failure mode a browser
harness exists to catch, and the reason its waits are scoped to named regions rather than to text.

## 7 · Falsifiers

Each applied, run, and reverted byte-identically (`sha256` compared before and after).

| # | Falsifier | Fails |
|---|---|---|
| F35 | the retained input's hash verification is skipped | test 5 |
| F36 | the measured-values equality check is removed | test 6 |
| F37 | the revision link is not persisted on the row | tests 1, 3, 11 |
| F38 | the identity-collision check is removed | test 10b |
| F41 | current governance is not re-checked | test 9 |
| F42 | an unsupported method is not blocked | test 8 |
| F43 | one of the fourteen fields stops being compared at all | both coverage tests in `assessmentRevision.test.ts` |
| F44 | `submitGate` ignores `inFlight` | the duplicate-click test |
| F45 | the submit latch is removed, leaving only the gate | the duplicate-click test — this is the one that was *already* failing before the latch existed |
| F46 | `freezeAttempt` rebuilds the body on each attempt | the retry test |
| F47 | `classifyTermsForRevision` stops checking `SAME_METHOD` | the eligibility test and the journey's no-op section |

F37 is the one that earned its place: the first version of test 1 asserted only the **response**, which
reports the link either way, so the falsifier passed. The test now asserts the row.

## 8 · What this is not

Not proof, not a Recovery Case, not a counted dollar. The finding keeps
`constitutesProof: false`. It does not decide that a later finding supersedes an earlier one — it makes
both visible, attributable and reproducible, and refuses to hide either. It changes no historical
identity, no hash scheme, no stored record, and no existing refusal.
