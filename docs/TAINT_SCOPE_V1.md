# Plausible-counterpart taint scope · derived from settlement causality

**Phase 2 design. No core change in this document.** The pre-fix baseline is recorded against the
unmodified core `c80b35c5…` in [`docs/BENCHMARK_REVISION_V2.md`](docs/BENCHMARK_REVISION_V2.md) §5.

## 1 · The defect, stated causally rather than numerically

```
if (residualMinor > 0 && unmatchedEntitlements.size > 0) → REFUSED_UNMATCHED_IDENTITY
```

`unmatchedEntitlements` is a **dataset-wide set**. One unmatched observation anywhere refuses every
positive residual everywhere. I introduced it deliberately, because an entitlement-scoped taint missed
the re-key case: the unmatched key is the *observation's* old key while the unbilled unit sits under the
*expectation's* new one, so scoping to the entitlement never reached it.

**The direction is right. The scope has no causal basis.** A refusal says *"this invoice might be the
missing one"*. For that to be true, the invoice must be **capable of settling that obligation**, and a
dataset is not a settlement relationship.

## 2 · The question the scope must answer

> **Can this unmatched observation plausibly be the counterpart of this positive expectation residual?**

A taint may reach a residual **only when authoritative source facts make settlement between them
possible.** Not when it is imaginable, not when the numbers are similar — when the facts permit it.

## 3 · The candidate facts, each judged on whether it bears on settlement

| Fact | Bears on settlement? | Authoritative source | In scope? |
|---|---|---|---|
| **payer / account** | **Yes, decisively.** An invoice billed to payer X cannot settle payer Y's obligation. The company billed someone else | `payer_account_id` on both sides | **YES** |
| **authoritative payer relation** | **Yes.** A parent may legitimately be billed for a child's obligation — but only where the hierarchy is *supplied* | `payerHierarchy`, governed terms | **YES** |
| **governed period** | **Yes.** An invoice for March can settle a March obligation; one for September cannot, unless timing displacement is governed | `periodStart`/`periodEnd` + `invoicingGracePeriods`, governed | **YES, within the governed window only** |
| **currency** | **Yes.** A EUR invoice cannot settle a USD obligation with no governed rate — and that unit is refused on its own grounds anyway | `currency` + governed currency | **YES** |
| **authoritative alias / re-key** | **Yes — and in the taint-ENABLING direction.** If the alias resolves the observation to this unit, it is not unmatched at all; if an alias regime exists but this key has none, the ambiguity is real | `identityAliases`, supplied | **YES** |
| **migration mapping** | Yes, and it is the same mechanism — a retained prior key stated by the source that re-keyed | `legacy_subscription_id`, source-stamped | **YES, via the alias** |
| **invoice allocation** | Yes, and it would *end* the question rather than scope it | **not emitted by billing** | **UNAVAILABLE** — its absence must not widen the taint |
| **source namespace** | Possibly, but nothing governs cross-namespace settlement | `source_system` exists; no governed term | **UNAVAILABLE** — not used, in either direction |
| **lifecycle state** | No. A terminated or paused unit has no positive residual to taint — it never reaches this branch | dated facts | **N/A by construction** |

### What is excluded, and why each exclusion matters

* **amount similarity** — the single most tempting and the most dangerous. Two unrelated obligations of
  the same plan price are *identical* in amount; matching on it would pair strangers. M18 plants exactly
  this: an unrelated payer over-billed by precisely the shortfall elsewhere.
* **date proximity alone** — proximity without a payer relation is co-location, which the constitution
  already ruled is not a mechanism.
* **name or prefix similarity** — would have "resolved" `syn-sub-rk-0042` to `syn-ent-0042`. That is
  inventing an alias, which the architecture test rejects outright.
* **inferred payer hierarchy, inferred obligation identity, any fuzzy match** — all would make NH the
  author of the relationship it is supposed to be reading.

## 4 · The rule

An unmatched observation `U_obs` taints a unit `V` carrying a positive residual **iff all** hold:

1. **PAYER** — `payer(U_obs) === payer(V)`, **or** both resolve to one root under the **supplied**
   `payerHierarchy`.
2. **PERIOD** — `V`'s period is `U_obs`'s period, or within `invoicingGracePeriods` of it, using the
   **same governed window** the pairing mechanism already uses.
3. **CURRENCY** — `U_obs`'s currency is the governed currency. (A mismatch refuses that unit on its own
   grounds; it must not also poison others.)

And the taint is **not** created where an authoritative alias already resolves `U_obs` to some matched
unit — it is then accounted for and not floating.

**Everything else is out of scope and leaves the residual reportable.**

## 5 · The proof obligation, discharged

> An unmatched invoice for payer X / obligation X / period X cannot contaminate an unrelated expectation
> for payer Y / obligation Y / period Y unless an authoritative relationship makes settlement possible.

Under the rule, condition **1** fails for `payer X ≠ payer Y` whenever no hierarchy entry links them, and
the taint is never created. No other condition can resurrect it, because the conditions are conjunctive.
Condition **2** independently fails for `period X` outside the governed window of `period Y`. So two
distinct authoritative facts each block the contamination, and neither can be satisfied by similarity.

**The re-key case the global rule existed to protect is preserved, and this is the load-bearing check.**
In the frozen package M14 re-keys `subscription_id` while `payer_account_id` and the period are
**unchanged**. So payer matches, period matches, currency matches — the taint applies and the unit is
still refused. The narrow rule gets M14 right for the *right reason*: the invoice really could be that
obligation's, under another name.

**And the migration stops being contagious.** M15's 28 entitlements are unmatched under candidate A, so
they taint **their own** payers' units — correct, because without the alias NH genuinely cannot tell —
and reach none of the other 91 entitlements. Under candidate E the retained legacy key resolves them, so
they are not unmatched at all.

## 6 · What this rule must NOT be allowed to do

It must not increase recall by any route other than withdrawing refusals that had no causal basis. If a
dollar becomes detectable because a *different* epistemic guard was weakened — the currency refusal, the
unpriced rule, the supersession check, the ambiguity refusal, the pairing mechanisms — **the slice
fails**, and Phase 3's falsifiers are written to catch exactly that in both directions:

* **over-broad** — a taint reaching a residual it has no authoritative basis to reach;
* **under-broad** — a residual reported where an unmatched observation genuinely could have settled it.

Grain is **not** changed in the same slice, no obligation identity the source does not provide is
introduced, and the frozen package, the V2 scorer and the ground truth are untouched.

---

# Phase 4 results · PRE-FIX vs POST-FIX on the SAME frozen V2 package

Core `c80b35c5…` → `831b2dab…`. Data hashes unchanged (`31992d23…`, `0ef21e40…`, `024f6923…`), freeze
lock intact, V2 scorer and ground truth untouched.

| | PRE-FIX | POST-FIX | Δ |
|---|---|---|---|
| authoritative planted money | $85,942.00 | $85,942.00 | — |
| **detected positive** | $0.00 | **$90,925.40** | +$90,925.40 |
| **true positive** | $0.00 | **$62,356.30** | **+$62,356.30** |
| false positive | $0.00 | $8,969.10 | +$8,969.10 |
| false negative | $66,342.00 | $3,985.70 | −$62,356.30 |
| **monetary recall** | **0.00%** | **72.56%** | +72.56pp |
| monetary precision | null | 68.58% | — |
| UNKNOWN cases / unpriced units | 3 / 4 | 3 / 4 | — |
| refusals (unwarranted) | 107 (**9**) | 77 (**1**) | −30 (−8) |
| attribution coverage | 19/19 | 19/19 | — |
| double-counted money | $0.00 | $0.00 | — |

`D_PAYER_PERIOD` is **unchanged in every figure**, which is the expected control: payer keys always
match, so that candidate never had an unmatched observation to be tainted by. `B`/`C` remain NOT
CONSTRUCTIBLE. `E` matches `A` exactly.

## Is every newly-detectable dollar traceable to the taint correction? Yes — and the false positives are not

**The 30 withdrawn refusals are exactly the ones with no causal basis**, and the 8 fewer unwarranted
refusals come with **M14 and M15 still refused**: the re-key cohort (12 units) and the migration cohort
(56 units) remain `REFUSED_UNMATCHED_IDENTITY`, because for *those* payers and periods settlement really
is possible. The correction withdrew doubt only where the facts could not support it.

**No other guard moved.** The currency refusal, the unpriced rule, the supersession check, the boundary
and overlap refusals, the pairing mechanisms and the per-unit arithmetic are untouched, and the frozen
abstract examiner still passes in full (71 of 71 across `src/benchmark/`, including its
false-positive-money-is-$0.00 target and its R17x/R18x refusals).

### The $8,969.10 of false-positive money, decomposed — **$0.00 of it is caused by the taint correction**

| Amount | Cause | Caused by this fix? |
|---|---|---|
| **$8,879.40** | **`M17-ambiguous-identity`.** The core **has no ambiguous-live-lines refusal at all** (`grep`: 0 occurrences). It sums two unsuperseded lines claiming one unit — `299.00 + 179.40` and `14500.00 + 8700.00` against two invoices — producing a residual of exactly $8,879.40, *an amount neither line asserts*. | **No.** A pre-existing core gap the dataset-global taint was accidentally masking. The unwired expectation validator already refuses this case as `NH-EX-2016`; the reconciliation path never validates, so the guard is not in play |
| **$89.70** | **A measurement transport defect in V2.** `ground-truth.csv` derives its header from `Object.keys(rows[0])`, so `sibling_entitlements` — present only on the last truth row and present in `planted-register.json` — was **silently dropped**. The scorer therefore could not see that `syn-ent-0001` belongs to M20, and scored correctly-detected planted money (a 30% under-bill, $299.00 → $209.30) as fabricated | **No.** And **deliberately not fixed here**: correcting it would move $89.70 from false positive to true positive, i.e. **improve the result**, which may only happen as a governed revision with explicit evidence and a new freeze |

So **the taint correction introduced zero fabricated money.** Both residues are named, measured, and
attributable to other causes.

## Remaining false negatives · $3,985.70, all explained

* **$3,298.00 · M09-wrong-payer** — billed to the parent instead of the child. The supplied hierarchy
  makes the parent's invoice a live counterpart, so the unit is held as a pairing rather than reported.
  Correct behaviour: the company was paid, by the wrong entity in the same group.
* **$598.00 · M08-wrong-entitlement** — partially paired to the sibling that was billed.
* **$89.70 · M20** — the transport defect above, counted on both sides of the ledger.

**Structurally invisible money is unchanged at $19,600.00** (M07's duplicate-masked omission, which nets
to zero at every monetary grain) plus aggregate rows. **Unexplained misses: $0.00.**

## The answer to the question this slice was set

> **Does the same frozen package now prove that NH can find trustworthy incremental money without
> fabricated money?**

**Not yet — and the gap is one named defect, not a doubt about the approach.**

The taint correction works and is clean: 72.56% recall, every case individually attributable, $0.00 of
fabrication attributable to it, 30 baseless refusals withdrawn while every warranted refusal stands.
**But the pipeline still reports $8,879.40 that nobody owes**, because the reconciliation path has no
ambiguous-live-lines refusal and does not run the validator that does.

The next minimum slice is therefore **not** a grain decision and **not** production wiring: give the core
the ambiguity refusal the validator already specifies (`NH-EX-2016`), re-run this same frozen package, and
the fabricated-money figure should fall to the $89.70 transport artefact alone — which then justifies a
governed V3 revision on its own evidence.
