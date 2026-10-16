# Authority Next Action · V1

**Status:** built · operator guidance only · no money, no persistence, no customer data
**Date:** 2026-10-14
**Preserves:** contract **2.0.0** · expectation extract **1.1.0** · billing extract **1.0.0** ·
`DATA_READINESS_SCHEME = nh-customer-data-readiness-v2` · `DATA_READINESS_METHOD_VERSION = rdy-2026.2` ·
`ATTESTATION_METHOD_VERSION = pav-2026.2` · `OBLIGATION_IDENTITY_FIELDS = []` · every frozen artefact

---

## 1 · The defect

`AuthorityAssessment.wouldBeLiftedBy` exists so, in its own words, *"the customer conversation has
somewhere to go."* At `SOURCE_NATIVE` — the rung every real local run reaches — it named the **four
channels that do not exist** and omitted `DATA_OWNER_ATTESTATION`: the one that is implemented, that
reaches a strictly higher rung, and whose one-page form already ships in `docs/pilot-intake/ATTESTATION.md`.

One line, answering a different question than the one the field asks:

```ts
const lifted = PROVENANCE_CHANNELS.filter((c) => !c.implemented).map((c) => c.channel);
```

*Which channels are unbuilt* is not *which channels would raise this rung*. The two answers coincided
while nothing was implemented and **diverged the moment the attestation channel shipped** — and nothing
noticed, because no test asked the question the field's own comment poses. It is the `coverage.event`
shape one more time: a field answering from a subset of the facts the answer needs.

Found by running the command the previous slice built, which is the argument for building it.

## 2 · The rules

> **Guidance names the channels that would RAISE THE RUNG THIS ASSESSMENT REACHED, derived from the
> ladder — never the channels that happen to be unbuilt.** `implemented` is an **annotation on the
> answer, never the question**; that inversion was the bug.

> **Available today and does not exist stay DISTINGUISHABLE.** Five bare channel names, four of them
> unbuildable this quarter, hide the only half of the answer that says what to go and get. So
> `wouldBeLiftedBy` is complete and `availableNow` is the actionable subset — the same reason
> `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart.

> **A channel already exercised by this submission and failed is not a next action.**

## 3 · The one-branch proof

`liftsAbove(reached, exhausted)` replaces both ad-hoc locals. It **reproduces the retired `toVerified`'s
answer at `SOURCE_ATTESTED` with no special case** — the previously-correct branch is now correct for a
stated reason rather than by coincidence.

| branch | `reached` | `wouldBeLiftedBy` | `availableNow` | moved? |
|---|---|---|---|---|
| `!present` | `AUTHORITY_UNVERIFIED` | `[]` | `[]` | no |
| `!validFormat` | `PRESENT` | `[]` | `[]` | no |
| `!declaredSourceNative` | `VALID_FORMAT` | `[]` | `[]` | no |
| `provenanceEstablished` | `AUTHORITY_VERIFIED` | `[]` (derived) | `[]` | no |
| attestation corroborates | `SOURCE_ATTESTED` | the 4 `AUTHORITY_VERIFIED` channels | `[]` | no |
| attestation contradicted | `SOURCE_NATIVE` | the same 4 | `[]` | no |
| **no attestation** | `SOURCE_NATIVE` | **all 5** | **`["DATA_OWNER_ATTESTATION"]`** | **yes** |

**Exactly one branch's output moved**, and the control test asserts that `level`, `provisional`,
`reached`, `capabilities`, `blocked` and every count are identical either side of the change. That is
what makes this operator guidance rather than a behavioural change — and it is what the version
determination in §5 rests on.

**Below `SOURCE_NATIVE` the derivation is deliberately not applied.** Every channel `reaches`
`SOURCE_ATTESTED` or `AUTHORITY_VERIFIED`, so the predicate would offer all five to a file that does not
parse; those rungs are reached by fixing the **file**, not by a provenance channel. And
`AUTHORITY_UNVERIFIED` sits outside the ladder, where `indexOf` returns `-1` and *every* channel would
look like an improvement.

## 4 · Why the contradicted case is withheld

Owner's decision, and it is the sharper half of the slice. When an attestation was supplied and
contradicts the files, NH falls back to `SOURCE_NATIVE` — and `DATA_OWNER_ATTESTATION` is **not** offered.

Offering it reads as *send a corrected attestation*: adjust the declaration until it agrees with the
file. That is precisely the coordinated edit the 2026-10-07 correction established NH cannot detect, and
which this channel's own `whyTheBeneficiaryCannotAlterIt` admits — *"THEY LARGELY CAN."* **A gate that
points the incentive at the failure is worse than no gate.** The contradiction is already named in
`ceilingReason`, and an empty `availableNow` says honestly that nothing available today lifts the rung:
resolve the contradiction first.

The cost is stated rather than hidden: an honestly mistyped row count gets no route named in the report.
That is the right trade, because NH cannot distinguish an honest correction from a coordinated one, and
the party who would benefit from the larger number is the one holding both files.

## 5 · The version determination, made before the change

**`calculationMethodVersion` is the wrong constant for this layer and is proved unreachable from it.**
It appears in **ten `server/` modules** plus `src/modules/assessment/exportSummary.ts`, governs admission
and execution, is server-stamped from `ADMISSION_EVALUATOR_VERSION`, and sits inside `canonicalBinding`
(`PAX-`) and `canonicalFinding`. A `grep` across `dataReadiness.ts`, `sourceFactAuthority.ts`,
`provenanceAttestation.ts` and `scripts/data-readiness/` returns **zero hits**, and a test now asserts
that. Moving it would fire `NH-AX-1014` at schedule time and `NH-AX-2006` at run time across every
governed definition and force terms re-blessing — for a change to a guidance string.

**Persisted calculation semantics: none.** `evaluateDataReadiness` has **five non-test consumers, all
under `scripts/`** — `control.ts`, `assessPairCore.ts`, `dependency.ts`, `verify-package.ts`. No
`server/` caller, no API, no UI, no Prisma model, no hash. `DATA_READINESS_METHOD_VERSION` and
`ATTESTATION_METHOD_VERSION` are *only* stamped onto the returned object and read by nothing.

**Historical re-assessment: unaffected.** No readiness report is stored, so no historical report exists
whose reproduction could break. The artefacts that *are* reproducible forever — `PAD-`, `PAX-`,
`findingHash`, the admission-policy and analysis-terms registers — are untouched; `git diff` over
`server/` and `prisma/` is empty.

**So nothing moves, and the reason is each file's own recorded test:**

| constant | verdict | why |
|---|---|---|
| `DATA_READINESS_METHOD_VERSION` | stays **`rdy-2026.2`** | it moved to `.2` because *"a new authority state is genuinely REACHABLE"* and stayed through the billing rename because *"no level, gate, conjunct, count or refusal changed"*. Neither applies: no new state is reachable and the control proves nothing else moved. |
| `DATA_READINESS_SCHEME` | stays **`-v2`** | `availableNow` is additive, and a scheme id moves on a **breaking** shape change. |
| `ATTESTATION_METHOD_VERSION` | stays **`pav-2026.2`** | `corroborateAttestation` is not touched. |

The counter-argument — that reported output *did* change — loses on the same precedent: the billing
rename changed reported **names** and deliberately did not move the method version, because *"a version
signalling a change that did not happen is its own defect, and it would force a re-reading of every
report to express a dependency that does not exist."* All three are now **pinned by a test**, because a
version decision that nothing asserts is free to drift.

## 6 · Falsification

Five mutations, each proved to fail on the right tests:

| mutation | caught by |
|---|---|
| revert to `filter((c) => !c.implemented)` | POSITIVE, INVARIANT, and the local-pair regression |
| drop the `exhausted` exclusion | the contradicted-case negatives, in both files |
| `availableNow` ignores `implemented` | six tests across all three files |
| apply the derivation to the `!validFormat` branch | the sub-`SOURCE_NATIVE` negative |
| set `SIGNED_EXPORT.implemented = true` | the **pre-existing** top-rung invariant, plus five more |

The last is the most informative: a weak channel claiming a strong rung still trips the guard that was
already there, so this slice did not loosen it.

## 7 · What this does NOT establish

Nothing about provenance. The rung still cannot exceed `SOURCE_ATTESTED`, `AUTHORITY_VERIFIED` is still
unreachable, and **every level stays PROVISIONAL**. This slice improves what an operator is *told*; it
establishes no authority, computes no money, creates no Recovery Case, and turns no observed amount into
Revenue Returned.

One residual risk, stated rather than papered over: `availableNow` is a **claim about NH's own build**.
It is true only while `DATA_OWNER_ATTESTATION.implemented` is accurate, and nothing outside
`PROVENANCE_CHANNELS` verifies that — the same class of self-description the `coverage.event` correction
addressed one layer out, bounded here because the catalogue is three lines from the code that reads it.
