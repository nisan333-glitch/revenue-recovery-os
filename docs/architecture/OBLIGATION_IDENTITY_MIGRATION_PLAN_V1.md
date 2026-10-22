# Obligation-grained identity · migration plan

**DESIGN ONLY. Nothing here is implemented, and nothing here is approved for implementation.**
No contract version moves, no migration is written, `OBLIGATION_IDENTITY_FIELDS` stays `[]`, and
`prisma/schema.prisma` is untouched by the slice that produced this document.

**Date:** 2026-10-22 · **Status:** proposal awaiting the governance approvals listed in §9.

## 0 · What this plan is for, and what it is not

The account-grained merge is **measured and disclosed**, not fixed. `docs/architecture/OBLIGATION_MERGE_RISK_V1.md`
quantified it; `src/domain/caseIdentityGrain.ts` makes a case unreadable as a per-obligation claim; and
`npm run exposure:absorbed` can find a recorded absorption in a given database. None of that changes what
happens to the second obligation.

> **A disclosure is not a fix.** Two obligations of one customer still collapse into one candidate and one
> Recovery Case, the survivor still carries the **first** amount, and the second observation's money still
> reaches no candidate, no case, no screen and no figure. A reader who ignores the warning is exactly where
> they were.

This plan is the route from there to obligation-grained identity, written so the decision can be taken on
evidence rather than on appetite.

## 1 · Identity rules

### 1.1 What may become an identity component

The rule is already settled and is restated because every later section depends on it:

> **The identity of an obligation is stated by the source at emission. NH never infers, derives,
> normalises or repairs it.**

Admitted components, in order of preference:

| source fact | why it qualifies |
|---|---|
| a **source-stated obligation reference** on the billing side | authoritative, stable across re-key, and already proven to unlock money in the frozen counterfactual |
| a **schedule-line reference** on the expectation side | the thing the above resolves against; the two are a *mandatory-in-practice pair* |

Refused components, each for a stated reason:

| refused | why |
|---|---|
| the execution id | unique per run, so re-assessing one extract would open a **second case for one real leak** |
| the row position, CSV order, array index | *determinism is necessary and is not evidence* — the pairing-order and event-ordering defects in another costume |
| `(entity_id, signed_at, next_invoice_due_at)` | **this is the current gap**: not stable across a reschedule of its own due date, so a rescheduled obligation cannot be told from a new one (`LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL`) |
| an invoice-line position | *a position within an invoice is not a reference to the obligation it settles* |
| any NH-generated surrogate | the beneficiary's data would then be identified by our arithmetic, and a re-run could change it |

### 1.2 Tier, and why it is forced rather than chosen

**OPTIONAL, never RECOMMENDED.** `COMPATIBILITY_POLICY` lists adding a recommended field as *minor*, while
the admission gate counts missing recommended columns against `policy.maxMissingRecommendedColumns`, whose
pilot value is **zero**. So a "minor" recommended addition would refuse datasets that passed the day
before — **major by the policy's own test**. This is governed issue #1, re-derived independently three times
now, and it is mechanical rather than a preference.

### 1.3 Capability gating, never global rejection

The field is a **named prerequisite for the detectors that need it**, failing closed when absent — following
`leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE`, which are named apart *"because
collapsing them would let closing either look like closing both."* Making it globally required would reject
datasets that still measure real money through Detectors #1 and #2.

## 2 · Stable deduplication across reassessments

The candidate dedupe key is `digest([boundaryId, recoveryType, sourceRef])`
(`server/agents/caseAdmission.ts:77`), length-framed per component. The proposed successor adds one
component **and only where it exists**:

```
dedupeKey = digest([boundaryId, recoveryType, sourceRef, obligationKey ?? ""])
```

Four properties this must hold, and each is a test before it is a design:

1. **Re-assessing the same extract must produce the same key.** The key reads only source-stated facts, so
   it is invariant under re-run, re-read under new analysis terms, and a change of
   `ASSESSMENT_CALC_VERSION`. Nothing in the key comes from the build.
2. **Two obligations of one account must produce different keys.** This is the whole point, and it is the
   property the current key provably fails.
3. **An obligation whose due date is rescheduled must keep its key.** This is what disqualifies the
   `(entity_id, signed_at, next_invoice_due_at)` tuple and what the source-stated reference supplies.
4. **A missing obligation key must not silently collapse into the account grain.** The empty-string tail
   above is *not* acceptable as written: it makes an unkeyed row collide with every other unkeyed row of
   that account, which is today's behaviour wearing a longer key. **Open sub-decision** — §10.

### 2.1 Stability is NOT the same as correctness, and today's stability is the wrong kind

Re-running an assessment creates no duplicate today. That is **not** evidence the identity is sound: the key
is stable because it **ignores** the obligation. *Stability from coarseness is not correctness — a design
that merges two obligations will never report a duplicate.* Any acceptance criterion phrased as "no
duplicates appear" is satisfied by the defect and must be rejected as a criterion.

## 3 · Historical case continuity

### 3.1 Existing rows stay exactly as they are

Decided by the owner and restated as binding: **existing Recovery Cases remain historical account-grained
records.** Nothing is split, merged, reassigned, re-keyed or reinterpreted. Specifically:

* No `recovery_cases` row is updated. The table's semantics and every `sourceCandidateId` UNIQUE link hold.
* No `AuthorityEvent` is rewritten, re-ordered or re-tokenised. *A token that a gate reads is load-bearing*:
  `enforceSeparation` builds its approver set from the `"Approve"` token, and substituting it would turn a
  revise-only actor's 403 into a 201.
* No historical `amountAtRiskMinor`, baseline, evidence record or proof is recomputed.
* No historical `findingHash`, `PAD-`, `PAX-` or policy hash is recomputed. The §4 analysis already proved
  that identity surfaces read their version from the **frozen record** rather than the build, which is what
  makes a bump safe.

### 3.2 The two grains coexist, and the marker is per-row

A case must say which regime created it, and it must say so **from its own row** rather than from a date
comparison against a deploy. The lesson is already recorded: of the historical admission-policy provenance
field, *"the field alone cannot prove which regime wrote it — and it is harmless only because nothing
consumes it. The day anything starts reading that field, the ambiguity becomes a defect."* A grain marker
**will** be consumed, by the disclosure if nothing else, so it must be unambiguous from day one.

So: **new rows carry an explicit grain marker; absent means account-grained.** Absence is interpreted, never
backfilled — a backfill would be us asserting a fact about rows written before the fact existed, which is
the `BIGSERIAL` trap from the event-ordering decision (*it backfills in physical heap order, committing a
fabricated chronology to disk*).

### 3.3 The disclosure already handles both, and this is load-bearing for the migration

`caseIdentityGrain` is **derived at read time and stored nowhere**. So an account-grained historical row and
an obligation-grained new row are both described correctly by the same code with **no migration, no
backfill and no mutable status column**. The `OBLIGATION_UNIQUENESS_GUARANTEED` branch already exists and is
unreachable only because `OBLIGATION_IDENTITY_FIELDS` is empty: the day the contract declares the field,
that branch becomes reachable **as a version bump rather than as an incident.** That is why the disclosure
was built before the migration and not after.

## 4 · Contract-version compatibility

**`2.0.0 → 2.1.0`, MINOR**, and the verdict is bounded rather than general. All eight identity surfaces were
checked individually in the prior investigation. Exactly one moves — `PAX-` for **new** executions, because
`canonicalBinding` carries the full contract version — and **no historical surface moves**, because the
binding reads `decision.contractVersion` from the immutable admission decision.

`pds` does **not** change, and for a reason worth restating because it corrected my own earlier plan: `pds`
is derived over `sha256(csvText)`, so a customer adding a column changes their bytes and gets a new identity
with **no change to the derivation**. No MAJOR is forced, no stored key is re-identified, no migration of
identity is needed.

**Three conditions bound that verdict, and breaching any one ends it:**

1. OPTIONAL, never RECOMMENDED (§1.2).
2. The field **never** enters `CYCLE_KEY_SOURCE_COLUMNS`, or the same historical input yields a different
   `findingHash` and rule 5's reproducibility promise breaks.
3. **The consumer ships before the producer** (§8).

Two findings from that investigation remain open and are not fixed by this plan: the declared version does
not gate the column set (`UNDECLARED_COLUMN` compares against the *build's* field table), and
`PILOT_DATA_CONTRACT_FIELDS` has no generated-document consumer, so the customer contract doc is
hand-authored and nothing would catch it drifting.

## 5 · The database-key migration — the real blocker

### 5.1 It is a PRIMARY KEY, not a contract field

`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])` with `sourceRef`
**account-grained** (`prisma/schema.prisma`). Two obligations of one account **collide on the primary key**.
The table cannot hold obligation-grained rows whatever the contract declares.

> **The migration comes first; the contract field buys nothing before it.** This corrects the earlier
> sequencing, which had the field first.

The escape used by the event-ordering migration is **unavailable here**: that column is nullable with a
sequence default, and a Postgres primary key admits no NULL. The table is append-only, so the key cannot be
widened in place without rewriting history.

### 5.2 Additive sibling table, not a widened key

The same pattern Detector #2, the expectation extract, the billing extract and the obligation-reference
counterfactual all used — **an additive, separately governed sibling**, never a widening of something whose
canonical form is already hashed:

* a new table at obligation grain, with its own key, its own rule-version column and its own index;
* the existing table **untouched**, so every historical row, its `attributionRule` and its
  `sourceRefKeyId` semantics are preserved bit for bit;
* reads that need the account grain keep reading the old table; reads that need obligation grain read the
  new one and **fail closed** when it has no row.

**Why not widen:** widening re-identifies every historical row, forfeits append-only, and would require a
rewrite of exactly the evidence the table exists to preserve.

### 5.3 Forward-only, and the rollback is the honest part

| | |
|---|---|
| **apply** | one `CREATE TABLE`, additive. No `ALTER` on an existing table, no data movement, no backfill. Applied with `prisma migrate deploy`, never `db push`. |
| **rollback** | **drop the new table.** Safe *only while nothing has written to it*, because dropping a populated append-only table destroys evidence. After first write the rollback is **forward-only**: disable the producer, leave the table in place, and let the consumers fail closed on its absence of new rows. |
| **what rollback does NOT do** | it cannot un-declare a contract version a customer has already built an export against, and it cannot recover a case opened under the new grain. |

> **State this before writing the migration, not after:** a migration whose rollback is "drop the table" has
> a rollback window that **closes on first write**. Any plan that reports a clean rollback without naming
> that window is reporting a rollback it does not have.

### 5.4 Two interactions that are reasoned and NOT tested

Carried forward from §4.3 of the risk document and still true:

* **the purge path** — `pilotInputRetention` and the SQL purge guard read `max(at)` and existence; a new
  sibling table is not in their reckoning;
* **the emitter's execution grouping** — `governedSignalEmitter` groups staged rows per execution, and a
  second grain changes what "one row per entity" means to it.

Neither is a reason not to proceed; both are reasons the slice that proceeds must test them rather than
reason about them.

## 6 · Ambiguous identity

Four states, and they stay distinguishable, because collapsing any two hides which half is missing:

| state | meaning | behaviour |
|---|---|---|
| **keyed** | every row carries a source-stated obligation reference | obligation grain available |
| **unkeyed** | the column is absent, or the cell is blank | the obligation-grained capability **fails closed**; Detectors #1/#2 keep measuring at account grain, and **no row is rejected** |
| **dangling** | a reference that resolves to nothing | a **per-unit** condition, counted and carrying its interpretation, **gating nothing at dataset level** — the dataset-global taint defect, which this repository has now made twice |
| **colliding** | two rows claim one obligation identity | **all of them are excluded** from the accepted population regardless of order or identical content — the pilot dataset collision rule, unchanged |

**A blank cell is not a missing column.** The extract contracts already distinguish *schema presence* from
*row-level availability*, and the readiness dependency probe exists because *a customer-facing claim about
what a field is worth is generated from the behaviour of the code that will judge their file.*

**And ambiguity must never be resolved in the direction that increases the number.** Declaring two lines
distinct *inflates* exposure, which is beneficiary-adverse in the same direction the admission bar is, and
needs the same governance before any production use.

## 7 · What the disclosure must do after the grain moves

Not an afterthought — the disclosure is the thing most likely to drift into a false reassurance:

* `OBLIGATION_UNIQUENESS_GUARANTEED` becomes reachable **only** where the key is genuinely present for that
  case. A dataset-level capability flag must not promote a case whose own row is unkeyed — that is the
  `coverage.event` error, which was *"declaring availability from a subset of the facts required."*
* A **mixed** boundary must stay legible: some cases obligation-grained, some not, on the same screen.
* An absent disclosure must keep failing closed as `NOT_STATED`. After the migration there will be two
  server versions in flight at some point, which is exactly when that branch earns its place.

## 8 · Producer/consumer rollout ordering — forced, not chosen

```
1. sibling TABLE               (additive; nothing reads it yet)
2. CONSUMER                    (reads the new grain, fails closed on absence)
3. contract 2.1.0, OPTIONAL    (declares the field)
4. PRODUCER                    (writes the field, and its tests)
5. disclosure upgrade          (§7 — only now can a case be obligation-grained)
```

Two rules force this order and neither is a preference:

> **A file declaring `2.1.0` against a `2.0.0` build is refused, while the reverse is accepted.** So the
> consumer must ship first or a customer who upgrades promptly is refused.

> **No identity or correlation field is declared until the production code that reads it ships in the same
> slice.** This is the `obligation_ref` revert rule, and the revert it came from is the evidence: the field
> had no production consumer, the value died at every boundary, and *six of the seven facts the future
> decision needed were uncollectable.*

One favourable fact, verified rather than assumed: **candidate staging runs BEFORE
`projectExecutionInput`**, on `report.acceptedCycles`. The projection hard-allowlists `attributes` and
replaces identifiers with ordinals, so the value cannot survive it — and does not need to. Therefore **no
change to the projection or to `hashExecutionInput`, and no retained input can read as
`execution_input_tampered`.** This corrects my own earlier statement that the first thing to verify was the
value surviving the projection; it was the wrong thing to verify.

## 9 · Governance approvals required before any of this is built

| # | decision | owner | why it is not ours |
|---|---|---|---|
| 1 | **declare `obligation_ref` in contract 2.1.0 as OPTIONAL** | contract owner | a customer-facing schema change |
| 2 | **the sibling table and its forward-only rollback window** (§5.3) | schema owner | append-only evidence; the window closes on first write |
| 3 | **what an existing account-grained case MEANS after the grain moves** | product/governance | not a code decision; the owner has already fixed the answer for *existing* rows — this is about how they are presented beside new ones |
| 4 | **the unkeyed-row dedupe tail** (§2.4, §10) | contract + schema | the obvious answer silently reproduces today's merge |
| 5 | **whether a real billing system can emit a reference stable across reschedule, renewal and re-key** | customer evidence, not a decision | until answered by a real export, §1.1's preferred component is a hypothesis; it is supported only by synthetic measurement |

## 10 · Open sub-decisions, stated rather than assumed away

1. **The unkeyed tail (§2.4).** `obligationKey ?? ""` makes every unkeyed row of an account collide — today's
   defect with a longer key. Alternatives: refuse to stage an unkeyed row (loses real money that Detectors
   #1/#2 can measure), or stage it at account grain under an explicitly marked account-grained identity (two
   grains in one table, which §5.2 just separated). **Not resolved here.**
2. **Grain of the reference itself.** Still open from the grain study: the two sides identify at different
   grains, consolidation and splitting are many-to-many, and `C_SCHEDULE_LINE` is declared NOT CONSTRUCTIBLE
   because billing emits no reference to the obligation a line settles.
3. **Whether the reference is on the billing side, the expectation side, or both.** Resolved by relocation
   for the reconciliation lane — *the key lives on the billing side* — and **not** resolved for the
   activation/assessment lane this plan is about, which has only one extract.
4. **`OBLIGATION_IDENTITY_FIELDS` remains `[]` until #1 and #4 above are both answered.** It is the single
   switch that makes the guarantee reachable, and it must not move first.

## 11 · What is NOT in this plan

* No contract bump, no migration SQL, no schema edit, no detector change.
* No change to dedupe keys, case identities, monetary amounts, historical `AuthorityEvent`s or proof
  semantics **as they stand today**.
* No automatic split, merge, reassignment or reinterpretation of any existing case.
* No claim that any of this turns an observed amount into proven Revenue Returned. The merge is an
  **exposure-accuracy** defect. `Collected − Baseline` is computed from evidence and a locked baseline, not
  from `amountAtRiskMinor`, so **no proven figure is wrong because of the merge** — and none becomes right
  because of this plan.
