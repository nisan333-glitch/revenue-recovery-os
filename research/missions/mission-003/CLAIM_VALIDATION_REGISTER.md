# Mission #003 — Claim Validation Register (all reports)

> Consolidated register of every material claim evaluated under NH-ROP v1.0. Full reasoning per claim lives
> in the `REPORT_0X_ANALYSIS.md` files; this is the authoritative index + verdict tally. 33 claims across 6
> reports (≥5/report; ≥30 total per brief §5). Verdict vocabulary = NH-ROP §10; confidence = §11.

## All claims

| ID | Report | Type | Verdict | Confidence | Key reason |
|---|---|---|---|---|---|
| M003-R1-C1 | Recurly | Financial | **Unsupported / Vendor-Claim** | Low | "$1.2B" absent from primary; press-release lineage only |
| M003-R1-C2 | Recurly | Financial/Outcome | Supported | Moderate | Primary $254M dunning; collected, no baseline → not Proven |
| M003-R1-C3 | Recurly | Performance | Partially Supported | Moderate | 72% "saved" circular def; Recurly-population only |
| M003-R1-C4 | Recurly | Causal | **Unsupported (as causal)** | Low | 8.6% "more revenue" self-selected, no holdout |
| M003-R1-C5 | Recurly | Market/Benchmark | Supported (scope) | Mod-High in-scope / Low as industry | Median over Recurly merchants ≠ industry |
| M003-R1-C6 | Recurly | Financial/ROI | **Unsupported / Vendor-Claim** | Low | 14x ROI / 8.6% lift, no method |
| M003-R1-C7 | Recurly | Performance | Supported (scope) | Moderate | 95.7% paid rate, in-scope |
| M003-R2-C1 | McKinsey | Market-size/Forecast | Supported (as estimate) | Mod (estimated)/Low (realized) | $2.6–4.4T explicitly *potential* |
| M003-R2-C2 | McKinsey | Capability/Forecast | Partially Supported | Low–Mod | 60–70% automatable ≠ adopted |
| M003-R2-C3 | McKinsey | Descriptive | Supported (in-model) | Low–Mod | 75%-in-4-functions inherits C1 uncertainty |
| M003-R2-C4 | McKinsey | Forecast/Causal | **Contested** | Low | Acemoglu ~0.5%/decade vs McKinsey |
| M003-R2-C5 | McKinsey | Framing (meta) | **Confirmed** | High | Report itself frames as "potential" |
| M003-R3-C1 | Fed | Market-size | Supported (strong; pending primary) | Mod-High | $128.51T, census-grade, low COI |
| M003-R3-C2 | Fed | Trend | Supported | Mod-High | 9.5%/yr 2018–2021 |
| M003-R3-C3 | Fed | Comparative | Supported | Mod-High | ACH ≈72% of value |
| M003-R3-C4 | Fed | Comparative | Supported | Mod-High | Cards ≈84% of count increase |
| M003-R3-C5 | Fed | Freshness (meta) | **Confirmed (dated)** | High | 2021 data; re-verify before reuse |
| M003-R4-C1 | FB/Mktg Sci | Causal/Negative | Supported (strong method) | High | Observational ≠ RCT; abstract + literature |
| M003-R4-C2 | FB/Mktg Sci | Performance | Supported (dir.); magnitudes **Not Assessable** | Moderate | Full-text blocked; no fabricated numbers |
| M003-R4-C3 | FB/Mktg Sci | Technical/Causal | Supported (in-scope) | Mod-High | Causal-inference didn't isolate exog. variation |
| M003-R4-C4 | FB/Mktg Sci | Universal | **Partially Supported (scope-qualified)** | — | Scope = FB/these advertisers |
| M003-R4-C5 | FB/Mktg Sci | Strategic/Causal | Supported (in-scope) | Mod-High | Experiment required for causal ad claims |
| M003-R5-C1 | Stripe | Causal/Financial | **Unsupported (as causal)** | Low | "$1.2M otherwise lost" counterfactual unproven |
| M003-R5-C2 | Stripe | Performance | **Contested** | Low | 55% vs 25–35% (COI both sides) → scope: blends B2B/B2C |
| M003-R5-C3 | Stripe | Customer/Outcome | Partially Supported | Low–Mod | Named results = reported experience only |
| M003-R5-C4 | Stripe | Financial/ROI | **Unsupported / Vendor-Claim** | Very low | 9x ROI, no method |
| M003-R5-C5 | Stripe | Universal | **Partially Supported (scope-qualified)** | — | One case ≠ product proof |
| M003-R5-C6 | Stripe | Meta/verification | **Refuted** | High | "Independently verified" is false; audit contradicts |
| M003-R6-C1 | Gartner | Market-size/Forecast | Supported (as forecast) | Low–Mod | $644B forecast, no error band |
| M003-R6-C2 | Gartner | Forecast/growth | Supported (as forecast) | Low | +76.4% false precision |
| M003-R6-C3 | Gartner | Forecast | Supported (as forecast) | Low | $1.5T→$2.5T same lineage |
| M003-R6-C4 | Gartner | Meta/method | **Not Assessable** | — | No model disclosed |
| M003-R6-C5 | Gartner | Freshness (meta) | **Confirmed (dated)** | Moderate | High revision cadence; snapshot |

## Verdict tally (33)
| Verdict | Count |
|---|---|
| Confirmed | 3 (all meta: 2 freshness, 1 framing) |
| Supported | 16 |
| Partially Supported (incl. scope-qualified) | 5 |
| Contested | 2 |
| Unsupported (incl. Vendor-Claim / causal-fail) | 5 |
| Refuted | 1 |
| Not Assessable | 1 |

**Observation:** **zero substantive claims reached "Confirmed"** — the only Confirmed verdicts are *meta*
(the reports' own framing/dating). Every substantive headline landed at Supported-or-weaker with confidence
capped by independence, method-disclosure, and access limits. This is the discipline the protocol is meant
to enforce, applied to real reports.
