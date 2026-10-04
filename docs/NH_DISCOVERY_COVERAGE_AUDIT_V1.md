# NH discovery coverage audit · how much revenue leakage can NH actually find today?

**Read-only audit, 2026-10-04, at `51c39da`.** No production behaviour changed. No identity, hash,
`pds`/`PAD-`/`PAX-` or candidate-enablement change. No detector was written.

> **The answer in one paragraph.** NH has **one** executable leakage rule — an activation-timing stall,
> `src/assessment/cohort.ts:33-46` — and it carries money only where that cohort intersects two payment
> states. That rule lives in the lane that **cannot reach proof by type**. The lane that *can* reach proof
> does not detect anything: it ingests a CSV in which the customer has already written the leak class, the
> amount at risk and whether an action is available. The bridge between the two lanes is built, tested,
> and emits nothing, because `OBLIGATION_IDENTITY_FIELDS` is a frozen empty array. So **detection coverage
> is roughly one family in twenty-five; recovery-proof coverage from NH's own detection is zero.** The
> detection slot is wired, governed, and empty.

---

## 0 · Method — the evidence standard, fixed before the findings

**A capability is IMPLEMENTED only if** executable production logic identifies the condition from
admissible input, is reachable from a production entry point (HTTP route, worker, or enabled agent), and
is traced to `file:line`.

**Not credited, however suggestive:** a TypeScript type, an enum member, a `PLAYBOOK` entry, a UI string,
a test fixture, seeded demo data, a CLI that ingests a conclusion, or a document.

Five categories, kept strictly apart:

| | Category | Test |
|---|---|---|
| **1** | implemented and executable | production logic + production entry point + traced |
| **2** | implemented only as assessment logic | computes the condition; cannot reach candidate/case/proof |
| **3** | represented in domain/data structures but not detected | type, enum, column or table exists; nothing reads it to find the condition |
| **4** | planned / documented only | appears in `docs/`, a `creationRule` string, or a roadmap note |
| **5** | absent | named searches return nothing |

**The distinction the whole audit turns on.** A data-quality exclusion (`NH-DC-####`) is **not** a leakage
detection. All 17 members of `ExclusionReason` (`src/assessment/types.ts:56-73`) are rejections — 14 export
defects and 3 scope decisions — and every severity is `dataset_rejected`, `row_rejected` or `*_warning`
(`src/contract/rejectionCodes.ts:26`). **There is no "finding" severity.** Counting rejected rows as
detected leakage would be the easiest way to inflate every score below, and it is not done here.

---

## 1 · The two lanes, and why the distinction decides everything

`docs/GOVERNED_DETECTION_V1.md` named this and it remains true in code:

| | **Lane 1 · pilot assessment** | **Lane 2 · agent / case lane** |
|---|---|---|
| Reads | the customer's real export, through the governed contract | a **pre-computed signal CSV** |
| Output | one **aggregate** finding — counts and five money totals | `CandidateSignal` per account |
| Detects? | **yes** — one rule | **no** — the conclusion arrives as data |
| Reaches proof? | **no, by type** (`constitutesProof: false as const`) | yes, and proven end to end |

**Lane 2 does not detect.** `server/agents/activationDetector.ts:7` fixes a closed 8-field payload —
`sourceRef, signedAt, activationDueAt, activatedAt, observedAt, amountAtRiskMinor, currency,
actionAvailable` — and the entire condition is one line:

```ts
// server/agents/activationDetector.ts:44
return activated === null && observed >= due && payload.actionAvailable ? [signal] : [];
```

The **amount at risk** (`:40`), the **actionability** (`:41`) and the **leak class** (`:38`,
`recoveryType: "ActivationMissed"`, a literal) are all supplied by whoever wrote the payload. The detector
derives only a digest id (`:35`) and a hardcoded `expectedProofEvent` (`:41`). It validates ISO
canonicality, timing consistency and pseudonymity, then re-states what it was told. **It is a validator
and signal-shaper, not a detector.**

The same is true of the only live candidate-creating path: `server/agents/secureCsvIngestion.ts:7-10`
reads `sourceIdentity, recoveryType, observedAt, amountAtRiskMinor, …` straight from file columns
(`:60-78`). `GOVERNED_DETECTION_V1.md` states the consequence without flinching: *"The party who benefits
from a larger number typed the number."*

**And lane 2 is unreachable anyway.** Two opt-in flags, both off (`activationDetector.ts:58-74`;
`config.ts:19` defaults `NH_AGENTS_ENABLED` to `false`; `docker-compose.yml:57,63,64` ship all three as
`"false"`), and — decisively — **no production route enqueues an activation observation**. The only
non-test enqueue of `ACTIVATION_AGENT_ID` is `server/agents/syntheticPilot.ts:118`, a harness that refuses
to run unless the database name contains `test`/`synthetic`/`pilot` (`:66-82`). The one other occurrence,
`src/pilot/syntheticPilotV2.ts:104`, is a display string in a UI narrative.

---

## 2 · What lane 1 genuinely computes

Verified first-hand. Five conditions reach production; **two** carry money.

| # | Condition | Rule | `file:line` | Money |
|---|---|---|---|---|
| 1 | expectation never observed past deadline | no observation visible at `asOf` **and** `expectationAt + N ≤ asOf` | `cohort.ts:42-45` | cohort selection only |
| 2 | expectation observed **late** | `epochDay(obs) − epochDay(expectationAt) > N` | `cohort.ts:36-38` | same cohort as #1 — **not distinguished downstream** |
| 3 | obligation **unpaid** at cut-off, inside that cohort | state `Unpaid` → Σ full `amount` | `paymentState.ts:40`; `observed.ts:42-44` | **`observedUnpaid` — the sole headline** |
| 4 | obligation **partially settled** at cut-off, inside that cohort | state `PartiallyPaid` → Σ `clamp(amount − paid)` | `paymentState.ts:44`; `observed.ts:45-49` | `partialOutstanding`, deliberately outside the headline |
| 5 | obligation settled **after** its due date | `PaidLate` | `paymentState.ts:45` | **count only**; contributes no value |

Three things follow that the product should not be allowed to forget:

**#1 and #2 are not monetary conditions — and the repository says so.** `cohort.ts:9-10` declares the
module domain-neutral, referencing only expectation/observation/N, and `revenueEvent.ts:33-34` classifies
"activate within N days" as **OPERATIONAL**, which *"does NOT by itself establish that money is owed."*

**`observedUnpaid` is a co-occurrence, not a causal measure — and the loop header is the reason.**
`observed.ts:26` iterates `for (const c of stalled)`, so **payment state is only ever evaluated over the
stalled cohort.** An unpaid invoice on an account that activated on time is invisible to the product, by
construction. That one line is the single highest-leverage thing in the codebase: it is why
`unpaid_invoice_without_activation_stall` ($9,300 planted) went undetected while being fully
representable. The export states the causal limit verbatim too: *"It cannot establish that the activation
stall CAUSED the unpaid value"* (`exportSummary.ts:79-80`).

**There is no forecast and no baseline at all.** `estimated` and `forecast` are the literal sentinel
`"unavailable_in_validation_slice"` and `proven` is `zeroMoney` (`assess.ts:110-112`);
`policy.baselineMethod` is the literal type `"not_calculated"` (`policy.ts:26,75`). So NH can state an
**observed** exposure exactly, in integer minor units, and cannot state an *estimated* or *forecast* one
at all.

**`assess()` returns aggregates only.** `AssessmentResult` (`types.ts:118-147`) carries counts, five
totals and a list of *rejected* rows. The three cohort arrays are destructured and discarded
(`assess.ts:71-72`). An operator learns *"47 cycles are stalled and $412,000 in that cohort is unpaid"*;
they cannot learn **which 47** from the result. That single fact is why no finding can become a case.

### Implemented, correct, and completely unreachable

`src/assessment/revenueEvent.ts` is the only real EXPECT→DETECT discrepancy engine in the repository —
MISSING / DELAYED / INCORRECT / UNKNOWN, with `COMPANY_FAVOURABLE` vs `CUSTOMER_FAVOURABLE` direction
(`:191-297`). **It has zero callers.** A whole-repository grep for `analyseCycle`, `detectDiscrepancy`,
`deriveContractualExpectation` and `deriveObservedEvent` returns nothing outside the module and its own
test, and the test *asserts* that isolation (`revenueEvent.test.ts:179-181`). Four genuine leakage
conditions sit in it: missing billing event (`:230-240`), undercharge (`:248-262`), overcharge
(`:253-263`), delayed settlement (`:272-283`). **This is the single largest piece of latent capability in
the codebase, and it is category 3.**

The same pattern holds for attribution: `attributeByEntity` has exactly one production caller
(`governedSignalStaging.ts:172`), behind an off-by-default flag *and* the permanently-false identity gate;
`attributeByLeakInstance` has **zero** production callers; `src/assessment/record.ts` has **zero**.

### Two economic leaks destroyed as data-quality defects

Worth stating separately, because they are the only cases where NH *sees* leakage and then discards it:

* **Overpayment.** `paid_amount > next_invoice_amount` → `paid_amount_exceeds_obligation`, `NH-DC-2013`,
  **row rejected** (`saasActivation.ts:177-179`). A customer-favourable leak — money the company may owe
  back — is counted nowhere, not even in `excludedValue`.
* **Two invoices of one subscription.** Both collide on `subscription_id` and **both** are dropped as
  `duplicate_cycle_id` (defect **D2**, `cycleKeyRule.ts:35-39`), silently removing real exposure from
  `observedUnpaid`.

And one silent false-positive source: `status = churned` is **not recognised** — the adapter knows only
`refunded` and `cancelled` (`saasActivation.ts:210-211`) — so a churned account with no `cancelled_at` is
accepted as a normal cycle and, if its invoice is due and unpaid, **counted in the headline**.

---

## 3 · The activation capability, question by question

| Question | Answer, from code |
|---|---|
| What event is expected? | an **observation** on an expectation cycle. Lane 1 is domain-neutral (`cohort.ts:9-10`); the adapter maps `activation_at` onto `observationAt` (`saasActivation.ts:142-151`) |
| What constitutes absence? | `observationAt` null, or dated after `asOf` (`effectiveObservationAt`, `cohort.ts:27-31`). **A blank optional column is indistinguishable from "never activated"** — `activation_at` is not required (`saasActivation.ts:23`) and gets no row-level flag |
| Time/window rule? | lane 1: `expectationAt + N` days, strict `>` (`cohort.ts:36`). Lane 2: a single point comparison `observed >= due`, no window at all (`activationDetector.ts:44`). **The two lanes disagree on the boundary** |
| Delayed vs permanently missed? | lane 1 **distinguishes them in the reason** (`observed_after_threshold` vs `no_observation_past_deadline`, `cohort.ts:15-19`) and then **collapses both into `stalled`** (`:66`), losing it. Lane 2 does not distinguish at all: a late activation returns `[]` — silence |
| Attribute to an entity? | yes, `attributeByEntity` by `cycle.entityId` (`entityAttribution.ts:107-111`) — but it is behind an off-by-default flag and then a hard block |
| One **leak instance** rather than one account? | **No.** `attributeByLeakInstance` exists and is test-only; identity must be injected because `ExpectationCycle` carries no obligation reference (`leakInstanceAttribution.ts:16-20`) |
| Attach an amount? | yes — exact minor units, from the obligation's own `next_invoice_amount` |
| Which **kind** of amount? | **OBSERVED.** Not expected, not suspected, not recoverable, not proven. Estimated and forecast are sentinels; `proven` is zero; the baseline method is `"not_calculated"` |
| Follow the money through recovery? | **No.** The finding is `constitutesProof: false, constitutesRevenue: false, createsRecoveryCase: false` as **literal types** (`assessmentExecution.ts:473-478`) |
| What prevents a false revenue claim? | the literal-`false` claim boundary; `proven = zeroMoney`; the two-ledger separation in `outcomes.ts:52-56`; `isAuditable` requiring reason + confidence ≥ 80 + positive uplift (`invariants.ts:45-52`); and the fail-closed identity gate below |

---

## 4 · Detection is not proof — where each lane stops

| Rung | Lane 1 (real data) | Lane 2 (pre-computed CSV) |
|---|---|---|
| **DETECTION** | ✅ one rule (`cohort.ts:33-46`) | ❌ arrives as a column |
| **ATTRIBUTION** | ⚠ per **account** only, gated off then blocked | ✅ per account, from `sourceIdentity` |
| **VALUATION** | ✅ observed, exact — ❌ no estimate, no forecast, no baseline | ❌ the amount is an input |
| **RECOVERY ACTION** | ❌ no case can be created | ✅ operator promotes a reviewed candidate |
| **VERIFICATION** | ❌ | ✅ |
| **PROOF** | ❌ **by type** | ✅ `Collected − Baseline`, auditable |

The product's problem is legible in one glance: **the two columns are complementary and do not join.**
Lane 1 reaches rung 3 and stops at a type-level wall. Lane 2 starts at rung 4 on a detection it did not
perform.

### The join is blocked in code, not by configuration

```ts
// src/contract/leakInstanceIdentity.ts:53
export const OBLIGATION_IDENTITY_FIELDS: readonly string[] = Object.freeze([]);

// src/contract/leakInstanceIdentity.ts:264-269 — taken unconditionally on this build
if (OBLIGATION_IDENTITY_FIELDS.length === 0) {
  return Object.freeze({ establishable: false, reason: "leak_instance_identity_unavailable", … });
}
```

Checked **twice independently** — at staging (`governedSignalStaging.ts:186-189`, whose own comment says
*"Under the current data contract this is always taken"*) and at emission
(`governedSignalEmitter.ts:213-227`, before reading a single staged row) — and pinned by tests asserting
`candidatesCreated: 0`. The reason is sound and was audited field by field: no declared field identifies
an **obligation** stably across a reschedule, and `Q2` found that *"unknowable in principle from the
declared fields, not merely collision-prone."*

**One further structural mismatch, for whoever builds the bridge.** The two lanes do not share a money
representation: assessment is exact integer minor units (`money.ts:45-57`), while
`RecoveryEvent.riskAmount`/`baselineAmount`/`collectedAmount` are plain JS `number` and
`computeRevenueReturned` does float subtraction (`invariants.ts:12-17`). The proof lane is **not**
minor-unit exact.

---

## 5 · The revenue chain, stage by stage

Classification per §0. The contract declares 5 required and ~22 accepted columns, all of them
subscription/invoice vocabulary (`saasActivation.ts:23,38-60`) — which is why most of this table reads the
way it does.

| Stage | Class | Evidence |
|---|---|---|
| Marketing · lead capture · routing · first response · follow-up · qualification | **4 · documented only** | **no code**: 0 hits for `campaign`, `MQL`, `leadId`, `lead_`, `assignee`, `escalat`, `first response`. Deferred *"agents (Lead, Response, Quote, Callback…)"* under **"Target architecture … (deferred)"**, `docs/ARCHITECTURE.md:126-128`; `LeadNotWorked` / `LateResponse` / `MissedCallback` are hypothetical rows in `docs/gtm/FIRST_3_CONVERSATIONS.md:176-178`. All 31 `callback` hits in code are JS callbacks; all 5 `qualif` hits are stall prose (`cohort.ts:4,41`) |
| Quote / offer | **4 · documented only** | all 42 `quote` hits in code are CSV quote-character parsing (`parse.ts`, `secureCsvIngestion.ts`). `QuoteLate` / `QuoteNotSent` hypothetical, `FIRST_3_CONVERSATIONS.md:179` |
| Negotiation | **5 · absent** | 1 hit repo-wide, and it is semver: *"Consumers pin, compare and negotiate on this"* (`pilotDataContract.ts:26`) |
| Contract / order | **3 · structure only** | `signed_at` is required (`saasActivation.ts:23`) — an input to the stall rule, never itself examined |
| **Activation** | **2 · assessment logic only** | `cohort.ts:33-46`. The one rule. Cannot reach candidate/case/proof |
| Usage / consumption | **5 · absent** | no `seats_active`, `usage_events`, `feature_adoption_at`. `LowAdoption` is a `PLAYBOOK` key with a prose `creationRule` (cat. 4) |
| Billing · invoice issuance | **3 · structure only** | the row *states* `next_invoice_*`; nothing detects an invoice that should exist and does not |
| Payment | **2 · partial** | 8 payment states derived (`paymentState.ts:19-46`); only `Unpaid`/`PartiallyPaid` carry money, and only inside the stalled cohort |
| Partial payment | **2** | `PartiallyPaid` → `partialOutstanding` (`observed.ts:45-49`) |
| **Failed payment / dunning** | **5 · absent in code, 4 in docs** | **no state, no column, no synonym.** 0 hits for `dunning`, `payment_attempts`, `failure_code`. A failed charge is indistinguishable from "never attempted" — both are `Unpaid`. `FailedPayment`/`DunningRetry` appear only in `docs/RECOVERY_CASE.md:281-284`, asterisked *"illustrative — added later as a Definition (data), not code"* |
| Collection | **5 · absent** | 0 hits for `dunning`, `delinquent`. All 38 `collection` hits are "money collected", JS collections, or `evidenceRole.ts:19`. No AR aging, no dunning sequence |
| Revenue recognition | **5 · absent** | 0 hits for `ASC 606`, `IFRS`, `rev rec` in code; one mention in a competitive-landscape research doc |
| Renewal | **4 · documented only** | `RenewalAtRisk` is a `LeakageType` (`types.ts:13-19`) + a `PLAYBOOK` entry; no `renewal_date`/`contract_end_at` column; no logic |
| Retention · cancellation / churn | **3 · partial structure** | `Cancelled` is derived **only** from a dated `cancelled`/`status=cancelled` (`paymentState.ts:23`); `churned` unrecognised |
| Expansion / upsell | **4 · documented only** | `ExpansionStalled` is a `LeakageType` + `PLAYBOOK` entry; no entitlement columns |
| Refund / reversal | **3 · structure only** | `Refunded` is derived and **excluded from value** (`observed.ts:50-53`); a refund is treated as scope removal, not as a leak to investigate |
| Overcharge / undercharge | **3 · implemented, unreachable** | `revenueEvent.ts:248-263` — real logic, zero callers. Overpayment is additionally **rejected** upstream (`NH-DC-2013`) |
| Duplicate charge | **5 · absent as a finding** | `duplicate_cycle_id` is a *rejection of both rows* (D2), never a duplicate-billing finding. `"DoubleClaim"` in `src/domain/reconciliation.ts:16` is a **dead enum branch**: `classifyExclusion` (`:44-52`) can never return it — `:47` says *"DoubleClaim would be set by a future dedupe flag; none in the model yet"* — and its test asserts the amount is always 0 |

**The six `LeakageType` members are not six detectors.** `StalledOnboarding`, `ActivationMissed`,
`NoFirstValue`, `LowAdoption`, `RenewalAtRisk`, `ExpansionStalled` (`types.ts:13-19`) each carry a
`PLAYBOOK` entry whose `creationRule` is **prose** — *"Signed but not activated after X days."*
(`recommendation.ts:76`) — and **no code implements any `creationRule`**. `PLAYBOOK`'s only server
consumer reads one field, `expectedProofEvent` (`governedSignalEmitter.ts:183`), on a path that returns
zero candidates.

Three pieces of evidence make that conclusive rather than suggestive:

* **Literal counts.** Across `e2e/`, `scripts/` and every CSV fixture: **198 occurrences of
  `ActivationMissed` and zero of any other `LeakageType`.** The five non-activation types appear only in
  `types.ts`, `recommendation.ts`, `reasons.ts`, `seed.ts`, `seedTrust.ts`, one test and one placeholder.
* **The repository says so in writing.** `docs/DECISION_MEMO_2026-09-27.md:237` — *"`LowAdoption`
  PLAYBOOK exists; the detector does not."*
* **The configuration surface is wider than the detection surface.**
  `server/agents/config.test.ts:46-47` parses an admission threshold `RenewalAtRisk: 50000` — a
  materiality floor for a leak class no code detects — and `:35` names `"renewal-detector"` in
  `NH_DISABLED_AGENTS`, a string that can be *disabled* although **no such agent exists anywhere in the
  repository.** Neither is a defect in the config parser, which is correctly generic; both show that
  nothing downstream requires a class to be detectable before it can be configured.

**The server does not even persist a leak type per case.** `server/services/proofService.ts:239` hardcodes
`applicableLeakType: "StalledOnboarding"`, and the adjacent comment (`:231-232`) is candid: *"the server
does not yet persist a leak type per case, so an honest, type-correct, inert placeholder is used."*
`recovery_type` in `prisma/schema.prisma:231` is an unconstrained `String` — there is no database enum
either.

**And the "Detected …" strings are demo data.** `src/data/seed.ts` contains 14 hand-written
`RecoveryEvent`s with fabricated audit lines authored as `"system"` — `"Detected stalled renewal"`
(`:48`), `"Detected activation milestone missed"` (`:345`), `"Detected account stuck before first value"`
(`:322`). These are the closest thing in the repository to multi-class detection, and they are string
literals in a browser fixture (`localStorageRepo.ts:49`). The Opportunity ledger figure is likewise
`seeded amount × a hardcoded probability`: `expectedValue = round(impact × play.probabilityOfSuccess)`
with `probabilityOfSuccess: 0.65` a literal (`recommendation.ts:169`, `:71`).

---

## 6 · Cross-department leakage — and why it is not a detector problem

This is the most important section, and the answer is architectural.

**NH never sees two systems.** `DatasetProvenance.sourceSystems` is
`Record<"contract" | "billing" | "product", string>` (`pilotDataContract.ts:395`) — the contract
*acknowledges* three systems, but only as **dataset-level free text**. No column on any row says which
system a value came from, and `pilot_assessment_executions.source_namespace_id`
(`prisma/schema.prisma:467`) is a **single nullable column**: one execution binds to **one** namespace.

So the customer performs the cross-system join **before NH sees a row**, and **NH cannot see what that
join lost.** A lead that never reached the CRM is not a row with a missing field — it is **not a row at
all**, and an absent row is invisible to every detector that could ever be written against this intake.

| Cross-department case | Comparison required | Possible today? |
|---|---|---|
| lead in marketing, never in CRM | marketing extract ⟂ CRM extract | **No** — one extract, one namespace; the missing record is absent, not flagged |
| deal won, onboarding never begins | CRM ⟂ onboarding | **No** — no onboarding extract, no join key |
| contract exists, activation does not | contract ⟂ product | **Partially** — only because the customer pre-joins `signed_at` and `activation_at` onto one row. This *is* the one rule NH has |
| activation exists, billing does not | product ⟂ billing | **No** — nothing detects an invoice that should exist and does not |
| invoice exists, collection does not | billing ⟂ collections | **No** — no collections concept at all |
| payment made, account still delinquent | billing ⟂ account state | **No** — no delinquency state |
| renewal-eligible, no renewal action | CS ⟂ CRM | **No** — no renewal columns |

**There is also no department, team or org-unit concept at all.** `department` 0 hits, `assignee` 0,
`escalat` 0, `customer success` 0. The 5 `handoff` hits are a *governed data* handoff (dataset →
assessment execution) or a UI navigation hint. "Finance" is a UI authorization role — *Finance Approver*,
for proof approval — not a Billing→Finance transfer. `owner` is a single accountable-actor string on a
Case (`types.ts:66`) with no routing, no SLA timer and no transfer event, and `AuditEntry.type`
(`types.ts:47-54`) has `"assigned"` but no handoff, transfer or escalation member. **So all nine
cross-department handoffs are absent, and none of them has a structure to be detected against.**

**Three prerequisites, in order, and none is a detector:**

1. **Multi-extract intake** — the ability to submit, govern and identify two or more extracts as one
   assessment. The submission identity, the admission decision and the execution binding are all
   single-dataset today.
2. **Per-extract source namespace** — `SourceNamespace` already exists and is governed
   (`SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true`, `leakInstanceIdentity.ts:124`), but the schema binds
   one per execution.
3. **A join key** — a stable obligation/entity identifier that survives both systems. This is exactly the
   empty `OBLIGATION_IDENTITY_FIELDS`.

**Writing more detectors moves none of this.** That is the audit's most consequential finding: the
cross-department surface — which is where the large money is — is blocked on intake architecture and
identity, not on detection logic. **D1, D2 and the deferred row grain are standing blockers and were not
touched.**

---

## 7 · The three scores

The denominator is a judgement, so it is stated as a range with its membership listed, and the numerator
is counted strictly.

**Minimum defensible denominator — 11 families.** The classes an independent business register already
planted against this product (`docs/SYNTHETIC_VALIDATION_2026-09-27.md` §4): activation-stall-unpaid,
activation-stall-partial, terminal-state-after-cutoff, unpaid-without-stall, near-miss-threshold,
renewal-at-risk, usage-adoption-decline, expansion-stalled, discount-leakage, dunning-failure,
credit-note-misapplied.

**Expanded denominator — 25 families.** The 11 above plus: lead-not-captured, lead-not-routed,
first-response-SLA-missed, follow-up-never-made, quote-never-sent, contract-without-activation,
activation-without-billing, unbilled-usage, uninvoiced-delivery, duplicate-charge, undercharge,
overcharge, failed-payment-not-retried, invoice-without-collection, payment-made-still-delinquent,
renewal-eligible-no-action, early-churn-without-cancellation, refund-not-reconciled. Each has a
defensible revenue mechanism; none is representable in the current contract.

| Score | Numerator | /11 | /25 | Range |
|---|---|---|---|---|
| **A · Detection coverage** | **1** — the stall rule. *(Counting generously: 2, if "unpaid" and "partially paid" are separate families rather than two payment states of one rule.)* | **9.1%** | **4.0%** | **4–18%** |
| **B · Monetary coverage** | **1** — the same family, observed exposure only; no estimate, no forecast, no baseline | **9.1%** | **4.0%** | **4–18%** |
| **C · Recovery-proof coverage, from NH's own detection** | **0** | **0%** | **0%** | **0%** |

**Per lane, because a blended number would hide the point:**

| | Lane 1 (real data) | Lane 2 (pre-computed CSV) |
|---|---|---|
| A · detection | 1 family | **0** — detection is an input |
| B · monetary | 1 family, observed only | 0 — the amount is an input |
| C · recovery-proof | **0** (blocked by type and by identity) | 1 class, on a conclusion NH did not reach |

The prior validation's **27.3% of classes / 34.6% of money** is not contradicted here. It measured a
*different, narrower question*: of 11 classes planted **inside one CSV**, how many did NH find. This audit
asks how much of the **commercial chain** NH can see, and the denominator is 25, not 11. Both numbers are
correct about their own question and must not be quoted interchangeably.

### Self-falsification — what would raise each score, and whether it exists

| Score | Would be raised by | Present? |
|---|---|---|
| A | a second production rule identifying a leakage condition from admissible input | **No.** Only `cohort.ts:33-46` qualifies; `revenueEvent.ts` has zero callers; `creationRule`s are prose |
| A | the activation detector counting as a second detector | **No.** Its amount, class and actionability are inputs (`activationDetector.ts:38-41`), and no production route enqueues it |
| B | an estimated or forecast exposure | **No.** `assess.ts:110-111` sentinels; `policy.ts:26` baseline `"not_calculated"` |
| B | a per-instance monetary output | **No.** `assess()` returns aggregates; cohort arrays are discarded (`assess.ts:71-72`) |
| C | any path from a lane-1 finding to a counted dollar | **No.** Literal-`false` claim boundary (`assessmentExecution.ts:473-478`); two independent identity refusals |
| C | candidate emission being switchable on | **No.** The block is a frozen empty constant, not a flag |

---

## CURRENT TRUTH — what NH genuinely detects today

**One leakage family**, executable from admissible customer input: an **activation-timing stall**
(`src/assessment/cohort.ts:33-46`), with exact observed unpaid and partially-paid exposure attached inside
that cohort (`observed.ts:42-49`).

It is genuinely good at that one thing. The prior validation measured **precision 1.000 · recall 1.000**
and **$0.00 monetary variance to the cent** over the surface it can see. The arithmetic, the
reproducibility stamps, the governance, the append-only proof chain and the refusal machinery are all
real, tested and unusually disciplined.

What NH does **not** do today, stated plainly:

* it does not distinguish a **delayed** activation from a **missed** one in any output;
* it does not identify **which** obligations are leaking — only how many and how much in aggregate;
* it cannot create a candidate, a case, or a dollar of Revenue Returned from anything it detected;
* it has **no estimate, no forecast and no baseline** — only direct observation;
* it detects nothing at all in the 20+ families outside the activation/invoice window.

The detection slot is **wired, governed and empty**. That is a far better position than the inverse — the
hard parts (identity, proof, governance, refusal) are built — but it must not be mistaken for coverage.

## CURRENT GAP — where money leaks that NH cannot see

1. **Failed payment / dunning** — no state, no column, no synonym. A declined charge is literally
   indistinguishable from "never attempted".
2. **Unpaid obligations with no activation stall** — representable *today* and simply not looked for
   ($9,300 planted, undetected). A scope decision, not a schema limit.
3. **The entire pre-contract funnel** — lead, routing, first response, follow-up, quote. Absent.
4. **Renewal, expansion, usage/adoption** — `LeakageType` members with prose rules and no columns.
5. **Billing-side correctness** — undercharge, overcharge, duplicate and unbilled usage.
   `revenueEvent.ts` already implements three of these and nothing calls it.
6. **Every cross-department comparison**, because the customer pre-joins the systems and a missing record
   is not a row.
7. **Overpayment and multi-cycle exposure are actively destroyed** — rejected as `NH-DC-2013` and
   `duplicate_cycle_id` (D2) respectively.

## TOP 5 NEXT DETECTORS — ranked on money, not on ease

| # | Detector | Money × frequency | Data needed | FP risk | Identity-blocked? | Why here |
|---|---|---|---|---|---|---|
| **1** | **Unpaid obligation without an activation stall** | high · very high | **none — representable today** | low; the payment states are already derived | no, for a *finding* | The only item that is pure upside: zero new columns, zero new contract version, and it closes a measured $9,300 gap. It also breaks the conceptual error that unpaid value is interesting only inside a timing cohort |
| **2** | **Failed payment / dunning failure** | high · very high | `payment_attempts`, `last_attempt_at`, `failure_code` | low — a failure code is unambiguous | no | Highest frequency leak in any subscription business, ordinary billing data, and the evidence is categorical rather than inferential. Needs a contract minor version, not an identity |
| **3** | **Invoice-expected-but-absent (unbilled delivery)** | very high · medium | a delivery/usage signal + the invoice set | **medium** — absence of a row is the hardest thing to prove | **yes** | The largest money in most businesses. Ranked third *because* it needs multi-extract intake and a join key; honest sequencing, not timidity |
| **4** | **Undercharge / amount mismatch** | high · medium | `list_price`, `discount_pct` beside the charged amount | medium — requires an authoritative expected price | partly | **`revenueEvent.ts:248-262` already implements the comparison.** Wiring reviewed, parked logic is cheaper than new logic — but it needs an expected-amount source the contract lacks |
| **5** | **Renewal-eligible with no renewal action** | high · medium | `renewal_date`, `contract_end_at`, `renewal_status` | medium — "no action" is an absence | yes | Big money, clear mechanism, but it is a second-system comparison (CS ⟂ CRM) and inherits every blocker in §6 |

**What is deliberately *not* in the top 5:** the five remaining `PLAYBOOK` classes. Implementing
`LowAdoption` or `ExpansionStalled` would add detection against columns no customer has been asked for,
and would make NH *more* of a detection product — the thing `CLAUDE.md` forbids.

## ARCHITECTURAL BLOCKERS

| # | Blocker | Status | Consequence |
|---|---|---|---|
| **B1** | **No obligation identity.** `OBLIGATION_IDENTITY_FIELDS` is frozen empty; no declared field is stable across a reschedule | open, correctly fail-closed | **No detection can become a candidate, a case, or a proven dollar.** This is the single gate on score C |
| **B2** | **Single-extract, single-namespace intake.** One execution binds one `source_namespace_id`; `sourceSystems` is dataset-level free text | open, not yet designed | **All cross-department detection is impossible**, however many detectors are written |
| **B3** | **Aggregate-only assessment output.** `assess()` discards the cohort arrays | open | No per-instance finding, so no per-instance action, so no per-instance proof |
| **B4** | **D1 / D2 / deferred row grain** | open, documented, untouched | A real multi-cycle export is silently gutted (D2); `cycle_id` is shadowed by `subscription_id` (D1) |
| **B5** | **Float vs minor-unit mismatch** across the lanes | open | Any lane-1 → proof bridge must cross an exactness boundary |
| **B6** | **No baseline method.** `baselineMethod: "not_calculated"` | open by design | No estimate, no forecast, and no counterfactual — so no "Revenue Protected" and no estimated leakage |

**The ordering matters.** B2 and B1 together gate the majority of the money. **Detector count is not the
constraint; intake shape and identity are.**

## 90-DAY COVERAGE TARGET

Deliberately modest, because the blockers are architectural and the scores above should be allowed to move
honestly.

| | Target | Rationale |
|---|---|---|
| **Detection coverage** | **4–5 of 25 (16–20%)** | detectors 1 and 2 above, plus wiring `revenueEvent.ts`'s undercharge path behind an expected-amount column. Each is single-extract and identity-independent |
| **Monetary coverage** | **4–5 of 25**, still **observed-only** | no baseline work in 90 days; an estimate without a governed baseline method would violate the constitution |
| **Recovery-proof coverage** | **1 family — but only if B1 is closed** | this is the single highest-leverage item in the whole audit. One obligation identifier turns a 0 into a 1 and unblocks everything already built behind the gate |
| **Explicitly NOT targeted** | cross-department detection | B2 is a design slice, not a 90-day build. Attempting detectors against it would produce findings nobody can act on |

**The honest sequencing claim:** closing **B1** is worth more than any three detectors, because it
converts existing, tested, governed machinery from unreachable to reachable. The second-best move is
detector **1**, which needs nothing from anyone.

---

## Appendix · the searches, so this is rerunnable rather than trusted

Every **ABSENT** claim above rests on a named search. These were run over `src/` and `server/`,
**excluding test files**, and each returned **0**:

```sh
for t in dunning delinquent upsell unbilled uninvoiced overcharg undercharg "ASC 606"          payment_attempts failure_code renewal_date contract_end_at seats_active usage_events          leadId campaign department assignee escalat; do
  printf "%-18s %s\n" "$t"     "$(grep -rniI --include=*.ts --include=*.tsx "$t" src/ server/ | grep -v '\.test\.' | wc -l)"
done
```

Citation integrity was checked mechanically as well: all **74** distinct `file:line` references in this
document were resolved against the working tree and every one points inside its file.

Near-misses deliberately **not** counted as presence, because each means something else:
`duplicate_cycle_id` (two CSV rows colliding on a derived key, not a duplicate charge); 166 `retry` hits
(the agent-task retry budget, not payment retry); 38 `collection` hits ("money collected", JS
collections, an evidence role); 42 `quote` hits (CSV quote-character parsing); 31 `callback` hits (JS
callbacks); `"Finance"` (a UI authorization role, *Finance Approver*).

## What this audit does NOT establish

It does not measure real-world recall — no production customer data was involved. It does not revise the
prior validation's freezes or figures. It credits no capability from a type, a screen, a fixture or a
document, and it counts no synthetic recovery as proof. Every `IMPLEMENTED` and `PARTIAL` claim above was
re-read at its cited line; every `ABSENT` claim rests on a named search recorded in §5.
