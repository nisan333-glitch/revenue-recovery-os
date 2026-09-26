# Synthetic end-to-end revenue-leakage validation — 2026-09-26

A validation exercise, not a demo. A 271-row synthetic dataset with independently recorded ground truth
was driven through NH's real governed path — propose, activate, intake, admission, schedule, worker,
finding — and NH's answer was scored against a prediction frozen **before** the run.

## Claim boundary — read this first

**Nothing here is recovered money and nothing here is proven returned revenue.** The planted figures are
*Synthetic Ground-Truth Leakage*. What NH computes is *Detected Revenue Opportunity*. No collection
occurred; a synthetic run establishes neither recovery nor proof, no proof standard was satisfied, and no
recovery case exists. The three results below are reported **separately** and must never be combined into
a single figure.

## Executive result — three separated results

### 1 · Detection accuracy — does NH correctly find what it attempts to find?

| | |
|---|---|
| True positives | **15** |
| False negatives | **0** |
| Misplaced (right cohort, wrong bucket) | **0** |
| False positives | **0** |
| Control rows producing nothing | **240** |
| Precision · Recall | **1.000 · 1.000** |

Counted over scenarios the cent-tag decode can settle. NH emits no per-entity output, so this is the
strongest per-scenario statement the product's own output supports.

### 2 · Monetary accuracy — is the amount right?

| | |
|---|---|
| Ground-truth leakage, in dataset | **$35,650.71** |
| NH detected opportunity — the headline it shows | **$31,650.63** |
| Headline + partial remainder reported beside it | **$35,650.71** |
| Variance vs ground truth | **$0.00** |

All four money buckets matched the frozen prediction **to the cent**, each with a unique decode:

| Bucket | Predicted | NH | Variance | Decoded contributors |
|---|---|---|---|---|
| observedUnpaid | $31,650.63 | **$31,650.63** | $0.00 | S01–S06 |
| partialOutstanding | $4,000.08 | **$4,000.08** | $0.00 | S07+S08+S09 |
| excludedValue | $8,490.15 | **$8,490.15** | $0.00 | S10–S13 |
| unknownValue | $10,500.03 | **$10,500.03** | $0.00 | S14+S15 |
| grossEligible | — | $51,650.70 | — | identity check, not decoded |

Cohorts matched exactly: stalled **16 = 16**, undetermined **1 = 1**, reference **239 = 239**, accepted
cycles 256.

### 3 · Capability coverage — how much real revenue leakage can this product see *at all*?

This is the result that the first two do not measure, and the most important one.

| | Classes | Value |
|---|---|---|
| Business leakage classes planted | **11** | **$122,250.66** |
| **Detected by NH** | **3** | **$42,350.66** |
| **Representable, but NOT detected** — a scope decision, not a schema limit | **2** | **$14,800.00** |
| **NOT representable at all** — no column could carry the signal | **6** | **$65,100.00** |
| **Coverage** | **27.3%** | **34.6%** |

**$79,900.00 — 65.4% of planted business leakage — is invisible to this product.** Of that,
**$65,100.00 (53.3% of everything planted)** is invisible because the data contract declares no column
that could carry the signal, and **$14,800.00 (12.1%)** because the one detector that exists does not look
for it.

**Of the six out-of-schema leakage classes, the number NH detected is zero. Six of six.** That is a
measured product gap with named missing columns (§9), not a caveat to be absorbed into "out of
capability".

### Why the first result must be read narrowly

"Precision 1.000, recall 1.000" is true and flattering. It measures whether NH correctly applies *its own*
definition of a stalled cycle, which the ground-truth manifest encoded. It is **not** evidence that the
definition captures what a revenue operator would call leakage — result 3 is the measurement of that, and
it says the surface is narrow. **High precision on a narrow surface is still a narrow surface.**

## 1 · The freeze, and blind scoring

**The freeze is enforced, not promised.** `FROZEN.json` was written before any NH run and covers:

* the bytes of all three datasets (`dataset.csv` 271 rows `sha256 214bae69…`, `spot-multicurrency.csv`
  238 rows `3643b552…`, `spot-cancelled-after-asof.csv` 238 rows `d7e3d65f…`)
* the ground-truth manifest (`323f13b2…`) and the prediction (`db6764c8…`)
* **all five script hashes** — `generate.mjs`, `verify.mjs`, `run.mjs`, `score.mjs`, `browser-confirm.mjs`
* the **git commit** the scripts were frozen against (`117ded4d`)
* the **run parameters, explicitly**: `asOf 2026-06-30`, `stallThresholdDays 30`, `currency USD`, seed
  `20260926`, declared provenance window `2026-01-01 … 2026-07-31`, and **both admission bars in full**
  (permissive `maxRejectionRate 0.10`; strict `0.01`, recorded in advance as an expected refusal)
* a `compositeSha256` over that whole record, so editing `FROZEN.json` itself is detected

`run.mjs` and `score.mjs` each verify it and **exit non-zero rather than proceed** on any mismatch. This
was demonstrated, not assumed: appending a single comment line to `score.mjs` produced

```
FREEZE VIOLATION — refusing to proceed:
  score.mjs changed since the freeze
```

**Blind scoring.** `score.mjs` reads ground truth, the prediction and NH's raw output, and writes exactly
one file — `score.json`. It verifies the freeze *at scoring time* and records the digest it verified into
its own output (`freezeVerifiedAtScoring`: `173714237da63c4b…`, identical to the composite). Had scoring
altered ground truth or the prediction to fit the result, that digest would no longer match and the
scorer would have refused to run at all.

## 2 · Repository capabilities actually found

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

## 3 · Dataset design

Written by an **independent generator** (`scripts/synthetic-validation/generate.mjs`) that imports only
node builtins — asserted mechanically, because the existing `syntheticPilotDataset.ts` shares a module
family with the adapter that reads it, and reusing it would have made agreement meaningless.

Ground truth is recorded in **three** registers, deliberately kept apart:

| Register | What it records | What disagreement means |
|---|---|---|
| `expected_nh_classification` | what NH's documented semantics should do | NH disagreeing is an **implementation defect** |
| `business_expectation` | what an operator would say is leaking, from the narrative | NH disagreeing while matching the first is a **capability or semantics gap** |
| `business_leakage_minor` + `representable` + `nh_can_detect` | the same operator judgement as a **number**, per class | this is what makes result 3 a metric rather than prose |

The third register is what the earlier version of this report was missing, and it is why the headline
conclusion changed. The registers genuinely diverge — S09 is one cent outstanding, which NH correctly
counts in `partialOutstanding` ($0.05) and which the business register records as **$0.00**, because one
cent is not commercially meaningful leakage. That divergence is the point, not a defect.

**Reconciliation from an aggregate.** NH emits nothing per entity, so each scenario's contribution
carries a distinct power-of-two **cent tag** within its bucket (sums ≤ 63, never carrying into dollars);
every other row ends in `.00`. Decodability was proven by exhaustive subset enumeration before freezing —
every decode in result 2 reports `candidates: 1`.

## 4 · Counts

| | |
|---|---|
| Rows, main dataset | 271 (256 accepted · 15 rejected) |
| Entities | 130 |
| Scenarios | 43 (35 reconciled: 15 true positive · 6 true negative · 14 excluded-row) |
| Period | 2026-01-01 … 2026-07-31 (`asOf` 2026-06-30, stall threshold 30 days, USD) |
| Seed | 20260926, deterministic |
| Spot datasets | 2 × 238 rows (shared healthy base, one scenario each) |

## 5 · Planted taxonomy

**In capability** — 6 headline scenarios (never activated, activated late, one day past the bar,
activation after the cut-off, explicit unpaid boolean, dimensional variation) · 3 partial payments
including a one-cent remainder · 4 terminal states (cancelled, refunded, status-expressed, boolean) ·
2 unresolvable payment-evidence cases · 1 stalled-but-paid-late · 5 near misses · 14 row-level defect
classes · 236 healthy control cycles across 96 entities with 2–3 cycles each.

**Out of capability** — 6 classes, each recorded with the specific columns that do not exist. No rows
exist for these, so no detector was given a chance at them, and their value is **never** summed with
in-dataset leakage. It is reported as its own register in §9.

## 6 · Execution path used

Real HTTP API, real leased worker, fresh PostgreSQL 16. Four governed runs:

| Run | Admission | Result |
|---|---|---|
| permissive / main | **ADMISSIBLE** (271 → 256 accepted / 15 rejected) | scheduled, execution `completed`, finding produced |
| permissive / spot-multicurrency | **NOT_ASSESSABLE**, `NH-DC-1006`, `acceptedRows 0` | schedule refused `NH-AX-1001` — no figure at all, as predicted |
| permissive / spot-cancelled-after-asof | **ADMISSIBLE** (238 / 238 accepted) | execution `completed`, $6,700.00 in the headline, variance $0.00 |
| strict / main | **NOT_ADMISSIBLE** | schedule refused `NH-AX-1003` — the adversarial control, stated in advance |

Then **one browser pass** on the main dataset: 7/7 checks, including that the governed observation panel
— which renders only from a server finding, never from the browser's local preview — shows `$31,650.63`,
the same figure the API reported.

The admission bar was written into the prediction **before** the run and never retuned after seeing a
result.

## 7 · Row-level defect behaviour

Every planted defect produced exactly its expected code: `NH-DC-2002, 2005, 2006×2, 2009, 2010, 2011,
2012×2, 2013, 2014, 2016×2, 2018, 2021, 4001` — 15 rejected rows from 14 scenarios, the duplicate pair
correctly yielding **both** rows excluded plus the identical-row code, per the 2026-09-25 collision rule.

Boundary behaviour was exact: activated at **signed+30** is *not* stalled; at **signed+31** it is.

## 8 · Findings — what the run actually teaches

**F1 · The headline understates planted leakage by $4,000.08 (11.2%).** Ground-truth in-dataset leakage
is $35,650.71; the figure NH presents is $31,650.63. The difference is `partialOutstanding`, which is
reported *beside* the headline rather than in it. Defensible — a part-paid invoice is not wholly at risk —
but an operator reading only the headline is under-counting, and nothing on screen says so.

**F2 · Two of the five money figures never reach the governed panel.** The execution panel shows
`observedUnpaid`, `grossEligible` and `excludedValue`. `partialOutstanding` ($4,000.08) and
`unknownValue` ($10,500.03) are computed, classified and stored — and absent. **$14,500.11 of classified
money is invisible where the governed figure is shown.** Measured in the browser, not inferred.

**F3 · An unpaid invoice from a customer who activated on time is invisible.** Scenario S18
($9,300.00) lands in the reference cohort and contributes to no total. This is correct for a product
scoped to *activation* leakage and wrong for anything called revenue recovery generally. It is one of the
two **representable but not detected** classes in result 3, and the manifest flags it as an ambiguity
rather than a defect.

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

**F7 · Six of the leakage classes an operator would name cannot be expressed at all, and NH detected
none of them.** $65,100.00 of planted narrative — 53.3% of everything planted — sits outside the
product's reach entirely, because no column can carry usage, renewal, expansion, discount, dunning or
credit-note signal. See §9 for the named columns.

**F8 · Detection ends at an observation.** No candidate is published, no recovery case is created, and
the finding says so itself. *Identify* works end to end on this path; *Fix* and *Prove* are not reachable
from it.

## 9 · The capability gap, per class, with named missing columns

Computed into `score.json.capabilityCoverage`, not written by hand.

| Business leakage class | Planted | Status | Columns that do not exist |
|---|---|---|---|
| `activation_stall_unpaid_invoice` | $31,650.63 | **DETECTED** | — |
| `terminal_state_after_cutoff` | $6,700.00 | **DETECTED** | — |
| `activation_stall_partial_payment` | $4,000.03 | **DETECTED** | — |
| `unpaid_invoice_without_activation_stall` | $9,300.00 | **REPRESENTABLE, NOT DETECTED** | — (a scope decision) |
| `near_miss_exact_threshold` | $5,500.00 | **REPRESENTABLE, NOT DETECTED** | — (a scope decision) |
| `renewal_at_risk` | $24,000.00 | **NOT REPRESENTABLE** | `renewal_date`, `renewal_status`, `contract_end_at` |
| `usage_adoption_decline` | $18,000.00 | **NOT REPRESENTABLE** | `seats_active`, `usage_events`, `feature_adoption_at` |
| `expansion_stalled` | $9,500.00 | **NOT REPRESENTABLE** | `entitled_seats`, `purchased_seats`, `expansion_opportunity_at` |
| `discount_leakage` | $6,200.00 | **NOT REPRESENTABLE** | `list_price`, `discount_pct`, `discount_expires_at` |
| `dunning_failure` | $4,300.00 | **NOT REPRESENTABLE** | `payment_attempts`, `last_attempt_at`, `failure_code` |
| `credit_note_misapplied` | $3,100.00 | **NOT REPRESENTABLE** | `credit_note_id`, `credit_applied_to`, `credit_amount` |

Detected **$42,350.66** · representable-not-detected **$14,800.00** · not representable **$65,100.00** ·
total planted **$122,250.66**.

The not-representable register is kept **separate** from detection accuracy on purpose: no row exists for
any of those six, so none of them is a detection failure. They are a **schema and scope gap**, which is a
different and larger finding.

## 10 · Evidence integrity

Disclosed in full, because a validation that hides its own corrections is not one.

* **The freeze was written before the first run and verified at scoring time**, covering datasets,
  manifest, prediction, all five scripts, the commit and the run parameters (§1). The violation path was
  demonstrated on a deliberately tampered script.
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
* **No production code was changed for this exercise.** Nothing in `src/`, `server/` or `prisma/` was
  touched; the detector, the money partition and the admission bar are exactly as they were.
* **Circularity**: the generator imports nothing from `src/`, asserted mechanically. But
  `expected_nh_classification` was written from reading NH's code, so the exact monetary agreement
  validates arithmetic and implementation consistency — **not** the rightness of the definitions. That is
  precisely why result 3 exists and is scored from a register written from the narrative instead.

## 11 · Stop conditions — methodological only

Stated before the run and honoured: the experiment stops only for **methodological failure**, for an
inability to produce independent ground truth, or if answering a question would require changing
production semantics.

**A poor result is not a stop condition.** NH missing leakage or missing money is the *finding* — not a
reason to halt, to retune the dataset, to soften the bar, or to fix NH mid-experiment. Result 3 is the
case in point: 65.4% of planted leakage invisible is reported as the outcome, at the top, with the same
prominence as the precision figure.

## 12 · Reproducibility

**Yes.** Deleting the datasets and re-running the generator reproduces byte-identical files
(`dataset.csv sha256 214bae69…`). Fixed seed 20260926; all temporal values absolute; no clock read.

**The artifacts themselves are not committed** — `e2e/fixtures/` is gitignored. What is committed is the
five scripts, which regenerate every artifact from the recorded seed and parameters, plus this report,
which therefore carries every figure in full. `FROZEN.json` records the commit the scripts were frozen
against; the scripts are committed byte-for-byte as frozen, so the freeze still verifies against them.

```
node scripts/synthetic-validation/generate.mjs        # datasets + ground truth
node scripts/synthetic-validation/verify.mjs          # independence, decodability, prediction, FREEZE
DATABASE_URL=… node scripts/synthetic-validation/run.mjs             # four governed runs (freeze-gated)
node scripts/synthetic-validation/score.mjs           # reconciliation and metrics (freeze-gated)
DATABASE_URL=… node scripts/synthetic-validation/browser-confirm.mjs # the operator's screen
```

## 13 · What must be improved next, on this evidence

1. **Close, or consciously accept, the 65.4% invisibility** (result 3, F7). Six leakage classes an
   operator would name cannot be expressed in the contract at all. This is the largest measured product
   gap in the exercise and it is a roadmap decision, not a code one.
2. **Decide whether unpaid-without-stall is in scope** (F3). $9,300.00 of the $14,800.00 that is
   representable-but-not-detected is this single question.
3. **Show the whole partition where the figure is shown** (F1, F2). $14,500.11 classified and invisible,
   and a headline that under-counts planted leakage by 11%, are presentation problems with a monetary
   size.
4. **Reconsider whole-file rejection on mixed currency** (F4) — or say so loudly in the intake kit, since
   one row costs the entire assessment.
5. **Per-entity output.** Reconciling an aggregate required a cent-tagging scheme. A customer asking
   "which accounts?" cannot be answered by this finding at all.
6. **The path stops at Identify** (F8). Nothing here contradicts the constitution's warning about
   shipping a detection product; it measures exactly how far from the complete loop this path is.

## Claim boundary, restated

Synthetic Ground-Truth Leakage is planted. Detected Revenue Opportunity is what NH computed. Neither is
Recovered Revenue and neither is Proven Revenue Returned — no collection happened, no proof standard was
satisfied, and no recovery case exists. Detection accuracy, monetary accuracy and capability coverage are
three separate results and must not be combined into a single figure.
