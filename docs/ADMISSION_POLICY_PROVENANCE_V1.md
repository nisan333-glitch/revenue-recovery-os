# Admission-policy calculation provenance · v1

**Decided and built 2026-10-04.** Contract version unchanged (`2.0.0`). `POLICY_HASH_SCHEME` unchanged.
No historical row, hash, `PAD-` or document rewritten.

> **The rule.** `calculationMethodVersion` on an admission policy states *which evaluator computed the
> rates*. That is a fact about the server's implementation, so the server states it. A caller cannot.

## 1 · The defect

The field was **required in the request body** and validated only as a non-empty string. The audit
probe — same thresholds, same dataset, one field different:

```
outcome / counts / checks / reasons / rejection distribution / admissible flag → ALL IDENTICAL
policyHash changes?                                                           → TRUE
PAD changes?                                                                  → TRUE
decision.calculationMethodVersion → "admission-gate-2026.1" in BOTH (always the evaluator)
arbitrary label accepted?         → TRUE, with ZERO validateAdmissionPolicy defects
```

So the label changed **no computation** but was frozen into `admissionPolicyHash` → the `PAD-` → the
decision, and the beneficiary authored it. **Classification: a proof/provenance integrity defect**, not a
compatibility one. Trust Invariant **rule 4** is the one breached — the proof captured a *claimed*
calculation.

Scope kept honest: it could **not** make an unfit dataset admissible, and a forged label produced a
*different* PAD rather than impersonating an existing decision. The decision record always reported the
true evaluator. The harm was confined to what the frozen proof asserts about itself.

**An inversion worth naming.** The register persisted the operator's *claim*
(`pilot_admission_policies.calculation_method_version`, inside the hash preimage) while the *true*
evaluator version was persisted **nowhere** — `PilotDatasetSubmissionRecord` keeps outcome, policy
id/version/hash and the decision id, but not the decision's calc version. The record kept the claim and
discarded the fact.

## 2 · Why one concept, not two layers

| Evidence | Finding |
|---|---|
| `git log -S` | **Both constants arrived in the same commit** `079ca1e` (2026-09-23). Neither was retrofitted. |
| `ADMISSION_CALC_VERSION`'s module doc | says it mirrors `AssessmentPolicy` — *"method version, frozen at construction, **stamped into every decision**"* — but the decision is stamped from `ADMISSION_EVALUATOR_VERSION`. **The stated mirror was never implemented.** |
| the field's own doc | *"**Which evaluator computed the rates.**"* — which is precisely what `ADMISSION_EVALUATOR_VERSION` holds. |
| every reader | `ADMISSION_CALC_VERSION` was read by **no evaluator and no computation anywhere** — only the UI, the rehearsal agent and test fixtures, all of which merely put it into a policy. |

**One semantic concept implemented with two inconsistent constants.** The prospective authoritative value
is `ADMISSION_EVALUATOR_VERSION`.

Rejected on the way: *"remove operator control but keep stamping `ADMISSION_CALC_VERSION`."* It closes
beneficiary influence while **preserving false provenance** — the record would still name something that
did not judge.

## 3 · The prospective model

1. `calculationMethodVersion` is **gone** from `admissionPolicySchema`; an injected one is a **400**.
2. The server stamps `ADMISSION_EVALUATOR_VERSION` into the canonical policy **before** hashing and
   persistence, spread **last** so it wins even for an in-process caller the transport never sees.
3. `admissionPolicyHash` therefore commits the evaluator that will actually judge.
4. `AdmissionDecision.calculationMethodVersion` is unchanged — still the evaluator.
5. **Policy and decision now agree for every new record.** That is the agreement the original module
   comment promised and never delivered.

The domain type `PilotAdmissionPolicy` **keeps** the field: it stays in `canonicalize()` and so in the
hash. Only the *request* lost it.

## 4 · History

Untouched, and nothing had to be made safe — it already was. **`hashAdmissionPolicy` runs in exactly one
production place**: registration (`pilotIntakeService.ts`). The submit path and both read paths use
`stored.policyHash`. So no production path ever recomputes a historical policy's hash, and the
prospective change cannot reach one.

A row that recorded `"admission-2026.1"` is **historical evidence of what was recorded then**, even though
the audit has now shown the field was not authoritative provenance. It is not reinterpreted, not
backfilled, not required to equal today's evaluator.

Pinned absolutely, so no future change can quietly reinterpret them:

| | value |
|---|---|
| historical policy hash | `sha256:7d92cfd3205404b4209149abf7ffc27dfb13d3c28b16a5de6734c20d4edddb43` |
| historical PAD | `PAD-299cffde22d5840237b14e02358032bd` |
| same thresholds, corrected provenance | `sha256:69e9ca67065e56686957ce576caf75d637d4a8d35e2d7caf9cbac2b69fd65b8e` |

A new policy with the same thresholds hashes **differently** from a historical one. That is **desirable
evidence, not an identity regression** — they are not the same definition.

## 5 · Hash scheme preserved — the five-point proof

1. **Canonical field set unchanged** — `canonicalize()` untouched.
2. **Field order unchanged.**
3. **Algorithm unchanged** (`sha256Hex`).
4. **Field semantics corrected prospectively** — the stamped *value* changes for new rows; the field does not.
5. **Historical rows verifiable from their stored values** — and stronger: never recomputed at all (§4).

All five hold, so `POLICY_HASH_SCHEME` stays `"nh-admission-policy-v1"`. A new scheme would have
re-identified every future policy for no reason.

## 6 · `ADMISSION_CALC_VERSION` — retired, kept, relabelled

No production request or governance path uses it. Its declaration now states it is the **retired** label
historical rows carry and that it describes no current evaluator. It is **kept, not deleted**: historical
rows store that exact string and §4's proofs must name it. The four `src/` domain-level fixtures moved to
`ADMISSION_EVALUATOR_VERSION`, so no test asserts the new model while constructing the old label.

## 7 · One existing test re-pointed, not deleted

`pilotJourneyMatrix.test.ts` proved *"the transport lets a single space through; the domain guard stops
it"* using `calculationMethodVersion: " "`. That field can no longer reach the domain, so the test was
re-pointed to **`policyId: " "`** — identical shape (`minLength: 1` passes a space;
`validateAdmissionPolicy` rejects `!value.trim()`). The intent is unchanged; only the field that can still
demonstrate it moved.

## 8 · Falsifiers

Each applied, run, and reverted byte-identically.

| # | Falsifier | Must fail | Did fail |
|---|---|---|---|
| F18 | field restored to the HTTP request schema | the allowlist proof, A+B, H | all three |
| F19 | server stamps `ADMISSION_CALC_VERSION` instead of the evaluator | E+F, G, the retired-constant proof, H | all four |
| F20 | caller value overrides the server value, schema reinstated too | — | **masked itself** — see below |
| F20b | spread order reversed **only**, transport untouched | the in-process smuggling proof | it did |
| F21 | historical verification made to depend on the current evaluator | I, J, the scheme proof | all three |

**F20 masked itself, and that found a gap.** Reversing the spread order is only observable if the
transport does not reject the field first, so a falsifier that reinstates the schema *and* reverses the
order dies on the 400 and proves nothing about the inner layer. The spread order's own claim — that it
holds for an in-process caller — was therefore **untested**. A smuggling proof was added that bypasses
the transport (the same shape the analysis-terms suite already uses for itself), and F20b bites on it.

## 9 · What this is not

Not proof, not a Recovery Case, not a counted dollar. Lane 1 remains `constitutesProof: false`. It does
not touch the submission identity; `calculationMethodVersion` is still **not** a `pds` component and that
question stays explicitly open.

## 10 · Still open — queued, deliberately not built here

**The admission-policy register's stored hash is never re-verified in production.** `policyHashMatches`
exists and has **no production caller**, while `resolveGovernedAnalysisTerms` verifies its terms hash on
every resolve and refuses `NH-AX-1010` on mismatch — explicitly because *"a stored hash that no longer
matches the stored values means the row changed after it was blessed — by a migration, a restore or a
bug."* Both tables carry append-only triggers, so the exposure is exactly that set of causes, and the
terms register rejects that reasoning as sufficient for itself.

So the two registers are asymmetric: one is tamper-evident at read time, the other is trusted as stored.
Adding read-time verification introduces a new refusal path on an existing flow and affects every stored
row, so it is **its own slice** with its own falsifiers — not a rider on a provenance correction.
