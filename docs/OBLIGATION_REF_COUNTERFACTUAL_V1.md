# Counterfactual · what does a billing-side obligation reference unlock?

**Recorded 2026-10-07.** One controlled synthetic counterfactual. The V3 package, its ruler, its ground
truth, its recorded results and `reconciliationCore.ts` are **all byte-identical afterwards** — proven,
not asserted (§2). Nothing is wired into production, contract **2.0.0** is unchanged,
`OBLIGATION_IDENTITY_FIELDS` is still `[]`.

---

## 1 · The question, and the one fact that was added

> **What additional money becomes trustworthily detectable if the billing side provides an
> authoritative obligation reference?**

The experiment is a derived variant of the frozen V3 package carrying **exactly one new column**:
`obligation_ref` on the billing export, stating which contract obligation (`schedule_line_id`) each
invoice line settles. It is **stated by the source at emission**, never inferred — nothing reads an
amount, a date, a payer, a row position or any NH identifier to arrive at it.

This is not a field invented for the experiment. `C_SCHEDULE_LINE` has been declared **NOT
CONSTRUCTIBLE** in `grainCandidates.ts` since the grain study, for precisely this reason:

> *"The billing export emits no schedule-line identity. `invoice_line_id` is a position WITHIN an
> invoice ('L1', 'L2'), not a reference to the obligation it settles… This is the missing fact, not a
> missing adapter."*

**The hypothesis was pre-registered by the frozen truth itself.** `ground-truth.csv` carries a
`source_facts_required` column authored before any of this work, and M07's value is
`"PER-OBLIGATION EVENT IDENTITY — the money nets to zero at every grain"`. So which mechanisms *should*
improve was not chosen after seeing the result; the frozen package already said.

### The semantics, declared before the run

`obligation_ref` states **billing's own allocation**, not settlement intent. Where billing's allocation
step is itself the defect (M08: a line raised against a sibling entitlement), the reference names the
obligation billing *put the money against* — so it agrees with the wrong `subscription_id` and testifies
to nothing new. This is the conservative reading and the reason is epistemic: **a record produced by the
step that failed cannot testify about that step.** The consequence was accepted up front — M08's
$2,798.00 is not claimed.

## 2 · The baseline did not move, and here is the proof

| Artefact | After the experiment |
|---|---|
| `reconciliationCore.ts` | `ec1efe95…` — **unchanged** |
| `reconciliationScenarios.ts` | `7dd786ba…` — **unchanged** |
| `grainCandidates.ts` | **unchanged**, and pinned by a test (§7.12) |
| V3 `score.mjs` (the ruler) | `060359f5…` — **unchanged** |
| V3 `expectation.csv` / `observation.csv` / `ground-truth.csv` / `planted-register.json` | `31992d23…` / `0ef21e40…` / `0f5558e4…` / `111db9d1…` — **all unchanged** |
| V3 `FREEZE.lock.json` | **unchanged**, still `revision: V3` |

The variant's own verifier checks all of this on every run, including that V3's harness still hashes to
V3's own lock — *"we changed nothing over there"* is a gate, not a promise.

**The variant is V3 plus one column, proven by six integrity proofs that gate the freeze:** the
expectation export, the ground truth and the authoritative register are **byte-identical**; the billing
export is identical **cell by cell across all 598 rows × 14 pre-existing columns** after removing the
new one; planted money is still **$85,942.00** across **19** mechanisms; and the new column is non-blank
on every row and names an obligation that exists on the expectation side.

**The ruler's arithmetic is byte-identical.** The variant scorer is a copy of V3's with two lines
redirected (`DIR`, and the banner naming the variant); the complete diff is committed as
`score.v3-to-variant.diff`, and the verifier re-derives it with comments stripped and refuses any other
hunk. A counterfactual measured with a reshaped ruler measures the ruler.

> **An instrument defect, recorded because it is the second instance of the same class.** The first form
> of proof 4 re-serialised the stripped variant and hashed it. It reported a difference that did not
> exist: the file carries no trailing newline and the re-serialiser added one. Cell comparison found
> **zero** differing cells. That is the same error as the $89.70 transport bug V3 exists to correct — an
> apparatus artefact read as a finding — so the proof now compares cells, and the lesson is explicit:
> **when an instrument and its subject disagree, suspect the instrument first.**

### The two controls

The same variant exports were also run through the **unmodified core** at V3's two grains, ignoring the
new column. Both reproduce V3's post-fix figures **identically on all 18 scored fields, witness
included**. So any movement in the reading under test came from the new **fact**, not from new **code**.

## 3 · The result

`F_OBLIGATION_REF` versus V3's `E_SUBSCRIPTION_WITH_LEGACY_ALIAS`, same ruler, same truth:

| Figure | V3 baseline | **With obligation refs** | Δ |
|---|---|---|---|
| authoritative planted money | $85,942.00 | $85,942.00 | — |
| **headline money claimed** (unpaired) | $60,246.00 | **$70,046.00** | **+$9,800.00** |
| gross positive (incl. held out) | $82,046.00 | $82,046.00 | **—** |
| paired held out | $21,800.00 | **$12,000.00** | −$9,800.00 |
| **false positive** | **$0.00** | **$0.00** | **—** |
| true positive | $62,446.00 | $62,446.00 | — |
| false negative | $3,896.00 | $3,896.00 | — |
| monetary recall | 72.66% | 72.66% | — |
| monetary precision | 76.11% | 76.11% | — |
| UNKNOWN-money cases | 3 | 3 | — |
| unpriced units | 4 | 4 | — |
| refused units (warranted / unwarranted) | 23 (3 / **0**) | **11 (2 / 0)** | −12 |
| attribution coverage | 19 of 19 clusters | 19 of 19 | — |
| obligation-identity coverage | *unavailable* | **AVAILABLE** (0 unkeyed of 597) | new |
| obligation events reported | — | **29** never-settled, **6** multiple-settlement | new |
| alias map required | 28 aliases | **0** | −28 |

**Gross positive is unchanged**, which is the invariant that proves the correction *moved* money between
columns rather than creating any. **Zero fabricated money, before and after.**

**TP and recall are flat, and that is correct rather than disappointing.** The ruler computes true
positive over cases with `nh_should_detect: yes`, and M07 is `no` — the frozen truth correctly recording
that the *baseline* capability should not have found this money. Reporting the unlocked money as a rise
in TP would require re-authoring the truth to match the result, which is the tuning the freeze control
exists to prevent. So the two figures sit side by side and are never blended.

### Mechanism by mechanism

| Mechanism | Change | Why |
|---|---|---|
| **M07** duplicate masks missing | **+$9,800.00 released** (of $19,600.00) | the refs prove February's surplus settles February's own obligation, so it cannot be a displaced settlement of March — see §5 for the other half |
| **M14** bare re-key | **12 refusals → 0** | identity resolved from the source's own reference, **with no alias map at all** |
| **M15** whole-book migration | resolved **without the legacy key** | the obligation reference was never billing's internal key |
| M02 · M03 · M04 · M11 · M18 · M20 | unchanged money | already fully detected; the refs add *why*, not *how much* |
| **M05** split invoice | **$0.00, unchanged** | two lines settling one obligation and summing correctly — the falsifier that must not move |
| **M08** wrong entitlement | **unchanged, still held out** | declared semantics: the reference cannot testify about the allocation that produced it |
| **M17** ambiguous identity | **2 refusals, unchanged** | the ambiguity is on the *contract* side; billing-side identity cannot cure it |
| M16 · M19 | UNKNOWN / refused, unchanged | the missing facts are an amount and an FX rate, neither of which this is |

**`refusalsWarranted` falls 3 → 2, and this is not a loss.** M14's truth says it must refuse *because*
it `"needs an AUTHORITATIVE alias map; without it the honest answer is a refusal"`. The variant supplies
authoritative identity, so the premise of the refusal is gone. Like `nh_should_detect`, that flag is
**capability-relative**, and the truth states the condition in its own `source_facts_required` column.

## 4 · Does obligation identity solve duplicate-invoice masking? **NO** — proven, not assumed

Three mechanisms in the frozen package make this decidable. Under obligation identity **all three are the
same shape**: a surplus, a shortfall of equal size, and one obligation cited more than once.

* **M05-split-invoice** — one obligation, **two** settlement lines, summing correctly. Truth: **$0.00**.
* **M07-duplicate-masks-missing** — one obligation, **two** settlement lines, summing to double. Truth:
  **$19,600.00** of real missing money elsewhere.
* **M08-wrong-entitlement** — the sibling's obligation cited twice, the right one never. Truth: the
  company **was paid**.

A rule of *"two settlements ⇒ duplicate"* fabricates money on M05 and on M08. So:

> **Obligation identity is sufficient to unlock M07's MONEY** — it refutes the timing-displacement
> hypothesis that was holding it out.
> **It is NOT sufficient to establish the DUPLICATE as an EVENT**, because M05 proves one obligation may
> legitimately carry two settlement lines, and no reference says which case this is.

The module therefore reports **`MULTIPLE_SETTLEMENTS_OBSERVED`** — 6 of them: M05's three, M07's two and
M18's stranger — and **never the word duplicate**, asserted on what the module returns rather than on a
fixture. `duplicateEstablishable` is a declared
**`UNAVAILABLE_NO_EXPECTED_SETTLEMENT_COUNT`**, not an omission.

What it *can* prove positively is **`OBLIGATION_NEVER_SETTLED`** — the obligation exists and no
settlement line cites it — **29 of them**, which is a genuine new event capability rather than a
monetary one.

### The refutation is scoped to what the fact can testify about

A pairing is a *hypothesis*. Obligation identity can refute exactly one of the three the core forms:

* `ADJACENT_PERIOD_SAME_ENTITLEMENT` asserts a **timing displacement** — the obligation was settled in
  the wrong period. The reference speaks to that claim directly. **Refutable.**
* `SIBLING_ENTITLEMENT_SAME_PAYER` and `SIBLING_PAYER_UNDER_HIERARCHY` assert a **misallocation** — the
  money reached the company under another identity. Under the declared semantics the reference is
  produced by the very allocation step that failed. **Not refutable.**

That asymmetry is *"doubt is scoped to the evidence that creates it"* applied to the **evidence** rather
than to the doubt: **a fact may only settle the questions it can testify about.** Ignoring it would
release M08's $2,798.00 — money the company was already paid — as leakage.

## 5 · The other $9,800.00 · a PRODUCT defect found by the experiment, not a missing fact

My written prediction was that M07 would release **$19,600.00**. It released **$9,800.00**. The cause is
worth more than the money.

M07's cohort is two entitlements, `syn-ent-0019` and `syn-ent-0020`. They **share payer
`syn-acct-012`** and both cost **$9,800.00**. The core's pairing pass scans all negative units and takes
the **first exact-amount counterpart**:

```
over-billed units, in scan order:
  [0] syn-ent-0019  2026-02-01  -$9,800.00
  [1] syn-ent-0020  2026-02-01  -$9,800.00
```

* `syn-ent-0019` March (+$9,800) matches **[0] — its own February** → `ADJACENT_PERIOD_SAME_ENTITLEMENT`
  → refuted by the references → **released.**
* `syn-ent-0020` March (+$9,800) also matches **[0] first** → a *different* entitlement with the same
  payer → `SIBLING_ENTITLEMENT_SAME_PAYER` → **not refutable** → still held out.

Its true counterpart is **[1], its own February** — the strictly more specific hypothesis, and the
factually correct one — but the scan never reaches it.

> **The pairing mechanism assigned is decided by array order, not by evidence.** Two obligations of the
> same payer at the same price are enough to make the core prefer a misallocation hypothesis over the
> timing hypothesis that is actually true, and the choice is a consequence of row position.

This is the same family as the event-ordering defect (governed issue #4): **a conclusion that depends on
an order nothing authoritative established.** It has a monetary consequence — $9,800.00 of real missing
money held out under a mechanism that is factually wrong — and it was invisible until obligation
identity made the difference between the two hypotheses observable.

**The refutation rule is not too strict; the pairing selection is wrong.** Loosening the rule to release
sibling pairings would also release M08. The correct fix is upstream and costs the customer nothing:
**prefer the most specific reachable mechanism, and never let row order decide.** Not changed here — the
core was explicitly out of scope for this slice.

## 6 · What remains invisible even with obligation identity

| | Amount | Why |
|---|---|---|
| M07's second half | $9,800.00 | the pairing-order defect above — **a product fix, not a source fact** |
| M08 wrong entitlement | $2,798.00 | the company was paid; the reference cannot testify about the allocation that produced it |
| M09 wrong payer | $3,298.00 | the company was paid; an attribution failure, not missing money |
| M16 unknown amount | UNKNOWN | no authoritative amount exists for a usage line |
| M17 ambiguous identity | UNKNOWN | needs the **contract-side** distinct-additive-obligation declaration |
| M19 cross-currency | UNKNOWN | needs a governed FX rate, deliberately absent |

### A correction to my own earlier claim

The V3 closing report called M07's $19,600.00 *"structurally invisible… a duplicate invoice masking an
omission inside one reconciliation unit — grain-independent and permanent."* **That was wrong on both
counts, and the experiment is what proved it.** At entitlement×period grain February and March are
**different units**; the money was held out by the **pairing rule**, which is a deliberate epistemic hold
pending attribution, not a structural blindness. And it is not permanent: half of it is released by one
source fact and the other half by a product fix.

The constitution's general claim — that a duplicate masking an omission nets to zero *where both errors
live inside the same reconciliation unit* — remains true. It simply was not what was happening here.

### A second, separate overstatement found while measuring

`reconciliationCore`'s `coverage.event` reads **AVAILABLE** whenever every *expectation* row is keyed.
But an event check needs **both** sides keyed, and the billing side has no obligation identity at all in
V3 — so an event reconciliation is impossible exactly where the field says it is available. The variant
declares its own two-sided `obligationCoverage` and refuses to inherit the claim. **Reported, not
patched** — the core is out of scope here, and a test pins the current value so the finding cannot be
quietly lost.

## 7 · Falsifiers · [`src/benchmark/obligationAware.test.ts`](../src/benchmark/obligationAware.test.ts)

18 tests, pinned before the frozen variant was scored. Both directions bite.

| # | What it pins |
|---|---|
| 1 | M07 releases only when the refs prove the surplus settles its **own** period's obligation |
| 2 | **the same data with every reference blanked is held out** — the fact moved the money, not the code |
| 3 | refutation **moves** money between columns and creates none (gross invariant) |
| 4 | the pairing **stands** when a surplus line names the deficit's obligation — a genuinely mis-dated invoice |
| 5 | **M05 stays $0.00** and is reported as multiple-settlement with the missing fact named |
| 6 | **M08 stays paired** — a sibling pairing is not refutable by obligation identity |
| 7 | **M17 stays refused** — billing-side identity does not cure contract-side ambiguity |
| 8 | M16 stays UNKNOWN; M19 stays currency-refused |
| 9 | M18's unrelated-payer surplus is still unreachable |
| 10 | a bare re-key resolves **with no alias map**, and without the reference refuses honestly |
| 11 | a blank reference **fails closed per row and discards nothing** |
| 12 | a reference naming no obligation is **reported, never silently matched** |
| 13 | coverage is UNAVAILABLE when the billing side is unkeyed — never AVAILABLE from one side |
| 14 | the word *duplicate* appears in **no** event kind the module can emit |
| 15 | its own scheme `oblig-2026.1`, naming the `recon-2026.1` arithmetic it borrowed |
| 16 | **GUARD: `GRAIN_CANDIDATES` still holds exactly V3's five ids**, and `C_SCHEDULE_LINE` is still NOT CONSTRUCTIBLE |

Guard 16 closes a real hole: **the V3 freeze lock covers `scripts/reconciliation-synthetic/` and the
four data files, but not `src/benchmark/`** — so adding a candidate would have silently changed V3's own
recorded run with no gate noticing.

One falsifier failed on its first form and the **test** was wrong, not the core: the re-key fixture let
the helper derive a payer, so the payer differed on the two sides and the core's unmatched-identity doubt
could not reach the unit at all. A re-key changes billing's internal key, not the payer.

## 8 · THE BUSINESS ANSWER · incremental trustworthy dollars per source field

Ranked by money unlocked in the frozen synthetic truth, with **$0.00 fabricated money throughout**.

| Rank | Source field NH would ask the customer for | Incremental money | Capability unlocked |
|---|---|---|---|
| **1** | **`obligation_ref` on the billing export** — which contract obligation each invoice line settles | **+$9,800.00** | 12 refusals resolved · the 28-alias map **no longer needed** · bare re-keys resolved · 29 never-settled obligations observable · obligation coverage AVAILABLE |
| — | *(product fix: prefer the most specific pairing; order must not decide)* | *+$9,800.00* | **costs the customer nothing** |
| 2 | **expected settlement count per obligation** | $0.00 | turns 6 `MULTIPLE_SETTLEMENTS_OBSERVED` into establishable duplicate-vs-instalment verdicts — the duplicate **event** |
| 3 | **contract-side distinct-additive-obligation declaration** | $0.00 (M17 is UNKNOWN) | 2 refusals become priceable — **but it inflates exposure, so it needs governance first** |
| 4 | **governed FX rate** | $0.00 (absent by design) | 9 currency refusals become comparable |
| 5 | **authoritative amount for usage lines** | $0.00 | none — the amount does not exist to be supplied |
| — | authoritative payer hierarchy | $0.00 | **already supplied** via `parent_account_id` |

### The minimum customer data request

> **One field.** A billing-side obligation reference unlocks **$9,800.00** of the **$85,942.00** planted
> — **11.4% of planted money, +16.3% on headline claimable money** — with **zero fabricated money**, and
> it is the **only** field in this experiment that unlocks any money at all. Everything else buys
> *capability*: refusals resolved, events made observable, identity made robust to re-keying.

Three caveats, stated rather than buried:

1. **A field that unlocks $0.00 here is not a field that unlocks $0.00 in general.** M14 and M15 hide
   **$0.00 by construction** in this package. In a real book a bare re-key or a migration conceals
   whatever money sits behind it, and obligation identity is what reaches it. The $9,800.00 is a floor on
   this dataset, not an estimate of a customer's.
2. **Capability is not revenue.** 29 never-settled obligations and 12 resolved refusals are reported
   separately from money for exactly this reason, and none of them is Revenue Returned.
3. **The next $9,800.00 is free.** It needs no customer field at all — only the pairing-order fix in §5.
   Asking a customer for data to solve a problem in our own code would be the wrong request.

## 9 · Boundary

Observation only. `claimBoundary` on every unit is
`{observationOnly: true, provesEventCorrectness: false, constitutesProof: false, constitutesRevenue: false}`.
No Recovery Case, no candidate staged, no production wiring, no contract change. Everything here is
**synthetic** and turns no observed amount into proven **Revenue Returned** or **Auditable Revenue**.
