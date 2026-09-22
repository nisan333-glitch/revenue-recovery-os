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
| Candidate Review | Governed operator gate between detector output and Recovery Case creation — immutable accept/reject reason, followed by a separate explicit promotion step |
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
> single supervised pilot customer. Production mode requires verified OIDC/JWKS bearer
> identity with a non-empty boundary-scope claim (`NH_OIDC_BOUNDARY_CLAIM`, default
> `nh_boundaries`) and rejects browser-supplied actor headers; dev headers are available only for
> an explicitly isolated private pilot. `docker-compose.yml`'s database credentials are fixed, local-only
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
curl http://127.0.0.1:4000/ready    # -> {"db":"up","agents":{"status":"disabled",...}}
```

Agent execution is deliberately disabled by default. Setting `NH_AGENTS_ENABLED=true`
without both an explicit `NH_AGENT_BOUNDARIES` list and a reviewed production handler makes
startup fail closed. The worker lifecycle, leasing and readiness plumbing exist; no detector is
silently promoted into a continuously running process.

Generate the deterministic **SYNTHETIC** ActivationMissed fixtures. These are fictional test
inputs, not customer evidence. The 100-row mixed fixture contains 70 admissible rows, 15 below
threshold, 5 without an action, 5 duplicates and 5 malformed rows. Importing that complete file
must reject the batch before any persistence call. For the successful local test path, use the
separate 95-row well-formed subset shown below:

```bash
npm run fixture:activation
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB"
export NH_INGEST_BOUNDARY_ID="synthetic-tenant"
export NH_INGEST_AGENT_ID="SYNTHETIC-activation-missed-csv"
export NH_INGEST_DETECTOR_VERSION="SYNTHETIC-v2"
export NH_INGEST_SOURCE_REF_KEY="replace-with-at-least-32-secret-bytes"
export NH_AGENT_ADMISSION_POLICIES="ActivationMissed:10000"
npx prisma migrate deploy
npm run ingest:csv -- "$PWD/server/agents/fixtures/activation.well-formed.synthetic.csv"
```

The generator writes both CSVs and `activation.synthetic.expected-results.json` with owner-only
permissions. The JSON contains 100 individual row outcomes measured from the existing code,
plus separate whole-file expectations. Per-row evaluation imports one row at a time in order
into an initially empty candidate store. The well-formed batch admits 75 observations, creates
70 pending candidates, deduplicates 5 and filters 20. Repeating that batch creates no additional
candidates. The configured threshold is 10,000 minor units, inclusive, in each supported
currency; it does not imply FX equivalence or a universal business threshold.

The importer validates the entire file before its first persistence call and pseudonymizes
source identity. This does not establish atomicity across later database failures. Synthetic
labels in the fixture, boundary, agent and detector version must remain visible. No result
establishes ROI, precision, recall, causality, recovered revenue, customer behavior or production
readiness. Supplied composite identities are tested; the upstream `ENTITY_DEFINING_CONTEXT`
and `sufficient=True` rule is not implemented or validated by this seven-column CSV interface.

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
