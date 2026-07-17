# Report 02 — McKinsey Global Institute, *The economic potential of generative AI* (NH-ROP application)

> **Category:** consulting/analyst · **Publisher:** McKinsey & Company (MGI) · **Pub:** 2023-06 · **Accessed:** 2026-07-17
> **Primary obtained:** ❌ mckinsey.com + mirror PDF returned HTTP 403 (`M003-EV-02`). Figures below are
> **secondary/discovery-grade** (search-engine extraction of the McKinsey page + reputable secondary
> coverage: VentureBeat, WEF). Per NH-ROP §6, **not upgraded on snippets** → verification capped at
> **Partially-Verified**; the *primary text* would be required to lift any of these to Verified.
> **Commercial interest:** MODERATE (McKinsey sells AI-transformation consulting; the report markets that).
> **Methodology disclosed:** partially (63 use cases × 16 functions; assumptions not inspected here — blocked).

## Decision tested & thesis
- **Decision (a strategist's):** how large and how certain is the GenAI economic opportunity — should we bet on it?
- **Thesis:** GenAI *could* add **$2.6–4.4 trillion annually** across 63 use cases; *could* automate **60–70%
  of work activities' time**; **~75% of value** concentrates in customer ops, marketing & sales, software
  engineering, R&D. Framed throughout as **potential** ("could," "potential," "estimate"), not realized.

## Claims (atomic) · verdicts · confidence

| ID | Claim | Type | Verdict | Confidence | Note |
|---|---|---|---|---|---|
| `M003-R2-C1` | GenAI **could add $2.6–4.4T annually** in value across the analysed use cases. | Market-size/**Forecast** | **Supported as a modelled estimate** (explicitly *potential*, wide range); **not** a realized or proven figure | Moderate (that McKinsey estimated it) / **Low** (that it will occur) | Range itself signals uncertainty |
| `M003-R2-C2` | GenAI **could automate 60–70%** of the time employees spend on work activities. | Capability/Forecast | **Partially Supported** (theoretical/technical potential, not adoption) | Low–Moderate | "Could automate" ≠ "will be automated"; adoption is a separate claim |
| `M003-R2-C3` | **~75% of the value** falls in four functions (customer ops; marketing & sales; software eng; R&D). | Descriptive/Comparative | **Supported within the model** (conditional on C1 being real) | Low–Moderate | Inherits C1's uncertainty |
| `M003-R2-C4` | GenAI could raise **labour productivity 0.1–0.6% annually** through 2040. | Forecast/Causal | **Contested** | Low | Directly contradicted below |
| `M003-R2-C5` | These are **potential/"could"** figures, not realized economic impact. | Framing (meta) | **Confirmed** (McKinsey itself frames them as potential) | High | The report's own hedging is the most defensible claim in it |

## Disconfirmation searched (§9 Phase 5) — actively sought reasons the headline is wrong
- **Expert divergence (strong contradiction to C1/C4):** Nobel laureate **Daron Acemoglu** projects ~**0.5%
  *total* productivity gain over a decade** — orders of magnitude below McKinsey's framing; economists' 10-yr
  forecasts span **0.1%–30%/yr** ("the gap … nearing a quadrillion dollars"). → contradiction `M003-X2`.
- **Implementation gap (contradiction to the *realized* reading):** McKinsey's own 2025 work reportedly finds
  ~**94% of companies deploying AI report no "significant" value** yet → confirms C5's "potential ≠ realized."
- **Lineage note (§8):** VentureBeat, WEF, consultancy.eu, LinkedIn posts repeating "$4.4T" **all descend
  from the single McKinsey report** = **one lineage**, not independent corroboration of the number.

## Cross-examination
- **Forecast ≠ fact (§12 guard):** C1 is a *forecast/opportunity*, not collected value. A reader who quotes
  "GenAI adds $4.4T" as established fact commits the exact error NH-ROP §5 (Forecast) forbids.
- **Capability ≠ adoption ≠ value:** C2 (technical automatability) is routinely elided into C1 (economic
  value) and then into realized ROI. The three are separate claims with separate (and weaker) support.

## Independent reconstruction
From inspectable facts: McKinsey built a bottom-up model over 63 use cases and produced a **wide potential
range** explicitly labelled as such. **What survives:** McKinsey estimated a large *potential*. **What does
not survive independent reconstruction:** any claim that $2.6–4.4T is *expected*, *realized*, or consensus —
credible economists diverge by orders of magnitude, and McKinsey's own later data shows minimal realized value.

## Verdict summary & overturn conditions
Net: the report is a **credible modelled opportunity estimate, not evidence of realized impact**. C1 →
would move to Confirmed-realized only with *ex-post* measured productivity data (which currently contradicts
it). Confidence is capped **Low** on realization precisely because independence is absent (all "confirmations"
are one lineage) and a Nobel-laureate estimate contradicts it.

## Completion (§14)
Stop: **Evidence Exhaustion for the validation purpose** + **Dependency Block** on the primary (403). The
primary-access gap is recorded as unknown `M003-R2-U1` (would sharpen methodology scoring, does **not** change
the verdict — the *framing* and *contradiction* are already decisive).
