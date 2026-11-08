# S-DUP-2 and S-DUP-4 — exact semantics, evaluated against the identity invariants

**Status:** evaluation and specification. **Neither is implemented**, deliberately, and §1 and §2 each end with
the one fact that is missing and who owns it. What *was* implemented in this slice is the third and fourth
parts of the same instruction — obligation ambiguity refusing PROVEN, and a detector whose at-risk figure
contradicts its own coverage being refused financial recognition — and those are in §3.

The instruction's own constraint is the reason this document exists rather than a commit: *"Do not implement
an undefined or ambiguous option without documenting its exact semantics."*

---

## 1. S-DUP-2 · Option B, per-unit candidates

### 1.1 What Option B is, stated exactly

Today one candidate is created per **account** per recovery type:

```
candidateId = digest([boundaryId, recoveryType, sourceRef])        sourceRef = account pseudonym
```

Option B creates one candidate per **reconciliation unit**:

```
candidateId = digest([boundaryId, recoveryType, sourceRef, obligationRef])
```

So two under-billed obligations of one customer become two candidates, two reviews and two Recovery Cases,
each with its own `SINGLE_OBLIGATION` coverage and its own proof chain.

### 1.2 Evaluated against the identity invariants

| Invariant | Under Option B |
|---|---|
| Identity is derived, never supplied | **Holds.** `obligationRef` is a server-computed pseudonym under a deployment key; the detector computes it from the extracts, a caller cannot assert it. |
| One counted proof chain per claim | **Holds and improves.** Each unit gets its own chain, so two obligations can no longer share one. |
| `sourceRef` never a raw identifier | **Holds.** Both components are `hmac-sha256:` pseudonyms. |
| Dedupe key stability across re-runs | **Holds for a stable obligation reference and FAILS without one** — see 1.4. |
| Absorption disclosure stays meaningful | **Changes meaning.** `admittedCount >= 1 AND createdCount = 0` currently means *a second observation of this account was folded in*. Per-unit, it would mean *a second observation of this obligation* — a strictly narrower and more useful claim, but **the same metadata would then mean two different things depending on when it was written**, and nothing on the row says which regime produced it. |

### 1.3 What it fixes, measured rather than asserted

The account-level merge is already measured: two obligations of one customer collapse into one candidate and
one case, the survivor carries the **first** amount, and the absorbed money reaches no candidate, no case and
no figure. Option B removes that by construction. It also removes the renewal collision, where two obligations
under one `subscription_id` collide on the cycle key and `dedupeCollisions` then excludes **both**, taking a
paying customer out of the measured population.

### 1.4 THE MISSING FACT, and it is the same one as always

`OBLIGATION_IDENTITY_FIELDS = []`. There is no contract field carrying a stable, cross-system obligation
identity, so `obligationRef` is a pseudonym of whatever the detector could derive from one reading of the
extracts. A derived reference is stable **only while the derivation inputs are stable**: a billing migration,
a re-key, a consolidation or a corrected due date changes it, and every affected candidate becomes a NEW
identity. The consequence is not cosmetic — it is a **duplicate case for one real leak**, which is the exact
failure the dedupe key exists to prevent.

And the prerequisite is a **primary key**, not a contract field.
`PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])` with `sourceRef` account-grained,
so the table cannot hold obligation-grained rows whatever the contract declares. **The migration comes first;
the field buys nothing before it.**

> **Verdict: Option B is the right shape and is NOT implementable today.** Its semantics are now exact and
> its two prerequisites are named — the attribution primary key, then a contract-level obligation identity
> under the `2.1.0` MINOR already specified. Implementing it on a derived reference would trade a known
> under-count for an unknown over-count, and an over-count is the worse direction: it is money the product
> would claim twice.

---

## 2. S-DUP-4 · deterministic precedence, from evidence rather than arrival order

### 2.1 The instruction, and why the current state does not satisfy it

> *Define and test deterministic precedence based on authoritative billing evidence, not event arrival order.*

Today, when one identity carries several observations with different at-risk amounts, the state is
`CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED`: every amount is reported, **none** is named authoritative, and
`storedMinor` is the first observation's figure. That is honest and it is *not* precedence — and the one
ordering the data does carry is `event_sequence`, which **is** arrival order.

### 2.2 The rule, stated exactly

> **An observed at-risk amount becomes AUTHORITATIVE only when an authoritative billing record corroborates
> it.** For one identity: take the set of distinct observed at-risk amounts; take the authoritative billing
> figures recorded for that identity's case from source-attested records. If **exactly one** observed amount
> equals a corroborating figure, that amount is authoritative. If none does, or several do, the unit stays
> **UNDECIDED** and every amount is still reported.

Deterministic, independent of order, and fail-closed. Explicitly excluded as a basis, each for a stated
reason: **arrival order** (the thing forbidden), **recency** (recency is arrival order wearing a date),
**magnitude** (largest-wins points the incentive at the failure), **row count**, and **a stable tie-break**
— *determinism is necessary and is not evidence*, the same correction already recorded against breaking an
append-only log's ties with a random id.

### 2.3 Two blockers, both real, and the second is a governance decision

**Blocker 1 · the corroborating fact is not carried where the rule runs.** `ObservedAmount` holds
`eventSequence`, `amountAtRiskMinor`, `currency`, `obligationRef` and `obligationGrained` — no dataset
reference, no execution id, no billing-evidence link. It is reachable by a join (identity → `RecoveryCaseRecord`
by `(boundaryId, recoveryType, sourceRef)`, then its evidence), and `caseProvenGate` already performs exactly
that resolution. But the **read surface deliberately strips the identity** — *"the REFERENCE itself is
deliberately absent"* — so the join cannot happen there without breaking its privacy scoping. The clean
placement is in `summariseCorrections`, which still sees the identity, with only the **verdict** flowing to
the view. That is a design change, not a wiring change.

**Blocker 2 · which billing figure corroborates.** A corrective invoice RAISED and an amount COLLECTED are
different facts and can differ — a partial collection is normal. Precedence decided by the wrong one would be
precedence decided by an unrelated number. The candidates:

| Candidate | For | Against |
|---|---|---|
| Corrective invoice **raised** | It is raised *for* the shortfall, so it is the closest statement of what was owed | A corrective invoice can itself be wrong, and it is raised by the party acting on our finding |
| Amount **collected** | Strongest evidence — the money moved | Under-collection is normal, so a partial payment would make the smaller observation authoritative and silently shrink exposure |
| **Both, and require agreement** | Fail-closed, and a disagreement is itself a finding | Refuses more units than either alone |

> **Recommended: both, requiring agreement** — a unit is decided only where raised and collected agree, and a
> disagreement is reported as its own state rather than resolved. It refuses the most and it is the only one
> of the three that cannot be moved by a partial payment. **This is the owner's call and is not taken here.**

> **Verdict: the rule is specified and NOT implemented.** Implementing it against the wrong corroborating
> figure would replace an honest `UNDECIDED` with a confident wrong number, which is strictly worse than the
> gap it closes.

---

## 3. What this slice DID implement, from the same instruction

### 3.1 Obligation ambiguity refuses PROVEN — already enforced, now asserted

`provenEligibility` refuses on five ambiguity grounds, every input read from the record and none assertable
by a request: coverage not stated, coverage is an account aggregate, the four facts incomplete, the facts not
self-consistent, and an absorbed observation recorded — plus `ABSORPTION_NOT_CHECKED`, because *an unchecked
absorption is not an absence*.

### 3.2 A detector that contradicts its own coverage is refused the MONEY — new

`assertCandidateSignal` re-derives `residualMinor` from expected − billed and refuses an inconsistent triple.
It has never compared the detector's **at-risk** figure against it. A signal could state $599.99 at risk while
its declared obligation showed a $600.00 discrepancy, and the proof was minted over the disagreement.

New refusal: **`AT_RISK_CONTRADICTS_COVERAGE`**.

> **It refuses the money, not the finding.** The exposure stays visible and reportable. Rejecting the signal
> would let a beneficiary shrink measured exposure by making a detector disagree with itself — the same
> reason row rejection is refused for a defect in an optional column. What is refused is *financial
> recognition*, which is the instruction's own wording.

**Null is not agreement.** A signal with no at-risk figure cannot contradict its coverage and is not refused
on this ground — and is not evidence that the two agree either. The two states stay distinguishable rather
than collapsing into a default.

Proved at both levels: six pure falsifiers including the ordering against the more fundamental refusals, and
one Postgres test driving the real governed path — candidate created with a one-cent disagreement, promoted,
authored, baselined, corrected, evidenced, and the approval refused `403 AT_RISK_CONTRADICTS_COVERAGE` with
**zero proofs written**, while the case and its exposure remain.

---

## 4. Preserved invariants

Dedupe keys, digests, the pseudonymisation scheme, `OBLIGATION_IDENTITY_FIELDS = []`, contract **2.0.0**, both
extracts, every other `*_VERSION`/`*_SCHEME`, and every frozen artefact are **unmoved**. `ROLE_MAP_VERSION`
moved for the G1 correction role, which is a separate decision recorded with its own migration. No observed
amount became Revenue Returned.
