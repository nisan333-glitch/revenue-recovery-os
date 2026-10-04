# Governed detection — when a pilot assessment may produce a recovery candidate

> **⚠ Evidence note, added 2026-09-30.** This document makes no claim about the validation freezes, but it
> cites `NH-AG-2007` observations that do carry an evidence layer. The **rule** is layer L4 — tracked code
> with a tracked test — while any **end-to-end observation** of it is layer L3, read from `raw-output.json`,
> whose tested product revision is `unknown` for both cycles. The ledger is in
> `docs/SYNTHETIC_VALIDATION_2026-09-27.md`; stable evidence identities are tracked in `e2e/evidence/`.

**Status: built 2026-09-27 (EP-31).** This is the bridge between the two lanes the decision memo
([`DECISION_MEMO_2026-09-27.md`](DECISION_MEMO_2026-09-27.md) §3) found did not meet. It adds **no new
detection** and **no new domain object**: it connects the class the pilot assessment already finds to the
case machinery that already exists.

## The gap this closes

Two lanes existed and did not touch.

| | **Lane 1 · pilot assessment** | **Lane 2 · agent / case lane** |
|---|---|---|
| Reads | the customer's real export, through the governed data contract | a **pre-computed signal** CSV, via a CLI |
| Output | one aggregate finding — counts and five money totals | `CandidateSignal` per account |
| Reaches Proof | **no, by type** (`constitutesProof: false as const`) | **yes**, and proven end to end |

So the only path that read real business data could not produce a recovery candidate, and the only path
that could reach Proof could not read real business data. Every detector added to lane 1 would have made
the product *more* of a detection product, not less — against `CLAUDE.md`'s *"never ship a slice of the
loop as the product."*

**And the sharper problem, which runs opposite to the obvious framing.** `secureCsvIngestion`'s fields are
`sourceIdentity, recoveryType, observedAt, amountAtRiskMinor, currency, actionAvailable,
expectedProofEvent` — so **every input to the case-admission gate came from an operator-authored CSV**, in
the only lane that can reach Proof. The party who benefits from a larger number typed the number.
Connecting the lanes **removes** a beneficiary-controlled input; it does not add one.

## The invariant

> A pilot assessment may cause per-account `CandidateSignal`s **only** when all of the following hold, and
> the emission is never a claim of revenue, recovery or proof.
>
> 1. **Non-proof by construction.** The finding, the staged attribution and the signal all keep
>    `constitutesProof: false`, `constitutesRevenue: false`. The signal carries an **at-risk** figure only.
> 2. **The beneficiary does not determine the number.** `amountAtRiskMinor`, `recoveryType`,
>    `actionAvailable` and `expectedProofEvent` are **derived** — from the accepted rows, the governed
>    AssessmentPolicy and the `PLAYBOOK`. **No request field may supply any of them.**
> 3. **Downstream of a completed execution, always.** No candidate may exist for an execution that has not
>    reached `completed`.
> 4. **No automatic Case.** Emission yields a `pending_review` candidate; `canBeCase` and the
>    accepted-review requirement are unchanged and never bypassed.
> 5. **No automatic Proof.** The baseline, evidence, intervention, separation and chain-root gates are
>    untouched.
> 6. **Deterministic lineage** to boundary · submission identity · admission decision · execution id ·
>    governed analysis terms · pseudonymous `sourceRef` · detector version.
> 7. **Idempotent.** Re-running creates no second candidate.
> 8. **A second governed reading never double-claims.**
> 9. **Pseudonymous only.** No raw customer identifier is persisted where a pseudonym suffices.
> 10. **Reconciling.** Per-account figures sum **exactly** to the aggregate the finding reports.
> 11. **Off unless switched on, per boundary.** Unset is off; only an explicit `true` enables; any other
>     value is a configuration error. A disabled emitter affects the availability of nothing else.
> 12. **Emission never alters the governed result.** A failure downstream of a `completed` execution leaves
>     the execution and its finding unchanged, creates no partial candidate, and is idempotently retryable.
> 13. **A pseudonym identifies an account, not a file.** The same account yields the same `sourceRef`
>     across legitimate re-exports.

Rule 2 is the reason this is a **strengthening**: it forbids request-supplied at-risk amounts, which the
existing CSV path permits.

## Why two phases, and not one

The account identity exists for exactly one moment. `projectExecutionInput` replaces `entityId` with a
**first-appearance ordinal**, and *"the mapping is not stored and not recoverable from the projection
alone, and it needs no secret key"* (`assessmentExecution.ts`). The worker reads only that projection.

So emission cannot happen where the finding is computed — the identity is gone, and ordinals are
**row-order dependent**, which would make one account two candidates on the next export. Putting a keyed
pseudonym into the persisted projection would change `EXECUTION_PROJECTION_SCHEME` → `inputHash` → **every
execution identity**, and trade away a documented privacy property. Rejected.

But a candidate must also not exist before its execution completed, or its lineage points at a governed
result that never arrived. Those two facts pull in opposite directions, and the split is what satisfies
both:

```
schedule ─┬─ execution + input + STAGED ATTRIBUTION   (one transaction)
          │
          └─ worker runs ──▶ execution COMPLETED
                                   │
                                   └─ emitter ──▶ CandidateSignal ──▶ pending_review
                                                        │
                                              review (2nd identity) ──▶ Recovery Case
                                                        │
                                   baseline + evidence + approver ≠ owner ──▶ Proof
```

**Phase A · stage.** Derived at `pilotAssessmentService`, where the real cycles are still in memory,
written in the **same transaction** as the execution and its input. If that transaction fails there is no
execution and no attribution, so no candidate can ever be derived from one. A staged row is a *derivation
artefact*: nothing lists it in a review queue and nothing can promote it.

**Phase B · emit.** A service invoked by a CLI (`npm run emit:signals`), for executions in state
**`completed`** — and nothing else. `blocked` is terminal but is **not** success; `failed` is **not**
terminal at all, because the runtime retries it. Neither may produce a candidate.

**Why a CLI rather than an agent handler.** The runtime's handler contract has two outcomes — succeed, or
fail into a retry budget — and no way to say *"not ready yet."* A handler enqueued at schedule time would
have to out-wait the worker inside `maxAttempts`, making the bridge depend on the retry budget racing the
assessment. `secureCsvIngestion`, the only thing that creates candidates today, is already a
service-plus-CLI; this follows it rather than inventing a second convention.

## The pseudonym

`hmac-sha256:HMAC(NH_INGEST_SOURCE_REF_KEY, boundaryId ‖ NUL ‖ entityId)` — the same scheme and key as
secure CSV ingestion, so the two lanes cannot disagree about who an account is.

It depends on **nothing but the boundary and the customer's own account id**. Row order, row count, file
bytes, `asOf` and the execution id can all change without changing it, which is what makes one account one
candidate across re-exports. It is boundary-scoped, so the same account in two tenants is two unlinkable
references. And the database enforces it: `source_ref` must match `^hmac-sha256:[a-f0-9]{64}$`, so a raw
identifier cannot be written even by a mistaken caller.

**Known limitation, stated rather than assumed away.** Stability rests on the customer using a stable
`entity_id` across exports. If they do not, nothing downstream can recover it — that becomes a
data-contract conversation, and the mandatory review is what contains it.

## What is emitted, and from what

Only `ActivationMissed`, and it is a constant rather than a parameter. It is the class the assessment
already detects, and `src/domain` already holds everything a governed case needs for it: a `LeakageType`, a
`creationRule`, an `economicThreshold`, an `expectedProofEvent` and a play (`MilestoneNudge`). A second
recovery type is a separate slice with its own definition, never a widening of this constant.

The attribution mirrors `observedSummary` exactly, over the **stalled cohort only**:

| Payment state at the governed `asOf` | Contributes |
|---|---|
| `Unpaid` | the full obligation |
| `PartiallyPaid` | the **remainder** only (`amount − paid`, clamped) |
| `Cancelled` · `Refunded` | **nothing** — excluded value is never re-presented as at risk |
| `Unknown` | **nothing** — the evidence cannot be placed as of the cut-off |
| `NotYetDue` · `PaidOnTime` · `PaidLate` | nothing |

Aggregated **per account**, which is not cosmetic: one entity may own many cycles, and the candidate
dedupe key is `(boundary, recoveryType, sourceRef)`, so one signal per *cycle* would collapse to whichever
arrived first and break rule 10.

`attributionReconciles` is checked at the write, not only in tests: if the per-account figures stop summing
to `observedUnpaid + partialOutstanding`, the two computations have diverged, and candidates nobody can tie
back to the finding are worse than no candidates — so it throws and stages nothing.

## Configuration — off by default

| Variable | Meaning |
|---|---|
| `NH_PILOT_SIGNAL_EMITTER_ENABLED` | Master switch. Unset or `false` is **off**; only `true` enables; anything else is a configuration error. |
| `NH_PILOT_SIGNAL_EMITTER_BOUNDARIES` | Comma-separated allowlist. **Empty means off everywhere**, even with the switch on. Both gates must pass. |
| `NH_INGEST_SOURCE_REF_KEY` | The HMAC key, ≥32 bytes. Required only once a boundary is allowlisted, and validated at **startup** — a running server that silently staged nothing would be the worse failure. |
| `NH_AGENT_ADMISSION_POLICIES` | The governed materiality floor per recovery type, in **minor units**. Not the PLAYBOOK's illustrative major-unit `economicThreshold`. No floor configured ⇒ emission refused, never defaulted. |

A **disabled** emitter affects nothing else: the assessment path runs normally with no admission policy
configured at all.

## Retention

The staged attribution is pseudonymised customer-derived data of the same class as the execution input, so
it leaves by the **same** governed purge authorization — one authorization, both tables, one transaction. A
second authorization could drift and leave one table behind; no route at all would be a retention hole.

## IDENTITY BLOCKED — candidate emission fails closed (EP-31c, 2026-09-29)

**The bridge is built, wired and tested, and it emits nothing.** A dedupe audit found that EP-31 satisfied
one dedupe property at the cost of the other, and that the data contract cannot supply a key that satisfies
both. Emission therefore **fails closed in code**, not merely by configuration.

### The two properties, and why one failed

| | Property | |
|---|---|---|
| **#1** | the same leakage event re-observed — a legitimate re-export, or a governed re-reading — must not create a second counted candidate | **held** |
| **#2** | a genuinely new leakage event for the same account in a later business cycle must still be able to create a candidate | **failed — permanently suppressed** |

#1 held *because* #2 failed. `caseCandidateDedupeKey = sha256(boundaryId ‖ recoveryType ‖ sourceRef)` has no
occurrence component, `sourceRef` was the bare account, `UNIQUE ("dedupe_key")` is global, and
`agent_case_candidates` is append-only — so exactly **one** candidate could ever exist for one
`(boundary, ActivationMissed, account)`, for the lifetime of the tenant. After the first Case was promoted
the account also left the review queue, so later genuine events produced no queue entry, no candidate and no
signal.

### Why no key fixes it — the audit (Q1–Q5)

1. **What distinguishes two obligations sharing `(entity_id, signed_at, next_invoice_due_at)`?** Nothing
   required. `subscription_id` is *recommended*, `cycle_id` is *optional*; `plan`/`segment`/`product` are
   optional and are not identifiers; `next_invoice_amount` is mutable for one obligation, so it would buy
   uniqueness by giving up stability.
2. **What proves a changed due date is a new obligation rather than a reschedule?** **Nothing — this is
   unknowable in principle from the declared fields, not merely collision-prone.** No identifier survives a
   due-date change, and there is no `previous_due_at`, no billing-period bounds, no sequence number, no
   reschedule event and no history: each row states only the *next* invoice. `status_effective_at` is the
   effective date of a terminal *status*; `refunded_at`/`cancelled_at` are terminal states.
3. **Would a stable source-system obligation identifier resolve both?** Yes — and it is the only thing that
   would, because it makes the obligation the identity instead of its attributes.
4. **Is one available?** **No.** Across all 21 declared fields there is no `invoice_id`, `obligation_id`,
   `charge_id`, `invoice_number`, period bound or sequence. `cycle_id` is optional, has **no synonyms at all**
   in the adapter's mapping spec (so a customer's `invoice_id` column is never auto-detected), and is ignored
   whenever `subscription_id` is present. Meanwhile the adapter absorbs `invoice_due_date`/`invoice_date` into
   the **date** and `invoice_total` into the **amount** — there is nowhere for an invoice **id** to land.
5. **Minimum candidate-capable extension.** One obligation-level identifier declared stable across
   re-exports **and** across a reschedule of its own due date, with synonyms for common billing vocabulary ·
   candidate-capability expressed as a **population predicate** so ordinary assessment is unaffected ·
   **the required contract-version impact remains an explicit open decision**, to be determined from the
   eventual extension semantics rather than assumed · and **D1 fixed first**, or the new field is unreachable
   exactly as `cycle_id` is.

### A correction, so it is not repeated

`EvidenceRecord_outcome_single_use` — the partial unique index on `("sourceSystem", "sourceRecordId")` where
`evidenceRole = 'outcome'` — was offered during the audit as evidence that a duplicate candidate was safe.
**It is not, and that reasoning was wrong.** It bounds only the *monetary* consequence downstream: one real
collection record can be outcome evidence for exactly one case, so two cases cannot both reach an approved
Proof on the same collection. It does **nothing** about a duplicate candidate, duplicate review workload, a
duplicate Case, or wrong occurrence accounting. It is a safety net, never an identity. (The claim was never
committed to this document; it is recorded here so no reader reconstructs it.)

### The invariant now enforced

> **Ordinary assessment may complete without leak-instance identity. Candidate-capable staging and emission
> may not.**

* `src/contract/leakInstanceIdentity.ts` is the single place the gap lives. `OBLIGATION_IDENTITY_FIELDS` is
  empty, and the status is **derived** from it — so an extension that adds a field flips the answer, and an
  incomplete extension fails the controls instead of silently enabling emission.
* Staging returns a **typed, named** `CandidateStagingDecision` and **never throws**: `boundary_not_enrolled`,
  `leak_instance_identity_unavailable`, or `attribution_did_not_reconcile`. The last one **was** a thrown
  error before EP-31c, which meant a divergence between the per-account figures and the assessment total
  would have aborted the whole schedule request — a candidate-side fault taking an ordinary assessment with
  it. It is fatal to staging and to nothing else now, and the check is evaluated **before** the identity gate
  so it stays live rather than becoming dead code behind a permanent block.
* The decision surfaces on its own response field, `candidateStaging`. Deliberately **not**
  `refusal`/`refusalDetail`: those are the deterministic `NH-AX-####` refusals of the *execution*, and
  reusing them would let `scheduled: true` sit beside a `refusal`. **No `NH-AX` code is invented**, and the
  execution vocabulary is unchanged.
* The **emitter asks the same question independently**, before reading any staged row, and refuses with the
  same named reason regardless of whether rows exist. So a row arriving by any other route — a hand-written
  INSERT, a build predating the guard, a restore — cannot become a candidate. Two independent refusals, not
  one guard read twice.

### Still open, and deliberately not fixed here

* **D1** — `cycle_id` is unreachable whenever `subscription_id` is present (`saasActivation.ts:223`), though
  `cycle_id` is declared as the alternative *for exactly the case where `subscription_id` is not the billing
  grain*. The more specific declaration is shadowed by the less specific one.
* **D2** — if `subscription_id` is per-subscription, every genuine cycle of that subscription derives the same
  `cycleId` and **all of them** are excluded as `NH-DC-2016`. A real multi-cycle export would be silently
  gutted. Not covered by any test: every existing collision case constructs the collision artificially or
  repeats an identical row, and the frozen fixtures assign `subscription_id` per **row**.
* **The row grain is DEFERRED** pending real data. `CUSTOMER_PILOT_DATA_CONTRACT_V1.md` never states what one
  row represents; the `next_invoice_*` vocabulary reads as one row per subscription's *next* invoice, while
  `subscription_id`'s description asserts the key is *cycle-level*. Whether D2 is a defect or correct
  behaviour depends on which is authoritative, and that cannot be settled from the repository.
* **Suspended coverage.** Six end-to-end properties proved at `95dc2bb` are unreachable while the gate holds,
  because each needs a candidate or a staged row: one candidate per staged account · idempotent re-emission ·
  a below-floor signal reported in `refused` · mid-batch atomicity leaving the execution byte-identical ·
  cross-export pseudonym stability · promotion refused 409 until review. They remain in the EP-31 commits and
  become reachable when identity exists. Deliberately **not** preserved by adding an override that satisfies
  the gate: a seam capable of turning it off is what this slice removes, and coverage is not a reason to build
  one.

### When the identifier arrives — a consequence recorded, not an architecture chosen

The projection de-identifies `cycleId` to a first-appearance ordinal, so an authoritative obligation
identifier would not survive into the emitter's current view. The emitter's check must then become
population-based, and at least two approaches must be **compared** — on identity, privacy, replayability and
auditability — rather than assumed: **(a)** carry a pseudonymised obligation reference through the projection;
**(b)** preserve the authoritative instance reference through governed staging without expanding the
projection. Neither is chosen here.

## What this does NOT establish

It does not make the loop proven. A candidate is not a Case, a Case is not a Proof, and `constitutesProof`
remains the literal `false` on every assessment finding. It does not widen detection: coverage is exactly
where [`SYNTHETIC_VALIDATION_2026-09-27.md`](SYNTHETIC_VALIDATION_2026-09-27.md) left it — **65.4% of
planted business leakage still invisible**.

And it does **not** make agent #1 proven on real data. `ARCHITECTURE.md`'s guard turns on that, and this
bridge is the **precondition** for satisfying it, not the satisfaction. Before "proven" may be said: a real
tenant's export; ≥200 accepted rows, ≥50 accounts, ≥3 cycles; the customer's own aging/activation report
obtained **before** NH's output is shown, or an independent finance reviewer adjudicating blind;
precision/recall against that adjudication; monetary reconciliation to the cent; a DPA in place. Failure
criteria, fixed now rather than after seeing a result: **precision < 0.90** on a ≥50-account adjudicated
sample, any unexplained monetary discrepancy, or any false positive traceable to the rule rather than to
source data.

Every figure this path produces is **Detected Revenue Opportunity**. None of it is Recovered Revenue or
Revenue Returned, proven or auditable.
