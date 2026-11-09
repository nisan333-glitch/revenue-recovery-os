# Correction-type mapping — decision record V1

**Date:** 2026-11-09 · **Status:** implemented, with one refusal deliberately NOT enforced ·
**Scope:** `src/domain/correctionMapping.ts`, wired in `server/services/proofService.ts` `approve()`

---

## 1. The gap

G1 (verified executed correction) requires a source-attested executed-correction record before a case
may reach PROVEN. It establishes **that a correction happened**. It did not establish that the
correction has anything to do with **the recovery being claimed**.

The only correction evidence types that exist are billing ones. So before this slice a
`UsageActivation` recovery could reach PROVEN evidenced by a **corrective invoice**: an activation was
missed, nothing was mis-billed, and a billing artefact stood in as proof that the activation happened.
The reason and its evidence disagreed — and **a proof is immutable**, so that disagreement could never
be corrected afterwards. It would have had to be superseded by a linked revision, which is a worse
outcome than refusing the approval.

This is the constitution's rule 4 — *the proof captures the exact … evidence references and
calculation used at the time of approval* — meeting the fact that an evidence reference which attests a
different mechanism is not evidence of this one.

## 2. Everything is inventoried from the codebase. No category is invented.

The order said *"Do not invent categories."* Both axes are read from their existing declarations:

| Axis | Source of truth | Count |
|---|---|---|
| Recovery reasons | `RECOVERY_REASONS` in `src/domain/reasons.ts` | 8 |
| Correction evidence types | `CORRECTION_EVIDENCE_TYPES` in `server/domain/evidenceRole.ts` | 2, both `sourceSystem: billing` |

A test asserts the inventory matches `RECOVERY_REASONS` **in both directions** — no reason missing, no
reason added — so a ninth reason declared upstream fails the build rather than silently defaulting.

## 3. The mapping, per combination

`corrective_invoice_issued` and `billing_corrected` are the two declared correction types.

| Recovery reason | Permitted correction types | Verdict on a billing correction |
|---|---|---|
| `BillingCorrection` | both | **permitted** — the mechanism *is* a billing change, and both types are the billing system's own statement that it made one |
| `OnboardingReboot` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `MilestoneNudge` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `EnablementSession` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `CSMOutreach` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `ExecBusinessReview` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `RenewalOutreach` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |
| `UsageActivation` | *none declared* | refused `CORRECTION_CHANNEL_NOT_DECLARED` |

**`permitted: []` means NO CHANNEL EXISTS — it does not mean anything goes.** Each empty entry carries a
`why` string recording the reason, so a reader is told the list is empty **by decision** rather than
inferring that nobody filled it in. A corrective invoice says the billing changed; it says nothing
whatsoever about an onboarding being restarted, a milestone being reached, or a usage flag being
switched on.

## 4. Fail closed in three distinct ways

The three absences are different situations and **each keeps its own name**, the same reason
`leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart:

| Code | Situation | Remedy it points at |
|---|---|---|
| `RECOVERY_REASON_UNKNOWN` | the reason is not in the vocabulary at all | fix the caller — it names no mechanism |
| `CORRECTION_CHANNEL_NOT_DECLARED` | the reason is declared and its mechanism has no attesting source | **a governance decision**, not a different upload |
| `CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON` | the channel exists and the correction supplied is not in it | supply the correction the mechanism actually produces |

Collapsing them would hide *which half is missing* — the only part of the answer that says what to go
and get.

## 5. It cannot be bypassed by the request

The **reason** is read from the approval request. It has to be: it is the claim being made.
The **correction type** is not. It is the `evidenceType` of the correction-role record `executedCorrection`
selected from the case's ingested evidence — a role the server derived from `(sourceSystem, evidenceType)`
and whose record the source signed. A caller cannot supply a correction type, cannot set a confidence
that changes which mapping applies, and cannot label a record into a different channel.

A structural test asserts `proofService.ts` contains `correctionMapping(req.recoveryReason`,
`chosenCorrection?.evidenceType`, and **not** `req.correctionType`.

## 6. The governance decision: one refusal is reported and NOT enforced

`BLOCKING_MAPPING_CODES` declares which refusals block an approval. Two do; one does not.

**Blocking**, because each is decidable from the record with no decision outstanding:
`RECOVERY_REASON_UNKNOWN` and `CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON`.

**Reported and not blocking:** `CORRECTION_CHANNEL_NOT_DECLARED`. Enforcing it would make PROVEN
unreachable for every mechanism except a billing correction.

**This was measured, not estimated — and re-measured on the current tree rather than quoted from an
earlier report.** Adding `CORRECTION_CHANNEL_NOT_DECLARED` to `BLOCKING_MAPPING_CODES` and running the
ep2 suite gives **41 failed / 905 passed / 6 skipped (952)**, against **946 passed / 6 skipped** without
it. 905 + 41 = 946 exactly, so **no test failed for an unrelated reason and none newly passed** — the
mutation's whole effect is those 41.

The single-cause claim is stated at the strength of the evidence and no higher. Every one of the 41 is a
**403 at proof approval**; where vitest prints the refusal body it carries
`CORRECTION_CHANNEL_NOT_DECLARED` (4 occurrences, every one `UsageActivation`), and **no other mapping
code appears anywhere in the output** (0 occurrences of either). The remaining failures are truncated by
vitest to a bare `expected 201, received 403`, so for those the code is inferred from the status and the
exact-arithmetic identity above rather than read directly. That is strong evidence of one cause; it is
not a per-test reading of 41 refusal bodies, and this record does not claim to be one.

That is not a defect to patch. It is G1's *universal* correction requirement meeting the fact that **no
source attests** an onboarding restart, a milestone, an enablement session, an outreach, a review or a
usage activation. Enforcing it here would take the governance decision **by implementation**; permitting
it silently would let a billing artefact stand in as proof of an activation. So it is surfaced, and the
decision is put to its owner:

> **OPEN, OWNER: the product owner.** Declare a correction channel for the seven non-billing
> mechanisms — naming for each which source system may attest it — or accept that PROVEN is reachable
> only for `BillingCorrection`. Until one or the other, the refusal is computed and recorded and does
> not block.

The split is declared in a **named exported constant** rather than buried in the service, so moving it
is a visible change to that constant and not an edit inside a conditional.

## 7. `causationEstablished` is unchanged

The order required: *preserve `causationEstablished = false` unless a separately approved, defensible
causality standard exists.* No such standard was approved, so **nothing here touches it.** This mapping
answers a narrower question — *does the correction attest the mechanism the reason names?* — which is
**compatibility, not causation**. A permitted mapping establishes that the evidence is about the right
mechanism; it establishes nothing about whether the correction *caused* the money to arrive. The literal
`false` type and its device are untouched.

## 8. Honest limit, recorded in the test rather than in prose

`CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON` is **unreachable through the real approval path today**:
the only reason with a channel is `BillingCorrection`, the only correction types that exist are the two
its channel permits, and `executedCorrection` selects only correction-role records. So no behavioural
test can reach the blocking branch from `approve()`.

This was found by mutation, not by reasoning: **mutation Q7** removed the mapping check from `approve()`
entirely and **survived** every behavioural test. The fix was not to weaken the claim but to add the
structural wiring guard in §5 — Q7 is now caught. A test states this limit explicitly, so a reader does
not credit the pure unit tests with proving the wiring.

> *A test that cannot fail is not a control.* The pure tests prove the rule; the structural test proves
> it is wired; neither alone would have caught Q7.

## 9. Verification

| Item | Result |
|---|---|
| `src/domain/correctionMapping.test.ts` | 13 passed |
| Inventory matches `RECOVERY_REASONS` both directions | asserted |
| All 7 unsupported reasons | asserted individually |
| Mutation Q7 (check removed from `approve()`) | **caught** by the structural guard |
| Cost of enforcing the governance code | re-measured on this tree: 41 failed / 905 passed vs 946 passed; 905+41=946 |

No version constant, contract, schema, migration or frozen artefact moved. `prisma/schema.prisma` is
untouched. **No observed amount became Revenue Returned.**
