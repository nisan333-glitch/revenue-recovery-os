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

**Historical rows: audited and closed (2026-10-04).** The remaining question — whether rows written before
that correction, which still carry whatever an operator supplied, are an unresolved defect — was settled on
evidence rather than left open. The distinction that matters is that *a value is stored* and *a value is
believed* are different claims; only the second is a defect. Nothing believes it: the only non-test readers
are a non-blank check and the hash preimage, no API returns the stored policy object, no screen renders it,
and `AdmissionDecision.calculationMethodVersion` was stamped from `ADMISSION_EVALUATOR_VERSION` at both
construction sites from the beginning — so **the authoritative statement of which evaluator judged is
correct on every decision ever recorded**. The verdict is therefore **preserved historical provenance**: a
retired, inert label, hash-committed and now witness-verified. One bounded ambiguity is stated rather than
buried — the field alone cannot prove which regime wrote it — and it is harmless only because nothing
consumes it. **The day anything starts reading that field, the ambiguity becomes a defect**, and the remedy
then is a per-row provenance marker, never a rewrite of history
([`docs/ADMISSION_POLICY_PROVENANCE_V1.md`](docs/ADMISSION_POLICY_PROVENANCE_V1.md) §11).

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
([`docs/CALCULATION_IDENTITY_V1.md`](docs/CALCULATION_IDENTITY_V1.md)): a per-method registry now
distinguishes a **rename** from a change of arithmetic, so `NH-AX-1014` asks compatibility rather than
string equality and a reviewed rename no longer forces every pilot to re-submit.

**Semantic-equivalence correction (2026-10-04).** The first form of that registry treated a matching
**behaviour fingerprint** as establishing that two methods were the same method. **That does not follow.**
The fingerprint is computed over nine cycles; two implementations agreeing there may disagree on the
tenth, and no finite fixture closes the gap — exactly the failure falsifier F34 had already shown in
miniature when a one-day classification shift left the fingerprint unmoved. The governing rule is now:

> **A finite behaviour fingerprint is necessary evidence of equivalence and never a proof of it.**
> Equivalence must be an explicit **reviewed declaration** — a named reviewer, a date, a rationale,
> implementation evidence and targeted tests that exist — and it is contradicted, not confirmed, by
> differing fingerprints. **Unknown compatibility is blocked.**

**Built 2026-10-04**: `reviewedEquivalenceIsWellFormed` fails closed on every missing part, the registry's
test asserts each cited test file exists on disk, and matching fingerprints alone grant nothing. The
current registry holds one `STANDALONE` entry; nothing claims equivalence to anything.

**Explicit re-assessment decision (2026-10-04).** The decision previously isolated as not derivable —
whether a *result-altering* method change may permit re-assessment of an already-admitted extract
**without re-submission** — was **made**, and the shape the evidence does settle is what makes it safe:

> **An already-admitted extract may be assessed again under newly governed analysis terms, without
> re-supplying the file, when the retained input is present and verifies against its own recorded hash.
> The result is a new execution and a new finding, LINKED to the previous one with a stated reason. A
> result is never silently replaced, and re-submission remains required when the input is unavailable or
> unverifiable.**

It is sound because the admission verdict does not depend on the calculation method — `evaluateAdmission`
never reads it — so the reused decision was never about the thing that changed. **Only the method may
move:** terms changing `asOf`, `stallThresholdDays` or `currency` change *what* is measured and are
refused `NH-AX-1016`. Authorization and governance are re-checked **now**, not inherited, so a frozen bar
refuses a revision. **Built 2026-10-04**
([`docs/REASSESSMENT_V1.md`](docs/REASSESSMENT_V1.md)): four refusals — `NH-AX-1015` input unavailable or
unverifiable, `NH-AX-1016` not method-only, `NH-AX-1017` nothing to do, `NH-AX-1018` the binding already
exists independently and is **not relabelled** — plus a derived, not narrated, before/after delta over
fourteen fields a revision must hold constant. The earlier execution and finding are proven byte-identical
afterwards; the append-only tables refuse the alternative outright. The fact it rests on: a pre-bump
execution **cannot run on this build at all** (`NH-AX-2006` blocks it before anything is computed), so
this is the only honest route to a current-method answer for bytes already admitted. This is a pilot-data
trust rule and turns no observed amount into proven Revenue Returned.

**The operator flow was built 2026-10-04** and is exercised in the real browser journey, UI → API →
database → worker, on a genuine method change (119/119 checks). The screen has **no file picker at all** —
asserted on the markup, so "without re-upload" is a property of the thing rather than a promise — and no
threshold, cut-off, currency or method can be typed. Every governed definition is shown either selectable
or carrying the code the server would answer with, so the refusals are read *before* submitting rather than
discovered by being refused; the local predicates are explicitly **not a gate** and can only mark a row
ineligible. Two things the slice learned the hard way are recorded because they generalise: **a disabled
button is a display of a rule, never the rule** — three clicks dispatched before React re-rendered all
passed the state-based gate and sent three requests, so the mutex is a synchronous latch — and **a retry
must replay the attempt verbatim**, because the reason is not part of the binding, so a retry with new
wording is answered with the execution already recorded and the screen would then show a sentence the
record does not hold. The journey's own three defects were all **false readings of correct behaviour** (a
dropped `aria-label`, a wait matching the previous execution's panel, a check whose premise was backwards),
which is the failure mode a browser harness exists to catch
([`docs/REASSESSMENT_V1.md`](docs/REASSESSMENT_V1.md) §6b–6c).

**Second detection surface decision (2026-10-05).** A coverage audit found NH detected exactly **one**
leakage family, and the cause was one line: `observedSummary` is called with the stalled cohort only, so
`for (const c of stalled)` meant payment state was never evaluated for a cycle routed to `reference` or
`undetermined`. An overdue unpaid invoice on an account that activated on time was invisible **by
construction**. The governing rule is now:

> **A monetary obligation that is past due and unsettled is detectable on its own facts, not only when it
> sits behind another deviation.** A new detection surface is an **additive, separately governed sibling**
> artefact — never a widening of an existing one whose canonical form is already hashed.

**Built 2026-10-05** ([`docs/DETECTOR_2_NON_STALLED_EXPOSURE_V1.md`](docs/DETECTOR_2_NON_STALLED_EXPOSURE_V1.md)).
The rejected design — two scalars added to `canonicalFinding` — would have meant *same historical input +
same governed terms + same `ASSESSMENT_CALC_VERSION` ⇒ **different** `findingHash`*, turning the witness
into a function of the **build** and breaking rule 5's promise that historical proof stays *reproducible*.
Nothing would have failed today (one production caller, no re-hashing of stored findings, append-only
table, a finished task never re-claimed), which is exactly why "nothing fails" was never the right test.
So the new reading got its own scheme, canonical form, witness hash and version constant
(`NON_STALLED_EXPOSURE_METHOD_VERSION`), independent of `ASSESSMENT_CALC_VERSION`: no bump, no terms
re-blessing, no re-assessment, and `ObservedSummary`, the behaviour fingerprint, `canonicalFinding` and
`hashFinding` all byte-identical, each with its own preservation test. The populations are the stalled
cohort and its **complement**, provably disjoint and additive to an independent classification of the whole
accepted population. **"Not computed" is not "zero"** — an execution recorded before this detector carries
no exposure at all, and rendering that as $0.00 would assert a population was checked and found clean when
nobody checked. Everything is labelled **OBSERVED**: this is detection and valuation only, it creates no
Recovery Case, stages no candidate, and **Revenue Returned and Auditable Revenue are unchanged**.

One subpart was **stopped rather than guessed**: whether a `status = churned` row's outstanding obligation
is void cannot be established from the contract — `status` is optional with an empty enum and no declared
meaning, the governed projection drops it for privacy so any status control would be inert in the worker
where the money is measured, and `excludedStatuses` is ungoverned and unhashed, so wiring it would hand the
beneficiary a free-text lever over which rows count. Detector #2 therefore adds **no new status
interpretation**, and the gap's current behaviour (undated `churned`, overdue, unpaid ⇒ **counted**) is
pinned by a test naming it as the reported limitation. That is a contract decision with an owner. The
benchmark is **synthetic**: 100% monetary recall and precision on one fixture licenses no coverage claim
beyond it.

**Attributed exposure decision (2026-10-05).** The search for a third detector produced a result worth
binding, because the attractive mistake is a big number. The latent `revenueEvent.ts` engine — named by the
coverage audit as the largest unused capability in the codebase — turned out to detect **nothing new**: its
"billing event" is the *payment*, so `MISSING` collapses into existing Unpaid exposure, `INCORRECT`
company-favourable collapses into the existing partial-payment remainder, the customer-favourable branch is
unreachable (the adapter rejects overpayment) and is a liability rather than leakage, and `DELAYED` carries
no outstanding exposure by design. The next candidate, **failed payment / dunning**, needs a fact the
contract does not carry — and when it has it, every dollar it finds is one Detector #1 or #2 already counts
in full. The governing rule is now:

> **A detector that attaches evidence to a dollar an existing detector already counts reports ATTRIBUTED
> exposure and ZERO incremental union money.** The union of detectors is the union of their *populations*,
> never the sum of their reported figures. Where a new detector explains rather than discovers, say so in
> the figure: *attributed* and *incremental union* are two numbers, and the second one is $0.00.

The corollary is a claim rule: affirmative evidence of *why* a dollar is unpaid raises the **plausibility**
of collecting it and establishes nothing about recovery. Plausibility is not recoverability, and
recoverability is not Revenue Returned.

**Recorded 2026-10-05, nothing implemented** — the proposal
([`docs/DETECTOR_3_FAILED_PAYMENT_V1.md`](docs/DETECTOR_3_FAILED_PAYMENT_V1.md)), the latent-engine audit
and its as-of defect ([`docs/REVENUE_EVENT_LATENT_V1.md`](docs/REVENUE_EVENT_LATENT_V1.md)), and three open
governed issues ([`docs/GOVERNED_ISSUES_V1.md`](docs/GOVERNED_ISSUES_V1.md)). `revenueEvent` stays
**unwired**: it reads `paidAt` raw rather than effective-as-of, so a post-cut-off payment would read as
`DELAYED` ("the money arrived") where `classifyPayment` correctly says `Unpaid` — a blocker on any future
wiring, deliberately not repaired opportunistically. Contract stays at **2.0.0**; the minimum addition for
Detector #3 is two **optional** fields, and the field tier is forced rather than chosen, because
`COMPATIBILITY_POLICY` lists "add a recommended field" as *minor* while the admission gate counts missing
recommended columns against a threshold of zero — so a recommended addition would refuse datasets that
previously passed, which is *major* by the policy's own test. Two further rules fell out and are binding on
the implementation whenever it is authorised: **a defect in a non-money, non-identity column must never
reject the row**, because row rejection would let the beneficiary shrink measured exposure by poisoning an
optional column; and **payment-attempt multiplicity is one-to-many and a single row may carry only a named
latest-attempt aggregate** — attempt history needs a separate event extract, which is itself blocked by the
frozen-empty `OBLIGATION_IDENTITY_FIELDS`. Rows that fail intake are **quarantined, never counted**: the
$2,000 of establishable overdue obligation among the frozen corpus's 15 rejected rows enters no detector,
no union and no recall denominator.

**Missing-invoice expectation standard (2026-10-05).** With Detector #3 held as an approved but
deprioritised candidate — it explains dollars rather than finding them — the mission moved to the one family
that would find money NH cannot see at all: an obligation that *should* have been invoiced and never was.
The word that carries the risk is **should**, and the governing rule is now:

> **The expectation must originate in a system OTHER than the system that was supposed to act.** Asking the
> billing system what billing should have done cannot detect billing's own omission, because the failure
> that erased the invoice may have erased the schedule with it. An expectation must additionally pre-date
> the period it governs, carry the facts that would legitimately end it, and keep *that* an invoice was due
> separate from *how much* it was for.

**A finite history of past invoices is not an obligation.** "Billed monthly for six months" does not
establish that the seventh is owed: cancellation, expiry, pause, amendment, a free period and a term simply
ending are all normal, and a detector that reads the pattern as the obligation manufactures money in every
one of them. Pattern may corroborate a declared cadence; it may never be the cadence's source — the same
shape as the semantic-equivalence correction above.

**Proved, not asserted: a missing invoice is structurally unrepresentable in contract 2.0.0.**
`next_invoice_due_at` and `next_invoice_amount` are **required**, so a subscription billing never invoiced
either has no row (invisible) or a row with blanks (rejected `missing_required_field`, and rejected rows are
quarantined, never counted). The gap is in the contract's shape, not in any detector — which is why no
single-extract design can close it, however the fields are named. The architecture that can is an
**independently-sourced expectation extract** with NH performing the join itself, **iterating the
expectation side** so that absence is a positive result rather than a lookup that finds nothing, and binding
the two datasets as an **ordered pair** so the proof records which system was supposed to act
([`docs/MISSING_INVOICE_ARCHITECTURE_V1.md`](docs/MISSING_INVOICE_ARCHITECTURE_V1.md)). Unlike Detector #3
its population is **disjoint from Detectors #1 and #2 by construction** — the rows are in a different file —
and it is the first cross-department handoff NH could detect. **Disjointness is structural; the amount is
not**, and an earlier form of this paragraph overstated it. The claim is:

> **Missing Invoice creates the capability to identify incremental exposure outside D1/D2. Actual
> incremental union money is dataset-dependent and may be $0.**

Exposure exceeds zero only when an authoritative expectation exists, the expected event is genuinely absent,
an authoritative expected **amount** exists, and every exclusion/lifecycle control passes. A dataset where
billing did its job yields $0, which is a correct answer rather than a failed detector — treating "a
population we can now reach" as "money we will find" is counting a forecast as proof, one level down.

**Where an amount cannot be established authoritatively, the finding is real and its exposure is UNKNOWN** —
counted, never zero, never averaged from prior invoices, never taken from a plan price, never prorated by us.
Estimation would be a separately governed product in the Revenue Opportunity ledger, never on the OBSERVED
surface. **Nothing is implemented and nothing is authorised**: this needs a MAJOR contract version, because
multi-extract intake changes the idempotency derivation, and it needs a new artefact family so the
single-dataset path stays byte-identical. The prerequisite worth taking on its own merits is the
**obligation-identity contract gap** — `OBLIGATION_IDENTITY_FIELDS` is still frozen empty, `obligation_ref`
was staged once and reverted, and closing it unblocks both this detector and the candidate path that has been
waiting on exactly that condition.

**Obligation-identity audit decision (2026-10-05).** `obligation_ref` was declared once, on 2026-10-01, and
reverted four commits later. The audit of that history found the revert was **not** a rejection of the
semantic idea: the field had no production consumer (`observeObligationReferences` had two call sites, both
in its own test file), the value died at every boundary leaving the request so **six of the seven facts the
future decision needed were uncollectable**, the customer contract doc falsely promised the field was
"recorded and reported back to you", and the verification gate — *"nothing is persisted"* — could not tell
*correctly inert* from *not wired up*. Two rules follow, and both are binding:

> **No identity or correlation field is declared until the production code that reads it ships in the same
> slice.** A declared-but-unconsumed field collects no evidence and invites prose that overstates what
> happens to it.

> **Capability gating per detector, never global dataset rejection.** An identifier a detector needs is
> *optional* at the contract level and a **named prerequisite** for that detector, which **fails closed**
> when it is unavailable. Making it globally required would reject datasets that still measure real money
> through Detectors #1 and #2. This follows the existing pattern deliberately: `leakInstanceIdentityStatus`
> and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are separately named *"because collapsing them would let
> closing either look like closing both."*

Four prior decisions **survive** the revert and still bind ([`docs/S1_OBLIGATION_IDENTITY_AUDIT_V1.md`](docs/S1_OBLIGATION_IDENTITY_AUDIT_V1.md)):
aggregate rows are structurally invisible and **no contract field can promote grain**, because a row-grain
flag hands grain authority to the beneficiary; zero synonyms, with no case folding and no Unicode
normalisation, so two visually identical references are two identities; `dedupeCollisions` runs before any
obligation-level predicate could, and the one candidate completeness gate is satisfiable by pre-aggregating
— *"a gate that points the incentive at the failure is worse than no gate"*; and OPTIONAL never
RECOMMENDED, which is **the same finding** governed issue #1 re-derived independently four days later.

**And the bias that disqualifies the obvious evidence-gathering plan:** references can only be observed on
rows that survive upstream rejection — overwhelmingly single-invoice subscriptions — so the cases an identity
model most needs (consolidation, splitting, re-keying, merges, migrations) are **discarded before any
reference can be read**. An identity model validated on that evidence is validated on the cases it cannot
fail. A generic invoice-level reference is therefore **not sufficient** for cross-system reconciliation: the
two sides identify at different grains, and a billing-system migration changes every key at once, so the
entire expected book would read as missing. The grain question is **open** and belongs to the D2 decision.

**Zero is not correct — reconciliation claim rule (2026-10-05).** Monetary reconciliation compares expected
money against billed money at a governed grain. The temptation it creates is a green tick, so the rule is
constitutional rather than documentary:

> **A zero monetary residual proves monetary equality at the governed reconciliation grain, and nothing
> else.** It does **not** prove event correctness, the absence of duplicate billing, the absence of a
> missing obligation, correct customer or entitlement allocation, correct invoice identity, correct timing,
> or correct attribution. Monetary reconciliation may report **`MONETARILY_BALANCED`**; it may **never**
> imply **`NO_LEAKAGE`**, which requires the independently gated event and attribution capabilities to
> support it.

`NO_LEAKAGE` is to be **unrepresentable** in the monetary surface's type rather than merely discouraged —
the treatment `constitutesProof: false as const` already gets. Two worked cases prove the rule is not
pedantry: a **missing obligation offset by an overcharge**, and a **duplicate invoice masking an omission**,
both net to a zero residual at *any* grain, because both errors live inside the same reconciliation unit.
That is a permanent, grain-independent blind spot of monetary reconciliation, not a dataset-specific doubt.

**The sign convention, fixed once:** `residual = expected − observed`. Positive is **UNDER_BILLED** —
candidate exposure, OBSERVED only. Zero is **MONETARILY_BALANCED**. Negative is **OVER_BILLED** — a
liability signal, **never exposure and never "recovered revenue"**; money the company may owe back is not
money it found.

> **Positive and negative residuals from independent grains are NEVER netted into a smaller company-level
> leakage figure.** A $100 missing obligation and an unrelated $100 surplus are two problems, and their sum
> is zero problems, which is false. The primary money metric is therefore a sum over positives that have
> **no mechanism-linked counterpart**; gross positive, gross negative, optional net, and the unresolved
> grain count are reported separately.

**Doubt is bounded by mechanism, not by co-location.** An earlier form of this analysis claimed any non-zero
residual made every zero in the dataset untrustworthy; that is withdrawn as **conceptually wrong**, not
merely broad — a non-zero residual elsewhere is no evidence about another grain's internals. What is real is
pairing between **non-zero residuals of opposite sign**, and only through a named mechanism: same
entitlement in an adjacent period within the governed grace window, same billing batch, sibling entitlements
of one contract, or sibling contracts of one payer where that relation is authoritative. **Same currency,
same source namespace and same dataset are not mechanisms.** A paired positive is flagged and held out of
the headline pending attribution — never netted, never suppressed. Full treatment in
[`docs/D2_1_RECONCILIATION_SEMANTICS_V1.md`](docs/D2_1_RECONCILIATION_SEMANTICS_V1.md); the grain itself is
**still open** and **nothing is implemented**.

**Expectation extract decision (2026-10-05).** The reconciliation core could compare expected against
billed money but had no source — its `ExpectationRow` was a benchmark type, and contract 2.0.0 cannot
supply one because `next_invoice_due_at` and `next_invoice_amount` are **required**, so an obligation that
was never invoiced has either no row or a rejected one. The gap is in the contract's *shape*, so no field
added there could close it. The governing rule is now:

> **The minimum trustworthy source facts are declared as an additive, separately governed sibling artefact
> with its own pure validator — never as a widening of the observation contract.** One row is ONE EXPECTED
> OBLIGATION, the source enumerates the rows, and **NH never creates, expands, prorates or infers one**.

**Built 2026-10-05** ([`docs/EXPECTATION_EXTRACT_V1.md`](docs/EXPECTATION_EXTRACT_V1.md)): own id, version,
scheme and `exv-2026.1` method version; five REQUIRED facts and **three tiers with no `recommended`**,
because that tier feeds a threshold of zero and would refuse files that previously passed; five separately
named **fail-closed capabilities**, so a missing optional fact closes a gate and **rejects nothing** —
capability gating per detector, never global dataset rejection. **Schema presence is not row-level availability** (v1.1.0): the
`expected_amount` *column* is required, the *value* is not, and four states stay distinguishable — blank is
an UNKNOWN that **preserves the row** with every non-monetary fact in force, malformed is `NH-EX-2005`,
explicit zero is `NH-EX-2018` (writing 0 *asserts* nothing is owed), negative is `NH-EX-2019` (a credit, and
a row in the wrong file). Monetary quantification is declared **per unit** (`NH-EX-3006`) with a roll-up
allowed to say `PARTIAL`, because one flag for a nine-priced, one-unpriced extract would have to lie in one
direction. An unpriced unit still collides like a real obligation — exempting it would let a beneficiary
dodge duplicate detection by blanking a price. `NH-EX-2006` was **retired rather than narrowed** although
nothing cited it, because the catalogue's rule carries no exception. Seven candidate fields were **stopped rather
than invented**, the sharpest being cadence: a frequency NH could expand into rows would make **NH the
author of the expectation**. The validator consults **no clock**, asserted on source. Nothing consumes it in
production, which is deliberate — the slice that wires it must ship its consumer with it, per the
`obligation_ref` revert rule. `OBLIGATION_IDENTITY_FIELDS` stays empty and contract 2.0.0 is unchanged.

**Event-ordering decision (2026-10-05, fixed 2026-10-06).** Found by reading a CI failure rather than
retrying it: the `push` run failed where the `pull_request` run passed on the identical SHA, which is the
signature of a race. `executionEvents` ordered by `[at, id]` under a comment claiming `id` *"breaks ties so
ordering is total"* — total but **not chronological**, because `id` is a random UUID and `at` is
`timestamp(3)`. Measured at 4 ties in 40 trials with **2 ordered wrongly**, and not cosmetic:
`deriveExecutionState` gates transitions by legality, so a reversed pair **drops the terminal transition**
and a finished execution reads as `running`. The governing rule is now:

> **An append-only log's order is the order it was appended in, established by a fact the database
> allocates — never by a clock alone and never by a random tie-breaker. Where no append order was
> recorded, the uncertainty is stated, not resolved retroactively.**

**Built 2026-10-06** ([`docs/GOVERNED_ISSUES_V1.md`](docs/GOVERNED_ISSUES_V1.md) §4): `at ASC, seq ASC
NULLS FIRST, id ASC` with `seq` from a Postgres sequence; `at` stays primary so the order holds across the
migration. **`BIGSERIAL` was the trap** — it backfills in physical heap order, committing a fabricated
chronology to disk — so the column is nullable with a sequence default, legacy rows keep `NULL`, and
`orderCertain`/`orderUncertainAt` label the ambiguity while **leaving every historical derived state
exactly as it was**. A legacy row alone at its timestamp is certain, because `at` alone decides it. `seq`
enters no hash, no API and not `ExecutionLifecycleEvent`. Verified by simulating a live upgrade, which is
the only honest test of the legacy path. The blast radius was classified rather than assumed: no monetary,
finding or identity surface reads event order, `canTransitionExecution` has no production caller, and the
SQL purge guard reads `max(at)` and existence — so it **refused** a mis-branched purge instead of
permitting one.

**Synthetic reconciliation result (2026-10-06).** The reconciliation core had only ever met an abstract
fixture. Given a realistic two-sided export — 614 contract rows and 597 billing rows, 60 payers, 119
entitlements, 43 of them left clean as noise, with **$85,942.00** of planted money and a 28-entitlement
billing migration — it detected **$0.00**. The cause is one line: the unmatched-identity taint is
**dataset-global**, so 98 unmatched entitlements anywhere refuse every positive residual everywhere. I
introduced that guard deliberately, because an entitlement-scoped taint missed the re-key case. The
governing rule is now:

> **Doubt is scoped to the evidence that creates it.** An unmatched observation taints only units whose
> *plausible counterpart* set it could belong to — same payer, adjacent period inside the governed window,
> comparable amount. A refusal with no evidence behind it is not caution, and a detector that refuses
> everything is not cautious but unusable.

**Recorded, not fixed** ([`docs/SYNTHETIC_RECONCILIATION_V1.md`](docs/SYNTHETIC_RECONCILIATION_V1.md)):
the core is preserved in this slice, and recall must never be bought by weakening epistemics. Six further
findings bind the grain decision. **No single identifier survives** the seven lifecycle events: contract
grain and schedule-line grain are **NOT CONSTRUCTIBLE** because billing emits neither — `invoice_line_id`
is a position within an invoice, not a reference to the obligation it settles, which *demonstrates* that
**the obligation reference must be on the billing side**. Payer×period grain is the only one that finds
money (66.16% recall) and **12 of 19 cases are not individually attributable** under it, which collides
with the north star directly: *a grain that cannot attribute a residual to an obligation is not a
reconciliation grain, it is an aggregate*. It also **fabricates $12,798.80** because a per-entitlement
pause cannot be represented when a unit merges siblings, and it turns the duplicate-masking blind spot
into something worse — $19,600.00 of real missing money **mechanism-paired with the duplicate that hid
it**, which is worse than invisible. Dataset-level `coverage.monetary` collapses to REFUSED on 9 rows of
600. The proposal is therefore **governed semantic roles** — obligation-group identity, period identity,
authoritative alias, payer relation (attribution only, never identity) — each separately gated and
fail-closed, rather than one universal key. A bare re-key with no retained key is **correctly a refusal**.
The scorer's own first form double-counted $12,798.80 across co-located mechanisms and was corrected to
score attribution **clusters**; everything is synthetic and turns no observed amount into Revenue Returned.

**Benchmark freeze control (2026-10-06).** The required order — *generate → validate → freeze → record
hashes → run → score* — is enforced rather than described: a **tracked** lock
(`scripts/reconciliation-synthetic/FREEZE.lock.json`) covers the data artefacts **and every harness
script**, the runner refuses to let NH near a moved package, and the scorer refuses to score one. The
governing rule is now:

> **The ruler is part of the experiment.** Scenarios, amounts, identities, mechanisms, expected outcomes,
> denominators **and the scorer** are frozen before the first detection run. If the frozen package exposes
> a defect in NH, fix NH and re-run against the SAME package. If the ground truth is later proven
> objectively wrong, that is a **governed benchmark revision** with explicit evidence and a new freeze —
> never a silent edit, and never one that improves a result.

Two defects in the first form are recorded because both generalise
([`docs/SYNTHETIC_RECONCILIATION_V1.md`](docs/SYNTHETIC_RECONCILIATION_V1.md) §1b). The freeze record was
written by the generator into a gitignored directory, so it was **self-healing**: every regeneration
rewrote it and it always agreed with the bytes on disk — a gate that updates itself cannot detect the only
thing it exists to detect. And the scorer was **not covered, and was edited after the first run**: the
correction was sound (it double-counted money across mechanisms sharing a payer, and it exposed that 12 of
19 cases are unattributable at payer grain) but it moved false-positive money **$22,598.80 → $9,800.00
after the result was visible**, which is the flattering direction. Re-derived under the completed control
the figures are **identical** and the data hashes unchanged, which evidences that the package was never
tuned — and is not a substitute for the gate.

**Resolved as a governed revision on 2026-10-06, not by restoring the known-wrong scorer**
([`docs/BENCHMARK_REVISION_V2.md`](docs/BENCHMARK_REVISION_V2.md)). The rule it establishes:

> **A defective measurement is INVALIDATED and preserved, never deleted and never silently replaced.**
> A revision must prove the business data byte-identical, record both rulers' hashes and the exact diff,
> and state which metrics it affects and which it does not. The freeze names the revision it governs, so
> no figure can be quoted without one.

V1 is kept as **HISTORICAL MEASUREMENT · INVALIDATED FOR DECISION USE** with its reported $22,598.80
intact. Its bytes had **never been committed**, so the artefact is a reconstruction from the recorded
patches, validated by reproducing $22,598.80 and $12,798.80 exactly — and that it needed reconstructing
is the compounding half of the disclosure. The $12,798.80 gap is the M12 pause figure charged twice,
to two mechanisms sharing one payer. **Affected:** only the payer-grain candidate's false-positive
accounting and its per-mechanism attribution. **Unaffected:** planted total, every entitlement-grain
figure, and detected/TP/FN/recall/precision on all candidates — the headline finding does not move.

The **official PRE-FIX baseline** is recorded against the unmodified core `c80b35c5…` before any taint
work, and the two findings are kept distinct, because conflating them would be wrong: the intended
entitlement/subscription path detected **$0.00 because dataset-global taint poisoned every positive
residual** — the path is sound and one guard's scope defeats it — while the payer-period aggregate **did
detect $56,858.30 at 66.16% recall, with $9,800.00 fabricated and 12 of 19 cases unattributable**, and
must not ship as the reconciliation grain.

**Taint-scope correction (2026-10-06).** The dataset-global unmatched-identity taint was replaced with a
scope derived from settlement causality ([`docs/TAINT_SCOPE_V1.md`](docs/TAINT_SCOPE_V1.md)). The rule:

> **Doubt reaches a residual only where authoritative facts make SETTLEMENT possible** — the same payer or
> both under a **supplied** hierarchy, the same period or inside the **governed** displacement window, and
> the governed currency. Conjunctive. Amount similarity, date proximity alone and any name resemblance are
> excluded, because each would make NH the author of the relationship it is supposed to be reading.

On the **same frozen V2 package**, core `c80b35c5…` → `831b2dab…`, data byte-identical: recall **0.00% →
72.56%**, true positive **$0.00 → $62,356.30**, baseless refusals withdrawn (107 → 77, unwarranted 9 → 1)
while **M14's re-key and M15's whole-book migration remain refused**, because for those payers and periods
settlement really is possible. `D_PAYER_PERIOD` is unchanged in every figure — the expected control. The
frozen abstract examiner still passes in full.

**$0.00 of fabricated money is attributable to the correction**, and the $8,969.10 that remains is
decomposed rather than excused: **$8,879.40 is a pre-existing core gap the global taint was masking** — the
reconciliation path has **no ambiguous-live-lines refusal at all** and sums two unsuperseded lines into an
amount neither asserts, which the unwired expectation validator already refuses as `NH-EX-2016`; and
**$89.70 is a measurement transport defect** — `ground-truth.csv` builds its header from `Object.keys(rows[0])`,
so a column present only on the last row was silently dropped, and correctly-detected money was scored as
fabricated. The second was **deliberately left unfixed**, because correcting it would *improve* the result
and may only happen as a governed revision with its own evidence and freeze.

**So the honest answer was: not yet.** The approach is sound and the pipeline still reported $8,879.40
nobody owes. The named next slice — the ambiguity refusal in the core, not a grain decision and not
production wiring — **was taken, and it closed.** See the two decisions below.

**Transport-defect revision, V3 (2026-10-05).** The $89.70 was a *measurement* defect and was corrected
first, because the product correction's success is judged in the units the measurement defines. The fix is
**generic, with no special case**: `csv(rows)` became `csv(rows, declaredColumns)`, the ground-truth schema
is a declared governed list rather than `Object.keys(rows[0])`, and an undeclared key now **throws** instead
of vanishing. The rule it establishes:

> **A serialised artefact's schema is declared, never inferred from a sample of its own rows.** A field that
> appears late must fail loudly, because a transport that can silently drop a column is a ruler that can
> silently shorten.

All eight proof obligations were discharged on evidence: expectation, billing and `planted-register.json`
**byte-identical**; ground-truth semantics identical cell-by-cell across **19 rows × 15 pre-existing
columns**; planted total still **$85,942.00**; 19 mechanisms and cohort sizes identical;
`sibling_entitlements` verified through serialise **and reload**; and a falsifier proving a late field now
raises. `ground-truth.csv` was the only artefact permitted to move, and the only one that moved. **Exactly
$89.70 moved, in one direction, and nothing else changed** — which is what a pure measurement correction
looks like ([`docs/BENCHMARK_REVISION_V2.md`](docs/BENCHMARK_REVISION_V2.md) §V3).

**Ambiguous-live-lines decision (2026-10-05).** The remaining $8,879.40 was a *product* defect in one line
of arithmetic: `es.reduce(...)` summed two unsuperseded expectation lines claiming one unit, producing an
expected amount **neither line asserts** — so the residual measured nothing, it was authored. The governing
rule is now:

> **Addition is permitted only where the source establishes that the lines are DISTINCT ADDITIVE
> OBLIGATIONS. Nothing about their co-location establishes it.** Absent that fact the unit is REFUSED with
> a null residual — never summed, never arbitrated, and never silently dropped.

Same payer, same period, same amount, **different row ids**, row count and source order are all excluded.
The fourth is decisive and kills the obvious answer: *distinct `schedule_line_id`s mean distinct
obligations* is false, because **a duplicated export row has two distinct ids for one obligation**. Eight
source shapes can put two live lines in one unit; **only two are additive** (split schedule lines, additive
components) and they are indistinguishable from the other six — duplicate row, mutually exclusive
alternatives, migration duplicate, unlinked amendment, identical-bound overlap — without an authoritative
fact. A corollary one level down: **a count is not a cardinality.** "Two rows exist" is a fact about the
file; "two obligations exist" is a fact about the business, and the contract carries only the first.

**`NH-EX-2016` has the correct semantic and the wrong remedy for this layer**, which was the question asked
rather than assumed. Its severity is `row_quarantined` — right at validation, where the row never joins a
population; **wrong in the core**, where the obligation has already joined it, so deleting the rows makes a
**real obligation invisible** and the unit reads clean. That is worse than the bug. So the core got a new
state, `REFUSED_AMBIGUOUS_LIVE_LINES`, with null `expectedMinor`/`residualMinor` and `observedMinor`
**retained** — what was billed is a fact; only what was owed is in doubt. The general lesson: **two layers
can share a proposition and need opposite mechanics.**

The minimum permitting fact is a **source-stated component identity** per schedule line, supplied through
governed terms exactly as the payer hierarchy and alias map are — optional, absence refuses, and both
halves required (every line stated **and** pairwise distinct, so two lines labelled `BASE` still refuse).
It is recorded as an **OPEN GOVERNANCE QUESTION, not settled**, because claiming distinctness *inflates*
the expectation and therefore the exposure: it is beneficiary-adverse in the same direction the admission
bar is and needs the same governance before any production use. The frozen package emits no such fact, so
nothing exercises the permissive branch outside its unit tests.

**Measured on the same frozen V3 package, ruler and truth byte-identical, core `831b2dab…` → `ec1efe95…`**
([`docs/AMBIGUOUS_LINES_V1.md`](docs/AMBIGUOUS_LINES_V1.md)): at the intended entitlement/subscription
grain **false-positive money $8,879.40 → $0.00** with **true positive $62,446.00, false negative $3,896.00
and recall 72.66% all unchanged**; precision 68.68% → 76.11%; refusals 21 → 23 with **warranted 2 → 3 and
unwarranted still 0**. The refusal fires on **2 of 600 units** — exactly the two the truth marks
`nh_must_refuse: YES` — and displaced no taint refusal. **That the ruler is byte-identical at `060359f5…`
is the acceptance proof**: the money disappeared because NH refuses the aggregation, not because the scorer
stopped counting it, and the corroboration is in the refusal ledger, which only the product can move.

Two findings fall out and are binding. **The payer-period aggregate is refused on 198 of 309 units**, recall
66.16% → 3.57% — *a diagnosis, not a regression*: that grain merges sibling entitlements by construction, so
nearly every unit **is** an unsupported aggregation. The earlier finding was that it cannot *attribute* a
residual; this one is that it cannot *justify* one, and it must still never ship as the reconciliation
grain. And `R15x` in the frozen abstract examiner is itself an ambiguous-lines case whose authored truth says
$0 while NH produced $100, so the fix moves NH **toward** the frozen truth — `reconciliationScenarios.ts`
stays byte-identical at `7dd786ba…`, all 85 benchmark tests pass, and **no golden was edited.**

**So: yes — on the same frozen synthetic data NH now identifies $62,446.00 of real missing money with
$0.00 fabricated money**, and $0 fabrication cost **no legitimate money at all** at the intended grain. What
remains invisible is stated rather than implied: **$19,600.00 structurally invisible** (M07, a duplicate
invoice masking an omission inside one reconciliation unit — grain-independent and permanent), **$3,896.00**
of money the company *was* paid but against the wrong entitlement or the wrong payer (M08/M09 — an
attribution failure, not missing money), and **three UNKNOWN-money cases** that are counted and never
zeroed. The next exact source fact is **an obligation reference on the billing side** — `invoice_line_id` is
a position within an invoice, not a reference to the obligation it settles — and this is **synthetic**: it
turns no observed amount into proven Revenue Returned.

**Obligation-reference counterfactual (2026-10-07).** The V3 closing report named a billing-side obligation
reference as the next source fact. That was an argument, so it was measured: one controlled variant of the
frozen package carrying **exactly one new column** — `obligation_ref`, stating which contract obligation each
invoice line settles, stated by the source at emission and never inferred. It is not an invented field;
`C_SCHEDULE_LINE` has been declared NOT CONSTRUCTIBLE since the grain study for precisely this reason, and the
frozen truth **pre-registered the hypothesis itself** in a `source_facts_required` column written before any of
this work. The governing rules it establishes:

> **A fact may only settle the questions it can testify about.** Obligation identity refutes a *timing
> displacement* hypothesis, because the reference says which period's obligation a line settles. It cannot
> refute a *misallocation* hypothesis, because under the declared semantics the reference is produced by the
> very allocation step that failed. This is "doubt is scoped to the evidence that creates it" applied to the
> evidence rather than to the doubt.

> **Obligation identity unlocks the MONEY behind duplicate-masking and does NOT establish the DUPLICATE as an
> event.** M05 is one obligation legitimately settled by two lines that sum correctly; under obligation
> identity it is *structurally identical* to M07's double-billed February and to M08's misallocation. A rule
> of "two settlements ⇒ duplicate" fabricates money on two of the three. So NH reports
> `MULTIPLE_SETTLEMENTS_OBSERVED` and **never the word duplicate**; establishing a duplicate needs an
> authoritative **expected settlement count**, which is a second, independent source fact.

**Built 2026-10-07** ([`docs/OBLIGATION_REF_COUNTERFACTUAL_V1.md`](docs/OBLIGATION_REF_COUNTERFACTUAL_V1.md)) as
an **additive sibling** — its own scheme, `oblig-2026.1`, its own witness, its own frozen package, its own
verifier — never a widening of a hashed core, the same pattern Detector #2 and the Expectation Extract set.
`reconciliationCore.ts`, `reconciliationScenarios.ts`, `grainCandidates.ts`, the V3 ruler, the V3 data and the
V3 results are **all byte-identical afterwards**, and the variant's verifier checks that on every run rather
than promising it. Two **controls** — the same variant data through the unmodified core at V3's two grains,
ignoring the new column — reproduce V3 **identically on all 18 scored fields including the witness**, which is
what licenses attributing any movement to the new *fact* rather than to new *code*. The ruler is a byte copy
with `DIR` redirected, the diff is committed, and the verifier refuses any other hunk.

**Result: headline claimable money $60,246.00 → $70,046.00 (+$9,800.00) with false positive $0.00 before and
after**, gross positive unchanged (so the money *moved* between columns and none was created), TP, FN and recall
flat, 12 refusals resolved, and the 28-entry alias map **no longer needed at all** — a bare re-key resolves from
the source's own reference. TP and recall are flat *correctly*: the ruler scores TP over `nh_should_detect: yes`
and M07 is `no`, the frozen truth recording what the **baseline** capability should have found. Reporting the
unlock as a rise in TP would mean re-authoring the truth to match the result, which is the tuning the freeze
control exists to prevent — so the two figures sit side by side and are never blended.

**The experiment found a PRODUCT defect, which is worth more than the money.** The prediction was $19,600.00
released; $9,800.00 was. M07's two entitlements share a payer and a price, and the core's pairing pass takes the
**first exact-amount counterpart in scan order** — so one entitlement's March deficit matched its own February
(`ADJACENT_PERIOD_SAME_ENTITLEMENT`, refuted, released) while the other matched the *sibling's* February first
(`SIBLING_ENTITLEMENT_SAME_PAYER`, not refutable, still held). The rule:

> **The pairing mechanism assigned must be decided by evidence, not by row order.** Where several
> counterparts are reachable, the **most specific** hypothesis wins; a conclusion that depends on an order
> nothing authoritative established is the event-ordering defect in another costume.

The refutation rule is not too strict — loosening it would release M08's $2,798.00, money the company was
already paid. **The next $9,800.00 therefore needs no customer field at all**, only that fix, which is left
undone here because the core was out of scope.

**Two of my own earlier claims are corrected on evidence.** M07's $19,600.00 was called *"structurally
invisible… inside one reconciliation unit — grain-independent and permanent."* **Wrong on both counts**: at
entitlement×period grain February and March are *different* units, and the money was held by the pairing rule —
a deliberate hold pending attribution, not a structural blindness — and it is not permanent, being half a source
fact and half a product fix away. The constitution's general duplicate-masking claim still holds *where both
errors live inside one unit*; that was not this case. Separately, `coverage.event` reads **AVAILABLE** whenever
the *expectation* side is keyed, while an event check needs **both** sides — so it claims availability exactly
where V3 cannot do it. Reported and pinned by a test, **not patched**, the core being out of scope.

**The business answer — the minimum customer data request.** One field. The billing-side obligation reference
unlocks **$9,800.00 of $85,942.00 planted (11.4% of planted money, +16.3% on headline claimable money)** with
zero fabricated money, and is the **only** field in the experiment that unlocks any money at all. Ranked after
it, each unlocking **$0.00** here and buying capability instead: expected settlement count (the duplicate
*event*), the contract-side distinct-additive-obligation declaration (M17 — and it *inflates* exposure, so it
needs governance first), a governed FX rate, an authoritative usage amount (which does not exist to be
supplied), and the payer hierarchy (already supplied). Three caveats bind any use of that table: **a field
unlocking $0.00 here is not a field unlocking $0.00 in general** — M14 and M15 hide $0.00 *by construction*,
while in a real book a re-key conceals whatever sits behind it; **capability is not revenue**, which is why
29 never-settled obligations and 12 resolved refusals are reported apart from money; and **asking a customer
for data to fix a defect in our own code would be the wrong request.** Synthetic throughout: it turns no
observed amount into proven Revenue Returned.

**Pairing-order decision (2026-10-07).** The counterfactual predicted M07 would release $19,600.00 and
released $9,800.00. The cause was not a missing source fact: the pairing pass scanned the negative units and
took the **first** whose amount matched, so with two counterparts reachable the mechanism assigned — and
therefore whether the money could ever be claimed — followed array position. M07's two entitlements share a
payer and a price, so one matched its own February (refutable, released) and the other matched the sibling's
February first (not refutable, held) under a mechanism that was factually wrong. **The defect cut both ways,
which the first analysis missed:** the released half was equally order-luck, since the other sibling's
February was just as reachable. The governing rule is now:

> **Pairing must be determined by authoritative business relationships, never by iteration order.**
> Enumerate every plausible counterpart with no early exit; classify what each would have to *claim*; drop
> the candidates whose claims the evidence refutes; pair **only when exactly one survives**; otherwise
> **hold** and say that more than one did. Never array, CSV, database or lexical order, never amount
> similarity or date proximity alone, never first match, and never an arbitrary stable sort.
> **Determinism is necessary and is not evidence** — a stable tie-break makes a guess reproducible, the
> same error as breaking an append-only log's ties with a random id and calling the order total.

The mechanism ranking is not invented from "looks more specific"; what ranks a candidate is what it must
**claim**. `TIMING_DISPLACEMENT` says the obligation was settled in the wrong *period*; `MISALLOCATION` says
the money reached the company under the wrong *identity*. A same-period sibling claims only the second. A
**cross-period** sibling claims both, and the load-bearing rule is that

> **a compound hypothesis needs support for each of its parts and dies with either one.**

That single property is what corrects M07 without weakening the M08 protection, and **nothing in the code
names M08**: obligation references refute timing claims and are silent on allocation claims, because under
the declared semantics the reference is produced by the very allocation step that failed. So M08's pure
same-period misallocation survives and its $2,798.00 stays held, while a cross-period sibling dies with its
timing half. The core itself **refutes nothing** — it holds no fact that speaks to either claim — and the
obligation reading injects the predicate into the **same** `selectPairing`, because a second selection rule
is a second chance to disagree.

**Built 2026-10-07** ([`docs/PAIRING_ORDER_V1.md`](docs/PAIRING_ORDER_V1.md)), core `ec1efe95…` →
`fdc6c785…`. On the same frozen variant with the ruler and the data untouched: **headline money
$70,046.00 → $79,846.00**, **false positive $0.00 before and after**, **gross positive unchanged** — so the
money *moved* and none was created, and every newly claimable dollar is attributable solely to removing the
order dependence. TP, FN, recall, precision, UNKNOWN, unpriced, refusals and attribution coverage all
unchanged; **exactly one mechanism moved** (M07, paired $9,800.00 → $0.00); M08, M05 and M18 unchanged. The
variant's two controls now carry witnesses **byte-identical to V3's own**, which is the strongest form that
proof can take.

**V3's money is unchanged and its witness is not, and both facts matter.** Every monetary and count field on
all three constructible candidates is **identical**; the witnesses for the two entitlement-grain candidates
moved because the *mechanism* is in their preimage and the mechanism genuinely changed — M07's two units now
read `AMBIGUOUS_MULTIPLE_COUNTERPARTS` rather than one adjacent-period and one sibling label chosen by
position. `D_PAYER_PERIOD` is unchanged outright, because that grain merges the two entitlements so no
competing candidate arises. **The earlier claim "V3 reproduces byte-identically" must not be repeated:** it
held across a *measurement* correction and cannot hold across a *product* correction. The recorded baseline
is preserved as the historical record of the pre-correction product, and what reproduces byte-identically now
is every monetary and count field — which is the claim worth making.

**Capability-reporting decision (2026-10-07).** `coverage.event` answers whether NH can reconcile the
settlement *events* and not merely the money. It read AVAILABLE whenever every live **expectation** carried
a schedule line — one side of a two-sided join. `ObservationRow` carries no obligation reference at all, so
the billing side was unkeyed **by construction**, and the field announced the capability in exactly the
situation where the work could not be done, on every run of the frozen package. Reported as a finding by the
counterfactual and corrected here, in its own commit. The rules:

> **A capability is declared AVAILABLE only by a layer that holds the facts required to perform it.**
> Reporting availability from a subset of those facts is a claim about the product, not about the data.

> **The unavailable states stay DISTINGUISHABLE.** *Nothing keyed* and *the expectation side keyed while the
> billing side is silent* are different positions, and collapsing them hides **which half is missing** — the
> only part of the answer that says what to go and get. The same reason `leakInstanceIdentityStatus` and
> `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named separately.

**Built 2026-10-07** ([`docs/CAPABILITY_REPORTING_V1.md`](docs/CAPABILITY_REPORTING_V1.md)): a third state,
`UNAVAILABLE_BILLING_SIDE_UNKEYED`, is now the core's answer **always** — it cannot reach AVAILABLE, which
is the point and not a limitation, because its row type has nothing to join on. The obligation-reference
reading earns the upgrade only when it is genuinely earned: every expectation keyed, **no** billing row
unkeyed and **no reference dangling**, because a key that joins to nothing is not a key. **Every monetary
and count field on every candidate of both frozen packages is identical**; the claim is withdrawn exactly
where it was false and kept exactly where it is true — `F_OBLIGATION_REF` has both sides keyed and stays
AVAILABLE. One lesson recorded because it is the fifth instance: the "no money moves" test's first form
compared a dataset with itself and proved nothing, and the real property needed two datasets differing in
**capability** while agreeing in **money** — a credit supplies it, since credits are excluded from billed
money. **A test that cannot fail is not a control.**

**Customer data readiness decision (2026-10-07).** The synthetic phase answered *can NH find money*
($60,246.00 → $79,846.00 claimable, $0.00 fabricated, synthetic only). The next question is different and
is answered by looking at files rather than at money: **can a real customer supply the authoritative facts
that capability rests on?** Built as a **validation-only** path — no customer leakage, no monetary finding,
no Recovery Case, nothing persisted, no API and no screen
([`docs/CUSTOMER_DATA_READINESS_V1.md`](docs/CUSTOMER_DATA_READINESS_V1.md)). The rules:

> **A capability is declared available only by a layer holding the facts to perform it, and the answer is
> a LEVEL, never a boolean.** The presence of `obligation_ref` licenses *monetary reconciliation possible*
> and leaves *exact money* and *event proof* closed. A boolean "ready" would announce a capability from a
> subset of the facts it needs — the `coverage.event` error one layer out.

> **Structural presence is not authority, and a request parameter can never declare a source
> authoritative.** The caller is the beneficiary of a larger number. The ladder is `PRESENT` →
> `VALID_FORMAT` → `SOURCE_NATIVE` → `AUTHORITY_VERIFIED`, with `AUTHORITY_UNVERIFIED` terminal and
> **outside** the order. **Nothing in this slice reaches `AUTHORITY_VERIFIED`** — no provenance channel
> exists — so the ceiling is `SOURCE_NATIVE`, every level is **PROVISIONAL**, and the refusal of
> self-vouching is *structural*: the evaluator has no parameter by which provenance could be asserted.

> **A readiness report contains NO money.** Estimating blocked dollars before reconciliation has run on a
> customer's data would be a forecast presented as a finding. Enforced by a test that walks the whole
> returned object for monetary keys and `$`-figures.

The billing side **did not exist**: contract 2.0.0 describes a subscription observation whose
`next_invoice_due_at` is required and cannot carry an invoice line, and the synthetic `observation.csv` was
a benchmark artefact with no schema. So `nh.settlement-extract@1.0.0` is a third **additive sibling** —
own scheme, `sxv-2026.1`, `NH-SX-####` catalogue, one row = ONE SETTLEMENT LINE, six required facts, five
fail-closed capabilities that reject no row, and every code carrying `ownedBy` so a report says which team
to route it to. Its own stopped fields mirror the expectation side's: **`expected_amount` on the billing
side is refused** exactly as `invoice_ref` is refused on the contract side, because billing stating the
expectation is billing auditing itself; `is_duplicate` is refused because duplication is a conclusion NH
must reach, never a field the customer supplies. **`settled_amount` has no declared UNKNOWN** while
`expected_amount` does — what was *owed* can genuinely be unknown, what was *billed* cannot.

**The control caught a defect in my own gate, and it was the dataset-global taint repeated.** The first
obligation-link gate also required zero dangling references; on the frozen variant that dropped the whole
dataset to L1 because **11 settlement rows of 597** name obligations whose expectation rows were correctly
quarantined (2 × `NH-EX-2016` ambiguous lines, 9 × `NH-EX-2008` non-governed currency). Blocking a
98%-joinable book is not caution:

> **A dangling reference is a PER-UNIT condition** — counted, carrying its interpretation, gating nothing
> at dataset level. L2 means *the join can be formed*; L3 means *amounts are authoritative throughout*.

**The `obligation_ref` stopped-field record is PRESERVED UNCHANGED and corrected by an append-only
erratum** in its own file, so append-only is structural rather than promised: *a superseded conclusion is
corrected and preserved, never deleted and never silently rewritten.* **No longer valid:** that a
whole-book migration defeats an obligation reference — refuted by measurement, M14 and M15 both resolving
from the reference alone with no alias map, because a stable external reference was never billing's
internal key. **Still binding:** different grains, many-to-many consolidation and splitting,
`schedule_line_ref` staying scoped within its extract, and **the grain question remaining open**.
**Resolved by relocation:** the key lives on the billing side and stays stopped on the expectation side.
A `SUPERSEDED IN PART` marker sits beside the original while its prose stays byte-identical, pinned by a
test; `EXPECTATION_EXTRACT_VERSION` stays **1.1.0**, because fields, tiers, validator semantics and
acceptance behaviour did not move and a version signalling a change that did not happen is its own defect.

**The no-production-importer guard moved with its consumer rather than being deleted.** It existed because
the extract was deliberately unwired, enforcing *the slice that wires a field must ship its consumer with
it*; this slice is that consumer, so the guard is **narrowed** to the property it was protecting — the
importers are exactly the four readiness-path files, named, and **no monetary, reconciliation or assessment
module may reach it.** Its scan now strips comments, because a prose mention in `settlementExtract.ts` is
not a dependency: fourth instance of **a structural guard must read code, not documentation.**

**Control: 25/25, read-only over both frozen packages**, which `recon:verify` and `recon:ref:verify` both
confirm afterwards. V3 → `NH-SX-3001`, ceiling **L1**; the variant → **L2**; M16's blanks stay UNKNOWN with
rows preserved and L3 refused; M17 stays unresolved at `NH-EX-2016`; M19 converts nothing; neither package
fabricates authority. The customer-facing request
([`docs/PILOT_DATA_REQUEST_V1.md`](docs/PILOT_DATA_REQUEST_V1.md)) is **generated from the field specs**
and a test asserts it matches, because a data request derived by hand drifts silently and the customer
discovers it at reconciliation. **Expected settlement count is NOT mandatory** — the evidence is that it
upgrades event-level proof and unlocks no additional money.

**Pilot intake package (2026-10-07).** Readiness V1 could judge a customer's files and there was nothing a
finance or data owner could be handed. Built as ten artefacts in `docs/pilot-intake/` — the governed
request, two header-only templates, two synthetic examples, a field dictionary, a pseudonymisation guide, a
13-point checklist, a may/will-not explainer and a one-page README — **generated from the same governed
field arrays** so a column cannot appear in a template, a dictionary entry or an example without appearing
in the contract that validates it. The rule it adds:

> **An artefact that LEAVES the repository is verified by the code a customer's file will actually meet,
> not by a bespoke checker.** The examples are run through the real validators and the real readiness
> evaluator; an example that would be rejected in practice fails the build instead of reaching a data
> owner who gathers the wrong thing and discovers it weeks later.

**Two claims are deliberately bounded rather than quoted.** `obligation_ref` is presented as *the
highest-value field we tested in a controlled experiment on synthetic data, the only one that increased
claimable money, with no fabricated findings* — and the **figure is withheld on purpose**, stated in the
document itself: a number from data we generated would read as a forecast for the customer's book. The
first draft quoted **+32.5%**, and the guard that was supposed to catch it banned only `$`-amounts, so the
verifier now refuses **any uplift percentage** in a customer-facing document too. Expected settlement count
is **not mandatory**, worded strictly inside the evidence — *in that experiment it improved event-level
proof without increasing monetary coverage, a result about that experiment* — with no generalisation.

**Additive components are not demonstrated, because they are not supported.** The expectation contract
declares no component-identity field, so the package says plainly: *if two obligation lines legitimately
cover one period, tell us — we refuse to price that unit rather than add them, and we are not asking you to
invent a field to unlock it, because a flag declaring two lines separate would increase the exposure we
report.* Inventing the column to satisfy an example would have been the exact thing the contract refuses.

**Five of the verifier's own checks were defects in the instrument, not the package**, and all five are the
same family this repository keeps meeting. A phone-number pattern matched **ISO dates**, because
`2026-01-01` is ten characters of digits and hyphens — fixed by scanning per cell and excluding valid
dates, amounts and flags. A containment test flagged `SL-7781` for containing the invoice **line number
"1"** — fixed by requiring a value to be long enough to be a key before containment counts. The
forbidden-import scan **flagged the verifier for naming the forbidden modules in its own list** — fifth
instance of *a structural guard must read code, not the words the code is talking about*. The
package-consumer scan matched the bare word `pilot-intake` and flagged a pre-existing
`INTAKE_KIT_VERSION = "pilot-intake-2026.1"`, which would have had me "fix" two files that were never
wrong. And it flagged `dataReadiness.test.ts`, which is a consumer we **want**: the guard's subject is
production code, so tests are now separated and the **positive** half is asserted too — a drift test must
exist, or the package could rot with nothing noticing.

**55/55 package checks and 25/25 readiness control**, with every frozen artefact byte-identical and
`expectation extract 1.1.0` / `settlement extract 1.0.0` / contract **2.0.0** unmoved. Validation only: no
production reconciliation, no multi-extract identity, no API, no UI, no customer data.

**Customer-package semantic audit (2026-10-07).** An independent read of the GENERATED artefacts found
three contradictions that **every existing check had passed** — 55/55 package checks, 25/25 control, CI
green. The lesson is the slice's main output:

> **Proving a generated document matches its specs is a different claim from the document being
> internally coherent.** A generator can render two governed facts that are each true at their own layer
> and contradict each other on the page. A formal tier is a statement about what the VALIDATOR rejects; a
> capability is a statement about what the EVALUATOR can then do; rendering the first and calling it the
> answer is how a minimal ask stops being sufficient for what it promises.

**Defect 1 · requested and stopped at once.** The request rendered `STOPPED_FIELDS` verbatim, so it told a
customer that *"obligation_ref as a cross-system join key"* is NOT requested, three sections after
requesting exactly that. The entry is real, **SUPERSEDED IN PART**, and is **preserved unchanged**. The
rule: *a superseded conclusion may be referenced as history and must never instruct a customer.* The
filter is driven by the append-only erratum rather than a hand-kept exclusion list, so a future correction
needs no change at the render site.

**Defect 2 · a dependency the ask did not state.** `obligation_ref` was called mandatory in practice while
`schedule_line_ref` — the thing it resolves against — was listed as merely optional. **Proved by
measurement, not argued:** dropping either one, as an absent column *or* as blank cells, takes readiness
from *exact money* to *structurally valid*. Two independent mechanisms require it —
`EXPECTATION_EVENT_IDENTITY_AVAILABLE` is a conjunct of monetary reconciliation, and `acceptedObligations`
is built from `scheduleLineRef`, so every reference dangles without it. Both now appear as a
**mandatory-in-practice pair**, with the formal tier stated beside it, because both facts are true.

**Defect 3 · a column and a cell are different events.** `expected_amount` was documented as *"may a cell
be blank? YES — blank = UNKNOWN"* and, three rows below, *"effect of absence: REJECTS THE ROW"*. Both came
from the tier, and the tier cannot answer both questions.

**So no customer-facing consequence is derived from a tier any more — it is PROBED.** A new
`scripts/pilot-intake/dependency.ts` runs minimal fixtures through the real validators and the real
readiness evaluator, once whole, once with the column removed, once with every cell blank, and the
document states what happened. The probe immediately distinguished three cases one sentence could never
have covered: a missing `expected_amount` column is an extract fault while a blank cell is an **accepted
UNKNOWN**; a blank `is_credit` is **harmless** because blank is its declared meaning; a blank
`obligation_ref` **forfeits the capability entirely**. The rule:

> **A customer-facing claim about what a field is worth is generated from the behaviour of the code that
> will judge their file, never authored beside it.**

Three further contradictions in the same family were found by sweeping every entry. **Supplier is not
issuer:** `obligation_ref` arrives in the billing export but its value is the contract system's, and
listing only *"owned by: Billing / ERP"* invites a billing team to supply their own key — the exact failure
the field exists to prevent. **A refusal must name its export:** three stopped entries refuse a column on
one side that is genuinely requested on the other (`expected_amount`, `invoice_ref`), which reads as a
contradiction without the qualifier. **`settled_at` meant "raised or settled"** — raised is not settled;
it is now the date the line was RAISED, explicitly not a payment-clearing date. Two spec descriptions were
clarified; **no field, tier, validator behaviour or version moved**, so expectation extract stays
**1.1.0** and settlement extract **1.0.0**.

**Two of the four new falsifiers caught my own instruments first**, both the same recurring shape: the
requested-versus-stopped check had no notion of which export a refusal was about and reported three false
contradictions, and the self-contradiction sweep matched `/reject/i` inside *"No row is rejected"* — the
**sixth** instance of a guard matching a term rather than a claim. **88/88** package checks, 25/25 control,
every frozen artefact byte-identical.

**Settlement-event semantics decision (2026-10-07).** The last customer-facing contradiction was one
field describing two different business events: `settled_at` said *"the date the billing system RAISED
this line"* and, on the next line, that it establishes *"when the settlement event occurred"*. Raised is
not settled. It was answered by **archaeology rather than by choosing wording**, because choosing would
have silently decided a contract semantic. The evidence, all of it recorded verbatim above
`SETTLEMENT_EVENT_DEFINITION` in `src/contract/settlementExtract.ts`: `ObservationRow` — the reconciliation
core's input — carries **no date but the service period**, so no monetary, pairing or refusal logic has
ever read a settlement date; the **only** consumer of the field anywhere is the validator's format check,
and `AcceptedSettlement.settledAt` is read by nothing; the one governed experiment maps the frozen billing
export's **`issued_at`** onto it, and that export has **no payment column at all**; the core's amount field
is `billedAmountMinor` and `settled_amount` already established *how much was BILLED*; and payment lives
elsewhere under its own name, `next_invoice_paid_at`, in contract 2.0.0. **Case A: usage has been
consistent and has always been the invoice/charge event.** So there was no drift to repair and no version
decision to make — the defect was in the NAME and one line of prose. The rule:

> **The event an extract records is stated ONCE, canonically, in the contract, and every customer-facing
> description is rendered from it.** Where a column name leans towards a different event than the one it
> records, the correct remedy is to say so wherever the name appears — not to let the name teach the
> semantics, and not to quietly redefine the field so the name becomes true.

`SETTLEMENT_EVENT_DEFINITION` now carries `theEvent`, four `isNot` exclusions, `dateMeans`, `amountMeans`,
a `nameCaveat` and `whyNotRenamed`; the package renders all of it, including a *"Export B is INVOICES, not
payments"* block and a ⚠ **"The name is misleading"** row on both fields, so a finance team that hears
"settlement" and reaches for the cash-application system is stopped before exporting the wrong file —
*an unpaid invoice is exactly as useful to us as a paid one*. "Settlement export" is gone as a label; it is
**B · billing export — invoice lines**, and a falsifier bans *settlement export*, *payments export* and
*cash application* in every document. **No field, tier, validator behaviour or version moved:** expectation
extract stays **1.1.0**, settlement extract **1.0.0**, contract **2.0.0**.

**It is NOT a legacy name, and that is raised rather than hidden.** `git log -S` proves both names were
introduced by this project in `398f658`, **three commits** before the audit found them. A rename to
`invoice_raised_at` / `invoice_line_amount` is the better long-term fix and is cheapest now — the extract
has never been sent to anyone, holds no customer data and has no production consumer — but it is a **schema
decision with an owner**, so it is **proposed, not taken**. **102/102** package checks, 25/25 control,
every frozen artefact byte-identical. Four falsifiers were added and **all four caught my own instruments
first** — including rendered `isNot` bullets that carry no negating word on their own line, the **seventh**
instance of a guard matching a term rather than a claim, and a stale document proving that **editing the
emitter is not regenerating the package**.

**Billing-extract rename decision (2026-10-07).** The owner's call, on the archaeology above: a caveat
telling a customer to read `settled_at` as a raise date is a **stand-in for the fix**, and the fix was
cheapest before the package was ever sent — the extract had reached nobody, held no customer data and had
no production consumer. So `settled_at` → **`invoice_raised_at`**, `settled_amount` →
**`invoice_line_amount`**, and the artefact itself `nh.settlement-extract` → **`nh.billing-extract`**.
The semantics do not move: the event has always been A CHARGE WAS RAISED.

**The audit finding that makes it more than readability:** the token was already overloaded **inside this
repository with the opposite meaning**. `saasActivation.ts` declares `settled_amount` as a header synonym
for **`paid_amount`** in contract 2.0.0, and `pilotDataContract.ts` carries
`settledAmountMayNotExceedObligation`. In the observation contract *settled* means **paid**; in the
settlement extract it meant **billed**. One token, two opposite events, two live artefacts. Both
contract-2.0.0 sites are correct in their own artefact and were left alone. The rules:

> **A version is a claim about THAT ID's history.** The successor is `nh.billing-extract@1.0.0`, not
> `2.0.0`: a `2.0.0` would assert a `1.0.0` under the new id which never existed and which no customer
> could have built against — a version signalling a change that did not happen. Succession is recorded as
> a **link**, never as a number. Nor is it compatibility: a file declaring the old id is refused outright
> as an unknown artefact, which is **stronger** than a major bump because there is no silent upgrade path
> at all. Had the id stayed, `COMPATIBILITY_POLICY` would have forced a MAJOR — it lists *"Remove or
> rename a field"* verbatim.

> **A frozen record of DATA is evidence; a parser is MACHINERY.** That is how "keep 1.0.0 inspectable"
> and "invent no compatibility layer" stop contradicting each other. The declaration and the `NH-SX-`
> catalogue are preserved unchanged in `src/contract/historical/`; the **validator is not**, because it
> could accept the retired column again, so it was renamed forward. A test asserts the historical
> directory exports no function and validates nothing.

> **The rename stops at the artefact boundary.** Where *settlement* names the act of settling an
> obligation it is correct and stays: `EXPECTED_SETTLEMENT_COUNT_AVAILABLE`, the settlement-count stopped
> candidate, and every use in the frozen reconciliation core — which is byte-identical afterwards.
> Renaming it would have destroyed a true distinction, which is the *stay distinguishable* rule again.

**Built 2026-10-07** ([`docs/BILLING_EXTRACT_RENAME_V1.md`](docs/BILLING_EXTRACT_RENAME_V1.md)), and the
equivalence is **derived rather than asserted**: a 10-test succession proof applies the two-entry rename
map to the old column list and requires it to reproduce the new one **in order**, checks every field's
tier, kind, PII class, capability, observability and owner field-for-field, and proves `NH-BX-####` is
`NH-SX-####` with the numbers, severities and owners intact. **Five mutations were tried and all five
fail**, including a tier change smuggled in as a rename. `DATA_READINESS_SCHEME` → `-v2` because
`ReadinessReport.settlement` became `.billing` and a reported key is part of the shape; its **method
version does not move**, because no level, gate, conjunct, count or refusal changed. Contract **2.0.0**
and expectation extract **1.1.0** unmoved; every frozen artefact byte-identical; no monetary or readiness
figure moved.

**The caveat's absence is now itself a checked obligation** — a stale warning about names that no longer
exist is the same class of defect as the contradiction it covered for — and the ban extends to the four
CSVs, not just the seven documents. The *"Export B is INVOICES, not payments"* block **stays**: that
hazard is a finance team reaching for the cash-application system, which is about the concept and not the
column name.

**Two of the new guards caught my own instruments first, and the second one generalises.** The readiness
control pinned the code family as `/^NH-(EX|SX)-\d{4}$/` — an alternation a literal rename cannot see —
and failed 2 of 25 on codes that were perfectly correct. Then the importer guard **counted a citation as a
dependency**: it stripped comments and matched the retired filename anywhere, so it flagged the successor,
whose *version-history string* names the retired module, and flagged the record for importing its own
catalogue. It now reads **import specifiers only**. **Eighth instance** of the same lesson: a structural
guard must read code, and specifically the construct it is actually asking about — a term is not a claim,
a prose mention is not an import, and a string literal is not a dependency.

**165/165** package checks, **25/25** control, 1071 + 1 skipped with and without a database, 599/599 ep2,
120/120 journey. What still blocks a first real export is unchanged and is not the naming: **nothing
reaches `AUTHORITY_VERIFIED`**, so every readiness level stays PROVISIONAL at a `SOURCE_NATIVE` ceiling.

**Minimal provenance attestation decision (2026-10-07).** The owner's call: the absence of verified
authority must **not** block requesting or inspecting the first real customer exports — data may be
accepted at `SOURCE_NATIVE`/PROVISIONAL with that qualification preserved — and the smallest practical
step towards verified authority should be built without delaying the request. Built as a one-page
declaration by the customer's data-owning **role**, sent with the exports, which NH then checks against
the files ([`docs/PROVENANCE_ATTESTATION_V1.md`](docs/PROVENANCE_ATTESTATION_V1.md)).

**A new authority rung was necessary, and it was proved rather than assumed.** It cannot be
`AUTHORITY_VERIFIED`: that rung means *evidenced by a channel the beneficiary cannot unilaterally alter*,
and the repository already holds its one implementation — `sourceVerification.ts` verifies Ed25519 over a
payload signed by a key **the source system holds and the submitter does not**. An attestation is written
by the submitting side, which the Trust Invariant's standing test names explicitly, and that side can
revise the attestation and the file together. It also cannot stay `SOURCE_NATIVE`, whose own ceiling
reason says *NOTHING* establishes the bytes left the system unaltered — with a row count committed before
the result was known and then checked, that is false. And the two may not be collapsed, because *the
unavailable states stay distinguishable*. So: **`SOURCE_ATTESTED`**, between them, via a new
`DATA_OWNER_ATTESTATION` channel kept separate from `SYSTEM_OF_RECORD_ATTESTATION` — that one means the
*system* asserts it, which is why it can reach the top rung and a person's declaration about the system
cannot. Channels now carry `reaches`, so implementing a weak channel can never imply a strong rung. The rules:

> **A rung may rest only on what NH can CHECK. A claim NH cannot check is recorded, attributed and
> labelled — never counted as evidence for it.** Every declared fact is classified once as
> `CORROBORATED`, `WELL_FORMED` or `UNCORROBORATED_CLAIM`. **Three of the six things a pilot wants to know
> about provenance have real corroboration and three have none**, and the report distinguishes them.
> Denying all three uncheckable claims leaves the rung standing — they were never holding it up.

> **A pre-commitment is evidence; a shape is not.** The row count is the only entry that makes a later
> change visible, which is why it is there. The join check catches independently pseudonymised files,
> which produce no overlap at all. Both are **necessary evidence and never proof** — a consistently
> re-keyed pair passes them, and the rung does not claim otherwise.

> **A contradicted attestation fails CLOSED and the contradiction is NAMED**, because a declaration that
> disagrees with the file is worse evidence than no declaration. An unreadable export makes the row count
> `NOT_CHECKABLE` rather than contradicted — an extract fault has its own code and blaming the attestation
> would point the customer at the wrong thing — and *we could not look* still does not pass.

**It is deliberately not named `VERIFIED_FOR_PILOT`**, which the owner proposed and which was argued down
on evidence: a rung whose name contains VERIFIED gets quoted without its qualifier, and this repository
had just spent two slices fixing exactly that (`settled_at`). `attested` **stays refused** as a request
key — the rung is derived from checks, never supplied, and the caller hands over a *declaration* while NH
computes the *verdict*. That asymmetry is structural. **A role, never a person**, reusing
`DatasetProvenance`'s own choice: minimization says the pilot needs joins, dates and amounts, not people.

**Nothing is gated on it.** With no attestation the report is byte-for-byte what it was, asserted by a
control that strips authority and compares the rest, and the form tells the customer the exports may be
sent without it. `DATA_READINESS_METHOD_VERSION` → **`rdy-2026.2`** because a new state is genuinely
reachable; the **scheme stays `-v2`**, because an optional field is additive and scheme ids move on
*breaking* changes. **215/215** package checks with five mutations proved to fail, **25/25** control with
both frozen packages still `SOURCE_NATIVE`/PROVISIONAL, 1094 + 1 skipped with and without a database,
599/599 ep2, 120/120 journey, every frozen artefact byte-identical.

**Two findings recorded rather than patched.** `ReadinessReport.level` documents itself as *"never above
what authority permits"* while the level is computed from capabilities alone and authority only sets
`provisional` — the `coverage.event` shape, harmless today because `provisional` is always true, pinned
by a test that measures the gap and left for its owner. And a structural guard matched
`provenanceEstablished` **inside the comment saying the field is not accepted** — the **ninth** instance
of a guard reading prose instead of code.

**What would justify `AUTHORITY_VERIFIED`**, unchanged and still the only thing blocking a first *trusted*
export: a signed export, a fetch NH performs itself, a machine-issued system-of-record attestation, or
third-party reconciliation — the last being the only one whose corroborating party is not party to the
claim.

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
