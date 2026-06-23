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

## Deliberately deferred

No backend, no auth, no graph database, no agents, no live integrations. These are
**Phase 2+** and intentionally out of scope: the MVP's job is to make one number —
**auditable recovered revenue** — trustworthy. Everything else is added on top of a
number people already trust.

## Testing

`domain/invariants.test.ts` locks the rules that are the product's truth: the core
equation, no-reason exclusion, CFO-auditable gating, and detected/proven
separation. Run with `npm run test`.
