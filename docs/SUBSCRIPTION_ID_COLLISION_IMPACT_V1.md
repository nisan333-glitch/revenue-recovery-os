# Current D1/D2 impact of the `subscription_id` collision mechanism (v1)

**Status: read-only measurement, 2026-10-05.** Measured on the frozen corpus
(`e2e/fixtures/synthetic-validation-2026-09-27/`). **No admission behaviour was changed and none is
proposed here.** This document is deliberately **separate from the reconciliation benchmark** — it measures
what exists today and must not be mixed with synthetic Missing Invoice figures.

---

## 1 · The boundary this measurement respects

An earlier audit reported that **97 of 130 entities appear more than once** in the frozen corpus. That
figure establishes **corpus shape only**. It is **not** a monetary impact and must never be quoted as one:
every one of those 97 entities carries a *distinct* `subscription_id` per invoice, so none of them collides
and none of them loses money.

What establishes the failure *mode* is the pinned test — two genuinely different obligations under one id,
$500 + $300, `acceptedCycleCount: 0`. What establishes the *actual* impact on this corpus is the
measurement below, and the two must not be conflated.

## 2 · The measurement

Every `subscription_id` value shared by more than one row, over all 271 data rows:

| `subscription_id` | rows | entity | signed | activation | due | amount | rows byte-identical? |
|---|---|---|---|---|---|---|---|
| `synthetic-sub-S35` | 2 | `synthetic-d-duplicate-cycle` | 2026-02-20 | *(blank)* | 2026-03-20 | $7,000.00 | **yes** |

**That is the only one.**

| Question | Answer |
|---|---|
| Rows rejected by this collision mechanism | **2** |
| Distinct **obligations** affected | **1** — the two rows are **byte-identical**, so this is one obligation duplicated, not two obligations lost |
| Obligated amount not assessed | **$7,000.00** (700 000 minor). **Not $14,000** — summing both copies would count the paste twice |
| Rejection codes | `NH-DC-2016` (duplicate cycle identity) on both rows, and `NH-DC-4001` (identical row appears more than once) additionally on the second — exactly as the 2026-09-25 rule provides: *"an identical repeated source row may additionally carry its source-duplicate code"* |

## 3 · Which surface would it otherwise have reached?

Mechanically, **D1** — the activation-stall surface:

* `activation_at` is **blank** ⇒ never activated. `signed_at` 2026-02-20 + 30 days = 2026-03-22, which is
  before `asOf` 2026-06-30 ⇒ **stalled**.
* `next_invoice_due_at` 2026-03-20 ≤ `asOf` ⇒ not `NotYetDue`; no payment facts ⇒ **`Unpaid`**.
* So absent the duplicate it would have entered **`observedUnpaid`** at **$7,000.00** — D1, not D2, and not
  `Unknown`.

**But the independent business register says it is not leakage at all:**

```
scenario_id              S35
business_class           not_a_leakage_duplicate_cycle
business_leakage_minor   0
expected_amount_minor    0
formula                  "zero — the cycle is lost entirely, which is the documented cost of the rule"
```

So the honest answer to *"would that amount otherwise enter D1?"* is: **mechanically yes, but it should
not.** A double-paste means neither copy is trustworthy, and the independent register prices the leakage at
**zero**. Excluding it is correct; "recovering" it would be counting a transcription error as revenue
exposure.

## 4 · The finding that matters more than the number

**Zero rows in the frozen corpus are rejected because of the genuine D2 mechanism** — one `subscription_id`
spanning *genuinely different* obligations. The only collision present is an **identical duplicate**, which
is a different mechanism with a different correct answer.

This confirms, by measurement, what `DUAL_MAJOR_SEMANTIC_CHANGE_V1.md` stated: *"The frozen validation
cycles therefore never exercised D2."* The generator sidesteps it by construction, emitting one id per
invoice — for multi-obligation entities it embeds the invoice date in the id.

**Consequence.** The corpus cannot measure the real exposure of the `subscription_id` naming trap, because
it never contains the shape that triggers it. The pinned $500 + $300 test is the only evidence of the
failure mode's monetary effect, and it is a two-row fixture rather than a population. **Any claim about
corpus-wide or customer-wide monetary impact would require a dataset that actually contains group-keyed
rows, and no such dataset exists.** That is why the documentation correction shipped alongside this
measurement is the remedy: it prevents the shape rather than measuring it after the fact.

## 5 · What was NOT done

No admission behaviour changed · no exclusion recovered · no `cycleKeyRule` change · no contract version
movement · no re-grade of the frozen run. The $7,000 remains excluded, and that remains correct.
