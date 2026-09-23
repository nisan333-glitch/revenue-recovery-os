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

Only a **usable** dataset is recorded, and the record holds counts, the deterministic key, the
fingerprint and NH-DC-#### **codes**. Never uploaded row content, never customer identifiers, never
monetary values, and never a finding's `detail` text — which can echo a customer value. A rejected
row is reported to the uploader and then forgotten. An invalid dataset leaves no row at all, which
also keeps a corrected re-upload a genuinely new submission rather than a "duplicate" of a failure.

The table is append-only at the database level, like every other governed record here.

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
