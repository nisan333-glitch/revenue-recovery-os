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

## Demo run steps

Needs Postgres (`DATABASE_URL`) and the usual dev install.

```
npm run test:journey        # CI runs this; §14 is the reconciler arc
```

To run it by hand against a local API: start the API with
`NH_AGENTS_ENABLED=true NH_AGENT_BOUNDARIES=<boundary> NH_RECONCILIATION_OBSERVER_ENABLED=true
NH_RECONCILER_PSEUDONYM_KEY=<≥32 chars> NH_AGENT_ADMISSION_POLICIES=RevenueUnderBilled:10000`, then
`npx vite-node scripts/seed-journey-reconciliation-task.ts <boundary>`, and use **Candidate Review** →
*Load candidates* → *Accept for case creation* → *Create Recovery Case* → **Recovery Case**.

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
