# S-DUP-2 Option B — migration design, dependencies, compatibility, rollback and negative tests

**Design only. No production migration is executed and none is proposed for execution here.** The SQL lives
in `scripts/migration-design/`, deliberately **not** in `prisma/migrations`, so nothing applies it but its
own isolated-database test. Gate C — owner approval for a production schema change — is unapproved and this
document does not approach it.

**Verified today** against a pristine PostgreSQL database at `3467893`:
`server/persistence/obligationAttributionMigration.postgres.test.ts` — **13/13 passing**.

---

## 1. Two corrections to my own earlier claims, before anything else

[`S_DUP_DECISIONS_V2.md`](S_DUP_DECISIONS_V2.md) §1 described Option B as changing the candidate key, and
said the absorption disclosure would change meaning "without anything on the row saying which regime wrote
it". **Both are wrong, and reading the code rather than my own note is what found it.**

**Correction 1 · the candidate key is ALREADY obligation-grained.** `caseCandidateDedupeKey` branches:

```ts
if (coverage?.kind === "SINGLE_OBLIGATION") {
  return digest([CANDIDATE_DEDUPE_SCHEME_V2, boundaryId, recoveryType, sourceRef, coverage.obligationRef]);
}
return digest([boundaryId, recoveryType, sourceRef]);   // account-grained, unchanged
```

S-DUP-3 did this. So Option B's candidate half is **done**, and two obligations of one account already
resolve to two candidates and two Recovery Cases **wherever the detector states single-obligation coverage**.
What remains is downstream.

**Correction 2 · the migration design already solves the regime ambiguity.** The up-migration adds
`obligation_provenance` with a CHECK admitting exactly `LEGACY_UNRESOLVED` and `SERVER_DERIVED_SINGLE_UNIT`,
plus a third CHECK requiring the provenance, the reference and the identity version to **agree**. So every
row says which regime produced it, by constraint rather than by convention — which is precisely the per-row
provenance marker the historical-rows decision said would be the remedy *"the day anything starts reading
that field"*.

---

## 2. Primary-key dependencies

The blocker is one primary key:

```prisma
@@id([executionId, sourceRef])   // pilot_assessment_entity_attributions
```

`sourceRef` is account-grained, so **two obligations of one account collide on it** and the table cannot hold
obligation-grained rows whatever the contract declares. The migration splits the key:

| | Before | After |
|---|---|---|
| Primary key | `(execution_id, source_ref)` | `(execution_id, source_ref, obligation_ref)` |
| New columns | — | `obligation_ref`, `obligation_identity_version`, `obligation_provenance` |
| Legacy rows | — | `obligation_ref = 'UNRESOLVED'`, provenance `LEGACY_UNRESOLVED` |

**Dependent surfaces, each checked individually:**

| Surface | Depends on the key? | Effect |
|---|---|---|
| `governedSignalStaging.deriveStagedAttributions` | Writes rows | Must supply the three new columns for new rows |
| `pilotInputRetention` | Reads by `executionId` | **Unaffected** — the prefix of the key is unchanged |
| `pilotExecutionStore` | Reads by `(boundaryId, executionId)` index | **Unaffected** |
| `canonicalBinding` / `canonicalFinding` | Do **not** read attributions | **Unaffected**, so no identity surface moves |
| `caseProvenGate` | Reads `agent_task_events`, not this table | **Unaffected** |

**No hash, witness or identity scheme is in the blast radius**, which is what keeps this a MINOR schema change
rather than one that re-identifies history.

## 3. Compatibility analysis

**No backfill statement exists, and that is deliberate.** `pilot_assessment_entity_attributions` is
append-only by database trigger; the test asserts the trigger **refuses an UPDATE**, so a backfill is not
merely avoided but impossible. Legacy rows therefore carry the sentinel for ever, and the provenance CHECK
makes them distinguishable from derived rows per row.

**Every legacy fact is byte-identical afterwards** — asserted, not assumed, by the `UP` test.

**The sentinel cannot become an identity, in either direction** — its own test. `'UNRESOLVED'` fails the
`^hmac-sha256:[a-f0-9]{64}$` pattern that `SERVER_DERIVED_SINGLE_UNIT` requires, and a derived reference
cannot be relabelled legacy, because the third CHECK requires all three fields to agree.

**Idempotency is not weakened by splitting the key** — also its own test: *the SAME obligation twice is still
refused*. That is the property a key split most plausibly breaks, so it is asserted directly.

## 4. Rollback strategy

`obligation-attribution-down.sql` restores the two-column key and drops the three columns.

> **The rollback REFUSES while an account holds two obligations, and names the reason.** Reversing the key
> would require collapsing two rows into one, which means choosing which obligation's figure survives —
> a monetary decision a rollback script must never take. Removing a collision needs the **full governed
> purge chain**, which a rollback cannot manufacture. Both halves have their own test.

So the rollback is safe exactly while nothing has used the new capability, and refuses as soon as something
has. That is the correct shape: a rollback that silently discarded a row would be worse than one that stops.

## 5. Negative tests — the thirteen, as they run

```
BEFORE · the key is account-grained and a second obligation is impossible
the append-only trigger refuses an UPDATE, which is why no backfill statement exists
UP · the migration applies, and every legacy fact is byte-identical afterwards
AFTER · two obligations of ONE account now coexist, which is the whole point
the SAME obligation twice is still refused — splitting the key did not weaken idempotency
the sentinel cannot become an identity, in either direction
DOWN · the rollback REFUSES while an account holds two obligations, naming the reason
removing a collision needs the FULL governed purge chain, which a rollback cannot manufacture
applies, reverses, and leaves the schema and the history exactly as they were
keeps a dollar-quoted block whole, semicolons and all
drops BEGIN and COMMIT, because the statements run inside one transaction already
ignores a semicolon inside a line comment
splits the real migration and its rollback into plausible statement counts
```

**It runs against its own database**, created and dropped per run. A migration that altered the shared test
database would leave every later test on a schema no migration produced, and a green suite would then be
evidence about a schema that exists nowhere.

## 6. What Option B still needs — and one new finding

**(a) A new finding, reported rather than patched.** `accountGrainedGroup` is
`(boundaryId, recoveryType, sourceRef)` and its comment says that is *"the key's own preimage"*. That was
true before S-DUP-3 and is now true of the **V1 branch only**: the dedupe key is obligation-grained for
single-obligation signals while the absorption grouping is not.

> **The consequence errs safe, which is why it is a finding and not a defect.** `caseProvenGate` computes
> absorption at **account** grain, so a case for obligation A can see an absorbed observation of obligation
> B on the same account and refuse `ABSORBED_OBSERVATION_RECORDED`. It over-refuses, never under-refuses —
> and a gate that refuses too much is a usability cost, where one that refuses too little is a wrong number.
> Narrowing it is part of Option B, not a separate fix, because it must narrow **with** the attribution key
> or the two grains will disagree.

**(b) The writer.** `deriveStagedAttributions` must supply the three columns, which is where
`SERVER_DERIVED_SINGLE_UNIT` is earned — and per the standing rule, **no identity field is declared until
the production code that reads it ships in the same slice**, so the writer and a reader go together.

**(c) `OBLIGATION_IDENTITY_FIELDS` stays empty.** Option B uses the reference the **server derives** from its
own reading of the two extracts. It is not a cross-system identity and never becomes one. A billing
migration, a re-key, a consolidation or a corrected due date changes it, and every affected candidate becomes
a new identity — which is a **duplicate case for one real leak**, the exact failure the dedupe key exists to
prevent. That risk is unchanged by this migration and is the reason Option B is still not recommended for
execution on a derived reference alone.

**(d) Gate C.** Owner approval for a production schema change. Not approached.

## 7. Verdict

> **The migration design is complete, tested and green. Option B as a whole is not, and the gap is no longer
> the primary key.** It is (a) the absorption grain, which must move with it, (b) a writer and reader shipping
> together, and (c) the stability of a server-derived obligation reference — which is a contract question, not
> a schema one.

Contract **2.0.0**, both extracts, `OBLIGATION_IDENTITY_FIELDS = []`, every `*_VERSION`/`*_SCHEME` and every
frozen artefact are unmoved by this document. **No observed amount became Revenue Returned.**
