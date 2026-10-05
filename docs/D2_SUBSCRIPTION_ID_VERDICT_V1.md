# D2 proper · `subscription_id` verdict, generator design and scoreboard (v1)

**Status: PROPOSAL, 2026-10-05. Read-only evidence audit. Nothing implemented.** No contract change, no
new field, no schema change, no detector, no reconciliation core, no identity movement. Contract remains
**2.0.0**.

---

## 1 · `subscription_id` — the four questions, answered separately

### A · What it is DECLARED to mean

```ts
// src/contract/pilotDataContract.ts
{ name: "subscription_id",
  requirement: "recommended",
  kind: "identifier",
  description: "Stable cycle-level join key. Without it the cycle key is derived, and two real
                cycles can collide.",
  typicalSourceSystem: "billing",
  since: "1.0.0" }
```

**Declared grain: cycle-level.** Not subscription-level. The description says so in its first four words,
and its source system is **billing**, not CRM or contract.

### B · What it is actually POPULATED as

Measured over the frozen corpus (`e2e/fixtures/synthetic-validation-2026-09-27/dataset.csv`):

| Measure | Value |
|---|---|
| data rows | 271 |
| distinct `entity_id` | 130 |
| **distinct `subscription_id`** | **270** |
| entities appearing more than once | **97** |
| `subscription_id` values appearing more than once | **exactly 1** |

So the corpus **does** contain multi-obligation accounts — 97 of 130 — and every one of them carries a
**different `subscription_id` per invoice**. The generator builds it per scenario
(`subscription_id: \`synthetic-sub-${id}\``), and for multi-obligation entities the scenario id embeds the
invoice date, e.g. `synthetic-h-001` carries three ids:

```
synthetic-sub-synthetic-h-001-2026-01-26
synthetic-sub-synthetic-h-001-2026-03-06
synthetic-sub-synthetic-h-001-2026-04-29
```

**A date-bearing "subscription" id is an invoice id.** And the single repeated value is not a subscription
with two invoices — the generator labels it:

> `planted_event: "Two rows share one subscription_id — a double-paste in the export."`
> `leakage_class: "not_a_leakage_duplicate_cycle"`

**The generator treats two rows sharing a `subscription_id` as an export ERROR**, not as a legitimate
subscription billed twice.

### C · What production code USES it as

`src/assessment/cycleKeyRule.ts` is explicit, in its own header:

> *"A POPULATED `subscription_id` is the cycle key under BOTH rules, identically. So two invoices of one
> subscription still derive the SAME key and `dedupeCollisions` still excludes BOTH of them. That is
> defect D2."*

And the consequence is pinned as a test, with the money stated:

```ts
// src/contract/dataInterpretationRevision.test.ts — stage-A conformance · F · dedupe
// "Two genuinely different obligations of one subscription. Both are discarded and the money
//  reads zero."
"acct-1,2026-01-05,2026-02-05,500.00,USD,SUB-1"
"acct-1,2026-01-05,2026-03-05,300.00,USD,SUB-1"
expect(result.acceptedCycleCount).toBe(0);
```

**Two real obligations, different due dates, $800 total — accepted count 0, money zero.** Production uses
`subscription_id` as **the obligation's identity**, and a collision destroys both obligations.

### D · What it would need to mean for Missing Invoice reconciliation

**The exact opposite.** Reconciliation at *entitlement × period* needs a **group** identity that is
**stable across periods** — one identity spanning many obligations, so that expected and billed amounts can
be summed within a period and compared.

`subscription_id` is per-obligation. Using it as the group key is not a refinement of its meaning; it is an
inversion of it.

### 1.1 · Verdict

> **`subscription_id` is, in NH, an INVOICE / BILLING-CYCLE IDENTITY.**
>
> Declared, populated and used all agree on that — the three are **consistent**, not contradictory.
> **What contradicts them is the field's own NAME**, which says *subscription*: an account-level recurring
> agreement that by definition spans many invoices.

So the honest classification against the options:

| Option | Verdict |
|---|---|
| subscription identity | **NO** — nothing in the contract, the data, or the code treats it as spanning periods |
| **invoice / billing-cycle identity** | **YES** — this is what it is |
| obligation identity | **YES, equivalently** — in 2.0.0 one row is one obligation, so cycle ≡ obligation |
| account-level grouping | **NO** — that is `entity_id` |
| semantically unresolved | **NO internally.** **YES externally** — see §1.2 |
| CONTRADICTORY | **Not between declaration, data and code.** The contradiction is name-vs-semantics |

### 1.2 · The dangerous half: it IS unresolved for the customer

Verified in the customer-facing contract (`docs/CUSTOMER_PILOT_DATA_CONTRACT_V1.md`): `subscription_id`
appears **only as a table row giving a requirement tier, a type and a source system**. There is **no
description of what to put in it**, and **the row grain is stated nowhere in the document**.

So a billing engineer reading *"`subscription_id` | recommended | identifier | billing"* will populate it
with **their subscription id** — stable across invoices, exactly as the name says. The consequence, from
§C, is not a warning or a lower score:

> **Every multi-invoice account is silently excluded and its money reads zero.**

On the frozen corpus's shape that would be **97 of 130 accounts**. The failure is silent in the sense that
matters: the rows are reported as `duplicate_cycle_id` exclusions, which looks like a data-quality
complaint about the customer's export rather than a **name/semantics trap in our own contract**. And the
direction is beneficiary-adverse (the number shrinks), so no trust rule catches it — it is simply wrong.

**This is a live defect in the customer-facing contract, independent of Missing Invoice**, and it is the
most actionable finding in this audit. It needs no new field and no version bump: it needs the field
**described** and the **row grain stated**. Recorded as a governed issue (§7).

### 1.3 · Lifecycle test matrix

Current behaviour, `subscription_id` populated:

| Case | Behaviour today | Correct? |
|---|---|---|
| one subscription → many periods | **ALL rows collide ⇒ all excluded, money zero** | **NO** — if the name is believed |
| one subscription → many invoices in one period | same — all excluded | **NO** |
| split invoice (one obligation, two invoices) | two rows, same derived identity ⇒ both excluded | **NO** |
| consolidated invoice (two obligations, one invoice) | one row ⇒ **structurally invisible** (S1 §4.1 — no contract field can promote grain) | **NO, and unfixable by a field** |
| renewal | a new row with a new id ⇒ accepted | Yes, under the invoice reading |
| amendment | a new row ⇒ accepted; the superseded one is not knowable | Partial |
| pause | unrepresentable — no pause field exists | **NO** |
| re-key | a new id ⇒ a new, unlinked obligation | Yes under the invoice reading; **fatal** for correlation |
| migration | every id changes ⇒ every obligation unlinked | Same |
| multiple entitlements under one subscription | **unrepresentable** — no entitlement concept exists anywhere in NH | **NO** |

### 1.4 · Semantic-change consequence: MAJOR, and worse than ordinary MAJOR

Redefining `subscription_id` from cycle-grain to group-grain:

* It is *"Change the MEANING of an existing field, even with an identical name and type"* ⇒ **MAJOR** by the
  policy's own list.
* It **changes the accepted population and therefore the measured amount**. In the pinned test, $800 goes
  from excluded to accepted. On the frozen corpus, the planted pair ($7,000 × 2) would move from excluded
  to accepted, changing the accepted count from 256 to 258 and adding **$14,000**.
* **It does not rewrite history** — stored findings are frozen and append-only, and the re-assessment rules
  refuse terms changes other than the method. But the same bytes read under a 3.x meaning would yield a
  different accepted population, which is exactly what `MAJOR_ROW_SEMANTICS` exists to make visible.
* **Therefore a major 3 that redefines this field could NOT declare major 2 row-semantics-identical.** The
  §10 two-major window would **close** for that pair — the first time that would have happened. That is a
  real cost, and it is a reason to prefer a new field on a new extract over a redefinition.

### 1.5 · Recommended authoritative grain, and why `subscription_id` is not it

> **Do not reuse or redefine `subscription_id`.** The group identity belongs on the **expectation extract**
> as a **new source-native entitlement reference**, from the contract system — not as a redefinition of a
> billing-side field.

That choice keeps D1/D2 money byte-identical, avoids the major redefinition, and keeps the two-major window
open. The recommended grain is unchanged from D2: **entitlement × governed billing period**, with
schedule-line × period preferred.

---

## 2 · Why no existing 2.0.0 field can supply the needed facts

| Required fact | Existing candidate | Why it cannot supply it |
|---|---|---|
| **group identity stable across periods** | `subscription_id` | It is cycle-grained (§1); redefining is MAJOR and closes the two-major window (§1.4) |
| | `cycle_id` | Declared the *"alternative **cycle-level** join key"* — same grain. And D1 makes it unreachable when `subscription_id` is present-but-blank |
| | `entity_id` | **Account** grain — too coarse. One account holds many entitlements, so an entitlement-level allocation error nets to zero (D2.1 case 3) |
| | `plan` / `segment` / `product` | `kind: "dimension"`, free text, **no declared semantics and no stability guarantee**. The same wall as `status` |
| **period start / period end** | — | **No field carries a period range.** `next_invoice_due_at` is a single date — a due instant, not an interval. A period cannot be inferred from a due date without assuming a cadence, which is the forbidden inference |
| **expected amount, independent of billing** | `next_invoice_amount` | Declared *"Gross obligated amount of **that invoice**"*, `typicalSourceSystem: "billing"` — billing's record of an invoice billing created. Using it fails the independence standard |
| **dated termination** | `cancelled_at`, `refunded_at`, `status_effective_at` | They exist but hang off a **billing row**. For a period with no invoice there is no row, so they are unreachable exactly when needed |
| **dated pause interval** | — | **Nothing.** A pause is indistinguishable from an omission (D2.1 event 8) |
| **amendment + supersession** | — | **Nothing.** No effective-date or superseded-by concept |
| **schedule-line reference** | — | **Nothing.** No schedule, cadence or term concept exists anywhere in NH — verified by search |

**Every one of these is a fact about the obligation BEFORE billing acted.** The 2.0.0 contract is, by
construction, a record of what billing did. That is why the gap cannot be closed by reinterpreting existing
columns, however they are renamed.

---

## 3 · Two-sided generator — design only

### 3.1 · The structural requirement

> **Side E and Side O are emitted independently from one declarative scenario table, so that absence on O
> cannot erase the expectation on E.**

This is the property the whole architecture rests on, so it is enforced structurally rather than by care:

* One scenario list. Each entry declares an `e` block and an `o` block **separately**.
* `o: null` means **no observation row is emitted at all** — that is how a missing invoice is produced. It
  is not a row with blanks, and not a zero.
* Two emitter passes: emit **all** of E, then emit **all** of O. Neither pass can read the other's output.
* Two files, two provenances, two `extractedAt`, two coverage windows, two fingerprints — **admitted
  separately**, each with its own `pds` and its own `PAD`.
* A structural test asserts the generator module imports nothing from the reconciliation core, mirroring
  `leakInstanceIdentity.ts`'s "imports nothing at all, asserted structurally" discipline.

### 3.2 · Side E — expectation rows

One row per (entitlement, period): entitlement reference · period start · period end · expected amount **or
explicit unknown** · currency · termination effective date · pause start / pause end · amendment effective
date · superseded-by reference · optional schedule-line reference.

### 3.3 · Side O — observation rows

The existing billing shape, **plus** the allocation facts without which nothing can be reconciled: the
entitlement (or schedule-line) the line settles, and the period it covers. An invoice **total alone is
insufficient** — D2.1 event 3 refuses rather than apportions.

### 3.4 · The twin-variant rule

Every representation-dependent scenario is emitted **twice** — once with the enabling evidence present and
once with it absent:

pause · cancellation · amendment supersession · entitlement pairing · payer hierarchy · adjacent-period
pairing · re-key mapping · migration announcement.

**Reason, and it is not symmetry for its own sake:** the `$0` false-positive target holds *only* under
those representation requirements. A benchmark containing only the enabled variants would prove the design
works where it is easy — the selection-bias failure already recorded in `S1_OBLIGATION_IDENTITY_AUDIT_V1.md`
§5. The disabled variants are the proof that the requirements are **necessary**.

### 3.5 · Scenario coverage

All twenty D2.1 cases: true missing money · partial under-billing · exact balance · over-billing ·
missing + **unrelated** surplus · duplicate masking missing · wrong entitlement · wrong customer · timing
shift · split billing · consolidation · proration · pause · cancellation · amendment · renewal · re-key ·
migration · currency mismatch · unknown expected amount. Plus an odd-cent case on the true-missing
scenario, and the adjacent-period pair inside and outside the governed grace window.

---

## 4 · Independent ground-truth model

### 4.1 · Authored, never derived

> **Ground truth is hand-authored in the scenario entry and is never computed from detector output, from
> the emitters, or from the reconciliation core.**

Per scenario:

```
expectedMoneyMinor          integer
observedMoneyMinor          integer
positiveExposureMinor       integer   ← truth, not a detector reading
negativeDiscrepancyMinor    integer
eventTruth                  MATCHED | MISSING | DUPLICATE | UNMATCHED_OBSERVATION | NOT_EXPECTED
correlationTruth            CORRECT | MISALLOCATED_ENTITLEMENT | MISALLOCATED_CUSTOMER | UNAVAILABLE
unknownExpectedAmount       boolean
incrementalUnionMinor       integer
representationEnabled       boolean   ← the twin-variant switch
whyThisIsTheTruth           prose — the business reading, in one sentence
```

### 4.2 · Self-consistency, so authoring mistakes are caught without the detector

A test over the **ground truth alone**, importing no reconciliation code:

```
for every scenario:
    positiveExposureMinor − negativeDiscrepancyMinor === expectedMoneyMinor − observedMoneyMinor
    unknownExpectedAmount  ⇒  expectedMoneyMinor is not asserted and is excluded from sums
    eventTruth = NOT_EXPECTED  ⇒  positiveExposureMinor === 0
    correlationTruth ≠ CORRECT ⇒ incrementalUnionMinor === 0    (misallocation is not missing money)
```

That last line is the one worth stating explicitly: **when money is billed to the wrong entitlement or the
wrong payer, the company was still paid.** It is an attribution failure, not exposure, and it contributes
**zero** incremental union money.

---

## 5 · Money-first scoreboard

### 5.1 · Monetary (capability A)

| Figure | Definition |
|---|---|
| `KNOWN_GROUND_TRUTH_POSITIVE_MONEY` | Σ `positiveExposureMinor` over all scenarios |
| `DETECTED_POSITIVE_MONEY` | Σ positive residuals the detector reports |
| `TRUE_POSITIVE_MONEY` | Σ detected ∩ truth, per scenario, to the minor unit |
| `FALSE_POSITIVE_MONEY` | Σ detected where truth is zero — **target $0 under enabled representation** |
| `FALSE_NEGATIVE_MONEY` | Σ truth not detected |
| `MONETARY_RECALL` | `TRUE_POSITIVE / KNOWN_GROUND_TRUTH_POSITIVE` |
| `MONETARY_PRECISION` | `TRUE_POSITIVE / DETECTED_POSITIVE` |
| `UNKNOWN_MONEY` | **count** of unpriced expectations — never a money sum, never zero |
| `GROSS_NEGATIVE_DISCREPANCY` | Σ \|negative residuals\| |
| `DOUBLE_COUNTED_UNION_MONEY` | Σ money counted by more than one capability — **target $0** |
| `A_BLIND_BY_CONSTRUCTION` | Σ truth that monetary reconciliation **cannot** see at any grain — the duplicate-masking and missing+overcharge classes |

### 5.2 · Event (B) and correlation (C)

`EVENT_RECALL` · `EVENT_PRECISION` over `eventTruth` where it is meaningful ·
`CORRELATION_FAILURES_DETECTED` / `_MISSED` over `correlationTruth` · `CAPABILITY_GATED_SCENARIOS` with the
named prerequisite that was unavailable.

### 5.3 · Four hard rules

1. **UNKNOWN is never blended into zero.** It is a count beside the money, and a residual computed with
   exclusions is labelled a **lower bound**.
2. **Negative discrepancy never cancels positive leakage.** Separate columns; `MONETARY_RECALL` is computed
   over positives only.
3. **Attributed or explained dollars are never incremental union money.** A dollar another capability
   already counts contributes zero.
4. **`A_BLIND_BY_CONSTRUCTION` is reported, not excluded from the denominator.** Those scenarios are
   genuine false negatives for A, so A's recall is correctly **below 100%** — and the named line explains
   *why* rather than leaving a mysterious shortfall. Reporting A's recall over a denominator that excluded
   them would overstate A, which is the same error as the clamped residual.

---

## 6 · Smallest safe implementation sequence

| Step | Work | Needs a decision? |
|---|---|---|
| **1** | **Governed issue: describe `subscription_id` and state the row grain in the customer contract.** No new field, no bump — it is prose that prevents silent exclusion of every multi-invoice account (§1.2). **The highest-value item in this audit** | Owner, but cheap and independent of everything else |
| **2** | Record this verdict: `subscription_id` is a cycle identity, is **not** to be redefined, and the group identity goes on the expectation extract | Owner |
| **3** | Declare the expectation extract's **semantics only** — no fields, per the S1 rule that a declaration ships with its consumer | Owner |
| **4** | Governed invoicing grace window as an analysis term, two-identity governed | Owner |
| **5** | **Two-sided generator + hand-authored ground truth + the self-consistency test.** No detector exists yet; nothing reads a new contract field | Owner |
| **6** | The scoreboard, computed over the generator and a **stub** reconciliation that reports nothing — proving the scoreboard reports `recall 0`, `precision n/a`, `FP $0` on a detector that does nothing. **A scoreboard that cannot score a do-nothing detector honestly is not a scoreboard** | Owner |
| **7** | Pure reconciliation core: signed residual, mechanism pairing, declared coverage, five refusals, own scheme/version/witness | Owner |
| **8** | Unmatched-identity rate check; contract-system namespace verification | Owner |
| **9** | Ordered-pair binding as a new artefact family; then persistence; then operator surface | Owner |

Step **6 before 7** is the one addition to the earlier sequence, and it is the same falsifier logic the S1b
proofs used: **verify the measuring instrument against a known-null input before trusting it on a real
one.**

---

## 7 · Governed issue raised by this audit

**`subscription_id` is undescribed in the customer-facing contract, and the row grain is stated nowhere.**
A customer who populates the field as its **name** implies — a stable subscription id — has every
multi-invoice account excluded as `duplicate_cycle_id` and its money read as **zero**. On the frozen
corpus's shape that is 97 of 130 accounts. The remedy needs **no new field and no version bump**: describe
the field, state that one row is one obligation, and say explicitly that a value shared by two rows is
treated as a duplicate rather than as a subscription with two invoices.

Severity: **high and current** — it affects D1/D2 money today, not a future detector. Direction:
beneficiary-adverse, so no trust rule catches it.

## 8 · What this package does not decide

Whether the expectation extract is ever built · whether any field is ever declared · D1's release
treatment · any contract version movement. **Contract is 2.0.0 and is not bumped. Nothing is
implemented.**
