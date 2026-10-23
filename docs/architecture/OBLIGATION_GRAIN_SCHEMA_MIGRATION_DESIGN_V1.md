# Obligation-grained identity · schema migration design

**Status: DESIGN ONLY. Nothing in this document has been run, applied or merged.** The SQL below is a draft
inside a document; it is **not** in `prisma/migrations/`, `prisma/schema.prisma` is untouched, and no
contract field is declared. Running any of it needs a separate, explicit approval (§11).

This builds on, and does not replace, `OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md` (principles, versioning,
rollout order) and `RECONCILER_GOVERNANCE_PROPOSALS_V1.md` (§B: the reconciler lane needs no schema change).
This document is the concrete schema, invariants, backfill, collision, rollback and test design for the
**assessment/activation lane**, which is the one that is blocked by a primary key.

---

## 1 · What exists today (verified in the repository, not recalled)

| fact | where |
|---|---|
| The staged-attribution table is keyed `PRIMARY KEY (execution_id, source_ref)`; `source_ref` is `hmac-sha256:<64 hex>` and **account-grained** | `prisma/migrations/20260927120000_ep31_entity_attributions`, `prisma/schema.prisma:531` |
| It is written in the **same transaction** as the execution and its input, so "no candidate without a governed execution" holds in the database | `server/persistence/pilotExecutionStore.ts:226` |
| UPDATE is rejected by trigger; DELETE requires a recorded purge authorization; TRUNCATE is rejected | same migration, lines ~70–104 |
| The governed input purge deletes this table's rows under the **same** authorization as the input, so one purge cannot leave the other table behind | `server/services/pilotInputRetention.ts:354` |
| The single reader is the signal emitter, which refuses while `leakInstanceIdentityStatus()` is not establishable | `server/services/governedSignalEmitter.ts:215–234` |
| `source_ref_key_id` is **nullable** because the table holds historical rows; NULL is refused at emission as `source_ref_key_id_missing`, never read as "current" | migration `20260930120300_step5d_execution_source_lineage` |
| The candidate dedupe key is `digest([boundaryId, recoveryType, sourceRef])` | `server/agents/caseAdmission.ts` |

The consequence, stated once: two obligations of one account **collide on the primary key**, so the table
cannot hold obligation-grained rows whatever any contract declares. The key cannot be widened in place:
the table is append-only, and widening would rewrite the evidence it exists to preserve.

## 2 · Design: an additive sibling table

A new table at obligation grain. **The existing table is not altered in any way** — not a column, not a
constraint, not a trigger, not a row.

```sql
-- DRAFT · NOT RUN · NOT IN prisma/migrations
CREATE TABLE "pilot_assessment_obligation_attributions" (
  "execution_id"            TEXT        NOT NULL,
  "boundary_id"             TEXT        NOT NULL,
  -- Pseudonym of the OBLIGATION: HMAC over the ordered pair (account, obligation_ref), so one reference
  -- string appearing under two accounts is two identities, never one.
  "obligation_ref"          TEXT        NOT NULL,
  -- Pseudonym of the ACCOUNT, for grouping and for the disclosure only. NOT part of the key.
  "account_ref"             TEXT        NOT NULL,
  "amount_at_risk_minor"    BIGINT      NOT NULL,
  "currency"                TEXT        NOT NULL,
  "contributing_cycle_count" INTEGER    NOT NULL,
  "attribution_rule"        TEXT        NOT NULL,
  -- NOT NULL from the first row. The old column is nullable only because history exists; this table has none.
  "source_ref_key_id"       TEXT        NOT NULL,
  "derived_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pilot_assessment_obligation_attributions_pkey" PRIMARY KEY ("execution_id", "obligation_ref"),
  CONSTRAINT "..._obligation_pseudonymous" CHECK ("obligation_ref" ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT "..._account_pseudonymous"    CHECK ("account_ref"    ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT "..._positive"                CHECK ("amount_at_risk_minor" > 0),
  CONSTRAINT "..._has_cycles"              CHECK ("contributing_cycle_count" > 0),
  CONSTRAINT "..._currency"                CHECK (char_length("currency") = 3 AND "currency" = upper("currency")),
  CONSTRAINT "..._rule_present"            CHECK (btrim("attribution_rule") <> ''),
  CONSTRAINT "..._key_id_present"          CHECK (length(btrim("source_ref_key_id")) > 0),
  CONSTRAINT "..._execution_fkey" FOREIGN KEY ("execution_id", "boundary_id")
    REFERENCES "pilot_assessment_executions" ("execution_id", "boundary_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "..._boundary_idx" ON "pilot_assessment_obligation_attributions" ("boundary_id", "execution_id");
-- + the same three guards as the old table: no UPDATE, DELETE only with a recorded purge, no TRUNCATE.
```

Why each choice: the pseudonymity `CHECK` is the old table's rule applied to both references (a database
rule, not a convention a caller may forget). `obligation_ref` hashes the **pair** so a reference string reused
by two accounts cannot merge them. `account_ref` is stored but outside the key so the disclosure and the
operator can group without it deciding identity. `source_ref_key_id` is `NOT NULL` because the nullable
form existed solely for history that this table does not have.

## 3 · Before / after invariants

"Before" is what holds today; "after" is what must hold once all five steps of §7 are deployed. Every row is
a test (§9), not a sentence.

| # | invariant | before | after |
|---|---|---|---|
| I1 | existing `pilot_assessment_entity_attributions` rows | N rows, checksum C | **identical N and C** — no row, column or trigger changed |
| I2 | existing candidates, cases, proofs, `AuthorityEvent`s | as recorded | **byte-identical**; none recomputed, re-keyed, split or merged |
| I3 | `findingHash`, `PAD-`, `PAX-`, policy hashes | as recorded | unchanged for every historical record (identity surfaces read their version from the frozen record, not the build — plan §4) |
| I4 | a legacy execution (no obligation reference) | stages account-grained rows | **still** stages account-grained rows, in the old table, unchanged |
| I5 | two obligations of one account in one execution | collide on the PK; one candidate | two rows, two candidates, **only for executions staged under the new regime** |
| I6 | re-running / re-reading the same extract | same keys | same keys (the key reads only source-stated facts; nothing from the build) |
| I7 | an obligation rescheduled by the source | n/a (no obligation identity) | keeps its key, because the key is the source-stated reference, not `(entity, signed_at, due_at)` |
| I8 | candidate dedupe | `digest([boundary, type, account])` | `digest([boundary, type, obligation_ref])` for new-regime signals; **old signals keep their old keys** |
| I9 | monetary semantics | Revenue Opportunity only | unchanged: exposure stays OBSERVED; `Collected − Baseline` is not read from this table |
| I10 | append-only | UPDATE rejected, purge-only DELETE, no TRUNCATE | the same, on both tables |
| I11 | a purge | removes input + old attribution under one authorization | removes input + old **and new** attribution under that **same** authorization |

I2, I3 and I8 are the load-bearing ones: they are why this is a sibling table rather than a widened key.

## 4 · Backfill: none, deliberately

* **No backfill.** Rows written before the regime existed are interpreted as account-grained; they are never
  rewritten. Backfilling would be NH asserting a fact (which obligation a historical row was) that nothing
  recorded. This is the `BIGSERIAL` lesson from the event-ordering decision: a backfill commits a
  fabricated history to disk.
* **The grain marker is per row and unambiguous from day one.** Absence of a row in the new table means
  account-grained. A case's grain is derived at read time (`deriveCaseIdentityGrain`), stored nowhere, so no
  mutable status column and no historical case needs touching.
* **Legacy extracts are not re-staged.** An already-assessed extract is not silently re-identified. If an
  operator wants obligation-grained cases from old bytes, that is an explicit re-assessment (a new
  execution, linked to the old one with a stated reason — `REASSESSMENT_V1.md`), never a migration step.

## 5 · Collision handling

| situation | rule |
|---|---|
| Two cycles in **one execution** carry the same `obligation_ref` | The reference claims they are one obligation; the cycle key says they are two. **Neither is summed** and neither is chosen by position: all rows sharing the reference are excluded and reported as `duplicate_obligation_reference` — the same rule the dataset-collision decision (2026-09-25) fixed for cycle identity. |
| Same reference string under **two accounts** | Distinct identities (the pseudonym hashes the pair). A deliberate non-collision; counted so a data owner can see it. |
| **Unkeyed** row (no `obligation_ref`) | **Open sub-decision, recommended answer:** stage it account-grained in the *old* table, unchanged, and never in the new one. Two grains in one table is what §2 just separated; refusing the row would lose money Detectors #1/#2 can measure; `obligationKey ?? ""` would reproduce today's merge with a longer key. |
| Same obligation across **executions** (re-assessment) | Same pseudonym ⇒ same dedupe key ⇒ first observation wins, exactly as today but per obligation. The absorbed observation is recorded by the existing `admittedCount`/`createdCount` event metadata. |
| Pseudonym **key rotation** | `source_ref_key_id` is `NOT NULL`, so a rotation is loud rather than a silent second candidate for one obligation. No dual-key derivation is added. |
| A source that **re-keys** its references | A new reference is a new obligation. NH cannot link them and does not try; that is a refusal, not a guess (plan decision #5 stays open until a real export answers it). |

## 6 · What the contract field adds, and does not

`obligation_ref` in contract **2.1.0** as **OPTIONAL** (plan §4). It does not enter `pds` (the submission
identity is over the file's bytes, so a customer adding a column already gets a new identity), does not
enter `CYCLE_KEY_SOURCE_COLUMNS` (it would change `findingHash` for unchanged history), and does not enter
the execution projection (candidate staging runs **before** it, on `report.acceptedCycles`). Declared only
in the same slice as its consumer — the `obligation_ref` revert rule.

## 7 · Rollout order (forced, per plan §8)

1. **Table** — additive migration; nothing reads or writes it.
2. **Consumer** — emitter reads the new table, retention purge deletes from it (I11); fails closed on absence.
3. **Contract 2.1.0, OPTIONAL** — a `2.1.0` file against a `2.0.0` build is refused while the reverse is
   accepted, so the consumer must already be deployed.
4. **Producer** — staging writes the new table for keyed rows, behind its own flag, with its tests.
5. **Disclosure** — only now can a case be obligation-grained; `OBLIGATION_IDENTITY_FIELDS` moves last.

Each step is deployable and revertable on its own *up to the point in §8*.

## 8 · Rollback — stated before the migration, not after

| | |
|---|---|
| apply | one `CREATE TABLE`, indexes and triggers. No `ALTER` of any existing table, no data movement. `prisma migrate deploy`, never `db push`. |
| rollback **before first write** | `DROP TABLE`. Safe: nothing depends on it, and I1–I3 hold trivially. |
| rollback **after first write** | **Forward-only.** Dropping a populated append-only table destroys evidence. Instead: turn the producer flag off, leave the table, and the consumer reads whatever exists and fails closed on absence. |
| what rollback cannot do | un-declare a contract version a customer has built an export against, or recover a case already opened under the new grain. |

> The rollback window **closes on the first write**. Any report of a "clean rollback" that omits that
> sentence is reporting a rollback that does not exist.

## 9 · Tests (written before the migration is applied anywhere)

**Postgres constraint tests** (the old table's tests, repeated on the new one): PK collision on
`(execution_id, obligation_ref)`; both pseudonym `CHECK`s reject a raw identifier; `amount > 0`; `cycles > 0`;
`key_id` empty/NULL rejected; FK to a missing execution rejected; UPDATE rejected; DELETE without a recorded
purge rejected and with one accepted; TRUNCATE rejected.

**Preservation tests (the point of the sibling design):** snapshot the old table (row count + a checksum over
all columns) → apply the migration → assert identical (I1). Apply on a database that already holds executions,
inputs, candidates and cases from earlier migrations — a *live-upgrade simulation*, which is the only honest
test of the legacy path. Apply twice (idempotent under `migrate deploy`).

**Key-derivation properties** (pure; plan §2): same extract ⇒ same key; two obligations of one account ⇒
different keys; rescheduled due date ⇒ same key; same string under two accounts ⇒ different keys; key id
change ⇒ detected, never silently a second candidate.

**Behaviour:** an account with two keyed obligations yields **two** candidates and two cases (I5); a legacy
execution yields exactly what it yielded before (I4); duplicate reference inside one extract yields zero rows
for that reference and a named exclusion; purge removes both tables' rows (I11); a re-assessment keeps the
first observation per obligation.

**Disclosure and UI:** a new-regime case reads `OBLIGATION_UNIQUENESS_GUARANTEED` only when the row exists in
the new table; every historical case still reads as before; wording is derived, not hardcoded.

**CI impact:** `postgres-integration` (constraints, preservation), `verify` (pure properties, disclosure),
`browser-journey` (two obligations of one payer → two queue rows), `docker-pilot-smoke` (migration applies
on a clean image). `frozen-verifiers` must stay green unchanged — the frozen packages do not touch this table.

## 10 · Risks

1. **Single point of truth for "obligation".** The design is only as good as the source's reference. Unproven
   against a real export (plan decision #5); until then it is supported by synthetic measurement only.
2. **Two tables, two grains, one emitter.** The emitter must read both and must not let an obligation-grained
   row and an account-grained row of the same account be summed or double-counted as one figure. A test, not a hope.
3. **The unkeyed tail** (§5) is a product decision with a monetary consequence; the recommendation above
   trades some merge risk for not losing measurable money.
4. **Retention coupling.** Forgetting to extend the purge (I11) leaves pseudonymised customer-derived data
   behind after an authorised purge — a privacy defect, caught by the test above.

## 11 · Approvals required before anything runs

| # | decision | owner |
|---|---|---|
| 1 | the sibling table and its forward-only rollback window (§8) | schema owner |
| 2 | `obligation_ref` in contract 2.1.0 as OPTIONAL | contract owner |
| 3 | the unkeyed-row rule (§5) | contract + schema |
| 4 | what an existing account-grained case means beside new ones (plan §9 #3) | product / governance |

**Not requested here:** any migration run, any `schema.prisma` edit, any contract bump, any change to
`OBLIGATION_IDENTITY_FIELDS`, any change to a dedupe key or a historical row. The merge this addresses is an
**exposure-accuracy** defect; `Collected − Baseline` is computed from evidence and a locked baseline, so no
proven figure is wrong because of it.
