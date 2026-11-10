# D2 · Option B — obligation-grained attribution identity, validated

**Date:** 2026-11-10 · **Owner-approved** · **Isolated synthetic database only**
**Evidence:** `server/persistence/obligationAttributionMigration.postgres.test.ts` — **21 tests**
**Status:** migration complete and validated. **Not applied anywhere but an isolated test database.**

---

## 1. What was wrong

`pilot_assessment_entity_attributions` was keyed `PRIMARY KEY (execution_id, source_ref)`, and
`source_ref` is an **account** pseudonym. Two obligations of one customer therefore collided on the key:
**the table could not hold obligation-grained rows whatever any contract declared.** No additive index
fixes that, because the primary key itself forbids the second row.

Verified against the live sandbox before any change: `PRIMARY KEY (execution_id, source_ref)`.

## 2. What the migration does, and the two choices that needed justifying

`scripts/migration-design/obligation-attribution-up.sql` adds three columns, three CHECK constraints,
and replaces the primary key with `(execution_id, source_ref, obligation_ref)`.

**Why a sentinel and not a nullable column.** A primary-key column cannot be `NULL`. And a UNIQUE INDEX
would be *worse* than the PK: Postgres treats `NULL`s as DISTINCT, so `(ex, ref, NULL)` could be
inserted twice and the table would permit duplicate legacy rows — **losing a guarantee it has today**.
Legacy rows therefore carry the explicit sentinel `'UNRESOLVED'`, which is a *statement that the identity
is not known* and can never be mistaken for one.

**Why no backfill statement exists, measured rather than reasoned.** A `BEFORE UPDATE` trigger refuses
every update to this table — an ordinary `UPDATE ... SET currency='EUR'` raises *"append-only: UPDATE on
pilot_assessment_entity_attributions is rejected"*. So a backfill by `UPDATE` is **impossible**, and the
trigger is not disabled to work around it: disabling it is exactly the capability the trigger exists to
deny. `ADD COLUMN ... NOT NULL DEFAULT` is catalog-only in Postgres 11+, so no row is rewritten — proved
by comparing every pre-existing column before and after.

## 3. Validation — the four things the order required

### 3a · Collisions

| Property | Result |
|---|---|
| BEFORE: a second obligation of one account is **impossible** | refused by `..._pkey` |
| AFTER: two obligations of ONE account **coexist** | both rows accepted, $7.00 + $3.00 |
| AFTER: the **same** obligation twice is still refused | idempotency not weakened by splitting the key |
| The sentinel cannot become an identity, **in either direction** | `attributions_obligation_provenance_agrees` |
| Legacy rows stay unique under the new key | all share `'UNRESOLVED'`, so uniqueness is preserved exactly |

### 3b · Referential integrity — **the gap this slice found and closed**

> **This file had thirteen tests and not one of them mentioned a foreign key.** The migration drops and
> recreates a **primary key**, which is precisely the operation that can cascade through dependent
> objects. "The legacy row is byte-identical" was being measured while the schema around it was not.

Six tests were added:

| Property | Result |
|---|---|
| Nothing references this table's PK, so the drop **cannot cascade** | inbound FK list is `[]`, measured |
| The FK to the parent execution survives **byte-identically** | `pg_get_constraintdef` compared before/after |
| It is still **composite** with RESTRICT on both sides | `(execution_id, boundary_id)`, `ON UPDATE/DELETE RESTRICT` |
| Every **pre-existing** constraint is unchanged | whole catalogue map compared, not a list we wrote |
| Exactly **three** constraints were added and **none removed** | asserted both directions |
| The boundary index is untouched, as the SQL's comment claims | `indexdef` compared |
| The FK still **enforces** — an attribution for an unknown execution is refused | measured on the migrated schema |

### 3c · A finding worth more than the test that produced it

**I wrote a test expecting the FK's `ON DELETE RESTRICT` to fire, and it does not.**
`pilot_assessment_executions` carries `BEFORE DELETE OR UPDATE ... EXECUTE FUNCTION nh_reject_mutation()`,
and a `BEFORE` trigger runs **ahead of** foreign-key enforcement. The DELETE is refused one layer earlier
than the constraint I was testing.

> **So `ON DELETE RESTRICT` is unreachable in practice.** It is defence-in-depth sitting behind a
> strictly stronger guard, and it is **not** the mechanism that protects an attribution from being
> orphaned — the append-only trigger is. The FK earns its place on the **INSERT** side, which no trigger
> covers.

The test now asserts the refusal that **actually fires**, plus the division of labour between the two
guards, so neither is credited with the other's work. A test naming the wrong mechanism passes for the
wrong reason the day the right one is removed.

### 3d · Migration safety and rollback

| Property | Result |
|---|---|
| Every legacy fact **byte-identical** after UP | all pre-existing columns compared |
| The legacy row says its identity is **not known** rather than acquiring one | `UNRESOLVED` / `LEGACY_UNRESOLVED` / `none` |
| DOWN **REFUSES** while an account holds two obligations, **naming the reason** | collapsing them would mean choosing which obligation's figure survives |
| Removing a collision needs the **full governed purge chain**, which a rollback cannot manufacture | asserted |
| UP → DOWN inside the reversible window is a **no-op on history** | schema and rows identical afterwards |
| The SQL splitter is dollar-quote aware and tested directly | 4 tests |

**No `OPERATOR_ASSERTED` provenance value exists**, so there is no column in which a caller's claim about
an obligation could be stored. The migration resolves no legacy identity and derives none from an account.

## 4. "Option B is done" must not be read as "obligation-grained attribution is live"

**There are two independent blockers, and this migration clears one.** A test now asserts both so the
distinction cannot be lost:

| Blocker | What it is | State |
|---|---|---|
| **SCHEMA** | the account-grained primary key | **cleared by this migration**, validated 21/21 |
| **CONTRACT** | `OBLIGATION_IDENTITY_FIELDS = []` — the customer data contract declares **no field** from which a stable obligation identity could be derived, so `leakInstanceIdentityStatus()` refuses and the staging path writes nothing | **OPEN** |

Clearing either one alone changes nothing observable. On a **migrated** schema the staging path still
refuses, with `leak_instance_identity_unavailable` — a different reason from the one the migration
addressed, and the test asserts the detail does not mention the primary key at all.

**The contract blocker is deliberately not closed here.** Declaring an identity field is governed by the
rule the `obligation_ref` revert established: *no identity or correlation field is declared until the
production code that reads it ships in the same slice.* It needs a contract MINOR bump (2.0.0 → 2.1.0)
and is recorded as a separate proposal in
[`docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md`](OBLIGATION_IDENTITY_PROPOSAL_V1.md). It is **not** Option B.

## 5. What was deliberately NOT done

**The migration is not in `prisma/migrations/`, and that is the whole of Gate C.** A file there is
applied by `prisma migrate deploy` on every deploy, so committing it would **be** the production schema
change, pending nothing but a deploy. The authorization for this work says plainly: *NOT AUTHORIZED —
production migration.* So the SQL stays in `scripts/migration-design/`, applied by the isolated test and
by nothing else.

`prisma/schema.prisma` is also untouched: adding the three columns there without a matching migration
would leave the schema file describing a database that does not exist.

**To put this in production, three things are needed and none is mine to do:** move the SQL into
`prisma/migrations/`, add the columns to `prisma/schema.prisma`, and deploy. That is one owner decision
and one deploy.

## 6. Evidence

**21 tests**, on a database the test creates, migrates with `prisma migrate deploy`, applies the proposal
to, and drops afterwards — never the database the rest of the suite shares, because leaving later tests
on a schema no migration produced would make a green suite evidence about a schema that exists nowhere.

No production migration, no schema-file change, no customer data, and **no observed amount became
Revenue Returned.**
