# CLAUDE.md — read this before doing anything

This project has a north star. Stay on it. The full document is
[`docs/STRATEGY.md`](docs/STRATEGY.md) — read it first; this file is the short,
binding version.

## Mission

We **identify, fix, and prove** revenue recovery.

Not a dashboard. Not analytics. Not another AI monitoring platform. Everything in
the system must strengthen **Identify**, **Fix**, or **Prove**.

## The Build Filter (hard gate)

Before building anything — a feature, an engine, a screen, a doc — ask:

> Does it improve **Identify**, **Fix**, or **Prove**?

If the answer is no: **do not build it.** No new engines, no new screens, no
"interesting ideas" without a demand signal. The bottleneck is demand proof, not
architecture.

**Visibility vs. Outcome (second test):** does this feature merely **show** information,
or does it help **identify, fix, recover, attribute, or prove** an outcome? If it only
increases visibility, it is likely **non-core** — that is the road back to "just another
dashboard."

## The Constitution (never blend)

> **North star: every recovered dollar must be explainable.** Revenue Returned says
> where the money came from; Auditable Revenue proves it. This is the *vocation*, not a
> rule — it needs no test, it directs every test. The three rules below are how we
> enforce it. (Full treatment in [`docs/STRATEGY.md`](docs/STRATEGY.md) → "Explainability
> is the product.")

1. Forecast ≠ Proof
2. Prediction ≠ Recovery
3. Recovery ≠ Auditable Revenue

**Two ledgers, never blended:**

* **Revenue Opportunity** — forecast. Never counted as money.
* **Revenue Returned** — proven (`Collected − Baseline`). **Auditable** is the
  CFO-grade subset of Returned (Recovered + reason + `confidence ≥ PROOF_THRESHOLD`
  + positive uplift).

These are enforced in code, not cosmetic: `src/domain/invariants.ts` and
`src/domain/outcomes.ts`, locked by `*.test.ts`. **Never bypass them.** The day a
forecast is summed into a proven number, the moat is gone.

> "Revenue Protected" (counterfactual avoided loss) is a *deferred* future concept,
> not a current ledger. Do not present or count it as if it exists.

> **The governed object is the Recovery Case** (instance of a RecoveryType; in code,
> `RecoveryEvent` created from `PLAYBOOK[leakageType]`). *Recovery Opportunity* is its
> forecast view, never the object. See [`docs/RECOVERY_CASE.md`](docs/RECOVERY_CASE.md).

## Trust Invariant — The Beneficiary Never Determines the Number

> **North star: the beneficiary never determines the number.** A dollar is counted only
> when it is supported by evidence the beneficiary cannot fabricate or retroactively
> change, under a baseline and definition fixed before the result was known. Once counted,
> the proof is frozen.

A recovery dollar may be counted **only when**:

1. The evidence originates from a source the beneficiary cannot unilaterally alter.
2. The baseline and recovery definition were established **before** the outcome was known.
3. Pre-registration timestamps are tamper-evident and cannot be backdated.
4. The proof captures the exact **model version, policy version, threshold, baseline
   method, evidence references and calculation** used at the time of approval.
5. Once approved, historical proof is **immutable and reproducible forever**.
6. Learning may change **future** decisions only. It must never rewrite historical proof.
7. Excluded Recovery is **mandatory** and cannot silently default to zero.
8. No beneficiary may be the sole author, approver, or verifier of their own recovery claim.
9. Any revision caused by refunds, reversals, disputes, or corrected source data must
   create a **new linked proof revision** — it must never overwrite the original proof.
10. **Claimed revenue is not proven revenue.**

**Standing architecture test** — before approving any design, ask:

> Can the person, team, customer, CFO, manager, or AI agent who benefits from a larger
> recovery number influence the baseline, evidence, timing, attribution, approval, or
> historical calculation? **If yes, reject the design.**

**Pilot dataset collision decision (2026-09-25).** The contract validator previously
accepted the first of two rows with the same derived cycle identity while the
assessment core excluded both. That gave the file author control over the selected
row by reordering the file, potentially changing admission and the measured amount.
Before changing the implementation, the governing rule is: **all rows sharing a
derived cycle identity are excluded from the accepted population, regardless of
order, identical content, or other row defects, whenever the adapter yields that
identity.** Report both rows as duplicate-cycle exclusions;
an identical repeated source row may additionally carry its source-duplicate code.
No surviving row may be chosen by file position. Reordering must preserve the
accepted population and admission outcome. This is a pilot-data trust rule and
does not turn any observed amount into proven Revenue Returned.
If a malformed row yields no cycle identity at all, a collision cannot be
established from it; its separate rejection remains in force.

**Assessment identity and analysis-terms governance decision (2026-09-26).** An audit found that the
pilot submission identity is derived over `(boundaryId, datasetId, datasetFingerprint)` where
`datasetId` is a free-text label the uploader types, so byte-identical data in the same boundary could
be assessed again by renaming it. No rationale for including the label is recorded anywhere in the
repository, and the sibling pre-registration record excludes it. The governing rule is now:

> **The submission identity contains the stable identity of the data plus only those parameters whose
> change materially changes the meaning or the result-space of the assessment. Purely descriptive or
> operator-controlled metadata never determines identity.**

And, because `asOf` and `stallThresholdDays` decide what "stalled" means and what the analysis cut-off
is, they fall under rule **2** above — *the baseline and recovery definition were established before the
outcome was known* — which they currently escape:

> **The same extract may be assessed again under new analysis terms, but only when those terms were
> pre-registered and governed in the way the admission bar is governed.** An operator may not choose a
> new cut-off or stall definition and obtain a fresh assessment on their own authority.

**Order of work, binding:** the governance mechanism for analysis terms comes **first**; the identity
derivation changes only after it exists. **That mechanism was built on 2026-09-26** — `asOf`,
`stallThresholdDays` **and `currency`** are now one registered, versioned AssessmentPolicy, proposed by one
identity and activated by another, and the request carries no `policy` object at all
([`docs/ANALYSIS_TERMS_GOVERNANCE.md`](docs/ANALYSIS_TERMS_GOVERNANCE.md)). The currency is in the governed
set because a row in another currency is excluded rather than converted, so it decides which rows count. The
temporal guard is that the version must be ACTIVE when it is used — **not** the admission bar's
`activatedAt > firstSeenAt` rule, which would forbid the later re-reading the decision above permits. The
fail-closed enforcement is a **breaking, tightening** change; its major bump is deferred to land with the
derivation and its migration, because the contract reference sits inside the idempotency key. The derivation is still
unchanged, the contract stays at its current major, and no migration is written. The §10
two-major compatibility decision — the next prerequisite — was **decided and built on 2026-09-26**: the
promise is honoured at the level it was made, as a checked per-major declaration that the older major's row
semantics are unchanged, with the declared version persisted so the claim is auditable
([`docs/CONTRACT_DUAL_MAJOR_V1.md`](docs/CONTRACT_DUAL_MAJOR_V1.md)). **The derivation itself changed on
2026-09-27 as contract 2.0.0**, completing the binding order: the operator-supplied dataset label is out of
the submission identity and the parameters that change what the data means are in, with the version component
narrowed to the **major** so a patch or minor bump no longer resets every identity.
`calculationMethodVersion` stays out of the submission identity — **derived and settled on 2026-10-04**,
see the calculation-identity decision below. One consequence, stated rather than buried: an
extract re-read under new governed terms must be **re-submitted**, because the admission decision is looked up
by the same identity — a verdict computed under one definition does not authorise an execution under another. Full treatment and the field-by-field classification are
in [`docs/ASSESSMENT_IDENTITY_V1.md`](docs/ASSESSMENT_IDENTITY_V1.md). This is a pilot-data trust rule
and does not turn any observed amount into a proven figure.

**Reference-first scheduling decision (2026-10-04).** An audit of the scheduling path found that it began
by *validating* the re-supplied bytes under whatever the request claimed — the declared contract version,
the date locale, the amount format and the analysis terms — and then found the admission decision by the
submission key that validation produced. So every authoritative input arrived from the party who benefits
from the number, and the closing check compared a hash of those inputs against a record selected **by** that
same hash, which can only agree. `request.declaredVersion` was worse than inert: a malformed or unsupported
value raised a dataset-level rejection, emptied the accepted cycles, and refused a properly admitted dataset
with `NH-AX-1009` — blaming the data for a claim the caller made. The governing rule is now:

> **An execution is authorised by an immutable admission decision, not by what the request re-asserts about
> the reading.** The request may *cite* the decision; every fact that decides what the run measures is then
> read from that record, and the record's own submission identity is re-derived from those facts and compared
> **unconditionally** before anything runs. A request may not name an interpretation or a definition other
> than the admitted one and have the run proceed — under either value.

**Built 2026-10-04** ([`docs/REFERENCE_FIRST_SCHEDULING_V1.md`](docs/REFERENCE_FIRST_SCHEDULING_V1.md)).
Identity re-derivation and current support authorization are answered **separately**, in that order, so a
withdrawal of support can never report itself as the record having changed; and the contract major used in
the re-derivation comes from the decision rather than from the build, which is what finally makes §10's
two-major window reachable at schedule time. The legacy discovery path is kept, **named and tested as
such**, for every admission recorded before the interpretation snapshot existed — failing those closed
would have broken scheduling for every dataset already admitted. `request.declaredVersion` was made
structurally inert and then **physically removed on 2026-10-04**: the scheduling type, the HTTP body and
the assessment client no longer have the field, so there is no wire format in which a scheduling request
can state a contract version, and an injected one is a **400** rather than a silent strip — the same
treatment EP-26b gave the `policy` object. It stays required at the intake, where it is the customer's own
declaration about their export and is persisted as made. This is a pilot-data trust rule and turns no
observed amount into proven Revenue Returned.

**Calculation-method compatibility decision (2026-10-04).** A governed AnalysisTerms version records the
`calculationMethodVersion` it was **blessed for**, and nothing checked that the build running an execution
still matched it — not at schedule time, and not at run time, where `makePolicy` rebuilds the policy from
the binding but takes no such input and so always stamps the current constant. The governing rule is now:

> **The calculation implementation that actually executes must be compatible with the calculation method
> the governed definition was blessed for and the execution binding froze.**

**Built 2026-10-04** ([`docs/CALCULATION_METHOD_COMPATIBILITY_V1.md`](docs/CALCULATION_METHOD_COMPATIBILITY_V1.md)):
refused `NH-AX-1014` at schedule time, blocked `NH-AX-2006` at run time, the run-time gate placed before
the computation rather than merely before the write, and the agent comment that wrongly claimed the
rebuild "cannot drift" corrected. This is **execution compatibility**, in stage C — it does not touch the
submission identity, and `calculationMethodVersion` remains explicitly **open** and out of `pds`.

**Admission-policy provenance decision (2026-10-04).** `PilotAdmissionPolicy.calculationMethodVersion`
documents itself as *"which evaluator computed the rates"* — a fact about the server — yet it arrived from
the operator and was validated only as a non-empty string. An audit proved an arbitrary label passed with
zero defects, changed `admissionPolicyHash` and therefore the `PAD-` frozen into the decision, while the
evaluator that actually ran was untouched. It changed no outcome, count, rate or check, so the harm was
never a wrong verdict: it was the **proof carrying an operator-authored claim about its own calculation**,
which rule 4 forbids. The governing rule is now:

> **The calculation provenance recorded on a governed definition is stated by the server, never by a
> caller.** It names the implementation that will actually judge, and the definition's hash commits it.

**Built 2026-10-04** ([`docs/ADMISSION_POLICY_PROVENANCE_V1.md`](docs/ADMISSION_POLICY_PROVENANCE_V1.md)):
the field is gone from the request (an injected one is a **400**), the server stamps
`ADMISSION_EVALUATOR_VERSION` before hashing, and policy and decision agree for every new record — the
agreement the original module comment promised and never implemented. The audit established these were
**one concept with two inconsistent constants**, not two layers: both arrived in the same commit, the
"stamped into every decision" intent was never implemented for `ADMISSION_CALC_VERSION`, and no evaluator
ever read it. That constant is now **retired and relabelled**, kept only because historical rows store it.
`POLICY_HASH_SCHEME` is unchanged under a five-point proof, and history is untouched — no production path
ever recomputes a historical policy hash.

**Register tamper-evidence decision (2026-10-04).** The admission-policy register's stored hash was
**never re-verified** in production — `hashAdmissionPolicy` ran only at registration, the judging path
trusted `stored.policyHash`, and `policyHashMatches` had no production caller — while the analysis-terms
register verified on every resolve and refused. Both tables are append-only, so the exposure was the same
migration/restore/bug set the terms register refuses to treat as acceptable for itself. The governing rule
is now:

> **A governed definition is verified against its own witness wherever it is resolved for use, not
> trusted as stored.** A row that fails its witness judges nothing and may not be put in force — but
> governance may always still *withdraw* its authority.

**Built 2026-10-04** ([`docs/ADMISSION_POLICY_PROVENANCE_V1.md`](docs/ADMISSION_POLICY_PROVENANCE_V1.md) §10):
verified **first** on the judging path, so "this row changed" outranks "nobody activated it"; `ACTIVATED`
and `UNFROZEN` refused; `FROZEN` and `RETIRED` deliberately still permitted, because refusing every
transition would leave governance unable to stop what it had just found. It refuses nothing today — every
row the application has written hashes to its own values.

**Calculation-method identity decision (2026-10-04).** Open four times and answerable from the code. The
method **is** already in `canonicalBinding` (→ `PAX-`) and in `canonicalFinding`, and the admission verdict
does **not** depend on it — `evaluateAdmission` reads the assessment policy only to split cohorts and never
reads its method. The governing rule is therefore:

> **The calculation method is an identity component of exactly the artefacts it can change — the execution
> and its finding — and is correctly absent from the submission identity, which governs admission.**

So no identity changes: a method change already yields a new execution identity and a new finding, and
adding the field to `pds` would re-identify every historical submission to express a dependency admission
does not have. **Built 2026-10-04**
([`docs/CALCULATION_IDENTITY_V1.md`](docs/CALCULATION_IDENTITY_V1.md)): a per-method **behaviour
fingerprint** — a declaration checked by recomputing from the implementation present — now distinguishes a
**rename** from a change of arithmetic, so `NH-AX-1014` asks compatibility rather than string equality and
a rename no longer forces every pilot to re-submit.

**The one decision that is NOT derivable, and is isolated rather than invented:** whether a
*result-altering* method change should permit re-assessment of an already-admitted extract **without
re-submission**. The identity machinery supports either, the trust invariant forbids neither, and it turns
on whether a figure a customer was already shown may move because the implementation improved. It is a
business decision with an owner. Today's behaviour — re-submission required — is the status quo preserved,
not an answer.

**Non-negotiable learning constraint:** the Learning Layer must optimize for **durable,
independently verified, post-reversal auditable outcomes** — never for claimed recovery,
raw counted recovery, or short-term proof volume.

## The wedge (first workflow, not the category)

**Activation Recovery**: Signed → Onboarding → Activation → First Value → Second
Invoice. This is the beachhead. Win it first. Do not sell "tomorrow" (the broader
Business Outcome OS) — earn it.

But the product is **Revenue Recovery OS**, and Activation is only its **first
recovery workflow**. Later workflows (Sales / Ownership / Handoff, then Expansion /
Renewal / Churn) must drop in without a rewrite. **Build Activation end to end, but
keep the domain generic.** A new workflow = new `LeakageType` + `PLAYBOOK` entry +
`RecoveryReason` plays — never a special case carved into the invariants, the
ledger, or the proof chain. If the engine has to learn the word "activation," stop —
that belongs in data, not the core. Never narrow this into an "Activation Recovery
System." See `docs/STRATEGY.md` → "The wedge is not the category."

## Build the complete loop, not a detection product

The biggest risk is not a missing queue — it is the product quietly becoming "just
another system that identifies problems." A CFO/CRO/CEO does not buy Detection,
Scoring, or Prioritization. They buy *"I found $200K leaking, I fixed it, and I
returned $80K in cash."*

So **never ship a slice of the loop as the product.** From day one the user must be
able to see **Identify → Fix → Prove** in a single workflow, on one case: problem
identified → recommended action → action taken → money proven returned. Depth may
vary — Execute can be manual/semi-automatic at first — but all four must be visible
together. If a demo shows Detection / Scoring / Prioritization but not Action /
Recovery / Proof, the differentiation is gone. See `docs/STRATEGY.md` → "Build the
complete loop, not a detection product."

## What success is

Revenue recovered · revenue proven · customer willingness to pay · repeatable
outcomes. **Not** features, engines, screens, or tests built.

## Read before changing the product

1. [`docs/STRATEGY.md`](docs/STRATEGY.md) — the north star.
2. [`docs/VISION.md`](docs/VISION.md) — worldview + honest critique (§7 = backstage
   decision engine).
3. [`docs/PROOF_MODEL.md`](docs/PROOF_MODEL.md) — the Activation wedge + proof method.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the layers evolve.

## Changing this constitution

The constitution is not changed casually during implementation.

* **Core-definition changes go through the constitution before code.** What a Recovery
  Loop stage means, what T1/T2/T3 require, what counts as Revenue Returned, what the
  system is/is not — these are decided here first.
* **Implementation experiments may happen in code first** (UI layout, state shape,
  component structure). If an experiment sticks, document it back into the constitution.
* **Document a discovered gap *before* editing** — not silently patched, not
  retrofitted to match what the code already does. State the gap and why it exists,
  then propose the change.

## Working in the code

* The domain core (`src/domain/`) is **pure and UI-independent** — keep it that way.
* Invariants are the product's truth and are unit-tested; touching them means
  updating the tests with recomputed numbers, never loosening the rule.
* Before committing: `npm run test` (must stay green) and `npm run build` (strict,
  must be clean).
* The **Build Filter is enforced as a pre-commit hook** (`.githooks/pre-commit`,
  wired by `npm install` via the `prepare` script). On any commit that touches
  `src/`, it surfaces the three questions — Identify? Fix? Prove? — so focus drift
  is caught at the moment it happens. It is a reminder, not a blocker; answer the
  three questions honestly before you proceed.
* Develop on branch `claude/revenue-recovery-os-806cgo`. Commit in logical chunks.
  **No pull request unless explicitly asked.**
