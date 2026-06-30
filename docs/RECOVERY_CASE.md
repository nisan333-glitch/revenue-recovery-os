# The Recovery Case — the governed object

> Read [`STRATEGY.md`](STRATEGY.md) first. This document defines the **one canonical
> object** the whole product governs, and the rule for when one is created. Every
> screen, metric, proof, and report is a *view* of this object.

## 1. The governed object

Great platforms define a **new governed object**: IAM governs identities, CRM governs
customers, an agent-control plane governs agents. **Revenue Recovery OS governs
Recovery Cases.**

A **Recovery Case** is the single canonical object that spans the whole lifecycle:

```
Detected → Assigned → Action Taken → Returned → Auditable
```

A **Recovery Opportunity** is **not** the object — it is the **forecast view** over the
open Cases. ("Opportunity" is already our forecast-ledger term; it cannot also be the
object without blurring the two ledgers — see the Constitution in
[`STRATEGY.md`](STRATEGY.md).)

A Case is born from a **RecoveryType**, not from thin air. The canonical object graph:

```
RecoveryType (governed unit) ──creates──▶ RecoveryCase ──produces──▶ ReturnedRevenue ──proves──▶ AuditableRevenue
```

The RecoveryType is **not** a recommendation lookup. It is a **governed business
unit** that owns *when* a Case opens, *whether it is worth opening*, *how it proves
out*, *what to do*, and its forecast priors. This is the
Governance-Layer-for-Revenue-Recovery direction — not a detection engine.

This object already exists in code:

| Concept | Code today |
|---|---|
| Recovery Case (instance) | `RecoveryEvent` — `src/domain/types.ts` |
| RecoveryType Definition (template) | `PLAYBOOK[leakageType]` — `src/domain/recommendation.ts` |
| Returned / Auditable (derived) | `src/domain/invariants.ts`, `outcomes.ts` |

> A `RecoveryEvent → RecoveryCase` rename is a separate, deliberately-deferred
> refactor. The names below are the conceptual model; the code seats are noted inline.

### Case vs Proof — two objects, two lifecycles

Do not collapse these into one mutable record:

- **Case** — the **mutable** operational object. Created at Detection, updated
  continuously through Ownership and Action. A Case can exist with **no claim and no
  tier** (still in Action, or Verified but not yet over the evidence bar).
- **Proof** — an **immutable, versioned, append-only** snapshot generated from a Case
  once it clears the minimum evidence bar (T3+, see
  [`PROOF_MODEL.md`](PROOF_MODEL.md) §7). A Case has **0..n** Proof versions
  (`v1, v2…`); existing versions are never edited or deleted — new evidence produces a
  *new* version with a recorded reason. This is what makes *"what exactly did we claim a
  month ago"* always answerable. Each version carries its tier, attribution, claimed
  amount, and **Excluded Recovery**.

The lifecycle, enriched (conceptual model; the code lifecycle `Detected → … → Auditable`
is unchanged):

```
Expectation → Detection → Ownership → Action → Verification → Proof
```

- **Expectation is pre-registered** — the expected money event is recorded *before* the
  action, never reconstructed after the outcome (this is T2 Gate Criterion #1).
- **Verification ≠ Proof.** Verification establishes the *fact* ("did the expected event
  happen?"); Proof decides the *claim* (tier, attribution, Excluded Recovery, the final
  number). Excluding part of a recovered amount is a **claims** decision (Proof), not a
  **factual** one (Verification).

## 2. When is a Recovery Case created? — the admission rule

**The boundary that keeps the system from becoming an event dashboard.** Not every
risk, anomaly, or opportunity becomes a Case — an agent-control plane wins because it
governs only Agents, not every log line. We govern only Recovery Cases.

**A Recovery Case is created if and only if all three hold:**

1. **Material revenue at risk** — a quantified amount tied to a specific account, at or
   above the type's floor (`amountAtRisk ≥ type.economicThreshold`, §3a). No number, or
   below the floor → not a Case. **[Identify]**
2. **A plausible recovery action** — a known play could change the outcome (a
   RecoveryType Definition / `recoveryReason` applies). No action we could take → not a
   Case. **[Fix]**
3. **A future proof event** — a concrete, observable money event could later confirm
   recovery (second invoice paid, charge cleared, renewal booked). No provable
   end-state → not a Case. **[Prove]**

If any is missing it stays **telemetry / signal — never stored as a Case.**

**Why these three:** the admission gate **is the Build Filter applied to data** — a
Case is admitted only if it can be Identified (1), Fixed (2), and Proven (3). The same
three questions that govern what we *build* govern what we *track*.

**The `creationRule` — the concrete trigger, defined on the *type*.** The gate above is
universal; what makes it operational is a per-type **creationRule**: the specific,
parameterized condition that mints a Case (e.g. Activation: *"signed but not activated
after X days"*). A Case is not born because a pattern exists — only when a concrete
recovery situation has been created. The `creationRule` and its mirror
`expectedProofEvent` belong to the **RecoveryType Definition** (§3a), **not** to the
Case: they are identical for every Case of a type, so they are type metadata, not
instance data. The Case references its type; its `evidence` records that the rule
actually fired for this account.

**Boundaries:**

- **Dedup:** one Case per (account × leak instance); duplicates are `Dismissed`.
- **Exit:** a Case leaves the open inventory only as `Recovered` (proven), `Failed`
  (action ran, no recovery), or `Dismissed` (admitted in error / duplicate / false
  positive).
- **Materiality** has a home: the type's **`economicThreshold`** (§3a) parameterizes
  criterion 1 — a per-type floor in config, not a special case.
- **Enforcement point (future, not built now):** a pure, testable predicate
  `canBeCase(signal): boolean` at the data boundary — the same place a real
  CRM / CS / Billing feed would enter.

### Detector v0 — the first Discovery experiment (spec; build-on-CSV)

The narrowest first implementation of the `canBeCase` enforcement point above. It is **a
scientific experiment, not a platform**: *can the system discover a valid Recovery Case
without a human pointing to it first?* Success is a valid Case **surfaced**, not a dollar
recovered.

**The detector** is one **pure function** applying a *single* creationRule to a **batch
CSV** — no integration, no scheduler:

```ts
// Input = the CSV gtm already asks for: account, signedDate, activatedDate|null, nextInvoiceAmount
detectActivationMisses(rows, asOf, thresholdDays = 30): CandidateSignal[]
  // → for each row with activatedDate == null AND daysSince(signedDate) ≥ thresholdDays

const cases = detectActivationMisses(rows, today)
  .filter(canBeCase)       // for ONE type, collapses to amountAtRisk ≥ economicThreshold
  .map(toRecoveryEvent);   // → existing RecoveryEvent(status: Detected)
```

The **only new code** is the parser, `detect()`, `canBeCase`, and a trivial mapper —
everything downstream (prioritization, recommendation, baseline, proof, audit, the Recovery
Loop) is reused unchanged.

**Agent Contract** (per the model in [`ARCHITECTURE.md`](ARCHITECTURE.md)):

| Field | Detector v0 |
|---|---|
| Inputs | one batch CSV (`account, signedDate, activatedDate, nextInvoiceAmount`) |
| Outputs | `ActivationMissed` Cases (status `Detected`) |
| **Authority** | **detect & create candidates only** — never assigns, acts, or claims money |
| **Success metric** | **precision** — % of surfaced Cases the customer confirms *real AND previously-unmanaged* (target ≈ ≥80%) |
| Evidence | each Case carries its source row + the fired rule |

**Why `ActivationMissed` first.** The decisive criterion is the **ownership gap**, not signal
cleanliness. ActivationMissed is the sweet spot — a clean, binary, already-logged signal that
still lands in a real Sales→CS gap. `FailedPayment` has the *cleanest* signal but **no gap**
(dunning already watches it), so surfacing it fails the discovery hypothesis (*"we already see
those"*). So Activation is both the wedge and the right first detector.

**Data precondition.** Precision rests entirely on a **clean, customer-defined "activated"
flag** — the first dataset must have an unambiguous `activated: yes/no` (their milestone
definition, not ours).

**Discipline & trigger.** Detect-only computes **no money**, so baseline / attribution /
auditability / the Constitution are structurally untouched. **Batch first;** "continuous
discovery" is the same pure function scheduled later (operational, deferred). Build it **only
when a real CSV is in hand** (the [`gtm/SCOREBOARD.md`](gtm/SCOREBOARD.md) *"run it on our
data"* trigger). Validation = *confirmed surfacing* (precision); recovered dollars come later
through the existing loop.

## 3. Two schemas — RecoveryType Definition vs Recovery Case

A sharp **Type → Instance** separation, like `Account → Opportunity` or
`Workflow → Task`:

```
RecoveryType Definition  ──creates──▶  Recovery Case (instance)
(1 per recovery type)     when its       (1 per concrete situation,
                          creationRule     on a specific account)
                          fires
```

`creationRule` and `expectedProofEvent` are **type metadata, not per-Case data** —
every ActivationMissed Case is born from the *same* rule and proven by the *same*
event. Keeping them on the type makes the Case lean and lets a new recovery type drop
in as **one definition**, never a schema change. This **ratifies the existing code**:
`PLAYBOOK[leakageType]` already *is* the type definition; `RecoveryEvent` already *is*
the lean instance and correctly carries no rule.

### 3a · RecoveryType Definition (the template / governed unit)

Extends `PLAYBOOK[leakageType]` in `src/domain/recommendation.ts`. It owns *when to
open*, *whether it's worth opening*, *how it proves out*, *what to do*, and its priors:

| Field | Description | Grounding |
|---|---|---|
| `recoveryType` | Type key (ActivationMissed, RenewalAtRisk, …) | `LeakageType` |
| `creationRule` | The trigger that mints a Case (+ threshold X) | `PLAYBOOK` |
| `economicThreshold` | Min $ at risk to justify opening a Case of this type | `PLAYBOOK` |
| `expectedProofEvent` | The money event that will confirm recovery | `PLAYBOOK` |
| `defaultPlay` | Recommended recovery play | `PLAYBOOK.recommendedReason` |
| `rootCause` · `prior` · `effort` | Diagnosis + forecast priors | `PLAYBOOK` |

**Economic logic — why a Case is worth opening.** `economicThreshold` is the materiality
floor *per type*: with thousands of signals you open a Case on $70,000, not $7. It
refines admission criterion 1 from `amountAtRisk > 0` to
`amountAtRisk ≥ type.economicThreshold`. Two siblings stay where they already live, so we
don't duplicate them: the **expected-value model** is already `prior × amountAtRisk` in
`recommend()`; the **escalation rule** is a governance policy over the Case inventory
(§6 — deferred). This is what makes a RecoveryType a governed unit, not a lookup.

> `defaultPlay` is the existing `recommendedReason` field — kept under that name to
> avoid churning `recommend()` and its tests. The Case's applied `recoveryPlay`
> defaults from it.

### 3b · Recovery Case (the governed object / instance)

Grounds in `RecoveryEvent` (`src/domain/types.ts`). Lean — only per-situation data:

| # | Field | Description | `RecoveryEvent` | Stored / Derived |
|---|---|---|---|---|
| 1 | `caseId` | Unique id | `eventId` | stored |
| 2 | `recoveryType` | Reference → its Definition | `leakageType` | stored |
| 3 | `amountAtRisk` | Measurable revenue exposed (forecast ledger) | `riskAmount` | stored |
| 4 | `recoveryPlay` | The play actually applied (defaults from type) | `recoveryReason` | stored (null until set) |
| 5 | `owner` | Accountable person | `owner` | stored (null until assigned) |
| 6 | `status` | Lifecycle state | `status` | stored |
| 7 | `returnedRevenue` | Recovered & attributed (collected − baseline) | `revenueReturned` | derived (stored on write) |
| 8 | `auditableRevenue` | Recovered with proof enough to pass audit | `isAuditable ? returned : 0` | derived |
| 9 | `evidence` | Proof record (incl. that the proof event occurred) | `evidenceNotes` + `audit[]` | stored |

Inputs behind 7–8: `baselineAmount`, `collectedAmount`, `confidence` (+ timestamps,
`audit[]`) — `returnedRevenue = collected − baseline`; `auditableRevenue` gated by
`confidence ≥ PROOF_THRESHOLD` + reason + positive uplift (`src/domain/invariants.ts`).
The instance carries **no rule definitions** — it references its type and records only
what actually happened to this account.

**The lifecycle (instance), opportunity → outcome:**

```
[type.creationRule fires] → amountAtRisk → recoveryPlay → [type.expectedProofEvent occurs]
       → returnedRevenue → auditableRevenue
```

First half = **opportunity**; the last two = **outcome**. The outcome fields are what
make this recovery **proof**, not recovery management — the line that separates us from
analytics. A Case is not done at "recommendation"; it is done at proven, auditable cash.

**The scaling invariant:** the instance shape is constant across all recovery types; a
new type ships as **one RecoveryType Definition**, never a schema or special-case change
— the same generic-domain rule already in [`STRATEGY.md`](STRATEGY.md) ("new workflow =
new LeakageType + PLAYBOOK entry + RecoveryReason — never a special case in the
invariants / ledger / proof chain").

## 4. The four RecoveryType Definitions — same instance schema, four types

Each recovery type is **one Definition**; the Recovery Case instance schema (§3b) is
identical for all of them. Adding a type is adding a row here, not a new object:

| Definition field | Activation | Billing\* | Renewal | Expansion |
|---|---|---|---|---|
| `recoveryType` | ActivationMissed | FailedPayment\* | RenewalAtRisk | ExpansionStalled |
| `creationRule` | signed but not activated after X days | failed payment not collected after X days | renewal at risk within X days | expansion opportunity stalled X days |
| `defaultPlay` | MilestoneNudge | DunningRetry\* | RenewalOutreach | ExecBusinessReview |
| `expectedProofEvent` | activation + 2nd invoice paid | charge retried + paid | renewal booked | order signed |

\* Billing values are illustrative — added later as a Definition (data), not code.

The instance fields (`caseId`, account, `amountAtRisk`, `owner`, `status`,
`recoveryPlay`, `returnedRevenue`, `auditableRevenue`, `evidence`) are **identical**
across all four.

## 5. Data attaches to the Case (not a data platform)

External sources map onto Case fields; we are a **recovery governance layer powered by
existing data**, not a data warehouse. Minimum useful data for Activation:

- CRM → `account`, `owner` (+ opportunity status)
- Customer Success → `status` / stage, activation + first-value milestones → evidence
- Billing → `collected`, invoice / renewal status → `returnedRevenue` + proof

Each new field must justify itself by improving **Identify, Fix, or Prove.**

## 6. Governance roadmap (demand-gated — recorded, not built)

`Inventory → Governance → Enforcement → Audit` becomes
`Case Inventory (exists) → Policies (new, as data) → Action Taken (exists) → Audit
(exists)`:

- **Policies as declarative, testable predicates over a Case:** `>$50k → escalate`,
  `idle 14d → review`, `confidence < threshold → require review`,
  `enterprise → exec owner`. Pure functions surfaced as read-only flags — **data, not
  workflow.** (The `escalationRule` mentioned in §3a lives here.)
- **Recovery Guard / command center:** the existing Recovery Loop screen is the seed
  (Open Exposure · Recovery Opportunity · Returned · Auditable) — not a new screen.
- **3-year arc:** **Y1** Identify → Fix → Prove on Cases (today); **Y2** governance
  layer (policies / SLAs as data over the inventory); **Y3** autonomous agents that
  open, act on, and prove Cases.

Each second-order capability — exec visibility, ownership, escalation, prioritization,
forecasting — is a *view or policy over the Case inventory*, never a new product.
