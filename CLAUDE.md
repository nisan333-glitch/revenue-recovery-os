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
