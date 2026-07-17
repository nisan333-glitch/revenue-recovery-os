# Report 04 — Gordon, Zettelmeyer, Bhargava & Chapsky, *A Comparison of Approaches to Advertising Measurement: Evidence from Big Field Experiments at Facebook* (NH-ROP application)

> **Category:** academic/peer-reviewed · **Publisher:** *Marketing Science* (INFORMS) 38(2):193–225 · **Pub:** 2019 · **Accessed:** 2026-07-17
> **Primary obtained:** ❌ Kellogg PDF + INFORMS returned HTTP 403 (`M003-EV-04`). Findings below are from the
> **published abstract + peer-reviewed record** (INFORMS/Northwestern Scholars/SSRN listings) — a strong
> secondary tier for an academic work, but the full-text magnitudes are **not primary-verified**.
> **Commercial interest:** LOW (peer-reviewed; two Facebook co-authors → a *disclosed* affiliation to weigh).
> **Method:** 15 large US ad **RCTs** at Facebook, ~500M user-experiment observations, ~1.6B impressions;
> experimental (causal) results compared against multiple observational/attribution models on the same data.

## Decision tested & thesis
- **Decision (directly NH-relevant):** can observational attribution be trusted to measure *causal* revenue/
  outcome effects, or is a randomized holdout required? (This is the empirical core of NH's Proof thesis and
  Mission #001 conclusion C4.)
- **Thesis:** observational/attribution methods **frequently fail to recover the experimental (causal)
  ground truth**, even after conditioning on rich demographics/behaviour; the direction and size of the error
  is unpredictable.

## Claims (atomic) · verdicts · confidence

| ID | Claim | Type | Verdict | Confidence | Note |
|---|---|---|---|---|---|
| `M003-R4-C1` | Observational methods **often do not reproduce** the RCT causal effect, even with extensive controls. | **Causal/Negative** (highest burden) | **Supported (strong method), pending full-text** | High | RCT design is the right tool for a causal claim; abstract states this directly |
| `M003-R4-C2` | The **magnitude of error** between observational and experimental estimates is **large and variable** (can materially over- or under-state). | Performance/Comparative | **Supported directionally; specific magnitudes Not-Assessable** (full text blocked) | Moderate | I will **not** quote a specific ROAS multiple I could not primary-verify |
| `M003-R4-C3` | Advances in causal-inference methods **did not** isolate the needed exogenous variation in this setting. | Technical/Causal | **Supported (in-scope)** | Moderate-High | Scope: these 15 experiments/advertisers |
| `M003-R4-C4` | Findings generalize to **all** digital advertising measurement. | **Universal** | **Unsupported as universal → Scope-qualified** | — | Scope = Facebook, these advertisers, conversion outcomes; do **not** globalize (§13) |
| `M003-R4-C5` | Therefore, **randomized/experimental measurement is required** for trustworthy causal ad-effect claims. | Strategic/Causal | **Supported (within scope), directionally strong** | Moderate-High | Central decision-relevant takeaway |

## Cross-examination (§9 Phase 7) — the highest-tier evidence in the sample
- **RCT = the correct instrument** for a causal claim (§5 Causal = High burden). This report *meets* the
  burden the vendor reports (R1 C4, R5) *fail*. NH-ROP grades it accordingly: C1/C3/C5 reach Supported–High
  where R1-C4's identical-shaped causal claim is Unsupported.
- **Disclosed COI handled, not ignored:** two authors are Facebook employees → NH-ROP records the affiliation
  (`M003-R4-A1`) but does **not** auto-downgrade, because the finding is *unfavourable to Facebook's ad-sales
  interest* (it says attribution is unreliable) — COI direction runs *against* the conclusion, which raises,
  not lowers, credibility. This is the mirror image of the vendor-report COI in R1/R5.
- **Universal-claim discipline (§13):** the tempting over-read — "attribution never works" — is blocked; the
  verdict is scope-qualified to the studied setting (C4).

## Independent reconstruction
From the design: randomize exposure → measure truth; run observational models on the same population → compare.
The observational models diverge from truth unpredictably. This reconstructs directly from the experimental
logic and needs no author narrative. **Survives at the highest tier available**, with magnitudes flagged
Not-Assessable pending full text.

## Relevance to NH (recorded, not acted on)
This report is **independent, high-tier evidence for NH's own Proof thesis** (attribution ≠ proof; a holdout/
baseline is required). Under the change-freeze this is noted only; it is **not** converted into a product or
marketing claim (brief §17).

## Verdict summary & overturn conditions
Net: **Supported (strong)** that observational attribution unreliably recovers causal effects *in this scope*;
**scope-qualified** against universal generalization; specific magnitudes **Not-Assessable** without the full
text. Overturn: a comparably-powered RCT corpus showing observational methods *do* recover causal effects.

## Completion (§14)
Stop: **Dependency Block** on the full PDF (403) + **Evidence Sufficiency** for the directional finding.
Unknown `M003-R4-U1` (full-text magnitudes) is **Isolated**, non-blocking.
