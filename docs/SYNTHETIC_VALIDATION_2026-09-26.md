# Synthetic end-to-end revenue-leakage validation — 2026-09-26

A validation exercise, not a demo. A 271-row synthetic dataset with independently recorded ground truth
was driven through NH's real governed path — propose, activate, intake, admission, schedule, worker,
finding — and NH's answer was scored against a prediction frozen **before** the run.

**Nothing here is recovered money and nothing here is proven returned revenue.** The planted figures are
*Synthetic Ground-Truth Leakage*. What NH computes is *Detected Revenue Opportunity*. No collection
occurred; a synthetic run establishes neither recovery nor proof.

## Executive result

| | |
|---|---|
| Ground-truth leakage, in dataset | **$35,650.71** |
| NH detected opportunity — the headline it shows | **$31,650.63** |
| Correctly identified value | **$35,650.71** (headline $31,650.63 + partial remainder $4,000.08, reported beside it) |
| Missed value, within capability | **$0.00** |
| False-positive value | **$0.00** |
| Precision | **1.000** |
| Recall | **1.000** |
| Missed value, outside capability — separate register | **$65,100.00** across 6 leakage classes |

Every one of NH's four money totals matched the frozen prediction **to the cent**, and the cohort counts
matched exactly. 240 control rows produced no false positive.

**Read the precision and recall narrowly.** They measure whether NH correctly applies *its own*
definition of a stalled cycle, which the ground-truth manifest encoded. They are **not** evidence that
the definition captures what a revenue operator would call leakage. Findings 3, 4 and 7 below are the
evidence that in three respects it does not.

## 1 · Repository capabilities actually found

**The pilot path has exactly one detector.** `classifyStall` — an observation after `asOf` is invisible;
with an observation, stalled iff `epochDay(obs) − epochDay(signed) > stallThresholdDays`; without one,
stalled iff the deadline was reached by `asOf`. There is no second rule.

**The money is a partition, not a model.** Over the *stalled cohort only*: `observedUnpaid` (the
headline), `partialOutstanding` (amount − paid), `excludedValue` (cancelled/refunded), `unknownValue`,
and `grossEligible`. Nothing is estimated or forecast; each figure sums amounts already in the file.

**One aggregate finding per execution** — counts, five totals, `stateCounts`, `exclusionCodes`. No
per-entity output.

**Fix and Prove are unreachable from this path.** The finding declares `createsRecoveryCase: false`,
`constitutesProof: false`, `constitutesRevenue: false`, and the assessment agent publishes no candidate.
Detection ends at an immutable observation.

**The `LeakageType` taxonomy is not produced here.** `StalledOnboarding`, `ActivationMissed`,
`NoFirstValue`, `LowAdoption`, `RenewalAtRisk`, `ExpansionStalled` live in `src/domain`; the pilot
finding carries no leakage type at all.

## 2 · Dataset design

Written by an **independent generator** (`scripts/synthetic-validation/generate.mjs`) that imports only
node builtins — asserted, because the existing `syntheticPilotDataset.ts` shares a module family with the
adapter that reads it, and reusing it would have made agreement meaningless.

Ground truth is recorded **twice**: `business_expectation` (what an operator would say is leaking, from
the narrative) and `expected_nh_classification` (what NH's documented semantics should do). NH
disagreeing with the second is an implementation defect; disagreeing with the first while matching the
second is a capability or semantics gap. That split is what defuses the circularity, and it is why the
caveat above matters.

**Reconciliation from an aggregate.** NH emits nothing per entity, so each scenario's contribution
carries a distinct power-of-two **cent tag** within its bucket (sums ≤ 63, never carrying into dollars);
every other row ends in `.00`. Decodability was proven by exhaustive subset enumeration before freezing.

## 3 · Counts

| | |
|---|---|
| Rows, main dataset | 271 |
| Entities | 130 |
| Scenarios | 43 |
| Period | 2026-01-01 … 2026-07-31 (`asOf` 2026-06-30, stall threshold 30 days, USD) |
| Seed | 20260926, deterministic |
| Spot datasets | 2 × 238 rows (shared healthy base, one scenario each) |

## 4 · Planted taxonomy

**In capability** — 6 headline scenarios (never activated, activated late, one day past the bar,
activation after the cut-off, explicit unpaid boolean, dimensional variation) · 3 partial payments
including a one-cent remainder · 4 terminal states (cancelled, refunded, status-expressed, boolean) ·
2 unresolvable payment-evidence cases · 1 stalled-but-paid-late · 5 near misses · 14 row-level defect
classes · 236 healthy control cycles across 96 entities with 2–3 cycles each.

**Out of capability** — 6 classes recorded with the specific missing columns: usage/adoption decline
(`seats_active`, `usage_events`), renewal at risk (`renewal_date`, `contract_end_at`), expansion stalled
(`entitled_seats`, `purchased_seats`), discount leakage (`list_price`, `discount_pct`), dunning failure
(`payment_attempts`, `failure_code`), credit-note misapplication (`credit_note_id`, `credit_applied_to`).
No rows exist for these, so no detector was given a chance at them, and they are **never** summed with
in-dataset leakage.

## 5 · Execution path used

Real HTTP API, real leased worker, fresh PostgreSQL 16. Four governed runs:

| Run | Admission | Result |
|---|---|---|
| permissive / main | **ADMISSIBLE** | execution `completed`, finding produced |
| permissive / spot-multicurrency | **NOT_ASSESSABLE**, `NH-DC-1006` | refused whole — as predicted |
| permissive / spot-cancelled-after-asof | **ADMISSIBLE** | execution `completed`, $6,700.00 in the headline |
| strict / main | **NOT_ADMISSIBLE** | refused at admission — the adversarial control, as stated in advance |

Then **one browser pass** on the main dataset: 7/7 checks, including that the governed observation panel
— which renders only from a server finding — shows `$31,650.63`, the same figure the API reported.

The admission bar was written into the prediction **before** the run and never retuned after seeing a
result. The strict bar (`maxRejectionRate: 0.01`) was stated in advance as an expected refusal.

## 6 · Detection results

| Bucket | Predicted | NH | Variance | Decoded contributors |
|---|---|---|---|---|
| observedUnpaid | $31,650.63 | **$31,650.63** | $0.00 | S01+S02+S03+S04+S05+S06 |
| partialOutstanding | $4,000.08 | **$4,000.08** | $0.00 | S07+S08+S09 |
| excludedValue | $8,490.15 | **$8,490.15** | $0.00 | S10+S11+S12+S13 |
| unknownValue | $10,500.03 | **$10,500.03** | $0.00 | S14+S15 |
| grossEligible | — | $51,650.70 | — | identity holds: $31,650.63 + $17,800.07 + $2,200.00 |

Cohorts: stalled **16 = 16**, undetermined **1 = 1**, reference **239 = 239**, accepted cycles 256.

Reconciliation: **15 true positives · 0 false negatives · 0 misplaced · 0 false positives · 6 true
negatives · 14 excluded-row scenarios verified by code.** Every planted defect produced exactly its
expected code: `NH-DC-2002, 2005, 2006×2, 2009, 2010, 2011, 2012×2, 2013, 2014, 2016×2, 2018, 2021,
4001` — 15 rejected rows from 14 scenarios, the duplicate pair correctly yielding **both** rows excluded
plus the identical-row code, per the 2026-09-25 collision rule.

Boundary behaviour was exact: activated at **signed+30** is *not* stalled; at **signed+31** it is.

## 7 · Findings — what the run actually teaches

**F1 · The headline understates planted leakage by $4,000.08 (11.2%).** Ground-truth in-dataset leakage
is $35,650.71; the figure NH presents is $31,650.63. The difference is `partialOutstanding`, which is
reported *beside* the headline rather than in it. Defensible — a part-paid invoice is not wholly at risk —
but an operator reading only the headline is under-counting, and nothing on screen says so.

**F2 · Two of the five money figures never reach the governed panel.** The execution panel shows
`observedUnpaid`, `grossEligible` and `excludedValue`. `partialOutstanding` ($4,000.08) and
`unknownValue` ($10,500.03) are computed, classified and stored — and absent. **$14,500.11 of classified
money is invisible where the governed figure is shown.** Measured in the browser, not inferred.

**F3 · An unpaid invoice from a customer who activated on time is invisible.** Scenario
`n-unpaid-but-activated-promptly` ($9,300.00) lands in the reference cohort and contributes to no total.
This is correct for a product scoped to *activation* leakage and wrong for anything called revenue
recovery generally. It is the central coverage question this exercise surfaces, and the manifest flags it
as an ambiguity rather than a defect.

**F4 · One foreign-currency row makes an entire dataset unassessable.** A single EUR row among 238
carries `NH-DC-1006` at **dataset** level: `accepted: false`, `acceptedRows: 0`, no figure at all. My
prediction said row-level exclusion; it is whole-file rejection. A real operational risk for a customer
whose export happens to include one foreign subsidiary — and the reason that scenario had to be measured
in isolation.

**F5 · Coverage-window containment is enforced per row** (`NH-DC-2021`). Found because my own artifact
declared Jan–Jul provenance while emitting five rows due later. The generator was corrected; the rule is
worth knowing, because an export whose window is declared loosely loses rows silently to the rejection
rate.

**F6 · A cancellation after the cut-off does not suppress the headline.** `$6,700.00` reaches
`observedUnpaid` even though the row is cancelled on 2026-08-01. Correct — as at `asOf` the money was
owed, and the later cancellation is future information — but reasonable people read it differently, which
is why it was spot-checked separately.

**F7 · The five leakage types NH names cannot be detected, and the sixth is the only one it does.** No
column can carry usage, renewal, expansion, discount, dunning or credit-note signal. $65,100.00 of
planted narrative sits outside the product's reach entirely.

**F8 · Detection ends at an observation.** No candidate is published, no recovery case is created, and
the finding says so itself. *Identify* works end to end on this path; *Fix* and *Prove* are not reachable
from it.

## 8 · Evidence integrity

Disclosed in full, because a validation that hides its own corrections is not one.

* **The prediction was frozen and checksummed before the first run.** `FROZEN.txt` carries a digest over
  datasets + ground truth + prediction.
* **Two predictions were wrong and are preserved, not edited** — F4 and F5. Run v1's dataset, ground
  truth, prediction and raw output are kept as `*-v1.*`; run v2's as `*-v2.*`.
* **Two of my own artifacts were corrected, and neither is the product**: the generator emitted rows
  outside its declared coverage window (F5), and the spot datasets initially lacked the `undetermined`
  lifecycle state the pre-stated bar requires, so both were refused `NOT_ADMISSIBLE`. **The bar was not
  touched** — it was stated in advance and it did its job; the dataset composition was fixed instead.
* **Two bugs in the scorer were fixed** — it decoded on cents alone, so a single untagged contributor was
  indistinguishable from none, and it did not know which run carried the strict bar. Instrument, not
  ground truth.
* **One of my browser assertions could have passed vacuously**: it read `main`, which also contains the
  browser's *local preview* of the same bytes. It is now scoped to the panel that renders only from a
  server finding.
* **Circularity**: the generator imports nothing from `src/`, asserted mechanically. But
  `expected_nh_classification` was written from reading NH's code, so the exact monetary agreement
  validates arithmetic and implementation consistency — **not** the rightness of the definitions.

## 9 · Reproducibility

**Yes.** Deleting the datasets and re-running the generator reproduces byte-identical files
(`sha256 214bae69…`). Fixed seed 20260926; all temporal values absolute; no clock read.

```
node scripts/synthetic-validation/generate.mjs        # dataset + ground truth
node scripts/synthetic-validation/verify.mjs          # independence, decodability, freeze, prediction
DATABASE_URL=… node scripts/synthetic-validation/run.mjs             # four governed runs
node scripts/synthetic-validation/score.mjs           # reconciliation and metrics
DATABASE_URL=… node scripts/synthetic-validation/browser-confirm.mjs # the operator's screen
```

## 10 · What must be improved next, on this evidence

1. **Decide whether unpaid-without-stall is in scope** (F3). It is the largest coverage question the run
   exposed, and it is a product decision, not a code one.
2. **Show the whole partition where the figure is shown** (F1, F2). $14,500.11 classified and invisible,
   and a headline that under-counts planted leakage by 11%, are presentation problems with a monetary
   size.
3. **Reconsider whole-file rejection on mixed currency** (F4) — or say so loudly in the intake kit, since
   one row costs the entire assessment.
4. **Per-entity output.** Reconciling an aggregate required a cent-tagging scheme. A customer asking
   "which accounts?" cannot be answered by this finding at all.
5. **The path stops at Identify** (F8). Nothing here contradicts the constitution's warning about
   shipping a detection product; it measures exactly how far from the complete loop this path is.

## Claim boundary, restated

Synthetic Ground-Truth Leakage is planted. Detected Revenue Opportunity is what NH computed. Neither is
Recovered Revenue and neither is Proven Revenue Returned — no collection happened, no proof standard was
satisfied, and no recovery case exists. Detection accuracy and monetary accuracy are reported separately
above and must not be combined into a single figure.
