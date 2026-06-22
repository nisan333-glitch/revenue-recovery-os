# Revenue Recovery OS — Demo Script

A 5-minute walkthrough that proves the one thing that matters: **recovered revenue
is real, separated from hope, and auditable to the dollar.**

> Setup: `npm install && npm run dev`, open the app. If data was edited,
> click **Reset demo data** in the sidebar to restore the seed below.

---

## 10-minute discovery demo (the cut to actually run)

For a prospect (VP CS / RevOps), do NOT tour features. Tell the one story:
**Identify → Recover → Prove**, anchored on *their* leak (activation), with the cash
at the end.

1. **(0–1 min) The frame.** "You have money falling between signature and
   activation. We find it, recover it, and prove how much came back — to the
   dollar." No feature names.
2. **(1–3 min) Identify — the leak is real and separated.** Executive Dashboard:
   **Detected Opportunity ($71,800)** is amber and labeled *potential, not revenue*;
   **Proven Recovered ($83,400)** is green. "We never blend the two. Most tools show
   one number; that number is a lie."
3. **(3–6 min) Recover — work one account live.** Recovery Queue → open the top
   account → assign owner → record an action → set a recovery reason → mark
   Recovered. Revenue Returned computes live as **Collected − Baseline**. "That is
   the workflow — owned, time-bound, executed."
4. **(6–8 min) Prove — the CFO number.** CFO Proof View + Reconciliation: only
   **auditable** revenue ($79,800), the waterfall Gross → Counted → Auditable, and
   the **$4,300 unclassified = $0** moment. "We do not count money we cannot
   explain. This survives your finance review."
5. **(8–9 min) Audit — the paper trail.** Audit Trail: every change, actor,
   timestamp. "Each recovered dollar traces to a real event."
6. **(9–10 min) Their turn — the CSV.** "Send us one export — signed date, activated
   or not, next invoice paid, ARPA. We'll show you *your* leak and what's
   recoverable. No integration." (This is the close — see `VALIDATION.md`.)

The demo's job is not to impress with modules. It is to make them say *"that's our
problem, and nobody proves it today."*

> Backstage note (do not lead with this): when you open an item in the Recovery
> Queue, a rule-based engine already ranks it by expected value and suggests the
> play (**Apply recommendation**). It's a quiet operator convenience — not part of
> the pitch. The story stays **Identify → Recover → Prove**; the green number, not
> the forecast, earns the budget.

---

---

## The numbers this demo is built on (verified)

Locked by `src/data/seed.verify.test.ts` — run `npm run test` to confirm:

| Metric | Value | Meaning |
|---|---:|---|
| Detected Opportunity | **$71,800** | 4 open events at risk (potential, not proof) |
| Proven Recovered Revenue | **$83,400** | 7 counted recoveries |
| CFO-Auditable | **$79,800** | 6 proof-grade events |
| Unproven (low confidence) | **$3,600** | 1 event, excluded from CFO total |
| Unclassified (not counted) | **$4,300** | RE-1006, contributes $0 to every total |
| Recovery Rate | **88%** | 7 recovered / (7 + 1 failed) |

The story is the gap: **$83,400 recovered, but only $79,800 a CFO can sign.** The
difference is exactly the $3,600 low-confidence event — and the $4,300 unclassified
recovery is in *no* total at all.

---

## Beat 1 — "Two numbers we never blend" (Executive Dashboard)

1. Land on the **Executive Dashboard**.
2. Point to the two top cards, side by side:
   - **Detected Opportunity $71,800** (amber) — "what we *could* recover."
   - **Proven Recovered Revenue $83,400** (green) — "what we *did*, by the
     equation Collected − Baseline."
3. Key line: *"Most tools show one blended number. We refuse to. Opportunity is
   not revenue until it's collected and proven."*
4. Note the four metric cards: Money Recovered, CFO-Auditable, Unproven, Recovery
   Rate — and that **Auditable ($79,800) is already lower than Recovered
   ($83,400)**. That honesty is the product.

## Beat 2 — "Only what survives an audit" (CFO Proof View)

1. Click **Open CFO Proof View →** (or the sidebar).
2. The ledger lists **6 lines = $79,800**, each with baseline, collected, returned,
   reason, confidence.
3. Point out the **"How this number is derived"** panel — the baseline methodology
   stated in plain language. *"This is what a CFO reads before signing."*
4. Note what's **absent**: the $3,600 low-confidence recovery and the $4,300
   unclassified one. *"They're real events — they're just not proof."*
5. Click **Export CSV** — the ledger leaves the building as an auditable file.

## Beat 2b — "Show me the gap" (Reconciliation)

1. Open **Reconciliation**. This is the view a CFO actually argues with.
2. Walk the waterfall top to bottom:
   - **Gross Recovered $87,700** — every dollar collected above baseline.
   - **− Unclassified $4,300** → **Counted Recovered $83,400.**
   - **− Low Confidence $3,600** → **CFO Auditable $79,800.**
3. Point to the **Excluded Revenue by reason** table:

   | Excluded | Amount |
   |---|---:|
   | Unclassified (no reason) | $4,300 |
   | Low Confidence | $3,600 |
   | Double Claim | $0 |
   | Missing Proof | $0 |
   | **Total excluded** | **$7,900** |

4. Key line: *"Recovered is $83,400. Auditable is $79,800. The $3,600 gap isn't
   hidden — it's one low-confidence event, named. And the $4,300 we collected but
   can't explain counts for nothing. We don't count money we can't explain."*

## Beat 3 — "Nothing is counted on faith" (Confidence Score)

1. Open **Confidence Score**.
2. Three buckets: **High $79,800 (proof-grade)**, **Medium $3,600**, **Low $0**.
3. Click the medium-confidence row (**Soylent Foods, RE-1005**) to open its drawer.
4. Show the **confidence breakdown** — the additive, explainable factors. *"It
   scored 58 because attribution is weak and evidence is thin. So it's visible,
   but it never touches the CFO number."*

## Beat 4 — "Unclassified can't sneak in" (Recovery Reasons)

1. Open **Recovery Reasons**.
2. The amber banner flags **Vandelay Industries (RE-1006)** as recovered but
   unclassified — **excluded from all totals**.
3. *"It collected $4,300. Until someone attributes a reason, it counts for nothing.
   No reason, no credit."*

## Beat 5 — "Work the queue, prove a dollar" (Recovery Queue → live)

1. Open **Recovery Queue** — open events ranked by risk × confidence
   (**Stark Solutions $31,000** on top).
2. Click **Stark Solutions (RE-1007)** to open the drawer. Then:
   - **Assign** an owner.
   - **Record an action** (e.g. "Scheduled smart retry").
   - Set **Collected = 31000** (baseline is $6,200).
   - Set **Recovery Reason = Dunning Retry**.
   - Advance **Status → Recovered**.
3. Watch **Revenue Returned** compute to **+$24,800** live, and confidence climb as
   reason/evidence/owner are filled in.

## Beat 6 — "Every dollar has a paper trail" (Audit Trail)

1. Open **Audit Trail**.
2. The new entries for RE-1007 sit on top — assigned, action added, reason set,
   status changed — each with actor + timestamp, newest first.
3. Return to the **Dashboard**: Proven Recovered has risen, Detected Opportunity
   has fallen by the same event. *"Detected became proven — and we can trace
   exactly how."*

---

## One-line close

*"Revenue Recovery OS doesn't tell you revenue leaked. It recovers it, assigns it,
fixes it, and hands your CFO a number that survives the audit — to the dollar."*

---

## Capturing screenshots

Real browser screenshots are produced by `scripts/screenshots.mjs`. In an
environment that permits the Chromium download:

```bash
npx playwright install chromium
npm run build && npm run preview &      # serves on http://localhost:4173
npm run screenshots                     # writes docs/screenshots/*.png
```

This captures all 8 modules plus an event-detail drawer. (It was not run in the
build sandbox here because that environment's network policy blocks the browser
download — the script is ready to run wherever it doesn't.)
