# A capability is declared available only by a layer that can perform it

**Recorded and built 2026-10-07**, in its own commit, after the pairing correction was verified.
A reporting correction with **no monetary consequence** — proven, not asserted (§4).

---

## 1 · The defect

`DeclaredCoverage.event` answers *can NH reconcile the settlement EVENTS, not just the money?* It read:

```ts
const everyLineKeyed = liveExpectations.length > 0 && liveExpectations.every((e) => e.scheduleLineRef !== null);
…
event: everyLineKeyed ? "AVAILABLE" : "UNAVAILABLE_NO_OBLIGATION_IDENTITY",
```

Event reconciliation is a **join between two keyed sides**: it asks whether the obligation the contract
system enumerated was settled by something the billing system emitted. That needs a per-obligation key
on **both**. The predicate consulted only the expectation side.

And `ObservationRow` carries **no obligation reference at all** — which is the very gap the
counterfactual was built to measure, and the reason `C_SCHEDULE_LINE` is declared NOT CONSTRUCTIBLE. So
the billing side was unkeyed **by construction**, not merely in some dataset:

> **`coverage.event` announced the capability was available in exactly the situation where the work
> could not be done, and it did so on every run of the frozen V3 package.**

Found while measuring the obligation-reference counterfactual, reported there as a finding and
deliberately left unpatched because the core was out of that slice's scope, and pinned by a test so it
could not be quietly lost. This is that correction.

## 2 · The rule

> **A capability is declared AVAILABLE only by a layer that holds the facts required to perform it.**
> Reporting availability from a subset of those facts is a claim about the product, not about the data.

And a second rule, which is why this is not a one-line change:

> **The unavailable states stay DISTINGUISHABLE.** *Nothing is keyed* and *the expectation side is keyed
> while the billing side is silent* are different positions, and collapsing them into one "unavailable"
> would hide **which half is missing** — which is the only part of the answer that tells you what to go
> and get. The same reason `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are
> separately named: *"collapsing them would let closing either look like closing both."*

## 3 · What changed

`DeclaredCoverage.event` gains a third state, and the core reports the honest reason:

| State | Meaning |
|---|---|
| `UNAVAILABLE_NO_OBLIGATION_IDENTITY` | neither side carries a per-obligation key |
| `UNAVAILABLE_BILLING_SIDE_UNKEYED` | the expectation side is keyed; the billing side is not — **the core's answer, always** |
| `AVAILABLE` | both sides keyed, declared by a layer that can see both |

The core can no longer reach `AVAILABLE`, and that is the point rather than a limitation: its row type
has no reference, so it has nothing to join on. The **obligation-reference reading** earns the upgrade,
and only when it is genuinely earned — every live expectation keyed, **no** billing row unkeyed, and
**no reference dangling**. A key that joins to nothing is not a key, and one unkeyed row among keyed
ones is enough to withhold it.

## 4 · Measurement · no monetary figure moved

Both frozen packages re-run against the same unchanged rulers, post-pairing versus post-capability:

| Package · candidate | money + 18 count fields | `coverage.event` |
|---|---|---|
| V3 · `A_SUBSCRIPTION` | **IDENTICAL** | AVAILABLE → `UNAVAILABLE_BILLING_SIDE_UNKEYED` |
| V3 · `D_PAYER_PERIOD` | **IDENTICAL** | AVAILABLE → `UNAVAILABLE_BILLING_SIDE_UNKEYED` |
| V3 · `E_SUBSCRIPTION_WITH_LEGACY_ALIAS` | **IDENTICAL** | AVAILABLE → `UNAVAILABLE_BILLING_SIDE_UNKEYED` |
| variant · both controls | **IDENTICAL** | AVAILABLE → `UNAVAILABLE_BILLING_SIDE_UNKEYED` |
| variant · **`F_OBLIGATION_REF`** | **IDENTICAL** | **AVAILABLE → AVAILABLE** |

**The claim is withdrawn exactly where it was false and kept exactly where it is true.** `F` really does
have both sides keyed — 597 billing rows, none unkeyed, none dangling — so its event coverage was the
one honest `AVAILABLE` in the set and it survives untouched.

Headline money, gross positive, paired held out, TP, FP ($0.00), FN, recall, precision, UNKNOWN,
unpriced, refusals and attribution coverage are **identical on every candidate of both packages**.

## 5 · Falsifiers

In [`pairingOrder.test.ts`](../src/benchmark/pairingOrder.test.ts) §7 and
[`obligationAware.test.ts`](../src/benchmark/obligationAware.test.ts):

| What it pins |
|---|
| expectation-side identity **alone** is not event coverage, and the answer names the missing half |
| neither side keyed is a **different** answer — the two unavailable states do not collapse |
| both sides keyed → `AVAILABLE`, declared by the layer holding the facts |
| a **dangling** reference does not earn the upgrade |
| **one** unkeyed billing row among keyed ones withholds it |
| **no monetary figure moves when the capability flips** |

The last one needed care. Its first form compared a dataset with itself and proved nothing — a
tautology of exactly the kind the structural guards here exist to catch, written by hand this time. The
real property needs two datasets that differ in **capability** and agree in **money**, and a *credit*
supplies it: credits are excluded from billed money by the core, so adding one with no obligation
reference flips `event` from `AVAILABLE` to `UNAVAILABLE_BILLING_SIDE_UNKEYED` while every unit state,
every residual and every roll-up stays identical. **A test that cannot fail is not a control** — the
fifth instance of that lesson in this repository.

The pre-existing assertion that R01 reports `UNAVAILABLE_NO_OBLIGATION_IDENTITY` still passes
unchanged, which is the evidence that the two states remain distinguishable in practice and not only in
the type. All **129** benchmark tests pass; the frozen abstract examiner is unmoved at `7dd786ba…` and
**no golden was edited**.

## 6 · Boundary

Reporting only. No monetary figure, no contract change, no production wiring, no customer field
requested. Synthetic throughout: it turns no observed amount into proven **Revenue Returned** or
**Auditable Revenue**.
