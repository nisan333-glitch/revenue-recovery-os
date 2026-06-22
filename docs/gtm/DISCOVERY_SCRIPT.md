# Discovery Script — Activation Recovery

**Goal of the call: falsify the wedge, not sell it.** You are testing whether
signed-but-stalled revenue is *unowned, unmeasured, and unprovable today*. If it
isn't, you want to find out in 20 minutes, not after building for two months.

Keep it to **25–30 minutes**. Talk 20%, listen 80%. Do **not** demo unless they ask.

## Open (2 min)

> "I'm researching what happens to revenue between when a customer signs and when
> they're actually live and paying their next invoice. I'm not selling anything
> today — I want to understand how you handle it. Can I ask how it works at [co]?"

## The sharp opening question (the whole call hinges on this)

> **"What happens between a signed contract and the second invoice?"**

Then shut up. Let them narrate. You're listening for: a gap, a manual scramble, "it
depends," or "honestly, we don't really track that."

## Core questions (in order)

1. **Pain & ownership**
   > "When a customer signs but never activates — who owns that, and what does it
   > cost you?"
   - Listen for: is there an owner? a number? or a shrug?

2. **Detection**
   > "How would you even know today that an account has stalled before it churns or
   > skips the next invoice?"
   - Listen for: is there a defined activation event and a day-N threshold?

3. **Data accessibility (the real feasibility test)**
   > "Could you tell me, per account, whether they activated and whether the next
   > invoice was paid — from systems you already have?"
   - Listen for: is this one export, or a three-system archaeology project?

4. **The incremental question (the budget unlock)**
   > "Today, are you recovering those accounts — and could you prove how many came
   > back *because of an action* vs would have come back anyway?"
   - Listen for: can they separate *caused* recovery from *coincidence*? Almost no
     one can. That gap is the product.

5. **Willingness (only if 1–4 landed)**
   > "If I could show you, from one CSV, how much you're leaking between signature
   > and activation — and a way to prove recovery — would that be worth a look?"

## What to listen for (score each call)

| Signal | Strong (go) | Weak (pivot) |
|---|---|---|
| Ownership | "nobody really owns it" | "CS handles it, fully covered" |
| Measurement | "we don't track it" | "we have a dashboard for it" |
| Provability | "couldn't prove causation" | "we can attribute it cleanly" |
| Data | "yeah, I could export that" | "that data is everywhere / nowhere" |
| Emotion | leans in, gives a number | polite, no urgency |

## Kill criterion

If a prospect says *"we already do this and can prove it"* — log it. If **several**
say it, the wedge is wrong. **Do not build another engine — change the wedge.**

## Per-call note template (copy per interview)

```
Company / person / role / date:
Fit score (0–7):
Activation event (their words):
Signed → second-invoice gap (their narrative):
Who owns stalled accounts:
Can they quantify the leak? (Y/N + number):
Can they prove causal recovery today? (Y/N):
Data: one export or scattered? :
Willing to share a CSV? (Y/N):
Value prop that landed: incremental recovery / assurance / neither
Verdict: strong / weak / dead
Next step:
```

## After the call

Strong + willing → request the CSV, run [`ROI_CALCULATOR.md`](ROI_CALCULATOR.md),
send [`EXEC_ONE_PAGER.md`](EXEC_ONE_PAGER.md). Aim to convert **3** into Week-0 leak
assessments.
