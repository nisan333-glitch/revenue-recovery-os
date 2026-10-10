# Detector #3 — failed payment / dunning · evidence-backed proposal (v1)

**Status: PROPOSAL, 2026-10-05. Nothing in this document is implemented.** No contract change has been
made; contract version remains **2.0.0**. This is the decision record that stops at the boundary, states
what the code actually supports, and asks for one specific authorisation.

**The headline, stated first because it is the finding most likely to be mis-sold:**

> Detector #3 adds **$0.00 incremental monetary coverage**. Every dollar it would identify is **already
> counted in full** by Detector #1 or Detector #2. Its value is **Fix**, not Identify.

---

## 1 · Why Detector #3 is not one of the latent `revenueEvent` mechanisms

The prior coverage audit named `src/assessment/revenueEvent.ts` as the largest latent capability in the
codebase — a 308-line EXPECT→DETECT engine for missing billing events, undercharge, overcharge and
delayed settlement, with zero production callers. The obvious move was to wire one of them up.

**All four fail.** The reasoning and the as-of defect found along the way are in
[`REVENUE_EVENT_LATENT_V1.md`](REVENUE_EVENT_LATENT_V1.md). In one line each:

| Mechanism | Verdict |
|---|---|
| Missing billing event | Collapses into existing **Unpaid** exposure — same population, same arithmetic. |
| Undercharge | Collapses into the existing **partial-payment remainder**. It is *underpayment*, not undercharge. |
| Overcharge | **Unreachable** on the governed path, and customer-favourable liability rather than company leakage. |
| Delayed settlement | **No outstanding exposure by design** — the money arrived. |

The common cause: the module's `deriveObservedEvent` reads `monetaryEvent.paidAt` / `paidAmount`, so its
"billing event" **is the payment**. "Expected" and "observed" are therefore two columns of the same row,
and there is no independent expected billing event to compare against.

**`revenueEvent` is not activated, and must not be.**

---

## 2 · The business question Detector #3 answers

> A monetary obligation exists. A collection attempt was **actually made**. That attempt **failed**. The
> obligation remains unsettled as of the governed cut-off.

The distinction that makes this a detector at all:

* **Detector #2** — money is overdue and unsettled.
* **Detector #3** — money is overdue and unsettled **AND there is affirmative evidence that a
  payment/collection attempt failed.**

Detector #3 must therefore add a **new fact**, not relabel Detector #2. The remainder of this document
establishes that the new fact does not exist in contract 2.0.0, what the minimum addition is, and what
the detector is and is not worth.

---

## PHASE A · Minimum data contract

### A.1 · Can any existing admitted field establish a failed collection attempt? **No.**

All **21** contract fields were reviewed (`src/contract/pilotDataContract.ts` —
`PILOT_DATA_CONTRACT_FIELDS`; an earlier draft of this document said 18, which was simply a miscount and
changed no conclusion). The money/payment-bearing
ones are `next_invoice_amount`, `next_invoice_due_at`, `next_invoice_paid_at`, `next_invoice_paid`,
`paid_amount`, `refunded_at`, `refunded`, `cancelled_at`, `cancelled`, `status`, `status_effective_at`.

Every one of them describes **the obligation or its settlement**. None records an **attempt**.

Specifically, and these are the inferences explicitly barred:

* `next_invoice_paid = false` is the **absence of settlement**, not evidence of a failed attempt.
* A null `next_invoice_paid_at` or `paid_amount` is absence, not failure.
* `dueAt <= asOf` with nothing settled is overdue-ness — which is exactly Detector #1/#2.
* Activation status is unrelated to collection.

`status` deserves its own line because it looks like the obvious home for `"payment_failed"` and is not:
it is declared `requirement: "optional"`, `kind: "enum"` **with no declared members** and no declared
meaning — the same wall that stopped the churn subpart in the Detector #2 slice — and
`projectExecutionInput` sets `statusRaw: null`, so a conventional label would be **inert in the worker**,
which is where the money is measured. A control that works in the local preview and not in the governed
run is worse than no control.

⇒ **Affirmative failure evidence does not exist in contract 2.0.0. The contract addition is genuinely
necessary, not a convenience.**

### A.2 · The proposed minimum: two fields, both `optional`

#### `last_payment_attempt_at`

| | |
|---|---|
| **Why necessary** | Places the attempt relative to the governed cut-off. Without it, an attempt cannot be shown to have occurred *before* the result was known, and Trust Invariant rule 2 is unmet. |
| **Requirement** | `optional` — see §A.5, this is binding, not a preference. |
| **Kind** | `date` (governed normalisation, identical primitives to every other date field). |
| **Source meaning** | The timestamp of the **most recent** collection attempt against this obligation, as recorded by the billing system or PSP. Not the first attempt, not an aggregate of several. |
| **Validation** | Normalises through `normalizeDate` like every other date. Blank is absent, never zero. A value is **not** required to precede `asOf` for the row to be valid — see the temporal rule. |
| **Temporal rule vs `asOf`** | An attempt dated **after** `asOf` is **invisible**, exactly as `effectivePaidAt` treats a post-cut-off payment. This reuses the existing as-of discipline rather than inventing a second one. |
| **Multiplicity** | Deliberately the **latest attempt only**. The field name says so. |

#### `last_payment_attempt_status`

| | |
|---|---|
| **Why necessary** | The only affirmative evidence of **failure**. Without it an attempt is indistinguishable from a successful collection, and the detector would be inferring failure from absence — the thing it exists to avoid. |
| **Requirement** | `optional`. |
| **Kind** | `enum`, **with the members declared in the contract**: `succeeded` \| `failed` \| `pending`. |
| **Source meaning** | The outcome of the attempt named by `last_payment_attempt_at`, and of no other attempt. |
| **Validation** | An unrecognised value is **not** `failed`. It degrades the field to unknown (§A.4). |
| **Temporal rule** | Read only for an attempt visible at `asOf`. |

**A note on the enum, because `status` is the cautionary example in this repository:** declaring members
is the whole point. `status` is `kind: "enum"` with an empty member list, which is why no behaviour could
ever be derived from it. If `last_payment_attempt_status` ships without declared members it will be
equally useless, and the honest move would be not to ship it.

### A.3 · Fields deliberately NOT proposed

* **`payment_failure_code`** — a Fix-stage refinement (card expired vs insufficient funds vs do-not-honour).
  It adds **no detection power**: the positive rule turns on `failed`, not on why. It would also be
  free-text and PSP-specific, so NH could not interpret it without inventing a mapping.
* **`payment_attempt_id`** — only meaningful once an attempt **history** exists, which the current row
  grain cannot hold (§A.4). An id with nothing to identify is ceremony.

Both are legitimate later additions. Adding them now would be adding fields mechanically.

### A.4 · Row grain and multiplicity — the critical point

The current grain is **one row = one expectation cycle = one obligation** (`next_invoice_*` is singular).
A dunning sequence is genuinely **one-to-many**: an attempt at day 0, then +3, +7, +14.

**What one row CAN represent truthfully.** The *latest* attempt and its outcome. This is a well-defined
aggregate with a stated rule — "the most recent attempt" — not an ambiguous scalar, and it is
**sufficient for Detector #3's positive condition**: an attempt was made at or before the cut-off, it
failed, and the obligation is still unsettled. Naming the columns `last_payment_attempt_*` puts the
aggregate in the column name, so no reader can mistake it for the history.

**What one row CANNOT represent.** Attempt count. Retry exhaustion. Dunning stage. Time since first
failure. Per-attempt failure codes. These are precisely the signals that make dunning *actionable at
scale* — "this account has failed four times and the sequence is exhausted" is a different instruction
from "this account failed once yesterday".

⇒ **STOP, stated rather than worked around.** The full dunning capability requires a **separate
payment-attempt event extract**, one row per attempt. The minimum correct event model:

```
payment_attempt_extract
  obligation_ref     required   joins the attempt to its obligation
  attempt_at         required   governed date
  attempt_status     required   declared enum: succeeded | failed | pending
  attempt_sequence   optional   ordinal within the obligation's dunning sequence
  failure_code       optional   PSP-reported, carried verbatim, never interpreted by NH
```

**That extract is blocked today, for a reason already decided and recorded.**
`OBLIGATION_IDENTITY_FIELDS` (`src/contract/leakInstanceIdentity.ts`) is a frozen **empty array**: the
data contract declares no obligation-level identity, so NH has no join key, and the candidate firewall
refuses on exactly that condition — with tests pinning `candidatesCreated: 0`. A second extract cannot be
joined to an obligation until that decision is reopened, which is a contract decision with an owner and
is **not** in scope here.

**Therefore: the single-row latest-attempt aggregate is the only currently-reachable form. The event
extract is the prerequisite for the full capability, not for Detector #3's positive rule.** We are not
flattening a one-to-many history into one ambiguous scalar to dodge a contract change; we are shipping a
named aggregate and stating plainly what it cannot answer.

### A.5 · The soft-fail trust rule — a non-obvious hazard

Every existing optional **date** field that fails to parse **rejects the whole row**: a malformed
`refunded_at` or `cancelled_at` produces `malformed_date` and the obligation leaves the accepted
population entirely. That is correct for those fields, because they are **money-relevant** — an
unparseable refund date means we cannot establish whether the obligation still stands.

`last_payment_attempt_at` is **not** money-relevant. It carries no amount, enters no identity, and
changes no exposure figure. If it inherited the row-rejection behaviour:

> A defect in a non-money, non-identity column would remove a real obligation from Detector #1/#2
> exposure — handing the beneficiary a lever to **shrink the measured number** by poisoning an optional
> column.

That fails the standing architecture test outright. So:

> **RULE. A defect in `last_payment_attempt_at` or `last_payment_attempt_status` degrades that field to
> unknown and leaves the obligation fully assessable. It never rejects the row.**

Consequences, both intended: a poisoned attempt column cannot reduce exposure, and it cannot manufacture
Detector #3 money either, because unknown is not `failed`. This differs deliberately from the existing
optional dates and is stated as a rule because it is a trust-boundary question, not a style choice.

### A.6 · Identity implications: **none**

* `deriveIdempotencyKey` (`src/contract/validateDataset.ts`) embeds
  `` `${PILOT_DATA_CONTRACT_ID}@major-${major}` `` — the **major only**, narrowed deliberately in contract
  2.0.0 so that a patch or minor bump no longer resets every identity. A 2.0.0 → 2.1.0 bump is therefore
  **identity-neutral**: `pds_1bc639b3…` is preserved, and `PAD-a04577ae…` / `PAX-8ad0089a…` are untouched.
* The derivation's **field list does not change**. No new parameter enters the submission identity.
* `declaredVersion` is deliberately outside the key, because "declaring an older supported minor is
  interpreted identically" — so a dataset declaring 2.0.0 under a 2.1.0 build keeps its identity.
* A customer who **re-exports** with the new columns changes the file bytes ⇒ a new `datasetFingerprint`
  ⇒ a new submission. That is correct and not a regression: a different file is a different submission.
  Existing files keep their existing identities.

---

## PHASE B · Detector semantics

### B.1 · The positive rule

An obligation is a Detector #3 positive when **all** of:

1. It is an **admitted** obligation — it passed intake and the admission bar.
2. `dueAt <= asOf` under the governed analysis terms.
3. `last_payment_attempt_status == "failed"` **and** `last_payment_attempt_at <= asOf` — affirmative
   evidence, visible at the cut-off.
4. Payment state at `asOf` is `Unpaid` or `PartiallyPaid`, from **`classifyPayment` unchanged**.
5. The outstanding amount is computable exactly from admitted facts.

### B.2 · The monetary rule

* `Unpaid` ⇒ the **full obligated amount**.
* `PartiallyPaid` ⇒ `clampNonNegative(subMoney(amount, paid))`.

Existing minor-unit primitives, integer arithmetic, no floats, no inferred amount, no baseline, no
modelled revenue. The arithmetic is **identical to Detector #1/#2 by design**, because it is the same
dollar.

### B.3 · Relationship to Detector #1/#2 — proven, not assumed

Conditions **2** and **4** above are *exactly* the inclusion conditions of Detector #1 and Detector #2.
And Detector #1 ∪ Detector #2 already partitions the **whole accepted population** — the stalled cohort
and its complement, proven disjoint and additive in the Detector #2 slice, including over the real CSV
path.

Therefore:

> **Every obligation satisfying Detector #3 is already counted, in full, by Detector #1 or Detector #2.**

The correct semantic model is therefore:

> **Detector #1/#2 = outstanding exposure STATE. Detector #3 = failed-collection EVIDENCE attached to a
> SUBSET of that exposure.**

### B.4 · The two figures, and the one that must never be invented

```
Detector #3 ATTRIBUTED exposure  = Σ outstanding over obligations carrying affirmative
                                   failed-attempt evidence
                                   — a SUBSET of Detector #1 + Detector #2; the SAME dollars, explained

INCREMENTAL UNION exposure       = $0.00

UNION(D1, D2, D3)                = UNION(D1, D2)        ← unchanged
```

**No incremental money. No double counting.** Reporting attributed exposure as an addition to the union
would count the same dollar twice, which is the one thing the brief for this slice named as the goal to
avoid.

### B.5 · Does failed-payment data reveal obligations D1/D2 cannot represent? **No — checked.**

The candidate was the `Unknown` bucket, which is real money in no exposure total (frozen corpus:
`unknownValueMinor = 1 050 003`, i.e. $10,500.03 on the stalled surface alone). It does not work:

`Unknown` arises in `classifyPayment` when `paidAmount > 0` but `effectivePaidAt` is null — i.e. **some
money settled and its timing cannot be placed** as of the cut-off. A failed *attempt* record says nothing
about when a *settlement* occurred, so it cannot resolve that ambiguity. Stating this plainly because the
opposite is an attractive and wrong conclusion.

The other edge case, `attempt_status = failed` alongside `next_invoice_paid = true`, is a **data
contradiction** to be surfaced as such, not new money.

### B.6 · False-positive controls

Every existing control is preserved unchanged: `NotYetDue`, `PaidOnTime`, `PaidLate`, dated `Refunded`
and `Cancelled`, `Unknown`, post-`asOf` invisibility, and the cross-currency fail-closed throw.

New controls required by Detector #3:

| Case | Required behaviour | Why |
|---|---|---|
| `attempt_status = succeeded` | **Not** a positive | The collection worked. |
| `attempt_status = pending` | **Not** a positive | An in-flight attempt is not a failure. Treating it as one would count money on an attempt that may yet succeed. |
| Attempt dated after `asOf` | **Invisible** | Mirrors `effectivePaidAt`. A fact after the cut-off is not yet known. |
| Attempt present, status blank or unrecognised | **Unknown**, never failure | Fail closed (§A.4). |
| `failed` but state at `asOf` is `PaidOnTime`/`PaidLate` | **Not** exposure | **The retry-then-success case — the most likely false positive.** An earlier attempt failed and a later one worked; the money arrived. |
| `failed` on a dated `Refunded`/`Cancelled` obligation | Excluded, as today | The obligation may be void. |
| Malformed attempt date | Field unknown, **row still assessable** | §A.5. |

### B.7 · Synthetic ground-truth design

**Positives:** `failed` + `Unpaid` (full amount); `failed` + `PartiallyPaid` (remainder, including an
odd-cent obligation so exactness is proved rather than assumed).

**Near-miss negatives, each measured on its own:** `pending`; `succeeded`; `failed` then paid on time
(retry-then-success); attempt dated after `asOf`; attempt with blank status; attempt with an unrecognised
status; attempt on a not-yet-due obligation; attempt on a dated refund; attempt on a dated cancellation;
a **malformed** attempt date on an otherwise clean overdue row, which must still appear in Detector #2 at
its full value.

**Overlap traps, which are the point of the benchmark:** every Detector #3 positive must be asserted to
appear in Detector #1 **or** Detector #2 at the **same amount**, and `UNION(D1,D2,D3)` must be asserted
**byte-equal** to `UNION(D1,D2)`. Plus a cross-currency fail-closed case and Detector #1/#2 examples so
the existing additivity proof is re-run alongside.

**Reported:** attributed exposure, incremental union exposure (expected: $0.00), false-positive amount,
false-negative amount, monetary recall and monetary precision **against the attributed figure**, never
against a union total.

---

## PHASE C · Recommendation

| # | Item | Answer |
|---|---|---|
| 1 | Exact current-data gap | No field records a payment **attempt**. Failure is inferable only from absence, which is barred. |
| 2 | Minimum proposed contract change | Two `optional` fields: `last_payment_attempt_at` (date), `last_payment_attempt_status` (declared enum `succeeded`\|`failed`\|`pending`). |
| 3 | Change class | **MINOR — 2.0.0 → 2.1.0.** `COMPATIBILITY_POLICY.minor` = "Add an optional or recommended field." See the blocker in §C.1. |
| 4 | Row-grain implications | Latest-attempt aggregate only. Attempt **history** needs a separate event extract, blocked by the frozen-empty `OBLIGATION_IDENTITY_FIELDS`. |
| 5 | D1/D2 implications | **No money change.** `classifyPayment` untouched, `ObservedSummary` untouched, Detector #2's summary untouched. Requires the **soft-fail** rule (§A.5) so an optional column cannot shrink exposure. |
| 6 | Identity implications | **None.** `pds` embeds the contract **major**, so `pds_1bc639b3`, `PAD-a04577ae`, `PAX-8ad0089a` are all preserved. |
| 7 | Multiplicity ⇒ separate extract? | **Yes, for the full capability.** Not for Detector #3's positive rule. |
| 8 | Exact positive rule | §B.1. |
| 9 | Exact monetary rule | §B.2. |
| 10 | Exact relationship to Detector #2 | Evidence **attached to a subset** of existing exposure (§B.3). |
| 11 | Incremental union vs attributed | **Incremental union = $0.00.** Attributed = a subset of D1 + D2 (§B.4). |
| 12 | False-positive controls | §B.6; retry-then-success is the key new one. |
| 13 | Synthetic ground truth | §B.7. |
| 14 | Migration / compatibility plan | **No data migration.** Two optional columns, no backfill. A persistence migration is needed only when a Detector #3 artifact is stored, and it follows the Detector #2 pattern: nullable columns plus a conditional CHECK, written in the same INSERT. |
| 15 | Do old 2.0.0 datasets stay valid unchanged? | **Yes.** `acceptsOlderMinorOfSameMajor: true`, same major, nothing tightened — **provided the fields are `optional`**, per §C.1. |

### C.1 · A blocker inside the contract's own compatibility policy

`COMPATIBILITY_POLICY.minor` permits "Add an optional **or recommended** field". That is unsafe as
written, and the admission gate proves it:

```ts
// src/contract/admissionGate.ts
const recommended = fieldsByRequirement("recommended");
const missingRecommendedColumns = recommended.filter((f) => !(f in report.columnMapping)).length;
```

…checked against `maxMissingRecommendedColumns`, which is **0** in the frozen pilot policy (observed 0).
So adding a new **recommended** field makes **every existing export miss one**, failing admission for
datasets that previously passed. Under the policy's own definitions that is **MAJOR** — *"Tighten a
validation rule so a previously valid dataset is now rejected."*

⇒ The policy contradicts itself, recorded as its own governed issue
([`GOVERNED_ISSUES_V1.md`](GOVERNED_ISSUES_V1.md) §1). The binding practical consequence for this
proposal: **the two new fields must be `optional`, never `recommended`.**

### C.2 · Verdict: CONDITIONAL GO — and not as a money detector

Detector #3 is worth building, and it must be labelled for what the evidence says it is.

**What it is.** NH's first **Fix**-stage capability. It is the first time the product could say *this
dollar is unpaid **because** the collection attempt failed*, which is what makes an action possible.
Under the Build Filter that is a pass on **Fix** — the weakest leg of Identify → Fix → Prove, and the one
the strategy document warns is the difference between a recovery product and "just another system that
identifies problems".

**What it is not.**

* It is **not** incremental monetary coverage. **$0.00.** Claiming otherwise double-counts.
* It is **not** recoverability. Affirmative failure evidence raises the *plausibility* that a dollar can
  be collected; plausibility is not recovery, and recoverability is exactly what may not be claimed.
* It is **not** proof, revenue, a Recovery Case, or a candidate.

**The honest alternative, recorded so it is not lost.** The only family that would find money NH cannot
see **at all** is **missing invoice** — an invoice that was never raised. It needs billing-cadence/term
fields so an *expected* invoice can be established without inventing one. It is a strictly larger
contract change and epistemically the most dangerous of the options, because a fabricated expectation
**manufactures money**. It is the right next candidate after Detector #3, and it must be designed
expectation-first.

---

## 3 · What is being asked for

**One authorisation: contract 2.1.0, adding the two `optional` fields of §A.2, with the soft-fail rule of
§A.5 and the declared enum members.**

Not requested, and not to be inferred from approval of this document: any Detector #3 implementation, any
schema change, any persistence, any operator surface, any `ASSESSMENT_CALC_VERSION` movement, any
identity or hash change, any merge, any deploy.

A 2.1.0 bump was staged once before and reverted as unauthorised. It needs an explicit decision, and this
document exists so that decision can be made on evidence.
