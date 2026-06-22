# Revenue Recovery OS — Demo Script

A 5-minute walkthrough that proves the one thing that matters: **recovered revenue
is real, separated from hope, and auditable to the dollar.**

> Setup: `npm install && npm run dev`, open the app. If data was edited,
> click **Reset demo data** in the sidebar to restore the seed below.

---

## Executive demo (5 minutes) — the sharp cut

Audience: CRO / CFO / CEO (it doubles as the discovery open). Do **not** tour
features or name engines. Tell one story — **we found money, we acted, the money came
back, here is the proof** — anchored on the Activation leak: *signed → never
activated → second invoice at risk.*

1. **(0–1 min) The whole story on one screen — the Recovery Loop.** The front door,
   read left to right in five numbers — the 15-second answer: **Money At Risk
   $71,800 → Recovery Opportunity $32,660 → Actions Taken 11 → Revenue Returned
   $83,400 → Auditable Revenue $79,800.** Say it aloud: *"We found $71,800 at risk,
   forecast $32,660 recoverable, acted on 11 accounts, returned $83,400 — and $79,800
   of it is backed by evidence a CFO can sign."* Amber (at risk, opportunity) is
   forecast; green (returned, auditable) is proven — we never add the two together.
2. **(1–2 min) The leak is the activation gap.** *"These accounts signed and never
   reached activation, so the second invoice is at risk — money falling between
   signature and value."* Point to the biggest live one: **Stark Solutions, $31,000
   at risk.**
3. **(2–3½ min) Work one account live — found → acted → returned.** Open **Stark
   Solutions (RE-1007)** in the Recovery Queue. Record the activation action
   ("Guided the account to its activation milestone"), set **Recovery Reason =
   Milestone Nudge**, **Collected = 31,000** (baseline 6,200), **Status → Recovered.**
   **Revenue Returned computes live to +$24,800.** *"We didn't forecast it — we
   acted, the second invoice cleared, and the number is Collected − Baseline."*
4. **(3½–4½ min) The number a CFO can sign.** CFO Proof View + Reconciliation:
   **$83,400 recovered, but only $79,800 auditable.** The $3,600 gap is one named
   low-confidence event; the $4,300 unclassified recovery counts for **nothing**.
   *"We don't count money we can't explain. This survives your finance review — to
   the dollar."* One click — **Export CSV** — and the ledger leaves the room auditable.
5. **(4½–5 min) Their turn — the close.** *"Send us one export: signed date,
   activated or not, second invoice paid, ARPA. No integration. We'll show you your
   leak and what's recoverable."* (See `VALIDATION.md`.)

The demo's job is not to impress with modules. It is to make them say *"that's our
problem, and nobody proves it today."*

> Honest-loop note: we show **Action Taken**, never "Fixed." An action is observable
> and sits in the audit trail; "fixed" is a claim we don't make until execution is
> fully modeled (owner, task, SLA, completion proof). Saying only what we can prove
> *is* the pitch — see `STRATEGY.md`.

> Backstage note (do not lead with this): the Recovery Queue is quietly ranked by a
> rule-based engine that also suggests the play (**Apply recommendation**). An
> operator convenience, not the pitch. The green proven number — not the forecast —
> earns the budget. See `docs/VISION.md` §7.

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

## Deep-dive beats (optional — for a longer or more technical session)

The 5-minute cut above is the demo. These beats are the slower module-by-module
walkthrough when someone wants to see every surface.

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

1. Open **Recovery Queue** — open activation risks ranked by expected recoverable
   value (**Stark Solutions $31,000** at risk on top — signed but not activated).
2. Click **Stark Solutions (RE-1007)** to open the drawer. Then:
   - **Assign** an owner.
   - **Record an action** (e.g. "Guided the account to its activation milestone").
   - Set **Collected = 31000** (baseline is $6,200).
   - Set **Recovery Reason = Milestone Nudge**.
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

*"Revenue Recovery OS doesn't tell you revenue leaked. It finds the leak, acts on
it, recovers the cash, and hands your CFO a number that survives the audit — to the
dollar."*

---

## Capturing screenshots

Real browser screenshots are produced by `scripts/screenshots.mjs`. In an
environment that permits the Chromium download:

```bash
npx playwright install chromium
npm run build && npm run preview &      # serves on http://localhost:4173
npm run screenshots                     # writes docs/screenshots/*.png
```

This captures the Recovery Loop and every module plus an event-detail drawer. (It
was not run in the build sandbox here because that environment's network policy
blocks the browser download — the script is ready to run wherever it doesn't.)
