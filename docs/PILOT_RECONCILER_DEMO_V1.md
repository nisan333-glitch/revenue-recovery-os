# Pilot reconciler demo · V1

Branch `claude/pilot-reconciler-demo-v1`, based on `pilot-journey-v1` (`c49ec7c`) plus the accepted audit
(`af4395f`). **Synthetic only. Private demonstration. No live data, no payment processing, no public
deployment, no migration, no contract change, no change to monetary or proof semantics.**

## What it is

The audit's stage 2 — *independent expected obligations vs billed lines* — had no production caller. It has
one now: `server/agents/reconciliationObserver.ts`, an opt-in `AgentHandler` that

1. validates two raw extracts with the **real** expectation and billing validators,
2. runs the **real** obligation-aware reconciliation core,
3. emits `CandidateSignal`s for the units that are UNDER_BILLED, unpaired and priced,
4. into the **existing** governed path: admission bar → pending review → human accept → promotion → Recovery Case.

Everything it emits is **Revenue Opportunity** (observed exposure). It constitutes neither proof nor revenue
(`claimBoundary` is typed `constitutesProof: false`), and Revenue Returned is still computed only from signed
evidence under a locked baseline.

## Operator demo — Identify → Fix → Prove from the UI (private, synthetic, off by default)

**No seed script is an operator step.** The screen is **Synthetic Demo (live API)** in the *Demo* nav group. (The
neighbouring *Synthetic Pilot v2* is a client-side simulation; this one calls the real governed API.)

Needs Postgres (`DATABASE_URL`) and the usual dev install. Start the API with the demo explicitly enabled — it is
off unless asked for, refuses `NODE_ENV=production`, and **refuses to boot** if the process could not actually
run the reconciler for its boundary:

```
NH_AGENTS_ENABLED=true  NH_AGENT_BOUNDARIES=SYNTHETIC-DEMO
NH_RECONCILIATION_OBSERVER_ENABLED=true  NH_RECONCILER_PSEUDONYM_KEY=<≥32 chars>
NH_AGENT_ADMISSION_POLICIES=RevenueUnderBilled:10000
NH_SYNTHETIC_DEMO_ENABLED=true            # NH_SYNTHETIC_DEMO_BOUNDARY overrides the boundary name
```

Then, in the browser (dev server — dev identity headers), as the operator `pilot-operator@company`:

| # | Click | What the server does | What you see |
|---|---|---|---|
| 1 | **Launch synthetic reconciliation** | enqueues the labelled book; the real reconciler + worker + admission bar run | 3 candidates, **$3,100.00 Revenue Opportunity · not proven**; Returned = **NOT COMPUTED** |
| 2 | **Accept candidate** → **Open Recovery Case** | review (immutable) then promotion (separate action) | one case, its exposure; stage OPENED |
| 3 | **Record case owner** | authority row | OWNED |
| 4 | **Lock baseline** (default 100.00) | baseline locked, server-stamped | BASELINED |
| 5 | **Record corrective action** | `Intervene` authority row | INTERVENED |
| 6 | **Simulate synthetic payment** | the demo's *synthetic billing source* signs an `invoice_paid` record for **the server-fixed amount (= the exposure)**; the real verifier, role gate and halt gate ingest it | EVIDENCED — still **NOT COMPUTED** (evidence is not money) |
| 7 | **Approve proof as Finance** | a *different* identity (`cfo@company`, approver) freezes the proof as `BillingCorrection`, collected read from the signed record | **PROVEN** — Returned = collected − baseline (e.g. $600.00 − $100.00 = **$500.00**), Opportunity unchanged at $600.00 |

### How the "payment" stays honest
* The operator **cannot type** the amount, currency, date, source or evidence id. `POST /synthetic-demo/cases/:id/settle`
  reads no body; the claim is built from the case's own frozen root by a rule fixed in `server/demo/syntheticDemo.ts`.
* The signing key is generated **inside the API process at start-up**, never written, never serialised, never held by a
  harness; only its public half joins the verifier's registry (bound to the `billing` source system).
* `settle` refuses a case that is not from this demo's book on this demo's boundary, refuses until the corrective action
  and a locked baseline already exist (the payment cannot precede the fix), and settles a case at most once.
* Approval is **not** a demo shortcut: it is the normal gate (distinct approver, separation of duties, signed
  independent outcome evidence ≥ collected, closed reason vocabulary, baseline ordering).
* Every screen and record says **SYNTHETIC**: banner, panel labels, evidence `sourceRecordId` and `note`, proof text.

### Known limits / decisions I did NOT take
* The evidence uses the existing allowlisted source system **`billing`** (its role map is what makes a record an
  *outcome*). A dedicated `synthetic-billing-source` would need a new `ROLE_MAP_VERSION` — a governance object — so it
  is **not done**. Consequence: the only thing distinguishing demo evidence from real billing evidence is the key id
  (`SYNTHETIC-DEMO-billing-…`, recorded in the verifier receipt), the `SYNTHETIC-` record id and the note — and the
  demo cannot run in production.
* Dev identity headers only; no production identity or boundary grant model is exercised by this screen.
* One launch per boundary per database (idempotent); to run the book again, use a fresh boundary or database.
* Baseline is operator-entered (existing semantics: it must be locked before any outcome).

### Automated coverage
* `server/demo/syntheticDemo.test.ts` — the rules, DB-free (roles, boundary, ordering, once-only, key never exposed, verifier accepts only the exact claim).
* `server/demo/syntheticDemo.postgres.test.ts` — the real routes, worker and Postgres, to PROVEN, with negative controls.
* `src/modules/syntheticDemoConsole.test.ts` — structural guard (no seed context, no fetch, operator never approves, no amount parameter).
* `e2e/journey.mjs` §14 — a real browser driving the screen above, plus negative controls.

## Earlier arc (kept for reference)

`npm run test:journey` is what CI runs. Before the operator screen existed, §14 queued the book with a harness seed
script (`seed-journey-reconciliation-task.ts`) — that script has been **removed**; the launch is now the screen's button.

## What the labelled demo book contains

`server/agents/fixtures/reconciliation.synthetic.ts` — every identifier carries `DEMO`.

| Unit | Outcome | Reaches the queue? |
|---|---|---|
| DEMO-A March billed 1,800 of 2,400 | UNDER_BILLED, unpaired | yes — $600.00 |
| DEMO-B February never invoiced | UNDER_BILLED, unpaired | yes — $1,500.00 |
| DEMO-G January unbilled | UNDER_BILLED; obligation references refute the timing pairing | yes — $1,000.00 |
| DEMO-C billed exactly | MONETARILY_BALANCED (not "no leakage") | no, counted |
| DEMO-D billed above what is owed; DEMO-G February | OVER_BILLED liability | no, **never netted** |
| DEMO-E blank expected amount | UNKNOWN | no, counted — never $0.00 |

Plan: 10 units, 3 candidates, exposure **$3,100.00** (positives only).

## Decisions worth reading

* **Candidates are account-grained.** One candidate per payer; a payer's positive units are summed. I first
  pseudonymised the *unit* and abandoned it: every read surface already calls a candidate an account, and a
  unit reference labelled "account pseudonym" would be a false statement on the page. The consequence is the
  product's existing, disclosed one: a later shortfall for a payer who already has a candidate is absorbed by
  it. **Obligation grain for the assessment lane needs the primary-key migration; for this lane it is a governed
  choice of what to pseudonymise, not a schema change. See `docs/architecture/RECONCILER_GOVERNANCE_PROPOSALS_V1.md` §B — not done.**
* **First observation wins.** The store's `ON CONFLICT DO NOTHING` keeps the first figure. Tested on the
  in-memory store and, in `reconciliationWorker.postgres.test.ts`, on the production store.
* **No payer, no candidate.** A unit whose contract side names zero or several payers is withheld and
  counted (`underBilledWithheldNoSingleAccount`); the billing side's payer is never substituted.
* **Finding in the core, not patched.** With one February line of 2,000 citing January's obligation against two
  1,000 obligations, the core refuses February but offers January as an unpaired shortfall — money that may
  already have been paid. The adapter withholds such a unit when any unit of the same entitlement is REFUSED
  (`underBilledWithheldBySiblingRefusal`). The core was left alone.
* **Importer guard.** `expectationExtract.test.ts` now names `reconciliationObserver.ts` as an allowed
  importer and bans it from importing the ledger, proof, assessment or case modules.

## The arc, end to end (journey §14 / §14b)

Injected observation → reconciler → pending candidate → human accept → promotion → **Recovery Case** →
author / baseline / intervention → **signed outcome evidence** → approver freezes the proof with reason
**`BillingCorrection`** → **PROVEN**. On the screen: the identified exposure (e.g. $600.00) and the proven
return ($70.00 = collected $90.00 − baseline $20.00, synthetic) as two different numbers.

`BillingCorrection` was added as an approved, additive vocabulary value (type, reasons table, HTTP enum). No
migration: the proof column is plain text. It is a **label**: the reason is absent from `Collected − Baseline`,
and a billing correction with nothing collected above baseline returns $0 (tests in
`src/domain/billingCorrection.test.ts`).

**Negative controls, each of which must be refused while the case stays un-proven:** claiming more collected
than the signed evidence substantiates; citing no evidence; the author or the operator who opened the case
approving; a reason outside the closed vocabulary; signed evidence whose amount was altered after signing.

## What it does NOT do

* The observation is injected by the harness. NH has no screen that creates a detector task, deliberately.
* Nothing here reads a customer file in production, and no figure is Revenue Returned of a real customer.
* The CFO proof screen still renders seed data, with a banner saying so.

## Still blocked on approval

Obligation-grained identity. Designs, not implementations:
`docs/architecture/RECONCILER_GOVERNANCE_PROPOSALS_V1.md` §B (reconciler lane: constitution amendment, no
schema change) and `docs/architecture/OBLIGATION_GRAIN_SCHEMA_MIGRATION_DESIGN_V1.md` (assessment lane:
additive sibling table, invariants, collisions, rollback, tests).

## Verification status

Official CI on the pushed branch is the only result that counts; see the run URL in the hand-off report. My
local numbers (observer 27/27, importer guard 18/18) came from an unofficial stand-in and are not results.
