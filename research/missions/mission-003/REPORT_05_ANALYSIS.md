# Report 05 — Stripe, customer case study "*Make recovers $1.2M with Stripe recovery tools*" + the "55% recovered" platform claim (NH-ROP application)

> **Category:** customer case study · **Publisher:** Stripe · **Pub:** n.d. · **Accessed:** 2026-07-17
> **Primary obtained:** ❌ stripe.com/customers/make + docs.stripe.com returned HTTP 403 (`M003-EV-05`).
> Figures from **secondary/discovery-grade** extraction (search of stripe.com case-study text + third-party
> audits). Verification capped **Vendor-Claim/Partially-Verified**. **Commercial interest:** HIGH (Stripe
> markets the tools). **Method disclosed:** none (a testimonial, no baseline/holdout/audit).

## Decision tested & thesis
- **Decision (a buyer's):** will Stripe's recovery tools return material revenue for me?
- **Thesis:** Stripe's Smart Retries/authorization tools recover failed-payment revenue; e.g. "Make kept
  ~**$1.2M** that otherwise would have been lost to involuntary churn," and Stripe states businesses recover
  "**55% of failed payments on average**."

## Claims (atomic) · verdicts · confidence

| ID | Claim | Type | Verdict | Confidence | Outcome-ladder (§12) |
|---|---|---|---|---|---|
| `M003-R5-C1` | "Make kept ~**$1.2M in revenue** that **otherwise would have been lost** to involuntary churn." | **Causal/Financial** (counterfactual) | **Unsupported as causal** (the "otherwise would have been lost" counterfactual has no baseline/holdout) → **Vendor-Claim** | Low | Collected — vendor-reported; counterfactual **unproven** → not Proven |
| `M003-R5-C2` | Businesses recover "**55% of failed payments on average**" with Stripe Billing. | Performance | **Contested** | Low | Directly disputed (below); COI on **both** sides |
| `M003-R5-C3` | Named customers (Deliveroo £100M+, Retool $600K+, InVideo 23%→30%) recovered revenue. | Customer/Outcome | **Partially Supported** (reported experience only; establishes *reported* outcome, not causation/generality) | Low–Moderate | Collected — vendor-reported; not generalizable (§5 Customer) |
| `M003-R5-C4` | Stripe recovers "~**$9 per $1 spent** — a 9x ROI." | Financial/ROI | **Unsupported / Vendor-Claim** (no method, no cost basis) | Very low | Estimated/promotional |
| `M003-R5-C5` | These case results **generalize** to a prospective buyer's business. | Universal/Generality | **Unsupported → Scope-qualified** | — | One case ≠ product proof (§5, §13) |
| `M003-R5-C6` | The "55%" and named results are **independently verified**. | Meta/verification | **Refuted** | High | No independent verification exists; the opposite (a contradicting audit) does |

## Disconfirmation & lineage (§8, §9 Phase 5) — the core test
- **Contradiction `M003-X3`:** an independent audit (Redux Payments, 200+ Stripe Billing B2C accounts,
  >$500M failed-payment volume) reports a consistently observed **25–35%** recovery rate — a **~20-point gap**
  below Stripe's "55%." A Recurly dataset (independent of Redux) reports **34.6% B2C**, corroborating the lower band.
- **COI on BOTH sides (the subtle, correct handling):** Stripe has an interest to **inflate** 55%; Redux and
  Recurly are **competitors/dunning vendors** with an interest to **deflate** it. NH-ROP §10 therefore does
  **not** simply flip to "25–35% is the truth" — it records C2 as **Contested**, with the most defensible
  reading being *scope*: Stripe's 55% **blends B2B (high) and B2C (low)** and is not segmented, so it is
  **true-but-unrepresentative** for a B2C buyer. This is a scope/definition resolution, not a winner-picking.
- **Lineage caution:** several "25–35%" reruns trace to the **single Redux audit** → treat as **one lineage**;
  the Recurly 34.6% is a **second, independent lineage** → *that* cross-lineage agreement is what gives the
  lower band weight (per §8, distinct lineages that each add verification).

## Cross-examination
- **Counterfactual discipline (§12):** C1's "would have been lost" is precisely the claim NH-ROP forbids
  accepting without a baseline/holdout — identical in shape to Recurly's C4 and to the vendor numbers
  Mission #001 flagged. NH-ROP reproduces that judgment **independently** here (a reproducibility signal).
- **Testimonial ≠ causation/generality:** C3/C5 establish *reported experience* for specific named firms;
  they cannot carry a prospective causal or general claim.

## Independent reconstruction
Some Stripe customers collected recovered-payment revenue (reported, unaudited). Whether Stripe *caused* it
vs. baseline retry success is unestablished; the headline "55%" is unrepresentative for B2C by two independent
datasets. **Survives:** money was collected and reported. **Does not survive:** the counterfactual, the ROI,
and the generalization.

## Verdict summary & overturn conditions
Net: a **promotional testimonial**, not proof. Overturn C1/C2 → a segmented, independently-audited recovery
figure with a holdout baseline. Until then: Collected — vendor-reported; **not Proven**.

## Completion (§14)
Stop: **Decision Sufficiency** — the contested/ladder classification is decisive without the primary page.
Unknown `M003-R5-U1` (Stripe's segmentation/method), **Open**, non-blocking for the validation.
