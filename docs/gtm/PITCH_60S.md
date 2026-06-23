# The 60-second pitch — CEO / CFO / CRO

> The 5-minute walkthrough is [`DEMO.md`](../DEMO.md); the one-page brief is
> [`EXEC_ONE_PAGER.md`](EXEC_ONE_PAGER.md). **This** is the 60 seconds that earns them.
> The goal is not to explain the product — it is to make an executive *immediately*
> understand the problem, why today's tools miss it, what we do differently, and why
> the proof can be trusted. Optimize for comprehension, not completeness.

---

## The category line — open with this

> **"Most companies can tell you how much revenue they *generated*. Very few can tell
> you how much they *recovered*. Fewer can *prove* it."**

Three sentences, each sheds companies until only we're left: generation → recovery →
proof. It frames the category before a single number — everything below earns it.

---

## A · The 60-second pitch (spoken — read aloud, ~150 words)

**The problem.** "Every quarter a chunk of your new customers sign, stall before they
ever get value, and quietly skip their next invoice. Sales already counted them as won.
Finance just watches the money disappear. Nobody owns that gap — and nobody can prove
what was saved.

**Why today's tools don't fix it.** Your dashboards can tell you revenue dropped. That's
detection — a report of the past. It doesn't recover a dollar, and it can't prove that
anything you *did* brought money back.

**What we do.** Revenue Recovery OS runs one loop on each leaking account: we find it, we
act on it with an owned play, and we prove the cash came back.

**Why you can trust the number.** We keep two books and never blend them. One is
forecast — what we think we can recover. The other is cash we actually returned, measured
against *your own* historical baseline. And only the part backed by evidence your CFO can
sign, we call auditable. **We don't count money we can't explain. That last number is one
no BI tool will ever give you.**"

---

## B · The 10-second version (the elevator)

> "BI tells you revenue leaked. We find the leak, recover the cash, and hand your CFO a
> number that survives the audit — to the dollar."

---

## C · The scoreboard — the 60-second *proof*

Five lines, read top to bottom. Forecast on top, audited cash at the bottom:

```
We found        $71,800   at risk            ← forecast (Recovery Opportunity)
We forecast     $32,660   recoverable        ← forecast
We acted on     11        cases              ← observable action
We returned     $83,400   in cash            ← proven (Revenue Returned = Collected − Baseline)
We can audit    $79,800   of it              ← CFO-signable subset (Auditable Revenue)
```

**The line that wins the room:** *"The top two are forecast. The bottom is audited cash —
and the $3,600 gap between returned and auditable is one low-confidence event, named. We
show you the gap; we don't hide it."*

> The honesty *is* the pitch. Most companies would bury the $3,600. Naming it is what a
> CFO trusts. (Numbers locked by `src/data/seed.verify.test.ts`; they mirror
> [`DEMO.md`](../DEMO.md).)

---

## D · The two terms that must land instantly

The whole comprehension test is whether these are self-evident. Bake the gloss into the
sentence — never say the term naked:

- **Recovery Opportunity** → *"what we forecast we can get back — not money yet."*
- **Auditable Revenue** → *"recovered cash backed by proof your CFO can sign."*

---

## E · Objection handler — "How is this different from a BI report?"

The single most likely failure question. Answer in three beats:

> "A BI report ends at *'next-invoice revenue is down 12%.'* It **detects and reports**.
> We do the three things a report can't:
> 1. we **act** on each account with an owned, tracked play;
> 2. we **attribute** the recovered dollars to that action against your own baseline —
>    so it's the money we *caused*, not money that would've come back anyway;
> 3. we **separate forecast from proven**, so finance signs only the proven book.
>
> **BI tells you what happened. We tell you what came back because someone acted.**"

---

## F · The four-question spine (why it's ordered this way)

Every executive runs the same silent checklist. The pitch answers it in order — keep
this order when you re-tighten:

| Exec's question | Pitch beat |
|---|---|
| 1. What problem exists? | "signed → stalled → skipped invoice; nobody owns the gap" |
| 2. Why don't existing systems solve it? | "dashboards detect the past; they don't recover or prove" |
| 3. What do *you* do differently? | "one loop per account: find → act → prove" |
| 4. Why can I trust the number? | "two books never blended; only what a CFO can sign is auditable" |

**Win condition:** the pitch is built so the natural next question is *"how do you prove
it?"* — which opens the CFO Proof View. If instead they ask *"what is this?"*, the
message failed, not the product.

---

*Revenue Recovery OS · Identify → Fix → Prove · Recovery Opportunity · Revenue Returned ·
Auditable Revenue.*
