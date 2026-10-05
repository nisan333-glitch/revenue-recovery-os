# `revenueEvent.ts` — why the latent EXPECT→DETECT engine cannot become a detector (v1)

**Status: findings of record, 2026-10-05. Read-only audit. Nothing was changed, and
`src/assessment/revenueEvent.ts` remains unwired.**

The prior coverage audit ([`NH_DISCOVERY_COVERAGE_AUDIT_V1.md`](NH_DISCOVERY_COVERAGE_AUDIT_V1.md))
named this module the largest latent capability in the codebase: 308 lines implementing an
expectation-versus-observation engine for **missing billing events, undercharge, overcharge and delayed
settlement**, with zero callers outside its own test. The obvious next move was to wire one of the four
up as Detector #3.

**None of the four can be a detector.** This document records why, so the conclusion is not re-derived —
or worse, re-decided the other way by someone reading only the module's own doc comment.

---

## 1 · The one fact everything follows from

```ts
// src/assessment/revenueEvent.ts:163-166
export function deriveObservedEvent(cycle: ExpectationCycle): ObservedRevenueEvent {
  const m = cycle.monetaryEvent;
  return Object.freeze({
    ...
    observedAt: m.paidAt,
    observedAmount: m.paidAmount,
```

The module's header asks *"did the corresponding billing event actually occur, on time, for the right
amount?"* — but the observation it reads is `paidAt` / `paidAmount`. **So the "billing event" in this
module is the PAYMENT, not the invoice.**

And the expectation (`deriveContractualExpectation`) reads `cycle.monetaryEvent.dueAt` and
`cycle.monetaryEvent.amount`. So "expected" and "observed" are **two columns of the same row**. There is
no independent expected billing event anywhere in the comparison — which means the engine cannot detect
that something *should have happened and did not*; it can only restate the relationship between an
obligation and its settlement, which Detectors #1 and #2 already measure.

---

## 2 · The four mechanisms

### A · Missing billing event ⇒ collapses into existing Unpaid exposure

```ts
// revenueEvent.ts:229-240 (abridged)
if (observed.observedAt === null && observed.observedAmount === null) {
  return { kind: "MISSING", direction: "COMPANY_FAVOURABLE", delta: expAmt,
           companyRecoverableCandidate: true, ... };
}
```

Reached when: past due, nothing settled, not voided. `delta` is the **full obligated amount**.

`classifyPayment` (`paymentState.ts:33-41`) returns `Unpaid` on: past due, no effective payment, no
positive settled amount — and Detector #1/#2 value `Unpaid` at the **full obligated amount**.

**Same population. Same arithmetic. Same dollars.** Calling it "missing billing event" renames the
Unpaid bucket; it does not find anything new.

Genuine missing-invoice detection would require establishing that an invoice **should exist** — a billing
cadence, a term, or a schedule. The contract has none, and absence of a row is not evidence that a row is
missing.

### B · Undercharge ⇒ collapses into the existing partial-payment remainder

```ts
// revenueEvent.ts:248-262 (abridged)
const shortfall = subMoney(expAmt, observed.observedAmount);
const companyIsOwed = isPositive(shortfall);
return { kind: "INCORRECT", direction: companyIsOwed ? "COMPANY_FAVOURABLE" : "CUSTOMER_FAVOURABLE",
         delta: ..., companyRecoverableCandidate: companyIsOwed, ... };
```

`COMPANY_FAVOURABLE` means `paid_amount < next_invoice_amount`, and `delta = amount − paid`. That is
**exactly** Detector #2's `overduePartialOutstanding` and Detector #1's `partialOutstanding`, computed
with the same subtraction.

So this branch is not **undercharge** — it is **underpayment**. Real undercharge means *we invoiced less
than the contract entitled us to*, which needs an **independent expected price** (a contract price, plan
price or rate card). `next_invoice_amount` is the invoiced amount, so comparing it to itself can never
establish that it was too low.

### C · Overcharge ⇒ unreachable, and the wrong direction anyway

The `CUSTOMER_FAVOURABLE` branch fires when `observedAmount > expectedAmount`. It is **dead code on the
governed path**:

```ts
// src/assessment/adapters/saasActivation.ts:177-179
if (paidAmount.minor > amount.minor) {
  return exclude(id, "paid_amount_exceeds_obligation", `paid_amount exceeds next_invoice_amount`);
}
```

The adapter **rejects** overpayment before a cycle exists, so no admitted cycle can reach that branch.
The frozen validation corpus contains exactly such a row (data row 23, $1,000 obligated against $1,500
settled) and it is reported as `NH-DC-2013`, never assessed.

Directionally it is also the opposite of what a revenue-recovery detector counts: money the company may
**owe back**. The module is already correct about this — `companyRecoverableCandidate: false` — and the
direction must stay explicit anywhere this is ever surfaced. It is a **potential liability**, not company
revenue leakage.

### D · Delayed settlement ⇒ no outstanding exposure by design

```ts
// revenueEvent.ts:272-282 (abridged)
return { kind: "DELAYED", direction: "NEUTRAL", delta: null,
         // The money arrived. Late settlement is an operational finding, not recoverable value.
         companyRecoverableCandidate: false, ... };
```

`delta: null` and the comment are both right. A fully-settled-but-late obligation has **zero outstanding
exposure at the cut-off**. Labelling the invoice amount as current monetary exposure because the payment
was late would count money that is already in the bank.

Late settlement is a real operational and working-capital signal. It is not exposure.

---

## 3 · Summary table

| Mechanism | Branch | Money | Verdict |
|---|---|---|---|
| A · Missing billing event | `MISSING`, `delta = expectedAmount` | full amount | **Collapses into Unpaid (D1/D2)** |
| B · Undercharge | `INCORRECT` + `COMPANY_FAVOURABLE` | `amount − paid` | **Collapses into the partial remainder (D1/D2)** |
| C · Overcharge | `INCORRECT` + `CUSTOMER_FAVOURABLE` | `paid − amount` | **Unreachable** (adapter rejects); customer-favourable liability |
| D · Delayed settlement | `DELAYED`, `delta = null` | none | **No exposure by design** |

**Incremental monetary coverage available from this module: zero.**

---

## 4 · A latent as-of correctness defect — recorded, deliberately not repaired

The module reads the payment date **raw**:

```ts
// revenueEvent.ts:164
observedAt: m.paidAt,
```

The shipped path does not. `classifyPayment` routes it through `effectivePaidAt`, which makes a payment
dated after the cut-off invisible:

```ts
// src/assessment/paymentState.ts:13-17
function effectivePaidAt(cycle: ExpectationCycle, asOf: string): string | null {
  const p = cycle.monetaryEvent.paidAt;
  if (p === null) return null;
  return isAfter(p, asOf) ? null : p; // paid after cut-off ⇒ not observed yet
}
```

**Consequence.** For an obligation with a payment recorded **after** the governed `asOf`:

* `classifyPayment` → `Unpaid` (correct: at the cut-off, nothing had settled) — and Detector #1/#2 count
  it at full value.
* `detectDiscrepancy` → `observedAt !== null`, so the `MISSING` branch is skipped; the amount check is
  skipped when `observedAmount` is null; and it falls through to **`DELAYED`** — *"settled after the
  obligation date"*, i.e. **"the money arrived"**.

So the latent module **reads post-cut-off facts** and is *less conservative* than the shipped path, on
the exact axis the as-of discipline exists to protect. It would report a settlement that, as of the
analysis cut-off, had not happened.

**Not repaired.** It is not required by the Detector #3 proposal, and repairing an unwired module
opportunistically would be a change with no behavioural test to anchor it. It is recorded here as a
**blocker on any future wiring**: this defect must be fixed before `revenueEvent` is given a production
caller, and the fix is to route `observedAt` through the same effective-as-of rule rather than to
special-case the `DELAYED` branch.

---

## 5 · Standing conclusion

* `revenueEvent.ts` is **not activated** and must not be. No production caller exists — verified by
  search across `src`, `server`, `scripts` and `e2e`: zero references outside `revenueEvent.test.ts`.
* Its epistemic discipline is good and worth preserving: the CONTRACTUAL / OPERATIONAL / STATISTICAL
  distinction, the fail-closed `UNKNOWN`, the explicit direction, and `companyRecoverableCandidate` as a
  review flag that is never money. The problem is not the design — it is that the data it compares cannot
  express an independent expectation.
* **What would make it useful** is an expectation the contract does not yet carry: a billing cadence or
  term (for missing invoice) or a contract price (for genuine undercharge). Until one of those exists,
  wiring any branch of this module would restate Detector #1/#2 money under a new name.

See [`DETECTOR_3_FAILED_PAYMENT_V1.md`](DETECTOR_3_FAILED_PAYMENT_V1.md) for the path chosen instead, and
for why it too adds zero incremental money.
