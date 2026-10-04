# Calculation-method compatibility · v1

**Decided and built 2026-10-04.** Contract version unchanged (`2.0.0`). No identity derivation changed;
no stored `pds`, `PAD-` or `PAX-` moved, and neither hash scheme was touched.

> **The invariant.** The calculation implementation that actually executes must be compatible with the
> calculation method the governed definition was blessed for and the execution binding froze.

## 1 · Two gaps, both latent, one of them actively mis-documented

**Schedule time (Finding 1).** A governed `AnalysisTerms` version records `calculationMethodVersion` — a
build constant at registration, recorded so a historical registration says which implementation it was
approved against. Nothing checked that the build about to measure under it still implements that method.
The transport already refuses to let a *request* state the field, and the reason is written down in
`analysisTermsSchema`: letting a request state it *"would invite a definition blessed for an
implementation that never ran it."* The build was never held to the same standard.

**Run time (Finding 2).** `makePolicy` rebuilds the policy from the binding but takes **no**
`calculationMethodVersion` input, so it always stamps the current constant. A redeploy between scheduling
and claiming would compute the finding by one implementation while the binding named another.
`deriveExecutionId` cannot catch it — it hashes the binding **as stored**, not as this build would build
it. The agent carried a comment claiming the rebuild *"cannot drift onto a different as-of date or
threshold"*; that was true of the as-of date, the threshold, the currency and both policy ids, and
**false of exactly this field**. The comment is corrected and now names what it does and does not cover.

This matters for the proof, not merely for tidiness: Trust Invariant rule 4 requires the proof to capture
the calculation **actually used**.

**Both are latent.** `ASSESSMENT_CALC_VERSION` has never moved in this repository's history (`git log -S`
returns one commit), so neither gate refuses anything today. They exist for the bump — the moment a silent
divergence would be least visible.

## 2 · Two codes, two bands, kept diagnostically separate

| Code | Reason | Band | What it says |
|---|---|---|---|
| `NH-AX-1014` | `calculation_method_unsupported` | **refused** | The governed terms were blessed for a method this build does not implement. Nothing was queued. Remedy is a governance act — activate a terms version for this build's method and re-submit — **not** a file fix. |
| `NH-AX-2006` | `calculation_method_drift` | **blocked** | The build's method changed between scheduling and execution. Terminal: a retry on this build re-reads the same binding and the same constant, so the answer cannot change. |

Neither reuses `NH-AX-1006` (contract support — what **data** this build can interpret), `NH-AX-1010`
(ungoverned definition), or `NH-AX-1005`/`NH-AX-2003` (the record changed). Sending someone to re-export a
file, or to investigate a tampered row, when what moved was the assessment implementation, is the specific
confusion these codes exist to prevent. Step 6 of the scheduling sequence asks what data this build can
read; step 6b asks what calculation it implements. They move independently.

The schedule-time value is **tamper-evident before the comparison**: `resolveGovernedAnalysisTerms`
verifies the terms hash, which commits `calculationMethodVersion`, so an altered row is already refused
`NH-AX-1010` rather than reaching step 6b.

## 3 · Where the run-time gate sits, and why that is pinned

Before the policy is rebuilt and before anything is computed, so no finding exists to withdraw.

That placement is asserted at **source level** (test 7) for a reason worth recording: a falsifier that
moved the gate to just before `hashFinding` left tests 4–6 **green**. `recordFindingIfAbsent` comes later,
so no finding is persisted either way — the invariant *"no finding is written"* was proven, and the
stronger claim the comment made was not. `runProjectedAssessment` is pure, so a late check leaves no
behavioural trace. Running the real calculation under a method the binding does not name and then
discarding the result is still the wrong shape, so the claim was pinned rather than softened.

## 4 · Falsifiers

Each applied, run, and reverted byte-identically (`sha256sum -c` plus an empty `diff`).

| # | Falsifier | Must fail | Did fail |
|---|---|---|---|
| F15 | the schedule-time method gate removed | 2, 3 | 2, 3 |
| F16 | the run-time drift gate removed | 4, 5, 6 | 4, 5, 6 |
| F17 | the run-time gate moved after the computation | 7 | **nothing, at first** — which is how the untested claim in §3 was found; it fails test 7 now |

## 5 · What the suite proves

1. **Positive control** — terms blessed for this build's method schedule and run to a finding.
2. Terms blessed for a foreign method are refused `NH-AX-1014` on **both** scheduling paths, and leave
   **no** execution, input, task or finding — so there is no row anyone could later claim.
3. The refusal is diagnostically separate from `1005`/`1006`/`1010`/`1012`.
4. A build change after scheduling **blocks** `NH-AX-2006` with no finding. The drifted binding still
   hashes to its own id, so every pre-existing guard passes — which is precisely why it needed its own
   check.
5. The block survives re-claiming the stored binding; it is never bypassed and never yields a finding.
6. The honest execution **beside** the drifted one still completes — the gate is neither useless nor
   indiscriminate. One boundary, same bytes, same decision, one finding.
7. The gate sits before the computation, not merely before the write.

Drift is modelled by **construction** rather than by mutating a constant: an execution whose binding froze
a different method, written through the production store with its own real hashes and its own real id. A
different method **is** a different execution identity, which the suite asserts.

## 6 · What this is not

Not proof, not a Recovery Case, not a counted dollar. Lane 1 remains `constitutesProof: false`.

It does **not** touch the submission identity. `calculationMethodVersion` is still **not** a `pds`
component and that question stays explicitly open — see
[`REFERENCE_FIRST_SCHEDULING_V1.md`](REFERENCE_FIRST_SCHEDULING_V1.md) §6 and
[`ASSESSMENT_IDENTITY_V1.md`](ASSESSMENT_IDENTITY_V1.md). This slice is about **execution
compatibility**: whether the implementation that runs matches the one that was blessed and frozen. That is
a different question from whether a method change should grant a re-assessment.

## 7 · Still open — Finding 3, untouched here

`PilotAdmissionPolicy.calculationMethodVersion` is **operator-supplied** (required in the admission-policy
request body, validated only as a non-empty string), is hashed into `admissionPolicyHash` → the `PAD-` →
the frozen decision, and is never compared to anything.

**Do not assume it should equal `ADMISSION_EVALUATOR_VERSION`.** The two constants are currently
**different values** — `ADMISSION_CALC_VERSION` is `"admission-2026.1"` and
`ADMISSION_EVALUATOR_VERSION` is `"admission-gate-2026.1"` — and the governance UI builds the policy field
from the former while `AdmissionDecision.calculationMethodVersion` is stamped from the latter. Comparing
them would conflate two distinct version concepts and break legitimate policy creation. The audit of what
each one versions, and the smallest correct remedy, is tracked separately and deliberately **not**
actioned in this slice.
