# Calculation-method identity and re-assessment · v1

**Derived and built 2026-10-04.** No identity derivation changed. `pds`, `PAD-` and `PAX-` are untouched,
and `calculationMethodVersion` stays **out of the submission identity** — not as a further deferral, but
as the answer the evidence gives.

## 1 · The question, open four times

`ASSESSMENT_CALC_VERSION` is a build constant. Three slices touched it — compatibility, provenance,
tamper-evidence — each correctly preserving its "explicitly open" status without deciding it. The open
question as previously written: *"Whether a calculation-method bump should likewise grant a re-assessment
is not decided here and needs its own answer."*

It is answerable from the code, and the answer is that **the placement is already correct**.

## 2 · Where the method already is, as a matter of fact

| Identity | Contains `calculationMethodVersion`? | Evidence |
|---|---|---|
| `pds_…` submission identity | **No** | `deriveIdempotencyKey`'s nine components — contract major, boundary, fingerprint, locale, amount format, currency, as-of, threshold |
| `PAD-…` admission decision | **No** | `canonicalDecision` — boundary, key, fingerprint, contract version, outcome, admission policy id/version/hash |
| `PAX-…` execution identity | **Yes** | `canonicalBinding` includes `p.calculationMethodVersion` → `hashExecutionBinding` and `deriveExecutionId` |
| finding hash | **Yes** | `canonicalFinding` includes `finding.calculationMethodVersion` |

And the decisive negative: **the admission verdict does not depend on it.** `evaluateAdmission(report,
assessmentPolicy, admissionPolicy)` reads `assessmentPolicy` only to call `splitCohorts`; every
threshold it checks comes from the *admission* policy, and the decision it returns stamps
`ADMISSION_EVALUATOR_VERSION`. The string `assessmentPolicy.calculationMethodVersion` appears nowhere in
`admissionGate.ts`.

## 3 · The rule, derived

> **The calculation method is an identity component of exactly the artefacts it can change — the
> execution and its finding — and is correctly absent from the submission identity, which governs
> admission.**

A method change therefore **already** produces a new execution identity and a new finding hash: a
re-assessment is granted at the layer where the answer actually differs. It does **not** invalidate the
admission, because an admission verdict computed under one calculation method would have been identical
under another — the method plays no part in it.

So nothing in the identity derivations needs to change, and adding the field to `pds` would be worse than
redundant: it would re-identify every historical submission to express a dependency that the admission
does not have.

## 4 · What re-assessment actually requires today

Stated as the system behaves, not as it might:

1. A method change makes every governed AnalysisTerms version blessed for the old method incompatible —
   `NH-AX-1014` ([`CALCULATION_METHOD_COMPATIBILITY_V1.md`](CALCULATION_METHOD_COMPATIBILITY_V1.md)).
2. New terms must be proposed and activated to bless the new method.
3. Reference-first scheduling forbids citing terms other than the admitted ones — `NH-AX-1013`
   ([`REFERENCE_FIRST_SCHEDULING_V1.md`](REFERENCE_FIRST_SCHEDULING_V1.md)).
4. **Therefore the extract must be re-submitted.**

That is the pre-existing consequence of putting the governed policy inside the submission identity, which
the constitution already states: *"an extract re-read under new governed terms must be re-submitted."* It
is not a new rule and it is not caused by the calculation method's identity placement.

## 5 · Label-only versus result-altering — now distinguishable

Until this slice the two were indistinguishable, and both cost a full re-submission of every pilot. A
**rename** — a scheme tidy-up, a naming convention — therefore imposed the same migration as a change of
arithmetic, for no behavioural reason.

`src/assessment/calculationMethodLineage.ts` declares, per method, a **behaviour fingerprint** over a
frozen fixture, plus an optional `labelOnlyOf`. It is a declaration a human writes and a test checks by
recomputing from the implementation actually present — the shape `MAJOR_ROW_SEMANTICS` and
`PREVIOUS_MAJOR_SUPPORT` already use here. Consequences, all enforced:

| Change | Outcome |
|---|---|
| implementation moves, version does not | the fingerprint no longer matches; the test fails. Bump, or revert |
| version bumped, declared `labelOnlyOf` | fingerprints must be **identical**, or the claim is false and the test fails |
| version bumped, no `labelOnlyOf` | fingerprints must **differ**, or the bump changed nothing |
| a method the registry does not describe | **never** compatible, not even with itself by string equality |

`NH-AX-1014` now asks `calculationMethodsCompatible` rather than string equality, so a declared rename
does **not** force re-submission, in **both directions** — a definition blessed before a rename stays
usable after it, and one blessed after stays usable if the build is rolled back.

### The guard was blind, and the falsifier found it

Falsifier **F34** shifts the stall classification by **one day** without bumping the version. On the first
fixture it **did not bite**: every cycle sat far from the stall boundary and classified identically either
way, so the fingerprint did not move. A fingerprint that only notices absurd changes is not a
fingerprint. The fixture now carries two cycles observing at exactly *N* and *N+1* days after their
expectation, and the one-day sensitivity is asserted directly (`digest(±1) !== digest(0)`), so the weak
version cannot come back silently. F34 bites now.

## 6 · The one decision that is NOT derivable — isolated

> **Should a RESULT-ALTERING method change permit re-assessment of an already-admitted extract without
> re-submission?**

Evidence cannot settle it, and that is why it is stated rather than answered:

* **The identity machinery supports either.** A new `PAX-` is produced either way; nothing would have to
  be re-identified.
* **The trust invariant forbids neither.** New terms would still be governed — proposed by one identity,
  activated by another, hash-witnessed — so the beneficiary determines nothing in either case.
* **It is a product question.** Re-grading maximises consistency across a portfolio: every customer's
  number reflects the current best method. Requiring re-submission maximises the stability of what a
  customer was already told: a figure they were shown does not move because the implementation improved.

Both are defensible and they are not reconcilable by inspection. **This is the remaining open item from
the identity-governance order of work**, and it is a business decision with an owner, not a gap in the
code. Nothing in this slice presumes either answer: today's behaviour (re-submission required) is the
status quo preserved, not a decision made.

## 7 · What this is not

Not proof, not a Recovery Case, not a counted dollar. Lane 1 remains `constitutesProof: false`. It
changes no historical identity, no hash scheme and no stored record. It decides where the calculation
method belongs in identity — which was already right — and makes a rename distinguishable from a re-grade.
