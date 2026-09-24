# Customer Pilot Data Contract v1

`nh.customer-pilot-data-contract@1.0.0` — implemented in [`src/contract/`](../src/contract),
specified by [`pilotDataContract.test.ts`](../src/contract/pilotDataContract.test.ts).

## Decision served

A customer can prepare an activation-recovery pilot export **before** uploading anything, and can
tell from the response exactly which rows failed and what to do about each one — without anyone on
either side guessing at what the data meant.

## The rule that outranks convenience

> **Invalid customer data is rejected with a reason. It is never repaired, defaulted, coerced,
> rounded or silently dropped.**

Not one branch in the validator rewrites a customer value. This is deliberately less convenient than
auto-fixing, for three reasons:

1. A pilot that quietly fixes its input cannot later prove what it measured.
2. Silent repair teaches customers that over-sharing and malformed exports are harmless.
3. If the assessed file differs from the uploaded file, the fingerprint attests to something the
   customer never saw.

## What this is, and is not

It **declares** the rules; it does **not** replace the adapter. `src/assessment/adapters/
saasActivation.ts` remains the authority on whether a row becomes an `ExpectationCycle`. The contract
calls it and translates its exclusions into coded findings. Every additional rule here — tenant
binding, undeclared columns, PII shapes, offset-less timestamps, coverage containment, content
duplicates — is **strictly additive**. Nothing the adapter rejects is accepted here.

A build-time test asserts `CONTRACT_REQUIRED_FIELDS` equals the adapter's `SAAS_REQUIRED`, so the two
cannot drift apart and tell a customer one thing while validating another.

## 1 · Fields

| Field | Requirement | Kind | Typical source |
|---|---|---|---|
| `entity_id` | **required** | identifier | CRM |
| `signed_at` | **required** | date | CRM |
| `next_invoice_due_at` | **required** | date | billing |
| `next_invoice_amount` | **required** | money | billing |
| `currency` | **required** | ISO 4217 | billing |
| `subscription_id` | recommended | identifier | billing |
| `activation_at` | recommended | date | product |
| `next_invoice_paid_at` | recommended | date | billing |
| `paid_amount` | recommended | money | billing |
| `refunded_at`, `cancelled_at` | recommended | date | billing |
| `cycle_id`, `next_invoice_paid`, `refunded`, `cancelled`, `status`, `status_effective_at`, `is_test`, `plan`, `segment`, `product` | optional | — | any |

Header synonyms (`customer_id`, `due_date`, `paid_at`, …) live in the adapter, which owns the SaaS
dialect. The full table with per-field semantics is `PILOT_DATA_CONTRACT_FIELDS`.

## 2 · Identifiers and tenant boundaries

The tenant `boundaryId` is supplied **out-of-band and never read from the file**. A column in an
uploaded CSV is attacker-controlled input; a dataset that could name its own tenant could be made to
land in someone else's. `ingestionBoundaryId` cross-checks the declared boundary and refuses a
mismatch (`NH-DC-4002`) rather than reconciling it.

`tenantScopedIdentifier()` derives `pid_<32 hex>` from `SHA-256(derivation ∥ boundaryId ∥ value)`.
The boundary is inside the hash, so the same account never correlates across two tenants.

> **Pseudonymous, not anonymous.** Anyone holding the original identifier can recompute the value and
> re-identify the subject. It exists so raw identifiers need not be copied into reports and queues —
> it is not a substitute for not holding data you shouldn't.

## 3 · Time, timezone and ordering

Dates are **calendar days**, timezone-agnostic. An invoice falls due on a *day*; re-projecting that
day through a timezone is how an obligation silently crosses a period boundary.

A value carrying a time of day but **no UTC offset** (`2026-02-01 14:30:00`) is **rejected**
(`NH-DC-2005`), never assumed to be UTC or local. It denotes a different instant in every timezone,
and guessing would put an unprovable assumption underneath every downstream number. Supply either
`YYYY-MM-DD` or a full instant ending in `Z`.

Ambiguous numeric dates (`03/04/2026`) are rejected unless self-disambiguating or accompanied by an
explicit locale. Ordering enforced per row: `signed_at ≤ next_invoice_due_at` and
`signed_at ≤ activation_at`. The policy's `asOf` is the only clock consulted.

## 4 · Money

Customers supply **decimal major units**; the system converts once, at the boundary, into **exact
integer minor units**. No float ever holds a monetary value. Excess precision is rejected, never
rounded. One currency per dataset — there is no FX conversion anywhere in the pilot path, and a mixed
file is rejected (`NH-DC-1006`). Obligations must be positive; a settled amount may not exceed its
obligation.

## 5 · Provenance

Declared *about* the dataset, never inside it — a row cannot vouch for its own origin. Required:
source systems (contract/billing/product), owning role, extraction method, extraction time, and an
ordered coverage window. Rows outside the declared window are rejected (`NH-DC-2021`): a dataset must
not contain rows it claims not to cover.

`assertedIndependentOfBeneficiary` is recorded **as an assertion and stays one**. Only server-side
Ed25519 source attestation ([`sourceVerification.ts`](../server/services/sourceVerification.ts))
upgrades a claim into verified evidence. A claim never upgrades itself.

## 6 · Data minimization and PII

The pilot needs joins, dates and amounts. It does not need people.

- A column whose **name** indicates personal data (`email`, `phone`, `full_name`, `iban`, …) rejects
  the whole dataset (`NH-DC-3001`).
- A **value** shaped like an email, international phone number, or Luhn-valid card in an identifier
  column rejects that row (`NH-DC-3002`). A Luhn check keeps ordinary long numeric ids from tripping it.
- An **undeclared column** rejects the dataset (`NH-DC-1005`) rather than being ignored. An ignored
  column still travels in the file, still lands in memory, and still ends up in whatever the operator
  screenshots.

## 7–8 · Validation and machine-readable rejection

Every failure carries a stable `NH-DC-####` code, a severity, a row number, the field at fault, and a
remediation. Codes are permanent: a superseded code is retired, never recycled for a new meaning.

| Range | Scope |
|---|---|
| `1xxx` | dataset structure, tenant binding, provenance |
| `2xxx` | row and field validation |
| `3xxx` | minimization and PII |
| `4xxx` | identity, duplication, boundary conflict |
| `5xxx` | contract versioning |

Severities: `dataset_rejected` · `dataset_warning` · `row_rejected` · `row_warning`. There is no
`auto_corrected`, and there must never be one.

`EXCLUSION_REASON_CODES` is a **total** `Record<ExclusionReason, …>`: adding an exclusion reason
without a code is a build error, so a new way to reject customer data can never reach a customer
uncoded.

### Acceptance semantics — read this before branching on a flag

- `accepted` describes the **file**: it parsed and its structure is legal.
- `usableForAssessment` = `accepted` **and** at least one row survived.

A file whose every row was rejected is still `accepted`. **Branch on `usableForAssessment`.**

Warnings never fail a dataset. A missing recommended *column* is reported once at dataset level
(`NH-DC-1010`), not once per row — its absence is a property of the export. Per-row warnings are
limited to the derived cycle key (`NH-DC-2019`), because an empty `paid_at` on an unpaid invoice is
the observation, not a gap, and warning about it would bury the real signals.

## 9 · Duplicates and idempotency

- **Identical rows** within a dataset are rejected (`NH-DC-4001`) — the same exposure must not count twice.
- **Colliding cycle identities** are rejected (`NH-DC-2016`).
- **`idempotencyKey`** = `pds_<sha256>` over contract ∥ boundary ∥ datasetId ∥ exact file bytes.
  Re-uploading the identical extract under the same tenant yields the identical key, so a pipeline can
  drop the repeat. Change one byte and the key changes — a changed file is a different dataset and
  deserves a fresh decision rather than inheriting the previous verdict. Two tenants uploading
  byte-identical files never collide.

## 10 · Versioning and backward compatibility

Semver on the contract itself.

| Bump | Covers |
|---|---|
| patch | wording, remediation text, docs — no acceptance change |
| minor | add an optional/recommended field, add a synonym, add a narrower code, relax a rule |
| **major** | add/promote a required field · remove or rename a field · **change the meaning of a field even with an identical name** · tighten a rule · change identity derivation |

A dataset declaring an older minor of the same major is accepted and its version recorded. A **newer**
version than the build implements is **refused** (`NH-DC-5001`), never interpreted optimistically.
Two majors are supported concurrently for at least one full pilot cycle.

Changing what a field *means* is breaking even when every column name is identical — that is exactly
the change that invalidates a pilot's conclusions without anyone noticing.

## 11 · Synthetic example dataset

`syntheticPilotCsv()` — deterministic, safe to publish, screenshot or attach to a data request. Every
value is generated from a counter; identifiers carry a literal `synthetic-` prefix so a leaked value
is self-evidently fake. `syntheticViolationCsv()` pairs each row with the code it must produce, so a
rule that stops firing fails the build.

> Counts in the synthetic data say nothing about detector precision or recovery rates. Reading
> performance into synthetic data is how a demo becomes a claim.

## Claim boundary

A validated dataset is **input to an observed assessment**. It is not Revenue Opportunity, not Revenue
Returned, not Auditable Revenue, and not proof of anything. It reaches a `Proof` only through the
existing governed Case → Evidence → Approval path, driven by a human, under the trust gates, Case
Halt enforcement and separation of duties that already exist. The contract adds no path around them
and imports nothing from the proof kernel.

## Verification

```bash
npm run test          # includes src/contract/pilotDataContract.test.ts
npm run test:ep2      # server suites (requires DATABASE_URL)
npm run build && npm run build:server && npm run check:purity
```

---

# Customer Pilot Intake Integration v1

Contract `1.1.0` wired into the real intake flow. Server-side validation is authoritative.

## What changed, and the claim that had to go

The intake previously ran entirely in the browser and told customers their file was
**"never uploaded"**. That was true, and it is no longer true: `POST /pilot/datasets` now validates
the dataset server-side before anything may proceed. The old copy was removed rather than softened,
and a test asserts the phrase cannot come back as stale reassurance.

Client-side validation is **preflight assistance only**. It runs the identical contract validator so
a customer is not left waiting on a 10 MB upload to learn about a typo — but it cannot authorise
anything, because a client controls its own code. The asymmetry is one-directional by construction:

- preflight says *not usable* → stop early and save the upload;
- preflight says *usable* → submit anyway and obey the server.

A preflight can therefore only ever be **more** conservative than the server, never more permissive.
There is deliberately **no offline fallback**: if the server cannot be reached the upload is an
error, never a pass. "The network was down" must not become a way into assessment unvalidated.

## Tenancy

`boundaryId` is an authorization **request**, never an assertion. `requireBoundaryAccess` refuses it
unless the authenticated context already grants it, so a client can only name a boundary it provably
owns. Three independent reasons a dataset cannot choose its own tenant:

1. The body schema declares no tenant field — `additionalProperties: false` makes `tenantId`,
   `boundary`, `actorId` and friends a **400**.
2. The contract declares no tenant field — a `tenant_id` column is rejected as undeclared
   (`NH-DC-1005`).
3. Duplicate lookup is filtered by boundary as well as by key, so a key minted for another tenant
   reads as absent rather than as that tenant's record.

Production identities are scoped (an OIDC boundary claim rejects `*` outright); a scoped actor
reaching for another boundary gets **403** before anything is validated or written.

## Persistence

**The customer's file is uploaded.** It is not stored as a file — the uploaded bytes are never
persisted — but two different things *are* written, and this section once described only the first.

### The submission record (EP-13)

Only a **usable** dataset is recorded, and the record holds counts, the deterministic key, the
fingerprint and NH-DC-#### **codes**. No uploaded row content, no customer identifiers, no monetary
values, and never a finding's `detail` text — which can echo a customer value. A rejected row is
reported to the uploader and then forgotten. An invalid dataset leaves no row at all, which also
keeps a corrected re-upload a genuinely new submission rather than a "duplicate" of a failure.

The table is append-only at the database level, like every other governed record here.

### The execution input (EP-16 / EP-17) — a second, different record

Scheduling a governed assessment also persists a **pseudonymised projection of the accepted cycles**.
The sentence above about "no monetary values" is true of the submission record and **false** of this
one: the projection keeps exact dates and exact amounts, replacing only the direct identifiers. It is
called out here because this section described only the submission record for two epics after the
second record existed, and a reader would reasonably have taken the narrower description as the whole
answer.

It is **pseudonymised customer-derived data, not anonymous data.** Full description, retention rules,
purge authorisation, and the limits of reproducing an execution later — including backups and the fact
that we keep no copy of the uploaded bytes — are in
[The execution input](#the-execution-input--pseudonymised-customer-derived-data) and
[Retention and purging](#retention-and-purging) below. They are not restated here, so there is one
authoritative description rather than two that can drift apart.

## Limits

| Guard | Limit | Failure |
|---|---|---|
| Contract size rule | 10 MB | `NH-DC-1011`, refused whole |
| Rows / columns | 100,000 / 64 | `NH-DC-1012` / `NH-DC-1013` |
| Transport (per route) | 12 MB | `413 payload_too_large`, naming `NH-DC-1011` |

Fastify's default body limit is 1 MB — far below the contract's 10 MB — so without a per-route limit
a legitimate upload died at the transport with no contract code at all, surfacing as a generic 500.
The limit is set **per route**: no other endpoint needs a large body, and raising it globally would
widen the denial-of-service surface for nothing. The headroom between the two is deliberate, so a
file between them reaches the validator and gets the deterministic code instead of a bare transport
error. **Neither guard ever truncates.**

## What this slice does not do

No RecoveryEvent, no Case, no Proof, no revenue claim. Case Halt, the authority ledger, separation of
duties, the baseline, evidence and the proof chain are untouched — asserted by a test that scopes
every one of those tables to this submission's own identifiers and requires zero rows.

---

# Pilot Assessment Admission Gate v1

A third verdict, separate from the two that already exist and changing neither.

## The gap

`usableForAssessment` means `accepted && acceptedRows > 0`. That is the right question for technical
processing — can anything be computed at all — and the wrong question for pilot fitness. **One
surviving row among 9,999 rejected ones satisfies it**, and nothing downstream ever re-asks. A pilot
built on that dataset produces numbers whose representativeness was never examined, and by then the
rejected 9,999 are invisible, so no reader can tell.

| Verdict | Question |
|---|---|
| `accepted` | Is the file structurally interpretable? |
| `usableForAssessment` | Did at least one valid cycle survive? |
| `admissibleForPilotAssessment` | Does the dataset satisfy an explicit, versioned pilot policy? |

All three are reported. Progression into assessment requires the **second and third** to be true.

## No invented thresholds — the rule that shapes everything else

There are no default thresholds and no code path that supplies one. Every threshold in
`PilotAdmissionPolicy` is required; a policy missing one makes the dataset `NOT_ASSESSABLE`, naming
the field that was not set (`NH-AG-1002`).

This is not fussiness. A fitness bar — *how many rejected rows is too many?* — is a commercial
judgement belonging to the people running the pilot. A system that picks its own bar is grading its
own homework, and whatever number it picks will later be quoted as though someone chose it.

Corollaries the tests pin down:

- **Absence is not zero.** `0` is a deliberate choice ("no duplicates tolerated"); `undefined` and
  `NaN` are questions nobody answered. They never collapse into each other.
- **Out of range is refused, not clamped.** `makeAdmissionPolicy` will not construct an invalid
  policy at all, so one cannot exist as an object and then be quietly used.
- **Every defect is reported at once**, so a policy is fixed in one pass rather than one round trip
  per missing field.

## Three outcomes

`ADMISSIBLE` · `NOT_ADMISSIBLE` · `NOT_ASSESSABLE` — the last being the fail-closed default for a
missing policy, an unset threshold, an unusable dataset, or an uncomputable coverage window.

## What is evaluated

Sample size · distinct entities · rejection rate · rejection-reason concentration · duplicate rate ·
temporal coverage · event-ordering quality · lifecycle coverage · missing recommended columns ·
provenance declaration.

Two that deserve explanation:

- **Distinct entities, not just rows.** Twenty cycles belonging to one account look like a large
  sample and are not one — the same customer's behaviour repeated is a single observation.
- **Rejection concentration, separately from rejection rate.** Rejections concentrated in one cause
  usually mean a systematic export defect affecting one *kind* of record, which is exactly the bias a
  rate alone hides.

## Rejected rows never enter, and never disappear

The evaluator reads accepted cycles plus the **counts and codes** of rejections. It never sees a
rejected row's content, so no rejected value can influence a rate or a verdict — asserted by a test
that plants a unique string in a rejected row and greps the serialized decision for it.

Their **effect stays fully visible**: rates, a reason distribution, and a line in the UI naming how
many rows were excluded and what share came from the largest single cause. An exclusion that
disappears silently is how a biased dataset passes for a clean one.

## Policy storage and tenant isolation

`pilot_admission_policies`, keyed `(boundary_id, policy_id, policy_version)`, append-only. Reads are
boundary-scoped, so **a policy id borrowed from another tenant reads as absent** rather than as that
tenant's thresholds. Applying tenant A's bar to tenant B's data would not error — it would produce a
confident, wrong verdict, and leak what A considers acceptable.

A published version is immutable: re-registering it is a 409, and UPDATE/DELETE are refused by
trigger. Editing thresholds under a version a decision already stamped would silently re-grade a
dataset judged under the old bar.

## Reuse, not reinvention

- `splitCohorts` / `classifyStall` (`src/assessment/cohort.ts`) supply lifecycle coverage — there is
  no second stall classifier.
- `assessPilotReadiness` (`src/assessment/intakeKit.ts`) is **unchanged**. It answers a different
  question — *is the pilot designed?* (declarations and confirmations) — where this asks *is this
  dataset fit?*. It has no minimum sample and no rate ceilings, so it could not be made fail-closed
  without altering its meaning.

## Creates nothing

No money, no Proof, no Case, no revenue claim, no authority record. Case Halt, the authority ledger,
separation of duties and existing contract semantics are untouched — asserted by a test that scopes
every governed table to the submission's own identifiers and requires zero rows.

---

# Pilot Admission Policy Governance v1

The admission gate made the fitness bar explicit. It did not say **who is allowed to set it**.

## The gap

A customer-authorized actor could register a policy and have it judge their own dataset in the same
breath. The customer is the beneficiary of a larger recovery number, and a bar you set for yourself
is that number's first input — exactly what the trust invariant forbids.

## Propose and activate are different acts

| Role | Gains | Why |
|---|---|---|
| `author` / `operator` | `ProposePilotPolicy` | they know their data and their commercial reality; pretending otherwise moves the decision somewhere less informed |
| `steward` | `ActivatePilotPolicy`, `RetirePilotPolicy` | already the governance role, already structurally unable to count |

**No new role and no administrator bypass.** Two additions to the existing `GovernedAction` union and
the `PERMISSIONS` matrix, nothing else.

Two independent separations, both enforced:

1. **Role** — no customer-side role holds `ActivatePilotPolicy`.
2. **Identity** — the actor who proposed a policy may not activate it, even if a future permission
   change let one person hold both roles. This mirrors the kernel's own owner ≠ approver rule. Belt
   and braces, because the cost of being wrong is a beneficiary setting the bar that judges them.

## Four states, four meanings

| State | May judge? | Meaning |
|---|---|---|
| `DRAFT` | no | proposed; has no force |
| `ACTIVE` | **yes** | activated by a steward; thresholds immutable from that moment |
| `FROZEN` | no | a reversible governance pause — "stop using this bar while we look at it" |
| `RETIRED` | no | permanently ended |

Only `ACTIVE` evaluates. The other three each mean "not in force" for a *different* reason, and the
UI shows them distinctly — whether the fix is to wait for approval, ask governance to resume, or
propose a new version entirely.

Status is **derived from an append-only event log**, never stored as an editable column — the same
shape the authority ledger uses. A replayed `PROPOSED` cannot knock an activated policy back to
draft, and an illegal transition written into the log is ignored rather than applied: the safe
reading of a tampered log is the state its *legal* events produced.

## Pre-registration: the bar must predate the data

> **A policy may judge a dataset only if it was activated before that dataset was first seen.**

Every submission records a first sighting (`boundary`, `dataset fingerprint`, `first seen at` — no
row content, no identifiers, and the timestamp never moves). If a policy's activation is later than
that sighting, it is refused for this dataset.

This is what stops the obvious attack: read the verdict, propose and activate a laxer version,
resubmit. Without it the whole gate would be ceremonial. `activatedAt` is the *most recent*
activation, not the first — otherwise a freeze/unfreeze cycle could launder a policy into looking
older than its current authority.

## Deterministic hash

`sha256:` over a canonical ordered serialization of identity and every threshold. Rates are rendered
at fixed precision (0.2 and 0.20 are one bar) and required lifecycle states are sorted (order is not
a requirement). Stamped into every decision alongside id and version.

Why a hash and not just `id@version`: a decision stamped with a version is only as trustworthy as the
guarantee that the version still means what it meant. The hash removes the need for that guarantee —
if a row were ever altered, stored and recomputed hashes diverge and the tampering is visible rather
than silent. **Retiring or superseding a policy can never alter a decision already made under it.**

## Immutability

`ACTIVE` thresholds cannot be edited: the policy table, the lifecycle log and the sighting table all
reject UPDATE and DELETE by trigger. A change is a **new version** with its own proposal and its own
activation — inheriting nothing from the version before it.

## Creates nothing

No Proof, no Case, no revenue record, no authority ledger entry. Tenant isolation, Case Halt and the
existing admission, intake and contract semantics are untouched.

---

# Pilot Assessment Orchestration v1

**Status:** implemented · **Codes:** `NH-AX-####` · **Modules:** `src/contract/assessmentExecution.ts`,
`src/contract/executionCodes.ts`, `server/services/pilotAssessmentService.ts`,
`server/agents/pilotAssessmentAgent.ts`

## The gap

The three slices above produced a dataset that is validated, judged fit, and judged under a bar that
governance put in force. Then the trail stopped.

Assessment still ran **in the browser**, over whatever bytes were in memory, under whatever policy the
page happened to hold. So the admission decision governed a verdict about a *file* and governed
nothing about the *run*. Between "this dataset is admissible" and "here is what it showed" there was
an ungoverned gap — and a number that comes out of an ungoverned gap is indistinguishable from a
number someone typed.

This slice closes it: an admitted dataset is handed to a **governed, leased, audited execution**, and
every governing input is frozen into the execution's own identity.

## The binding is the identity

An execution's id is `PAX-` plus a SHA-256 over its entire binding:

| Bound | Why it is part of the identity |
|---|---|
| `boundaryId` | a run belongs to exactly one tenant |
| `datasetFingerprint` | the exact bytes that were admitted |
| `admissionDecisionId` | the decision that authorised it |
| admission policy id, version, **hash** | the bar it was judged under |
| contract version | what the fields meant |
| assessment policy (`asOf`, stall threshold, currency, method version) | how the data was read |
| interpretation (`mappingId`, amount format, date locale) | a different reading is different numbers |
| `recoveryCaseId` (optional) | which case's Halt applies |

**The whole retry story follows from that one line.** Scheduling the same binding twice derives the
same id, so the second attempt collides on a primary key and returns the first execution. Scheduling
a *different* binding — a new policy version, a later `asOf`, other bytes — derives a different id, so
a changed bar can never silently re-grade an existing run. Nothing has to remember to deduplicate.

The **admission decision id** is derived the same way, from the submission record's own stored fields.
That makes it falsifiable: an execution re-derives it and refuses (`NH-AX-1005`) if the record no
longer hashes to the identifier it is stored under. Submissions recorded before this slice carry
`null` and are deliberately **not backfilled** — minting an identifier now would assert a binding that
never happened, so they refuse with `NH-AX-1002` instead.

## Everything is re-checked at execution time

Between scheduling and running, a steward can freeze the bar, a steward can halt the linked case, and
a lease can expire and hand the work to a different worker. So the agent re-evaluates every
precondition against the database, inside the run:

| Re-checked | Failure |
|---|---|
| the binding still hashes to its own id | `NH-AX-1005` |
| the decision still resolves, in this boundary, still `ADMISSIBLE` | `NH-AX-1001` / `NH-AX-1003` |
| the admission policy is still `ACTIVE` | `NH-AX-1007` |
| the linked case is not halted | `NH-AX-2001` |
| the stored input matches its recorded hash | `NH-AX-2003` |

A **blocked** execution is terminal and its task **succeeds**. That combination is deliberate: a frozen
policy or a halted case is an *answer*, not a transient error, and letting the runtime retry-and-dead-letter
such a task would bury a governance decision under an operational failure.

## The execution input — pseudonymised customer-derived data

> **Correction (EP-17).** This section previously said the projection was "minimized until what remains
> cannot identify anyone" and that the stored values were "not linkable across datasets". Both claims
> were wrong, and wrong in the direction that matters: a reader could have concluded this table sits
> outside data-protection obligations. It does not. The accurate description is below. The EP-16
> migration's comment overstated it in the same way; because that file is already applied, its text is
> left alone rather than edited underneath a recorded checksum, and the authoritative description is
> attached to the table itself with `COMMENT ON` in the EP-17 migration.

`pilot_assessment_execution_inputs` holds **pseudonymised customer-derived data**. Not anonymous data.

* **Direct identifiers are replaced.** `cycleId`, `entityId`, `sourceRowId` become **first-appearance
  ordinals** (`c-0001`, `e-0001`, `r-0001`). Equality classes survive exactly — two cycles that shared
  an entity still share one — so the cohort and payment arithmetic is bit-for-bit unchanged. The
  mapping is not stored and is not recoverable from the projection alone, and no secret key is
  involved, so there is no key to leak, rotate or forget.
* **What remains can permit linkage.** Each projected cycle still carries four to six **exact dates**
  (signature, activation, invoice due, payment, refund, cancellation) and one or two **exact
  minor-unit amounts**. Anyone holding the customer's source export — or any other extract covering
  the same subscriptions — can match rows on those values. Removing a direct identifier does not
  prevent that. **No rate of successful re-identification is claimed here**; what is stated is the
  exposure, not a measurement of it.
* **Dropped, verified rather than assumed.** `statusRaw` — free text from the customer's source, read
  only inside the adapter, and by the time a cycle exists its effect is already baked into
  `refundedAt`/`cancelledAt`. `attributes` keeps only `paid_timing`, whose sole value is a fixed
  internal marker; `plan`, `segment`, `product` and anything else the export carried are gone.
* **Rejected rows have no representation anywhere.** The projection's only input is the accepted
  cycles, so no rejected value can reach a cohort, a sum, a finding, or any agent's context.

### Why it is persisted, stated narrowly

EP-13 persisted **no** row-derived data, which was right for a submission record whose only job was to
recognise a repeated upload. The justification here is narrower than EP-16 originally claimed:

> An execution is **asynchronous and leased**. A worker that picks one up has no CSV, so the input it
> runs on must be durable.

That is the whole reason. **Reproducibility alone would not require it** — `input_hash`, `binding_hash`
and `finding_hash` plus the customer's original file already reproduce and verify the finding without
our copy. EP-16's claim that "an execution whose input cannot be re-read cannot be reproduced" was too
strong. Retaining the projection buys durability for the run in flight, and reproduction without
needing the customer to still hold the file. It does not buy correctness — which is why it is bounded.

## Retention and purging

Two settings, **both required, no defaults**:

| Variable | Meaning |
|---|---|
| `NH_PILOT_INPUT_TERMINAL_GRACE_HOURS` | hours to keep an input after the execution **completed** or was **blocked** |
| `NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS` | days to keep the input of an execution that **never reached a terminal state** |

With either unset, `purgeEligibleInputs` deletes nothing and reports every input as retained under
`NH-AX-4004`. There is deliberately no default, for the same reason the admission gate has none: a
retention period this code invented would be quoted later as though someone had chosen it. That is
fail-closed for the data, and it is **not a state to leave in place** — an unconfigured deployment
retains indefinitely, which the report says out loud so it cannot pass for a policy.

**A purge is not a delete.** It is an append-only `pilot_assessment_input_purges` row — preserving the
input hash, the cycle count, the reason, the policy applied and who authorized it — followed by the
delete, in one transaction. So the trail still says: *an input existed, it had N cycles, its hash was
X, purged at T by A under policy P for reason R.*

**Eligibility is decided twice.** The service decides; the database re-checks against the durable event
log, the task state and the elapsed bound when the authorization row is inserted. A disagreement raises
rather than deletes.

**The scan is complete; only the purges are bounded.** `limit` caps how many records one run may
*purge*, not how many it examines: the scan pages forward through the whole eligible set by keyset. An
earlier version capped the scan itself, which was a permanent head-of-line block — if the oldest
records were all ineligible, every run examined the same ones, purged nothing, and never reached the
eligible records behind them. A retention policy that stops applying past a fixed offset is not one.
Stopping at the purge limit is safe: the next run starts from the oldest remaining record and the
purged ones are gone, so each run strictly advances. The report says `scanComplete` and
`reachedPurgeLimit` so "purged 50" cannot be mistaken for "50 was all of them".

**A database error fails the run.** It raises `InputRetentionFailure`, naming the execution it stopped
on and how many records were purged before it — not a retention verdict. An earlier version caught
every error and reported `retained_in_flight`, so a dropped connection, a constraint bug and a
serialization failure all read as a routine decision to keep a record. There is no benign race to
excuse: every rule requires the task to be `succeeded` or `dead_lettered`, and both are absorbing
(every transition out of them requires `status = 'leased'`, and `enqueueIfAbsent` uses `ON CONFLICT DO
NOTHING`), so a refusal after the service's checks pass means something is genuinely inconsistent.
Prisma does not expose SQLSTATE through a model `create`, so the error cannot be classified after the
fact — and the honest response to an error nobody can classify is to stop and say so.

`countsByDecision` is exact for every code. Individual `verdicts` are capped — every purge is always
listed, retained ones are sampled — so one run over a large table cannot return an unbounded array
while the totals stay precise.

| Rule | Condition |
|---|---|
| `terminal_completed` | a `COMPLETED` event exists **and** the grace period since the latest one has elapsed |
| `terminal_blocked` | a `BLOCKED` event exists **and** the grace period since the latest one has elapsed |
| `abandoned_retention_elapsed` | **no** terminal event exists **and** the retention period since `scheduled_at` has elapsed |
| *every* rule | **no claimable task** (`queued`, `leased`, `retry_wait`) exists for this execution |

That last row is how **input is retained during retries**, structurally rather than by timing luck: a
task that can still be claimed will need its input again, and elapsed time is not a reason to take it
from a run still in flight.

**The trigger deliberately does not key on "a finding exists."** A finding is written just before the
`COMPLETED` event, so that fact is true inside the window where the run has not yet durably completed,
and it says nothing at all about a blocked or abandoned execution. Deletion is authorized by an
explicit recorded decision, validated against the log — never inferred from a neighbouring row.

**What survives a purge:** the execution and its whole binding, `binding_hash`, `input_hash`, the full
append-only event log, the finding and `finding_hash`, and the purge record itself. A later run that
finds its input purged blocks with `NH-AX-2005`, distinct from `NH-AX-2002` ("no input and no record of
one" — a bug, not a policy outcome).

Only a **steward** holds `PurgeAssessmentInput`. A purge cannot change a number — the finding and its
hash survive — but the actors who benefit from a larger recovery number should still not decide when
the stored inputs go.

### Backups, and the limits of reproducing from a CSV

Two honest limits, neither of which this codebase can close on its own:

1. **A purge does not reach backups.** Deleting a row removes it from the live database. Any snapshot,
   WAL archive, replica or dump taken while the input existed still contains it, and PostgreSQL offers
   no way to reach into one. A retention policy is therefore only as short as the **backup** retention
   behind it: if snapshots are kept for 90 days, the effective lifetime of an input is up to 90 days
   past its purge, whatever these two settings say. Anyone quoting a retention period to a customer
   must quote the longer of the two. Backup scheduling, encryption and expiry are deployment
   concerns and live outside this repository; nothing here configures or verifies them.
2. **Reproduction from a customer-supplied CSV is conditional.** After a purge, re-verifying a finding
   requires the customer's original file, byte-for-byte — `datasetFingerprint` and `input_hash` both
   fail on a single changed byte, which is the point, but it also means a re-export, a re-save through
   a spreadsheet, or a different line ending is **not** the same file and will not reproduce. It also
   requires the same contract version and the same adapter, mapping, amount format and date locale,
   all of which the binding records. If the customer no longer holds that exact file, the finding
   remains attested by its stored hashes and its append-only lineage, but it can no longer be
   independently recomputed from source. That is a real reduction in verifiability, accepted in
   exchange for not retaining the rows indefinitely — and it is the reason the grace period exists
   rather than purging the instant a run completes.

## The agent creates nothing

`pilot-assessment-v1` returns **zero `CandidateSignal`s, always**. That is how "do not create a
Recovery Case automatically" is enforced structurally rather than by policy: the only automatic path
from an agent into case creation runs through `PostgresCandidateSignalWriter`, which is driven by the
signals a handler returns. A handler that returns none has no such path, and a structural test asserts
that no branch could ever return one.

Its task payload is **one field** — an execution id. The agent's entire context therefore contains no
customer-derived value at all; everything else is looked up boundary-scoped from records it cannot
influence.

Case Halt is **read, never redefined**. An assessment is not a governed mutation — it creates no
counted number — so it is deliberately not added to `HALTED_MUTATIONS`, which would change what Halt
means for the proof chain. But a halt on a *linked* case stops the run: a steward who has stopped a
case has stopped work on it.

## Five states, derived

`queued → running → completed`, with `blocked` and `failed` as the two ways it stops. State is
**derived from an append-only event log**, never stored as a column: a status column can be set to
anything by anyone who can write the row; a derived state can only be what its events produced. An
illegal transition in the log is *ignored, not applied*. `blocked` and `completed` are terminal.

`CLAIMED` is legal from `running` — the expired-lease case, where a worker died and the next worker to
win the fenced claim is legitimately taking over. That does not weaken exclusion: exclusion is the
task store's fenced lease, and this log only records what that decided.

## The finding is an observation

Exact minor units of **Revenue Opportunity** — a forecast-side reading. `constitutesProof` and
`constitutesRevenue` are typed as the literal `false`, so an edit that tried to set either true would
not compile. Zero imports from the proof kernel or the proven ledger, asserted structurally.

Findings are keyed by execution id and content-hashed, so a retry after a lost lease re-derives
byte-identical content and the second write is a **provable no-op**. A *different* hash under the same
id is not reconciled by a last-writer rule — it is surfaced as `NH-AX-2004`.

## Verification

* `src/contract/assessmentExecution.test.ts` — 20 pure tests (identity, lifecycle, projection, finding)
* `src/contract/assessmentExecution.boundaries.test.ts` — 10 structural tests (purity, ledger
  separation, the agent's inability to create a case)
* `server/services/pilotAssessmentOrchestration.test.ts` — 23 integration tests against real PostgreSQL
* `server/agents/pilotAssessmentWorker.test.ts` — 9 queue tests (duplicates, concurrency, lease
  recovery, rejected rows)
* `src/modules/assessment/assessmentExecutionPanel.test.ts` — 16 UI tests
* `npm run pilot:assessment` — the synthetic rehearsal, over a **real socket** with the **production
  worker loop**

## The pilot journey, end to end (EP-19)

Before this, the pieces existed and did not meet: `Assessment.tsx` never sent an admission policy id,
so the server always answered `NOT_ASSESSABLE`, the intake gate always blocked, and the flow could not
leave the upload screen by either route. Nothing under `src/` called `/pilot/admission-policies` at
all, so there was no way to propose or activate a bar from the UI. The screen completed no run.

The journey now has six steps, and the split between the first two is the whole point:

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Propose the fitness bar | operator (customer side) | Pilot Policy Governance |
| 2 | **Activate** it | steward — a **different** identity | Pilot Policy Governance |
| 3 | Upload the CSV; server validates and judges admission | operator | Revenue Opportunity Assessment |
| 4 | Local preview of the dataset's shape | browser | same screen, labelled a preview |
| 5 | Schedule the governed execution | operator | same screen |
| 6 | Poll; display the server's finding | worker answers | execution panel |

Steps 1 and 2 live on a **separate screen**, outside the customer's assessment flow, on purpose. A
single screen that walked from proposing a bar to activating it would model a beneficiary setting the
bar that judges them — and the server refuses that anyway, by identity as well as by role, so a UI
that offered it would only be teaching the wrong shape.

### What the browser computes, and what it is not

The preview at step 4 is real and useful: it runs the same pure assessment core locally, so a customer
can see the dataset's shape without waiting. It is labelled **"Local preview — computed in this
browser"** and states that it is **not an execution, a Proof, or Revenue Returned**, and that it carries
no execution binding, no policy hash and no audit lineage. Only step 6 shows an authoritative figure.

Three failure modes are deliberately visible rather than smoothed over:

* A **refusal** shows its `NH-AX-####` code and remediation. It is an answer, not an error.
* A **timeout** shows as a timeout, naming the last state seen, and says plainly that no result is
  shown because none was produced — and that waiting stopped without cancelling the run.
* An **unreachable server** is an error. There is no fallback to the local preview, no cached finding
  and no offline mode. A browser-computed number presented as a governed result would be
  indistinguishable on screen from a real one, which is why the data layer has no path to it.

A `failed` state is **not** settled: the runtime retries it, so telling someone their run is over would
cost them a re-upload they did not need.

### How this is verified

`npm run test:journey` drives the whole path in a real browser (Chromium) against a real Fastify
process, a real worker loop and a real PostgreSQL database, then compares the figures on screen against
the same execution read back from the API. It asserts the two governance acts were performed by two
different identities, that exactly one execution exists, that the execution is bound to an admission
decision, and that the proven-ledger vocabulary appears on the result **only inside a denial of
itself**. It uses the Vite **dev** server, because `apiClient.ts` attaches development identity headers
only under `import.meta.env.DEV` and a production bundle would 401 on every governed call.

## Known constraints

* ~~Enabling agents still requires `NH_AGENT_ADMISSION_POLICIES` even for an assessment-only pilot.~~
  **Resolved in EP-17.** The guard was process-wide because `AgentHandler` declared no publication
  capability, so it could not tell a detector from an observation-only agent. It now applies to exactly
  the handlers it is about: `publishesCandidates` (absent ⇒ **true**, so the requirement can only be
  escaped deliberately, never by omission) scopes the requirement to candidate-capable handlers, the
  publication sink is not even constructed without one, and `AgentRuntime` fails any handler that
  declares itself observation-only and then returns a signal — before `succeed()`, which is the only
  caller of the sink. Strictly stronger than the original guard, and an assessment-only pilot no longer
  has to invent a recovery type and threshold it would never use.
* The execution re-supplies the CSV rather than the server holding it. That is what makes the
  fingerprint check meaningful — the intake persists no uploaded bytes — but it does mean a scheduler
  must still have the file.
* A purge cannot reach backups, and reproduction from a customer-supplied CSV requires that exact file.
  See "Backups, and the limits of reproducing from a CSV" above.
