# Revenue Recovery OS

**Not a dashboard. An operating system for identifying, assigning, fixing, and
proving recovered revenue.**

```
Revenue Returned = Collected − Baseline
```

Every recovered dollar is auditable. The product visibly separates **detected
opportunity** from **proven recovered revenue**, and the CFO view shows only
revenue that survives a skeptical review.

## The decision loop (Phase 2)

The product runs the front of the loop, not just proof:
**Problem → Diagnosis → Recommendation → Action → Proof.** The **Outcomes** surface
turns events into business problems, and a transparent, rule-based **Decision
Engine** (`src/domain/recommendation.ts`) recommends the play and an *expected
recoverable* forecast for every open event. That forecast lives on the **Revenue
Opportunity** ledger and is **never** blended into recovered/auditable dollars —
proof stays the moat *inside* the loop. See [`docs/VISION.md`](docs/VISION.md).

## Validation — the open question

The locked wedge is **Onboarding / Activation Recovery** — *"we return money lost
between signature and activation."* The remaining risk is demand, so the validation
program runs alongside the build:
- [`docs/PROOF_MODEL.md`](docs/PROOF_MODEL.md) — how activation recovery is proven
  (matched-cohort baseline, delta-over-baseline = recovered, audit chain to cash).
- [`docs/VALIDATION.md`](docs/VALIDATION.md) — the validation program: 10 companies →
  10 interviews → 3 CSV-first pilots → willingness-to-pay.
- [`docs/gtm/`](docs/gtm/) — ready-to-run validation assets: ICP, target-account
  list, outreach sequence, discovery script, ROI calculator, executive one-pager.
- [`docs/DEMO.md`](docs/DEMO.md) — the 10-minute discovery demo.

## Why this exists

Most software *reports symptoms*. This system owns the full loop for one sharp,
defensible problem — recovered revenue — and **proves** it. See
[`docs/VISION.md`](docs/VISION.md) for the larger Organizational Flow Intelligence
vision and an honest board-level critique of it, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how this MVP evolves into it.

## The five rules (enforced in code, not cosmetic)

1. `revenueReturned` is **always computed** as `collected − baseline` — never entered.
2. Events **without a recovery reason are not counted** toward recovered revenue.
3. **Low-confidence** recoveries stay visible but **separated** from proof-grade.
4. The **CFO view** shows only auditable recovery: `Recovered` + reason +
   proof-grade confidence + real uplift.
5. The dashboard **never blends** detected opportunity with proven recovery.
6. **Forecast ≠ proof:** the Decision Engine's *expected recoverable* (Revenue
   Opportunity ledger) is never summed into recovered/auditable revenue.

These live in `src/domain/invariants.ts` / `src/domain/recommendation.ts` and are
covered by `invariants.test.ts`, `recommendation.test.ts`, and `outcomes.test.ts`.

## Modules

| Module | Purpose |
|---|---|
| Outcomes | Problems (not events): at-risk, **expected recoverable (forecast)**, recovered, auditable + the recommended play |
| Executive Dashboard | Detected → Expected Recoverable → Recovered → Auditable chain; money recovered, trends |
| Recovery Queue | Prioritized worklist — assign, act, advance (the fix workflow) |
| Recovery Events | Full record of every event; drill into the workflow drawer |
| CFO Proof View | Audit-grade ledger of only auditable recovered revenue (+ CSV export) |
| Reconciliation | Waterfall from gross recovered → auditable, with every excluded dollar named |
| Attribution Engine | How dollars are credited, by reason / owner / stage, with methodology |
| Recovery Reasons | Canonical taxonomy; flags unclassified (uncounted) events |
| Confidence Score | Transparent scoring; low vs proof-grade split |
| Audit Trail | Append-only log of every change — the chain of evidence |

## Stack

React 18 · TypeScript (strict) · Tailwind CSS · Vite · Vitest. No backend — data
is seeded and persisted in `localStorage` behind a swappable repository interface.

## Run

```bash
npm install
npm run dev      # start the app (seeded with realistic events)
npm run test     # run invariant unit tests
npm run build    # typecheck (strict) + production build
```

Open the app on **Outcomes** to see the problems and their forecast, then work an
item in the **Recovery Queue** (open it → **Apply recommendation** to adopt the
play → mark Recovered). Watch it flow into the **CFO Proof View** with a full
**Audit Trail** — while the *expected recoverable* forecast stays separate from the
proven number throughout. Use **Reset demo data** in the sidebar to restore the
seed. State persists across refreshes.
