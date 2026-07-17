# Mission #003 — Report Selection & Rationale

> Six intentionally diverse public artifacts. **No two share a publisher or evidence lineage.** As-of /
> access date for all: **2026-07-17**. Full source fields (commercial interest, methodology disclosure,
> correction status, lineage) are captured per-report in each `REPORT_0X_ANALYSIS.md` Source Registry
> section. Selection here records *why* each was chosen and the claim types it exercises.

| # | Report | Category (brief §2) | Publisher | Pub date | Why selected / claim types exercised |
|---|---|---|---|---|---|
| **R1** | **Recurly — 2024 State of Subscriptions Report** | Vendor report | Recurly Inc. (subscription-management vendor) | 2024-01-23 | NH's exact domain (subscription revenue recovery). Dense **performance/financial/benchmark** claims: "72% of at-risk subscribers saved," "$1.2B recovered (2023)," "96% renewal-invoice paid rate," "1% involuntary churn." Strong **vendor-resistance** + **revenue-proof-ladder** test. |
| **R2** | **McKinsey Global Institute — The economic potential of generative AI: the next productivity frontier** | Consulting/analyst | McKinsey & Company | 2023-06 | Flagship **market-size / forecast / causal** claims: "$2.6–4.4T annual value," "automate 60–70% of work time," "75% of value in 4 functions." Tests scope, forecast discipline, model transparency. AI-enabled business ops (NH-adjacent). |
| **R3** | **Federal Reserve Payments Study — 2022 Triennial Initial Data Release** | Regulator / government | U.S. Federal Reserve Board | 2023-04-21 | Government primary data, low commercial interest — a **high-baseline** source to test whether NH-ROP correctly grades *strong* evidence (not just weak vendor claims). **Market-size/descriptive** claims: "$128.51T noncash value," "ACH = 72% of value." Payments (NH-adjacent). |
| **R4** | **Gordon, Zettelmeyer, Bhargava & Chapsky — A Comparison of Approaches to Advertising Measurement: Evidence from Big Field Experiments at Facebook** | Academic / peer-reviewed | Marketing Science (INFORMS), 38(2):193–225 | 2019 (Kellogg PDF) | **Causal / comparative / negative** claims at the highest evidence tier (15 RCTs, 500M observations). Directly tests NH-ROP's **causal + attribution discipline** and the C4 thesis (observational attribution ≠ experimental truth). Attribution (NH-core). |
| **R5** | **Stripe — customer case study: "Make recovers $1.2M in revenue with Stripe authorization and recovery tools"** | Customer case study | Stripe (payments vendor) | n.d. (accessed 2026-07-17) | **Financial / causal / customer / outcome** claims with a **counterfactual** ("$1.2M that otherwise would have been lost"). Plus the contested platform claim "55% of failed payments recovered on average" vs third-party "25–35%." Tests **vendor-resistance, revenue-proof ladder, false-independence, reproducibility** (does NH-ROP independently reproduce Mission #001's "Contested" finding?). Payments/recovery (NH-core). |
| **R6** | **Gartner — Forecasts Worldwide GenAI Spending to Reach $644 Billion in 2025** (press release) | Market / technology / industry report | Gartner, Inc. | 2025-03-31 | **Forecast / market-size / adoption** claims with sharp numbers ("$644B, +76.4% YoY"). Tests forecast discipline, methodology transparency (press-release vs underlying model), and freshness. AI-enabled business ops. |

## Diversity check (brief §2 requirement)
- **Publishers:** Recurly · McKinsey · U.S. Federal Reserve · INFORMS/Kellogg · Stripe · Gartner — six distinct, no shared lineage.
- **Commercial interest spread:** high (R1, R5), moderate (R2, R6), low/none (R3, R4).
- **Evidence-tier spread:** RCT/primary-data (R4, R3) → consulting model (R2) → analyst forecast (R6) → vendor self-report (R1, R5). Deliberately includes *strong* sources so validation is not rigged toward easy takedowns.
- **Claim-type coverage:** Capability (R1,R5) · Performance (R1,R5) · Market-size (R2,R3,R6) · Causal (R4,R5,R2) · Comparative (R4) · Financial/ROI (R1,R5,R2) · Adoption (R6,R2) · Universal/Negative (R2,R4) · Forecast (R2,R6). All nine brief-required types present.

## Expected risks
- **Author-COI** (`M003-A0`): I built NH-ROP → predisposed to a positive result. Mitigated by active FP/FN hunting and logging "no-defect" as suspicious.
- **Access risk:** R2/R4 full PDFs may be large/blocked; R5 case study may be light on method. Mitigation: use the primary press/PDF where reachable; where blocked, record as a dependency/Unknown, never invent content.
- **Overlap risk:** R1 and R5 are both recovery vendors → I will *not* cross-count their numbers as independent (lineage discipline), and will use that overlap as a live false-independence test.
- **Contested-claim reuse (R5):** the "55% vs 25–35%" split was seen in Mission #001; risk of importing that memory rather than re-deriving. Mitigation: re-fetch primary + third-party this mission and cite freshly.
