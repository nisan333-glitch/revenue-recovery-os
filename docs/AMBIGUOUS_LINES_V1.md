# Ambiguous live expectation lines · when may NH add two obligations?

**Status:** semantic decided and implemented in the benchmark core on 2026-10-05.
Nothing is wired into production. Contract **2.0.0** unchanged.
`OBLIGATION_IDENTITY_FIELDS` still `[]`.

---

## 1 · The question, stated narrowly

> **When multiple live expectation lines occupy the same reconciliation unit, what authoritative fact
> allows NH to ADD them?**

This was reached from a measurement, not from a design review. The V3 pre-fix baseline reported
**$8,879.40** of exposure on M17 that nobody owes. The cause is one line of arithmetic:

```ts
const expectedMinor = es.reduce((n, e) => n + (e.expectedAmountMinor ?? 0), 0);
```

Two unsuperseded expectation lines claimed one unit, and `reduce` summed them. The resulting
"expected amount" is **asserted by neither line**. The residual computed from it is therefore not a
measurement of anything — it is a number NH authored.

The temptation to answer it the easy way is strong, because the easy answers are all *available*:
there really are two rows, they really do have different ids, and the amounts really are there to be
added. None of that is evidence of additivity.

## 2 · The answer

> **Addition is permitted only where the source establishes that the lines are DISTINCT ADDITIVE
> OBLIGATIONS. Nothing about their co-location establishes it.**
>
> Absent that fact, the unit is **REFUSED** with a **null residual** — never summed, never
> arbitrated, and never silently dropped.

Explicitly ruled out as grounds for addition, each because it is manufacturable or coincidental:

| Rejected basis | Why it fails |
|---|---|
| same payer | co-location, not structure |
| same period | co-location, not structure |
| same amount | two unrelated obligations on one plan price are identical in amount |
| **different row ids** | **a duplicated export row has two distinct ids for one obligation** |
| row count | "there are two of them" is the observation, not its explanation |
| source ordering | file position is the beneficiary's to choose |

The fourth is the decisive one, and it is why the obvious answer — *distinct `schedule_line_id`s mean
distinct obligations* — is wrong. Distinct ids are exactly what a duplicated export produces.

## 3 · Why: the eight shapes, and the two that are additive

Eight distinguishable source situations put two live lines in one unit. **Six are not additive.**

| # | Shape | Additive? | Resolvable from today's facts? |
|---|---|---|---|
| 1 | supersession | **No** — one replaces the other | **Yes** · `supersedesRef` collapses it before this gate |
| 2 | linked amendment | **No** — same reason | **Yes** · same mechanism |
| 3 | **split schedule lines** (base + overage, seat tranches) | **YES** | **No** |
| 4 | **additive component lines** | **YES** | **No** |
| 5 | duplicate expectation row | No — summing doubles a real obligation | No |
| 6 | mutually exclusive alternatives | No — exactly one will apply | No |
| 7 | migration duplicate (one obligation, old + new schedule id) | No | No |
| 8 | overlapping effective periods | No | Partly · differing bounds already hit `REFUSED_OVERLAPPING_PERIODS`; **identical** bounds fall through to here |

**Shapes 3 and 4 are indistinguishable from 5, 6, 7 and the residue of 8** without an authoritative
fact. That is the whole finding. The two additive shapes are not rare or exotic — base-plus-overage is
ordinary billing — which is precisely why guessing feels safe and is not: the guess that correctly
sums a base and an overage also doubles every duplicated export row.

A corollary worth stating, because it is the same mistake one level down: **a count is not a
cardinality.** "Two rows exist" says something about the file. "Two obligations exist" says something
about the business. The contract carries the first and not the second.

## 4 · Does `NH-EX-2016` express the correct semantic? Correct semantic, wrong remedy for this layer

The user's instruction was not to copy the rule merely because it exists elsewhere. Examined on its
own terms:

**Its semantic is correct, and independently derived.** `NH-EX-2016`'s own remediation says *summing
them would state an obligation neither line asserts, and choosing one would be NH picking the
customer's number* — the same proposition as §2, reached in the expectation validator four days
earlier for the same reason.

**Its remedy is wrong for the core.** `NH-EX-2016`'s severity is **`row_quarantined`**: it *deletes
the rows*. At validation time that is right — the row never joins a population, nothing downstream
ever sees it, and the quarantine is reported. In the reconciliation core the same remedy would be a
different act: the obligation has already joined the population, so removing it makes a **real
obligation invisible** and the unit reads as clean. That is strictly worse than the bug it fixes —
hiding an obligation instead of declining to price it, and a silent $0 where the truth is "we do not
know."

So the core gets a **new state**, not a copied rule:

```ts
| "REFUSED_AMBIGUOUS_LIVE_LINES"
```

with `residualMinor: null` and `expectedMinor: null`, and `observedMinor` **retained** — because what
was billed is a fact, and only what was *owed* is in doubt. The unit stays visible, stays counted in
the refusal ledger, and stays out of every money sum. `UnitState` is enumerated nowhere outside the
core, so adding a value is additive.

This is a general lesson about rule reuse: **two layers can share a proposition and need opposite
mechanics.** A validator's job is to stop a row from entering. A reconciler's job is to report that it
cannot price one that already has. "Quarantine" and "refuse" are both correct answers to the same
question asked at different distances from the money.

## 5 · The minimum fact that would permit addition

A **source-stated component identity** per schedule line — `BASE`, `OVERAGE`, `SEAT-TIER-2` — where
two lines carrying **different non-null** components are provably distinct additive obligations.

Supplied through **governed terms**, exactly as the payer hierarchy and the alias map already are:

```ts
readonly additiveLineComponents?: Readonly<Record<string, string>>;
```

* **Optional**, so no existing caller and no frozen-examiner fixture changes.
* **Absence refuses.** "Not stated" is not "distinct." Fail-closed, as every other capability here is.
* **Supplied, never inferred.** Deriving a component from an amount, an id, a name or a row position
  would be NH authoring the distinctness it is supposed to be reading — the identical error the
  semantic-equivalence correction and the missing-invoice standard both name.
* **Both halves required:** every line must state a component (`everyLineStated`) **and** the stated
  components must be pairwise distinct (`allDistinct`). Two lines both labelled `BASE` are still
  ambiguous — that is a duplicate wearing a component label, and it refuses.

### Recorded as an OPEN GOVERNANCE QUESTION, not as settled

This fact is **beneficiary-adverse in the same direction the admission bar is**: claiming distinctness
*inflates the expectation and therefore the exposure*. A beneficiary who wants a larger leakage number
would supply component labels liberally. Under the standing architecture test that is the shape that
must be refused — so before any production use the component map needs the same governance the
admission policy and the analysis terms already have: registered, versioned, hash-committed, proposed
by one identity and activated by another.

**The frozen synthetic package emits no such fact.** M17 therefore stays refused, the data is
untouched, and nothing in this slice exercises the permissive branch outside its own unit tests.

## 6 · What it cost, measured

On the frozen V3 package, the intended entitlement/subscription grain, scorer byte-identical at
`060359f5…`, core `831b2dab…` → `ec1efe95…`:

| Figure | PRE-FIX | POST-FIX |
|---|---|---|
| true positive | $62,446.00 | **$62,446.00** |
| **false positive** | **$8,879.40** | **$0.00** |
| false negative | $3,896.00 | $3,896.00 |
| monetary recall | 72.66% | **72.66%** |
| monetary precision | 68.68% | **76.11%** |
| ambiguous refusals | — | **2 of 600 units** |

**Nothing legitimate was lost.** The refusal fires on exactly the two units the ground truth marks
`nh_must_refuse: YES`, and `refusalsWarranted` rises 2 → 3 while `refusalsUnwarranted` stays **0**.
Full figures in [`BENCHMARK_REVISION_V2.md`](BENCHMARK_REVISION_V2.md) §V3.

### The payer-period aggregate, and what the refusal reveals about it

At `D_PAYER_PERIOD` the same rule refuses **198 of 309 units** and recall falls 66.16% → 3.57%.

That is not a regression; it is a diagnosis. A payer×period unit merges sibling entitlements by
construction, so **almost every unit at that grain is an unsupported aggregation** — the grain's
arithmetic *is* the defect this rule names. The earlier finding was that payer-period cannot attribute
a residual to an obligation. This is stronger: it sums obligations the source never stated as
additive. `refusalsUnwarranted` there rises 2 → 16, which is the honest cost of applying a correct
rule to a grain that cannot satisfy it.

**It remains the case that payer-period must not ship as the reconciliation grain**, and this slice
strengthens rather than weakens that conclusion.

## 7 · Falsifiers · [`src/benchmark/ambiguousLines.test.ts`](../src/benchmark/ambiguousLines.test.ts)

Fourteen tests, pinned **before** the fix. Both directions bite — false aggregation **and** false
refusal — because a rule that only ever refuses is indistinguishable from a broken detector.

| # | What it pins | Direction |
|---|---|---|
| 1 | two ambiguous live lines → `REFUSED_AMBIGUOUS_LIVE_LINES`, null residual | aggregation |
| 2 | two source-proven components **CAN** be summed | **refusal** |
| 2b | the same component stated twice is still ambiguous | aggregation |
| 2c | a partial component map does not unlock | aggregation |
| 3 | a superseded line contributes no money | aggregation |
| 4 | a linked amendment does not double-count old + new | aggregation |
| 5 | a duplicate expectation row creates no money | aggregation |
| 6 | a migration duplicate creates no money | aggregation |
| 7 | two unrelated obligations do not collapse because payer and period match | **refusal** |
| 8 | an UNKNOWN amount stays UNKNOWN, ambiguity or not | both |
| 9 | ambiguity is **not** resolved by amount similarity | aggregation |
| 10 | ambiguity is **not** resolved by row order | aggregation |
| 11 | **removing** distinctness turns exact money into REFUSED | aggregation |
| 12 | **adding** distinctness restores exact money and disturbs no other unit | **refusal** |

Test 12's first form failed, and the failure is worth recording because the test was wrong and the
core was right: the helper returned the **dataset-level** unpaired total alongside the per-unit
fields, so comparing one entitlement before and after folded a second entitlement's money in. Both
numbers were correct behaviour. Re-aimed at a per-unit projection plus explicit dataset totals. The
recurring lesson — **a guard must take its subject as its subject** — now has its fourth instance in
this repository.

## 8 · The frozen abstract examiner

`R15x` in `reconciliationScenarios.ts` is itself an ambiguous-live-lines case, and its authored truth
says `positiveExposureMinor: 0` with the note *"counting the superseded $100 would be a FALSE POSITIVE
of $100."* NH was producing that $100. The fix therefore moves NH **toward** its frozen truth.

`reconciliationScenarios.ts` stays byte-identical at `7dd786ba…`, all 85 benchmark tests pass, and
**no golden was edited.** Had any frozen assertion moved, that would have been reported as a finding.

## 9 · Boundary

Observation only. `claimBoundary` on every unit remains
`{observationOnly: true, provesEventCorrectness: false, constitutesProof: false, constitutesRevenue: false}`.
No Recovery Case is created, no candidate is staged, and **Revenue Returned and Auditable Revenue are
unchanged.** This is a pilot-data trust rule and turns no observed amount into proven revenue.
