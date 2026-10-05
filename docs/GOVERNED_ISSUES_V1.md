# Governed issues — open, recorded, not silently patched (v1)

Opened 2026-10-05.

`CLAUDE.md` requires that a discovered gap is **documented before it is edited** — "not silently patched,
not retrofitted to match what the code already does. State the gap and why it exists, then propose the
change." This file is where a gap lives when it is found during work on something else and must **not**
be folded into that work.

An entry here is an **open question with an owner**, not a bug queue. Each states what was found, the
evidence, why it was not fixed on the spot, and what the correct remedy would cost. An entry is closed by
a decision, not by a commit.

---

## 1 · `COMPATIBILITY_POLICY` permits a "minor" change that is MAJOR in effect

**Found:** 2026-10-05, while scoping the Detector #3 contract addition
([`DETECTOR_3_FAILED_PAYMENT_V1.md`](DETECTOR_3_FAILED_PAYMENT_V1.md) §C.1).
**Status:** OPEN. **Severity:** would break previously-admitted datasets if acted on as written.

### The gap

`src/contract/pilotDataContract.ts` §10 lists, under **minor**:

> "Add an optional or recommended field."

But the admission gate counts missing **recommended** columns and refuses on them:

```ts
// src/contract/admissionGate.ts:273-274
const recommended = fieldsByRequirement("recommended");
const missingRecommendedColumns = recommended.filter((f) => !(f in report.columnMapping)).length;
```

…checked against the governed `maxMissingRecommendedColumns`, which is **0** in the frozen pilot policy
(`e2e/fixtures/synthetic-validation-2026-09-27/FROZEN.json`, observed 0 against threshold 0).

So **adding one new `recommended` field makes every existing export miss one recommended column**, which
fails the `missing_recommended` admission check for datasets that previously passed. By the policy's own
definition that is **major**:

> "Tighten a validation rule so a previously valid dataset is now rejected."

The policy therefore contradicts itself: the same act is listed as minor and meets the stated test for
major.

### Why it was not fixed

Correcting the policy text is a **core-definition change** to the published compatibility promise, which
the constitution says goes through the constitution before code. It is also not needed to proceed: the
Detector #3 proposal simply declares its two fields `optional`, which is unambiguously minor and
unambiguously safe.

### Candidate remedies, for the decision

1. **Narrow the minor clause** to "Add an **optional** field" and move "add a recommended field" to
   major. Simplest, and matches what the gate actually enforces.
2. **Keep recommended-additions minor but exempt new fields from the missing-recommended count** — e.g.
   count only recommended fields that existed at the dataset's declared version. More faithful to the
   intent ("recommended" should not be a hard gate) but introduces per-version field sets, which is real
   complexity in the admission path.
3. **Require `maxMissingRecommendedColumns > 0`** in any policy. Rejected on sight: it would let a
   governing identity weaken the bar to permit a change, which is backwards.

**Recommendation: (1).** It makes the written promise match the enforced behaviour, and nothing currently
depends on adding a recommended field.

### What must not happen

No new `recommended` field may be added under a minor bump until this is decided.

---

## 2 · `excludedCycleCount` is correctly computed and ambiguously named

**Found:** 2026-10-05, investigating whether the governed finding's `excludedCycleCount: 0` contradicted
the intake's 15 rejected rows.
**Status:** OPEN (naming only). **Severity:** low today; the correction is blocked by identity.

### The finding: the semantics are CORRECT

Traced end to end:

* `projectExecutionInput(cycles: readonly ExpectationCycle[])`
  (`src/contract/assessmentExecution.ts:374`) takes **accepted cycles only**. A rejected row never
  becomes an `ExpectationCycle`, so it cannot be in the projection.
* `projectedAssessmentResult` maps every projected cycle to `{ kind: "cycle" }`, so `assess()` receives
  **no exclusion outcomes** and `excludedRowCount = allExclusions.length` is **0 by construction**.
* `findingFromProjectedResult` already scopes it in its own comment: *"Exclusions the assessment itself
  produced (cycle-identity collisions)"*.
* The intake reports its rejections separately and correctly — on the frozen corpus:
  `counts.rejectedRows = 15`, 16 `rowFindings` over 15 rows, a 13-code `rejectionDistribution`, and a
  `rejection_rate` of 5.54% against a 10% bar.

**So `excludedCycleCount` means "cycles the ASSESSMENT excluded", and zero is literally true.** This is
**not** a reporting defect, and no correction to the computation is warranted.

### The residual gap

1. **The name is ambiguous at the API boundary.** `excludedCycleCount` reads as "rows excluded from this
   assessment". A reader who does not know the pipeline has two stages could take `0` as "nothing was
   dropped from my file", when 15 rows were dropped at intake.
2. **The scalar is near-vacuous on the governed path.** The only exclusion `assess()` can produce is a
   cycle-identity collision, and the intake already rejects those (`NH-DC-2016` — 2 rows on the frozen
   corpus). So in practice it is always 0, which is exactly when a number is most likely to be
   misread as meaningful.

### Why it was not fixed

`excludedCycleCount` is one of the **seventeen** keys of `canonicalFinding`
(`src/contract/assessmentExecution.ts:482-506`). Renaming it changes the canonical JSON and therefore
`findingHash`, which means:

> same historical input + same governed terms + same `ASSESSMENT_CALC_VERSION` ⇒ **different**
> `findingHash`

That is the silent semantic re-grade the Detector #2 slice was built to avoid, and it breaks Trust
Invariant rule 5 (historical proof stays **reproducible** forever). **A rename is a STOP condition and
needs its own decision**, exactly like the Detector #2 `canonicalFinding` question.

### Mitigating facts

* `excludedCycleCount` is rendered on **no screen** — zero `.tsx` references — and the execution view
  carries no intake counts, so no operator surface currently asserts it.
* The intake's own report is accurate and complete; nothing is hidden, it is simply reported elsewhere.

### Candidate remedies, for the decision

1. **Leave the key, document the meaning** at the API and in the data contract: "exclusions produced by
   the assessment; intake rejections are reported by the intake." Zero identity movement. Weakest, but
   free.
2. **Surface both numbers together** wherever a finding is shown to an operator, carrying the intake's
   `rejectedRows` alongside. No identity movement — the intake counts are already stored. Addresses the
   actual risk (a reader drawing the wrong conclusion) without touching a hash.
3. **Rename to `assessmentExcludedCycleCount`.** Clearest, and requires an `ASSESSMENT_CALC_VERSION`
   decision plus re-blessing of governed terms. Not worth it for a scalar that is always 0.

**Recommendation: (2), with (1).** It fixes the reading risk at the surface where the risk exists and
leaves every historical finding byte-identical.

### What must not happen

No change to `canonicalFinding`'s key list, no `findingHash` movement, and no historical re-grade for
this issue.

---

## 3 · QUARANTINED POTENTIAL EXPOSURE REQUIRING DATA CORRECTION

**Found:** 2026-10-05, while testing whether intake-rejected rows could be a detector.
**Status:** OPEN as a *concept*, deliberately not a detector. **Severity:** none — nothing is counted.

### What was measured

Rows rejected at intake carry a real `next_invoice_amount` that is valued **nowhere**: `ExclusionRecord`
is `{ sourceRowId, reason, detail }` with no amount, and `summarizeExclusions` returns
`{ reason, count }`. The money on a rejected row is not merely unreported — it is not retained.

On the frozen corpus (15 rejected rows of 271), exactly **two** rows carry an establishable overdue
obligation whose defect does not touch overdue-ness:

| Data row | Amount | Due | Defect | Why it would otherwise be exposure |
|---|---|---|---|---|
| 25 | $1,000.00 | 2026-05-01 | `activation_at` (2026-03-20) precedes `signed_at` (2026-04-01) | Affects **cohort routing** (stalled vs reference), not whether the invoice is overdue and unsettled. |
| 31 | $1,000.00 | 2026-04-01 | `signed_at` carries a wall-clock time with no offset | `signed_at` is the obligation basis; it affects the stall computation, not the due date. |

**Total: $2,000.00.** The other 13 correctly fail closed — zero amount, negative amount, overpayment
(customer-favourable), the duplicate-cycle pair (excluded by the 2026-09-25 trust rule), an undated
refund, a test account, an invalid boolean, two contradictory-payment rows, a missing currency, a
not-yet-due row, and one row (24) whose **due date itself** contradicts `signed_at`, so overdue-ness
rests on a date the row contradicts.

### The decision taken

> **These rows failed intake. They are NOT admitted NH monetary exposure.** They enter no detector, no
> union, no monetary-recall denominator, and no figure shown as exposure.

They are recorded under the label **QUARANTINED POTENTIAL EXPOSURE REQUIRING DATA CORRECTION** as a
possible future concept — money that *might* be real and is currently unmeasurable, whose remedy is for
the customer to correct their export, not for NH to assess it anyway.

### Why it is not a detector

* **Not a leakage family.** It is a statement about the *coverage of the measurement*, not about a way
  revenue leaks.
* **Bounded by the admission bar.** `maxRejectionRate` (10% in the frozen policy) caps the population,
  and a dataset above the bar is refused entirely — which is the honest outcome.
* **Materially small**: ~1.6% of the corpus's $122,250.66 business register, and only because the
  generator planted date/format defects.

### What remains genuinely open

Trust Invariant rule 7 — *"Excluded Recovery is mandatory and cannot silently default to zero"* — is
satisfied in **count** (the intake reports every rejection by reason, with remediation text) but not in
**value**. Whether rule 7 requires a *monetary* statement of excluded recovery, and under what label, is
the open question. If it does, the shape is: per-reason count, obligated amount **only** where amount and
currency parse and the policy currency matches, explicit *unavailable* where they do not, foreign-currency
amounts reported per currency and **never** summed, and legitimately-excluded reasons (test account,
duplicate-cycle, undated terminal state, customer-favourable) in their own buckets outside any exposure
figure.

### What must not happen

No quarantined figure may be presented as exposure, added to a detector union, or used in a recall or
precision denominator, under any label, until this is decided.

---

## Issue #4 · Execution-lifecycle events order arbitrarily on a same-millisecond tie

**Found 2026-10-05, while reading a CI failure. Not caused by the slice that found it, and NOT fixed in
it — the slice's authorised scope excluded production files. Owner decision required.**

### The defect

`executionEvents` (`server/persistence/pilotExecutionStore.ts:330`) orders by
`[{ at: "asc" }, { id: "asc" }]` under a comment that reads *"`id` breaks ties so ordering is total."*

The ordering **is** total. It is **not chronological**, because `id` is `PXE-${randomUUID()}` — random,
not monotonic. And ties are not rare: the column is `timestamp(3)` in Postgres, so **millisecond**
precision, while two lifecycle events can be appended within the same millisecond.

So on a tie, which event is "latest" is decided by a coin flip.

### Measured, not reasoned

A probe appending `CLAIMED` then `COMPLETED` back to back, 40 trials:

```
trials 40 · same-millisecond ties 4 · LATEST EVENT WRONG 2
```

Ties occurred in 10% of trials and **half of those ordered wrongly** — the expected result if the
tie-break is random. This is exactly the observed CI failure: `reassessment.test.ts:266` read the
execution state as `running` because `CLAIMED` won the tie, so the last event was not `COMPLETED`.

The same SHA's `pull_request` run passed all four jobs. **A test that passes in one run and fails in
another on identical code is the signature of a race, and it was treated as one rather than retried
until green.**

### Blast radius, stated precisely

* **In the test fixture**, two events are appended in a tight loop, so collisions are likely — ~10% here.
* **In production**, `CLAIMED` and `COMPLETED` are separated by real work, so a collision needs the whole
  computation to finish inside one millisecond. Unlikely, **not impossible**, and it is not a
  probability anyone should have to reason about on the execution-state path.
* What is affected is the **projected lifecycle state** of an execution. No finding, witness, hash or
  money figure is computed from event order, so **no proven number is at risk** — this is a
  liveness/observability defect, not a proof defect. That is the reason it is reportable rather than
  urgent, and it is not a reason to leave it.

### The fix, when authorised

Make the tie-break monotonic rather than random, so ordering is total **and** chronological. The
candidates, in preference order: a monotonic sequence column on the event row; or a lexicographically
sortable time-ordered id (ULID/UUIDv7) replacing `PXE-${randomUUID()}` for new rows; or raising `at` to
`timestamp(6)`, which shrinks the window without closing it and is therefore the weakest option.

**Historical rows must not be rewritten.** Any change applies to new rows, and the ordering of existing
rows stays whatever it is — the same rule every other correction in this repository has honoured.

### What must not happen

The test must not be made to pass by retrying it, by sleeping between appends, or by asserting a weaker
state. Each of those hides a real ordering defect behind a green tick.
