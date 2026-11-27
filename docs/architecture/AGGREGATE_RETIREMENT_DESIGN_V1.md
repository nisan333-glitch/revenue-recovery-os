# Aggregate retirement — Phase 4 design

**DESIGN ONLY. Nothing here is implemented, and a schema change is required, so this requests
approval before implementation** — per the mandate's own instruction. No code, schema, migration,
contract, version constant or frozen artefact was changed to produce it.

---

## 0 · A defect I shipped four commits ago, recorded first

`server/agents/caseAdmission.ts:94` refuses an obligation-grained claim with:

> *"… Retire the aggregate through governance before obligation-grained claims are admitted for this
> payer."*

**Nothing in the repository implements that.** `grep -rniE '\bretire'` over `server/agents/` and
`server/services/` finds the generic policy-register mechanism and this sentence, and no path that
retires a candidate. So the refusal names a remedy the operator cannot perform — the same defect
class as the `errors.ts` mapper telling an operator to *"create a linked revision"* for a rotated
digest key, which I fixed in `67a558e`. **A refusal that names an unavailable remedy is worse than
one that names none**, because it sends the operator looking. Either this design ships, or that
sentence must be corrected to say the remedy does not yet exist. It must not stay as it is.

## 1 · The problem, stated exactly

The overlap gate added in `4e4797f` refuses an `OBLIGATION_V2` claim when an `ACCOUNT_V1` aggregate
candidate already covers the same payer in the same boundary, keyed by `accountGrainedDedupeKey`.
That is correct and is a mandatory release blocker: without it, one payer's money could be
attributed twice, once per grain.

But it is **permanent**. A boundary that an earlier build wrote aggregates into can never admit an
obligation-grained claim for those payers, so the money that Strategy A made provable stays
unprovable **for exactly the historical population the migration was for**. The asymmetry is
deliberate and recorded: an `ACCOUNT_V1` claim is never refused by this check.

**This is now a purely historical problem.** On the remediated build the pilot emits **24
`SINGLE_OBLIGATION` candidates and `$0.00` locked in `ACCOUNT_AGGREGATE`**. Every aggregate in
existence was written by an earlier build.

## 2 · Three structural facts, each independently fatal to the obvious design

Retirement **cannot** be a state change on the candidate row.

1. `CONSTRAINT "agent_case_candidates_status_valid" CHECK ("status" = 'pending_review')` — the
   status column admits **exactly one value**. There is no representable retired state.
2. `agent_case_candidates_no_update`, `_no_delete`, `_no_truncate` triggers — the row cannot be
   mutated or removed at all, by anyone, including a migration that forgets.
3. `recovery_cases.source_candidate_id` is UNIQUE with a composite FK to
   `(candidate_id, boundary_id)`, and `recovery_cases_no_update` / `_no_delete` — so a promoted
   case **pins its candidate forever**.

This is the repository behaving correctly. It is also why "add a `retired` flag" is not a smaller
version of this design; it is a different design that the database refuses.

## 3 · Why this cannot be derived at read time, unlike the merge disclosure

The obligation-merge disclosure (2026-10-22) is **derived at read time and stored nowhere**, and the
record says a `grain` column *"would have been the stored cache of an immutable fact this repository
has refused three times already."* That reasoning does **not** transfer here, and the difference is
the whole design:

> **The merge disclosure is a property of the key. Retirement is a decision by a person.**

No read-time derivation over candidates, cases, signals or events can produce *"governance decided
this aggregate is superseded"*, because that fact is not in the data. It has to be **recorded**. So
this is not a status cache; it is a governance ledger, and it is append-only for the same reason
every other one here is.

## 4 · Options compared

### D1 · a purpose-built `agent_candidate_retirements` table
A new append-only table keyed `(boundary_id, candidate_id)` with actor, role, rationale and
timestamp; the overlap gate consults it and ignores a retired aggregate.

*Against:* it invents a second vocabulary for a lifecycle this repository already has verbs for,
and it would need its own locking, its own atomicity and its own state derivation — three
mechanisms to get right where three already exist and are tested.

### D2 · reuse `policyLifecycle` + `governedCardinality` — **RECOMMENDED**
Treat the aggregate candidate as a `ScopedSubject` whose `subjectKey` is its `candidate_id` and
whose scope is `(boundaryId, accountGrainedDedupeKey)`. Record `PROPOSED` → `RETIRED` as
`PolicyLifecycleEvent`s in a new append-only `agent_candidate_lifecycle_events` table. The overlap
gate resolves the aggregate's state with the existing `deriveState` and refuses only while it is not
`RETIRED`.

*For:* `PolicyState` already has `RETIRED`; `PolicyTransition` already has `RETIRED`;
`withCardinalityGuardedActivation` already gives the scope lock, the re-read **inside** the
transaction, the legality check via `canTransition` and atomic replacement — the five-step shape its
own header documents. **Retirement is only safe if it is atomic with the admission it unblocks**, and
that is precisely what this mechanism exists to guarantee. No new verb is invented, which the
`policyLifecycle` comment explicitly prefers: *"RETIRE + ACTIVATE is the honest representation rather
than a new verb invented to describe it."*

*Cost:* still a schema change — one table — so still requires approval.

### D3 · narrow or drop the gate
Refuse only when the aggregate is "live", which — since an aggregate can never be proven — is never.
**REJECTED.** That is dropping a mandatory release blocker and calling it a narrowing. The exposure
it prevents is real and was measured: `obligationGrainEmission.postgres.test.ts` asserts the raw-store
sum is **exactly double** without the gate.

## 5 · The precondition that must be established per deployment, never assumed

The safety argument I expected to make is *"retiring an aggregate cannot invalidate a proof, because
`provenEligibility` refuses `ACCOUNT_AGGREGATE`."* **That argument does not hold for history**, and
checking beat asserting:

`caseProvenGate` — the only production caller of `provenEligibility`, reached from
`proofService.ts:266` — was introduced in **`e12b5ad`, 91 commits before HEAD**, and the repository
starts at `a9911a1`. **Proofs minted before `e12b5ad` were never gated on obligation coverage**, so
an aggregate case *could* carry one. Coverage is also not a column: it lives in the candidate's
signal JSON, so the check is a join, not a lookup.

**Therefore retirement is refused for any aggregate whose case holds a proof**, and the query that
establishes it runs before any retirement is enacted:

```sql
SELECT c."source_candidate_id", c."recovery_case_id", p."proofId"
  FROM "recovery_cases" c
  JOIN "Proof" p ON p."recoveryCaseId" = c."recovery_case_id"
  JOIN "agent_case_candidates" a
    ON a."candidate_id" = c."source_candidate_id" AND a."boundary_id" = c."boundary_id"
 WHERE a."signal" -> 'obligationCoverage' ->> 'kind' = 'ACCOUNT_AGGREGATE';
```

A non-empty result is a **stop**, not a warning: retiring that aggregate would strand the provenance
of a frozen proof, which is *silently reinterpreting historical financial evidence*. The remedy then
is a governance decision with an owner, not a retirement.

## 6 · The four verifications the mandate requires

| requirement | how the design satisfies it | what must prove it |
|---|---|---|
| **repeated assessments** | retirement is idempotent: a second `RETIRED` on a `RETIRED` subject is refused by `canTransition`, and the already-retired aggregate simply no longer refuses. Re-running an assessment re-derives the same keys, because identity is unchanged. | a test re-submitting the same obligation claim twice after retirement — one candidate, one case |
| **concurrent operations** | `lockScope` serialises every competing transition on `(boundaryId, accountGrainedDedupeKey)`; the re-read happens **after** the lock. Concurrent obligation claims are additionally serialised by the three unique indexes and the now-unarbitrated `ON CONFLICT DO NOTHING` fixed in `62d132f`. | retirement concurrent with N obligation claims: exactly one candidate per obligation, no raw database error |
| **tenant isolation** | the scope key and the gate's lookup both carry `boundary_id`, and the gate's predicate is `dedupe_key = $1 AND boundary_id = $2` — scoped by the **database**, not by a property of a hash. Already asserted today. | a retirement in boundary A must not unblock boundary B |
| **financial conservation** | retirement writes no amount, and touches no proof, baseline, evidence record or ledger row. The aggregate candidate and any case on it **remain**, readable, with their amounts intact. §5 refuses retirement where a proof exists at all. | before/after equality of every monetary figure, plus the §5 query returning empty |

## 7 · What this does **not** do

* It does **not** delete, alter or reinterpret any candidate, case, proof, baseline or evidence row.
  The aggregate stays exactly where it is and keeps saying exactly what it said.
* It does **not** make an aggregate provable. `provenEligibility` still refuses
  `OBLIGATION_COVERAGE_IS_AGGREGATE`, and retirement does not change coverage.
* It does **not** re-emit or re-detect anything. A retired aggregate's payer becomes admissible for
  obligation-grained claims; producing those claims is the detector's job and needs a re-run.
* It creates **no** Revenue Returned and moves **no** money. The figures in `67a558e`'s run are
  unchanged by anything proposed here.

## 8 · Requested approval

One new append-only table, `agent_candidate_lifecycle_events`, with the same append-only triggers
every sibling carries, plus the gate consulting `deriveState` and a retirement route restricted to a
steward. **Not implemented.** Also requires a decision on §0 — whether the refusal message is
corrected now or by this design landing.

Synthetic throughout: no customer data, no institution verified, and **no observed amount became
Revenue Returned.**
