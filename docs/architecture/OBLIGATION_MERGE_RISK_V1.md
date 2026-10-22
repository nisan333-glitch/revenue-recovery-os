# Workstream A/2 · The account-level merge — quantified, and the five-part recommendation

**Status: INVESTIGATION. No workaround, no schema change, no contract bump.** Written 2026-10-20
against `0e7a3e1`, on instruction to treat the merge as a **critical commercial integrity risk** and to
establish five things separately rather than resting on field compatibility.

Evidence: `server/agents/obligationMergeExposure.test.ts` (7 tests, no database).

---

## 1 · The failure mechanism, stated once

Candidate identity is `digest([boundaryId, recoveryType, sourceRef])`
(`server/agents/caseAdmission.ts:77`) and `sourceRef` is **the account**. The obligation is not in the
key. So two genuinely different leaks for one customer in one recovery type are **one key** — test 4.

The same coarseness produces both halves of the behaviour the owner identified: it is why re-running an
assessment opens no second case, and it is why two obligations become one. **These are not two
properties. They are one property, read in two directions.**

## 2 · The damage is DIFFERENT on each path, and the reachable one is worse

| | assessment path | activation path |
|---|---|---|
| what happens to the second obligation | **summed** into one figure | **silently discarded** |
| is the merge disclosed anywhere downstream? | **no** — the count is dropped before the signal is built | **no** — nothing is recorded at all |
| money visible after the merge | $1,000.00 under one label | **$400.00 — the second $600.00 exists nowhere** |
| reachable today? | **no** — the identity gate refuses unconditionally | **YES** |

### 2.1 · Assessment path — summation, then a dropped disclosure

`attributeByEntity` groups by `entityId` and **sums** (`src/assessment/entityAttribution.ts:108`). Two
obligations of $400.00 and $600.00 become one attribution of **$1,000.00** with
`contributingCycleCount: 2` — test 1.

That count exists precisely so the figure is not misread; the schema says so in as many words: *"so one
figure is never mistaken for one invoice"* (`prisma/schema.prisma:538`). **And it is dropped before a
candidate is built.** `SignalLineage` (`governedSignalEmitter.ts:125`) has no such field, so
`CandidateSignal` has none and `RecoveryCaseRecord` has no column for it — test 2.

**The safeguard exists at the layer that does not need it and is absent at the layer that does.** That is
the `coverage.event` shape in a new lane. Test 3 makes the consequence concrete: a merged pair and a
single $1,000.00 obligation are **identical on the wire** — same account, same amount — and only the
field that does not travel tells them apart.

### 2.2 · Activation path — silent discard, and this one is live

`CaseAdmissionService.submit` calls `createIfAbsent`, which returns the **existing** candidate when the
dedupe key matches (`caseAdmission.ts:71`). Test 5 measures it: the second submission is **admitted** —
it passed every gate — and then absorbed. The surviving candidate carries the **first** amount. The
second obligation's $600.00 is not summed, not held, not flagged.

Test 6: `created: false` goes to the *caller* and is **not persisted**. A reviewer opening the queue sees
one candidate at $400.00 with nothing saying a second arrived.

> **Silent discard is worse than conflation.** Under summation the money is at least present under one
> label and a later correction can split it. Under discard there is nothing to split: the observation is
> gone, and no audit of the stored rows can recover that it ever existed.

## 3 · Implications for EXISTING candidates and cases

| | finding |
|---|---|
| **Assessment-path candidates** | **None exist, and none can.** `deriveStagedAttributions` refuses at `leakInstanceIdentityStatus()`, which is unconditionally false while `OBLIGATION_IDENTITY_FIELDS` is `[]` — test 7. No staged row has ever become a candidate on this path. |
| **Activation-path candidates** | **Exposed.** Any boundary that submitted two activation observations for one account under `ActivationMissed` has one candidate and one lost observation. Whether that has occurred is a question about deployed data, which this repository cannot answer. |
| **Existing `RecoveryCaseRecord` rows** | Each is keyed to one candidate by `sourceCandidateId` UNIQUE. A merged case is **not corrupt** — its amount, owner and proof chain are internally consistent. It is **incomplete**: it may represent more obligations than its figure discloses, or fewer than the customer has. |
| **Proof chains on merged cases** | Unaffected in validity. `Collected − Baseline` is computed from evidence and a locked baseline, not from `amountAtRiskMinor`, so **no proven figure is wrong because of the merge.** The at-risk figure and the proven figure were never the same number — which is the separation this product already enforces, paying for itself here. |

**The commercial consequence, stated plainly:** a merged case can show the wrong *exposure*, assign one
owner and one status to what are really two pieces of work, and close while a second leak is still open.
It cannot show wrong *recovered revenue*.

## 4 · The five determinations, established separately

The instruction was not to approve 2.1.0 on optional-field compatibility alone. Each is answered on its
own evidence, and **the verdict is the weakest of the five.**

### 4.1 · Contract compatibility — **ESTABLISHED SAFE**

All eight identity surfaces checked individually; only `PAX-` moves, and only for new executions, because
the binding reads `decision.contractVersion` from the immutable admission decision. Full treatment in
`CONTRACT_2_1_COMPATIBILITY_REVIEW_V1.md`. Three bounding conditions, all verifiable.

### 4.2 · Obligation-level identity — **NOT ESTABLISHED**

A declared field is necessary and **not sufficient**. Nothing in this repository demonstrates that a
customer's billing system can emit a reference that survives a reschedule, a renewal and a re-key
*simultaneously* — the three cases where today's cycle key already fails. That is a question for a real
export, and §7 of the identity decision records it as unanswerable here.

### 4.3 · Database-key migration safety — **BLOCKED, and the obvious route is unsafe**

`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])`, **append-only** by trigger
(`pilot_assessment_entity_attributions_no_update`, `..._no_truncate`, with deletes allowed only through
the governed purge).

**The primary key cannot be widened in place.** A new key component needs a value on every existing row,
and existing rows have no obligation identity because the concept did not exist when they were written.
Backfilling one **fabricates** obligation identity — the `BIGSERIAL` trap the execution-event migration
refused, in a table whose rows are evidence. And a Postgres primary key admits no NULL, so the
seq migration's "nullable, never backfilled" escape is **not available here**.

> **Recommended shape: an additive, separately governed SIBLING table at obligation grain**, leaving the
> account-grained table untouched and historical. This is the pattern this repository has already chosen
> four times — Detector #2, the expectation extract, the billing extract, the obligation-reference
> counterfactual — and for the same reason: *never a widening of an existing artefact whose rows are
> already evidence.*

An alternative — a surrogate key plus a partial unique index admitting the nullable component, as the
`previousProofId` fork guard already does — is **viable and not recommended**, because it leaves one
table holding two grains and no reader can tell which a row is.

### 4.4 · Historical case continuity — **AT RISK, with a named mitigation**

If candidate identity moves from account grain to obligation grain, the **same real leak** re-detected
under the new rule produces a **different dedupe key**, therefore a new candidate, therefore a **second
Recovery Case for a leak that already has one**. `sourceCandidateId` UNIQUE does not prevent this: the
two candidates are genuinely different rows.

Two protections exist and neither is sufficient alone:

* the emitter already skips executions that have emitted (`governedSignalEmitter.ts:229` groups staged
  rows by execution and passes over those with a candidate), so a *re-run of an old execution* creates
  nothing new;
* but a **new** execution over the same customer data would emit under the new grain, against cases
  opened under the old one.

> **A grain change needs a stated continuity rule before it ships**, not after: either new-grain
> candidates for an account with an open old-grain case are attached rather than opened, or the old
> cases are explicitly closed as superseded with a linked record. **Neither is designed here.** This is
> the determination that most needs owner input, because it is a governance choice about what an existing
> case *means* after the grain moves.

### 4.5 · Rollout ordering — **ESTABLISHED, and it is forced**

```
sibling table at obligation grain  →  continuity rule  →  contract field + its consumer
      →  OBLIGATION_IDENTITY_FIELDS  →  build deployed everywhere  →  customer asked to declare 2.1.0
```

Each arrow is a hard dependency, not a preference. The last two are forced by
`isSupportedContractVersion`: a file declaring 2.1.0 against a 2.0.0 build is refused, while the reverse
is accepted — so the consumer always ships first.

## 5 · Verdict

> **Contract 2.1.0 is NOT approved by this review.** Its field-level compatibility is established and is
> the *least* important of the five. Two determinations are open — obligation-level identity is NOT
> ESTABLISHED and historical case continuity is AT RISK — and one is BLOCKED on a migration whose
> obvious form would fabricate evidence.

## 6 · The smallest safe implementation slice

**Not the contract.** The smallest change that reduces real commercial risk and needs no contract, no
migration and no grain change:

> **Make the merge VISIBLE where it is currently silent.**

* carry `contributingCycleCount` through `SignalLineage` into `CandidateSignal`, so a merged assessment
  figure discloses how many obligations it covers;
* record on the activation path that a submission was **absorbed**, so a reviewer sees that a second
  observation arrived and was folded into an existing candidate.

Both are additive, neither changes identity, dedupe, money or any hash, and together they convert a
**silent** integrity failure into a **disclosed** one. A disclosed merge is a case a reviewer can judge;
a silent one is a number nobody can question. It does not fix the merge, and it is not offered as a
workaround — it is the honest interim while 4.2, 4.3 and 4.4 are decided.

**Deliberately excluded from that slice:** any change to `caseCandidateDedupeKey`, to the staged table's
primary key, or to `attributeByEntity`'s grouping. Each would change identity, and identity changes are
what §4.4 shows cannot ship without a continuity rule.

## 7 · Unresolved risks

* **Whether any deployed boundary has already absorbed an activation observation.** Only deployed data
  answers it; the mechanism is proven reachable, the incidence is unknown.
* **Whether a real billing system can emit a reference stable across reschedule, renewal and re-key.**
  §4.2.
* **What an existing case means after the grain moves.** §4.4 — a governance decision, not a code one.
* **The sibling-table design is recommended, not validated.** No schema was written, so its interaction
  with the purge path and the emitter's execution grouping is reasoned, not tested.

---

# ERRATUM · 2026-10-22 · §2, §2.2 and §3 — the activation path DOES record the absorption

**Append-only. Nothing above this line is edited.** The prose in §2, §2.2 and §3 is preserved exactly as
written, because a recorded conclusion is corrected and preserved, never rewritten — the same treatment
the `obligation_ref` stopped-field record gets.

## What is NO LONGER VALID

Three claims, all in the same direction and all mine:

| where | the claim as written | the fact |
|---|---|---|
| §2 table | *"**no** — nothing is recorded at all"* | the `task.succeeded` event records `{admittedCount, createdCount, filteredCount}` |
| §2.2, test 6 | *"`created: false` goes to the caller and is **not persisted**"* | it is persisted, as `createdCount: 0`, in `agent_task_events.metadata` |
| §2.2 blockquote | *"no audit of the stored rows can recover that it ever existed"* | an audit can: the event survives in an append-only table with no purge path |

## Why I got it wrong, which is the part worth keeping

**I measured a lane the product does not run and reported its behaviour as the product's.** Tests 5 and 6
drove `CaseAdmissionService` over `InMemoryCaseCandidateStore`. That class pair genuinely records nothing —
`createIfAbsent` returns the existing candidate and the discarded signal is dropped on the floor. The
deployed path is a different chain:

```
postgresTaskStore.succeed()
  → PostgresCandidateSignalWriter.writeWithin      (ON CONFLICT (dedupe_key) DO NOTHING)
  → returns { admittedCount, createdCount, filteredCount }
  → merged into the task.succeeded event metadata  (postgresTaskStore.ts:383)
  → agent_task_events                              (append-only by DB trigger, no purge path)
```

This is the *a capability in the benchmark lane is not a product capability* rule, **inverted**: a
LIMITATION measured in a non-production lane is not a product limitation either. The direction of the
error does not change the lesson — in both forms, the lane has to be named before the result is quoted.

## What is STILL BINDING, and it is most of the document

The erratum narrows one fact and overturns no conclusion:

* **The merge itself is unchanged.** Two obligations of one account still collapse into one candidate and
  one case, and the surviving candidate still carries the **first** amount. §1 and the §2 money row stand.
* **The money is still lost where it matters.** The absorbed observation's amount reaches **no candidate,
  no case, no screen and no figure**. The event metadata records *that* a signal was absorbed and carries
  **no amount at all**. §2's *"the second $600.00 exists nowhere"* is right about every surface a user or a
  CFO can read; it is wrong only about the audit log.
* **Silent discard is still worse than conflation**, for the reason §2.2 gives: there is nothing to split.
* **§3 stands in full.** Assessment-path candidates still cannot exist; activation-path exposure is still a
  question about deployed data; merged cases are still *incomplete rather than corrupt*; and **no proven
  figure is wrong because of the merge.**
* **All five determinations in §4 stand**, and none of them turned on this fact.

## What it CHANGES, and it is a gain

Because the record exists, **absorption is derivable from the tables that already exist, with no schema
change** — which is what made `npm run exposure:absorbed` buildable in the same slice as the disclosure
rather than waiting on a migration. `admittedCount >= 1 AND createdCount = 0` on a `task.succeeded` event
**is** the stored evidence that a signal cleared every gate and was then swallowed.

Two bounds on that evidence, stated here so the diagnostic is never over-read:

1. **It records an absorbed OBSERVATION, never a distinct OBLIGATION.** No column anywhere identifies an
   obligation, so two absorbed observations with differing `sourcePayloadHash` are *either* two obligations
   *or* one obligation re-observed after a reschedule, a renewal or a corrected amount. This is why the
   disclosure state is named `ABSORBED_OBSERVATIONS_RECORDED` and not `CONFIRMED_COLLISION`.
2. **An event carrying no `admittedCount` is NOT ESTABLISHABLE, not zero.** The publisher was not wired
   when that task ran. Coalescing the absent key to 0 would assert a population was checked when nobody
   checked it.

## Corrected by measurement, in code

`server/agents/obligationMergeExposure.test.ts` now names its in-memory describe as that lane, carries a
dated correction block, and adds two Postgres-backed tests: **5p** proves `admittedCount: 1,
createdCount: 0` is the stored record and that the survivor carries the first amount; **6p** proves the
candidate columns still hold no absorbed count and that the append-only triggers exist — so what is
recorded lives on the event and the candidate really does lose the money.

§7's first unresolved risk is unchanged: **whether any deployed boundary has already absorbed an
observation is still unknown.** The mechanism is proven reachable and now proven *recorded*; the incidence
is a question about deployed data, and the Phase 1 verdict stayed
`UNKNOWN — ACCESS OR EVIDENCE INSUFFICIENT`.
