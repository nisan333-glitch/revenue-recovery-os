# PROVEN gate review and open billing corrections — with an acceptance matrix that separates exposure, correction and proven collection

**Read-only review, 2026-11-08.** Nothing in the product was changed by it: no gate, no predicate, no
monetary calculation, no contract, no version, no frozen artefact. Every finding below is a claim about code
that was read and, where stated, executed.

The question the owner set is the right one, and it is sharper than "is the gate sound?": **the loop promises
*I found it, I fixed it, I returned it*, and a review must be able to say which of those three a PROVEN case
actually establishes.** So the matrix below is organised by leg, not by function.

---

## 1. The three legs, and where each is decided

| Leg | What it claims | Where it is decided | What it reads |
|---|---|---|---|
| **A · Exposure** (Identify) | money appears to be missing | detector → candidate signal `obligationCoverage` | the customer's two extracts, read by the server |
| **B · Correction** (Fix) | something was changed so it stops | `Intervene` authority event + `recoveryReason: "BillingCorrection"` | an operator's action |
| **C · Proven collection** (Prove) | the money arrived | `approve()` → `Collected − Baseline` | `req.collectedMinor`, a locked baseline, evidence records |

The review's central result is that **A and C are gated and B is not** — and that C's bar is chosen by a
request field.

## 2. Leg A — exposure. Gated, and the gate is strong

`provenEligibility` refuses unless the server itself recorded that the claim covers **exactly one**
reconciliation unit, carrying the obligation reference, the expected amount, the billed amount, the
discrepancy and the currency, with the discrepancy **re-derived** (`expected − billed`) rather than trusted
as stamped. Six named refusals, no permissive branch:

`OBLIGATION_COVERAGE_NOT_STATED` · `OBLIGATION_COVERAGE_IS_AGGREGATE` · `OBLIGATION_FACTS_INCOMPLETE` ·
`OBLIGATION_FACTS_INCONSISTENT` · `ABSORBED_OBSERVATION_RECORDED` · `ABSORPTION_NOT_CHECKED`

Two properties are worth recording as sound rather than merely present:

* **Every input is read from the record, never from the request.** `caseProvenEligibility` takes a case id
  and nothing else; coverage comes from the candidate signal the detector wrote and absorption from
  `agent_task_events`, append-only by database trigger. A beneficiary has no field by which to assert
  either. This is the standing architecture test answered correctly.
* **`ABSORPTION_NOT_CHECKED` refuses.** Reading silence as "no absorption" would let a surface that never
  ran the query mint a proof. *Not checked is not none*, with money on the other side of it.

**Verdict on leg A: sound.** The gate is placed before the duplicate-chain check and before any write, so an
ineligible claim is refused rather than merely left uncounted.

## 3. Leg B — correction. **NOT a conjunct of PROVEN. This is finding G1.**

A case can reach PROVEN **with no `Intervene` event ever recorded.** The intervention is loaded
(`firstInterveneEvent`) and used for exactly one purpose: the temporal ordering of the baseline lock. And
that check passes on absence —

```ts
if (ctx.interventionAt && b.lockedAt > ctx.interventionAt) { … }   // src/domain/baseline.ts:94
```

— so `interventionAt === null` skips it entirely. The module says so itself, at `proofService.ts:13`:
*"unknown facts (e.g. no Intervene ever recorded) do NOT block."*

> **G1.** Nothing in the approval path requires that a correction was proposed, executed, or even attempted.
> The "Fix" leg of *Identify → Fix → Prove* has **no mechanism behind it at approval time**. It is visible in
> the case history when it happened and simply absent when it did not.

**And `BillingCorrection` is a reason, not an executed action.** `reasonScopeViolation` checks that the
reason names a mechanism the case's recorded `recoveryType` actually had — a real and useful control, because
a proof is immutable and a wrong reason could never be corrected. But it establishes that the claim is
*about* a billing correction, never that a billing correction *occurred*. The financial trace agrees and
labels it: `PROPOSED_CORRECTION` and `CORRECTION_RECORD` both carry `inputClass: "SIMULATED"`.

**This is the correction conjunct flagged at `208c076` and still unimplemented.** It is reported, not
patched: making an `Intervene` event mandatory for approval would change which historical cases could be
approved and what the gate means, which is a governance decision with an owner.

## 4. Leg C — proven collection. Gated **only at the Auditable tier**, and the tier is a request field

`req.collectedMinor` is a **request input**. What constrains it:

| Condition | Enforced below the Auditable threshold | Enforced at or above it |
|---|---|---|
| baseline is an established, **locked** snapshot for this case | ✅ | ✅ |
| baseline **amount** read from the snapshot, never the request | ✅ | ✅ |
| currency matches the locked baseline | ✅ | ✅ |
| every evidence id exists **and is case-scoped** | ✅ | ✅ |
| baseline not locked after intervention / outcome (when known) | ✅ | ✅ |
| separation of duties (author ≠ approver) | ✅ | ✅ |
| `excludedRecoveryMinor` + statement mandatory | ✅ | ✅ |
| at least one **independent** evidence reference | ❌ | ✅ |
| at least one **outcome-role** evidence reference | ❌ | ✅ |
| outcome evidence **authenticated** and not beneficiary-controlled | ❌ | ✅ |
| outcome evidence currency matches the proof | ❌ | ✅ |
| **outcome evidence sum ≥ `collectedMinor`** | ❌ | ✅ |

The tier is selected by one line:

```ts
const auditableTierClaimed = req.confidenceUsed >= CURRENT_POLICY.proofThreshold;   // :298
```

and `confidenceUsed` is a plain field on `ApproveProofRequest`. **Nothing derives it from the evidence or
from the record.**

> **G2.** A sub-threshold proof mints **Revenue Returned** (`Collected − Baseline`) from a **stated**
> collected amount, with evidence that need not be independent, need not be outcome-role, and need not sum
> to the amount claimed. Which bar applies is chosen by the submitter, by declaring a lower confidence.

**How far this goes, stated precisely rather than dramatically.** This is a *weakened* control, not an absent
one. `enforceSeparation` guarantees the approver is not the author, so no single person both claims and
approves — Trust Invariant rule 8 holds. And the constitution genuinely defines **Auditable** as the
CFO-grade *subset* of Returned, so a weaker Returned tier is by design. The finding is narrower and still
real:

> The constitution's rule 10 is **"Claimed revenue is not proven revenue."** At the sub-threshold tier,
> `collectedMinor` is claimed, and it becomes Revenue Returned. A number that selects its own evidence bar
> is the beneficiary-determines-the-number shape, one tier down.

Reported, not patched. Two remedies exist and they are not equivalent — one is a governance decision:
**(i)** derive `confidenceUsed` from the record instead of accepting it, or **(ii)** require the
outcome-evidence sum at **every** tier and let confidence affect only the Auditable label. (ii) is the
smaller change and the stronger rule; (i) is the more complete one. Either changes what historical and future
approvals are permitted, so neither is mine to take.

## 5. Open billing corrections

These are **observation-side** corrections — the at-risk figure changing between observations — and not
executed billing changes. `summariseCorrections` derives four states from append order:

| State | Money reported | Open question |
|---|---|---|
| `SINGLE_OBSERVATION` | the one figure | — |
| `REPEATED_IDENTICAL_OBSERVATION` | the figure, delta 0 | — |
| **`CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED`** | stored, latest and delta all reported; **no authoritative amount** | **S-DUP-4: which statement wins. Owner decision, still open.** |
| **`ORDER_NOT_ESTABLISHABLE`** | **every monetary field `null`** | two observations of one identity share an append sequence |

Both open states are **correctly open**. The precedence state deliberately reports all the figures and names
none of them authoritative, because no approved rule says which statement wins; and `ORDER_NOT_ESTABLISHABLE`
returns `null` rather than `0`, because a zero would assert the store holds nothing. The second is not
hypothetical: one task result can carry several signals, which all inherit that event's sequence, so a tie
is reachable — and it is checked **before** anything is derived from the order.

**Still awaiting the owner, unchanged:** the S-DUP-4 precedence rule; S-DUP-2 Option B (per-unit candidates);
and whether a detector should refuse a signal whose at-risk figure contradicts its own coverage.

## 6. The acceptance matrix

What a reviewer must be able to assert, per leg, before a PROVEN case is quotable as returned money.

| # | Acceptance criterion | Leg | Today |
|---|---|---|---|
| 1 | The claim covers exactly one reconciliation unit, stated by the server | A | **ENFORCED** |
| 2 | Expected, billed, discrepancy and currency all present, discrepancy re-derived | A | **ENFORCED** |
| 3 | No second observation was absorbed, and the absorption question was actually asked | A | **ENFORCED** |
| 4 | The exposure figure is OBSERVED and never presented as money | A | **ENFORCED** |
| 5 | A correction was proposed against this obligation | B | **NOT ENFORCED (G1)** |
| 6 | A correction was executed, with a record of what changed | B | **NOT ENFORCED — `SIMULATED` (G1)** |
| 7 | The recovery reason names a mechanism the case actually had | B | **ENFORCED** (`reasonScopeViolation`) |
| 8 | The baseline was locked before the intervention and before the outcome | C | **ENFORCED when both are known; passes on absence** |
| 9 | The baseline amount comes from the locked snapshot, never the request | C | **ENFORCED** |
| 10 | Collected money is substantiated by outcome-role evidence summing to the claim | C | **Auditable tier only (G2)** |
| 11 | That evidence is authenticated, independent and not beneficiary-controlled | C | **Auditable tier only (G2)** |
| 12 | Which evidence bar applies is not chosen by the submitter | C | **NOT ENFORCED (G2)** |
| 13 | Excluded recovery is mandatory and never defaults to zero | C | **ENFORCED** |
| 14 | Author ≠ approver | C | **ENFORCED** (`enforceSeparation`) |
| 15 | One counted proof chain per claim | C | **ENFORCED** (`chainRootExists`) |
| 16 | A revision creates a new linked proof and never overwrites | C | **ENFORCED** (chain root `previousProofId === null`) |
| 17 | Revenue Returned is withheld absent independent attestation | C | **ENFORCED in the trace** — `REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED` is pushed first and always |

**Eleven enforced, one partial, five not.** The five are two findings, not five defects: G1 covers 5 and 6,
G2 covers 10, 11 and 12.

## 7. What this means for a provable financial pilot

The owner's framing — *a provable financial pilot, not just green CI* — is answered directly:

1. **Exposure is trustworthy today.** Leg A refuses more than it admits, every input comes from the record,
   and nothing a caller sends can widen it.
2. **The "Fix" leg is a label, not a control.** Until G1 is closed, a PROVEN case asserts that money arrived
   and asserts **nothing** about a correction having been made. A pilot report must not say *"we fixed it"*
   on the strength of a PROVEN status.
3. **Only the Auditable tier is CFO-grade, and that was always the design** — but the tier is currently
   self-selected, so *which* claims are CFO-grade is not a property of the evidence. Until G2 is closed, the
   only figure safe to quote to a CFO is the Auditable subset, and it must be quoted as the subset.
4. **`ATTESTED` is unreachable in this build**, and the financial trace says so unconditionally rather than
   on a condition that might not fire.

**Recommended order, and it is a dependency order rather than a preference:** G2 remedy (ii) first — it is
the smaller change and it closes three matrix rows; then G1, which needs the correction-execution record to
exist before it can be required; then S-DUP-4, whose answer the correction ledger is already shaped to
accept.

**No observed amount became Revenue Returned by this review**, no synthetic figure is presented as collected
revenue, and nothing here was changed in the product.

---

## 8. The two findings are MEASURED, not argued

§3 and §4 were reached by reading code. That is an argument, and this repository's standard is measurement,
so both were then executed against a real database through the real governed path — real candidate, real
review, real promotion, real baseline, real evidence ingestion, real `POST /proofs`:
**`server/services/provenGateGaps.postgres.test.ts`**, 3 passed.

| | What was run | What happened |
|---|---|---|
| **G1** | A single-obligation case taken to approval with **no `Intervene` event ever recorded** — asserted absent by reading `authority_events` directly, not assumed | **`201`**, and `revenueReturned.minor = 60_000` minted, while `recoveryReason` says `BillingCorrection` |
| **G2** | The **same** supporting-role evidence carrying **no amount**, submitted twice: once at `confidenceUsed = 80`, once at `79` | **`403`** at 80 (*independent / outcome-role*), **`201`** at 79 with `revenueReturned.minor = 60_000` |
| **CONTROL** | The same payload on a case whose candidate states **no coverage** | **`403 OBLIGATION_COVERAGE_NOT_STATED`** |

The control is the part that makes the other two mean anything: **leg A really is refusing**, so the two
acceptances are not an observation about a gate that admits everything. *A test that cannot fail is not a
control.*

**These tests document the holes and deliberately do not close them.** Each asserts the **current**
behaviour, so the day a gap is closed the test fails and whoever closed it must update §3 or §4 in the same
change. The alternative — a test that pretended the gap was caught — would be worse than no test, which is
the same choice already made for the attestation hole.

One number is worth stating plainly, because it is the whole finding in one line:

> **One point lower on a field the submitter supplies, and $600.00 of Revenue Returned is minted from
> evidence that carries no amount at all.** Every figure here is synthetic, on a `TEST-` boundary, and
> no observed amount became Revenue Returned.
