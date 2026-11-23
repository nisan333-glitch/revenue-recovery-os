# Pilot blocker map · what actually stops a provable first pilot

**Read-only audit at `98b63a2`, CI #349 green.** Nothing was changed to produce it.
**Date:** 2026-11-18.

Every claim below was verified by reading the code at that commit. Where I state a path exists or is
blocked, the file and line are named so the claim can be re-checked rather than believed.

---

> ## ⚠ SUPERSEDED IN PART · T1 IS CLOSED (2026-11-23)
>
> **This page is an audit of `98b63a2` and its T1 finding is no longer true of the code.** The
> two-extract intake was built in **`636cf46`** — the only commit in `98b63a2..1bdbaa7` that touched
> `server/app.ts` or `server/services/pilotPairIntakeService.ts`. See **§1 · T1 · ERRATUM** below.
>
> The original finding is **preserved unchanged** rather than rewritten: it was accurate when written,
> and a superseded conclusion is corrected and kept, never deleted. What is corrected is its *status*.
>
> **T1 is CLOSED at the code and test level. C1 — switching the path on in a real deployment — is
> OPEN.** Development complete is not the same claim as running, and this page keeps them apart.
>
> **A stale document that contradicts the code is a defect, not noise** — which is why this marker sits
> above the body and not in a footnote.

---

## 0 · The headline, because it changes the plan

> **A provable first pilot does NOT require a bank.**

`citedSettlements` on the approval request is **optional** and can only ever add refusals
(`proofService.ts`; the Postgres suite's positive control mints a proof with it omitted). `PROVEN` is
reached from **signed outcome evidence alone** — `src/domain/outcomeEvidence.ts:97-160`.

So the institution track (B2) and the shared payer identifier (B1) **upgrade** a proof from
*system-of-record attested* to *third-party corroborated*. They are not preconditions. Treating them
as the gate to a first pilot has been delaying a pilot that a different, smaller dependency blocks.

**And the one thing that does block it is ours, not a bank's.**

---

## 1 · Technical blockers — ours to clear

### T1 · There is no production intake for the two-extract reconciliation. **THE REAL BLOCKER.**

The detector that finds money NH can prove **exists and is production code**:
`server/agents/reconciliationObserver.ts` takes an expectation extract and a billing extract, runs the
**real validators** and the **real reconciliation core**, and emits a `CandidateSignal` for every
`UNDER_BILLED`, unpaired, priced unit. It is registered as an opt-in agent
(`activationDetector.ts:109`, `NH_RECONCILIATION_OBSERVER_ENABLED`).

**What is missing is the route that feeds it.** The only two things in the repository that enqueue an
agent task are `pilotAssessmentService.ts:799/1098` (the assessment path — see T2) and
`server/demo/syntheticDemoPorts.ts:13` (the synthetic demo). `/pilot-datasets` is **single-CSV**,
contract-2.0.0 subscription observations, and feeds the assessment path — not this one
(`pilotIntakeService.ts:68-78`).

> **A customer's two files have nowhere to go.** The engine behind the door works; there is no door.

**Size of the fix:** a route that accepts two extracts, validates them with the validators that already
exist, and enqueues one reconciliation task for the boundary. No new detector, no new monetary logic,
no change to the core, no contract change, no `PROVEN` change. The readiness evaluator and the local
pair reader already exist (`scripts/pilot-intake/`, `dataReadiness.ts`).

#### T1 · ERRATUM, 2026-11-23 — **CLOSED at the code and test level**

The door exists. Traced link by link at `1bdbaa7`, read-only:

| # | link | reference |
|---|---|---|
| 1 | the route that accepts **two** extracts — `POST /pilot/pairs`, closed body of four fields | `server/app.ts:308-316` |
| 2 | calls `submitPilotPair(createPostgresAgentTaskStore(), actor, req.body)` | `server/app.ts:313` |
| 3 | **the real validators and the real readiness evaluator** — `validateExpectationExtract`, `validateBillingExtract`, `evaluateDataReadiness` | `pilotPairIntakeService.ts:211` → `src/contract/pairAssessment.ts:62-66` |
| 4 | enqueues **one** task with `agentId: RECONCILIATION_AGENT_ID` | `pilotPairIntakeService.ts:274-277` |
| 5 | that id is `"reconciliation-observation-v1"` | `reconciliationObserver.ts:73` |
| 6 | the worker dispatches by `handler.agentId` | `runtime.ts:26-49`, `worker.ts:83` |
| 7 | the same id is registered to `reconciliationObserver` behind its opt-in flag | `activationDetector.ts:5, 109` |

**The chain is tested, not merely readable.** `server/services/pilotPairIntake.postgres.test.ts`
submits two CSV strings through `submitPilotPair` into the real Postgres task store, runs a real
worker, and reaches **the same three candidates — 60 000 / 100 000 / 150 000 —** that the in-memory
payload door reaches in `reconciliationWorker.postgres.test.ts`. Had the CSV transport altered one
cell the figures would differ. It then drives accepted review → **one** Recovery Case, refuses
promotion without an accepted review, proves a second promotion creates nothing, and asserts the case
carries **no proof and no evidence**.

Exercised in **CI #352**, job *EP-9 Postgres-backed verification*, `test:ep2` green:
`https://github.com/nisan333-glitch/revenue-recovery-os/actions/runs/45117376240`

**What T1's closure does and does not establish — the distinction that matters:**

| | |
|---|---|
| **DEVELOPMENT · complete** | route, validation, idempotency (content fingerprint, task id, and the store's unique index), five codes-only refusals, enqueue, worker dispatch, candidate, Recovery Case — all present and CI-exercised |
| **RUNTIME CONFIGURATION · still missing** | the observer is **opt-in and off by default**. It needs `NH_AGENTS_ENABLED=true`, `NH_RECONCILIATION_OBSERVER_ENABLED=true` and `NH_RECONCILER_PSEUDONYM_KEY` (≥32 chars, a deployment secret — without it the handler **cannot be built**, so a misconfigured deployment fails at startup rather than publishing invertible references: `reconciliationObserver.ts:474-477`). No committed deployment manifest sets any of the three. |

> **No new code is required for T1; configuration is.** That is a narrower and more accurate statement
> than "nothing is missing", and the difference is ownership: the configuration is the owner's, and
> enabling a flag or registering a secret is not authorised by this document.

Everything measured on this path is **synthetic**. The candidates are OBSERVED exposure in the Revenue
Opportunity ledger, and no observed amount became Revenue Returned.

### C1 · The reconciliation path is not switched on anywhere. **OPEN.**

T1's closure is a statement about the code and its tests. It is **not** a statement that a running
deployment would detect anything, and the two must not be read as one.

The observer is **opt-in and off by default** (`activationDetector.ts:109`). Reaching a candidate in a
real deployment needs three things, none of which any committed manifest sets:

| | |
|---|---|
| `NH_AGENTS_ENABLED=true` | the agent runtime does not start otherwise |
| `NH_RECONCILIATION_OBSERVER_ENABLED=true` | `optIn` returns an empty handler list for `undefined` or `"false"`, and **throws** on any other value — so a typo fails at startup rather than silently disabling detection (`activationDetector.ts:113-121`) |
| `NH_RECONCILER_PSEUDONYM_KEY` | ≥32 characters, a deployment secret. Without it the handler **cannot be built**, so a misconfigured deployment fails at startup rather than publishing references an operator could invert (`reconciliationObserver.ts:474-477`) |

**STATUS: OPEN until a real deployment is verified to have all three.** Setting them is an operational
act with an owner and is **not authorised by this document**.

> **Development complete ≠ running.** T1 is CLOSED at the code and test level; C1 stays OPEN until
> configuration is verified in a real environment. Collapsing the two would be the same error as
> reading a green CI run as a statement about production.

### T2 · The assessment path cannot stage a candidate. **Not on the critical path.**

`governedSignalStaging.ts:186-189` takes `leakInstanceIdentityStatus()`, which returns
`establishable: false` unconditionally while `OBLIGATION_IDENTITY_FIELDS` is `[]`
(`leakInstanceIdentity.ts:53, 264`). So Detector #1 (stalled activation) and Detector #2 (overdue
unpaid) are **OBSERVED only** and open no case.

Closing it needs contract **2.1.0** *and* a primary-key migration —
`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])` with `sourceRef`
account-grained, so the table **cannot hold obligation-grained rows whatever the contract declares**
(`docs/architecture/`). That is weeks, and it is **not needed for a first pilot**, because T1's path
reaches a candidate without it.

**Deferrable.** Say so plainly rather than carrying it as a blocker.

### T3 · Only `BillingCorrection` can reach `PROVEN`. **Shapes the pilot, does not block it.**

`CORRECTION_CHANNELS` (`src/domain/correctionMapping.ts:61-77`) declares a permitted correction type
for `BillingCorrection` and an **empty** list for all seven activation mechanisms —
`OnboardingReboot`, `MilestoneNudge`, `EnablementSession`, `CSMOutreach`, `ExecBusinessReview`,
`RenewalOutreach`, `UsageActivation`. A proof citing any of those is **detected-and-refused**
(`CORRECTION_CHANNEL_NOT_DECLARED`), which is exactly what the seven seed proofs now do.

> **The wedge is Activation Recovery and no activation mechanism is provable today.** The first pilot
> must therefore be an **under-billing / billing-correction** pilot. That is not a retreat from the
> wedge: it is the only mechanism whose correction a source system can attest, and it is also the one
> the reconciliation observer detects.

Declaring a channel for an activation mechanism means naming a source that can attest the action was
taken — a governance decision, and the thing to earn **after** the first proof, not before.

### T4 · Nothing else blocks the loop. Verified, not assumed.

Case creation by promotion, the author → baseline → intervene → evidence → approve lifecycle,
separation of duties, the candidate dedupe key, the grain disclosure, the append-only ledgers, the
atomic settlement claim, OIDC sign-in and the Docker stack all exist and are exercised in CI #349 —
including the EP-19 browser journey end to end on a real detector finding.

---

## 2 · External blockers — a customer or an institution must act

### X1 · The customer's billing/ERP system must SIGN, twice. **The real external dependency.**

`evidenceStore.ts:92` assigns `trustClassification: input.sourceVerification ? "independent" :
"beneficiary_controlled"`, and both gates require `independent`:

- `src/domain/executedCorrection.ts:105` — the **correction** evidence must be signed.
- `src/domain/outcomeEvidence.ts:106` — the **outcome** evidence must be signed, state a whole
  amount, be in the proof's currency, and sum to at least the claimed collected amount.

So the customer needs a system that can produce **two Ed25519 signatures** over NH's declared payload,
under a key NH's operator registers in `NH_EVIDENCE_SOURCE_KEYS`:

1. *the corrective invoice was raised* — invoice reference, date;
2. *this amount was collected* — amount, currency, date.

**Honest caveat, stated because it will be misread.** "Independent" here means *signed by a registered
source system*. It is the system-of-record attesting, not a third party. The customer's own billing
system is not economically independent of the customer. That is why the authority ladder's top rung
needs a party not party to the claim, and why this pilot's figure is **PROVISIONAL**.

**Effort on the customer side:** a small signing script against a documented payload. Materially
smaller than a bank integration, and the same key material the payer reference rides on.

### X2 · One agreed payer identifier — only if the bank is in scope. **Deferrable for pilot #1.**

`externalSettlement.ts:359` compares `fact.payerExternalRef !== input.casePayerExternalRef`
**byte-exact**. It is the B1 dependency and it blocks **only** the optional settlement citation. See
`docs/B1_PAYER_IDENTIFIER_CONTRACT_V1.md`.

### X3 · A verified institution — only for `AUTHORITY_VERIFIED`. **Deferrable.**

Six of the eight K5 conditions need evidence from outside the system. The register is built and empty.
It gates **key activation**, which gates the **settlement citation**, which is optional.

### X4 · A customer willing to run one case, with a finance owner. **Required.**

No code substitutes for this.

---

## 3 · Security and compliance — status, not aspiration

| area | state | gap |
|---|---|---|
| Authentication | OIDC, real, with a browser sign-in journey in CI (`NH_OIDC_*`, EP-20) | none for a pilot |
| Authorization | least-privilege matrix, no superuser, separation of duties enforced | the case's own operator cannot read its proof provenance (`AuditRead`), stated and owned |
| Tenant isolation | `requireBoundaryAccess` on every governed route; boundary inside every identity and hash | none found |
| PII | identifiers pseudonymised under HMAC before storage; refusals are codes-only; a test performs a headerless-CSV attack and asserts no cell value reaches a report | the pilot must still be covered by a DPA — **legal, not technical** |
| Secrets | `NH_RECONCILER_PSEUDONYM_KEY`, `NH_INGEST_SOURCE_REF_KEY`, `NH_EVIDENCE_SOURCE_KEYS`, and `NH_SETTLEMENT_DIGEST_KEY` only if settlements are cited | **none generated**; each needs a secret store and a documented rotation stance — the digest key's rotation is *refused* by design, so it is a governed operation |
| Immutability | append-only by trigger on evidence, authority events, policies, decisions | none |
| Migrations | three designs in `scripts/migration-design/`, applied only to disposable databases | a production migration is needed **only** for the settlement ledger and the two registers — **not** for T1 |
| Data retention | `PurgeAssessmentInput` is the steward's alone; a purge cannot change a finding | a retention period must be agreed with the customer |

**No security blocker was found for a pilot.** The gaps are a DPA, a secret store, and a retention
period — all commercial or operational.

---

## 4 · Deferrable until after the pilot

1. **Obligation-grained identity** (T2) — contract 2.1.0 plus the attribution primary key. Account
   grain is disclosed at read time already; a one-obligation-per-payer pilot dataset is unaffected.
2. **Correction channels for the seven activation mechanisms** (T3) — earn after a first proof.
3. **The institution register's HTTP surface** — it is wired to key activation and needs no route to
   function; a steward can register through a governed script.
4. **`AUTHORITY_VERIFIED`** and the whole third-party corroboration rung.
5. **The `coverage.event` authority-cap finding**, the `revise()`/`Approve` token conflation, and the
   `ReconciliationObserver`'s paired-residual hold — all recorded, none monetary-incorrect.
6. **Detector #3** (failed payment / dunning) — explains dollars rather than finding them; zero
   incremental union money by its own analysis.

---

## 5 · The critical path, in order

```
T1  two-extract intake route + enqueue        ← CLOSED 2026-11-23 (636cf46, CI #352)
 │
C1  runtime configuration: two flags + the    ← OPEN · ours, operational, not code
    pseudonym secret                             (see C1 above)
 │
X1  customer's billing system signs TWICE —   ← external, small, documented payload
    two separately signed attestations:
    the corrective invoice was raised, and
    the money was collected
 │
X4  one customer, one case, one finance owner ← commercial
 │
     secrets + DPA + retention period         ← operational
 │
     ▼  a PROVISIONAL, auditable first proof from real customer data
```

Everything else on this page sits **beside** that path, not on it.
