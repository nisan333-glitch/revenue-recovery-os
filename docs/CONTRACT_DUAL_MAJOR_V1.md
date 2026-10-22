# §10's two-major promise — what it says, what the code does, and the smallest honest reconciliation

**Status: decided 2026-09-26 (EP-27), verdict C.** Prerequisite 2 of the binding order in
[`ASSESSMENT_IDENTITY_V1.md`](ASSESSMENT_IDENTITY_V1.md). No contract version is bumped by this document
or by the slice that implements it.

## 1 · Exactly what §10 promises

One sentence, in the published contract:

> Two majors are supported concurrently for at least one full pilot cycle.

Echoed in one machine-readable place, `VERSIONING_POLICY.deprecationWindow` in
`src/contract/pilotDataContract.ts`: *"one full pilot cycle, minimum"*.

Two things are worth stating precisely, because both matter to the verdict.

**The promise is about the DATA CONTRACT.** §10 sits inside *Customer Pilot Data Contract v1*, whose
subject is what a customer's export must contain: fields, identifiers, time, money, provenance, PII,
validation codes. The promise a customer reads is *"the file I built against the old major keeps being
accepted for a while"*. It is not a promise about our HTTP request envelope, which that document never
describes.

**"One full pilot cycle" is nowhere defined.** No duration, no start event, no end event, in any document
or constant. It cannot be implemented as a timer without inventing a commercial period nobody has
decided, so this slice does not invent one — see §7.

## 2 · Every current code path that assumes a single major

Found by reading, not assumed.

| Path | What it assumes | Evidence |
|---|---|---|
| `isSupportedContractVersion` | declared major **must equal** implemented major | `pilotDataContract.ts:543-551` — `if (d.major !== impl.major) return false` |
| `deriveIdempotencyKey` | the key embeds `PILOT_DATA_CONTRACT_REF`, which is `id@`**full version** | `validateDataset.ts:538-543` — so the key changes on every **patch**, not only every major |
| Schedule-time re-check | the decision's version **exactly equals** the build's | `pilotAssessmentService.ts:221` — `decision.contractVersion !== report.contractVersion` ⇒ `NH-AX-1006` |
| `report.contractVersion` | records the **implemented** version, not the declared one | `validateDataset.ts:492` — `contractVersion: PILOT_DATA_CONTRACT_VERSION` |
| Submission persistence | stores only `contract_version`; **`declaredVersion` is never persisted** | `prisma/schema.prisma` → `PilotDatasetSubmissionRecord` |
| Both data clients | hardcode `declaredVersion: PILOT_DATA_CONTRACT_VERSION` | `pilotIntakeClient.ts:104`, `pilotAssessmentClient.ts:154` |
<!-- SUPERSEDED 2026-10-04 (S5), for the SECOND client only: the assessment client sends no
     `declaredVersion` at all, and the scheduling body has no such field. The row above is left as the
     evidence this decision was actually made on, not retrofitted to today's code. The intake client is
     unchanged. See REFERENCE_FIRST_SCHEDULING_V1.md. -->
| `VERSIONING_POLICY` | exported and **never read by anything** | no consumer anywhere in `src/` or `server/` |

**The decisive observation.** `declaredVersion` reaches exactly two places: the version gate, and being
echoed back in the report. There is **no version-conditional interpretation anywhere in the validator** —
not one branch. So "supporting two majors" today would not mean *selecting* between two interpretations;
it would mean *writing a second one that does not exist*.

**A pre-existing defect found while mapping this, reported rather than absorbed.** The schedule-time check
is **exact-version**, not major-aware. A patch bump — editorial only, by §10's own table — already refuses
execution of every previously admitted dataset with `NH-AX-1006` *"the fields may not mean the same
thing"*, which for a patch is false. Any honest reading of §10 requires fixing this, because a promise
that two **majors** coexist is void in a build where two **patches** cannot.

## 3 · What dual-major support would actually require

| Layer | Requirement | Cost today |
|---|---|---|
| Intake gate | accept a declared previous major | one function |
| Validation | interpret rows under the declared major | **a second interpretation that does not exist** — there is no version-conditional logic to select between |
| Idempotency | decide whether two majors share an identity space | the version component currently resets on every bump, so this is already unexamined |
| Persistence | record which major produced a decision | `declaredVersion` is not stored at all |
| Execution / replay | reproduce under the major the run was bound to | **nothing** — the worker replays the stored, de-identified, hash-checked cycles (`pilotAssessmentAgent.ts:237-240`) and never re-parses the CSV. The interpretation is applied once, at schedule time, and frozen |
| UI / clients | let a customer declare a major | no path offers it; both clients send the build's own constant |
| Audit | say which major judged what | follows from persistence |

## 4 · Consequences for existing 1.x submissions when 2.0.0 becomes active

* Every stored submission keeps the key it was written with. Nothing historical is rewritten — the table is
  append-only and the rows, their admission decisions, their executions and their findings are immutable.
* A **re-upload of the same bytes derives a new key**, so each historical dataset can be submitted once
  more and assessed again. **One free re-assessment per historical dataset at the cutover.**
* Already-admitted 1.x datasets could **not be scheduled at all** under 2.0.0 while the schedule check
  stays exact-version — refused `NH-AX-1006`. That is the practical consequence that makes §10's promise
  empty today.

## 5 · Is dual-key recognition required to prevent an unintended new assessment?

**No — and the reason is a consequence of slice ordering, which is worth recording.**

The free re-assessment is only dangerous in combination with an operator who can also choose what the
re-assessment *measures*. Until EP-26b that was exactly the situation: a fresh key plus a caller-supplied
`asOf`, `stallThresholdDays` and `currency` would have let the beneficiary re-read the same bytes under a
definition of their own choosing until the number suited them. Dual-key recognition would then have been
**mandatory**.

EP-26b removed that. A second reading is now measured under an **ACTIVE governed AssessmentPolicy** that
the beneficiary cannot author or activate, recorded append-only with a stated reason, and it produces a
**new execution identity** that stands beside the first rather than replacing it. Trust Invariant rules 2,
5 and 9 are all satisfied without dual-key lookup: the definition was fixed before the outcome was known,
no historical proof changes, and a second reading is a new linked record.

What remains is narrower and should be said plainly: at the cutover the **duplicate-submission**
protection resets once, so a re-upload that would have been refused `NH-DC-4003` is accepted. Against that,
the C3 derivation **removes** `datasetId` from the key, so after the cutover the protection is
*stronger* than it has ever been — the operator-supplied label can no longer vary the identity at all. The
one-time reset buys a permanent tightening.

**Dual-key recognition is therefore available, cheap and NOT required.** It is available because both
inputs to the legacy key survive at intake (the label is in the request; the old ref is a constant). It is
not required because no Trust Invariant rule needs it. Building it anyway would mean carrying a second
derivation forever to prevent a one-time event the constitution permits — so it is deliberately **not**
built, and this paragraph is the record of that choice rather than an omission.

## 6 · Was the previous version-in-identity reset intentional?

**No. There is positive evidence it was incidental.**

Commit `3f2de72`, *"feat(contract): add intake limits and codes, contract 1.1.0"*, states its own reasoning:

> Version 1.0.0 -> 1.1.0. This is exactly what the contract's own compatibility policy calls a minor: new
> codes for cases previously reported under a broader one, **no previously valid dataset newly rejected.**

That same commit introduced **`NH-DC-4003` duplicate submission for this tenant**. So one act created a
duplicate-submission guarantee and silently reset its own scope, while its message reasoned explicitly
about compatibility and never mentioned the identity consequence. `VERSIONING_POLICY.minor` says a minor
means *"a dataset valid under X.Y is still valid under X.(Y+1)"* — the same intent, stated normatively.

**No test anywhere asserts the key's behaviour across contract versions**, before or after that commit.
`pilotDataContract.test.ts` **9** covers stability for identical bytes, tenant scoping and a changed file;
the version component is untested.

So the free re-assessment at 2.0.0 is **not** a continuation of a deliberate policy. It is the second
occurrence of an unexamined consequence, and this is the first document to examine it.

## 7 · Verdict — option C

**A · Honour §10 with a general two-major compatibility window.** Rejected. It would require writing a
second interpretation of the data where **no semantic difference exists**, and then maintaining two paths
that can drift apart. Auditability gets worse, not better: two validators that are supposed to agree are
a standing invitation to a silent divergence, and the contract's own warning — *"changing what a field
means is breaking even when every column name is identical"* — is precisely about that class of drift.

**B · Amend §10 before 2.0.0.** Rejected. Nothing forces it. The promise is honourable here, and the
reason it looks unimplementable is the *envelope* change, not the data contract the promise is about.
Removing a published customer promise because implementing it is inconvenient is the trade §10's own
preamble — *"the rule that outranks convenience"* — exists to forbid.

**C · Honour the promise at the level it was made.** Accepted.

The 2.0.0 this repository is about to cut adds no field, removes no field, renames nothing, redefines no
field's meaning, and tightens no **row-level** rule. It changes the identity derivation and the request
envelope. A customer's 1.x export therefore validates identically under it. So:

> A declared **previous major** is accepted **only when the build explicitly declares that major's
> row-level semantics unchanged**, that declaration is machine-checked rather than implied, and the
> **declared version is persisted** so the claim is auditable per decision. When a future major does change
> what a field means, the declaration is withdrawn and the build refuses — fail-closed, by construction.

Concretely, the slice that implements this:

1. `isSupportedContractVersion(declared, implemented)` becomes a pure function of both, so the rule is
   testable at a future major **without bumping the constant** — evidence before the change, not after.
2. A `MAJOR_ROW_SEMANTICS` declaration names, per major, the majors whose row semantics it is identical to.
   Empty today, because there is no major 0; the mechanism is proven by injecting an implemented version.
3. `declaredVersion` is **persisted**, backfilled from `contract_version` for existing rows. That backfill
   is exact for every row this product created — both clients send the build constant as the declared
   version — and for a hypothetical direct-API caller who declared an *older minor*, it records a newer
   minor of the **same major**, which can never grant an acceptance that was not already granted.
4. The schedule-time check becomes compatibility-aware instead of exact-equality, so a patch bump stops
   refusing execution of admitted datasets, and a genuinely incompatible major still does.

**What is deliberately NOT in it:** dual-key recognition (§5), a timer for "one pilot cycle" (§1), and any
version bump. `VERSIONING_POLICY` stops being dead — the gate reads the declaration — so the published
promise and the code have one source instead of two.

## 8 · Open, named rather than guessed

* **"One full pilot cycle" has no definition.** It is a commercial period, not an engineering constant, and
  inventing a duration here would be inventing the kind of universal threshold this repository refuses to
  invent. Until it is defined, the window is expressed as an explicit per-major **declaration** a human
  withdraws, not a clock. A customer reading §10 gets "at least one cycle" honoured as "until we say
  otherwise, in code you can check", which is stronger than a timer nobody set.
* **Whether two majors should share one identity space** is not answered by this slice and does not need
  to be: the C3 derivation is the next slice, and it changes the identity for *everyone* at once rather
  than per major.
