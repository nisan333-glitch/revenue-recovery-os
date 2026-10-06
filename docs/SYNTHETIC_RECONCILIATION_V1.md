# Synthetic reconciliation package · where NH breaks before a customer finds it

**Status:** experiment complete. **No production reconciliation is wired. No Missing Invoice finding
exists. No money here is Revenue Returned.** The package is synthetic throughout.

## 1 · What was built

Two independently-sourced exports that look like real system output, not an abstract fixture:

| | rows | emits |
|---|---|---|
| **contract system** | 614 | `contract_id` · `schedule_line_id` · `entitlement_id` · `account_id` · `payer_account_id` · `parent_account_id` · dated lifecycle · `supersedes_schedule_line_id` |
| **billing system** | 597 | `invoice_id` · `invoice_line_id` · `invoice_number` · `billing_account_id` · `subscription_id` · `legacy_subscription_id` · `source_system` |

60 payers, 119 entitlements, six monthly periods. **43 entitlements left entirely clean** as the noise
the defects hide in; 25 payers carry no planted case at all. 19 mechanisms planted as **cohorts** rather
than one row each — the migration cohort is 28 entitlements cutting over on one date (56 billing rows
under new keys), because a billing migration moves the whole book and reading that as leakage is the
largest false positive this product can produce.

**$85,942.00** of authoritative planted money · 16 priced cases · **3 UNKNOWN** · 3 must-refuse.

Ground truth is recorded twice (`business_expectation` vs `expected_nh_classification`) and frozen with
a composite hash over every artefact **and the generator's own source**, so the experiment cannot be
adjusted after a result is seen. The generator imports only node builtins; the scorer never imports the
product; no product module can read the answer key. All three are asserted by `verify.mjs`.

## 2 · Results · five candidate grains through the unmodified core

| Candidate | Detected | True positive | **False positive** | Recall | Precision | Refusals (unwarranted) |
|---|---|---|---|---|---|---|
| **A** entitlement ↔ subscription | **$0.00** | $0.00 | $0.00 | **0.00%** | null | 107 (**9**) |
| **B** contract identity | — | — | — | — | — | **NOT CONSTRUCTIBLE** |
| **C** schedule-line identity | — | — | — | — | — | **NOT CONSTRUCTIBLE** |
| **D** payer × period | $86,258.30 | $56,858.30 | **$9,800.00** | **66.16%** | 65.92% | 9 (2) |
| **E** A + retained legacy alias | **$0.00** | $0.00 | $0.00 | **0.00%** | null | 51 (**8**) |

## 3 · The findings

### F1 · The unmatched-identity taint is dataset-global, and it collapses recall to zero at scale

**This is the defect the slice was built to find.** Candidates A and E detect **nothing** — $0.00 against
$85,942.00 planted, 0 of 9 detectable mechanisms — on a dataset where missing invoices, under-billing and
partial billing are all plainly present.

The cause is one line in the core:

```
if (residualMinor > 0 && unmatchedEntitlements.size > 0) → REFUSED_UNMATCHED_IDENTITY
```

With 98 unmatched entitlements *anywhere* in the extract, **every** positive residual *everywhere* is
refused. I introduced that guard deliberately in an earlier slice, because an entitlement-scoped taint
missed the re-key case — the unmatched key is the observation's old key while the unbilled unit sits
under the expectation's new one. **The direction was right and the scope is catastrophically wrong.**

It is also not well-founded. An unmatched invoice for payer X in March cannot plausibly settle an
unbilled obligation for payer Y in June, so refusing the second because of the first is not caution — it
is a refusal with no evidence behind it. 9 of A's refusals are unwarranted by the ground truth's own
classification.

**Proposed scope, not implemented here:** taint only units with a non-empty *plausible counterpart* set —
same payer, overlapping or adjacent period within the governed window, comparable amount. A product that
refuses everything is not trustworthy-but-cautious; it is unusable, and 0% recall on a dataset full of
real leakage is the proof.

### F2 · The retained legacy alias fixes the symptom, not the disease

Candidate E supplies 28 authoritative aliases from billing's own retained `legacy_subscription_id`, and
refusals fall 107 → 51. **Recall stays 0.00%**, because the taint is global: the three-entitlement bare
re-key (M14, where no legacy key was retained) is on its own enough to zero the whole dataset.

### F3 · Two of five grains cannot be built at all — and that is the missing-fact proof

A join key must exist on **both** sides. The billing export emits **no contract identity** and **no
reference to the obligation a line settles**: `invoice_line_id` is a position *within* an invoice
(`L1`, `L2`), not a pointer to the schedule line. So contract-grain and schedule-line-grain
reconciliation are not constructible from realistic exports by any adapter, and deriving a key would be
inventing identity.

This demonstrates, rather than asserts, the fact that event reconciliation has been blocked on all
along: **the obligation reference has to be on the billing side.**

### F4 · Payer grain finds money and cannot explain it

Candidate D is the only one that finds anything — and **12 of 19 cases are not individually
attributable**, because a payer-period unit merges every obligation that payer holds in that period. Six
payers carry more than one planted mechanism, so the residual belongs to both cases and to neither.

That is a direct collision with the north star: *every recovered dollar must be explainable*. D answers
"this payer is short $X this month" and cannot say which obligation, which is not a finding anyone can
act on or audit.

> **A grain that cannot attribute a residual to an obligation is not a reconciliation grain. It is an
> aggregate.**

### F5 · A coarse grain fabricates money where a fine one would not

At payer grain a **per-entitlement pause cannot be represented**. `coveredByPause` requires *every*
expectation in the unit to be paused; one paused entitlement among unpaused siblings leaves the unit
expected in full while billing correctly raised nothing for it, producing a shortfall equal to the paused
amount. That is **$12,798.80 of fabricated money** in this dataset — money NH would have reported and no
one owes. It is structural to the grain, not a bug in the pause check.

### F6 · Coarse grain turns the duplicate-masking blind spot into something worse

M07 plants an omission masked by a duplicate. At fine grain it is **invisible** — the money nets to zero
at every grain, which was already known. At payer grain the omission and the duplicate land in one
payer's periods and get **mechanism-paired**, so $19,600.00 of real missing money is held out of the
headline *and attributed to the very duplicate that hid it*. Invisible is bad; confidently mis-explained
is worse.

### F7 · Dataset-level coverage collapses on 9 rows out of 600

`coverage.monetary` reads `REFUSED` for **every** candidate, because a single refused unit sets it — here
nine cross-currency rows. A dataset-level flag that any one row can flip carries no information at scale.
Coverage is already correct per unit; the dataset summary should count, not collapse.

## 4 · Grain verdict · no single identifier survives

Asked for in advance and answered by the data: **no one column covers recurring periods, split billing,
consolidated billing, amendments, renewals, re-keying and migration.** B and C are unbuildable, A and E
are structurally sound but unusable under F1, and D is buildable, usable and unexplainable.

**The proposal is governed semantic roles, separately gated and fail-closed, rather than one universal
key:**

| Role | What it must survive | Where it must exist |
|---|---|---|
| **obligation-group identity** | split, consolidation, renewal | **both** sides — the gap F3 proves |
| **period identity** | agreed boundaries | both sides (already present) |
| **authoritative alias** | migration where the source retained the old key | the side that re-keyed |
| **payer relation** | attribution only — **never** identity | contract side (already present) |

A bare re-key with no retained key is **correctly a refusal**, not a finding: the invoices exist under
another name, and nothing is owed.

## 5 · Structurally invisible money

* **$19,600.00** — the duplicate-masked omission, invisible to every monetary grain, reachable only by an
  event check that F3 shows is not yet constructible.
* **Aggregate rows** — unchanged, and no contract field can promote grain.
* **3 UNKNOWN cases** — unpriceable amount, ambiguous identity, cross-currency. Counted, never valued.

## 6 · Minimum additional source facts, ranked by money unlocked

1. **An obligation reference on the BILLING side.** Closes F3, makes event reconciliation constructible,
   and is the only route to the $19,600.00 of F6. Everything else is secondary.
2. **Per-line entitlement allocation on the invoice**, so consolidation is resolvable without coarsening
   the grain to the payer.
3. **A retained prior key on every re-key**, not only on migrations.
4. Dated lifecycle and the payer hierarchy — **already supplied**, and they work.

## 7 · Recommendation for the first production reconciliation slice

**Fix F1's scope first, as its own slice, before any production reconciliation.** It is the difference
between 0% and any recall at all, it is a change to the core with its own falsifiers, and no grain
decision can be evaluated honestly while a single re-keyed row anywhere refuses the whole dataset.

Then reconcile **only at obligation-group grain, only where a both-sided obligation reference exists**,
and fail closed otherwise. **Do not ship payer-period grain as the money grain** — F4 and F5 show it
fabricates money and cannot explain what it finds, and a number nobody can attribute is the thing this
product exists not to produce.
