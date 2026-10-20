# Obligation identity · contract-change proposal V1

**Status: PROPOSAL. Nothing is declared, nothing is implemented, no constant moves.**
`OBLIGATION_IDENTITY_FIELDS` is still `[]`, `PILOT_DATA_CONTRACT_VERSION` is still `2.0.0`, and
`leakInstanceIdentityStatus()` still refuses. This document is the change request, its migration and its
compatibility analysis — written **before** any code, as the constitution requires for a core-definition
change.

Written 2026-10-20, against `dfbad96`.

---

## 1 · What is blocked, and exactly where

`deriveStagedAttributions` (`server/services/governedSignalStaging.ts:186`) computes per-entity
attribution, checks that it reconciles to the assessment total — **both live and both passing** — and then
refuses:

```ts
const identity = leakInstanceIdentityStatus();
if (!identity.establishable) return blocked("leak_instance_identity_unavailable", identity.detail);
```

That is the only thing standing between a governed assessment finding and the Recovery Case lane this
slice just built end to end. Everything downstream of it — candidate, review, promotion, case, authority
trail, evidence, proof — exists, is governed, and is now walked in a real browser on a real detector
finding (`e2e/journey.mjs` §13). What does **not** exist is an entry into it **from the assessment
path**, because no declared field can say *which obligation* a finding is about.

**The refusal is correct and must not be routed around.** A per-execution key
`(boundary, execution, entity)` would unblock it today and would be wrong: the execution id is unique per
run, so re-assessing the same extract would open a **second case for one real-world leak** — which is the
duplicate the `sourceCandidateId` UNIQUE constraint exists to prevent, re-created one layer up.

## 2 · The minimum change

**One OPTIONAL field.** `obligation_ref`.

| | |
|---|---|
| name | `obligation_ref` |
| requirement | **`optional`** — never `recommended`, see §6 |
| kind | `identifier` |
| piiClass | `identifier_pseudonymous` |
| typicalSourceSystem | `billing` |
| since | the minor this lands in |
| synonyms | **none** |
| description | The billing system's own identifier for the **obligation** this row observes — not the account, not the subscription, and not the invoice line. Stable across a reschedule of its own due date. |

That is the whole contract change. Everything else below is about what must be true for it to mean
anything.

### Why one field and not a composite

`CandidateLeakInstanceIdentity` already exists and already names four components:
`(boundaryId, recoveryType, sourceNamespaceId, obligationRef)`. Three of the four are **already
available**: the boundary comes from the authenticated server context, the recovery type is a `PLAYBOOK`
key, and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` has been `true` since Step 5 built the governed
namespace registry, the per-boundary permitted set and the per-dataset binding. The canonical encoding,
the component validation and the refusal vocabulary are written and tested. **`obligationRef` is the only
component with no source.**

## 3 · The matching rule, stated exactly

Already implemented in `canonicalLeakInstanceKey`, unchanged by this proposal:

```
nh-leak-instance-v1 ‖ NUL ‖ boundaryId ‖ NUL ‖ recoveryType ‖ NUL ‖ sourceNamespaceId ‖ NUL ‖ obligationRef
```

Four components, **no fallback of any kind**, injective because every component rejects NUL. Two findings
are the same leak instance exactly when all four agree, byte for byte.

**Zero synonyms, no case folding, no Unicode normalisation.** This survives the 2026-10-05 S1 audit
unchanged and is binding: `OBLIG-1` and `oblig-1` are two identities, and `café` in NFC and in NFD are two
identities. Any folding we performed would be **NH authoring the identity it is supposed to be reading** —
the same rule that forbids us inferring a cadence, a component identity or a pairing mechanism.

**Not in the identity, each by decision:** `entity_id` (an account merge or CRM re-key must not split one
obligation into two candidates), the dataset fingerprint, `datasetId`, the submission identity, the
execution id, the AssessmentPolicy and its `asOf`, the amount and the due date. The first group are
properties of a *reading*; the last two are mutable for one obligation, and a correction and a reschedule
are precisely the events identity must survive.

## 4 · Ambiguity, stated as refusals

`LeakInstanceIdentityRefusal` already enumerates them. Under this proposal three become **reachable**:

| refusal | when | behaviour |
|---|---|---|
| `leak_instance_identity_incomplete` | some accepted cycles carry a reference and others do not | the **whole** submission is refused for candidate staging |
| `leak_instance_identity_malformed` | a reference is present but is not an encodable component (empty, padded, control characters, > 256 bytes) | refused |
| `leak_instance_identity_ambiguous` | one identity is claimed by more than one accepted cycle | refused — two obligations would merge into one candidate |

**Refused whole, never partially.** A submission where 90 % of rows carry a reference does not stage 90 %
of its candidates: the 10 % would silently not become cases, and a leak nobody can see is worse than a
lane that is honestly shut. This mirrors `REFUSED_AMBIGUOUS_LIVE_LINES` in the reconciliation core and
`NH-EX-2016` in the expectation validator: **absent an authoritative fact, refuse — never arbitrate.**

**And the completeness gate is satisfiable by pre-aggregating.** The S1 audit established this and it is
not fixed by this proposal: an exporter facing `leak_instance_identity_incomplete` can make the gate pass
by collapsing rows until every surviving row has a reference. *A gate that points the incentive at the
failure is worse than no gate*, so this is recorded as a **known, unclosed weakness of the completeness
check**, mitigated only by the human review gate between a candidate and a case. It is not a reason to
drop the check; it is a reason not to claim the check is a defence.

## 5 · Provenance requirements

**The reference is namespaced, and the namespace is governed.** `sourceNamespaceId` is resolved from the
registered `SourceNamespace`, the per-boundary permitted set and the per-dataset binding — a steward
activates it, and the uploader's declared `provenance.sourceSystems.billing` is **cross-checked against
it rather than believed**. Without that, `obligation_ref` would be a key the beneficiary chooses the
meaning of: `INV-1` in two billing systems is two obligations, and nothing in the string says which.

**The reference is never promoted to evidence.** It says *which* obligation; it says nothing about
whether money is owed, was billed, or was collected. Nothing in this proposal changes what counts as
Revenue Returned or Auditable Revenue, and nothing in it lets an observed amount become either.

**The grain question stays open.** The S1 audit's conclusion survives and is restated here so this
proposal cannot be read as closing it: a generic invoice-level reference is **not sufficient for
cross-system reconciliation**, because the two sides identify at different grains. This field keys a
leak instance *within one source namespace* — it is not the reconciliation key, and the
`docs/SYNTHETIC_RECONCILIATION_V1.md` grain decision is untouched.

**And the evidence available to validate it is biased.** References can only be observed on rows that
survive upstream rejection — overwhelmingly single-invoice subscriptions — so consolidation, splitting,
re-keying, merges and migrations are **discarded before any reference can be read**. An identity model
validated on that evidence is validated on the cases it cannot fail. Any pilot measurement of this field
must say so.

## 6 · Compatibility · and a correction to my own earlier assumption

### It is a MINOR, and the reason is not the one I expected

The plan for this slice said a new identity component "enters `pds`, so it re-identifies submissions →
MAJOR, with the two-major window as the compatibility path." **That is wrong, and reading
`deriveIdempotencyKey` is what shows it.** The submission identity is derived over

```
IDEMPOTENCY_DERIVATION ‖ id@major-N ‖ boundaryId ‖ datasetFingerprint ‖ dateLocale ‖ amountFormat ‖ currency ‖ asOf ‖ stallThresholdDays
```

and `datasetFingerprint = sha256(csvText)`. A customer who adds a column changes their bytes, so the
fingerprint changes, so the submission identity changes — **automatically, with no change to the
derivation at all.** `obligation_ref` is not a parameter of the reading; it is part of the data. Nothing
is added to `pds`, no historical submission is re-identified, no migration of stored keys is needed, and
the §10 two-major window is **not** required for this change.

Against `COMPATIBILITY_POLICY` it is squarely `minor`: *"Add an optional or recommended field"* and
*"Relax a rule so that a dataset valid under X.Y is still valid under X.(Y+1)."* Today a customer who
includes an `obligation_ref` column is **rejected** with `UNDECLARED_COLUMN`; declaring the field accepts
a file that was previously refused, which is a relaxation in the permitted direction.

**Proposed: `2.0.0` → `2.1.0`.**

### Why OPTIONAL and never RECOMMENDED

`recommended` is not a stronger hint — it is a different mechanism. A recommended column absent from an
export raises `MISSING_RECOMMENDED_COLUMN`, and the admission gate counts those against
`policy.maxMissingRecommendedColumns`. That threshold sits on an **already-registered, frozen admission
policy** whose value was chosen when the recommended set was smaller. Adding to the set can therefore push
an existing export over a bar nobody moved — a dataset valid under 2.0 newly rejected under 2.1, which
`COMPATIBILITY_POLICY` itself calls **major**. Declaring it `recommended` would make a minor change behave
like a breaking one while being labelled minor, which is worse than either.

This is governed issue #1 and the S1 audit's fourth surviving decision, reached independently four days
apart. It is settled.

### Capability gating per detector, never global rejection

A missing `obligation_ref` **rejects no row and no dataset**. It closes exactly one capability —
candidate-capable staging — and leaves ordinary assessment, Detector #1 and Detector #2 measuring real
money exactly as they do today. This follows the existing pattern deliberately:
`leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are *"separately named because
collapsing them would let closing either look like closing both."*

## 7 · Migration

**Nothing to migrate.** No stored `pds`, no stored admission decision, no stored execution, no stored
finding, no stored case and no stored proof changes meaning or identity. The field is optional, so every
export already accepted stays accepted and keeps its identity; an export that adds the column is a new
submission because its bytes are new, which is already the rule.

The only sequencing requirement is §8.

## 8 · The order of work, and the rule that governs it

**Binding, from the 2026-10-05 `obligation_ref` revert audit:**

> **No identity or correlation field is declared until the production code that reads it ships in the
> same slice.**

`obligation_ref` was declared once in `6e3c512` and reverted two commits later in `625c51c`, whose own
subject line is *"it did not do the thing it was for"* — **not** because the semantic idea was rejected,
but because the field had no production consumer, the value died at every boundary leaving the request so
six of the seven facts the future decision needed were uncollectable, the customer contract doc falsely
promised the field was *"recorded and reported back to you"*, and the verification gate (*"nothing is
persisted"*) could not tell **correctly inert** from **not wired up**. Declaring it again without its
consumer would repeat that exactly.

So one slice, or none:

1. Declare `obligation_ref` as OPTIONAL, zero synonyms, in `PILOT_DATA_CONTRACT_FIELDS`.
2. Carry the value through the adapter onto the accepted cycle **and past
   `projectExecutionInput`**, or the worker cannot see it. The reverted attempt reached the cycle
   attributes and stopped there — *"the value died at every boundary leaving the request"* — so this is
   the step to verify first, and verifying it means showing the worker reads it, not that the adapter
   writes it.
3. Add `obligation_ref` to `OBLIGATION_IDENTITY_FIELDS`, which is what flips
   `leakInstanceIdentityStatus()` — the status is *derived* from that list precisely so an incomplete
   extension fails the negative controls instead of silently enabling emission.
4. Key staged attributions on `canonicalLeakInstanceKey` and make the three ambiguity refusals reachable
   and tested.
5. Bump to `2.1.0`, with the pilot-intake package regenerated from the field specs (a customer-facing
   artefact is generated, never hand-authored).

**Nothing in steps 1–5 is done in this slice.** The approval that authorises step 1 is a contract change,
and the standing instruction on this branch is that no contract or version constant moves without it.

## 9 · What this would and would not buy

**Would:** an assessment finding on customer data could become a Recovery Case — one case per obligation,
stable across re-exports and re-assessments, with the duplicate prevention the case lane already enforces.
That is the only path from NH's detection to NH's recovery proof.

**Would not:** it finds no new money. Detector #1 and Detector #2 measure exactly what they measure
today; this field decides *whose* leak a measured dollar is, not whether there is one. **Capability is not
revenue**, and an identified gap is still not returned money.

## 10 · Open and explicitly not decided here

* **The grain.** Invoice-level versus schedule-line versus obligation-group — open, and owned by the
  reconciliation grain decision, not by this one.
* **Aggregate rows.** Structurally invisible, and **no contract field can promote grain**: a row-grain
  flag would hand grain authority to the beneficiary. Unchanged.
* **The completeness gate's pre-aggregation hole** (§4). Known, unclosed, and not claimed as a defence.
* **Whether the billing side of the reconciliation lane uses the same token.** `obligation_ref` on the
  billing extract is a *different artefact's* field with its own governance; the two must not be assumed
  to be one decision because they share a name.
