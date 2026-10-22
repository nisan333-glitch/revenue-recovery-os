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
  it. **Obligation-grained identity needs the primary-key migration and an optional contract field — not done,
  needs its own approval.**
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

## What it does NOT do

* The arc stops at **EVIDENCED**. A proof needs a `recoveryReason`, and that vocabulary (retention and
  activation plays) has no truthful value for a corrective invoice. Using `UsageActivation` would write a false
  reason into an immutable proof. §14 asserts the case is *not* proven.
* The observation is injected by the harness. NH has no screen that creates a detector task, deliberately.
* Nothing here reads a customer file in production, and no figure is Revenue Returned.

## Approvals needed

1. **A billing-correction `RecoveryReason`** (vocabulary addition in `types.ts`, `reasons.ts`, the HTTP schema)
   so the proof stage can close honestly.
2. **Obligation-grained identity** (migration plan already in `docs/architecture/`).

## Verification status

Unofficial local shim only until CI runs: observer 27/27, importer guard 18/18. The shim is not an official
result. The journey (§14) and the Postgres test have **not** been run by me — no database or browser here.
