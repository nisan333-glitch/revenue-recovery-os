# Detector #2 — overdue obligations outside the activation-stall cohort (v1)

**Status:** built 2026-10-05. Pilot detection and valuation only. **Nothing here is proven Revenue
Returned**, and no figure on this surface is an estimate, a forecast, a recoverability claim or a causal
claim.

---

## 1. The defect this closes

Before this slice NH detected exactly **one** leakage family, and the cause was one line:

```ts
// src/assessment/observed.ts
for (const c of stalled) {
```

`observedSummary` is called with the stalled cohort only (`src/assessment/assess.ts`), so **payment state
was never evaluated** for a cycle routed to `reference` or `undetermined`. An overdue unpaid invoice on an
account that activated on time was invisible **by construction** — not mis-scored, not down-weighted,
not seen at all.

That is a detection ceiling, not a tuning problem. Widening it is the cheapest real increase in monetary
coverage available, because the classifier, the money primitives and the exclusion discipline already
existed and are reused unchanged.

---

## 2. The architectural decision: a separately governed sibling artifact

The obvious implementation — two money scalars added to `AssessmentFinding` and to `canonicalFinding` —
is a **silent semantic re-grade** and was rejected.

`canonicalFinding` serialises a fixed key list. Adding a key changes the JSON and therefore the SHA-256.
Stated exactly:

> same historical input + same governed terms + same `ASSESSMENT_CALC_VERSION` ⇒ **different**
> `findingHash`

`findingHash` would stop being a function of *(input, terms, calculation method)* and become a function of
*(input, terms, calculation method, **build**)*. That is precisely the drift `ASSESSMENT_CALC_VERSION`
exists to make visible, and it breaks **Trust Invariant rule 5** — historical proof must stay *reproducible*
forever. A hash that can no longer be recomputed from the facts it covers is not a witness.

### Why "nothing fails today" was never the right test

The mechanical exposure is genuinely narrow, and it was verified rather than assumed:

| Question | Answer |
|---|---|
| Production callers of `hashFinding` | **exactly one** — `server/agents/pilotAssessmentAgent.ts`, at the moment a finding is produced |
| Anything that re-hashes a **stored** finding | **none**; `verify:registers` covers only the two governed registers, there is no finding sweep |
| Table mutability | append-only (`nh_reject_mutation` on UPDATE/DELETE) |
| Can `recordFindingIfAbsent`'s conflict compare fire for a completed execution? | **no** — task claim selects `status IN ('queued','retry_wait')`, and a finished task is set `'succeeded'`, so it is never re-claimed |

So nothing would have broken. The reproducibility *property* would still have been destroyed, **silently**.
That is the worst shape a defect can take in this product, so the design went the other way.

### The two artifacts

| Artifact | Canonical form | Version constant | Status after this slice |
|---|---|---|---|
| `AssessmentFinding` (activation-stall surface) | `canonicalFinding` | `ASSESSMENT_CALC_VERSION = "assess-2026.1-thin"` | **byte-identical, untouched** |
| `NonStalledExposureFinding` (new) | `canonicalExposureFinding` | `NON_STALLED_EXPOSURE_METHOD_VERSION = "nse-2026.1"` | new, independently versioned |

`src/contract/exposureFinding.ts` owns `EXPOSURE_FINDING_SCHEME = "nh-non-stalled-exposure-v1"`, its own
canonical JSON (fixed key order, state counts sorted, scheme **and** method version inside the preimage)
and its own `hashExposureFinding`. This mirrors how the repository already separates concerns:
`POLICY_HASH_SCHEME`, `ANALYSIS_TERMS_HASH_SCHEME`, `EXECUTION_BINDING_SCHEME` and
`LEAK_INSTANCE_IDENTITY_SCHEME` each own their identity instead of sharing one.

A future change to how non-stalled exposure is computed is therefore visible in
`NON_STALLED_EXPOSURE_METHOD_VERSION` **without** touching the assessment's calculation method,
re-blessing a single governed AnalysisTerms version, or re-assessing one admitted extract.

### Explicitly preserved, each with its own test

`ObservedSummary`'s shape · the `observedSummary(stalled, policy)` call · the behaviour fingerprint
(`nhcm_12b105f78dcae1c1`) · `canonicalFinding` · `hashFinding` · `AssessmentFinding` ·
`ASSESSMENT_CALC_VERSION` · `assessmentId` (whose preimage has no result-shape dependency: fingerprint,
policy id/version, `asOf`, `stallThresholdDays`, `calculationMethodVersion`, `mappingId`, amount format,
date locale).

⇒ **No `ASSESSMENT_CALC_VERSION` bump. No terms re-blessing. No re-assessment. No `NH-AX-1014` storm.
No `pds` v3. No PAD v2. No hash-scheme change.**

`AssessmentResult` — the pure in-process result — *does* gain `nonStalledExposure`. It is hashed nowhere;
`src/assessment/record.ts`, the only module that hashes an `AssessmentResult`, has zero callers.

---

## 3. Storage, and the fact that "not computed" is not "zero"

Three **nullable** columns on the existing append-only finding table (`exposure`, `exposure_hash`,
`exposure_method_version`), written in the **same INSERT** as the finding, so the exposure inherits that
path's idempotency, atomicity and mutation trigger rather than duplicating subtle conflict logic in a
second table. A conditional CHECK refuses a half-written reading — all three present or all three absent —
and a second CHECK holds `exposure_hash LIKE 'sha256:%'`.

That constraint earned itself on the first write. Prisma's `Json?` given `null` stores the **JSON value
`null`**, which `IS NULL` does not match, so neither CHECK branch held and the insert was refused instead
of silently storing an incoherent row. The fix is `Prisma.DbNull`.

**An execution completed before this slice has a finding and no exposure.** Every surface says *"Not
computed for this execution … which is not the same as a figure of zero."* Rendering the first as the
second would assert that a healthy-activation population was checked and found clean, which nobody
checked. Three tests hold that line, including the side-by-side revision comparison, where the earlier
column must not acquire a zero it never recorded.

---

## 4. Population, disjointness, additivity

`splitCohorts` assigns each accepted cycle to exactly one of `stalled` / `undetermined` / `reference` via
`if / else if / else`, so the partition is **total and disjoint**. Detector #2's population is the
complement of the stalled cohort, taken in source order for determinism:

```ts
const stalledIds = new Set(stalled.map((c) => c.cycleId));
return Object.freeze(accepted.filter((c) => !stalledIds.has(c.cycleId)));
```

Formally, over the accepted population `A` with stalled subset `S`:

```
P₂ = A \ S           |S| + |P₂| = |A|           S ∩ P₂ = ∅
TOTAL_unpaid  = Σ_{c∈S, state(c)=Unpaid} amount(c)  +  Σ_{c∈P₂, state(c)=Unpaid} amount(c)
TOTAL_partial = Σ_{c∈S, state(c)=PartiallyPaid} rem(c) + Σ_{c∈P₂, state(c)=PartiallyPaid} rem(c)
                where rem(c) = max(amount(c) − paid(c), 0)
```

**Proven as tests, not asserted in prose:** the whole accepted population is classified independently and
the two surfaces must sum to it, exactly, in minor units — for both the unpaid and the partial figure —
plus pairwise-disjoint id sets and `|S| + |P₂| = |A|`, including a run over the real CSV path.

### "Overdue" needs no new predicate

`classifyPayment`'s cascade returns `NotYetDue` **before** `Unpaid` and `PartiallyPaid`, so both of those
states already imply `dueAt ≤ asOf`. Pinned by a test rather than relied on by reading.

### Money

`Unpaid` ⇒ the full obligated amount. `PartiallyPaid` ⇒ `clampNonNegative(subMoney(amount, paid))`.
Integer minor units throughout via the existing `addMoney` / `subMoney` / `clampNonNegative` / `zeroMoney`
primitives. No floats, no inferred amount, no baseline, no modelled revenue. Cross-currency preserves the
existing fail-closed throw.

### False-positive controls, all preserved

`NotYetDue`, `PaidOnTime`, `PaidLate` (settled in full ⇒ zero outstanding), dated `Refunded` and dated
`Cancelled` (surfaced as `excludedValue`, never silently dropped), `Unknown` (surfaced as `unknownValue`,
**not** counted as exposure), and observations after `asOf`. A payment dated after the cut-off with a known
amount classifies `Unknown` — more conservative than exposure, and asserted in both sub-cases.

---

## 5. The $9,300 → $14,800 reconciliation

Nothing was replaced. The audit listed **two** representable-but-undetected obligations and totalled them;
`$9,300` is one of the two. Enumerated from the frozen register
(`e2e/fixtures/synthetic-validation-2026-09-27/ground-truth.json`) — every planted scenario with
`expected_cohort ∈ {reference, undetermined}` and `expected_payment_state ∈ {Unpaid, PartiallyPaid}`:

| Scenario | Entity | Cohort | State | Minor | Class |
|---|---|---|---|---|---|
| **S18** | `n-unpaid-but-activated-promptly` | reference | **Unpaid** | **930 000** | `unpaid_invoice_without_activation_stall` |
| **S17** | `n-exactly-at-threshold` | reference | **Unpaid** | **550 000** | `near_miss_exact_threshold` |

```
$ 9,300.00 =   930 000 minor = S18   (the audit's named figure — unchanged)
$ 5,500.00 =   550 000 minor = S17   (the audit's second class)
$14,800.00 = 1 480 000 minor = S18 + S17
```

* **Exactly two obligations**, `row_count: 1` each.
* **Both `Unpaid`. Zero `PartiallyPaid`** — so the partial-outstanding path has **no** frozen ground truth
  and is covered by this slice's own fixture, never claimed from the frozen corpus.
* Both carry `expected_amount_minor: 0`, which is a claim about the **stalled** surface. That surface stays
  byte-identical, so the frozen artifacts remain true and are untouched.
* `$14,800` is the independent **business register** value (`business_leakage_minor`), never an NH figure.
* S17 is legitimately in scope: its own frozen narrative says *"the unpaid invoice is a collections matter,
  not activation leakage"* and *"a revenue operator would very likely want to see this money somewhere."*

---

## 6. The churn subpart — STOPPED, with the ambiguity reported

The brief permitted stopping rather than guessing. This subpart **must** be stopped, and the reasons are
structural rather than a matter of effort.

1. **`status` is `optional`, `kind: "enum"`, with no members.** `FieldSpec` has no field capable of holding
   an enumeration; the validator derives behaviour only from `date` / `identifier`; the customer-facing
   contract gives `status` kind `—` and never mentions churn, cancellation-by-status, or final invoices.
2. **The contract's terminal state is a flag/status *plus an effective date*.** An undated terminal state is
   already **rejected** as `undated_terminal_state`.
3. **The governed path is structurally blind to status.** `projectExecutionInput` sets `statusRaw: null` —
   a deliberate privacy decision, pinned by a test that plants an email in that field. A status-based
   control would work in the local preview and be **inert in the worker**, where the money is actually
   measured. That asymmetry is worse than having no control.
4. **`excludedStatuses` must not be the mitigation.** It is ungoverned, absent from the AnalysisTerms hash
   preimage, defaults `[]`, and is omitted by every production `makePolicy` call site. Wiring it would hand
   the beneficiary a free-text lever that removes rows from the denominator with no second-identity
   approval — contradicting the rule that *anything that can change which rows count is part of the
   definition*, and failing the standing architecture test outright.

Four things are missing before a status could establish that an obligation was voided: a declared
enumeration, a declared meaning, a guarantee of presence (18 of 271 frozen rows are blank), and a governed
non-beneficiary lever. **That is a contract decision with an owner, not a detector decision.**

Detector #2 ships safely because it introduces **no new status interpretation**: exclusion only on a
*dated* terminal state, identical to the headline's rule. The residual risk is real and is stated rather
than buried — churned accounts typically activate fine, so they are non-stalled, so widening increases
their weight. **The gap's current behaviour is therefore pinned by a test**: `status = churned`, undated,
overdue, unpaid ⇒ **counted**, with the test naming it as the reported limitation. The frozen corpus
contains no such row, so this has never been validated against ground truth.

---

## 7. Benchmark — synthetic, and what it does not license

Driven end to end through **CSV → adapter → `assess`**, so the claim is about admitted customer-shaped
data rather than hand-built objects. It reproduces S18 and S17 faithfully and, because the frozen corpus
contains no non-stalled partial payment, supplies its own partial ground truth including an odd-cent
obligation (`2000.01` obligated, `1234.56` paid ⇒ `76 545` minor exactly).

```
planted non-stalled leaks        : 4
expected exposure (minor)        : 2 056 545   ($20,565.45)
detected exposure (minor)        : 2 056 545   ($20,565.45)
of which the frozen register     : 1 480 000   ($14,800.00) = S18 930 000 + S17 550 000
monetary recall                  : 100.00%
monetary precision               : 100.00%
false-positive amount (minor)    : 0
leaks found exactly              : 4/4
```

**BEFORE** (stalled-only): the planted non-stalled money is **$0.00 detected** — asserted, not described.
**AFTER**: found to the exact minor unit.

Controls each measured on their own and each contributing exactly zero: not yet due · paid on time · paid
late but in full · dated refunded · dated cancelled · untimeable `Unknown` · a stalled unpaid cycle staying
**only** in the existing bucket · a non-stalled unpaid cycle appearing **only** in Detector #2 ·
cross-currency preserving the fail-closed throw.

**This is synthetic validation. It is not real-world recovery proof, and 100% recall on one fixture
licenses no general coverage claim** — not across the 25 leakage families, not across customers, and not
across data shapes this fixture does not contain (notably a churned account, per §6).

---

## 8. Output and vocabulary

The operator sees three figures separately — the existing activation-stall exposure, the new non-stalled
**overdue unpaid**, the new non-stalled **overdue partial outstanding** — plus a combined figure that is
**computed for display from the two disjoint surfaces and never stored**, so it cannot become an identity
component. Every figure is labelled **OBSERVED**.

Surfaces: the governed execution panel, the local preview, the re-assessment side-by-side comparison, and
the methodology export.

Vocabulary: *observed*, *overdue*, *exposure*. Never *recovered*, *recoverable*, *returned*, *proven*, or
any causal claim. This is enforced, not merely intended — and the enforcement had to be designed
correctly: a blanket substring ban is the **wrong instrument**, because the panel's own disclaimer *denies*
those words. The test requires every occurrence of a claim word to be **negated by the words immediately
before it**; an affirmation fails it, a denial passes. The check is bounded by the section's own closing
tag rather than a character count, after a fixed window overran into a neighbouring panel that legitimately
says "it is not recovered revenue" about the headline.

**Deliberately NOT changed:** `attributeByEntity`, `leakInstanceAttribution` and `governedSignalStaging`
keep stalled-only semantics. Widening attribution would change staged candidate amounts, which is candidate
territory and out of scope. Detector #2 delivers **detection and valuation only**.

---

## 9. What NH may now claim — and may not

**May claim.** For an admitted pilot extract, NH can identify and value, to the exact integer minor unit,
overdue **unpaid** and overdue **partially-paid** monetary obligations **both inside and outside** the
activation-stall cohort, over two provably disjoint populations whose sum equals an independent
classification of the whole accepted population; each figure labelled OBSERVED, each exclusion surfaced
rather than silent, each reading carrying its own scheme, method version and witness hash; and it can do so
without altering one byte of any historical finding.

**May NOT claim.** That any of it is recovered, recoverable, returned or proven revenue. That the amount
will be collected. Any cause for the non-payment. That a churned customer's outstanding obligation is
void — §6. Any coverage figure beyond the single synthetic fixture of §7. And nothing here creates a
Recovery Case, stages a candidate, or touches the two-ledger separation: **Revenue Returned is unchanged
and Auditable Revenue is unchanged.**

---

## 10. Falsifiers

Each was applied to the real code, shown to fail the test that must catch it, and reverted
**byte-identically** (`sha256` compared).

| # | Falsifier | Must fail |
|---|---|---|
| F1 | restore the stalled-only population | the ground-truth money regression |
| F2 | let a stalled cycle into the new population | disjointness / additivity |
| F3 | count `NotYetDue` as exposure | false-positive control |
| F4 | use the full amount for `PartiallyPaid` | the exact-money test |
| F5 | include dated `Refunded` / `Cancelled` as exposure | control test |
| F6 | add a field to `ObservedSummary` | behaviour-fingerprint preservation (`nhcm_12b105f78dcae1c1`) |
| F7 | add an exposure scalar to `canonicalFinding` | the `canonicalFinding` / `hashFinding` preservation test — **the guard for §2** |
