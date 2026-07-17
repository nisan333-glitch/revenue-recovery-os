# Mission #003 — Control Comparison (conventional review vs NH-ROP)

> Brief §7. For 3 of the 6 reports, compare (A) the likely conclusion from a **conventional narrative read**
> against (B) the conclusion produced **under NH-ROP**. Chosen for contrast: **R1 (vendor)**, **R4 (academic)**,
> **R5 (case study)** — high-COI promotional, low-COI rigorous, and single-instance testimonial.
>
> **Label (required, brief §7):** column A is an **analytical reconstruction** of how a competent but
> unstructured reader would likely read each report. It is **not** an observation of real human behavior and
> was **not** measured on test subjects; it is my honest reconstruction, and is itself a potential bias source.

## R1 — Recurly *State of Subscriptions* (vendor)

| Dimension | (A) Conventional narrative read | (B) Under NH-ROP |
|---|---|---|
| Headline taken away | "Recurly recovered **$1.2B** and saves **72%** of at-risk subscribers; **8.6%** more revenue." | "$1.2B is **absent from the primary** (primary says **$254M** dunning, collected, **no baseline**); 72% is Recurly-defined & population-bound; 8.6% is **not causal**." |
| Claim precision | Blurs benchmark + marketing into one impression | 7 atomic claims, each separately verdicted |
| Evidence traceability | "It's in the Recurly report" | Each figure → page/definition; $1.2B → press-release lineage, not primary |
| Contradiction visibility | None noticed | Primary-vs-secondary discrepancy surfaced (X1) |
| Confidence calibration | Implicitly high (big brand, big numbers) | Low–Moderate; capped by COI + no holdout |
| Unknown preservation | Lost | U1 ($1.2B composition), U2 (baseline) explicit |
| Source independence | "Multiple articles confirm $1.2B" | All reruns = **one Recurly press lineage** |
| Scope qualification | "Subscription industry benchmarks" | "Recurly-merchant medians ≠ industry" |
| Decision usefulness | Might over-trust ROI and buy on inflated expectation | Buy-decision anchored to *collected, un-attributed* $254M + demand for a holdout |
| Effort | Minutes | ~1–2 h (decomposition + disconfirmation + lineage) |

**Net:** NH-ROP **materially changed the takeaway** — from "proven $1.2B / 8.6% causal" to "collected-but-
unattributed, single-lineage, scope-bound." This is the clearest value case in the sample.

## R4 — Facebook / *Marketing Science* (academic RCT)

| Dimension | (A) Conventional narrative read | (B) Under NH-ROP |
|---|---|---|
| Headline taken away | "Attribution doesn't work; you need experiments." (possibly over-generalized) | Same core finding, **scope-qualified** to FB/these advertisers; magnitudes marked Not-Assessable (full text blocked) |
| Claim precision | One sweeping conclusion | 5 atomic claims; universal claim (C4) explicitly narrowed |
| Evidence traceability | "Peer-reviewed, so true" | Method (15 RCTs) cited; COI *direction* assessed |
| Confidence calibration | Uniformly high | High on direction, Moderate on magnitude, — on universality |
| Source independence | Assumed (journal) | COI (2 FB authors) noted **and** judged to run *against* the conclusion → not downgraded |
| Scope qualification | Often dropped ("attribution is dead") | Enforced: FB/these advertisers/conversion outcomes |
| Decision usefulness | Right direction, risk of over-claim | Right direction **without** over-generalizing |
| Effort | Minutes | ~45 min |

**Net:** here NH-ROP's value is **smaller but real** — a good reader reaches a similar conclusion; NH-ROP's
addition is **discipline against over-generalization** and honest magnitude-uncertainty. It also shows NH-ROP
does not punish strong evidence (it graded this the highest in the sample).

## R5 — Stripe customer case study (testimonial)

| Dimension | (A) Conventional narrative read | (B) Under NH-ROP |
|---|---|---|
| Headline taken away | "Stripe recovers **55%** and saved Make **$1.2M** — 9x ROI." | "$1.2M counterfactual **unproven**; 55% **Contested** (25–35% by 2 independent datasets), blends B2B/B2C; 9x ROI = Vendor-Claim; 'independently verified' = **Refuted**." |
| Contradiction visibility | None | X3 surfaced; **COI on both sides** handled (not naive flip) |
| Source independence | "Different sites say similar" | Redux = one lineage; Recurly 34.6% = a **second** independent lineage → that's what gives the low band weight |
| Confidence calibration | High (specific numbers feel precise) | Low / Very-low; Refuted where "verified" is claimed |
| Scope qualification | "This will work for us" | "One case ≠ product proof" |
| Decision usefulness | Risk of buying on a 55%/9x expectation | Expectation reset to a contested, segment-dependent, unaudited range |
| Effort | Minutes | ~1 h |

**Net:** NH-ROP **substantially changed the takeaway** and, notably, **reproduced Mission #001's independent
finding** on the Stripe number — a cross-mission reproducibility signal.

## Cross-cutting summary
| Where NH-ROP added the most | Where it added the least |
|---|---|
| High-COI promotional material (R1, R5): decomposition + lineage + causation/counterfactual guards overturned inflated headlines | Rigorous low-COI evidence (R4): a careful reader lands close; NH-ROP mainly adds scope discipline + honest uncertainty |

**Effort/materiality pattern:** NH-ROP's marginal value is **highest where stakes and vendor incentive are
highest**, and **lowest on already-rigorous sources** — which is the correct place for a rigor tax to fall,
and supports the §18 proportionality design (don't spend L4 effort on L1 questions).
