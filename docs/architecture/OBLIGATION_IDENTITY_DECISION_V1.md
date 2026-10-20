# Workstream A · Obligation identity over time — decision record

**Status: INVESTIGATION. Nothing implemented, nothing declared, no constant moved.**
`OBLIGATION_IDENTITY_FIELDS` is still `[]`, contract still `2.0.0`.

Written 2026-10-20 against `04c190a`. Every row is backed by executable evidence in
`src/assessment/obligationIdentityScenarios.test.ts` (10 tests, no database) and
`server/services/authorityLedgerIntegrity.test.ts`.

---

## 1 · The question, and the honest answer

> **Can an obligation be identified over time without duplicates?**

**No — and the missing fact is named.** Today's identity is **account-grained**, not obligation-grained.
That single property makes the first acceptance criterion pass and the second one fail, which is why the
answer is not "yes with caveats".

| acceptance criterion | verdict | why |
|---|---|---|
| A stable obligation must not yield several Recovery Cases because the assessment was rerun | **PASS** | `caseCandidateDedupeKey = digest([boundaryId, recoveryType, sourceRef])` is UNIQUE, and `sourceRef` depends on nothing but the boundary and the account id |
| Distinct obligations must not be merged | **FAIL** | the same account-grained `sourceRef` is the key, so two obligations of one account are one candidate |
| Ambiguous identity must fail closed with an actionable explanation | **PASS, vacuously** | `leakInstanceIdentityStatus()` refuses everything today, so no ambiguous identity is ever acted on |
| Identity must not be invented from execution ids or row positions | **PASS** | verified below |

> **The merge is quantified separately**, on instruction, in
> [`OBLIGATION_MERGE_RISK_V1.md`](OBLIGATION_MERGE_RISK_V1.md) — including which path is reachable today,
> what happens to existing candidates and cases, and the five determinations a contract decision needs.

**The first criterion passes for the wrong reason.** Stability is produced by *coarseness*, not by
correctness: the key is stable because it ignores the obligation. A design that merges two obligations
will never report a duplicate, and reporting that as "stable" would be the flattering reading.

## 2 · Where identity is decided — three layers, three grains

| layer | key | grain | file |
|---|---|---|---|
| cycle | `cycleKeyPreserved2x` → `subscription_id ?? cycle_id ?? entity\|signed\|due` | subscription, or composite | `src/assessment/cycleKeyRule.ts:110` |
| staged attribution | `(executionId, sourceRef)` **primary key** | **account**, per execution | `prisma/schema.prisma:548` |
| candidate / case | `digest([boundaryId, recoveryType, sourceRef])` UNIQUE | **account** | `server/agents/caseAdmission.ts:77` |

`stagedSourceRef = HMAC(key, boundaryId ‖ NUL ‖ entityId)` — `server/services/governedSignalStaging.ts:107`.
There is no obligation grain anywhere on this path.

## 3 · The lifecycle decision table

`PRESERVED` · `LEGITIMATELY CHANGED` · `AMBIGUOUS` · `UNSUPPORTED`. All rows are **VERIFIED CURRENT
BEHAVIOUR**.

| # | scenario | cycle identity | case identity | verdict |
|---|---|---|---|---|
| 1 | Repeated upload of identical source data | same key — a function of the row alone | same candidate | **PRESERVED** |
| 2 | Re-assessment in a different execution | unchanged | **new staged row** (PK includes `executionId`), **same candidate** | **PRESERVED** |
| 3 | Billing reschedule, `subscription_id` present | unchanged — the id carries it | unchanged | **PRESERVED** |
| 4 | Billing reschedule, no explicit identifier | **changes** — `dueAt` is inside the composite | unchanged *(account-grained)* | **AMBIGUOUS** |
| 5 | Contract renewal under one `subscription_id` | **two obligations collide on one key** → `dedupeCollisions` excludes **both** as `duplicate_cycle_id` | both rows vanish from the accepted population | **UNSUPPORTED** |
| 6 | `subscription_id` change (billing migration) | **lost** — reads as a new obligation; no fallback rescues it | unchanged *(account-grained)* | **AMBIGUOUS** |
| 7 | Partial payment | no effect — `paidAmount` is monetary, not identity | no effect | **PRESERVED** |
| 8 | Blank-but-present `subscription_id` beside a good `cycle_id` | `cycle_id` is **suppressed**, falls to the composite (defect **D1**) | unchanged | **AMBIGUOUS** |
| 9 | Duplicate rows yielding one key | both excluded, by file-order-independent rule | — | **PRESERVED** (correctly refused) |
| 10 | Two obligations of one customer | distinct **only if their due dates differ** | **MERGED into one candidate** | **UNSUPPORTED** |

Rows 5 and 10 are the failures that matter. Row 5 is **D2**: a renewal makes a paying customer disappear
from the measured population entirely. Row 10 is the acceptance-criterion-2 failure.

### Identity is never invented — verified

`cycleKeyPreserved2x` reads exactly five columns, declared as data in `CYCLE_KEY_SOURCE_COLUMNS` and
asserted in test 7: `subscription_id`, `cycle_id`, `entity_id`, `signed_at`, `next_invoice_due_at`. No
execution id, no row index, no clock, no file position. `dedupeCollisions` excludes **every** row sharing
a key regardless of order (`src/assessment/assess.ts:36`), so no surviving row is chosen by position.

## 4 · ERRATUM to `docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md` §8 step 2

> The proposal said the obligation reference "must survive `projectExecutionInput`, or the worker cannot
> see it", and named that as the step to verify first.

**The premise is right and the conclusion is wrong.** The value cannot survive the projection — and it
does not need to.

* `projectExecutionInput` hard-allowlists `attributes` to `paid_timing` alone and blanks `statusRaw`
  (`src/contract/assessmentExecution.ts:402`), and replaces `cycleId`/`entityId`/`sourceRowId` with
  ordinals. Tests 8 and 9.
* **Candidate staging runs BEFORE the projection.** `deriveStagedAttributions` is called with
  `report.acceptedCycles` at `server/services/pilotAssessmentService.ts:746`; the projection happens at
  `:699` and feeds the *worker*, not staging. Staging sees the full cycle.

The consequence is favourable and load-bearing for Workstream B: **no change to `projectExecutionInput`,
`canonicalExecutionInput` or `hashExecutionInput` is required**, so no execution input hash moves and no
retained input can read as `execution_input_tampered` (`server/agents/pilotAssessmentAgent.ts:241`).
Test 10 pins the no-movement property: a cycle carrying `obligation_ref` projects byte-identically to one
without it.

## 5 · The real blocker, and it is a migration

`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])`. Two obligations of one
account in one execution **collide on the primary key**. The table cannot hold obligation-grained rows at
all, whatever the contract declares.

So the ordering is forced, and it is not the one the proposal gave:

1. **A new identity component in the staged table's primary key — a schema migration.** This is the
   blocker. Until it exists, declaring `obligation_ref` buys nothing that can be stored.
2. The contract field (Workstream B).
3. `OBLIGATION_IDENTITY_FIELDS` and the ambiguity refusals.

**This is a correction to the proposal's §8**, which listed the contract declaration first and never
mentioned the primary key.

## 6 · Ambiguity handling — which refusal each scenario would reach

`leakInstanceIdentityStatus()` refuses everything today for one reason
(`leak_instance_identity_unavailable`). Under a declared field, the mapping would be:

| scenario | refusal |
|---|---|
| some accepted cycles carry a reference, others do not | `leak_instance_identity_incomplete` — refused **whole**, never partially |
| a reference is empty, padded, control-charactered or > 256 bytes | `leak_instance_identity_malformed` |
| one identity claimed by more than one accepted cycle | `leak_instance_identity_ambiguous` |

Refusing whole is deliberate: staging 90 % of candidates would silently drop the other 10 %, and a leak
nobody can see is worse than a lane that is honestly shut.

## 7 · Two constraints that survive and are NOT closed by any of this

* **The completeness gate is satisfiable by pre-aggregating.** An exporter facing
  `leak_instance_identity_incomplete` can make it pass by collapsing rows until every survivor has a
  reference. *A gate that points the incentive at the failure is worse than no gate* — so this is recorded
  as a known, unclosed weakness, mitigated only by the human review gate, and **not claimed as a defence**.
* **The evidence available to validate any identity model is biased.** References are observable only on
  rows that survive upstream rejection — overwhelmingly single-invoice subscriptions — so consolidation,
  splitting, re-keying, merges and migrations are discarded before any reference can be read. A model
  validated on that evidence is validated on the cases it cannot fail.

## 8 · What remains NOT ESTABLISHED

* Whether a customer's billing system can emit a reference that is stable across rows 4, 5 and 6
  simultaneously. Nothing in this repository can answer that; it is a question for a real export.
* The reconciliation **grain** — invoice, schedule line or obligation group — remains open and belongs to
  the D2 decision, not to this one.
* Whether rows 5 and 10 occur at material rates in a real book. They are structural here; their frequency
  is a property of customer data we do not have.
