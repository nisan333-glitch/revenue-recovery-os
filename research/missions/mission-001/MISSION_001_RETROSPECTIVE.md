# Mission #001 — NH-ROP Retrospective Audit

> **Purpose:** test **NH-ROP** by applying it to an already-closed mission. **Not** to rewrite Mission #001
> to look compliant. Mission #001 v1.1 remains frozen and unchanged; this is a *separate* audit artifact.
> **Auditor:** Founder-as-Critical-Reviewer · **Date:** 2026-07-17 · **NH-ROP version:** 1.0.
> **Subject:** `research/MISSION_001_GLOBAL_CAPABILITY_LANDSCAPE.md` v1.1 (frozen; v1.0 at git `2707d00`).

---

## 1 · Central decision & question (reconstructed)

- **Decision supported:** whether an unfilled position exists for NH — a native, cross-domain, proof-first
  Revenue Recovery loop — or whether existing products/services already deliver it.
- **Research question (§4.2 type = Market-existence + Competitive-differentiation):** *Does any product,
  platform, methodology, or combination already deliver the complete chain Identify → Prioritize →
  Assign/Coordinate → Execute → Measure → Attribute → Prove Revenue Returned → Preserve Auditability?*
- **Materiality under §18:** **L3 Strategic** (informs product-strategy whitespace, not an external/
  investment-grade public claim). L3 requires ≥ Strong evidence for critical claims and an independent
  Critical Reviewer — the latter was **not** formally separated in Mission #001 (author = reviewer). Noted
  as a process gap, not a conclusion error.

---

## 2 · Decomposition of the major conclusions into atomic claims (§4.4)

Mission #001 stated four bundled conclusions (C1–C4). NH-ROP requires atomic claims. Decomposition:

| NH-ROP claim | From | Statement (atomic) | Claim type (§5) |
|---|---|---|---|
| `M001R-C1a` | C1 | No **single generic cross-domain software product** demonstrating all eight stages independently was found in the reviewed scope. | **Negative + Universal** |
| `M001R-C1b` | C1 | In particular, no product demonstrates **no-double-count Attribution + Proof-of-returned-revenue + tamper-evident Audit** as one traceable loop. | Negative + Capability |
| `M001R-C2a` | C2 | Where proof of returned revenue is strongest, it is **money-anchored** (dispute/contingency/collections) and **domain-specific or services-led**. | Descriptive / Comparative |
| `M001R-C2b` | C2 | Rigorous **causal/holdout** proof of recovery is **absent from recovery software** (mature only in marketing/ad-tech). | Negative (scoped) |
| `M001R-C3a` | C3 | A **near-complete chain is assemblable** from existing systems. | Feasibility |
| `M001R-C3b` | C3 | …but **only** with substantial integration, consulting, and manual attribution; the recovery-attribution-proof loop is native nowhere. | Feasibility / Negative |
| `M001R-C4a` | C4 | Vendor "recovery/savings" numbers routinely **blend Observed/Estimated/Forecast/Proven**. | Descriptive |
| `M001R-C4b` | C4 | Under a strict standard (collected cash + methodology + independent verification), **no researched vendor reaches "Proven Returned Revenue."** | Outcome / Financial |

**Test 1 (Claim atomicity) result:** the bundled conclusions decompose cleanly into 8 atomically-verdictable
claims. Notably C1 and C3 were **compound** (an existence-negative *and* a capability-negative; a feasibility
*and* a "native nowhere" negative). NH-ROP would have forced this split at Phase 4 — a genuine improvement.

---

## 3 · Evidence mapping & lineage check (§7–§8)

Representative material evidence, re-examined for **independence lineage** (the check Mission #001 did
informally but did not record as objects):

| Claim | Key evidence | Lineage finding (§8) |
|---|---|---|
| `M001R-C1a/b` | Primary vendor/technical docs (SAP BRIM, Oracle RMCS, ServiceNow, Celonis, HighRadius) + absence of any doc showing the full loop | Multiple **independent** primary lineages (each vendor's own docs). Negative rests on breadth of independent non-findings — appropriate for a negative claim, but bounded by search universe (see §5 unknowns). |
| `M001R-C2a` | PRGX/apexanalytix/Big-Four contingency-recovery model; SupplyPike "$1B" | **Mixed.** Model facts = primary/independent; the **aggregate dollar figures are single-lineage vendor/firm-reported** (one origin each), not independently audited. |
| `M001R-C4a` | Holdout evidence "14% actual vs 40% claimed" | Third-party/critique lineage (dunning-vendor comparisons). **One analytical lineage** — strong as a *contradiction* to vendor claims, but itself not multi-lineage. Flagged. |
| `M001R-C4b` | Stripe "55%" vs third-party "25–35%"; Waystar "$15.5B" | v1.1 already collapsed these to their origin lineage and reclassified (Contested / Prevented-Exposure). **The outcome-ladder (§12) worked.** |

**Test 3 (False independence) result:** applying §8 confirms Mission #001's instinct — the vendor outcome
numbers are **single-lineage** and were correctly *not* treated as independently confirmed. NH-ROP tightens
this by naming lineages explicitly; it changes **no** verdict.

---

## 4 · Verdict & confidence reassignment under NH-ROP (§10–§11)

| Claim | Mission #001 wording | NH-ROP verdict | NH-ROP confidence | Rationale (plain language) |
|---|---|---|---|---|
| `M001R-C1a` | "Survived / Strengthened", High | **Supported (scope-qualified)** — *not* Confirmed | **High within reviewed scope** | A **negative + universal** claim (§13): the search universe (US-only English index, no private/enterprise-internal, no non-English) was **not** exhausted, so the verdict may not be "Confirmed." "No credible evidence found in reviewed sources" is the correct ceiling — which Mission #001 already used. |
| `M001R-C1b` | part of C1, High | **Supported (scope-qualified)** | High within scope | Same reasoning; the specific no-double-count+proof+tamper-evident loop was sought across independent lineages and not found. |
| `M001R-C2a` | Strengthened, High | **Confirmed (narrow scope)** | **High** | Direct primary evidence of money-anchored, domain-bound recovery across several independent domains; scope explicitly "where strongest." |
| `M001R-C2b` | Strengthened, High | **Supported** | Moderate–High | Absence-in-software is a scoped negative; holdout maturity in marketing is positively evidenced. |
| `M001R-C3a` | Strengthened, Medium-High | **Supported** | **Medium-High** | Assemblability is inferred from independent product capabilities; no end-to-end assembly was directly observed. Correctly not "Confirmed." |
| `M001R-C3b` | Strengthened (nuanced), Medium-High | **Supported** | Medium-High | "Native nowhere" is a scoped negative consistent with C1. |
| `M001R-C4a` | Strengthened (14% vs 40%), High | **Confirmed** | **High** | Directly evidenced by the holdout critique + the vendor-number heterogeneity observed throughout. |
| `M001R-C4b` | v1.1 standard | **Confirmed** | **High** | Follows from applying the outcome standard (§12) to every profiled vendor; a definitional/standard-based verdict. |

**Net verdict change:** the only substantive tightening is **C1: "Confirmed/Survived" → "Supported
(scope-qualified)."** This is **not** a weakening of the finding — it is the honest ceiling for a
negative+universal claim, and Mission #001's own language ("no credible evidence found," residual unknowns,
reopen conditions) already respected it. NH-ROP makes the scope-qualification a **verdict-level** fact rather
than a footnote.

---

## 5 · Hidden assumptions & unknowns (§4.7–§4.8) surfaced by NH-ROP

**Assumptions Mission #001 relied on but did not register as objects:**
| ID | Assumption | Risk if false | NH-ROP status |
|---|---|---|---|
| `M001R-A1` | The **English, US-indexed public web** is representative of the global capability reality. | **Moderate** (could hide a non-English/private full-chain product) | Open — accepted-risk; drives C1's scope-qualification |
| `M001R-A2` | Vendor **primary docs** reflect **shipped** capability, not roadmap. | Moderate | Open — mitigated by the "announced ≠ available" rule, but not per-claim verified |
| `M001R-A3` | A blocked primary (xfactrs, 403) does not hide a disconfirming capability. | Low–Moderate | Open — correctly recorded as Unknown, not assumed favorable |

**Unknowns Mission #001 *did* preserve well** (§16 residual unknowns): non-English/regional systems,
enterprise-internal systems, proof internals of HighRadius/Waystar/Machinify, xfactrs-beyond-detection. Under
NH-ROP these are `Open / Isolated`, **non-blocking** for the L3 strategic decision → completion by
**Unknown Isolation** is justified.

**Test 8 (Contradiction preservation):** the strongest counter — "*SAP BRIM + a recovery specialist + a
holdout discipline ≈ full chain*" — was **preserved and rebutted** in §19 (no *single* system; cross-system
still lacks native no-double-count attribution + immutable proof). NH-ROP would log this as a
`Scope-qualified` contradiction, exactly as handled. **Pass.**

---

## 6 · Completion re-examination (§14) — the one corrected conflict

Mission #001's header reads **"Closed — Evidence-Complete for Current Research Scope."** Under NH-ROP,
"Evidence-Complete" is an **aspirational label with no objective test behind it** (the conflict named in the
Existing-State Audit and NH-ROP §1). Re-stated against §14:

- **Minimum conditions:** decision & scope explicit ✅ · claims registered ⚠️ (only *after* this
  retrospective's decomposition; Mission #001 registered conclusions, not atomic claims) · support **and**
  contradiction examined ✅ · lineage checked ✅ (informally; now explicit) · contradictions preserved ✅ ·
  unknowns isolated ✅ · assumptions visible ⚠️ (surfaced here, not originally registered) · verdicts +
  confidence ✅ · reconstructable ✅ · overturn conditions visible ✅ (§17) · as-of dates ✅ · no critical
  claim on AI-summary-alone ✅.
- **Stop condition:** **Unknown Isolation** + **Diminishing Returns** — the adversarial pass (#001A)
  "did not overturn" C1–C3 and only duplicated existing lineages → **demonstrated**, not asserted.

**Honest completion verdict:** Mission #001 was **legitimately closeable**, but on the correct grounds
(**Unknown Isolation + demonstrated Diminishing Returns**), *not* the vague "Evidence-Complete." The two
gaps (⚠️) are **artifact-structure** gaps (no atomic Claim Registry, no Assumption Registry), not evidence
gaps. NH-ROP would have produced the same conclusions with a cleaner, more auditable trail.

---

## 7 · Failure-mode scan (§19) against Mission #001

| Failure mode | Present? | Note |
|---|---|---|
| Claim inflation | **No** | Verdicts sat at/below evidence; C1 even used "no credible evidence found," not "does not exist." |
| Confidence inflation | **No** | Conclusion-specific confidence, not blanket. |
| Vendor-narrative capture | **No** | v1.1 reclassification actively resisted it (Stripe/Waystar). |
| Citation laundering / false independence | **No** (mitigated) | Single-lineage vendor numbers were not treated as independent. |
| Absence-as-non-existence | **Avoided** | "No credible evidence found in reviewed sources" throughout. |
| Scope drift | **Minor** | C1 stated slightly stronger than its search universe supports → corrected to scope-qualified here. |
| Over-research | **No** | Time-boxed; stopped on diminishing returns. |
| Aspirational completion label | **Yes** | "Evidence-Complete" — the one corrected item (§6). |

---

## 8 · Comparison: original vs protocol-compliant conclusion

| Dimension | Mission #001 (original) | NH-ROP-compliant | Material difference? | Decision impact |
|---|---|---|---|---|
| C1 (no full-chain product) | Confirmed/Survived, High | **Supported (scope-qualified)**, High-within-scope | Wording/verdict-ceiling only | **None** — the whitespace finding stands |
| C2 (proof is domain/services-led, money-anchored) | Strengthened, High | Confirmed (narrow) + Supported, High | None | None |
| C3 (assemblable, not native) | Strengthened, Med-High | Supported, Med-High | None | None |
| C4 (numbers blend; none Proven) | Strengthened, High | Confirmed, High | None | None (already the v1.1 result) |
| Completion basis | "Evidence-Complete" | **Unknown Isolation + demonstrated Diminishing Returns** | Basis corrected | None to the decision; improves auditability |
| Artifacts | Prose report | + atomic Claim/Assumption registries | Structure added | Improves reproducibility (Test 12) |

**Bottom line:** Mission #001's **decision-relevant conclusions do not change.** NH-ROP (a) tightens C1 to a
scope-qualified negative, (b) corrects the completion label, and (c) exposes two missing artifact structures
(atomic claims, registered assumptions). None overturn the finding; all make it **more defensible.**

---

## 9 · Did Mission #001 pass, and if not, why?

**Verdict: PASS with refinements.** Mission #001 already embodied much of NH-ROP *avant la lettre* —
conclusion-specific confidence, provenance labels, "no credible evidence found" discipline, preserved
unknowns, explicit reopen/overturn conditions, and (in v1.1) the outcome-proof ladder. The gaps NH-ROP
exposed were, by NH-ROP's own failure taxonomy:

- **Scope ambiguity** (C1 verdict slightly exceeded its search universe) → corrected to scope-qualified.
- **Missing completion rule** ("Evidence-Complete" had no test) → replaced by §14 conditions.
- **Artifact-structure gaps** (no atomic Claim Registry, no Assumption Registry) → the reason NH-ROP exists.

None were **missing/weak evidence**, **source dependence**, **claim inflation**, **inadequate contradiction
testing**, or **inappropriate certainty** — the more dangerous failure classes. That Mission #001 passes on
substance while failing only on *structure* is the strongest available evidence that NH-ROP is calibrated:
it catches real gaps without manufacturing problems (Test 14 + Test 15).

---

## 10 · Feedback into NH-ROP (one improvement, then freeze — §20 Test 14)

The retrospective surfaced **one** protocol improvement, now incorporated into NH-ROP v1.0 §14:
completion **must** name a *demonstrated* stop condition (not a narrative label), and "Diminishing Returns"
requires the explicit demonstration test. No **critical contradiction** in NH-ROP was found, so the
Mission #002 version is frozen per §21.
