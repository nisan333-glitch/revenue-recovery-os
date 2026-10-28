# Obligation-grained attribution — design, dependency map and cutover (Gate A/B)

**Status.** Gate A design and Gate B isolated rehearsal, both complete and measured.
**Gate C — owner approval for a production schema change — is UNAPPROVED and nothing here approaches it.**
The migration SQL lives in `scripts/migration-design/` and **not** in `prisma/migrations`: a file under
`prisma/migrations` is applied by `prisma migrate deploy` on every deploy, so committing it there would
*be* the production schema change, pending nothing but a deploy.

Everything below was measured on disposable PostgreSQL databases whose names carry `synthetic` as a
distinct token. No customer data exists in this repository and none was used.

---

## 1 · What was actually broken, and where

Two separate defects were conflated in earlier records, and separating them is most of the work.

| | Path | Keyed by | Symptom |
|---|---|---|---|
| **A** | reconciliation observer → candidate → case | `caseCandidateDedupeKey = digest([boundaryId, recoveryType, sourceRef])` | two obligations of one account in **different runs** collapsed to one candidate; the second's money reached no figure |
| **B** | pilot assessment → staged attribution | `PilotAssessmentEntityAttributionRecord @@id([executionId, sourceRef])` | the table **cannot hold** obligation-grained rows at all |

**A needed no schema change and is fixed.** **B needs a primary-key change and is designed, rehearsed and
held at Gate C.** An earlier claim that B was "the blocker" for S-DUP-3 was wrong: the reconciliation path
does not touch that table.

---

## 2 · Verified obligation identity model

> **The identity of an obligation is stated by the server from the customer's own extracts, or it is
> UNRESOLVED. It is never derived from an account, an activation cycle, a source reference or an operator
> assertion.**

| Property | Answer |
|---|---|
| **Origin** | The reconciliation the server performed. A candidate covering **exactly one** unit is `SINGLE_OBLIGATION`; two or more is `ACCOUNT_AGGREGATE`, which carries no per-obligation figures because there are none. |
| **Authority** | The server. There is no request field and no `OPERATOR_ASSERTED` provenance value, so a caller's claim has nowhere to be stored. |
| **Scope** | **One reading of one pair of extracts.** This is *weaker* than a cross-system identity and never becomes one. |
| **Cross-system limitation** | `OBLIGATION_IDENTITY_FIELDS` is still `[]`. A re-key, a migration or a consolidation on the customer's side produces a **different** reference for the same business obligation, and nothing here detects that. |
| **Uniqueness** | `(boundaryId, recoveryType, sourceRef, obligationRef)` for a candidate; `(execution_id, source_ref, obligation_ref)` for an attribution row. |
| **Collisions** | Structurally impossible between grains: `digest` length-frames each component, so a 3-component preimage cannot produce a 5-component one. Measured against four adversarial crafted inputs. |
| **Missing identity** | Candidate: the signal states no coverage, the v1 account key applies, and **PROVEN is refused**. Attribution row: the sentinel `'UNRESOLVED'` with `LEGACY_UNRESOLVED` provenance, inseparable by CHECK. |
| **Form** | `hmac-sha256:<64 hex>` under a deployment key, in its own namespace so a unit reference can never collide with an account reference. A raw identifier is refused at the signal boundary and by a CHECK. |

**The amount is deliberately absent from the identity.** If it were present, a corrected observation would
become a second obligation and measured exposure would double. What happens to a correction is reported
separately (§5) and is an owner decision.

---

## 3 · Dependency map for the attribution table

Read from the live schema, not from the Prisma file.

**Constraints:** PK `(execution_id, source_ref)`; FK `(execution_id, boundary_id) → pilot_assessment_executions`
`ON UPDATE RESTRICT ON DELETE RESTRICT`; six CHECKs (`pseudonymous`, `positive`, `has_cycles`, `currency`,
`rule_present`, `key_id_present`).
**Indexes:** the PK's unique index, plus `pilot_assessment_entity_attributions_boundary_idx (boundary_id, execution_id)` — unchanged by this migration.
**Triggers:** `no_update` (BEFORE UPDATE → reject), `purge_only` (BEFORE DELETE → requires a recorded purge), `no_truncate`.
**Non-test readers:** `server/services/pilotInputRetention.ts`, `server/services/governedSignalEmitter.ts`, `server/persistence/pilotExecutionStore.ts`.
**Writers:** the governed emitter only; the staging path is in any case refused today at
`leakInstanceIdentityStatus()` (`governedSignalStaging.ts`, `governedSignalEmitter.ts`), so **no production
write reaches this table under the current contract**.
**PROVEN:** the gate reads the **candidate signal** and `agent_task_events`, not this table, so the
migration cannot weaken it. Verified by the negative controls, which pass unchanged.

### The five controls a delete must satisfy — measured, in order

1. primary key refuses a duplicate,
2. `no_update` refuses any `UPDATE` (`append-only: UPDATE … is rejected`),
3. `purge_only` refuses a delete with no recorded purge,
4. the purge **reason** is a closed vocabulary (`input purge reason … is not recognised`),
5. `terminal_completed` must be corroborated by a real COMPLETED event (`claims completion but no COMPLETED event exists`).

**Control 2 is why the migration contains no backfill statement.** An `UPDATE` backfill is impossible.
`ADD COLUMN … NOT NULL DEFAULT` is catalog-only in PostgreSQL 11+: measured, the legacy row read
`obligation_ref=UNRESOLVED` while its `currency` stayed `USD`, proving **no row was rewritten**.

---

## 4 · Schema transition, cutover and rollback

Additive first: three columns with defaults, four CHECKs, then the key. SQL in
`scripts/migration-design/obligation-attribution-up.sql`, rollback in `…-down.sql`.

**A nullable column was the obvious shape and does not work**, for two independent reasons: a PRIMARY KEY
column cannot be NULL, and a UNIQUE INDEX would be *worse* than the PK because PostgreSQL treats NULLs as
distinct — `(ex, ref, NULL)` could be inserted twice and the table would permit duplicate legacy rows,
losing a guarantee it has today.

**The reversible window is exact: after UP, before the first `SERVER_DERIVED_SINGLE_UNIT` row.** Inside it,
UP→DOWN is a **no-op on history** — rehearsed on its own database, with the primary key, the obligation
columns, the obligation constraints and every legacy row's bytes all restored, and the append-only trigger
still refusing afterwards. Outside it, the rollback **refuses and names the reason**, and the five controls
above mean clearing its path is a governance action with its own evidence requirements, not a schema
operation.

**Gates.** A — this document and the SQL. B — the isolated rehearsal, 9/9. C — **owner approval, not
given**: no `prisma/migrations` entry, no `schema.prisma` change, no deploy.

---

## 5 · S-DUP-4: corrections are detected, preserved and reported — precedence is NOT decided

`server/services/candidateCorrections.ts` is a read-side derivation over `agent_tasks.result` and
`agent_task_events`, append-only by database trigger with no purge path. **Nothing new is persisted and
nothing needed to be**: the corrected observation was never lost, it was never *read*.

States: `SINGLE_OBSERVATION`, `REPEATED_IDENTICAL_OBSERVATION` (a replay, not a correction) and
`CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED`. Every amount ever observed is reported in append order, from
`event_sequence` — a database-allocated sequence, NOT NULL with a sequence default, so ties are impossible
and there is no legacy-null ambiguity to label.

**There is no corrected-exposure field, and its absence is enforced structurally** by a test that scans the
module for `correctedMinor`/`authoritativeMinor`/`effectiveMinor`/`resolvedMinor`. Such a field *is* the
precedence decision wearing a different name. Upward and downward magnitudes are reported separately and
**never netted**: an understatement and an overstatement are two problems, and their sum is zero problems.

---

## 6 · S-ID-1: a refusal no longer leaves only a zero

`ReconciliationPlan.refusedExposure` reports `NOT_EXAMINED` | `NONE_REFUSED` | `UNDETERMINED`, the refused
unit count, and the **expected** figure the contract side stated on those units — which is not in doubt —
while the **residual is not reported**, because the residual is exactly what the refusal is about.
`refusedWithoutExpected` is counted separately so the expected total is never mistaken for complete.

`NOT_EXAMINED` exists because an unreadable extract is not "no refusals": stating that none was refused
would claim a population was checked.

---

## 7 · Unresolved business decisions

1. **Correction precedence** (S-DUP-4). First-wins, last-wins, highest-wins or re-open. Measured cost of
   leaving it open: $200 unreported upward, $400 overstated downward on the synthetic package.
2. **Same-run aggregation** (S-DUP-2). Two obligations of one account in **one** run still become one
   `ACCOUNT_AGGREGATE` candidate: money preserved, per-obligation attribution not. The mechanism to split
   them now exists; doing so changes a documented design every read surface reflects ("one candidate per
   payer") and so is a constitution-level change.
3. **Whether one activation cycle is one obligation.** Until answered, the activation detector *relays*
   source-stated obligation facts and infers none.
4. **S-ID-1 refusal scope.** Whether an unrelated malformed line in the same unit should suppress
   establishable exposure at all.
5. **Gate C** itself: applying the attribution migration to a real database.

---

## 8 · What this does not claim

No production schema changed. No customer data exists or was used. Every figure is synthetic and **no
observed amount became Revenue Returned**. `OBLIGATION_IDENTITY_FIELDS` is still `[]`, so no cross-system
obligation identity exists, and the PROVEN gate is unchanged and still fail-closed.
