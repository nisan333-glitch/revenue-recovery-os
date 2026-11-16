# G5 · the settlement ledger · data lineage and what is still missing

**Date:** 2026-11-16 · **Owner-approved: local development and isolated disposable databases only**
**Baseline:** remote `ae9b6b2`, CI #344 6/6 green · **Not pushed, no production migration**

---

## 1 · The one thing G5 changes

Stage 8's pure core already **decided** that a replayed nonce and an already-counted settlement are
refused. It decided it from two lists a caller supplied.

> **That is a read-then-check, and under concurrency it is advisory rather than a control.** Two
> simultaneous approvals citing one nonce both read *"not seen"*, both pass the check, and both
> proceed. The window is between the read and the write, and no amount of care in the decision layer
> can close it.

> **THE CONSTRAINT IS THE CONTROL. THE READ IS A DIAGNOSIS.** `claim()` does not ask permission and
> then act: it attempts the insert, lets the unique indexes decide, and reads back **who won**. A
> refusal is therefore a fact about committed state rather than about a snapshot that may be stale.

Both halves are kept deliberately. The decision names **which** rule failed; the index guarantees it
**held**.

---

## 2 · Data lineage — where every field comes from

| Column | Origin | Never from |
|---|---|---|
| `boundary_id` | the authenticated server context | a request body |
| `claim_ref` | the claim being substantiated | — |
| `settlement_digest` | `sha256(settlementIdentity(fact))`, server-computed | a caller |
| `attestation_nonce` | inside the **signed** payload, read from the verified receipt | a caller's unsigned assertion |
| `key_id` | the register row that verified it | the request |
| `consumed_at`, `seq` | the database | — |

**A digest for uniqueness, not a pseudonym for privacy**, and the distinction is stated rather than
implied. It keeps the external settlement reference out of the table while staying deterministic,
which is all uniqueness needs. It is **not** a keyed pseudonym: a plain digest over a guessable
reference is brute-forceable, so if this value must resist an attacker **holding the database** it
needs the same keyed treatment `sourceRef` gets — a deployment secret and a key-management decision,
not something to invent here.

---

## 3 · The two indexes, and why they are scoped differently

| Index | Scope | Why |
|---|---|---|
| `one_arrival` on `(settlement_digest)` | **global** | the canonical identity already contains the boundary, so a global index **is** per-tenant uniqueness. Adding `boundary_id` would be a second statement of one rule, and two statements can drift |
| `one_use` on `(boundary_id, attestation_nonce)` | **per tenant** | the nonce is a value the external source chose and the boundary sits **beside** it in the signed payload, not inside it. A nonce recurring in another tenant is a *different signature over a different payload*, so refusing it as a replay would report a weak nonce source as an attack on this tenant |

**The asymmetry is the finding.** Scoping both the same way would be wrong in one direction or the
other, and which one depends on whether the tenant is inside the hashed value.

---

## 4 · Two defects in stage 8's own port, fixed here

> **IT WAS CLAIM-BLIND.** `identitiesAlreadySubstantiating(boundaryId)` had no notion of which claim
> was asking, so an **idempotent retry of the very claim that recorded an arrival** would have been
> refused as a double count. The claim reference is now an input and the answer excludes it.

> **IT WAS UNBOUNDED.** Both methods returned a whole tenant's history for the caller to scan with
> `includes()`. The question is never *"give me every nonce you have ever seen"* — it is *"has THIS
> nonce been seen"* — and at any real volume the first shape is a different kind of defect.

`claimRef` is **required** on the gate's input, not optional: an optional field would let an existing
caller keep the claim-blind behaviour by saying nothing, which is how the original defect would have
survived the fix.

---

## 5 · A bug I introduced and caught, because it would have been silent

My first port signature returned **digests** while the pure core compares raw
`settlementIdentity(...)` strings. Type-compatible, and semantically **unable to ever match**.

> **A check that cannot match is worse than no check**, because it reports a rule as enforced while
> passing everything — the same family as a test that passes for a reason other than the one it names.

The port now speaks **identities**; the adapter hashes at the boundary and maps hits **back** to the
caller's own strings. A test asserts the round trip and asserts the answer is **not** the digest.

---

## 6 · The rollback hazard, stated rather than discovered

`settlement-ledger-down.sql` is a clean drop, because this migration adds one new table and alters
nothing. It is also **the most destructive rollback in this design set**:

> Dropping this table does not merely discard history. It **releases every arrival of money to be
> counted again.** The uniqueness it holds *is* the one-arrival-counted-once rule, so the table is not
> a log of the rule's enforcement — it **is** the enforcement.

The append-only triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` for the same reason: deleting one row
would silently free one arrival. **Here immutability is not hygiene, it is the control.**

---

## 7 · The exposure query a compromised key forces

`compromiseAssessment` can say whether **one** attestation falls inside an exposure window.
`consumptionsForKey` says **which arrivals to ask it about**. Without it, revoking a key would be an act
with no way to enumerate what it touched — and K1's fourth requirement, reproducing historical
decisions in light of a revocation, would have no input.

---

## 8 · What is still missing before any of this touches money

| # | Gap | Owner |
|---|---|---|
| **1** | **The external payer reference on the case.** A case holds an NH pseudonym; a bank names the payer in its own terms, and NH must not invent the mapping | a data-source decision |
| **2** | **The PROVEN gate is untouched and unwired.** `claim()` has no production caller: freezing a proof is where an arrival would actually be taken, and that path is not built | authorised slice |
| **3** | **A production migration.** The SQL is in `scripts/migration-design/`, so no deploy applies it | owner |
| **4** | **K5-a / K5-b.** No institution is verified; not one. The four ceremony booleans are **attestations by our operator, not measurements** | relationships, not code |

**Nothing reaches `AUTHORITY_VERIFIED`. No observed amount became Revenue Returned.** The ledger makes
the double-count rule enforceable; it does not make any figure real.
