# Synthetic end-to-end revenue-leakage validation — 2026-09-27 (cycle 2, governed contract 2.0.0)

The second validation cycle. The first one
([`SYNTHETIC_VALIDATION_2026-09-26.md`](SYNTHETIC_VALIDATION_2026-09-26.md)) measured the system at
`117ded4d`, **before** the assessment policy was governed and before the submission identity changed. Its
five scripts send a `policy` object the transport no longer accepts, so they cannot run against today's
server at all. That report stands exactly as written; **nothing in it was edited, re-frozen, reinterpreted
or replaced.** This one stands beside it.

What is measured here is the system at `5478a7d8`: EP-26/26b (the governed AssessmentPolicy), EP-27 (§10's
two-major window) and EP-28 (the C3 submission identity, contract **2.0.0**).

## Claim boundary — read this first

**Nothing here is recovered money and nothing here is proven returned revenue.** The planted figures are
*Synthetic Ground-Truth Leakage*. What NH computes is *Detected Revenue Opportunity*. No collection
occurred, no proof standard was satisfied, no recovery case exists, and no Revenue Returned figure — proven
or auditable — is produced or implied anywhere in this document. The three results below are reported
**separately** and must never be combined into one number.

---

## Executive result

**The governed path computes exactly what the ungoverned path computed, to the cent, on every common run.**
Four runs are directly comparable with cycle 1, and all four reproduced every figure identically: cohorts,
all four money buckets, `grossEligible`, detection counts, admission outcomes and refusal codes. Because the
methodology was deliberately held fixed — same seed, byte-identical datasets, byte-identical prediction — that
identity is attributable to the **product**, not to a new sample.

**Two new things were measured, and one of them is a finding.**

* The submission identity change (EP-28) works on the real path: renaming a file no longer buys a second
  assessment, and the same bytes under a different governed definition are correctly a *new* submission.
* **The governed re-reading route is blocked by the fitness bar in the obvious case.** Re-reading the same
  extract under a later cut-off was admitted as a new submission — and then refused by the admission bar with
  `NH-AG-2007`, because moving the cut-off forward a month emptied the `undetermined` lifecycle state the bar
  requires. ~~The route the constitution decision explicitly permits therefore does not complete end to end
  under a bar that requires all three lifecycle states.~~ **This is reported, not repaired.** No threshold,
  policy, bar or expected value was adjusted after seeing it.

  > **⚠ CORRECTED 2026-09-27 — see §10 for the full correction and
  > [`ADMISSION_TERMS_COUPLING.md`](ADMISSION_TERMS_COUPLING.md) for the investigation.** The refusal above is
  > real and reproducible, but the bar that caused it was written by **this experiment** and by nothing else
  > in the repository. Under the bar the product itself uses, the same re-reading is admitted and its
  > execution **completes**. **The route does complete end to end.** What is actually wrong is a latent
  > configuration trap and an undocumented invariant, not a blocked route.

**And the capability gap is unchanged: 65.4% of planted business leakage remains invisible to this product.**
Nothing in EP-26, EP-27 or EP-28 widened the detection surface, and nothing in them was supposed to. Four
slices of governance work moved the trust properties and left the coverage exactly where cycle 1 found it.

---

## 1 · Freeze identity and hashes

### This cycle's freeze

New directory `scripts/synthetic-validation-2026-09-27/`, new artifacts
`e2e/fixtures/synthetic-validation-2026-09-27/`, new report. The originals were never opened for writing.

| | |
|---|---|
| Composite digest (authoritative) | **`c042f004d8a7300ea039fafc0b3e4d8ca5dce939cc25588deebae9d7838bc018`** |
| `gitHead` frozen against | `5478a7d8279a605d366d037fa99dfe799972f396` |
| Ground truth | `6de2135a28fc8d102574d5ce45b8aa12e3fc4e4612dae9b46853fe5d1a019f6a` |
| Prediction | `6edcf862018f14698099cbaa060746079a800e24b564c7397872a13abd613954` |
| `dataset.csv` · 271 rows | `214bae693372fbda3f7fff6e0635018b74811db27fa1219831da51fd8568240d` |
| `spot-multicurrency.csv` · 238 rows | `3643b5528959c1c01b4a9447035ad173f6545ca9a5de75bf5866b382320a6009` |
| `spot-cancelled-after-asof.csv` · 238 rows | `d7e3d65f698fd0f1dc32caa71054fcd2389cd4baa4a458e762dac4c95b8eae1c` |

Script hashes inside the freeze:

| Script | sha256 |
|---|---|
| `generate.mjs` | `6f4853c0378334c61ca3145d5d7c623abe9380755d87667b1df091c4baef0b37` |
| `verify.mjs` | `ebeda2aa84797f884726614bca008978846e7353135fff7857b8416767dbfbbb` |
| `run.mjs` | `77d309880a2eaa87f8cda762d68f6b38ad0a190f2ea94ba963063226b90a11ce` |
| `score.mjs` | `e50e2c1ed69b584aef79bc83cff90644aaf001c1eb52c994693b0d328917879a` |
| `browser-confirm.mjs` | `1207d2414143c01de0c38938a530c3c26c3998c87cbe2767af66a025dfb352b5` |

The freeze also covers, explicitly: `asOf 2026-06-30`, `stallThresholdDays 30`, `currency USD`, seed
`20260926`, the declared provenance window `2026-01-01 … 2026-07-31`, **both admission bars in full**, and —
new in this cycle — **both governed AssessmentPolicy versions**, the **declared contract version** (`2.0.0`)
and the **stated expectation for each of the two identity-semantics runs**, so neither could be invented
afterwards.

### The freeze gate was demonstrated, not asserted

Appending one comment line to `score.mjs` and invoking the runner produced:

```
FREEZE VIOLATION — refusing to proceed:
  score.mjs changed since the freeze
```

`run.mjs` and `score.mjs` each verify the composite and exit non-zero rather than proceed. `score.json`
records the digest it verified at scoring time (`freezeVerifiedAtScoring`), identical to the composite — so
had scoring edited ground truth or the prediction to fit a result, the scorer would have refused to run.

### Three freezes, and why — stated rather than buried

This cycle was frozen **three times**, and each re-freeze must be accounted for or the freeze means nothing.

| Freeze | Composite | Why it was superseded |
|---|---|---|
| #1 | `b62018814d2d3931…` | `score.mjs` read the governance response's definition under a key that does not exist (`g.terms`), so the report would have printed `asOf=?`. A display defect in the scorer. |
| #2 | `f2791d6583ba706a…` | `browser-confirm.mjs` still filled an `Analysis as-of date` field that EP-26b removed from the upload screen, so it could not run. |
| **#3 (authoritative)** | **`c042f004d8a7300e…`** | — |

**What makes those re-freezes legitimate is that the expectations never moved, and that is checkable rather
than promised:** `groundTruthSha256` is `6de2135a…` and `predictionSha256` is `6edcf862…` in **all three**
freeze records. No threshold, bar, cohort, amount or verdict changed — only two scripts that read a response
shape and a screen wrongly. **Each re-freeze was followed by a complete re-run on a brand-new database**
(`nh_sv5_test`, `nh_sv6_test`, `nh_sv7_test`, each from `prisma migrate deploy`), so the authoritative freeze
precedes the run it scores, exactly as the first cycle's did. All figures below come from the third run, and
the first two produced the same numbers.

### The previous cycle's freeze, verified before and after

| | |
|---|---|
| Composite | `173714237da63c4b3826f74239a2a18c6e03301a64b0687188a5909bacdfbdc9` |
| `gitHead` | `117ded4da6a42323e241600e4693326c9a0d84de` · frozen `2026-09-26T14:19:22.321Z` |
| Ground truth · prediction | `323f13b2…` · `db6764c8…` |
| State, checked before this cycle began and again after it finished | **INTACT — every covered artifact matches** |

`git status` shows no modification under `scripts/synthetic-validation/` at any point. As in cycle 1, the
artifact directory is covered by `.gitignore` (`e2e/fixtures/`), so the durable record of both cycles is the
scripts plus the digests printed in these two reports.

---

## 2 · The methodology was held fixed on purpose

A second run with a new seed would have confounded two questions: *did the product change?* and *did the
sample change?* So the sample did not change.

* `generate.mjs` was copied and differs from the frozen original in **exactly two lines**, both output-path
  strings (`diff` shows nothing else). It still imports node builtins only — mechanically asserted by
  `verify.mjs`, which also asserts it references no product module. **Anti-circularity is preserved by
  construction:** the generator and the ground-truth logic know nothing about NH's detector or assessment
  code.
* Seed unchanged: `20260926`.
* **All three dataset CSVs came out byte-identical** to the frozen originals — `cmp` clean, and the sha256s in
  §1 are the same values cycle 1 recorded.
* `ground-truth.json` differs from the original in **one field**: the `generator` provenance label now names
  the new path. Every scenario, amount, cent tag, register and expectation is identical.
* The prediction was rebuilt from ground truth alone, before the run, by the same code.

That is what licenses attributing any difference in NH's answer to the governed path.

---

## 3 · Dataset size and composition

| | |
|---|---|
| Rows, main dataset | **271** (256 accepted · 15 rejected) |
| Entities | 130 (116 distinct entities across the accepted rows) |
| Scenarios | **43** — 35 reconciled on the main dataset (15 true positive · 6 true negative · 14 excluded-row) |
| Spot datasets | 2 × 238 rows, shared healthy base, one scenario each |
| Period | `2026-01-01 … 2026-07-31`, `asOf 2026-06-30`, stall threshold 30 days, USD |
| Seed | `20260926`, deterministic |
| Declared contract version | **`2.0.0`** (cycle 1 declared `1.1.0`) |

---

## 4 · Planted leakage by class and amount, against what NH detected

The independent business register (`business_leakage_minor`), written from the narratives and never from NH's
semantics. **Every class is listed; nothing disappears into "out of capability".**

| Synthetic Ground-Truth Leakage | Class | Scen. | Status |
|---|---|---|---|
| **$31,650.63** | `activation_stall_unpaid_invoice` | 6 | **DETECTED** |
| $24,000.00 | `renewal_at_risk` | 1 | NOT REPRESENTABLE |
| $18,000.00 | `usage_adoption_decline` | 1 | NOT REPRESENTABLE |
| $9,500.00 | `expansion_stalled` | 1 | NOT REPRESENTABLE |
| $9,300.00 | `unpaid_invoice_without_activation_stall` | 1 | REPRESENTABLE, NOT DETECTED |
| **$6,700.00** | `terminal_state_after_cutoff` | 1 | **DETECTED** |
| $6,200.00 | `discount_leakage` | 1 | NOT REPRESENTABLE |
| $5,500.00 | `near_miss_exact_threshold` | 1 | REPRESENTABLE, NOT DETECTED |
| $4,300.00 | `dunning_failure` | 1 | NOT REPRESENTABLE |
| **$4,000.03** | `activation_stall_partial_payment` | 3 | **DETECTED** |
| $3,100.00 | `credit_note_misapplied` | 1 | NOT REPRESENTABLE |

| | Classes | Value |
|---|---|---|
| Planted | **11** | **$122,250.66** |
| **Detected by NH** | 3 | **$42,350.66** |
| Representable, not detected | 2 | **$14,800.00** |
| Not representable at all | 6 | **$65,100.00** |
| **Coverage** | **27.3%** | **34.6%** |

**Total invisible leakage: $79,900.00 — 65.4% of everything planted.** Of that, **$65,100.00 (53.3% of the
total)** is invisible because no column could carry the signal, and **$14,800.00 (12.1%)** because the single
detector that exists does not look for it.

**Of the six out-of-schema classes, NH detected zero. Six of six.**

### The missing columns, named

Per rule 12, each non-representable class is reported with the specific signal the contract does not declare —
not absorbed into a category.

| Class | Value | Columns the contract does not declare |
|---|---|---|
| `renewal_at_risk` | $24,000.00 | `renewal_date`, `renewal_status`, `contract_end_at` |
| `usage_adoption_decline` | $18,000.00 | `seats_active`, `usage_events`, `feature_adoption_at` |
| `expansion_stalled` | $9,500.00 | `entitled_seats`, `purchased_seats`, `expansion_opportunity_at` |
| `discount_leakage` | $6,200.00 | `list_price`, `discount_pct`, `discount_expires_at` |
| `dunning_failure` | $4,300.00 | `payment_attempts`, `last_attempt_at`, `failure_code` |
| `credit_note_misapplied` | $3,100.00 | `credit_note_id`, `credit_applied_to`, `credit_amount` |

No rows exist for any of these, so none is a detection failure and none is counted against recall. They are a
**capability** measurement, kept in their own register (`$65,100.00`) and never summed with in-dataset leakage.

The two **representable-but-undetected** classes are a different thing and must not be confused with the
above: the schema carries the signal and the product does not look. `unpaid_invoice_without_activation_stall`
($9,300.00) is an unpaid obligation with no activation stall, which the one detector has no rule for;
`near_miss_exact_threshold` ($5,500.00) sits exactly on the stall boundary, which the documented `>` semantics
correctly excludes and an operator would still want to see. **A scope decision, not a schema limit.**

---

## 5 · Detection accuracy — false positives and false negatives

| | Main dataset | spot-cancelled-after-asof |
|---|---|---|
| True positives | **15** | **1** |
| **False negatives** | **0** | **0** |
| Misplaced (right cohort, wrong bucket) | **0** | **0** |
| **False positives** | **0** | **0** |
| Control rows producing nothing | 240 | 237 |
| **Precision · Recall** | **1.000 · 1.000** | **1.000 · 1.000** |

A false positive would surface as a stalled count above the prediction, since the stalled cohort is fully
accounted for by planted scenarios; the surplus was zero. A false negative would surface as a money bucket
whose decode omits a scenario that should have contributed; none did.

**Read this narrowly.** It measures whether NH correctly applies *its own* definition of a stalled cycle over
the surface it can see. It is **not** evidence that the definition captures what a revenue operator would call
leakage — §4 is the measurement of that, and it says the surface is narrow. High precision on a narrow surface
is still a narrow surface. Precision and recall are also **not** meaningful for the non-representable classes
and are not computed over them: no row exists, so no detector was given a chance.

---

## 6 · Monetary accuracy — to the cent

| Bucket | Predicted | NH | Variance | Decoded contributors | Candidates |
|---|---|---|---|---|---|
| `observedUnpaid` | $31,650.63 | **$31,650.63** | **$0.00** | S01+S02+S03+S04+S05+S06 | 1 |
| `partialOutstanding` | $4,000.08 | **$4,000.08** | **$0.00** | S07+S08+S09 | 1 |
| `excludedValue` | $8,490.15 | **$8,490.15** | **$0.00** | S10+S11+S12+S13 | 1 |
| `unknownValue` | $10,500.03 | **$10,500.03** | **$0.00** | S14+S15 | 1 |
| `grossEligible` | — | $51,650.70 | — | identity check, not decoded | — |

Cohorts matched exactly: stalled **16 = 16**, undetermined **1 = 1**, reference **239 = 239**, accepted cycles
**256**.

| | |
|---|---|
| Ground-truth leakage in dataset | **$35,650.71** |
| NH's headline (*Detected Revenue Opportunity*) | **$31,650.63** |
| Headline + partial remainder reported beside it | **$35,650.71** |
| **Variance vs ground truth** | **$0.00** |

`spot-cancelled-after-asof`: $6,700.00 predicted, $6,700.00 observed, variance **$0.00**, decode `S20`, one
candidate.

---

## 7 · Reconciliation — no aggregate money is reported that cannot be traced

NH emits **nothing per entity**. So each scenario's contribution carries a distinct power-of-two **cent tag**
within its bucket (sums ≤ 63, never carrying into dollars), and every other row ends in `.00`. Decodability
was proved by exhaustive subset enumeration **before** the freeze: 64, 8, 16 and 4 subsets respectively, each
summing uniquely. `verify.mjs` also reads every tag back out of the CSV bytes and asserts no untagged row
carries non-zero cents.

Every bucket total in §6 therefore decodes to exactly one subset of planted scenarios — `candidates: 1` in all
four cases. The full per-scenario table is in
`e2e/fixtures/synthetic-validation-2026-09-27/score.json` → `datasets[].reconciliation`; each of the 35
reconciled scenarios on the main dataset carries its classification:

| Scenarios | Classification |
|---|---|
| S01–S06 | TRUE POSITIVE → `observedUnpaid` |
| S07–S09 | TRUE POSITIVE → `partialOutstanding` (S09 is a **one-cent** remainder, correctly counted) |
| S10–S13 | TRUE POSITIVE → `excludedValue` |
| S14–S15 | TRUE POSITIVE → `unknownValue` |
| S16–S19, S21, S37 | TRUE NEGATIVE — expected to contribute nothing, contributed nothing |
| S23–S36 | EXCLUDED ROW — verified from the rejected-row count and codes, never from a money total |

S09 is the deliberate divergence between the registers: NH counts $0.05 in `partialOutstanding` and is
**right** to; the business register records $0.00, because one cent is not commercially meaningful leakage.
That is the two registers doing their job, not a defect.

---

## 8 · Admission and exclusion results, per run

Real HTTP API, real leased worker, fresh PostgreSQL 16 via `prisma migrate deploy`. **Six runs** this cycle.

| Run | Boundary | Definition read under | Admission | Result |
|---|---|---|---|---|
| 1 · permissive / main | A | `sv-assessment-policy@1.0.0` (`asOf` 2026-06-30) | **ADMISSIBLE** 271→256/15 | scheduled, `completed`, finding produced |
| 2 · permissive / spot-multicurrency | A | 1.0.0 | **NOT_ASSESSABLE** `NH-DC-1006`, `acceptedRows 0` | schedule refused `NH-AX-1001` — no figure at all, as predicted |
| 3 · permissive / spot-cancelled-after-asof | A | 1.0.0 | **ADMISSIBLE** 238/238 | `completed`, $6,700.00, variance $0.00 |
| 4 · strict / main | B | 1.0.0 | **NOT_ADMISSIBLE** `NH-AG-2003` | schedule refused `NH-AX-1003` — adversarial control, stated in advance |
| 5 · re-read / main @ later cut-off | A | `sv-assessment-policy@2.0.0` (`asOf` 2026-07-31) | **NOT_ADMISSIBLE** `NH-AG-2007` | admitted as a **new submission**, then refused by the bar — see §10 |
| 6 · duplicate control / main, renamed | A | 1.0.0 | **refused at intake, 409 `NH-DC-4003`** | as predicted — see §9 |

### Row-level exclusions

15 rejected rows from 14 planted defect scenarios, each producing exactly its expected code:

```
NH-DC-2002, 2005, 2006×2, 2009, 2010, 2011, 2012×2, 2013, 2014, 2016×2, 2018, 2021, 4001
```

The duplicate pair correctly yields **both** rows excluded plus the identical-row code, per the 2026-09-25
collision rule — the file author cannot choose which row survives by reordering. Rates observed:
rejection `0.0554`, duplicate `0.0074`, ordering defect `0.0111`, largest single reason share `0.125`. Under
the permissive bar (`maxRejectionRate 0.10`) all pass; under the strict bar (`0.01`) the rejection rate is the
single breach, which is what makes run 4 a control rather than a failure.

### Governance — who decided what the assessment measures

Read back from `/pilot/analysis-terms/governance`, not asserted by the harness:

| Definition | State | Values | Hash | Proposed by | Activated by | SoD |
|---|---|---|---|---|---|---|
| `sv-assessment-policy@1.0.0` in A | ACTIVE | `asOf 2026-06-30`, N=30, USD | `sha256:7cd45818…` | `sv-operator@company` | `sv-governance@company` | **HELD** |
| `sv-assessment-policy@1.0.0` in B | ACTIVE | same | `sha256:7cd45818…` | `sv-operator@company` | `sv-governance@company` | **HELD** |
| `sv-assessment-policy@2.0.0` in A | ACTIVE | `asOf 2026-07-31`, N=30, USD | `sha256:31922e17…` | `sv-operator@company` | `sv-governance@company` | **HELD** |

`calculationMethodVersion` came back as `assess-2026.1-thin` on all three — a build constant the request
cannot state. It **remains explicitly open and out of the submission identity**; nothing in this cycle
changed that or depends on it.

The scorer cross-checks the two halves twice: from the event log and from the record's own
`proposedBy`/`activatedBy` summary fields. `eventsAgreeWithSummary: true` on all three — two independent
statements of the same fact, and a disagreement would itself have been the finding.

### Browser confirmation — 10/10

One pass through the real UI on the main dataset:

* the fitness bar is ACTIVE before any data exists;
* **the definition is ACTIVE before any data exists, activated by a second identity** — read from the
  server's own comparison, not from a button label;
* **the upload screen offers no way to type a cut-off, a stall threshold or a currency** (asserted as an
  *absence*: the lever is gone, not merely guarded);
* the operator **cites** a governed definition from a menu (`sv-assessment-policy@1.0.0`);
* the dataset is admitted through the UI and the governed execution completes;
* the governed observation panel — which renders **only** from a server finding, never from the browser's
  local preview — shows **`$31,650.63`**, the same figure the API reported, labelled *Revenue Opportunity* and
  denying money returned;
* the panel omits `partialOutstanding` and `unknownValue`, reported as a coverage observation about the
  screen, not a pass/fail of NH.

---

## 9 · Submission identity (EP-28), measured on the real path

Both expectations were written into `prediction.json` **before** the run.

### The keys, as the server issued them

| Run | Boundary | Fingerprint | Governed definition | Submission identity |
|---|---|---|---|---|
| 1 · permissive / main | A | `214bae69…` | 1.0.0 | `pds_da0b9238…` |
| 4 · strict / main | **B** | `214bae69…` | 1.0.0 | `pds_4467b62b…` |
| 5 · re-read / main | A | `214bae69…` | **2.0.0** | **`pds_2463cbbc…`** |
| 6 · duplicate control | A | `214bae69…` | 1.0.0 | **none issued — refused** |

Run 5 against run 1 is the measurement that matters: **identical bytes, identical boundary, identical
adapter options — and a different identity, because the governed definition differs.** Run 6 against run 1 is
its negative half: identical in every one of those, differing only in the operator-typed `datasetId`, and
refused.

### Run 6 — the duplicate control: **AS PREDICTED**

`409 NH-DC-4003`. The same bytes, the same boundary, the same governed definition and a **different
operator-typed `datasetId`** were refused at intake. Under contract 1.x that label *was* part of the identity,
so renaming the export bought a second assessment; under 2.0.0 it is out, and it does not.

One detail worth stating rather than leaving in the raw output: the subsequent schedule call returned **`200`
with the execution id `PAX-c4372537…` — the *same* execution as run 1**, not a new one. So a renamed
re-submission gets the operator neither a second submission nor a second execution nor a second proof object:
they are handed back the execution that already exists, computed under the definition that already applies.
That is the correct behaviour and it is measured here, not assumed.

### Run 5 — the governed re-reading: **PARTIAL**, and the cause is established

The pre-registered expectation was: *accepted (not `NH-DC-4003`), a second admission decision, and a second
execution id, with the first execution unchanged.*

What happened: **accepted** — upload `200`, a distinct identity `pds_2463cbbc…`, its own admission decision.
Then the fitness bar refused it, `NH-AG-2007`, detail:

```
Lifecycle coverage — undetermined: 0 undetermined cycle(s) present
```

and the schedule was consequently refused `NH-AX-1003`. **No second execution id was produced**, so the
expectation is scored PARTIAL rather than met, and the gap is §10.

Money was **not** scored for this run, and that limit was declared before the run rather than discovered
afterwards: the frozen prediction is derived under `asOf 2026-06-30` only, and re-deriving it under a later
cut-off would mean re-implementing the stall rule inside the scorer — new methodology, written after seeing
the shape of the answer, in the one file that has to stay blind.

---

## 10 · The finding: the governed re-reading route is blocked by the fitness bar

**What the constitution decided.** `ANALYSIS_TERMS_GOVERNANCE.md` deliberately does *not* copy the admission
bar's `activatedAt > firstSeenAt` anti-tuning rule to the analysis terms, precisely so that asking *"and how
does this look as of a later date?"* stays possible — otherwise an operator is pushed into editing the export,
changing data in order to ask a question about time. EP-28 then put the governed definition inside the
submission identity, which is what makes such a re-reading a new submission rather than a duplicate.

**What the measurement shows.** Both of those work. The re-reading is admitted as a new submission with its
own identity and its own admission decision. But the **fitness** bar then refuses it, because the same act of
moving the cut-off forward one month resolved the single planted `undetermined` cycle, and the bar requires
`stalled`, `reference` **and** `undetermined` to be present among the accepted rows.

**Why this is a real finding and not an artifact of the dataset.** ~~It is *sharpened* by the dataset having
exactly one undetermined cycle, but the mechanism is general: `undetermined` means "the deadline has not yet
been reached at the cut-off", so a later cut-off systematically **empties** that state. Any bar that requires
`undetermined` will refuse a sufficiently late re-reading of any extract.~~ The two governed objects interact
in a way neither was designed against: the definition of *when* is governed independently of the bar that
requires evidence of *not yet*.

> **⚠ STRUCK 2026-09-27, and struck rather than reworded.** The sentences above are half right, and the half
> that is wrong is the conclusion. The **mechanism** is general — proved from `cohort.ts:33-46`, where
> `undetermined` is monotone non-increasing in `asOf` and empty once `asOf ≥ max(expectationAt) + N` — and
> that part stands. But **generality of a mechanism is not exposure of a product**, and this paragraph let the
> one slide into the other. **Nothing in the product requires `undetermined`:** `SCENARIO_POLICY`
> (`syntheticPilotDataset.ts:269`), the rehearsal agent (`pilotAssessmentRehearsal.ts:166`) and every server
> and contract test bar use `["stalled", "reference"]` — the bar that produced this refusal was written by
> **this experiment** (`verify.mjs:160,167`) and by nothing else.
>
> Measured afterwards on a fresh database, with the expectation stated first: under the product's own bar the
> same re-reading is **ADMISSIBLE**, is scheduled, and its execution **completes with a finding** (stalled 17,
> undetermined 0, `observedUnpaid` $35,750.63 — a $4,100.00 delta traced to scenario **S19** alone). **So the
> governed re-reading route does complete end to end**, and the sentence below it — *"the route the
> constitution decision explicitly permits therefore does not complete end to end"* — is withdrawn as a
> statement about the product. It remains true of a bar that requires all three states.
>
> What survives, and is the part worth keeping, is stated properly in
> [`ADMISSION_TERMS_COUPLING.md`](ADMISSION_TERMS_COUPLING.md): **an admission verdict is a property of
> `(extract, governed terms)`, never of the extract alone**, so every lifecycle-coverage requirement is
> terms-relative — symmetrically, a bar requiring `stalled` breaks under a sufficiently *early* cut-off. The
> residual defect is a latent **configuration trap**, not a blocked route. The anti-tuning rule was also
> confirmed to hold across a re-reading, by execution: **no lever exists.**
>
> **No measured figure in this report changed**, and neither freeze was touched. This sharpens an
> overstatement; it withdraws no measurement.

**What was deliberately not done.** The bar's `requiredLifecycleStates` was **not** relaxed, the cut-off was
**not** moved closer, the dataset was **not** given a second undetermined cycle, and the expectation was
**not** rewritten. Any of those would have been tuning after seeing output. The finding ships as it is.

**What it is not.** It is not a Trust Invariant breach — nothing let a beneficiary influence a number, and the
refusal is conservative: the system declined to measure rather than measuring under an unfit population. It
does not invalidate EP-26, EP-27 or EP-28, all of which behaved as specified. **It is a product decision that
does not yet exist**, and it belongs in the constitution before any code: *what should the fitness bar require
of a re-reading whose lifecycle mix the governed cut-off itself changed?* Candidate answers — a bar that
scopes `requiredLifecycleStates` to the original reading, a bar version paired with a terms version, or an
explicit "re-reading" admission mode — all change what admission *means* and are therefore not an
implementation detail. **Not decided here.**

---

## 11 · Comparison with the previous frozen validation

Rule 10: distinguish product change from methodology change, and claim no improvement the evidence does not
support.

### Methodology: deliberately unchanged

Same generator logic (two path strings differ), same seed, **byte-identical dataset CSVs**, ground truth
identical but for one provenance label, identical prediction digest across all three freezes of this cycle.
Same scoring logic, same cent-tag reconciliation, same three separated results. The scorer gained a
governance read-back and an identity-semantics section; **no scoring rule, threshold or expected value
changed.**

### Product: what changed in the path, and what it did to the numbers

| | Cycle 1 · `117ded4` | Cycle 2 · `5478a7d` |
|---|---|---|
| Who states `asOf` / N / `currency` | **the requester**, in the request body | **nobody** — registered, activated by a second identity, cited by reference |
| Declared contract version | `1.1.0` | **`2.0.0`** |
| Submission identity | included the operator-typed `datasetId`; excluded the analysis terms | **excludes `datasetId`; includes the governed terms**; version component narrowed to the **major** |
| Governed re-reading under new terms | did not exist | exists, and is measured (§9, §10) |
| Runs | 4 | **6** |
| Browser checks | 7/7 | **10/10**, incl. two new governance assertions |

### The figures: identical, every one

| | Cycle 1 | Cycle 2 |
|---|---|---|
| Cohorts, main (stalled / undet. / ref. / accepted) | 16 / 1 / 239 / 256 | **16 / 1 / 239 / 256** |
| `observedUnpaid` | $31,650.63 | **$31,650.63** |
| `partialOutstanding` | $4,000.08 | **$4,000.08** |
| `excludedValue` | $8,490.15 | **$8,490.15** |
| `unknownValue` | $10,500.03 | **$10,500.03** |
| `grossEligible` | $51,650.70 | **$51,650.70** |
| Variance vs ground truth | $0.00 | **$0.00** |
| TP / FN / misplaced / FP | 15 / 0 / 0 / 0 | **15 / 0 / 0 / 0** |
| Precision · recall | 1.000 · 1.000 | **1.000 · 1.000** |
| spot-cancelled-after-asof headline | $6,700.00 | **$6,700.00** |
| spot-multicurrency | NOT_ASSESSABLE `NH-DC-1006` | **NOT_ASSESSABLE `NH-DC-1006`** |
| strict / main | NOT_ADMISSIBLE → `NH-AX-1003` | **NOT_ADMISSIBLE → `NH-AX-1003`** |
| Capability: classes / value coverage | 27.3% / 34.6% | **27.3% / 34.6%** |
| Invisible leakage | $79,900.00 · 65.4% | **$79,900.00 · 65.4%** |

### What may and may not be claimed from that

**May be claimed.** Four slices of governance work — the governed AssessmentPolicy, the currency extension,
the two-major compatibility window and the C3 identity with a contract major bump — changed *who decides* and
*how a submission is identified* **without changing what the assessment computes, by a single cent, on any
run.** Since the methodology was held fixed and the datasets are byte-identical, that is attributable to the
product. It is a regression-safety result about a breaking change, and it is the strongest thing this
comparison supports.

**May not be claimed.** Not an improvement in detection, in monetary accuracy or in coverage. Nothing got
better at finding leakage, because nothing in these four slices was about finding leakage. Precision and
recall did not "stay perfect" through any product effort — they are identical because the same detector read
the same bytes under the same definition. And the capability gap is the same gap: **65.4% invisible, six of six
out-of-schema classes undetected.** The trust properties improved; the surface did not move.

**A new limitation, not an improvement (§10).** Cycle 2 measures a route cycle 1 could not: the governed
re-reading. It does not complete end to end. That is a cost of having the route at all, and it is reported as
a finding.

---

## 12 · Capability gaps and contradictions found

1. **§10 — the governed re-reading is blocked by the fitness bar** (`NH-AG-2007`). The one genuinely new
   finding. A product/constitution decision is required and is **not** taken here.
   **⚠ Corrected 2026-09-27:** ~~blocked~~ — the route completes under the product's own bar; the defect is a
   latent **configuration trap** (`undetermined` is requirable, terms-relative, and disowned by the code's own
   rationale) plus an invariant nobody had written down: *an admission verdict is a property of
   `(extract, governed terms)`.* Investigated in [`ADMISSION_TERMS_COUPLING.md`](ADMISSION_TERMS_COUPLING.md);
   the remedy is still **not** chosen.
2. **The detection surface is one rule.** `classifyStall` is the whole detector. `renewal_at_risk`,
   `usage_adoption_decline`, `expansion_stalled`, `discount_leakage`, `dunning_failure` and
   `credit_note_misapplied` — **$65,100.00** — have no column that could carry them (§4). Unchanged from
   cycle 1, and re-measured rather than restated.
3. **Two representable classes are simply not looked for** — $14,800.00. A scope decision.
4. **Fix and Prove remain unreachable from this path.** The finding declares `createsRecoveryCase: false`,
   `constitutesProof: false`, `constitutesRevenue: false`. Detection ends at an immutable observation. Against
   the Build Filter this cycle is **Identify**-side plumbing plus trust, and the loop is still not closed from
   here. That is the standing gap this document must not let recede.
5. **The `LeakageType` taxonomy is still not produced by the pilot path.** The finding carries no leakage type.
6. **No contradiction was found between the two cycles.** Every comparable figure agreed exactly. Nothing in
   cycle 1's report needed correcting, and nothing in it was changed.
7. **A cosmetic defect in the runner's own console output**, inherited from the frozen original and left
   alone: `run.mjs` prints `f.stalledCount` from `execution.body.finding`, one level above where the finding
   actually sits, so its per-run console lines read `stalled=undefined`. The **raw output is complete and the
   scorer reads the correct path**, which is why every figure above is present. Fixing it would have required
   a fourth re-freeze for a log line; recorded here instead.

---

## 13 · Full regression

Recorded in the commit that carries this report. Every gate that guards the product was re-run, not only the
validation: `npm run test` with and without `DATABASE_URL`, `test:ep2`, `check:purity`, `tsc --noEmit`,
`build`, `build:server`, `test:journey`, plus `node --check` on all five new scripts and `git diff --check`.

---

## 14 · What this cycle does and does not establish

**Does.** That the governed path — propose, activate, cite, intake, admission, schedule, worker, finding,
screen — runs end to end on a real API, a real worker and a fresh PostgreSQL; that the definition of what is
measured is chosen by two identities and never by the requester; that renaming a file buys nothing; that the
same bytes under a different governed definition are a different submission; that NH's arithmetic over the
surface it can see is exact to the cent; and that four slices of breaking governance work moved no computed
figure.

**Does not.** Establish recovery, proof, Revenue Returned, auditability or willingness to pay. Establish
anything about real customer data — the dataset is synthetic and was written to be read by this contract.
Establish that the detection surface is adequate; §4 says plainly that it is not. Establish that the governed
re-reading route works end to end; §10 says it does not.

**And, restated because it is the one sentence most easily lost:** no figure anywhere in this document is
recovered money or proven returned revenue. `$31,650.63` is *Detected Revenue Opportunity* on a synthetic
file. Nothing was collected.
