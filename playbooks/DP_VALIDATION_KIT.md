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

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-16 | Initial kit: session flow, discovery script, Session Record template, Friction Log, Assumption/Hypothesis Tracker, Attestation decision gate. |
| 0.2 | 2026-07-17 | Added §6 — structured overturn triggers for customer-evidence-gated decisions (Verifiable Attestation). |
