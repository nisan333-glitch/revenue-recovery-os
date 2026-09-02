# Revenue Recovery OS

**Not a dashboard. An operating system for identifying, assigning, fixing, and
proving recovered revenue.**

```
Revenue Returned = Collected − Baseline
```

Every recovered dollar is auditable. The product visibly separates **detected
opportunity** from **proven recovered revenue**, and the CFO view shows only
revenue that survives a skeptical review.

> → Read [`docs/STRATEGY.md`](docs/STRATEGY.md) — the strategic direction every
> change must serve (Identify · Fix · Prove). New here? Start there.

## Under the hood — a backstage decision engine

The product is **positioned and sold as Identify → Recover → Prove.** Behind that,
a transparent, rule-based decision engine (`src/domain/recommendation.ts`) quietly
**ranks the Recovery Queue by expected value** and **suggests the play** for each
open event (one-click *Apply recommendation*). This is an operator convenience, not
the pitch — it is deliberately **not surfaced as a headline view**. Its *expected
recoverable* forecast lives on the **Revenue Opportunity** ledger and is **never**
blended into recovered/auditable dollars. The moat stays **Proof**, not the
recommendation. We promote this to the front only if customers ask *"great — what do
I do now?"* See [`docs/VISION.md`](docs/VISION.md) §7.

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
4. The **CFO view** shows only auditable recovery, read from **immutable approved Proofs**:
   an approved Proof + reason + independent evidence + proof-grade confidence + real uplift.
5. The dashboard **never blends** detected opportunity with proven recovery.
6. **Forecast ≠ proof:** the Decision Engine's *expected recoverable* (Revenue
   Opportunity ledger) is never summed into recovered/auditable revenue.
7. **The beneficiary never determines the number:** proven/auditable money comes only from
   immutable Proofs created through a trust gate (governed baseline locked before intervention,
   independent evidence, an approver distinct from the owner, mandatory exclusion statement).

These live in `src/domain/` (`invariants.ts`, `proof.ts`, `approval.ts`, `provenLedger.ts`,
`baseline.ts`, `money.ts`) and are covered by `invariants.test.ts`, `trust.test.ts`,
`approval.test.ts`, `money.fromDecimal.test.ts`, `recommendation.test.ts`, `outcomes.test.ts`,
and `seedTrust.verify.test.ts`.

## Modules

| Module | Purpose |
|---|---|
| **Recovery Loop** | The front door — a money screen, Opportunity → Recovery → Proof. Four numbers in two columns: Open Exposure (Money At Risk, Recovery Opportunity) vs Proven Results (Revenue Returned, Auditable Revenue). Forecast and proven never blended |
| Executive Dashboard | Detected opportunity vs proven recovery, money recovered, trends |
| Recovery Queue | Prioritized worklist — assign, act, advance (the fix workflow) |
| Recovery Events | Full record of every event; drill into the workflow drawer |
| CFO Proof View | Audit-grade ledger of only auditable recovered revenue (+ CSV export) |
| Reconciliation | Waterfall from gross recovered → auditable, with every excluded dollar named |
| Attribution Engine | How dollars are credited, by reason / owner / stage, with methodology |
| Recovery Reasons | Canonical taxonomy; flags unclassified (uncounted) events |
| Confidence Score | Transparent scoring; low vs proof-grade split |
| Audit Trail | Append-only log of every change — the chain of evidence |

## Stack

React 18 · TypeScript (strict) · Tailwind CSS · Vite · Vitest. No backend — mutable Cases and a
separate **append-only trust store** (governed Baselines, Evidence, immutable Proofs) are seeded
and persisted in `localStorage` behind a swappable repository interface. (localStorage is
prototype-grade trust only — the tamper-evident boundary is a deferred server.)

## Run

```bash
npm install
npm run dev      # start the app (seeded with realistic events)
npm run test     # run invariant unit tests
npm run build    # typecheck (strict) + production build
```

Open the app, work an item in the **Recovery Queue** (open it → optionally **Apply
recommendation** → assign → add action → classify a reason → mark Recovered). Then, in the
**Prove** panel of the drawer, **establish + lock a governed baseline**, **attach independent
evidence**, and **approve an immutable Proof** (Finance approver, mandatory exclusion statement) —
only then does it appear in the **CFO Proof View**, with a full **Audit Trail**. Seeded recovered
cases already carry approved Proofs. The *expected recoverable* forecast stays separate from the
proven number throughout. Use **Reset demo data** in the sidebar to restore the seed. State
persists across refreshes.

## Private pilot runtime

> ⚠️ **Private, supervised pilot use only — not safe for public exposure or multi-tenant
> production.** This packaging (Docker image + `docker-compose.yml`) runs the real React
> SPA, the real Fastify API, and real PostgreSQL together as one deployable unit, for a
> single supervised pilot customer. It does **not** add authentication — identity is still
> the `x-actor-id` / `x-actor-role` dev-header mechanism in
> `server/auth/actorContext.ts`, which is explicitly documented there as *not* production
> authentication. `docker-compose.yml`'s database credentials are fixed, local-only
> placeholders, clearly labeled as such in that file. Do not point this at the public
> internet, and do not use it to serve more than one customer's data at a time.

Start the whole stack (SPA + API + PostgreSQL, migrations applied automatically before the
app starts):

```bash
docker compose up --build
```

The app is reachable **only from this machine**, at `http://127.0.0.1:4000` (the compose
file binds it to the host's loopback interface only — never `0.0.0.0` — and publishes no
port for PostgreSQL at all). Check it's healthy:

```bash
curl http://127.0.0.1:4000/health   # -> {"status":"ok"}
curl http://127.0.0.1:4000/ready    # -> {"db":"up"} once PostgreSQL is ready
```

Stop and remove the stack:

```bash
docker compose down
```

Add `-v` (`docker compose down -v`) if you also want to delete the PostgreSQL data volume
between pilots.

### How this differs from `npm run dev`

- `npm run dev` (Vite) + `npm run dev:server` (Fastify, separate terminal) is still how you
  work on the product day to day — Vite's dev server proxies `/api/*` to Fastify
  (`vite.config.ts`), so both must be running for the governed backend calls to resolve.
- The Docker/Compose path is the **packaged** equivalent for a pilot: one process
  (`server/productionServer.ts`, compiled to plain JavaScript — no TypeScript dev runner in
  the image) serves the built SPA, `/api/*`, and `/health` + `/ready` all from one origin.
