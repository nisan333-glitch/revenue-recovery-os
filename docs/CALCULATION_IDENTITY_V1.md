# Calculation-method identity and re-assessment · v1

**Derived and built 2026-10-04.** Extended the same day with the re-assessment decision (§6) and the
correction to the equivalence model (§5). No identity derivation changed. `pds`, `PAD-` and `PAX-` are untouched,
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

## 5 · Rename versus re-grade — distinguishable, and never on a fingerprint alone

Until this slice the two were indistinguishable, and both cost a full re-submission of every pilot. A
**rename** — a scheme tidy-up, a naming convention — therefore imposed the same migration as a change of
arithmetic, for no behavioural reason.

### The first model was wrong, and saying why matters more than the fix

`src/assessment/calculationMethodLineage.ts` first declared, per method, a **behaviour fingerprint** over
a frozen fixture plus an optional `labelOnlyOf`, and treated *matching fingerprints* as establishing that
two methods were the same method. **That does not follow.** The fingerprint is computed over nine cycles.
Two implementations that agree on those nine may disagree on the tenth, and no finite fixture can close
that gap — it is evidence of agreement on what was tried, never a proof of semantic equivalence. A model
that promoted it to a proof would let a genuine behavioural change pass as a rename whenever the fixture
happened not to reach it, which is exactly the failure **F34** had already demonstrated in miniature.

### What the registry asks for now

Equivalence is a **reviewed declaration**, and the fingerprint is one of its supporting exhibits:

```ts
type CalculationCompatibility =
  | { kind: "STANDALONE" }
  | { kind: "REVIEWED_EQUIVALENT"; equivalence: ReviewedEquivalence };

interface ReviewedEquivalence {
  of: string;                                 // the predecessor declared equivalent
  reviewedBy: string;                         // a named human, not a process
  reviewedAt: string;
  implementationEvidence: readonly string[];  // what was compared, and where
  tests: readonly string[];                   // targeted tests that must EXIST on disk
  rationale: string;
}
```

`reviewedEquivalenceIsWellFormed` **fails closed on every missing part**, and the registry's own test
asserts each cited test file exists (`existsSync`) — a declaration may not cite tests that were never
written. Consequences, all enforced:

| Situation | Outcome |
|---|---|
| implementation moves, version does not | the fingerprint no longer matches; the test fails. Bump, or revert |
| `REVIEWED_EQUIVALENT` whose fingerprints differ | the claim is contradicted by the evidence; the link is **dropped**, so compatibility is not granted |
| a reviewed claim missing a reviewer, date, rationale, evidence or tests | grants **nothing** |
| **matching fingerprints, no reviewed claim** | grants **nothing** — the correction above, asserted directly |
| a method the registry does not describe | **never** compatible, not even with itself by string equality |

`NH-AX-1014` asks `calculationMethodsCompatible` rather than string equality, so a *reviewed* rename does
not force re-submission, in **both directions** — a definition blessed before it stays usable after, and
one blessed after stays usable if the build is rolled back. **Unknown compatibility is blocked.** The
current registry holds exactly one entry, `STANDALONE`; nothing claims equivalence to anything.

### The guard was blind, and the falsifier found it

Falsifier **F34** shifts the stall classification by **one day** without bumping the version. On the first
fixture it **did not bite**: every cycle sat far from the stall boundary and classified identically either
way, so the fingerprint did not move. A fingerprint that only notices absurd changes is not a
fingerprint. The fixture now carries two cycles observing at exactly *N* and *N+1* days after their
expectation, and the one-day sensitivity is asserted directly (`digest(±1) !== digest(0)`), so the weak
version cannot come back silently. F34 bites now. **F39** and **F40** guard the correction itself: granting
compatibility on matching fingerprints alone, or accepting an evidence-free declaration, each fail a test.

## 6 · The decision, now made · explicit re-assessment without re-upload

> **Should a RESULT-ALTERING method change permit re-assessment of an already-admitted extract without
> re-submission?**

**Yes — explicitly, on a verified retained input, as a new linked execution.** The owner decided it; the
evidence could not, and §6 of this document previously said so and left it open. What the evidence *did*
settle is the shape, and the shape is what makes the answer safe rather than convenient:

* **The admission verdict does not depend on the calculation method.** `evaluateAdmission` reads the
  assessment policy only to split cohorts and never reads its method, so an admission reached under one
  method would have been identical under another. Reusing it reuses a decision that was never about the
  thing that changed.
* **Only the method may move.** `asOf`, `stallThresholdDays` and `currency` decide *what* is measured, and
  the admission was for that reading. Terms that change any of them are refused `NH-AX-1016` and the
  extract must be re-submitted.
* **Nothing is replaced.** A new `PAX-` and a new finding are created and **linked**; the earlier rows are
  never written to.
* **Re-submission remains required** when the input is gone or does not verify — the half the decision
  does *not* relax.

The mechanism, its four refusals and the preservation proofs are in
[`REASSESSMENT_V1.md`](REASSESSMENT_V1.md). One fact it rests on, worth stating here: a pre-bump execution
**cannot run on this build at all** — the run-time gate blocks it `NH-AX-2006` before anything is computed
— so re-assessment is not a convenience over re-running. It is the only honest route to a current-method
answer for bytes already admitted.

## 7 · What this is not

Not proof, not a Recovery Case, not a counted dollar. Lane 1 remains `constitutesProof: false`. It
changes no historical identity, no hash scheme and no stored record. It decides where the calculation
method belongs in identity — which was already right — and makes a **reviewed** rename distinguishable
from a re-grade.

And it is **not** a claim that a later finding supersedes an earlier one. A revision is a second answer
with its own identity, its own stated reason and a link to the first. Which of the two a reader should act
on is a judgement for the reader; the system's job is to make both visible, attributable and
reproducible, and to refuse to hide either.
