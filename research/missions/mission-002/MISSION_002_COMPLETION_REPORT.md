# Mission #002 — Completion Report: NH Research Operating Protocol (NH-ROP)

> **Status:** Draft complete — **pending Nisan's explicit approval** (no commit/push performed).
> **Date:** 2026-07-17 · **NH-ROP version delivered:** 1.0 · **Owner:** Founder (nisan333@gmail.com).

---

## 1 · Executive verdict

**Is NH-ROP ready to become the governing research standard? — Yes, adopt (with two operating conditions).**

NH-ROP delivers one coherent, claim-based research system: nine structured objects, a 12-dimension evidence
framework with fatal-flaw gates, explicit evidence-lineage rules against false independence, a 9-status
verdict ladder with verdict and confidence separated, an outcome/revenue proof ladder inherited from the
Product Constitution, condition-based completion, materiality tiers, roles with author≠reviewer separation,
a failure-mode guardrail table, and machine-readable schemas. It was **tested, not just asserted**: applied
retrospectively to Mission #001 (which passes on substance and fails only on structure) and run through 15
acceptance tests and 9 review perspectives, with corrective edits applied.

**Confidence: High** that the *protocol is sound and executable*; **Moderate** that it is *optimally
ergonomic* until a second live mission (Mission #003) exercises it end-to-end. Rationale (plain language):
the design is internally consistent and catalogs every required behavior, but usability under real time
pressure is only fully provable by running it — the same evidence standard NH-ROP itself demands.

**Remaining limitations:** (a) schema validation is not runtime-wired (deliberate — no consumer yet); (b)
NH-ROP's own materiality is L3-Strategic and was authored by the founder acting as his own Critical Reviewer,
the very separation it mandates for L3 — an independent reviewer should ratify v1.0 before it governs an
externally-represented (L4) mission.

---

## 2 · Files created or updated

**Created (all under `research/`, local only):**
| File | Purpose |
|---|---|
| `NH_RESEARCH_OPERATING_PROTOCOL.md` | The protocol — object model, claim lifecycle, evidence framework, verdict protocol, completion standard, roles, materiality, failure modes, acceptance-test definitions, governance. |
| `README.md` | Index + single-source-of-truth map + validation-wiring decision. |
| `templates/` ×10 | Blank canonical artifacts: Mission Charter, Claim/Evidence/Source/Assumption/Unknown/Contradiction Registries, Research Verdict, Revision Log, Completion Record. |
| `schemas/` ×8 | JSON Schema (draft 2020-12) contracts: research-mission, claim, evidence, source, assumption, unknown, contradiction, verdict. |
| `missions/mission-001/MISSION_001_RETROSPECTIVE.md` | NH-ROP applied to Mission #001 (audit, not rewrite). |
| `missions/mission-002/MISSION_002_COMPLETION_REPORT.md` | This report. |

**Updated:** none outside `research/`. **No product code, no `CLAUDE.md`, no `docs/` changed** (verified:
`git status` shows only new `research/` paths). Mission #001 v1.1 and its Register are **unchanged**.

**Design decision — file count:** the full requested tree was created because each artifact owns a distinct
object with unambiguous authority (§16). Templates are deliberately **lean** (fields + a pointer to the
protocol rule) so no rule is stated twice. No empty ceremonial files were created.

---

## 3 · Material design decisions

- **Why the Claim is the unit:** a document/company/search-result bundles many separately-true-or-false
  assertions; verdicts on bundles are where inflation hides ("identifies leakage **and proves recovery
  across all departments**"). Atomizing to one-subject/one-predicate/one-scope/one-time forces each part to
  earn its own verdict (§4.4, worked example; Test 1).
- **How evidence quality works:** 12 dimensions scored 0–5, but **never averaged**. Three dimensions —
  Independence, Verifiability, Scope-specificity — are **fatal-flaw gates**: a 0–1 caps the item at "Weak or
  below" no matter how high the rest. A strong-looking item with no independence is still weak (§7).
- **How false independence is prevented:** sources are grouped into an **evidence lineage** by common
  origin; **N sources in one lineage = one confirmation.** "Multiple independent confirmations" requires
  distinct lineages that each add new verification (§8; Test 3).
- **How verdict and confidence differ:** verdict = *what the evidence justifies* (9 controlled statuses,
  never stronger than the evidence); confidence = *how sure we are the verdict is right within its scope*
  (5 levels + mandatory plain-language rationale). They are separate fields; a *Supported* verdict can carry
  *High* confidence and vice-versa (§10–§11).
- **How completion is determined:** 12 mandatory minimum conditions **plus** ≥1 documented stop condition;
  "Diminishing Returns" must be *demonstrated* by a defined test, not asserted. This replaces Mission #001's
  aspirational "Evidence-Complete" label (§14).
- **How history is preserved:** supersede, never erase — every material change appends to version history +
  the Revision Log; prior versions live in git. This mirrors the product Trust Invariant #6/#9 (§16).

---

## 4 · Mission #001 retrospective (summary; full audit in `missions/mission-001/`)

- **Passed** on substance. The four conclusions decompose into 8 atomic claims; verdicts sit at/below
  evidence throughout; the v1.1 outcome reclassification already resisted vendor-narrative capture.
- **Changed:** exactly one verdict-ceiling — **C1 "Confirmed/Survived" → "Supported (scope-qualified)"** —
  because a **negative + universal** claim cannot be "Confirmed" when the search universe (non-English,
  private, enterprise-internal) was not exhausted. Mission #001's own "no credible evidence found" language
  already honored this; NH-ROP promotes it to verdict level. **No decision impact.**
- **Corrected:** the **"Evidence-Complete" completion label** → restated as **Unknown Isolation + demonstrated
  Diminishing Returns** (§14).
- **Failure class:** the gaps were **scope ambiguity**, a **missing completion rule**, and **artifact-
  structure** (no atomic Claim/Assumption registries) — *not* missing/weak evidence, source dependence, claim
  inflation, or inappropriate certainty. NH-ROP caught real structural gaps without inventing problems
  (Tests 14 + 15).

---

## 5 · Acceptance test results (mission brief §23; tests defined in NH-ROP §20)

| # | Test | Result | Demonstration |
|---|---|---|---|
| 1 | Claim atomicity | **PASS** | §4.4 decomposition rule + worked 8-part example; Mission #001 C1–C4 → 8 atomic claims (retrospective §2). |
| 2 | Evidence traceability | **PASS** | Verdict → `supporting/contradicting_evidence` IDs → Evidence `source_id`/`location` → Source (§16; schemas enforce ID links). |
| 3 | False independence | **PASS** | §8 lineage; "N-in-one-lineage = one confirmation"; applied to Stripe/Waystar/PRGX numbers in retrospective §3. |
| 4 | Vendor claim | **PASS** | §5 (vendor evidence "can never suffice alone" for Outcome/Causal) + §12 ladder ⇒ documented feature ≠ "Confirmed business impact." |
| 5 | Unsupported vs Refuted | **PASS** | §10 distinct statuses + guard "Unsupported ≠ Refuted"; Principle 5. |
| 6 | Scope qualification | **PASS** | §7 Scope-specificity gate + §10 narrow-scope Confirmed; applied to C1 (retrospective §4). |
| 7 | Freshness | **PASS** | §7.8 + §13 freshness rule + `Obsolete` status + schema `as_of_date`. |
| 8 | Contradiction preservation | **PASS** | §4.9 first-class object stays visible until resolved; Mission #001 BRIM-counter preserved (retrospective §5). |
| 9 | Revenue proof ladder | **PASS** | §12 12-rung ladder; Detected ≠ Recovered ≠ Proven; classification enum in `verdict.schema.json`. |
| 10 | Conclusion revision | **PASS** | §16 supersession + Revision Log template + schema `version_history`/`verdict_revision`; prior value preserved. |
| 11 | Completion | **PASS** | §14 conditions + documented stop conditions; Completion Record template. |
| 12 | Reproducibility | **PASS** | Registries + IDs let a second reviewer reconstruct without private memory; retrospective was itself produced this way. |
| 13 | AI guardrail | **PASS** | §6 + §17 — AI output not an independent source; may not assign Confirmed from synthesis alone. |
| 14 | Mission #001 retrospective | **PASS** | Produced a clearer, scope-honest conclusion + corrected completion basis; surfaced 1 protocol improvement (§14 demonstrated-DR). |
| 15 | Practicality | **PASS** | §18 materiality L1–L4; L1 collapses minor registries; proportionality rule prevents L4 ceremony on trivial questions. |

**15 / 15 pass.** Corrective actions taken during testing: (i) §14 now requires a *demonstrated* stop
condition (from Test 14); (ii) §18 gained an **anti-gaming guard** on materiality (from the Adversarial
perspective, §6 below).

---

## 6 · Quality review perspectives (mission brief §24)

| Perspective | Assessment | Corrective action |
|---|---|---|
| **Scientific reviewer** | Claims falsifiable (overturn_conditions mandatory); uncertainty visible (Unknowns first-class); reproducible (registries); contradictions handled honestly. | None. |
| **Investigative researcher** | Original-source location required (lineage `original_source`); citation laundering blocked (§8); disconfirming search mandatory (Phase 5). | None. |
| **CTO / architect** | Objects + authority boundaries clear (§16); portable (JSON Schema, model/app-agnostic); schemas maintainable; not coupled to one interface. | None. |
| **CFO / auditor** | Revenue claims traceable; baseline/attribution/collection/double-count all required (§12); history auditable (supersession). | None. |
| **CEO / strategist** | Supports decisions over endless research (Phase 1 decision-framing; §14 stop conditions); distinguishes material vs immaterial uncertainty (materiality; blocks_decision flag); reveals what invalidates a conclusion. | None. |
| **Product leader** | Distinguishes documented feature / usable capability / measurable outcome (§5, §12 ladder); findings map to decisions (Verdict → decision implications). | None. |
| **Commercial buyer** | Exposes vendor incentives (`commercial_interest`, COI dimension) and implementation limits; separates proven from promised (outcome ladder). | None. |
| **Legal / compliance** | Legal/regulatory claims scoped + dated (§5 Compliance = High burden, dated); qualified Domain Reviewer required at L3/L4. | None. |
| **Adversarial reviewer** | Probed: verdict inflation (blocked by verdict≤evidence), hidden contradictions (first-class + visible), early completion (demonstrated-DR test), weak→strong laundering (gating dims). **Found one real hole:** a beneficiary could **under-classify materiality** to escape independent review. | **Fixed** — §18 anti-gaming guard: Owner sets / Decision Owner confirms; external representation auto-L4; escalation logged; downgrades need sign-off. |

---

## 7 · Open risks & unknowns

| Item | Blocks adoption? |
|---|---|
| NH-ROP v1.0 was authored by the founder as his own Critical Reviewer (the separation it mandates at L3). An independent ratification is advisable before governing an L4 mission. | **No** — advisable, not blocking. |
| Ergonomics under real time pressure unproven until Mission #003 runs end-to-end on the protocol. | **No** — adopt-and-observe; §21 allows v1.1 refinement by supersession. |
| Schema validation not runtime-wired (deliberate; no consumer). | **No** — documented wiring path exists. |

No open item blocks adoption.

---

## 8 · Recommendation

**Adopt NH-ROP v1.0 as the governing NH research standard**, with two conditions: (1) an independent
reviewer ratifies v1.0 before it governs any externally-represented (L4) mission; (2) the first mission run
under it (Mission #003) is treated as a live ergonomics test, with friction fed back via §21 supersession.
Freeze v1.0 now per §21 (no critical contradiction remains).

---

## 9 · Repository status

- **Validation/build:** all 8 JSON schemas parse as valid JSON (`node JSON.parse` — OK ×8). No product build
  run because **no product code changed** (`npm run build`/`test` unaffected; `src/` untouched).
- **New files:** `research/NH_RESEARCH_OPERATING_PROTOCOL.md`, `research/README.md`, `research/templates/`
  (10), `research/schemas/` (8), `research/missions/mission-001/MISSION_001_RETROSPECTIVE.md`,
  `research/missions/mission-002/MISSION_002_COMPLETION_REPORT.md`.
- **Modified files:** none outside `research/`. Mission #001 v1.1 and `RESEARCH_REGISTER.md` unchanged.
- **Constitution / product code:** **not touched.**
- **Commit / push:** **none performed.** Awaiting Nisan's explicit approval.

---

## 10 · Definition of Done (mission brief §28) — checklist

- [x] One coherent Research Operating Protocol.
- [x] Claims/evidence/sources/assumptions/unknowns/contradictions/verdicts have explicit structures.
- [x] Evidence quality and independence operationally assessed.
- [x] Verdict language cannot exceed evidence strength.
- [x] Confidence has a defined basis.
- [x] Revenue-proof claims receive enhanced scrutiny.
- [x] Research has objective completion conditions.
- [x] History can be revised without being erased.
- [x] Mission #001 retrospectively tested.
- [x] Acceptance tests pass (15/15).
- [x] A future researcher/agent can execute without undocumented judgment.
- [x] No critical contradiction remains.
- [x] No commit or push without explicit approval.
