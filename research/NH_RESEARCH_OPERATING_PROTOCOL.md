# NH Research Operating Protocol (NH-ROP)

> **Status:** Mission #002 candidate — **draft pending Nisan's explicit approval** (no commit/push performed).
> **Protocol version:** 1.0 (Mission #002) · **Drafted:** 2026-07-17 · **Owner:** Founder (nisan333@gmail.com)
> **Scope of authority:** the mandatory operating standard for **all future NH research missions**.
> **Not part of the Product Constitution** (`CLAUDE.md`). It governs *how NH researches*, never what the
> product is. Where it touches product truth (revenue-proof claims) it **inherits** the Constitution's
> Trust Invariant — it does not restate or weaken it.
> **Machine-readable structures:** `research/schemas/*.schema.json`. **Blank artifacts:** `research/templates/`.

---

## 0 · Purpose & one-paragraph model

NH-ROP makes NH research **evidence-driven, claim-based, traceable, reproducible, falsifiable, explicit
about uncertainty, resistant to vendor claims and confirmation bias, and revisable without rewriting
history.** The fundamental unit of research is the **Claim** — not a document, company, product, or search
result. A research mission decomposes a decision-relevant question into atomic claims; each claim collects
**evidence items** drawn from **sources** grouped by **independence lineage**; each material claim is
cross-examined, its contradictions resolved or preserved, independently reconstructed, then assigned a
**verdict** and a separately-recorded **confidence**. **Assumptions** and **unknowns** are first-class
objects. Research **completes** only when objective conditions are met, and every material change is
recorded in a **revision log** that supersedes rather than erases. History is preserved in git.

**Reading order for a new researcher/agent:** §1 principles → §4 object model → §5 claim types → §9
workflow → §10 verdicts → §11 confidence → §14 completion → §15 artifacts. Everything else is reference.

---

## 1 · Non-negotiable principles (the protocol protects these)

1. We do not fall in love with ideas. We follow reality.
2. A persuasive statement is not evidence.
3. A repeated statement is not necessarily independently confirmed.
4. A vendor claim is not operational proof.
5. Absence of public evidence is not proof of absence.
6. Unknown remains Unknown until evidence changes it.
7. Every important conclusion is connected to its supporting **and** contradicting evidence.
8. Every material assumption is visible.
9. Confidence reflects **evidence strength**, not writing confidence.
10. Conclusions are revisable without deleting their prior history.
11. Research must not manufacture certainty to make a report look complete.
12. NH must be able to explain how it reached a conclusion and what could overturn it.
13. The protocol distinguishes **discovery, inference, validation, and proof**.
14. The protocol prevents circular sourcing and false source independence.
15. Research quality outranks the quantity of collected sources.

**Conflict rule (binding):** where any existing NH document conflicts with these principles, the conflict
is **named and corrected**, not silently preserved. One such conflict was found and corrected in Mission
#001 (see `missions/mission-001/MISSION_001_RETROSPECTIVE.md` → the "Evidence-Complete" completion label).

---

## 2 · Alignment with NH's four pillars

NH-ROP is the research-layer expression of NH's **Trust · Proof · Recovery · Organizational Learning**:

- **Trust** — *the beneficiary never determines the number.* In research this becomes: **the researcher
  who prefers a conclusion may not author its verdict unchallenged.** Material claims require an
  independent Critical Reviewer (§17). A verdict may never exceed evidence strength (§10).
- **Proof** — the product's ledger discipline (Opportunity ≠ Returned ≠ Auditable) is mirrored by the
  **research verdict ladder** (§10) and the **outcome/revenue-proof ladder** (§12): discovery ≠ inference
  ≠ validation ≠ proof.
- **Recovery** — research exists to support **decisions** (§9 Phase 1). A report that changes no decision
  is not "complete," it is unscoped.
- **Organizational Learning** — learning changes **future** verdicts only; it never rewrites historical
  proof. Revisions **supersede** (new linked version), consistent with the Constitution's learning
  constraint. This mirrors invariant #6 of the product Trust Invariant.

---

## 3 · Inheritance, not duplication (single source of truth for shared concepts)

Concepts that already exist in NH are **inherited**, not re-defined here:

| Concept | Authoritative home | NH-ROP use |
|---|---|---|
| Evidence labels `[F]/[E]/Verified/Partially Verified/Vendor Claim/[A]/[H]/Unknown` | Mission report headers | Carried into the Evidence object's `evidence_type` / `verification_status` |
| Revenue proof ladder & two ledgers (Opportunity/Returned/Auditable) | `CLAUDE.md`, `docs/PROOF_MODEL.md` | Generalized in §12 as the **outcome-proof ladder**; product ledger terms are inherited verbatim |
| Trust Invariant (beneficiary never determines the number) | `CLAUDE.md` | Inherited as the research author/reviewer separation (§17) |
| Governance-by-supersession (freeze, reopen, git history) | `RESEARCH_REGISTER.md`, Mission #001 §18a | Formalized in §16 (SSOT) and the Revision Log artifact |
| Conclusion-specific confidence | Mission #001 §2 | Formalized as the confidence standard (§11) |

If any of these change, they change in their authoritative home first; NH-ROP follows.

---

## 4 · Research object model

Nine canonical objects. Each has a stable ID, an owner, and a version history. IDs are mission-scoped and
human-readable: `M001`, `M001-Q1`, `M001-H1`, `M001-C1` (claim), `M001-C1-E3` (evidence), `S014` (source),
`M001-A2` (assumption), `M001-U5` (unknown), `M001-X1` (contradiction), `M001-C1-V2` (verdict revision 2).

**Relationships (text ER):**
`Mission 1—* Question 1—* Hypothesis 1—* Claim *—* Evidence *—1 Source`; `Source *—1 Lineage`;
`Claim *—* Assumption`; `Claim *—* Unknown`; `Claim/Evidence *—* Contradiction`; `Claim 1—1 current Verdict
1—* Verdict history`.

### 4.1 Research Mission
`mission_id · title · decision_supported · research_question · scope · out_of_scope · stakeholders ·
materiality_level (§18) · time_sensitivity · geographic_scope · industry_scope · start_date · as_of_date ·
owner · reviewer · status {Framing|Scoping|Active|In-Review|Closed|Reopened} · completion_status (§14) ·
revision_history`.

### 4.2 Research Question
Must be **answerable, bounded, and tied to a decision.** Field: `question_type` ∈ {Descriptive,
Comparative, Causal, Technical-feasibility, Market-existence, Competitive-differentiation, Legal/regulatory,
Strategic-decision}. Normally-required evidence per type:

| Question type | Normally required to answer well |
|---|---|
| Descriptive | Primary/official documentation of the state described; as-of date |
| Comparative | Like-for-like definitions, same period/scope for each item, independent measurement of the compared dimension |
| Causal | Baseline + counterfactual/holdout or a credible identification strategy; correlation alone is insufficient |
| Technical-feasibility | Directly inspectable artifact/test/spec, or independent technical audit |
| Market-existence | Systematic search across terminology families + counterexample search; explicit as-of date (§13) |
| Competitive-differentiation | Independent capability evidence for each competitor; vendor self-claims insufficient alone |
| Legal/regulatory | Primary statute/regulation/standard text + qualified review; scoped and dated |
| Strategic-decision | Synthesis over the above with explicit decision implications and overturn conditions |

### 4.3 Hypothesis
A **provisional answer to be tested, not defended.**
`hypothesis_id · statement · basis · expected_supporting_observations · expected_disconfirming_observations
· status {Open|Supported|Weakened|Rejected|Superseded} · related_claims · revision_history`.

### 4.4 Claim (the fundamental unit)
Atomic enough to evaluate independently.
`claim_id · statement (exact) · claim_type (§5) · scope · subject · predicate · time_period · geography ·
population_or_market · materiality · origin {who first asserted it} · related_hypothesis ·
supporting_evidence[] · contradicting_evidence[] · dependencies[] · assumptions[] · current_verdict (§10) ·
confidence (§11) · reviewer · last_reviewed · overturn_conditions · version_history`.

**Decomposition rule — split any compound claim until each part is atomically verdictable.** A claim is
atomic when it has **one subject, one predicate, one scope, one time period**, and can receive a single
verdict without the verdict needing an "except…" clause. Worked example (mandatory pattern):

> "Platform X **identifies revenue leakage and proves recovered revenue across all departments.**"

decomposes into independently-verdicted claims:

| Sub-claim | Claim type |
|---|---|
| X detects anomalies/leakage signals | Capability |
| X's "revenue leakage" uses a defined, consistent definition | Definitional (assess as part of Capability/Performance) |
| X covers all departments (universal) | Universal + Coverage |
| X assigns or executes an intervention | Capability |
| X attributes recovered dollars to its intervention | Causal |
| X proves recovered revenue (collected, methodology, independent verification) | Outcome/Proof |
| X's proof is auditable/tamper-evident | Technical/Security |
| X generalizes across use cases (not one case study) | Universal/Generality |

A verdict is assigned to **each**, never to the marketing sentence as a whole.

### 4.5 Evidence Item
Evidence is **not** a URL — it is a specific finding tied to one claim.
`evidence_id · source_id · claim_id · exact_finding · direction {Supports|Contradicts|Limits|Contextualizes}
· evidence_type · extraction_method · quote_or_precise_paraphrase · location {page/section/timestamp/data
locus} · date_published · date_accessed · applicable_scope · limitations · quality_dimensions (§7) ·
independence_group (§8) · researcher_notes · verification_status {Verified|Partially-Verified|Unverified|
Vendor-Claim|Unknown}`.

### 4.6 Source
`source_id · title · author_or_org · publisher · url_or_internal_location · publication_date · access_date ·
source_type (§6) · primary_or_secondary · commercial_interest · methodology_disclosed {yes/no/partial} ·
data_availability · retraction_or_correction_status · independence_group (§8) · reliability_notes ·
version_or_archive_info`.

### 4.7 Assumption
`assumption_id · statement (exact) · why_needed · claims_affected[] · evidence_status · risk_if_false
{Low|Moderate|High|Fatal} · validation_method · owner · status {Open|Validated|Invalidated|Accepted-risk}`.

### 4.8 Unknown (first-class)
`unknown_id · exact_open_question · why_it_matters · claims_affected[] · materiality · search_attempts[] ·
missing_evidence · blocks_decision {yes/no} · recommended_next_action · status {Open|Isolated|Resolved|
Dependency-blocked}`. **Unknowns may never silently default to "no problem."** An unresolved material
unknown that blocks a decision **prevents** completion by decision-sufficiency (§14).

### 4.9 Contradiction (first-class)
`contradiction_id · claims_or_evidence_in_conflict[] · nature_of_conflict · possible_explanations[] ·
scope_differences · date_differences · definition_differences · methodological_differences · resolution_status
{Open|Resolved|Scope-qualified|Time-qualified|Definition-qualified|Methodologically-unresolved|Material-
remains} · impact_on_verdict · required_follow_up`. A material contradiction stays **visible** until resolved
(acceptance Test 8).

### 4.10 Verdict
States **what the evidence justifies, not what the researcher prefers.**
`verdict_status (§10) · claim_statement · evidence_summary · strongest_support · strongest_contradiction ·
scope_of_validity · confidence (§11) · remaining_unknowns[] · assumptions[] · overturn_conditions ·
review_date · reviewer`.

---

## 5 · Claim taxonomy (controlled)

`claim_type` is one of: **Existence · Capability · Performance · Outcome · Causal · Comparative ·
Market-size · Adoption · Customer · Technical · Integration · Security · Compliance · Financial · Strategic ·
Negative · Universal · Forecast.** For each type:

| Claim type | Typical evidence required | Common failure mode | Minimum acceptable validation | Can vendor evidence alone suffice? | Special burden |
|---|---|---|---|---|---|
| Existence | Primary artifact/doc showing the thing exists | Naming a roadmap item as existing | One direct primary source | Yes, for *documented* existence only | — |
| Capability | Inspectable feature/spec/demo | Documented ≠ works reliably | Primary doc **+** one independent or operational signal | No (documents feature, not reliability) | — |
| Performance | Method + numbers + definitions | Cherry-picked window; undefined metric | Disclosed methodology + independent or reproducible figure | No | Elevated |
| Outcome | Observed result with baseline | Output mistaken for outcome | Baseline + measured result | No | Elevated |
| Causal | Baseline + counterfactual/holdout | Correlation as causation | Identification strategy (holdout/matched/pre-post) | No | **High** |
| Comparative | Like-for-like independent measurement | Apples-to-oranges scope | Same definition/period/scope both sides | No | Elevated |
| Market-size | Transparent model + inputs | Circular vendor TAM | Independent data or disclosed, checkable model | No | Elevated |
| Adoption | Independent usage evidence | Availability ≠ adoption | Independent customer/usage data | No | Elevated |
| Customer | Named reference + verifiable detail | Testimonial as proof of causation/generality | Reference checkable; scope stated | No (reported experience only) | — |
| Technical | Spec/standard/inspectable behavior | Announced ≠ shipped | Primary technical artifact or test | Partial | — |
| Integration | Documented + working connector evidence | "Supports X" without depth | Primary doc + operational signal | Partial | — |
| Security | Certification/audit/standard | Marketing "bank-grade" | Independent certification/audit reference | No | Elevated |
| Compliance | Primary regulation text + attestation | Scope/date drift | Primary reg + qualified review | No | **High** (dated + scoped) |
| Financial | Auditable figures + method | Claimed ≠ collected | Documented method + independent/audited figure | No | **High** |
| Strategic | Synthesis over verified claims | Narrative over evidence | Traceable to underlying verdicts | No | — |
| Negative | Systematic search of a defined universe | Absence-as-proof | Defined universe + counterexample search + as-of date (§13) | N/A | **High** |
| Universal ("all/every") | Coverage evidence across the whole set | One case → all | Evidence spanning the claimed set, or scope-qualification | No | **High** |
| Forecast | Model + assumptions + track record | Forecast as fact | Disclosed model/assumptions; never counted as realized | No | Elevated; never "collected" |

**Absolute-language trigger:** the words **"first, only, all, none, every, automatic, autonomous, proven,
guaranteed, best, no one else"** automatically raise the burden of proof and, for negative/universal claims,
require the §13 search-universe discipline. Absent that, the verdict may not exceed **Supported** and the
language must be softened per §13.

---

## 6 · Source & evidence hierarchy (a prior, not a verdict)

Ranked *prior* on reliability — **never an automatic verdict**:

1. Original data / directly inspectable system evidence
2. Official regulatory, legal, standards material
3. Peer-reviewed research
4. Independent technical tests or audits
5. Company documentation
6. Company case studies
7. Customer evidence
8. Reputable industry research
9. High-quality journalism
10. Expert interpretation
11. Aggregators
12. Community posts
13. Anonymous claims
14. AI-generated summaries

**Binding qualifications (override the ranking):**
- A **primary** source can still be biased, incomplete, or methodologically weak.
- A **secondary** source can synthesize better than a weak primary one.
- **Vendor documentation** proves a feature is *documented* — not that it *works reliably* or *creates
  business outcomes*.
- **Customer testimonials** establish *reported experience* — rarely causation or generalizability.
- **Search-result snippets** are discovery aids, **not** final evidence. (Mission #001 rule: never upgrade
  a claim on snippets alone.)
- **AI output is not an independent source** and is never counted as independent confirmation (Test 13).
- **N pages repeating one original claim are one evidence lineage, not N confirmations** (§8, Test 3).

---

## 7 · Evidence Quality Framework

Every **material** evidence item is scored on 12 dimensions, `0–5` (`0 Not assessable · 1 Very weak · 2
Weak · 3 Moderate · 4 Strong · 5 Very strong`):

1. **Directness** — tests the claim directly vs. indirectly.
2. **Source proximity** — closeness to the underlying event/system/data.
3. **Independence** — independent of the claimant *and* of other evidence items (§8). **[GATING]**
4. **Methodological transparency** — methods/definitions/sampling/calculations visible.
5. **Reproducibility** — another reviewer can repeat/inspect the process.
6. **Verifiability** — the underlying evidence can be checked. **[GATING]**
7. **Specificity** — matches the exact population/period/geography/capability of the claim. **[GATING for scope]**
8. **Freshness** — current enough for the claim (§13 freshness).
9. **Completeness** — full relevant result vs. a selected slice.
10. **Conflict of interest** — does the source benefit from the conclusion? (low score = high COI)
11. **Consistency** — consistent with other independent high-quality evidence.
12. **Statistical/operational strength** — sample, baseline, controls, comparison, measurement adequacy.

**How scores combine (no false precision):**
- Verdicts are **not** a simple average of dimensions. Dimension scores *inform* an **evidence-strength
  category**, they do not compute it.
- **Gating dimensions** (Independence, Verifiability, Scope-specificity) are **fatal-flaw gates**: a `0–1`
  on any gate **caps** the item at **`Weak` or below**, regardless of the other scores. A high total never
  compensates for a fatal flaw (wrong scope, no independence, unverifiable data).

**Evidence-strength categories (operational):**

| Category | Operational criteria |
|---|---|
| **Inadmissible** | Fails a gate outright (e.g., anonymous + unverifiable; AI summary as sole basis; wrong scope with no qualifier) — carries **no** weight toward a verdict. |
| **Weak** | Relevant but hits a gate at `1`, or indirect + low transparency. Can support *context*, not a Confirmed verdict. |
| **Limited** | Passes gates at `2`, direct-ish, partial transparency; supports at most **Partially Supported / Supported**. |
| **Moderate** | Gates ≥ `3`, direct, transparent, single-lineage; supports **Supported**; with corroboration approaches Confirmed. |
| **Strong** | Gates ≥ `4`, direct, transparent, reproducible/verifiable, scope-matched, ≥1 independent lineage. |
| **Very strong** | Gates = `5`, directly inspectable/independently audited, reproducible, scope-exact, multi-lineage independent. |

---

## 8 · Source independence & evidence lineage

**False independence is the primary vendor-narrative attack.** Sources are grouped into one **lineage**
when they descend from a common origin: same press release · same company dataset · same customer case
study · same analyst report · same interview · same undocumented statistic · one article copied/paraphrased
by others · a vendor claim repeated by partners/affiliates · AI summaries of the same original material.

**Lineage object:** `lineage_id · original_source · dependent_sources[] · independence_status
{Independent|Derived|Unknown} · adds_new_verification {yes/no — and what}`.

**Counting rule (binding):** **N sources in one lineage count as one confirmation.** A claim reaches
"multiple independent confirmations" only across **distinct lineages** that each add *new* verification.
When lineage cannot be established, mark `Unknown` and treat as *potentially derived* (do not credit as
independent). This is acceptance Test 3.

---

## 9 · Research execution workflow (mandatory phases)

**Phase 1 — Decision framing.** Record: the decision this supports · who uses it · cost if the conclusion
is wrong · required confidence · time sensitivity · materiality. *No broad searching before the decision and
question are defined.*

**Phase 2 — Scope.** In-scope · out-of-scope · definitions · time/geographic/market/product boundaries ·
comparison set · exclusion rules.

**Phase 3 — Pre-research position (bias firewall).** *Before* reviewing evidence, record: initial
hypothesis · initial assumptions · existing beliefs · expected answer · potential conflicts of interest ·
**what evidence would change the expected answer.** This exposes hindsight bias and conclusion drift; it is
compared against the final verdict at completion.

**Phase 4 — Claim decomposition.** Break the question into atomic claims (§4.4). Create a provisional Claim
Registry **before** deep research.

**Phase 5 — Search strategy (per material claim).** Define: primary-source searches · independent-source
searches · **disconfirming searches** · alternative explanations · negative-evidence searches ·
date-sensitive searches · technical/legal searches where relevant · **competing-terminology** searches.
*Search specifically for reasons the claim is wrong.*

**Phase 6 — Evidence collection (claim-level).** Do **not** paste large undifferentiated source dumps. Per
item: extract the relevant finding · attach to a claim · record direction · record scope · record
limitations · record lineage.

**Phase 7 — Cross-examination (per material claim).** Ask, at minimum:
strongest support? strongest opposition? is the source measuring what the claim says? consistent
definitions? correlation sold as causation? capability confused with use? visibility confused with action?
action confused with outcome? outcome confused with **attributable** outcome? attributable outcome confused
with **audited proof**? one use case generalized to a universal claim? absence treated as evidence of
absence? vendor terms accepted without operational definitions? old capability treated as current?
announced treated as available?

**Phase 8 — Contradiction resolution.** Never resolve by picking the preferred source. Test whether
disagreement is from different definitions / populations / geographies / periods / product versions /
methodologies / incentives / levels of analysis / a genuine unresolved conflict. Outcome ∈ {Resolved,
Scope-qualified, Time-qualified, Definition-qualified, Methodologically-unresolved, Material-remains}.

**Phase 9 — Independent reconstruction.** Before a verdict, reconstruct the answer **without** the
claimant's narrative: from the underlying facts, what conclusion do we reach? can it be reproduced from
inspectable evidence? does the reconstruction match the original claim? which parts survive? which depend on
interpretation/marketing?

**Phase 10 — Verdict.** Apply §10.

**Phase 11 — Completion review.** Test §14 conditions.

**Phase 12 — Revision log.** Record what changed, why, which evidence caused it, which verdict was
superseded, what remains unresolved. **Never delete a prior material conclusion; supersede it.**

---

## 10 · Verdict protocol

Every material claim moves **Claim → Evidence → Cross-Examination → Contradictions → Independent
Reconstruction → Verdict.** Controlled statuses (mutually exclusive):

| Status | Meaning |
|---|---|
| **Confirmed** | Strong, sufficiently independent evidence directly supports the claim **within its scope**; no unresolved contradiction materially weakens it. |
| **Supported** | Evidence favors the claim, but limitations/scope/missing validation prevent confirmation. |
| **Partially Supported** | Only part of the claim survives, or it holds only under narrower conditions. |
| **Inconclusive** | Evidence does not justify accepting or rejecting. |
| **Unsupported** | Adequate evidence for the claim was not found, but it is **not disproved**. |
| **Contradicted** | Stronger evidence materially conflicts with the claim. |
| **Refuted** | Strong, direct, reliable evidence shows the claim is **false within its scope**. |
| **Not Assessable** | Cannot be evaluated now — necessary evidence/definition/access unavailable. |
| **Obsolete** | May have been valid before; no longer current. |

**Distinction guards (binding):** Unsupported ≠ Refuted · Inconclusive ≠ Supported · Partially Supported ≠
Confirmed · a claim may be **Confirmed only within a narrow scope** · **a verdict must not be stronger than
the evidence** · **verdict and confidence are separate fields** (§11).

---

## 11 · Confidence standard

Confidence = the researcher's **justified confidence that the verdict is correct within its stated scope**.
Levels: **Very low · Low · Moderate · High · Very high.** Confidence weighs: evidence strength ·
independence · directness · scope match · contradictions · unknowns · assumption dependency · replicability
· freshness · reviewer agreement.

- Confidence is **separate** from verdict (a *Supported* verdict can carry *High* confidence about exactly
  how far the evidence goes; a *Confirmed* narrow-scope verdict can carry *Moderate* confidence).
- **No numeric probabilities** unless the context supports genuine probabilistic estimation.
- **Every verdict states a plain-language reason for its confidence.** Template:
  > *"Moderate confidence: official documentation confirms the capability exists, but no independent
  > operational evidence was found showing consistent results in production."*

---

## 12 · Outcome, revenue & proof claims (enhanced scrutiny)

Because NH operates around Revenue Recovery, revenue/outcome claims carry the **strictest** standard. The
**outcome-proof ladder** — a system that performs one rung must **not** be described as performing later
rungs:

1. Problem observed → 2. Opportunity estimated → 3. Action recommended → 4. Action executed → 5. Operational
outcome observed → 6. Revenue movement observed → 7. Revenue attributed → 8. Revenue collected → 9. Baseline/
counterfactual established → 10. Double-counting excluded → 11. Reversals considered → 12. Audited/
independently verified.

**Ladder guards (each is a distinct claim):** Detection ≠ recovery · Visibility ≠ action · Action ≠ outcome
· Revenue movement ≠ attribution · Attribution ≠ proof · Forecast revenue ≠ collected revenue · A dashboard
≠ an operating system · Workflow automation ≠ causal evidence · A case study ≠ universal product proof.

**Inheritance:** this ladder is the research-side generalization of the product Constitution's ledgers —
**Revenue Opportunity** (rungs 1–2, forecast, never counted), **Revenue Returned** (rung 8+, `Collected −
Baseline`), **Auditable Revenue** (rung 12 subset: recovered + reason + `confidence ≥ PROOF_THRESHOLD` +
positive uplift). NH-ROP does not redefine these; it classifies *external* claims against the same ladder.

**Outcome-claim classification (inherited from Mission #001 v1.1, generalized):** an external claim is
**Proven Returned Revenue** ONLY with all three of (a) collected cash, (b) documented methodology, (c)
independent verification. Absent all three, classify as one of: **Collected — vendor/firm-reported ·
Prevented Exposure / Avoided Loss · Estimated / Quantified Opportunity · Detected / Identified · Contested /
Unverified.**

For any *"revenue recovered / returned / ROI / savings"* claim, **inspect and record**: baseline ·
counterfactual · attribution method · time window · holdout/comparison (where feasible) · claim key ·
duplicate exclusion · reversals/refunds · collection status · evidence owner · audit trail · confidence and
limitations. Missing elements are recorded as **Unknown**, never assumed favorable. This is acceptance
Test 9.

---

## 13 · Negative & universal claims

For claims like *"no competitor does this," "there is no existing solution," "all companies have this,"
"first platform," "works across every department," "no public evidence exists":*

- **Define the search universe** and the **terminology** used (search synonyms + adjacent categories).
- **Record databases/sources reviewed** and **search for counterexamples**.
- **State the as-of date.**
- **Avoid absolutes unless the search burden is genuinely met.** Prefer: *"We did not identify…"* ·
  *"Within the reviewed scope…"* · *"No qualifying public evidence was found as of [date]…"* · *"This does
  not prove no such solution exists."*

**Freshness rule:** date-sensitive claims carry an `as_of_date`; when the product/regulation/market may
have changed since, the claim is flagged **Obsolete-risk** and re-verified before reuse (acceptance Test 7).

---

## 14 · Research completion standard

**Research does not end merely because:** the first plausible answer appeared · many sources were collected
· the preferred conclusion was supported · a deadline nears · results became repetitive · the report looks
long enough.

**Mandatory minimum completion conditions (all must hold):**
1. Decision and scope are explicit. 2. Material claims are registered. 3. Each critical claim was examined
for supporting **and** contradicting evidence. 4. Evidence lineage was checked. 5. Material contradictions
are resolved or explicitly preserved. 6. Unknowns are isolated. 7. Assumptions are visible. 8. Verdicts and
confidence are assigned. 9. The conclusion is reconstructable from the registries. 10. A reviewer can see
what would overturn each important conclusion. 11. Date-sensitive claims have an as-of date. 12. No critical
claim rests solely on an unverified AI summary.

**Justified stop conditions (≥1 required, and documented):**
- **Decision Sufficiency** — evidence supports the required decision at the required materiality.
- **Diminishing Returns** — see the strict test below.
- **Evidence Exhaustion** — accessible evidence universe reasonably covered; further progress needs
  unavailable access/data/interviews.
- **Unknown Isolation** — remaining unknowns are explicit and do **not** block the decision.
- **Dependency Block** — a missing dataset/access/legal interpretation/primary source blocks justified
  progress.
- **Conclusion Overturned** — the premise was materially disproved, making planned research unnecessary.

**"Diminishing Returns" is demonstrated, not asserted** — at least one of: multiple consecutive independent
search paths produced no new material evidence · new evidence only duplicates an existing lineage ·
additional evidence changes no verdict, confidence, or decision implication · remaining unknowns require
non-public access rather than further public search.

Every completion decision is recorded in the **Completion Record** (§15.10).

---

## 15 · Canonical research artifacts

Every completed mission produces these. **Authority is unambiguous:** one artifact owns each object.
Storage format is Markdown for human-readable registries with the fields below; missions **may** additionally
maintain the structured objects as JSON validated by `research/schemas/` when a consumer needs machine
reads (see §16 decision). Templates live in `research/templates/`.

| # | Artifact | Owns | Mandatory fields | Format |
|---|---|---|---|---|
| 15.1 | **Mission Charter** | Mission (§4.1) | decision · question · scope · definitions · materiality · required confidence · stakeholders · time boundary · out-of-scope | MD (+ optional `research-mission.schema.json`) |
| 15.2 | **Claim Registry** | Claims (§4.4) + verdicts + dependencies | all §4.4 fields, one row/claim | MD table (+ `claim.schema.json`) |
| 15.3 | **Evidence Registry** | Evidence (§4.5), claim-level | all §4.5 fields | MD table (+ `evidence.schema.json`) |
| 15.4 | **Source Registry** | Sources (§4.6) + lineage (§8) | all §4.6 fields + lineage | MD table (+ `source.schema.json`) |
| 15.5 | **Assumption Registry** | Assumptions (§4.7) | all §4.7 fields | MD table (+ `assumption.schema.json`) |
| 15.6 | **Unknown Registry** | Unknowns (§4.8) | all §4.8 fields + blocks_decision | MD table (+ `unknown.schema.json`) |
| 15.7 | **Contradiction Registry** | Contradictions (§4.9) | all §4.9 fields | MD table (+ `contradiction.schema.json`) |
| 15.8 | **Research Verdict** | decision synthesis | executive answer · known · supported-not-confirmed · unknown · contradicted · decision implications · risks · overturn conditions · confidence · as-of date | MD (+ `verdict.schema.json` per claim) |
| 15.9 | **Research Revision Log** | change history | what changed · why · which evidence · superseded verdict · what remains | MD table |
| 15.10 | **Completion Record** | closure | which completion conditions met · which stop condition · remaining dependencies · pre-research-position vs final comparison | MD |

**Anti-proliferation decision:** registries that share a lifecycle **may** be maintained in one structured
file with separate human-readable views, **provided authority and ownership remain unambiguous.** Do not
create empty ceremonial files. A mission below **Strategic** materiality (§18) may collapse 15.5–15.7 into
short sections of the Verdict if there are no material assumptions/unknowns/contradictions — but must say so
explicitly.

---

## 16 · Single source of truth & file governance

- **Authority:** the registry named in §15 is authoritative for its object. The Research Verdict is
  **derived** and never introduces a claim not in the Claim Registry.
- **IDs:** mission-scoped, human-readable, **never reused** (§4). A retired claim keeps its ID with status
  `Obsolete`.
- **References:** objects link by ID (claim ↔ evidence ↔ source ↔ lineage). No orphan evidence (every
  evidence item names a `claim_id` and `source_id`).
- **Versions:** every material change appends to `version_history` and the Revision Log. **Superseded
  conclusions are preserved** (git history + Revision Log), never overwritten (Test 10; mirrors Trust
  Invariant #6 & #9).
- **Duplicate prevention:** evidence is de-duplicated by lineage (§8), not by URL count.
- **Freshness:** date-sensitive evidence carries `as_of_date`; stale claims are flagged `Obsolete-risk`.
- **Separation of voice:** human notes (`researcher_notes`) are distinct from verified evidence; **machine/
  AI-generated summaries are labeled** and are never counted as independent evidence.
- **Reviewer approval** is recorded on the Claim/Verdict (`reviewer`, `last_reviewed`).
- **Portability:** structured objects use JSON Schema (`research/schemas/`), model-agnostic and
  application-agnostic. **The system is not designed around one model, app, or interface.**

**Validation-wiring decision (explicit):** schemas are provided as draft 2020-12 JSON Schema for
documentation and future validation. A runtime validator is **not** wired now because (a) no consumer
requires it yet and (b) it would add a dependency (`ajv`) — consistent with NH's "no infra before a
consumer" rule (`ENGINEERING_REGISTER.md` → `DEF-RECWIRE`). **To wire later:** add `ajv` as a dev
dependency and a `research:validate` script that loads each registry's JSON view and asserts it against its
schema; gate it in CI once a mission maintains JSON views. Until then, schemas are the contract that
Markdown registries are filled against.

---

## 17 · Roles & authority

| Role | May | May **not** |
|---|---|---|
| **Research Owner** | frame mission, maintain scope, ensure artifacts complete | **silently strengthen a verdict**; change scope without a Revision Log entry |
| **Researcher** | search, extract, classify, challenge claims, record limitations | assert a verdict beyond evidence; omit contradictions |
| **Critical Reviewer** | attempt to disprove material claims, check lineage, challenge confidence, find missing alternatives | approve their own research |
| **Domain Reviewer** | review technical/financial/legal/market reasoning | — |
| **Decision Owner** | use the research, accept business risk | **rewrite the evidence record to justify a decision** |
| **AI Agent** | assist discovery, extraction, comparison, drafting; must reveal uncertainty and cite sources | **become its own independent evidence**; invent facts; silently remove contradictions; assign **Confirmed** from generated synthesis alone |

**Independence requirement (Trust inheritance):** for **Strategic** and **High-stakes** materiality (§18),
a material claim's verdict requires a **Critical Reviewer distinct from its author.** The beneficiary of a
larger/cleaner conclusion may not be its sole author, approver, and verifier — the research-layer mirror of
the product Trust Invariant #8.

---

## 18 · Materiality levels

| Level | Name | Required source quality | Independence | Review | Documentation | Acceptable unknowns | Completion threshold | Refresh |
|---|---|---|---|---|---|---|---|---|
| **L1** | Exploratory | any, labeled | not required | self | lightweight (claims + verdict) | many, if non-blocking | Decision-sufficiency or diminishing returns | ad hoc |
| **L2** | Operational | ≥ Moderate for material claims | preferred | self + spot critical review | core registries | isolated, non-blocking | minimum conditions + 1 stop condition | on material change |
| **L3** | Strategic | ≥ Strong for critical claims | **required** for critical claims | **independent Critical Reviewer** | full artifact set | isolated + owner-acknowledged | all minimum conditions | scheduled |
| **L4** | High-stakes / externally represented | Strong–Very strong; primary/independent | **required**, multi-lineage | independent + Domain Reviewer | full set + audit trail | none blocking; each explicitly risk-accepted | all conditions + adversarial review | before every external reuse |

**Proportionality rule:** do **not** apply L4 procedure to an L1 question. Rigor scales with the cost of
being wrong (acceptance Test 15).

**Anti-gaming guard (added from the Mission #002 adversarial review; see completion report §6):** materiality is a lever a beneficiary could pull
*down* to escape independent review. Therefore: (a) the **Research Owner sets** the level and the
**Decision Owner confirms** it — the same person may not both benefit from a conclusion and unilaterally
lower its materiality; (b) **any claim that will be represented externally** (to a customer, investor,
board, auditor, or in public) is **automatically L4**, regardless of initial framing; (c) a mid-mission
finding that raises the cost-of-being-wrong **escalates** the level and is logged in the Revision Log.
Downgrading a level always requires a Revision Log entry and reviewer sign-off.

---

## 19 · Failure modes & guardrails

Each has a **detection signal**, a **prevention rule**, and a **corrective action**.

| Failure mode | Detection signal | Prevention rule | Corrective action |
|---|---|---|---|
| Confirmation bias | evidence only supports the pre-research expectation | Phase 3 firewall + mandatory disconfirming search (Phase 5) | run the missing disconfirming searches; re-verdict |
| Authority bias | "big name says so" substitutes for evidence | rank is a prior, not a verdict (§6) | demand direct evidence for the claim |
| Vendor-narrative capture | claim language mirrors vendor marketing | operational-definition test (Phase 7) | reconstruct independently (Phase 9) |
| Search-ranking bias | only top results cited | competing-terminology + negative searches (Phase 5) | broaden the search universe |
| Recency bias | newest source treated as truest | freshness scored, not assumed (§7.8) | weigh by quality, not date alone |
| Survivorship bias | only success stories present | negative-evidence search (Phase 5) | seek failures/disputes |
| Availability bias | easy-to-find = important | claim-driven search, not source-driven (Phase 6) | map claims first, then search |
| Cherry-picking | selected slice, not full result | Completeness dimension (§7.9) | require the full relevant result |
| Citation laundering | many links, one origin | lineage grouping (§8) | collapse to one lineage; recount |
| Circular sourcing | A cites B cites A | lineage `original_source` trace (§8) | mark derived; discount |
| Double-counting sources | "N confirmations" all derived | one-lineage-one-confirmation (§8) | recount by distinct lineage |
| Double-counting outcomes | same dollars counted twice | claim key + duplicate exclusion (§12) | dedupe; record exclusion |
| Scope drift | verdict broader than evidence scope | Scope-specificity gate (§7.7) | scope-qualify the verdict |
| Definition drift | term changes meaning mid-analysis | definitions fixed in Phase 2 | restate definition; re-verdict |
| Claim inflation | verdict stronger than evidence | verdict ≤ evidence rule (§10) | downgrade verdict |
| Confidence inflation | writing-confidence ≠ evidence | confidence rationale required (§11) | rewrite rationale; adjust level |
| Correlation as causation | causal verdict without identification | causal burden = High (§5) | demand baseline/holdout or downgrade |
| Availability→adoption | "shipped" read as "used" | Adoption is a distinct claim (§5) | require independent usage evidence |
| Adoption→value | "used" read as "valuable" | Outcome distinct from adoption (§12) | require outcome evidence |
| Value→attributable revenue | outcome read as attributed dollars | attribution rung distinct (§12) | require attribution method |
| Marketing→technical fact | slogan cited as spec | primary technical artifact (§5 Technical) | replace with inspectable evidence |
| Announced→production | roadmap read as shipped | Existence vs Capability split (§4.4) | re-classify as Forecast/Existence |
| One example→general proof | single case → universal | Universal burden = High (§5, §13) | scope-qualify to the case |
| No evidence→non-existence | absence read as refutation | Principle 5 + §13 | restate as "not found," not "does not exist" |
| Old→current | stale capability as current | freshness + Obsolete status (§13) | re-verify or mark Obsolete |
| AI as validation | generated text cited as source | AI-not-independent rule (§6, §17) | remove from evidence weight |
| Over-research | endless search, no decision change | diminishing-returns test (§14) | stop; document the stop condition |

---

## 20 · Acceptance tests (definitions)

NH-ROP is complete only if all 15 critical tests pass. Definitions here; results in
`research/missions/mission-002/MISSION_002_COMPLETION_REPORT.md`.

1. **Claim atomicity** — a compound marketing claim decomposes into independently testable claims (§4.4).
2. **Evidence traceability** — verdict → supporting/contradicting evidence → original source location (§16).
3. **False independence** — five articles from one press release = one lineage (§8).
4. **Vendor claim** — documented feature + no independent outcome evidence ⇒ no "Confirmed business impact"
   (§5, §12).
5. **Unsupported vs Refuted** — not finding evidence ≠ Refuted (§10).
6. **Scope qualification** — one geography/segment ≠ global claim (§7.7, §10).
7. **Freshness** — a previously valid claim is flagged when product/regulation/market may have changed (§13).
8. **Contradiction preservation** — conflicting high-quality sources stay visible until resolved (§4.9).
9. **Revenue proof ladder** — a detected opportunity is not classified as recovered/proven revenue (§12).
10. **Conclusion revision** — new evidence revises a verdict while preserving the prior verdict + reason
    (§16, Revision Log).
11. **Completion** — the protocol explains why research stopped and whether unknowns block the decision (§14).
12. **Reproducibility** — a second reviewer reaches the conclusion from artifacts alone, without private
    memory (§15–16).
13. **AI guardrail** — AI synthesis cannot count as independent evidence (§6, §17).
14. **Mission #001 retrospective** — the protocol audits Mission #001 and yields a clearer, more defensible
    conclusion (retrospective artifact).
15. **Practicality** — rigorous but usable; L1 questions do not incur L4 procedure (§18).

---

## 21 · Change control & governance of this protocol

- This protocol is versioned. **Version 1.0 is frozen at the close of Mission #002** unless a critical
  contradiction remains after the retrospective (§20 Test 14).
- Changes follow NH governance-by-supersession: a substantive change creates **v1.1+** with a Revision Log
  entry; the prior version is preserved in git. Ambiguity is corrected, not preserved (Principle-conflict
  rule, §1).
- NH-ROP does **not** modify the Product Constitution or product code. Where research touches product-truth
  concepts, it **inherits** them (§3, §12).
- **No commit or push occurs without Nisan's explicit approval.**

---

*End of NH-ROP v1.0 (draft). Companion index: `research/README.md`. Templates: `research/templates/`.
Schemas: `research/schemas/`. Retrospective: `research/missions/mission-001/`.*
