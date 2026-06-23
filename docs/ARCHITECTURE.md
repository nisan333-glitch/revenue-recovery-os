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

## Deliberately deferred

No backend, no auth, no graph database, no agents, no live integrations. These are
**Phase 2+** and intentionally out of scope: the MVP's job is to make one number —
**auditable recovered revenue** — trustworthy. Everything else is added on top of a
number people already trust.

## Testing

`domain/invariants.test.ts` locks the rules that are the product's truth: the core
equation, no-reason exclusion, CFO-auditable gating, and detected/proven
separation. Run with `npm run test`.
