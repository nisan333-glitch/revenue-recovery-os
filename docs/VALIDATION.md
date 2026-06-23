# Customer Validation Program

**Status: engines frozen.** No new product is built until this program returns a
positive signal. The bottleneck is no longer architecture — it is **demand proof.**
The single living metric is [`gtm/SCOREBOARD.md`](gtm/SCOREBOARD.md) — updated weekly,
and the only thing that is. Building resumes on one sentence: *"show me that on our
data."*

> **Ready-to-use assets live in [`gtm/`](gtm/):** the 60-second pitch
> ([`PITCH_60S.md`](gtm/PITCH_60S.md) — open every conversation with it), ICP,
> target-account list, outreach sequence, discovery script, ROI calculator, and the
> executive one-pager. This file is the rationale; `gtm/` is what you run.

## The only question that matters

> **Where can we CREATE recovery that would not have happened otherwise?**

Not where we can *measure* recovery. Not where we can *report* it. **Incremental**
recovery is the entire difference between a fundable product and a nice report.

**Honest scorecard.**

| Solved | NOT solved (all that matters now) |
|---|---|
| Architecture, Constitution | **Who pays** |
| Proof Ledger, Reconciliation | **For what** |
| Recovery Workflow, Audit Trail | **Which recovery isn't happening today** |
| Decision layer (designed) | **How much money is really left on the table** |

No code answers the right column. Conversations do.

---

## Wedge under test

**Onboarding / Activation Recovery** — `Signed → Not Activated → Next Invoice At
Risk`. Pitch: *"We return money lost between signature and activation."* (See
`PROOF_MODEL.md` for the proof method.)

---

## Step 1 — 10 target companies (ICP)

**ICP:** B2B SaaS · **$10–50k ACV** · recurring invoices · 14–90 day onboarding · a
**definable activation event** · a team that already worries about activation.

**Champion = VP Customer Success / Head of Onboarding / RevOps.** *Not* the CFO —
the CFO validates budget later; the activation owner feels the pain first.

**Disqualifiers:** pure self-serve micro-ACV (too little money/account); heavy
enterprise (onboarding too bespoke, cycle too slow); no measurable activation event.

Deliverable: a named list of 10 companies + the warm intro path to each + the
suspected activation event for each.

| # | Company | Champion (role) | Warm path | Suspected activation event |
|---|---------|-----------------|-----------|----------------------------|
| 1 |         |                 |           |                            |
| … |         |                 |           |                            |

---

## Step 2 — 10 interviews (discovery)

Talk to the **activation owner**. Goal: falsify the wedge, not sell it. Three
questions, in order:

1. **Pain & ownership:** *"When a customer signs but never activates — who owns that
   today, and what does it cost you?"*
2. **Data accessibility (the real risk):** *"Could you tell me, per account, whether
   they activated and whether the next invoice was paid — from systems you already
   have?"*
3. **The incremental question:** *"Today, are you recovering those accounts — and
   could you prove how many came back *because of* an action vs would have anyway?"*

Listen for which value prop lands: **(1) incremental recovery** (we recover dollars
you're leaving behind — strongest) vs **(2) assurance** (you recover, but can't
prove it to your board/auditors — narrower buyer).

**Capture per interview:** is the leak owned? quantified? provable today? data
reachable? would they run a free CSV leak-assessment?

---

## Step 3 — 3 pilots (prove the delta)

- **Week 0 — CSV, no integration.** Customer exports
  `account_id, signed_date, activated_date|null, next_invoice_paid, ARPA`. Compute
  the leak size + baseline conversion `b`. **This is the "show them their own
  leakage" moment.**
- **Weeks 1–8 — intervene.** Run owned, tracked recovery plays on the *current*
  stalled cohort (the existing workflow + audit trail).
- **Prove.** Treated conversion `t` vs matched-historical baseline `b`;
  `(t − b) × ARPA × n` = recovered activation revenue, booked to **Revenue
  Returned**, CFO-auditable down to paid invoices.

**Pilot success =** recovered revenue clears the pilot fee by a clear multiple, and
the number survives a skeptical finance review.

---

## Step 4 — Willingness to pay

- **Price isn't the gate.** $10k/yr is a departmental spend, not a CFO decision —
  too low to be the test. Anchor pricing on **% of recovered dollars**, not a flat
  fee.
- **Signal of real demand:** a signed pilot — paid, or with a clear conversion
  trigger ("if we prove $X recovered, it converts to $Y/yr").

---

## Decision rule

- **Continue** if: ≥3 of the first interviews say stalled-activation recovery is
  **unowned or unprovable today**, AND ≥1 pilot shows a **real incremental delta**
  (`t > b`) that finance accepts.
- **Stop & rethink** if: prospects say *"we already do this and can prove it"* — the
  wedge is wrong; do not build another engine, change the wedge.

Only after a positive signal do the paused roadmap phases (Decision → Learning →
Prevention → Allocation) resume.
