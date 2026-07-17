# Report 03 — Federal Reserve, *2022 Triennial Payments Study: Initial Data Release* (NH-ROP application)

> **Category:** regulator/government · **Publisher:** U.S. Federal Reserve Board · **Pub:** 2023-04-21 · **Accessed:** 2026-07-17
> **Primary obtained:** ❌ federalreserve.gov + atlantafed.org returned HTTP 403 (`M003-EV-03`). Figures are
> **secondary/discovery-grade** (search-engine extraction of the Fed release + Nacha/Payments-Dive coverage).
> Verification capped **Partially-Verified** pending primary. **Commercial interest:** **LOW/NONE** — this
> is the sample's control for *strong, low-incentive* evidence, testing whether NH-ROP over-flags good sources.
> **Methodology (as understood):** the Federal Reserve Payments Study is a periodic **survey/census of
> depository institutions and payment networks** — primary measurement, not a vendor estimate.

## Decision tested & thesis
- **Decision (a payments strategist's):** how large and fast-growing is US noncash payment value, and which rails drive it?
- **Thesis:** US noncash payments reached **$128.51T in 2021**, growing **9.5%/yr since 2018**; **ACH** drove
  most of the *value* growth (≈72% of core noncash value); **cards** drove most of the *transaction-count* growth.

## Claims (atomic) · verdicts · confidence

| ID | Claim | Type | Verdict | Confidence | Note |
|---|---|---|---|---|---|
| `M003-R3-C1` | US noncash payments value = **$128.51T in 2021**. | Market-size/Descriptive | **Supported (strong-source), pending primary** | Moderate-High | Would be **Confirmed** on primary access; low COI, census-grade method |
| `M003-R3-C2` | Noncash value grew **9.5%/yr from 2018–2021**. | Descriptive/trend | **Supported (in-scope, dated)** | Moderate-High | Bounded 2018–2021; not a forecast |
| `M003-R3-C3` | **ACH ≈ 72%** of core noncash value; drove >90% of the 2018–2021 value increase. | Descriptive/Comparative | **Supported (strong-source)** | Moderate-High | Composition claim, internally consistent |
| `M003-R3-C4` | **Cards** = ~84% of the *increase in number* of transactions; >¾ of noncash count. | Descriptive/Comparative | **Supported (strong-source)** | Moderate-High | Count vs value carefully separated by the source |
| `M003-R3-C5` | The figures describe **2018–2021** and may not represent current (2026) mix. | Freshness (meta) | **Confirmed** | High | 3-year-old data; as-of discipline applies (§13) |

## Disconfirmation / freshness searched (§9 Phase 5, §13)
- The study is widely cited **without material dispute** of the headline aggregates (Nacha, Atlanta Fed,
  Payments Dive corroborate direction). No credible source found contradicting the totals within scope.
- **Freshness flag (real):** the "initial data release" covers 2021; a **2024 detailed release** exists
  (federalreserve.gov 2024-11). Reusing C1–C4 as *current* would trip NH-ROP §13 → mark **Obsolete-risk**;
  re-verify against the latest release before any 2026 decision.
- **Lineage (§8):** Nacha (an ACH trade body) has a **commercial interest** in emphasising ACH growth (C3);
  its coverage is **derived** from the Fed data, not independent confirmation — noted, though it does not
  change the Fed's own figure.

## Cross-examination
- This report is the sample's **strong-evidence control.** The key test: does NH-ROP correctly *grade it up*
  rather than reflexively downgrade all sources? It does — low COI + census method + disclosed scope →
  Moderate-High even *before* primary access, and Confirmed-eligible on primary. NH-ROP is **not** a
  uniform skepticism machine; it rewards independence, method transparency, and low incentive.
- The only genuine weakness is **freshness** (C5), which NH-ROP catches explicitly.

## Independent reconstruction
The Federal Reserve, using network/institution data, measured 2021 noncash value at ~$128.5T with ACH
dominating value and cards dominating count. This reconstructs cleanly from the source's own method; nothing
depends on a beneficiary's narrative. **Survives fully, within the 2021 as-of boundary.**

## Verdict summary & overturn conditions
Net: **the strongest, most trustworthy report in the sample** — and NH-ROP grades it that way. Overturn only
by a data-revision in a later Fed release, or by using it past its freshness window without re-verification.

## Completion (§14)
Stop: **Evidence Sufficiency** + **Dependency Block** on the primary (403). Primary access would raise C1–C4
to Confirmed; it would **not** change the decision. Recorded unknown `M003-R3-U1` (primary-access), non-blocking.
