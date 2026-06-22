# Revenue Recovery OS — Strategic Direction

> The north star. Every change to this product must serve it. When in doubt,
> re-read the **Build Filter** below before writing a line of code or a line of copy.

## Mission

We do not build dashboards.

We do not build analytics.

We do not build another AI monitoring platform.

We identify, fix and prove revenue recovery.

Everything in the system must strengthen one or more of these three capabilities.

Identify.
Fix.
Prove.

---

## Core Insight

The world does not suffer from a lack of detection.

Companies already have:

* CRM
* BI
* Dashboards
* Alerts
* Reports
* AI tools

Most systems can identify problems.

Very few systems can:

* drive corrective action
* create accountability
* prove business outcomes

The value is not detection.

The value is closing the loop.

Problem
→ Owner
→ Action
→ Outcome
→ Proof

---

## Product Constitution

Never break these rules:

1. Forecast ≠ Proof
2. Prediction ≠ Recovery
3. Recovery ≠ Auditable Revenue

Two ledgers, never blended:

* **Revenue Opportunity** — forecast (detected + recoverable). Never counted as money.
* **Revenue Returned** — proven (`Collected − Baseline`). Realized.

*Auditable Revenue is the CFO-grade subset of Revenue Returned* — only events that
are Recovered, carry a recovery reason, clear the proof-grade confidence threshold,
and show a positive uplift. It is a stricter view of Returned, not a third book.

The day a forecast is mixed into a proven number, the moat disappears.

---

## Product Wedge

Primary wedge:

**Activation Recovery**

Journey:

Signed
→ Onboarding
→ Activation
→ First Value
→ Second Invoice

Reason:

* high pain
* measurable
* lower competition
* recoverable
* provable

This is the beachhead.

---

## The wedge is not the category

Activation Recovery is the **first recovery workflow**, not the final product.

The product is **Revenue Recovery OS**.

Activation Recovery is simply the first workflow because it has:

* clear pain
* measurable outcome
* provable recovery
* lower competition than billing

Build the Activation workflow **end to end** — but keep the architecture **generic
enough to support additional recovery workflows later.** Never narrow the company
into an "Activation Recovery System."

The recovery workflows, staged:

**Stage 1 — land the beachhead**

* Activation Recovery — Signed → Activated → Second Invoice

**Stage 2 — widen the loop**

* Sales Recovery
* Ownership Recovery
* Handoff Recovery

**Stage 3 — the full continent**

* Expansion Recovery
* Renewal Recovery
* Churn Prevention

Activation is the shore where we land. Revenue Recovery OS is the continent.

Two things held at once:

1. Start from something focused and **sellable** (Activation).
2. Do not lock the company into a single niche (the architecture stays generic).

**Architecture rule (already true, keep it true):** the domain core is workflow-
agnostic. A `RecoveryEvent` carries a `LeakageType`, and the decision `PLAYBOOK` is
keyed by `LeakageType` (`src/domain/recommendation.ts`). Adding a new recovery
workflow = new `LeakageType` values + new `PLAYBOOK` entries + new `RecoveryReason`
plays — **not** a rewrite. If a change to the Activation workflow forces a special
case into the invariants, the ledger, or the proof chain, that is a red flag: keep
the generic core generic; let the workflow live in data, not in the engine.

---

## What We Are NOT

Not revenue intelligence.

Not business analytics.

Not workflow software.

Not reporting.

Not generic AI.

Not another dashboard.

---

## What We ARE

A Revenue Recovery Operating System.

A system that:

1. Identifies revenue loss.
2. Drives corrective action.
3. Creates ownership.
4. Measures outcomes.
5. Proves business impact.

---

## Build the complete loop, not a detection product

The single biggest risk right now is **not** that a queue is missing.

The risk is that the product becomes **just another system that identifies problems.**

A CFO, CRO or CEO does not buy Detection. Does not buy a Queue. Does not buy Alerts.

They buy: *"I found $200K leaking, I fixed it, and I returned $80K in cash."*

The value to the customer is the **whole loop**, not one part of it:

Identify → Fix → Prove

So from day one, the product must let a user see the **complete recovery loop in a
single workflow**, on one case:

1. the problem identified
2. the recommended action
3. the action taken
4. the result proven (money returned)

Without all four it looks like another dashboard, and the differentiation is gone.

**But depth may vary — that is allowed.** You do not have to build every part to the
same depth to show the full loop:

* **Identify** — built real (detection of revenue at risk).
* **Fix** — playbooks and rules (the recommended play per problem).
* **Prove** — full proof math (`Collected − Baseline`, auditable).
* **Execute** — manual or semi-automatic at first (the human takes the action).

That is still a complete package. The rule is not "build everything deeply at once."
The rule is: **never ship a slice of the loop as the product.**

> Build the complete recovery loop, not a detection product.
> The user must be able to see **Identify → Fix → Prove** in a single workflow.
> Detection alone is not the product.

### Roadmap constraint — make the Fix layer explicit

Today the loop demonstrates **Identify → Recommend → Prove**: a problem is detected,
a play is recommended, and proven dollars are reported. That is a strong demo — but
it proves the system *recommended*, not yet that it *fixed*. A CFO does not pay for
detection or a recommendation; they pay for: **who did what, when, was it executed,
and how much money came back.**

So the next evolution must model the **Fix** layer explicitly. The recovery chain
should become:

```
Opportunity → Detected → Assigned → Fixed → Returned → Auditable
```

…where **Assigned** (an accountable owner) and **Fixed** (the action executed and
logged) are first-class, visible rungs — not implied. The long-term promise is not
detection alone, but *identify, **fix**, and prove* revenue recovery. This is a
forward design constraint, not a current task: keep the architecture ready for it
(the audit trail and `actionsTaken` already capture execution), and close the
recommend-vs-fixed gap when the Fix layer is built.

---

## Build Filter

Before building anything ask:

Does it improve:

* Identify?
* Fix?
* Prove?

If the answer is no:

Do not build it.

---

## Priority Order

**Priority 1** — Activation Recovery

**Priority 2** — Proof

**Priority 3** — Recovery Workflow

**Priority 4** — Decision Support

Everything else is secondary.

---

## Current Strategic Position

Decision Layer exists.

Recommendation Engine exists.

Expected Value exists.

Keep them.

Do not market them.

The customer buys:

> "We identify, fix and prove revenue recovery."

The Decision Layer supports the promise.

It is not the promise.

---

## Long-Term Vision

Today:

Revenue Recovery OS

Tomorrow:

Business Outcome Operating System

Do not sell tomorrow.

Earn tomorrow.

Win Activation Recovery first.

Then expand.

---

## Success Metrics

Not:

* features built
* engines built
* screens built
* tests written

Success is:

* revenue recovered
* revenue proven
* customer willingness to pay
* repeatable outcomes

Everything else is secondary.

---

## Final Rule

Most systems identify problems.

Revenue Recovery OS identifies problems, drives action, and proves outcomes.

Protect this principle at all costs.

---

## Reconciliation note — how this maps to the code

This document is the promise. These are the places the promise is enforced, so the
strategy and the codebase never drift apart:

* **`Revenue Returned = Collected − Baseline`, always derived, never user-set** →
  `computeRevenueReturned()` and `withDerivedReturn()` in
  [`src/domain/invariants.ts`](../src/domain/invariants.ts).
* **Auditable = CFO-grade subset of Returned** → `isAuditable()` in
  [`src/domain/invariants.ts`](../src/domain/invariants.ts) (Recovered + reason +
  `confidence ≥ PROOF_THRESHOLD` + positive uplift).
* **Forecast never blended into proven** → `outcomesByLeakage()` keeps `recoverable`
  (Opportunity ledger) disjoint from `recovered` (Returned ledger) in
  [`src/domain/outcomes.ts`](../src/domain/outcomes.ts); asserted in
  `src/domain/outcomes.test.ts`.
* **Decision Layer / Recommendation Engine / Expected Value exist but stay
  backstage** → `recommend()` and `expectedRecoverable()` in
  [`src/domain/recommendation.ts`](../src/domain/recommendation.ts); the Outcomes
  surface stays unrouted. See the README "backstage decision engine" section and
  [`docs/VISION.md`](VISION.md) §7.
* **Wedge = Activation Recovery** → the money chain and proof method in
  [`docs/PROOF_MODEL.md`](PROOF_MODEL.md); `LeakageType` / `FunnelStage` in
  [`src/domain/types.ts`](../src/domain/types.ts).

> Forward note: a third ledger — **Revenue Protected** (counterfactual, avoided
> loss) — is a deliberately *deferred* concept tied to the future Prevention layer.
> It is **not** part of the product today and must not be presented or counted as if
> it were. Until it ships with its own conservative, evidence-gated rules, there are
> two ledgers.
