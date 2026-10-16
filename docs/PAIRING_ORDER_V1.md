# Pairing must be decided by evidence, never by iteration order

**Recorded and built 2026-10-07.** A product correction in `reconciliationCore.ts`. No contract change,
no production wiring, no customer field requested. The frozen V3 package, the frozen obligation-ref
variant, both ground truths and both scorers are **untouched**.

---

## 1 · The defect, as it was proven

The obligation-reference counterfactual predicted M07 would release $19,600.00 and released $9,800.00.
The missing half was not a missing source fact. It was this, in the pairing pass:

```ts
for (const n of negatives) {
  if (Math.abs(n.residualMinor!) !== u.residualMinor) continue;   // only an exact counterpart
  …
  if (mechanism) return Object.freeze({ ...u, pairedWith: { mechanism, … } });   // FIRST MATCH WINS
}
```

M07's cohort is two entitlements, `syn-ent-0019` and `syn-ent-0020`, which **share payer
`syn-acct-012` and both cost $9,800.00**. Each had February settled twice and March never settled, so
each March shortfall had **two** exact counterparts. The scan order decided which:

```
over-billed units, in scan order:
  [0] syn-ent-0019  2026-02-01  -$9,800.00
  [1] syn-ent-0020  2026-02-01  -$9,800.00
```

* `0019`'s March matched **[0] — its own February** → `ADJACENT_PERIOD_SAME_ENTITLEMENT`, which the
  obligation references can refute → released.
* `0020`'s March matched **[0] first too** → a *different* entitlement of the same payer →
  `SIBLING_ENTITLEMENT_SAME_PAYER`, which they cannot refute → held.

> **The mechanism assigned — and therefore whether the money could ever be claimed — followed array
> position.** Two obligations of one payer at one price were enough to make it happen.

**The defect cut both ways, which the first analysis missed.** `0019`'s release was *also* order-luck:
`0020`'s February was an equally reachable counterpart for it, and had it been scanned first, `0019`
would have been labelled a sibling and held too. So the pre-fix $9,800.00 was not "half right" — it was
one of two arbitrary outcomes.

## 2 · The governing rule

> **Pairing must be determined by authoritative business relationships, never by iteration order.**
>
> 1. Enumerate **every** plausible counterpart — no early exit.
> 2. Classify what each one would have to **claim**.
> 3. Drop the candidates whose claims the evidence **refutes**.
> 4. Pair **only when exactly one survives**.
> 5. Otherwise **hold**, and say that more than one survived.

Never resolved by: array order · CSV order · database order · lexical id order · amount similarity
alone · nearest date alone · first match · arbitrary stable sorting.

> **Determinism is necessary and is not evidence.** A stable tie-break would make the answer
> reproducible and leave it a guess — the same error as breaking an append-only log's ties with a random
> id and calling the order total. The one place a sort appears is the *reporting* list of surviving
> counterparts, where it decides nothing.

## 3 · The hypotheses, and why a compound claim cannot borrow support

The relationships are classified **independently** and no hierarchy is invented from "looks more
specific". What ranks a candidate is what it must **claim** to explain the shortfall:

| Claim | What it asserts |
|---|---|
| `TIMING_DISPLACEMENT` | the obligation **was** settled, in the wrong **period** |
| `MISALLOCATION` | the money **did** reach the company, under the wrong **identity** |

| Relationship observed | Mechanism | Requires |
|---|---|---|
| same entitlement, adjacent period in the governed window | `ADJACENT_PERIOD_SAME_ENTITLEMENT` | `TIMING_DISPLACEMENT` |
| sibling entitlement of one payer, **same period** | `SIBLING_ENTITLEMENT_SAME_PAYER` | `MISALLOCATION` |
| sibling entitlement of one payer, **different period** | `SIBLING_ENTITLEMENT_SAME_PAYER` | `MISALLOCATION` **and** `TIMING_DISPLACEMENT` |
| sibling payer under a **supplied** hierarchy | `SIBLING_PAYER_UNDER_HIERARCHY` | as above, by period |
| more than one survivor | `AMBIGUOUS_MULTIPLE_COUNTERPARTS` | — held, no mechanism claimed |

**`requires` is conjunctive, and that is the load-bearing part.** A cross-period sibling asserts two
independent errors — wrong identity *and* wrong period. It may not be propped up by whichever of its
parts happens to hold:

> **A compound hypothesis needs support for each of its parts, and dies with either one.**

That single property is what makes the correction work without touching the M08 protection, because the
references kill timing claims and say nothing about allocation claims.

## 4 · What evidence may refute, and what it may not

Obligation references enter through one injected predicate, `refutedParts`. **The core itself refutes
nothing** — it holds no fact that speaks to either claim, so it holds wherever two counterparts are
reachable. The obligation-reference reading supplies the predicate, and **both paths then call the same
`selectPairing`**: a second selection rule would be a second chance to disagree, and the property under
test has to hold on one implementation or it holds on neither.

* `TIMING_DISPLACEMENT` is **refuted** when no settlement anywhere names the deficit's obligation **and**
  every settlement in the surplus names that period's own obligation. Both halves are required: the
  first is the positive proof that nobody settled it, the second rules out an early or late settlement.
* `MISALLOCATION` is **never** refutable by a reference, because under the declared semantics the
  reference is produced by the very allocation step that failed. It says where billing *put* the money,
  which is the thing in question.

**M08 is protected by that asymmetry, not by an exception.** Its pairing is a *pure* same-period
misallocation — one claim, unrefutable — so it survives and the $2,798.00 stays held. A cross-period
sibling dies because its timing half dies. Nothing in the code names M08.

## 5 · The measurement · same frozen variant, same ruler

Scorer `060359f5…` unchanged, variant package unchanged, `obligation_ref` values unchanged.
Core `ec1efe95…` → **`fdc6c785…`**.

| Figure | PRE-FIX | **POST-FIX** | Δ |
|---|---|---|---|
| authoritative planted money | $85,942.00 | $85,942.00 | — |
| **headline money claimed** | $70,046.00 | **$79,846.00** | **+$9,800.00** |
| gross positive | $82,046.00 | **$82,046.00** | **—** |
| paired held out | $12,000.00 | **$2,200.00** | −$9,800.00 |
| **false positive** | **$0.00** | **$0.00** | **—** |
| true positive | $62,446.00 | $62,446.00 | — |
| false negative | $3,896.00 | $3,896.00 | — |
| monetary recall | 72.66% | 72.66% | — |
| monetary precision | 76.11% | 76.11% | — |
| UNKNOWN-money cases | 3 | 3 | — |
| unpriced units | 4 | 4 | — |
| refusals (warranted / unwarranted) | 11 (2 / **0**) | 11 (2 / **0**) | — |
| attribution coverage | 19 of 19 clusters | 19 of 19 | — |

**Exactly one mechanism moved:**

```
M07-duplicate-masks-missing   positiveMinor  $9,800.00 -> $19,600.00
                              pairedMinor    $9,800.00 ->      $0.00
```

**M08 control: unchanged**, $2,200.00 still held under `SIBLING_ENTITLEMENT_SAME_PAYER`. M05 still
$0.00. M18 still unpaired. Every other mechanism identical in every figure.

**Gross positive unchanged** is the proof the correction *moved* money rather than creating any, so
**every newly claimable dollar is attributable solely to removing the order dependence** — nothing else
in the pipeline changed, and the ruler could not have.

### The two controls are now the strongest form of the proof

The variant's `A_SUBSCRIPTION` and `E_SUBSCRIPTION_WITH_LEGACY_ALIAS` readings — the same variant data
through the unmodified core, ignoring the new column — carry witnesses **byte-identical to V3's own**:
`7432cf7f…` and `241871e2…`. Same arithmetic, same data, same answer.

### V3 itself · money unchanged, attribution corrected, witness moved

| | |
|---|---|
| every monetary and count field, all three constructible candidates | **IDENTICAL** |
| `A_SUBSCRIPTION` witness | `2b95dda0…` → `7432cf7f…` |
| `E_SUBSCRIPTION_WITH_LEGACY_ALIAS` witness | `c0805323…` → `241871e2…` |
| `D_PAYER_PERIOD` witness | **unchanged** — that grain merges the two entitlements, so no competing candidates arise |

**The witness moved and it should have.** The mechanism is part of its preimage, and the mechanism
genuinely changed: M07's two units now read `AMBIGUOUS_MULTIPLE_COUNTERPARTS` instead of one
`ADJACENT_PERIOD_SAME_ENTITLEMENT` and one `SIBLING_ENTITLEMENT_SAME_PAYER` chosen by position. The
money is identical because both labels hold the money out.

> **So the earlier claim "V3 reproduces byte-identically" no longer holds, and must not be repeated.**
> It held across a measurement correction; it cannot hold across a product correction, by definition.
> The recorded `baseline.v3.postfix.json` is preserved as the **historical record of the pre-correction
> product**, the new figures are recorded beside it, and what reproduces byte-identically now is **every
> monetary and count field** — which is the claim worth making.

## 6 · Falsifiers · [`src/benchmark/pairingOrder.test.ts`](../src/benchmark/pairingOrder.test.ts)

19 tests, pinned before the fix. Both directions bite — false pairing **and** false refusal.

| # | What it pins |
|---|---|
| 1 | reversing and rotating **billing** row order moves neither money nor mechanism |
| 2 | reversing and rotating **expectation** row order moves neither money nor mechanism |
| 3 | reversing **candidate enumeration** gives the identical verdict, refuted or not |
| 4 | M07 entitlement **A** becomes claimable |
| 5 | M07 entitlement **B** becomes claimable **identically**, despite the sibling sharing payer and amount |
| 6 | **M08 stays held** — a same-period sibling misallocation is not refutable |
| 7 | **M05 stays $0.00** and is never called a duplicate |
| 8 | M18's unrelated-payer surplus is **enumerated and found to be no candidate at all** |
| 9 | a re-key resolves only from the authoritative reference, and refuses without it |
| 10 | a migration resolves only from the **supplied** alias, with no references at all |
| 11 | two equally plausible counterparts ⇒ `AMBIGUOUS_MULTIPLE_COUNTERPARTS`, **never a pick** |
| 12 | **removing** the distinguishing fact restores the ambiguity |
| 13 | **adding** it resolves only the affected units and disturbs an unrelated one not at all |
| 14 | **no first-match remains**: checked on code with comments *and string literals* stripped |
| + | pairing needs a **single** survivor — zero and two both refuse to pick |
| + | a compound claim dies with **either** half and never survives on the half that holds |
| + | the ambiguous verdict **names** every surviving counterpart |

Test 14 reads the source because behaviour cannot prove the absence of a shortcut today's data never
reaches. It strips comments **and** string literals, because both legitimately discuss the defect by
name — the fourth instance of that lesson in this repository.

All **122** benchmark tests pass, including the frozen abstract examiner at `7dd786ba…`. **No golden
was edited.**

## 7 · Boundary

Observation only. `claimBoundary` unchanged on every unit. No Recovery Case, no candidate staged, no
production wiring, no contract change, no customer field requested. Synthetic throughout: it turns no
observed amount into proven **Revenue Returned** or **Auditable Revenue**.
