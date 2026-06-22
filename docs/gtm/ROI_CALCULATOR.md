# Activation Leak — ROI Calculator (one CSV, no integration)

This is the **"show them their own leakage"** asset. From a single historical
export you size the leak and the *incremental* recovery — before any integration,
before any build. The math is identical to [`../PROOF_MODEL.md`](../PROOF_MODEL.md):
**recovered = (t − b) × ARPA × n.**

## The only data you need (one CSV)

```
account_id, signed_date, activated_date | null, next_invoice_paid (true/false), ARPA
```

From it, compute everything below per cohort (e.g. accounts signed in a quarter).

## Inputs

| Symbol | Input | How to get it from the CSV |
|---|---|---|
| `S` | signed accounts in the period | count of rows |
| `s` | **stall rate** = signed but not activated by day N | share with `activated_date` null past day N |
| `n` | **stalled accounts** = `S × s` | the at-risk cohort |
| `ARPA` | annual revenue per account | mean `ARPA` of stalled accounts |
| `b` | **baseline conversion** of stalled → next invoice paid (no help) | `next_invoice_paid` rate among historically-stalled accounts |
| `t` | **treated conversion** (target with our plays) | hypothesis for the pilot (validate, don't assume) |

## Outputs

```
Revenue exposed to stalls   =  n × (1 − b) × ARPA      # stalled accounts that don't pay at baseline
Incremental recovered (ours)=  n × (t − b) × ARPA      # the delta we book — only what we cause
Recoverable ceiling         =  n × (1 − b) × ARPA      # if every stalled non-payer were saved (t→1)
```

Only **Incremental recovered** is ever booked (to Revenue Returned). The rest is
context. We never claim the baseline conversions that would have happened anyway.

## Worked example (sanity check the formula)

Inputs: `S = 100/quarter`, `s = 40%` → `n = 40`; `ARPA = $12,000`; `b = 30%`;
pilot target `t = 50%`.

```
Revenue exposed to stalls    = 40 × (1 − 0.30) × 12,000 = $336,000 / quarter
Incremental recovered (ours) = 40 × (0.50 − 0.30) × 12,000 = $96,000 / quarter
Annualized incremental       ≈ $96,000 × 4 ≈ $384,000 / year
```

So the pitch becomes concrete and conservative: *"Across a year, ~$384k of next-
invoice revenue is at stake in stalled activations; a 20-point lift over your own
baseline is ~$384k recovered — and we book only the lift, proven to paid invoices."*

## Pricing frame (anchor on the result, not a flat fee)

- Anchor on **% of incremental recovered**, not $10k/yr (too low to be a real
  decision).
- Example: 15–25% of proven incremental → on $384k that's $58k–$96k/yr, and the
  customer keeps 75–85% of money they were losing. Easy ROI math.

## Honesty guardrails (so the number survives a CFO)

- `b` comes from **their own history**, not an industry guess.
- `t` is a **hypothesis to prove in the pilot**, never presented as fact up front.
- Book only `(t − b)`, never `t`. The baseline would have converted without us.
- Match the baseline cohort on period / plan / segment to avoid seasonality and
  selection bias (see `../PROOF_MODEL.md`).

## Fillable

```
S  (signed/period)        = ____
s  (stall rate %)         = ____   → n = S × s = ____
ARPA ($/yr)               = ____
b  (baseline conv %)      = ____
t  (target conv %)        = ____

Revenue exposed to stalls = n × (1 − b) × ARPA = $____
Incremental recovered     = n × (t − b) × ARPA = $____  ← the number that matters
Annualized                = $____
```
