# From account-grained to obligation-grained identity · design only

**Date:** 2026-11-27 · **Commit:** `33ef7d8` · **Status:** **DESIGN. Nothing implemented. No schema
change, no migration file, no production change.**

Driven by one measurement: on the frozen realistic company the production detector finds
**$76,458.30** and only **$3,064.45 — 4.01%** can reach PROVEN, because seven of nine cases are
refused `OBLIGATION_COVERAGE_IS_AGGREGATE`
([`SYNTHETIC_PILOT_PRODUCTION_LANE_V1.md`](../SYNTHETIC_PILOT_PRODUCTION_LANE_V1.md)).

---

## 1 · A correction of my own earlier framing, before any design

I wrote that the blocker *"is not the contract field at all — it is a PRIMARY KEY:
`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])` with `sourceRef`
account-grained."* **That is true, and it is about a different lane.**

Verified by grep on the production tree: that table is written only by `governedSignalEmitter.ts`,
`pilotExecutionStore.ts` and `pilotInputRetention.ts` — the **assessment** path. The reconciliation
lane this exercise measured (observer → `PostgresCandidateSignalWriter` → `caseAdmission` →
`recoveryCase`) **never touches it.** So the PK governs the assessment lane's staged attributions and
is not what holds the 96%.

**And the second correction is larger: most of this migration is already built.**

| layer | state today |
|---|---|
| obligation pseudonym | **`unitObligationRef(key, unit)` exists** — `hmac-sha256` over `["reconciliation-obligation", entitlementRef, periodStart, periodEnd]`, in a namespace deliberately distinct from `accountSourceRef`'s so a unit and an account cannot collide |
| coverage | **`coverageForCandidate` already emits** `SINGLE_OBLIGATION` with `obligationRef`, expected, billed and a *derived* residual for any one-unit candidate |
| candidate identity | **`CANDIDATE_DEDUPE_SCHEME_V2` already keys on the obligation** — `digest([scheme, boundaryId, recoveryType, sourceRef, obligationRef])` — and the account preimage is preserved **byte-identical** for account-grained signals |
| grain as a fact | **`candidateDedupeGrain()` is exported** precisely so read surfaces do not re-derive it: `OBLIGATION_V2` or `ACCOUNT_V1` |
| proof gate | **already requires** `SINGLE_OBLIGATION` and already refuses an aggregate |

> **So the gap is not identity, storage or the gate. It is the DETECTOR'S EMISSION GRAIN.**
> `planReconciliation` groups `byAccount` — *"ONE candidate per payer: the sum of that payer's
> qualifying units"* (`reconciliationObserver.ts:106`, 343). A payer holding two entitlements
> therefore produces a multi-unit candidate, whose coverage is `ACCOUNT_AGGREGATE`, which never
> reaches the V2 key and can never be proven. The identity machinery is already waiting for an input
> it never receives.

This is why the three-candidate demo reaches PROVEN and a realistic book does not: each demo payer
holds exactly one obligation.

---

## 2 · Two viable strategies, and a third worth naming

### Strategy A · emit one candidate per reconciliation unit

Group by unit instead of by payer. Every unit carries `SINGLE_OBLIGATION`, hits the V2 key and is
proof-eligible.

* **No schema change. No migration. No backfill.** Nothing is re-identified, because the V1 preimage
  is untouched and historical account-grained rows keep their keys and their `ACCOUNT_V1` grain.
* Duplicate prevention is **already** obligation-keyed, and the amount is deliberately absent from
  the preimage so a corrected observation of one obligation resolves to the same key.
* **Cost, and it is real: candidate volume.** 24 units where there were 9 candidates on this dataset;
  a payer with 50 entitlements produces 50 review rows. The review queue becomes unusable without
  grouping, and **what a reviewer approves changes meaning** — one decision per obligation, not per
  payer.
* **And the admission threshold changes meaning with it.** `NH_AGENT_ADMISSION_POLICIES` is applied
  per candidate; per unit it admits a different population than per payer, so the same configured
  number is a different economic bar. That is a governance consequence, not an implementation detail.

### Strategy B · keep payer-grained candidates, create one case per unit on promotion

The candidate stays the review unit; promotion fans out into one Recovery Case per obligation.

* Review ergonomics are preserved exactly.
* **But `RecoveryCaseRecord.sourceCandidateId` is `UNIQUE`** — one case per candidate, by schema. So
  this *requires* the migration: drop or widen that constraint.
* **That constraint is a load-bearing duplicate-prevention control**, and the browser journey asserts
  the behaviour it guarantees — *"the API refuses a second case (two independent mechanisms)"*.
  Trading a duplicate-prevention control for queue ergonomics is the wrong trade, and it would also
  break *a promoted candidate leaves the queue*, which is a single-root assumption several read
  surfaces make.

### Strategy C · Strategy A plus a non-identity group reference

Identity per unit, exactly as A, plus a `groupRef` the queue can collapse rows by. The group
reference **enters no key, no hash and no proof** — it is a display fact, so it cannot re-identify
anything or become a lever.

---

## 3 · Recommendation

> **Strategy A, with C's grouping as a separate follow-on.** It needs no schema change, no migration
> and no backfill, so it carries no risk to existing proofs, the settlement ledger, tenant isolation
> or historical identity — and the identity, dedupe, coverage and gate layers are already built and
> already versioned for exactly this input. Strategy B buys queue ergonomics by removing a duplicate
> -prevention control, which is the wrong direction.

**Obligation identity is never manufactured.** `unitObligationRef` derives from `entitlementRef`,
`periodStart` and `periodEnd` — three facts from the customer's own expectation rows — under the
deployment pseudonym key, in a namespace distinct from the account namespace. Where those facts are
absent the unit has no obligation reference and **stays account-grained and unprovable**, which is the
correct outcome and not a gap to fill with a derived value.

**PROVEN eligibility is not weakened anywhere.** This changes what reaches the gate, never what the
gate accepts. `provenEligibility`'s four required facts, the aggregate refusal, the absorption checks
and the at-risk/coverage agreement all stay exactly as they are.

---

## 4 · The ten required areas

| # | area | finding |
|---|---|---|
| 1 | **primary and foreign keys** | **No change under A.** `agent_case_candidates` is keyed on `candidate_id` with `dedupe_key` UNIQUE — both derived, both already obligation-capable. `recovery_cases.source_candidate_id` UNIQUE is untouched, because one unit candidate still makes one case. No table in the reconciliation lane has a declared foreign key to change. Under **B** the UNIQUE must be dropped — the reason B is rejected. |
| 2 | **historical compatibility** | The V1 three-component preimage is **preserved byte-identical** and chosen by `candidateDedupeGrain()`, so every existing candidate keeps its key and its id. No row is re-identified, no `PAD-`/`PAX-` witness moves, and no historical proof is recomputed. **Rule 5 — historical proof immutable and reproducible — is not touched.** |
| 3 | **duplicate prevention** | Strengthened, not weakened: a per-unit key makes two obligations of one payer two candidates instead of silently one, which is the exposure-accuracy defect recorded on 2026-10-22. `dedupeKey` stays UNIQUE, `createIfAbsent` is unchanged, and the amount stays out of the preimage so a corrected observation does not become a second obligation. |
| 4 | **idempotency and concurrency** | Unchanged mechanisms. The pair-intake fingerprint `PAIR-<sha256>` is over the FILES and does not involve grain. `createIfAbsent` under a UNIQUE index remains the concurrency control, and a per-unit key narrows each contended row rather than widening it. **Re-running one extract still creates no duplicate** — now because the key names the obligation, rather than because it ignores it. |
| 5 | **settlement ledger integrity** | **Untouched.** `settlement_consumptions` is keyed on the settlement digest under `NH_SETTLEMENT_DIGEST_KEY` and knows nothing about candidate grain. One-arrival-counted-once is unaffected. The digest key is **not** rotated by this work, and must not be. |
| 6 | **existing proof preservation** | No proof is read, recomputed or revised. Proofs are immutable and append-only, the authority ledger is untouched, and a case already PROVEN keeps its frozen figure. The only change is that **future** candidates can be single-obligation. |
| 7 | **rollback and migration safety** | **The rollback is reverting one grouping function**, because there is no DDL to undo. Candidates emitted under the V2 key before a revert keep their keys and remain valid — they are not orphaned, because `candidateDedupeGrain()` already distinguishes them. Under B, rollback means restoring a dropped UNIQUE on a table that may by then hold two cases per candidate, which is **not reversible without deleting cases** — a second reason to reject it. |
| 8 | **performance and downstream consumers** | Candidate rows rise roughly by the mean obligations per payer (2.7× on this dataset: 9 → 24). The queue index `(boundary_id, status, submitted_at)` already supports it. **Downstream consumers are the risk, not the database:** the review queue, the promotion flow, the CFO report's unpromoted-candidate block and the absorption diagnostic all count candidates, and their numbers will move for a correct reason. Each must be re-measured, not assumed. |
| 9 | **missing obligation references** | **Fails closed, and that is the design.** A unit without `entitlementRef`, `periodStart` and `periodEnd` yields no obligation reference, so it stays `ACCOUNT_AGGREGATE` and unprovable. No reference is derived from a row position, an execution id or a scan order. On V3 — no billing-side obligation reference — the detector already finds **$0.00** and refuses 571 of 589 units, so this path is exercised rather than theoretical. |
| 10 | **tenant isolation** | Unchanged. `boundaryId` is the first component of both preimages, every governed route calls `requireBoundaryAccess`, and the queue index leads with the boundary. A per-unit key cannot widen a boundary because it only adds a component. |

---

## 5 · What must be measured before it is believed

The design predicts the provable fraction moves from **4.01%** towards the fraction of detected
exposure sitting on units that carry all three obligation facts. **That prediction is not evidence.**
The acceptance run in [`SYNTHETIC_ACCEPTANCE_PLAN_V1.md`](../SYNTHETIC_ACCEPTANCE_PLAN_V1.md) is how it
would be tested, against the **same frozen package**, with the ground truth and the thresholds
unchanged.

**Not authorised and not done:** any implementation, any schema change, any file in
`prisma/migrations/`, any production migration, any merge or deployment.
