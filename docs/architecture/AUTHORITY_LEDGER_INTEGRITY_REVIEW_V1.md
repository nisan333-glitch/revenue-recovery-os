# Workstream C · Authority ledger — revision semantics and event ordering

**Status: INVESTIGATION. No historical `AuthorityEvent` touched, no migration, no ledger semantic
changed.** The corrections below are proposals with transition conditions.

Written 2026-10-20 against `04c190a`. Evidence: `server/services/authorityLedgerIntegrity.test.ts`
(8 passing measurements + 6 skipped executable specifications).

---

## 1 · The headline, and it is not the one I expected

> **Yes, both issues can be corrected without touching history — and the two are COUPLED.**

Issue 1's cheapest correction reads the proof chain and pairs it to the ledger **in time order**. Issue 2
is that the ledger records no order. So the free fix for Issue 1 inherits exactly Issue 2's uncertainty.
That coupling is this workstream's main finding and it sets the sequence: **Issue 1 first**, because it is
free, retroactive and has a real security consequence; Issue 2 second, because it is measurably rarer here
than in the log that motivated it.

## 2 · Issue 1 · `revise()` writes `action: "Approve"` — VERIFIED

`approve()` (`server/services/proofService.ts:325`) and `revise()` (`:362`) both pass
`action: "Approve"` to `proofStore.authorityRow`, bypassing `recordAuthority` entirely. Measured
(test 1): a case with one approval and one revision carries **two `Approve` rows differing only in `at`**
— same actor, same role, same policy version — and **no `Revise` token exists anywhere in the ledger**.

### 2.1 · The token is LOAD-BEARING — why the obvious fix is unsafe

`enforceSeparation` (`server/auth/authorityGate.ts:36`) builds

```ts
const approvers = idsFor("Approve");
```

and uses that set in three branches: an `Approve` is refused to a prior verifier, a **`Verify` is refused
to anyone in `approvers`**, and an `Author` is refused to anyone in `approvers`.

**Measured (test 4):** an approver identity that performed *only a revision* is in `approvers` today, and
`POST /proofs/:id/verify` returns **403**. If `revise()` wrote `"Revise"` *instead of* `"Approve"`, that
actor would drop out of the set and the refusal would become a **201**.

> **Substituting the token silently loosens separation of duties in the beneficiary's favour.** A tidy-up
> that reads as cosmetic would remove a control. **REJECTED.**

### 2.2 · Three strategies

| | mechanism | history | migration | cost |
|---|---|---|---|---|
| **A · read-side derivation** *(recommended)* | classify from the `Proof` chain | **works retroactively on every row ever written** | none | pairing rests on order (§3) |
| **B · additive token** | write `Approve` **and** a distinguishing fact | new rows only; old rows unchanged | yes | `idsFor("Approve")` must widen **in the same change** |
| **C · substitution** | write `Revise` instead | — | — | **REJECTED**, §2.1 |

### 2.3 · Strategy A, and why it is already true

The `Proof` table distinguishes an approval from a revision **unambiguously and immutably**, with no new
field:

* an approval is a **chain root** — `previousProofId === null`, `proofVersion === 1`;
* a revision is not — `previousProofId` names its predecessor, `proofVersion > 1`;
* `@@unique([chainId, proofVersion])` plus a partial unique index on `previousProofId` make the chain a
  line, not a fork.

**Measured (test 2):** on a case with one approval and one revision the chain classifies them exactly, and
the `Approve` row count equals the proof row count — one ledger row per proof row, which is what makes the
derivation total rather than heuristic.

**Its limit, stated rather than papered over (test 3):** pairing *the k-th ledger row* to *the k-th proof*
requires the ledger rows to be ordered. Where their timestamps differ the pairing is sound; where they tie
it is **NOT ESTABLISHED**. The derivation must report that state rather than guess — which is Issue 2.

### 2.4 · Transition conditions for Strategy A

1. It is a **read-side** addition. No write path changes, so no `recordAuthority` call site moves and
   `enforceSeparation` is untouched — test 4 must still return 403 afterwards.
2. It reports three states — `APPROVAL`, `REVISION`, `NOT_ESTABLISHED` — and never defaults the third to
   either of the first two.
3. It is **derived at read time, never persisted**. A stored classification would be a mutable cache of an
   immutable history, which is what this repository refuses everywhere else.

## 3 · Issue 2 · no append sequence — VERIFIED, and measured

`AuthorityEvent` has `at DateTime @default(now())`, a random `AE-<uuid>` primary key, **no `seq` column**
(test 6), and `authorityFor` orders by `at` **alone** with no tie-breaker at all
(`server/auth/authorityStore.ts:40`).

### 3.1 · The measurement, and its bound

**0 ties in 20 cases** on this machine (test 5), each case writing an `Author` and an `Intervene` event.
Compare the execution-event log, which measured **4 ties in 40 trials with 2 ordered wrongly** before it
was fixed.

**The bound is stated because it limits the result:** idle database, one process, sequential HTTP
requests. A low rate here is **not** evidence of a low rate under production contention, where
same-millisecond commits become more likely, not less. The number is a floor on the exposure, never a
ceiling. No threshold is asserted in the test, because a threshold would turn an observation into a flaky
gate.

### 3.2 · Why it is structurally rarer here — this outlasts the number

The execution-event defect arose because **several events were appended inside one transaction**, so two
rows shared one `now()` by construction. The authority ledger has three writers and **each appends exactly
one row per transaction** (test 7b asserts the three `authorityEvent.create` sites and the absence of any
`createMany`). A tie therefore needs two *separate* transactions to commit in the same millisecond.

Rarer is not impossible, and the repository's own rule applies: *"nothing fails today" was never the right
test.*

### 3.3 · Blast radius — classified, not assumed

| consumer | exposure |
|---|---|
| `src/domain/caseLifecycle.ts` | **none** — progress is derived from set membership, and `trailOrderCertain` already labels a tie rather than resolving it |
| `firstInterveneEvent` (`authorityGate.ts:88`) | reduces by timestamp; **exact with one `Intervene` row**, which is the normal case (test 7) |
| baseline-ordering trust gate (`auditService.ts`) | reads `firstInterveneEvent`, so it inherits the above; a tie between two `Intervene` rows could shift a gap verdict |
| `enforceSeparation` | **none** — set membership only |
| `isCaseHalted`, `caseIsExcluded` | **none** — existence counts only |

**No monetary surface reads ledger order.** Revenue Returned and Auditable Revenue are computed from the
`Proof` chain, not from this log.

### 3.4 · The recommended approach, design-only

The precedent is written and directly transferable:
`prisma/migrations/20261006090000_execution_event_append_sequence/migration.sql`.

* `ADD COLUMN seq BIGINT` **nullable**, with a sequence `DEFAULT` — so every new row gets an append order
  from the column default, and no code path can append without one.
* **`BIGSERIAL` is the trap and must be refused**: it backfills in physical heap order, committing a
  fabricated chronology to disk.
* **Legacy rows keep `NULL` and are never backfilled.** `NULL` means *appended before an append order was
  recorded* — a different fact from any number.
* Order becomes `at ASC, seq ASC NULLS FIRST, id ASC`, with `at` primary so ordering holds across the
  migration and **every historical derived state stays exactly as it was**.
* A legacy row alone at its timestamp is **certain**, because `at` alone decides it.
* `seq` enters no hash, no API and no DTO.

**Not done here**: the migration is outside this slice's authorisation. Specifications S4–S6 in the test
file carry the assertions.

## 4 · Acceptance criteria — checked

| criterion | verdict |
|---|---|
| Existing audit history remains intact | **met** — both strategies are additive or read-side; append-only triggers on `AuthorityEvent` are untouched |
| Historical approval/revision semantics not silently changed | **met** — Strategy A reinterprets nothing; it reads a *different table* that already carried the distinction |
| Authorization and separation of duties stay enforced | **met, and it is the binding constraint** — §2.1 is why C is rejected and why B must widen `idsFor` in the same change |
| Event ordering provable or explicitly marked unestablished | **met by design** — `NOT_ESTABLISHED` is a reported state, not a default |
| No mutable status cache as an alternative source of truth | **met** — §2.4 condition 3 |

## 5 · Also found, reported not fixed

The `AuthorityEvent` model comment reads `// Author | Approve | Verify | Flag | Halt`
(`prisma/schema.prisma`). The ledger actually carries **eight** tokens: those five plus `Intervene`,
`Exclude` and `PromoteCandidate`. A stale comment on the one table whose vocabulary is the subject of this
review is worth correcting in whichever slice next touches the schema.

## 6 · What remains NOT ESTABLISHED

* The tie rate under real concurrency (§3.1).
* How many historical `Approve` rows in any real deployment are revisions. Strategy A can classify them,
  but this repository holds no production data to count.
* Whether any consumer outside this repository reads `AuthorityEvent.action` and depends on the current
  conflation.
