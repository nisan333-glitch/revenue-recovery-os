# Mission #003 — Proposed Improvements to NH-ROP (recommendations only)

> **CHANGE FREEZE (brief §9):** NH-ROP v1.0 is frozen. Nothing here is applied. `NH_RESEARCH_OPERATING_
> PROTOCOL.md`, its schemas, and templates were **not** modified during Mission #003. Each item below carries:
> problem · validation evidence · severity · frequency · impact · proposed change · risk of the change ·
> required-before-further-use? Ranked by (severity × frequency).

## I-1 — "Primary-access-blocked" evidence flag  ·  Severity: **Medium**  ·  Frequency: **High**
- **Problem:** in practice, most primary sources bot-block automated fetch (HTTP 403). NH-ROP tells you to
  prefer primaries and cap verification without them, but offers **no explicit state** for "primary exists
  but was inaccessible to me," which is different from "no primary exists" and from "unverified."
- **Validation evidence:** `M003-EV-01` — 8 domains 403'd; 5 of 6 reports could only be reached via secondary.
- **Impact:** verification-status and reproducibility suffer; reviewers can't tell *why* a claim is capped.
- **Proposed change:** add an Evidence-schema enum value `verification_status: "Primary-Access-Blocked"` and a
  Source field `access_result` (OK / 403 / paywall / offline). Purely additive.
- **Risk of change:** low; slight schema growth. Could be misused to excuse shallow research → mitigate by
  requiring a recorded access attempt.
- **Required before further use?** **No** (workaround: use `Unknown` + a note). Recommended for v1.1.

## I-2 — Abbreviated evidence-scoring fast-path for claim-dense / low-materiality work  ·  Severity: **Medium**  ·  Frequency: **Medium**
- **Problem:** §7's 12-dimension scoring is right for material claims but disproportionate when a mission has
  30+ claims or is L1/L2. §18 *permits* proportionality but gives **no concrete abbreviated procedure**, so
  the researcher improvises (I scored **gating** dimensions qualitatively and skipped the rest).
- **Validation evidence:** `M003-EV-08` (Overhead candidate across R2/R3/R4/R6).
- **Impact:** overhead + inconsistency between researchers on *how* to abbreviate.
- **Proposed change:** codify a "gating-only" fast path in §7/§18 — for L1/L2 or >20 claims, score only the
  three gating dimensions (Independence, Verifiability, Scope) and record the rest as "not separately scored,"
  reserving full 12-dimension scoring for L3/L4 critical claims.
- **Risk of change:** medium — a fast path can be abused to skip rigor on a claim that *deserved* full scoring;
  mitigate by tying it to materiality, not convenience.
- **Required before further use?** **No**; improves ergonomics. Recommended for v1.1.

## I-3 — Distinguish "Scope-qualified" from "Contested"  ·  Severity: **Low-Medium**  ·  Frequency: **Medium**
- **Problem:** a claim that is **true-but-unrepresentative** (Stripe's 55% blends B2B/B2C) is not the same as
  a claim with genuinely conflicting evidence, yet both landed under **Contested** (+ a scope note). "Contested"
  reads as "probably false," which understates a claim that is *accurate within a narrower scope*.
- **Validation evidence:** `M003-EV-09` (Ambiguity, R5-C2).
- **Impact:** minor mislabel/misread risk in the Verdict.
- **Proposed change:** allow a **verdict qualifier** `scope-qualified` orthogonal to the status (e.g.,
  "Supported · scope-qualified"), OR add explicit guidance that "Contested" requires *conflicting* evidence,
  not merely *aggregation across segments*. (NH-ROP already has "Partially Supported" — clarify the boundary.)
- **Risk of change:** low, but **touches the controlled verdict vocabulary** (§10) → must not multiply statuses;
  prefer a qualifier field over a new status.
- **Required before further use?** **No**; a documentation clarification would suffice short-term.

## I-4 — Explicit "discovery-only" source tag  ·  Severity: **Low**  ·  Frequency: **High**
- **Problem:** search-engine result summaries (and AI summaries) are legitimately used for **discovery** but
  are forbidden as **evidence** (§6). There is no schema marker separating a source used only to *find* a claim
  from one used to *support* it, so the discipline lives entirely in the researcher's head.
- **Validation evidence:** `M003-EV-14` (Usability Friction).
- **Impact:** risk that a discovery snippet silently becomes an evidence citation.
- **Proposed change:** add Source field `role: discovery-only | evidence` and forbid `discovery-only` sources
  from appearing in a claim's `supporting_evidence`.
- **Risk of change:** low; additive.
- **Required before further use?** **No.**

## I-5 (governance, not a protocol defect) — Independence of review is unfilled without agents  ·  Severity: **High** for L3/L4  ·  Frequency: **structural**
- **Problem:** NH-ROP §17 mandates a Critical Reviewer *distinct from the author* for L3/L4, and §17 defines an
  "AI Agent" role — but **no NH agent implementation exists** to provide independent review. In Missions #001,
  #002 and #003 the founder filled every role, so the Trust-Invariant "beneficiary ≠ sole verifier" is **not
  operationally satisfied**.
- **Validation evidence:** `M003-EV-15` — Integrated NH Multi-Agent Validation NOT EXECUTED (no `.claude/agents/`,
  no executable NH decision-engine).
- **Impact:** L3/L4 verdicts (including NH-ROP's own adoption) lack independent ratification.
- **Proposed change (governance, not v1.1 text):** either (a) implement invokable NH validation agents
  (adversarial-challenge, evidence-audit, contradiction-search, verdict/confidence-calibration, FP/FN-hunt,
  reconstruction), or (b) require a human reviewer distinct from the author before any L3/L4 mission closes.
- **Risk of change:** building agents is a real scope decision (subject to NH's own Build Filter) — do not
  build speculatively; gate on a concrete consumer.
- **Required before further use?** **Yes, for L3/L4 external-grade conclusions**; **No** for L1/L2.

## Ranking (severity × frequency)
1. **I-5** (High × structural) — blocks independent L3/L4 validation (governance).
2. **I-1** (Medium × High) — access-blocked evidence state.
3. **I-2** (Medium × Medium) — abbreviated scoring fast-path.
4. **I-3** (Low-Med × Medium) — scope-qualified vs contested.
5. **I-4** (Low × High) — discovery-only source tag.

**None of I-1…I-4 is required before continued L1–L3 use of NH-ROP.** I-5 is required before NH-ROP (or any
mission) is used to produce an **externally-represented (L4)** conclusion.
