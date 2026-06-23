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
