# Design Partner Validation Kit

> **Status:** Living operational playbook · **Version:** 0.1 · **Last updated:** 2026-07-16
> **Not part of the Product Constitution.** Evolve this freely as field sessions teach us what works.

**Objective of this phase:** validate whether the *existing* Assessment (`main`-branch baseline, M1 +
column mapping + amount normalization + tamper-evident record foundation) creates enough **trust**,
**understanding**, and **customer commitment** — before building any further customer-facing
functionality. Collect evidence · record observations · identify friction · validate assumptions.

**Baseline under validation:** ingest one CSV entirely in the browser → **Observed Unpaid** in a
stalled cohort. Four money states separated (Observed only; Estimated/Forecast "Not calculated";
Proven $0). Client-side, privacy-gated.

**Golden rule:** interest ≠ validation · compliments ≠ validation · a meeting ≠ validation.
**Validation = a costly commitment** (real CSV, additional data, second meeting requested, pilot
approved, internal team assigned, executive sponsor, budget discussion).

---

## 1 · Session flow + discovery script

**Mandatory order** (never reorder):
1. Run `src/assessment/privacy/NETWORK_INSPECTION.md`. **If privacy cannot be guaranteed → STOP.**
2. Import **one real** customer CSV.
3. Run the Assessment.
4. Review **Data Quality → Cohort → Observed** together.
5. Discuss findings.
6. Collect evidence.

**Do NOT** demo before discovery · promise Estimated/Forecast/Proven · pitch future features before
evidence · argue with their BI · count compliments as progress.

**Discovery questions (ready to use):**
- "Walk me through signed → onboarding → activation → first value → second invoice. Where does revenue stall, and how do you know?"
- "If you had to name the dollar figure stalling between signing and the second invoice — what is it, and how confident are you?"
- "Who owns that number today? What do they do when it goes wrong?"
- "What would it take, internally, to export a CSV with signed date, next-invoice due date, amount, and activation status?"
- "Who approves using a browser-based tool where the file never leaves your machine?"

**After the readout:**
- "Is this number new to you, or something you already track? Do you **trust** it? Why / why not?"
- "What was hard about producing this CSV? What would stop you running this on your whole book?"
- "What would it take to run this on a full export and share the result internally?"

**Success looks like:** they name a figure · pull a CSV · request a second meeting · a costly step.
**A healthy failure** (assumption disproved) is a valid outcome and produces **no code**.

---

## 2 · Session Record (fill in after every session — fixed structure)

```
DP · date · persona(s) · CSV: [yes/no, source system]
Observation:      [what was observed — quote/behavior, not interpretation]
Evidence:         [direct evidence + is it costly: CSV pulled / 2nd meeting / pilot ask / rejection]
Customer Impact:  [how expensive / urgent — in $ or time if stated]
Hypothesis:       [which assumption this touched]
Recommendation:   [Observation · Evidence · Customer Impact · Recommended Change · Why]   OR:
                  "Insufficient evidence. Collect additional customer evidence before changing the product."
Confidence:       [low/med/high] + what evidence is still missing
Next Experiment:  [the next falsifiable test]
Outcome:          [Confirmed / Disproved / New hypothesis / Insufficient evidence]
```

_(Append each completed record below this template as sessions happen.)_

---

## 3 · Friction Log

| Stage | What broke / confused | Severity | Quote | Proposed fix (only if evidence-justified) |
|---|---|---|---|---|
| privacy gate / CSV export / column mapping / amount format / cohort / readout | | | | |

---

## 4 · Assumption & Hypothesis Tracker

The open risk we close in the field. Evaluate **strength and quality** of evidence, not just count.

| # | Assumption | How to disprove | Status | Evidence so far |
|---|---|---|---|---|
| **A1** ⭐ | Observed Unpaid (from their own records) is perceived as a **new, expensive, credible** problem — not "we already knew that from BI" | Readout gets "nice, we knew" with no action | Open | — |
| A2 | The expectation-cycle grain fits their data; they can export the CSV | Cannot map / cannot export | Open | — |
| A3 | Champion = RevOps / Finance-Ops; economic buyer = CFO, reachable | No owner / buyer unreachable | Open | — |
| A4 | Client-side privacy removes the security blocker (IT approves) | Security blocks despite client-side | Open | — |
| A5 | A **costly commitment** is achievable | Only compliments, no costly step | Open | — |
| **H-ATTEST** | Customers **need / trust** a tamper-evident, independently-verifiable attestation of the number → would justify *Verifiable Assessment Attestation* | See decision gate §5 | **Hypothesis** | — |

---

## 5 · Decision gate — *Verifiable Assessment Attestation*

The tamper-evident record **foundation** exists in code (`src/assessment/record.ts`) but is **not**
surfaced to customers. Surfacing it is a **customer-facing** milestone and is **on hold**.

**Build it only if** — across **≥2 independent Design Partners** — doubt about the number's integrity
arises **spontaneously**: a CFO/RevOps asks *"how do I know this wasn't fudged / changed?"*, or
**conditions** trust or a pilot on verifiability. Otherwise it remains an **engineering hypothesis**
and is **not built**. (Consistent with the Product Thesis: evidence *informs* the roadmap, never
*defines* it.)

Reassess H-ATTEST after multiple sessions using the evidence recorded above.

---

## 6 · What evidence could overturn a deferred customer-facing decision?

Structured triggers for **customer-evidence-gated** items (engineering-only items live in
`ENGINEERING_REGISTER.md`). Capture matching evidence in the Session Records / Friction Log above.

**Verifiable Assessment Attestation** (customer-facing; foundation exists, unwired):
- **Triggering evidence:** A CFO/RevOps spontaneously doubts the number's integrity ("how do I know
  this wasn't fudged / changed?"), or conditions trust / a pilot on being able to verify it.
- **Evidence source:** Discovery / readout sessions — direct quotes, logged in a Session Record.
- **Minimum evidence threshold:** **≥2 independent Design Partners** (different org/network/champion).
- **Decision reopened:** Surface the tamper-evident record (`src/assessment/record.ts`) as a
  downloadable, independently-verifiable attestation in the export.
- **Expected business impact if validated:** **High** — could be decisive for CFO trust and pilot
  conversion (the Trust Invariant made tangible).

---

## 7 · Run-Path Decision Framework (V0–V6)

**What this governs:** *whether and how* a Design Partner runs the Assessment on their **real** CSV
(the run-path). This is an **evidence-gated product decision**, gated **first by business value (V0),
then by scope (V0.5), then by technical constraints (V1–V6)** — never selected on engineering reasoning
ahead of a qualified, committed customer. **Default until V0 is satisfied: run session #1 as a
synthetic demo on our own screen — no build.** Living procedure: it may evolve **only** through real DP
evidence.

**Run-path models under evaluation:** A = our-machine synthetic demo (discovery) · B = hosted static
URL · C = single self-contained offline HTML · D = local dist bundle/local server · E = DP sends us the
file (rejected — breaks privacy).

### V0 — Business Justification (mandatory first gate; internal)
| Check | Question | Fail → |
|---|---|---|
| V0.1 | Is there a **qualified** DP (cleared DP-FIT)? | not qualified → collect evidence, do not build |
| V0.2 | Has the DP reached the **CSV-commitment stage** (agreed to pull a real export)? | not committed → run-path isn't yet the constraint |
| V0.3 | Is the **run-path the only remaining blocker** to running their data? | other blockers first → solve those |
| V0.4 | Would solving it **materially raise** pilot / costly-commitment probability? | no material lift → don't build |
| V0.5 | **One customer only, or a broader recurring need?** | *scope discriminator — see below* |

**V0 passes = V0.1–V0.4 all affirmative.** Any fail → do not select a model, do not build, collect more
evidence. **V0.5 sets scope:** one customer → build the **minimum throwaway unblock** for *that* DP,
never a general model; recurring (**≥2 independent qualified DPs** on the same constraint) → proceed to
V1–V6 for a **durable** model.

### V1–V6 — Technical selection (only after V0 passes, only for scope = recurring)
| # | Variable | Gates |
|---|---|---|
| V1 | Does the DP need **their own** number to commit, or does synthetic suffice? | no-build if synthetic suffices |
| V2 | Self-serve, supervised-on-their-machine, or won't-run-at-all? | feasibility of any run |
| V3 | IT posture on opening an **unknown external web app** + file-picker UI (DLP)? | Model B |
| V4 | Will they receive/open a **single local HTML file** (attachment/drive policy)? | Model C |
| V5 | Security's **assurance bar** — live offline+DevTools demo, or a formal process (review / DPA / SOC2 / self-host)? | formal process eliminates B & C |
| V6 | **Air-gap** mandatory, or client-side-on-a-URL acceptable? | air-gap → C only |

**Questions to ask (discovery / champion + IT):**
1. "To decide on a pilot, do you need to see the number on **your own** data, or is seeing how it works enough now?" → V1
2. "When we run it on your data, would you run it yourself, or do it together on your screen?" → V2
3. "Who approves a browser tool where the file never leaves your machine? What would they need to see?" → V5
4. "Does IT allow opening an external web app with a file-upload screen — even if nothing is uploaded?" → V3
5. "Easier to open a **link**, or a **single self-contained file** you run **offline**?" → V4 + V6
6. "Anything (DPA, security review, running on your own infra) required before any of this?" → V5 (surfaces eliminate-both)

**Answer → branch:**
- **→ Model B** if V3 permits external app + file-picker **and** V5 = "offline+DevTools demo is enough" **and** V6 = client-side-on-URL acceptable **and** V2 = will self-serve/supervised.
- **→ Model C** if V4 = will open a local single file **and** (V3 blocks external URLs **or** V6 = offline/air-gap mandatory **or** V5 = "must be one inspectable offline artifact").
- **→ Eliminate both** if V5 = formal process / self-host-only / vetted-vendor only · **or** V3 **and** V4 both blocked · **or** V2 = won't run anything **and** won't share the file (→ pivot: DP computes the number from a spec we provide, or defer).
- **→ No build needed** if V1 = synthetic/discovery suffices, or the real run is far downstream.

### Criteria re-validation (before trusting the framework)
V3–V6 are a **hypothesis** about what decides feasibility. After the first 2–3 CSV-commit-stage
sessions, check whether they actually determined the outcome or an **unmodeled factor** dominated
(e.g., mandatory DPA, VPC-only, "no browser tools period"). If a new axis emerges, **add it here before
selecting a model.**

### Thresholds
A single DP's hard requirement is a data point, not a general decision — build the **minimum** to unblock
a strong single commit without generalizing. Generalize a default model only at **≥2 independent
qualified DPs** clustering on the same constraint.

---

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-16 | Initial kit: session flow, discovery script, Session Record template, Friction Log, Assumption/Hypothesis Tracker, Attestation decision gate. |
| 0.2 | 2026-07-17 | Added §6 — structured overturn triggers for customer-evidence-gated decisions (Verifiable Attestation). |
| 0.3 | 2026-07-17 | Added §7 — Run-Path Decision Framework (V0 business gate → V0.5 scope → V1–V6 technical), gating whether/how a DP runs the Assessment on real data. |
