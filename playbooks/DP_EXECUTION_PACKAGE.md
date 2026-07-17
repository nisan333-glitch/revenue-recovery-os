# Design Partner Execution Package

> **Status:** Living operational asset · **Version:** 0.1 · **Last updated:** 2026-07-17
> **Not part of the Product Constitution.** Copy-ready assets for Design Partner acquisition and
> validation. Customer-facing text is in English (ready to send). Evolve freely through field experience.
> Pairs with `DP_VALIDATION_KIT.md` (session flow, Session Record, Friction Log, assumption tracker).

**Product under validation:** NH Revenue Recovery OS — M1 Assessment. Sizes **Observed Unpaid** in a
stalled cohort from **one historical CSV, entirely in the browser**. Four money states separated
(Observed only; Estimated/Forecast "Not calculated"; Proven $0). Wedge: **Signed → Onboarding →
Activation → First Value → Second Invoice**.

---

## 1 · ICP One-Pager

**Who:** a B2B SaaS company losing recurring revenue between Signed → Second Invoice, that can export a
historical CSV and has an owner for that leak.

| Dimension | Target | Why |
|---|---|---|
| Model | B2B SaaS, recurring subscription with a defined **invoice cycle** + an **activation/onboarding** step | The wedge needs an expectation cycle (signed → activation → next invoice) |
| Size | ~$5M–$100M ARR (Series A–C), 50–800 staff | Enough cycles + a real owner; not so big that RevOps builds in-house / procurement stalls |
| Systems | Billing (Stripe/Chargebee/Recurly/Zuora/NetSuite) + CRM + an activation/usage signal | Source of the CSV columns; independence-of-evidence story later |
| Data | Can export `entity_id, signed_at, next_invoice_due_at, next_invoice_amount, currency` (+ optional `activation_at, next_invoice_paid_at, status`) | M1 needs exactly these; no export → no validation |
| Pain | A **known, expensive** leak between signing and the second invoice; can **name a number** | No named number → no urgency |
| Champion | RevOps / Finance-Ops / Onboarding lead who feels the leak in their KPI | Pulls the CSV, runs it, fights internally |
| Economic buyer | CFO **or** CRO, reachable within ≤2 meetings | A pilot needs budget/authority |

**Hard disqualifiers:** no recurring billing · can't/won't export data · security will never allow a
browser tool (even client-side) · no internal owner · pre-revenue · agency/services/one-off billing ·
"just curious."

**One-line pitch:** *"We size the revenue leaking between your signed deals and their second invoice —
from one CSV, entirely in your browser, with a number you can't fudge and we can't see."*

## 2 · Prioritized Target-Profile Criteria (screen in this order)
1. **Named, expensive activation/second-invoice leak** (kills the deal if absent).
2. **Can export the CSV** (kills the deal if absent).
3. **A champion who owns the number.**
4. **Reachable economic buyer (CFO/CRO).**
5. Model/size/systems fit.
6. Security openness to a client-side tool.

## 3 · DP-FIT Qualification Rubric (score after discovery, 0–100)

| Dimension | Weight | 0 | 3 | 5 |
|---|---:|---|---|---|
| Pain clarity (names a number) | 25 | none | vague | specific $ that worries them |
| Data availability (CSV → the columns) | 20 | can't | partial/messy | clean export available |
| Champion (owns the number) | 20 | none | interested | owns it in a KPI |
| Economic-buyer access (CFO/CRO) | 15 | blocked | via champion | direct ≤2 meetings |
| ICP fit (model/size/systems) | 10 | no | partial | full |
| Privacy/security openness | 5 | hard block | needs review | client-side satisfies them |
| Commitment signal | 5 | "we'll see" | curiosity | agreed to pull a CSV |

**Score = Σ(rating×weight)/5.** **GO ≥75** · **CONDITIONAL 55–74** (only if Pain≥5 **and** Data≥3) ·
**NO-GO <55**.
**Red flags:** "build us X first" (custom-software risk) · wants Estimated/Forecast/Proven *now*
(violates M1/Constitution) · wants us to host the data (violates client-side) · compliments without a
costly step.

## 4 · First-Contact Outreach (copy-ready)

**Cold email:**
> **Subject:** the revenue that stalls before your second invoice
>
> Hi {First name},
>
> Quick one — most SaaS teams I talk to can't put a defensible number on the revenue that stalls between
> a **signed deal and its second invoice** (failed activation, delayed go-live, silent non-payment).
>
> We built a way to size it from **one historical CSV, entirely in your browser** — your file never
> leaves your machine, and the number is derived so that no one (including us) can massage it.
>
> Worth a 30-minute look at your own data? Not a pitch — a working session where you'd see your own
> Observed number.
>
> {Name}

**LinkedIn DM (shorter):**
> Hi {First name} — we size the revenue that stalls between signed and second-invoice, from one CSV that
> never leaves your browser. Open to a 30-min working session on your own data? Genuinely a look, not a
> pitch.

**Warm-intro ask (to your network):**
> Do you know a RevOps or Finance lead at a $5–100M ARR SaaS who'd say activation/second-invoice leakage
> is a real, expensive problem? I have a browser-only tool that sizes it from their own CSV in 30
> minutes — looking for 3–5 design partners, no cost.

## 5 · Discovery-Meeting Script (45 min)

**Objective:** learn — is the problem real, expensive, named, owned, and is a CSV pullable. Not to sell.
**Mandatory order:** run `src/assessment/privacy/NETWORK_INSPECTION.md` first if any real data is
touched; **if privacy can't be guaranteed → STOP.**

- **(5m) Frame:** "This is a working/learning session, not a demo. I want to understand your
  signed-to-second-invoice journey and, if it makes sense, look at your own number."
- **(20m) Discovery:**
  - "Walk me through what happens from a deal being signed to the second invoice being paid."
  - "Where in that journey do you lose the most revenue — and how do you know?"
  - "If you had to put a dollar figure on revenue that stalls between signing and activation, what is
    it? How confident are you?"
  - "Who owns that number today? What do they do when it goes wrong?"
  - "How do you measure it now — spreadsheet, BI, gut?"
- **(10m) Data + trust:**
  - "What would it take to export a CSV with signed date, next-invoice due date, amount, and activation
    status?"
  - "Who'd need to approve a browser-based tool where the file never leaves your machine?"
- **(5m) Position M1 honestly:** Observed only; no forecast, no proven claims; the number is
  reproducible and un-fudgeable.
- **(5m) Next step:** agree to pull a CSV / book the readout.

**Do NOT:** demo before discovery · promise Estimated/Forecast/Proven · argue with their BI · count
compliments as progress.
**Success:** they name a number · agree to pull a CSV · book a second meeting.

## 6 · Measurable Definition of "Costly Commitment"
Interest / compliments / a meeting are **not** validation. A costly commitment is a **scored ladder** —
log the highest rung reached per DP:

| Rung | Commitment (measurable) | Weight |
|---|---|---:|
| 1 | Pulled and shared a **real production CSV** | ● |
| 2 | **Second meeting requested** (readout booked) | ●● |
| 3 | Shared **additional data** or a second cohort | ●● |
| 4 | Assigned an **internal team member** to the effort | ●●● |
| 5 | **Executive sponsor** named (CFO/CRO) | ●●● |
| 6 | **Pilot approved** / budget conversation opened | ●●●● |

**Validation milestone (GATE C):** ≥1 DP reaches **rung ≥4** with the Observed number trusted. Anything
below rung 1 = not validated, regardless of enthusiasm.

## 7 · Session Record Template *(aligned with `DP_VALIDATION_KIT.md` §2)*
```
DP · date · persona(s) · CSV: [yes/no, source system]
Observation:      [what was observed — quote/behavior, not interpretation]
Evidence:         [direct evidence + is it costly: which rung (§6)]
Customer Impact:  [how expensive / urgent — $ or time if stated]
Hypothesis:       [which assumption/tracker item this touched — A1..A5 / H-*]
Recommendation:   [Observation · Evidence · Customer Impact · Recommended Change · Why]  OR:
                  "Insufficient evidence. Collect additional customer evidence before changing the product."
Confidence:       [low/med/high] + what evidence is still missing
Next Experiment:  [next falsifiable test]
Outcome:          [Confirmed / Disproved / New hypothesis / Insufficient evidence]
Costly-commitment rung reached: [0–6]
```

---

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-17 | Initial package: ICP one-pager, target-profile criteria, DP-FIT rubric, outreach copy, discovery script, costly-commitment ladder, Session Record template. |
