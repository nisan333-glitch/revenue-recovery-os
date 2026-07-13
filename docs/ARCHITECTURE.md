# Architecture — built to evolve

The MVP is deliberately structured so the larger platform (see `VISION.md`) can be
reached **without a rewrite**. The strategy: keep the domain logic pure and
UI-independent, treat events as auditable append-only records, and hide the data
source behind a repository interface.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│  modules/ + components/   React UI (8 product modules)   │  presentation
├─────────────────────────────────────────────────────────┤
│  state/RecoveryContext     workflow actions + wiring     │  application
├─────────────────────────────────────────────────────────┤
│  domain/   PURE engine: types, invariants, attribution,  │  domain (the moat)
│            confidence, metrics, reasons, audit           │
├─────────────────────────────────────────────────────────┤
│  data/     repository interface + localStorage + seed    │  infrastructure
└─────────────────────────────────────────────────────────┘
```

### `domain/` — the future engine

Pure, framework-free TypeScript. No React, no storage, no I/O. Everything that
makes a recovered dollar *true* lives here and is unit-tested:

- `invariants.ts` — `revenueReturned = collected − baseline` is always derived;
  `isCounted` (rule 2), `isAuditable` (rule 4), `validateEvent`.
- `attribution.ts` — how dollars are credited + the stated baseline methodology.
- `confidence.ts` — transparent, explainable scoring + the proof threshold.
- `metrics.ts` — detected-vs-proven aggregates (rule 5: never blended).
- `reasons.ts` — canonical recovery-reason taxonomy.
- `audit.ts` — append-only audit-entry helpers.

Because this layer is pure, it can later run **server-side, behind an API, or
inside agents** unchanged. The UI computes nothing important itself — it asks the
domain.

> **The governed object lives here.** `RecoveryEvent` (`types.ts`) **is** the Recovery
> Case instance; `PLAYBOOK[leakageType]` (`recommendation.ts`) **is** the RecoveryType
> Definition that creates it. A new recovery workflow is a new Definition, not a schema
> change. See [`RECOVERY_CASE.md`](RECOVERY_CASE.md).

### `data/` — swappable persistence

`RecoveryRepository` is the only thing the app knows about storage.
`localStorageRepo` implements it today. To move to a backend, implement the same
interface against REST/GraphQL — **no UI or domain changes required**.

### `state/` — enforced workflow

Every mutation flows through one `mutate()` path that (1) re-derives
`revenueReturned`, (2) re-scores confidence from the transparent model, (3)
appends an immutable audit entry, (4) persists via the repository. The UI
**cannot** bypass the invariants or skip the audit trail.

### The UI Boundary Rule (business rules never live in React)

The single rule that keeps the prototype honest: **the Presentation layer renders
state and captures actions — it contains zero business-rule logic.** React components
may *read* Case/Proof objects and *call* application functions (`assignOwner`,
`logAction`, `requestVerification`), but may **never**:
- compute or assign an evidence **Tier** (T1/T2/T3);
- compute **Claimed** or **Excluded Recovery**;
- decide whether a new **Proof version** should be generated;
- branch on evidence quality, causal window, or confounder count.

If a component needs to show *"why is this T2 and not T3,"* it asks the Domain layer for
an explanation object — it never re-derives the answer. This is what keeps the domain
usable by a future non-React consumer (backend, agent, mobile) without a rewrite.

> Note: some objects the rule references (Tier, Proof version) are **conceptual / not yet
> in code** — today the domain exposes `confidence` + `isAuditable`. The rule itself
> (business logic out of React) **is** honored today by the pure `src/domain/` layer.

## Evolution hooks (cheap now, valuable later)

| Today (MVP) | Evolves into (platform) |
|---|---|
| Pure `domain/` functions | Server/agent-callable recovery engine |
| Append-only `audit[]` per event | Full event-sourcing / immutable event log |
| `recoveryReason` + `confidence` as first-class fields | Detection/ML feed inputs |
| `RecoveryRepository` over localStorage | REST/GraphQL/event-store backend |
| Single-domain recovery events | Nodes in a Business Event Graph |
| Manual status transitions | Detection, causality, proof, learning agents |

## Target architecture — the three-layer multi-agent OS (deferred)

The end state (VISION.md §6, Phase 4) is **not** one workflow or one dashboard — it is a
**multi-agent commercial operating system**: many specialized agents (Lead, Response,
Quote, Callback, Activation, Payment, Retention, Renewal, QA, Forecast, Anomaly…) running
continuously, all feeding **one shared substrate.** Three layers:

```
Intelligence   the agents/detectors — watch every commercial signal, 24/7
      │        (Detect · Predict · Recommend · Escalate · Learn)
      ▼
Coordination   Case Creation · Risk Scoring · Prioritization · Assignment
      ▼
Proof          Attribution · Recovery Ledger · Revenue Returned · Audit Trail
```

**What already exists is the bottom two layers** — the hard, defensible part. The
Intelligence layer is the green-field. Honest mapping:

| Layer | In the code today | Status |
|---|---|---|
| **Proof** | `invariants.ts` · `attribution.ts` · `audit.ts` · `metrics.ts` · `confidence.ts` | ✅ built — the moat |
| **Coordination** | Case + lifecycle · `riskAmount`/`confidence` · `expectedValue` ranking · `owner`+status via `state/mutate()` | 🟡 mostly built (automated Case *creation* is the gap) |
| **Intelligence** | only the rule-based `PLAYBOOK` recommender (advises an existing Case) | ❌ absent — no detectors yet |

**The smallest architecture that supports 100 agents without redesign** rests on one
contract — already specified in [`RECOVERY_CASE.md`](RECOVERY_CASE.md) §2, not yet built:

```
CandidateSignal  →  canBeCase(signal): boolean  →  Recovery Case  →  [shared Proof engine]
```

An **agent = a detector that emits `CandidateSignal`s + a RecoveryType Definition**. Adding
agent #14 or #100 = adding a Definition + a detector; the Case schema, ledger, invariants,
and audit **never change**. The anti-noise primitive: every agent emits the *same governed
object*, so 100 agents converge on **one Case inventory and one ledger** — not 100 alert
streams. The user sees `Revenue At Risk · Findings · Actions`, never 1,000 notifications.

Four primitives must stay right so they don't force a later redesign:
1. the admission gate (`canBeCase`) as a pure, testable predicate;
2. cross-agent dedup + attribution isolation — two agents touching one account must never
   double-open or double-count;
3. the RecoveryType registry as **data**, not typed code (agent #14 shouldn't need a recompile);
4. a **predict** lane on the *forecast* side of the never-blend line — a prediction
   ("78% likely to churn") creates and prioritizes a Case but is **never** counted as
   recovered money (Constitution; VISION.md §2.3).

**The guard.** This is deferred Phase 4. **Build none of it until agent #1 is proven
end-to-end on real data.** One proven agent validates the contract for all 100; one hundred
unproven agents validate nothing and create 100× the noise (VISION.md §2.4 — *"ten agents
is an org chart, not an MVP"*). The bottleneck is demand, not design — the foundation is
already here.

**The standing design test.** Every architectural decision from here is evaluated through
one lens: *does it preserve the path to 50–100 specialized agents without redesign?* This
sits alongside the Build Filter — the Build Filter governs whether to build a thing *now*;
this test governs whether a thing built now **forecloses the swarm later.** If a change
would make agent #14 require a schema / ledger / invariant change, it is wrong.

### The customer never sees agents

The agent fleet is an **internal implementation detail.** The customer sees only:

```
Problem → Action → Recovery → Proof          (market story: Identify · Fix · Prove)
```

They never see "agents," layers, or orchestration. *Customers buy outcomes, not
architecture.* The multi-agent model below is how we reach a trustworthy outcome — never
the pitch.

### Internal reasoning roles (mostly already built)

The fleet is a set of specialized reasoning roles. **Seven of eight already exist as
functions today; only Diagnostic/detection is missing** — and it is the one role that lets
the system *continuously discover* new opportunities rather than analyze ones already
identified. That is Agent #1, the bottleneck.

| Role | Does | Status |
|---|---|---|
| **Diagnostic / Detection** | continuously discovers potential leaks | ❌ **not built** — the green-field (Agent #1); future detector + `canBeCase` |
| Data Quality | validates evidence + confidence | ✅ `confidence.ts` |
| Prioritization | ranks by expected impact | ✅ `expectedValue` / `expectedRecoverable` |
| Recommendation | proposes corrective actions | ✅ `PLAYBOOK` / `recommend()` |
| Recovery | tracks what changed post-intervention | ✅ Case lifecycle / `state/mutate()` |
| Attribution / Proof | separates real recovery from would-have-happened | ✅ `attribution.ts` + `invariants.ts` |
| CFO | finance-grade explanation + audit | ✅ CFO Proof View + `audit.ts` + `BASELINE_METHODOLOGY` |
| Operator | coordinates the flow | ✅ Recovery Loop / queue / assignment |

The reasoning is largely built; the missing capability is **detection** — continuous
discovery, not analysis of pre-identified cases.

### The Agent Contract (the anti-sprawl primitive)

Before any agent joins the fleet, it must declare a contract — so 100 agents stay governed
instead of becoming sprawl, and so the standing design test is enforceable:

- **Inputs** — what signals it reads.
- **Outputs** — what it emits (a `CandidateSignal`, a score, a recommendation…).
- **Authority** — which decisions it may make autonomously vs. propose.
- **Success metric** — how its value is measured (in its own currency; only Recovery's is money).
- **Evidence requirements** — what proof it must attach.

This extends "an agent = a detector + a RecoveryType Definition + `canBeCase`" into a full,
reviewable spec. No contract, no agent.

### Orchestration — the honest state (reasoning vs. running the loop)

The real question is not "which agents are missing" but *"do these capabilities operate as
one continuously-reasoning Recovery OS?"* Honest answer: they are **coherent** — one data
model (`RecoveryEvent`), one mutation spine (`state/mutate()` re-derives Revenue Returned,
re-scores confidence, and appends audit on every write), one view (the Recovery Loop) — but
the loop is **not yet autonomously orchestrated.**

- **Reasoning is continuous/automatic:** prioritization, recommendation, and proof all
  re-compute on every read/write.
- **Movement between stages is manual:** a human carries each Case `Detect → Fix → Track`.

So the **Recovery Loop is a coherent *read-model of* the lifecycle, not a *runner of* it.**
Continuous operation needs two deferred pieces: (a) the **detector** (Detect = Agent #1),
and (b) an **orchestration runner** that advances Cases through the *automatic* stages,
leaving humans only the genuinely-human Fix. Both gated on Agent #1 proven on real data —
the next architectural question, **not built now** (you don't orchestrate an empty loop).

## Extension points — named seams for open decisions

Open business decisions get a *named home* in the architecture so resolving them later
doesn't require restructuring. **None of these are implemented in this repo** — they are
*named seams* (concepts), so a future implementation has an obvious place to land:

| Extension point | Resolves (eventually) | State in this code |
|---|---|---|
| `ProofTriggerPolicy` | when a new Proof version is generated (tier change / amount delta / manual) | not built — no distinct Proof object yet |
| `RevisionPolicy` | how downward revisions are handled (status, required reason, notification) | not built — no Proof object / no `changeReason` field exists today |
| `OwnershipRoutingPolicy` | how a Case gets an owner (manual / rule / AI-suggested) | owner assignment is manual today (`assignOwner`); no routing policy |
| `SLAPolicy` | timing thresholds per loop stage (stall detection) | not built |
| `LeakTypeAdapter` | the generalization seam — one engine, many leak types | `leakageType` + per-type `PLAYBOOK` exist; a second leak type is the real test |

Architecture's job is to ensure each has a home, not to decide its contents.

### Reserved seams for the Learning layer (design for evolution, implement on evidence)

**Design now, implement later.** The Learning layer must not be *built* before real
proven-outcome data exists — but the architecture must already **reserve its seams**, so a
future learning capability never forces a redesign. These are reserved and **inactive**
(none built); each is anchored to a real, explicit touchpoint in today's code so it can be
activated *without* touching the UI, the ledger, or the invariants:

| Reserved seam | Eventually does | Where it plugs in today (already explicit) |
|---|---|---|
| `LearningEngine` | umbrella: reads proven outcomes, proposes updates | reads `outcomes.ts` / `metrics.ts`; writes only through the seams below |
| `ConfidenceCalibration` | recalibrate the confidence model from realized outcomes | `confidence.ts` is a transparent function, not magic constants — replaceable |
| `PriorUpdates` | update play priors (`probabilityOfSuccess`) from proven recoveries | priors are **explicit fields in `PLAYBOOK`**, updatable as data |
| `PolicyEvolution` | update governance policies from what worked | policies are future/data (§ target architecture) |
| `AgentEvolution` | improve detectors/plays from outcomes | agents are future; each is a RecoveryType Definition + detector |
| `KnowledgeEvolution` / `LessonsLearned` | accumulate the proven **cause→effect library** — the deepest moat | every proven recovery is an append-only record (`revenueReturned` + `audit[]`) |

**Why no redesign will be forced:** the domain is pure; priors (`PLAYBOOK`) and confidence
(`confidence.ts`) are *explicit and transparent*, not hardcoded magic; and every outcome is
already recorded (`revenueReturned`, `audit[]`, `outcomes.ts`). A Learning engine can read
proven outcomes and write updated priors/confidence through these seams **without touching
the UI, the ledger, or the invariants.** That is the design-for-evolution guarantee.

**The guard:** reserved ≠ built. All inactive until real proven-outcome data exists (the
same trigger as everything else — a real customer). Calibrating on no data is calibrating
on nothing. This is also the structural home of the *cumulative learning-with-proof* moat:
each proven Recovery leaves the org smarter, and that library is built from proofs, not
scale — the hardest thing to copy.

## Deliberately deferred

No backend, no auth, no graph database, no agents, no live integrations. These are
**Phase 2+** and intentionally out of scope: the MVP's job is to make one number —
**auditable recovered revenue** — trustworthy. Everything else is added on top of a
number people already trust.

## Testing

`domain/invariants.test.ts` locks the rules that are the product's truth: the core
equation, no-reason exclusion, CFO-auditable gating, and detected/proven
separation. Run with `npm run test`.
