# Revenue Recovery OS — Demo Script

A 5-minute walkthrough that proves the one thing that matters: **recovered revenue
is real, separated from hope, and auditable to the dollar.**

> Setup: `npm install && npm run dev`, open the app. If data was edited,
> click **Reset demo data** in the sidebar to restore the seed below.

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
