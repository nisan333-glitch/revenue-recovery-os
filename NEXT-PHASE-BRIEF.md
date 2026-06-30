# Next Phase — validate the constitution through one working slice

The constitution is stable enough to implement. The objective of this phase is **not to
design more concepts** — it is to prove the existing constitution survives contact with a
real working system. Do not create new constitutional documents unless a genuine gap is
discovered.

> **Scope note (reconciled with the rest of the repo):** the slice below is the first
> *build* / **Reference Implementation**, chosen because Failed Payment is the most
> *provable* leak (it can reach T1) — so it best validates the **Proof engine**. It is
> **not** the go-to-market wedge; **Activation remains the wedge** (see
> [`docs/VISION.md`](docs/VISION.md), [`docs/RECOVERY_CASE.md`](docs/RECOVERY_CASE.md)
> §2 Detector v0). The freeze still applies to anything beyond this one slice.

## Primary goal

Build the smallest working slice that faithfully implements the current constitution.
The implementation must **validate the model, not redefine it.** The authoritative
sources are `CLAUDE.md`, `docs/RECOVERY_CASE.md`, `docs/PROOF_MODEL.md`,
`docs/ARCHITECTURE.md`.

## The one slice — Failed Payment, end to end

```
Expectation → Detection → Ownership → Action → Verification → Proof v1
```

One leak type only. Nothing else — no second leak type, no breadth. Preserve the object
model exactly: **Case** mutable (exists from Detection, can have zero Proofs); **Proof**
immutable, versioned, append-only (Tier, Claimed, Excluded Recovery, attribution, audit).
Never mutate an existing Proof — always create a new version. Keep the five extension
points as stubs (`ProofTriggerPolicy`, `RevisionPolicy`, `OwnershipRoutingPolicy`,
`SLAPolicy`, `LeakTypeAdapter`).

## Respect the UI Boundary Rule

React renders state and captures input. React never computes a Tier, Claimed/Excluded
Recovery, attribution, or whether a Proof should exist. All business logic stays in the
Domain layer (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → UI Boundary Rule).

## Record friction (typed)

Log every implementation difficulty **before** fixing it, classified as exactly one of:
**Constitution** (a genuine gap in the rules) · **Architecture** (a structural problem in
`ARCHITECTURE.md`) · **Domain** (a logic-implementation problem, not the rule) · **UI** ·
**Implementation** (ordinary engineering) · **Deferred Decision** (traces to one of the
five stubs — a place we already knew was unresolved, *not* a discovered gap; do not
classify it as Constitution/Architecture). Collect evidence first; do not redesign on the
first friction.

## Validate the product

After it works, answer objectively: Does the loop run end to end? Does the architecture
keep business logic out of React? Does the Proof make sense and trace every claimed dollar
through evidence? Does the `LeakTypeAdapter` seam remain intact enough that a *second* leak
type looks plausible without a rewrite (the honest, in-scope version of "behaves like an OS,
not a dashboard" — a real second type isn't built this phase)? If any answer is "no,"
explain why before proposing changes.

## Final gate — adversarial CFO review

A simulated review, not a substitute for a real one. Ask:

> *If you were a CFO seeing this for the first time, what would make you hesitate before
> trusting the Proof? List every concern, every ambiguity. Be skeptical. Do not defend the
> design. Try to break it.*

If no major trust/auditability concern survives, the foundation is strong — but the next
real step is a person with financial judgment (a pilot contact, a finance-background
reviewer) looking at a real Proof before treating this as validated.
