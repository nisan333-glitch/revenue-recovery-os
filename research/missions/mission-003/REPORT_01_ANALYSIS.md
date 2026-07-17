# Report 01 — Recurly, *The 2024 State of Subscriptions* (NH-ROP application)

> **Category:** vendor report · **Publisher:** Recurly, Inc. · **Pub:** 2024-01-23 · **Accessed:** 2026-07-17
> **Primary obtained:** ✅ full 32-page PDF (via S3 mirror `media.mediapost.com/.../RECURLY_2024_state_subscriptions.pdf`;
> recurly.com + prnewswire.com returned HTTP 403 to automated fetch — logged as `M003-EV-01`).
> **Commercial interest:** HIGH (Recurly sells the recovery tools the report measures).
> **Methodology disclosed:** partial — p.31: 12 months, >2,200 Recurly merchants, 58M subscribers, 2020–2023,
> **median** (not mean), "compiled from global brands **using Recurly**." No control group, no counterfactual.
> **ID note:** claims namespaced `M003-R1-Cn` (report-scoped sub-namespace of the mission ID; NH-ROP §4).

## Decision tested & thesis
- **Decision this report *wants* to support (buyer's):** should I buy Recurly's recovery/churn-management tools?
- **Central thesis (verbatim spirit):** subscription growth now depends on retention + payments + churn
  management; Recurly's tooling "recovers" revenue and reduces involuntary churn. The report is a benchmark
  study whose figures double as marketing for Recurly's platform.

## Claims (atomic) · verdicts · confidence

| ID | Claim (exact/near-verbatim) | Type | Verdict | Confidence | Outcome-ladder (§12) |
|---|---|---|---|---|---|
| `M003-R1-C1` | "Recurly recovered **$1.2 billion** in subscription revenue in 2023 through its churn management solutions." | Financial/Outcome | **Unsupported at primary** (the accessible primary PDF nowhere states $1.2B; it states $254M from dunning) → **Vendor-Claim**, composition **Unknown** | Low | Collected — vendor-reported; **not Proven** |
| `M003-R1-C2` | "In 2023 alone, Recurly merchants recovered **$254 million** from dunning management techniques." (p.16) | Financial/Outcome | **Supported** (primary, vendor-reported collected $) | Moderate | Collected (rung 8); **no baseline/counterfactual → not incremental, not Proven** |
| `M003-R1-C3` | "In 2023, Recurly successfully **saved 72.0%** of at-risk subscribers using recovery events." (p.15) | Performance | **Partially Supported** (true within Recurly population; definition of "at-risk"/"saved" is Recurly-internal & circular) | Moderate | Detected/retained — vendor-defined; not independently verified |
| `M003-R1-C4` | "Merchants who leverage our full suite of revenue recovery tactics **capture an average of 8.6% more revenue** compared to those who do not." (p.3/15/28) | Causal/Comparative | **Unsupported as causal** (Supported only as an observed association) | Low (for causation) | Attribution rung **fails**: self-selected, non-randomized, confounded |
| `M003-R1-C5` | "Median churn **4.1%**, involuntary churn **1.0%**, customer retention **95.9%** in 2023." | Market/Benchmark | **Supported within scope** (Recurly merchants, median); **not** an industry benchmark | Moderate-High (in-scope) / Low (as industry) | n/a (descriptive) |
| `M003-R1-C6` | "The average **ROI was 14x** in 2023" (p.29); "average **revenue lift of 8.6%** … first year" (p.28). | Financial/ROI | **Unsupported / Vendor-Claim** (no methodology, baseline, or cost basis disclosed) | Low | Estimated/promotional; not Proven |
| `M003-R1-C7` | "Median **renewal invoice paid rate** was **95.7%** in 2023." (p.23) | Performance | **Supported within scope** | Moderate | n/a |

## Assumptions surfaced (§4.7)
- `M003-R1-A1`: the Recurly-merchant population is representative of "subscriptions" generally. **Risk: High** — population is self-selected buyers of a recovery tool → survivorship/selection bias inflates recovery-favourable metrics. Status: Open.
- `M003-R1-A2`: "recovered" dollars would not have been collected without Recurly. **Risk: High** — unproven; card retries and updaters recover some share regardless. Status: Open (this is the crux of C2/C4).

## Unknowns (§4.8)
- `M003-R1-U1`: composition/derivation of the "$1.2B recovered" figure (blocks upgrading C1). **Blocks decision: no** (C2 primary suffices). Status: Isolated.
- `M003-R1-U2`: baseline conversion of untreated stalled invoices (needed to make C2/C4 *incremental*). **Blocks** any "proven-returned" claim. Status: Open.

## Contradiction / cross-examination (§9 Phase 7)
- **Primary-vs-secondary discrepancy (material):** the flagship figure repeated by press (PRNewswire) and
  downstream blogs is "**$1.2B recovered**," but the **primary PDF's** 2023 recovery figure is "**$254M from
  dunning**." These are different scopes conflated in secondary coverage. Logged as contradiction
  `M003-X1`. NH-ROP §8 lineage: PRNewswire + secondary reruns of "$1.2B" descend from **one Recurly press
  release** = **one lineage**, not independent corroboration.
- **Visibility→action→outcome→attribution→proof:** the report proves *collection* (C2, rung 8) but **not
  attribution** (C4) — the 8.6% "more revenue" compares self-selecting adopters vs non-adopters with no
  randomization, no matched cohorts, no holdout. Correlation is presented as if causal.

## Independent reconstruction (§9 Phase 9)
Reconstructing from inspectable facts only: Recurly merchants (self-selected) collected **$254M** via dunning
in 2023 (vendor-reported); a fraction of at-risk subscribers were retained. **What survives:** money changed
hands and involuntary churn is low among Recurly users. **What does not survive:** that Recurly *caused* 8.6%
incremental revenue, that "$1.2B" is a defensible collected figure, or that these medians describe the
subscription industry rather than Recurly's book.

## Overturn conditions
C4 → Confirmed only with a randomized/matched-cohort holdout. C1 → Supported only if Recurly discloses the
$1.2B composition + method. C5 → industry-benchmark status only with an independent, non-Recurly dataset.

## Completion (§14)
Stop condition: **Decision Sufficiency** — enough to grade every material claim; primary secured for the
core figures. Remaining unknowns (U1, U2) are **isolated and non-blocking** for the validation purpose.
