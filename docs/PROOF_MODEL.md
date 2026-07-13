# Activation Recovery — Proof Model

**Wedge:** Onboarding / Activation Recovery.
**One-line pitch:** *"We return money lost between signature and activation."*

This document defines, for the locked wedge, the five things a buyer (and their
CFO) must be able to trust: **leakage points, recovery actions, proof methodology,
the recovery ledger, and the audit chain.** It is a proof methodology, not a
software spec — no new engines.

---

## 0. The money chain

```
Signed  →  Onboarding started  →  Activation reached  →  First value  →  Next invoice paid  →  Renewal
```

Revenue leaks at every arrow. The wedge targets the leak that is **early enough to
act on** yet **ends in a real cash event**: signed accounts that stall before
**activation** and therefore put the **next invoice** at risk.

Two events, never blurred:
- **Leak / detection event** — *activation milestone not reached by day N.* The
  earliest observable, binary signal. Activation is product-specific ("aha") and is
  defined **with each customer**, not assumed.
- **Money-proof event** — *next invoice paid by a previously-stalled account.* This
  is the cash that makes recovery real, not a forecast.

Unit of recovery: `stalled → intervened → activated → next invoice paid`.

---

## 1. Leakage points (Signed → Activation → First Invoice → Renewal)

| # | Leak point | Observable signal | Money at risk |
|---|---|---|---|
| L1 | Signed, onboarding never started | no kickoff / no first login by day 3–7 | full next invoice |
| L2 | Onboarding started, activation milestone missed | key event not reached by day N | full next invoice |
| L3 | Activated late / partially | activation after threshold, low depth | renewal + expansion |
| L4 | Activated but next invoice unpaid | invoice failed/unissued post-activation | the invoice itself |

**Primary target: L2** — the clearest leading indicator that generalizes across PLG
and sales-led, sourced from product data. L1 is a high-touch proxy; L4 overlaps
billing recovery (crowded). Lead with L2.

---

## 2. Recovery actions (the plays)

At the leak point, the account enters the recovery workflow (the system already
built: Queue → assign owner → act → prove). Representative plays for activation:

- Guided-onboarding outreach (CS/onboarding owner) with the specific blocked step.
- In-product nudge / checklist to the missing activation event.
- Solutions/technical assist to clear an integration or setup blocker.
- Exec or champion re-engagement when the original buyer went quiet.

Each play is **owned, time-bound (SLA on the fix), and logged in the audit trail** —
who did what, when. The play is the intervention whose effect we must prove.

---

## 3. Proof methodology (the hard part — Constitution-safe)

**Claim that unlocks budget:** *incremental* recovery — dollars that **would not
have come back without us** — not "we measured recovery you already get."

**Baseline = matched historical cohort, NOT a live holdout.**
- Take the customer's own history: of accounts that stalled at L2 in prior periods
  and received *no systematic intervention*, what fraction went on to pay the next
  invoice? Call it the **baseline conversion** `b` (e.g. 30%).
- Run the plays on the current stalled cohort. Measure **treated conversion** `t`
  (e.g. 50%).
- **Recovered activation revenue = (t − b) × ARPA × (accounts treated).**
  Only the **delta over baseline** is booked. The portion that would have converted
  anyway is **not** ours.

Why matched-historical and not a live holdout: telling a customer *"we deliberately
withheld help from some of your stalled accounts to prove a point"* is a deal-
killer. Matched historical cohorts (or a pre/post period, or staggered rollout)
give a defensible baseline without withholding help. Where a customer *is* willing,
a small randomized holdout strengthens rigor — optional, never required.

**Confounders to control (stated openly, because a skeptical CFO will ask):**
- Seasonality / cohort mix → match cohorts on signup period, plan, segment, ARPA.
- Selection (we only treat "savable" accounts) → define the stalled cohort by an
  objective rule (missed L2 by day N), treat the whole cohort, not cherry-picks.
- Regression to the mean → baseline drawn from the same objective stall definition.

---

## 4. Recovery ledger (which book each dollar lands in)

Per the Constitution — three ledgers, never blended:

| Ledger | What lands here in this wedge |
|---|---|
| **Revenue Returned** | the audited **(t − b)** delta that paid a real next invoice |
| **Revenue Opportunity** | stalled accounts in flight — forecast/at-risk, never counted as money |
| **Revenue Protected** | *not used in the pilot* — activation recovery resolves to realized cash, so we avoid the counterfactual book entirely |

Booking only the delta-that-paid keeps this in **Revenue Returned** (realized) — the
strongest, most defensible ledger. The pilot deliberately stays out of "Protected."

---

## 5. CFO auditability (the evidence chain)

Every booked dollar carries a per-account chain, each link timestamped and
evidenced:

```
stalled (missed activation event by day N)        ← product data
   → intervened (play, owner, timestamp)          ← audit trail
   → activated (activation event fired)           ← product data, timestamped
   → next invoice paid                            ← billing, real cash
```

Plus the cohort-level proof: the baseline `b`, the treated `t`, the matched-cohort
definition, and `(t − b) × ARPA × n`. A CFO can trace the number from the headline
down to individual paid invoices and up to the baseline method. That traceability —
not a dashboard — is the product.

---

## 6. What this requires from a customer (and why it starts as a CSV)

Minimum data to size the leak and the baseline — **no integration**:

```
account_id, signed_date, activated_date | null, next_invoice_paid (bool), ARPA
```

From one historical CSV you can compute: how many signed, how many stalled at L2,
the baseline conversion `b`, and the dollars leaking. **That export is the entire
"show them their own leakage" demo** — zero engineering, and it directly de-risks
the cold-start integration problem. Live integration (CRM + product + billing) comes
only after a pilot proves the delta is real and fundable.

---

## 7. Evidence Classification — how much to trust each number (T1 / T2 / T3)

Not every recovered dollar is proven with the same rigor. Rather than present one
blended number, **every claim carries an explicit, *earned* evidence tier.** The tier
is part of the proof — it tells the CFO exactly how much weight to put on the number.
**The default is not T2 — the default is `Unproven`.** The system must *earn* the
right to claim. (In code today, this maps to the confidence model: `isAuditable`
— `confidence ≥ PROOF_THRESHOLD` + reason + positive uplift — is the **T2 floor**;
a counted-but-sub-threshold recovery is **T3**; an unclassified one is `Unproven`. The
literal T1/T2/T3 labels are the proof *model* — **not yet surfaced in the app**, which
today shows the 0–100 confidence score + an auditable badge.)

| Tier | Mechanism | Output label | Maps to |
|---|---|---|---|
| **T1 — Experimental** | a genuine holdout / control / randomization exists | *Incremental Recovery* | the optional randomized holdout (§3) — strongest, by construction |
| **T2 — Operational** | matched-cohort baseline + full audit chain, no experiment | *Operational Recovery* | the default proven path (`isAuditable`, §3 + §5) |
| **T3 — Directional** | causality cannot be isolated; plausible influence only | *Potentially Influenced Revenue* | counted-but-sub-proof-grade |

**T2 Gate Criteria — all required, binary** (miss one → evaluate as T3):
1. **Pre-registration** — the Expectation was documented *before* the action, not
   reconstructed after seeing the outcome.
2. **Case-level traceability** — the claim points to a specific account, not an
   aggregate trend.
3. **Complete audit trail** — who acted, when, what was expected, what happened — a
   continuous chain, not reconstructed from memory.

**T2 Quality Factors — graded** (all Gates met but both low → downgrade to T3):
causal window (short = strong, long = weak) and confounders (0–1 = strong, 2+ = weak).
*Exact thresholds are provisional and calibrated per leak type — a failed payment and a
dormant opportunity don't share a time scale.*

### Excluded Recovery — mandatory on every Proof

Every Proof **must** state **what was deliberately *not* claimed, and why** — even
revenue that technically returned, if the causal link isn't defensible. This is not an
optional field; it is the system's core credibility mechanism (the same idea as the
Found↔Returned gap in [`gtm/PITCH_60S.md`](gtm/PITCH_60S.md) and the Reconciliation
view). A CFO trusts the *claimed* number precisely because the system is visibly more
conservative than it has to be. No exclusion statement → no Proof.

> **In code today** this lives in the **Reconciliation** view (excluded revenue by
> reason) and the Found↔Returned gap. A *mandatory field on a distinct Proof object* is
> the model — not yet enforced in code (there is no Proof object yet).
