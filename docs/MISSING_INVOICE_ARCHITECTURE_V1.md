# Missing billing event / missing invoice — expectation-first architecture proposal (v1)

**Status: PROPOSAL, 2026-10-05. Read-only analysis. Nothing implemented.** Contract remains **2.0.0**.
No detector, no schema, no persistence, no contract change. `revenueEvent` stays unwired. The Failed
Payment / Dunning proposal ([`DETECTOR_3_FAILED_PAYMENT_V1.md`](DETECTOR_3_FAILED_PAYMENT_V1.md)) is
**preserved unchanged as an approved design candidate**, not withdrawn and not weakened; it is simply not
the current priority, because by its own proof it adds $0.00 incremental union money.

**The decision question:** can NH detect money that **should** have entered the billing system but never
did, without inventing the expectation?

**The answer, stated up front:** **Yes — but only with a second, independently-sourced expectation
extract.** It is impossible from the current single billing extract, and the impossibility is
*structural*, not a matter of effort. §2.6 proves it mechanically. What would make it possible is set out
in §3 and §8.

---

## 1 · The epistemic standard

### 1.1 · The governing rule

Everything in this document follows from one requirement, and it is sharper than "we need an
expectation":

> **The expectation must originate in a system OTHER than the system that was supposed to act.**

If the billing system both holds the schedule and creates the invoice, then a billing failure can erase
*both* — the invoice and the record that it was due. Asking billing what billing should have done cannot
detect billing's own omission. This is the same shape as the Trust Invariant's first rule (evidence from
a source the beneficiary cannot unilaterally alter), applied one level down: **the acting system may not
be the sole author of the expectation it failed to meet.**

Three further conditions, each of which has already bitten this repository in another form:

1. **Pre-dating.** The expectation must have been established *before* the period it governs. An
   expectation discovered after the fact is the `activatedAt > firstSeenAt` problem again — authority
   granted retroactively.
2. **Termination-aware.** The expectation must carry, or be joinable to, the facts that would
   legitimately end it. An expectation that cannot be cancelled is not an expectation; it is an
   assumption.
3. **Amount provenance separate from existence.** *That* an invoice was due and *how much* it was for are
   two claims with two evidence requirements. One may hold without the other (§4).

### 1.2 · Source classification

| | Source | Class | Why |
|---|---|---|---|
| **A** | Explicit contractual billing schedule | **AUTHORITATIVE** | States the obligation directly, pre-dates the period, and lives in the contract system — independent of the actor. The strongest available source for both existence and date. |
| **B** | Subscription / plan cadence | **AUTHORITATIVE *if* contractual; SUPPORTING if billing-configured** | A cadence in the contract/entitlement system is an obligation. The *same cadence read out of billing's own configuration* fails §1.1 — billing asserting its own duty. The split matters and must be recorded per source, not assumed. |
| **C** | Governed price / contract amount | **AUTHORITATIVE for the AMOUNT only** | Establishes how much, never *that* an invoice was due, and never *when*. |
| **D** | Previous invoice sequence | **INSUFFICIENT for existence; SUPPORTING for cadence only** | See §1.3. This is the one that must be refused. |
| **E** | Renewal schedule | **AUTHORITATIVE if contractual and dated; SUPPORTING if a CRM forecast** | A signed renewal is an obligation. A pipeline "expected renewal" is a forecast, and a forecast summed into a money figure is the one thing the constitution forbids outright. |
| **F** | Customer-provided billing calendar | **SUPPORTING at best; INSUFFICIENT if operator-authored** | A calendar typed or maintained by the operator is the `datasetId` defect again — the beneficiary authoring the input that determines the number. It qualifies only as a governed extract from a system of record, with provenance. |
| **G** | CRM / order / entitlement event that contractually triggers billing | **AUTHORITATIVE for EXISTENCE** | This is the real one, and the one the strategy cares about: the order was booked, the entitlement was granted, and billing never acted. Needs a date to be timed and an amount (C) to be monetary. |
| **H** | Sources already in NH | — | `signed_at` → **AUTHORITATIVE for "an obligation was created"**, and for nothing else: no date, no amount, no cadence, no term. `DatasetProvenance.coverageStart/End` → **INSUFFICIENT**, operator-declared. `plan` → **INSUFFICIENT**, a free-text dimension with no declared semantics. |

### 1.3 · Historical pattern is explicitly NOT authoritative

> "The customer was billed every month for six months" does **not** establish "the customer must be
> billed next month."

Six legitimate reasons the seventh invoice may be correctly absent: cancellation, contract expiry, a
pause, an amendment reducing scope to zero, a free or credit period, and a term that simply ended. A
detector that treats the pattern as the obligation **manufactures money** in every one of those cases —
and the cases are not rare, they are the normal lifecycle.

Pattern may be used for exactly one thing: **as corroboration that a declared cadence is the real
cadence.** It may never be the cadence's source. This mirrors the semantic-equivalence correction already
in the constitution: *a finite behaviour fingerprint is necessary evidence and never a proof*. A six-month
billing history is a finite fingerprint of a cadence, not the cadence.

---

## 2 · Current data capability — what 2.0.0 can and cannot establish

Every answer below was read from `src/contract/pilotDataContract.ts` (all **21** fields of
`PILOT_DATA_CONTRACT_FIELDS`) and the production path. Worth stating because it is directly relevant: an
`obligation_ref` field **was** staged once, as part of the 2.1.0 work that was reverted as unauthorised,
and it is **absent today** — verified. So §8.8's blocker is live, not historical.

### 2.1 · Can current admitted data establish an expected billing event independently of the observed invoice? **NO.**

The two fields that look like an expectation are declared as **observations of an invoice that exists**:

```ts
// src/contract/pilotDataContract.ts
{ name: "next_invoice_due_at",  requirement: "required", kind: "date",
  description: "Due date of the invoice under observation. Must not precede signed_at.",
  typicalSourceSystem: "billing" }

{ name: "next_invoice_amount",  requirement: "required", kind: "money_decimal",
  description: "Gross obligated amount of that invoice, in major units, positive.",
  typicalSourceSystem: "billing" }
```

*"the invoice under observation"*, *"that invoice"*, `typicalSourceSystem: "billing"`. These are billing's
record of an invoice **that billing created**. Reading them as an independent expectation would be exactly
the stretch this mission forbids — and it would fail §1.1, since the expectation would come from the
system that was supposed to act.

### 2.2 · Field-by-field answers

| Fact | Available in 2.0.0? | Evidence |
|---|---|---|
| Expected **date** of a billing event | **NO** | Only `next_invoice_due_at`, which is the observed invoice's own due date. |
| Expected **amount** | **NO** | Only `next_invoice_amount`, the observed invoice's own amount. No list price, plan price or contract value. |
| **Currency** | **YES**, with a caveat | `currency` is required and the dataset is single-currency by governance ("amounts are never converted or summed across currencies"), so a missing invoice's currency *would* be known — from the governed policy, not from the missing row. This is the one fact that survives. |
| **Obligation identity** | **NO** | `OBLIGATION_IDENTITY_FIELDS` is `Object.freeze([])` — "the data contract declares no obligation-level identifier". `subscription_id` is `recommended` and is a *cycle*-level join key, not an obligation reference. |
| **Cancellation / termination** | **PARTIAL** | `cancelled_at` / `refunded_at` (dated; undated is rejected `undated_terminal_state`) and `status` + `status_effective_at`. But `status` is `kind: "enum"` **with no declared members** and is nulled by `projectExecutionInput`, so it is inert in the worker. And all of this hangs off a row — for a subscription with **no** row, nothing is knowable. |
| **Billing cadence** | **NO** | No frequency, interval, period, term or schedule field exists. |
| **Effective contract period** | **NO** | `signed_at` is a start with no end: no term, no expiry, no renewal date. |

### 2.3 · What the contract *does* already have, and it is not nothing

`signed_at` is declared *"the commitment that creates the obligation"* with
`typicalSourceSystem: "crm"` — and `entity_id` likewise `"crm"`. So **the contract already spans the seam
NH cares about**: the expectation side (CRM: who, and when they committed) and the observation side
(billing: the invoice, its amount, its settlement) sit in the same row.

That is also why the seam is currently invisible: the customer **pre-joins** the two systems before NH
sees a row, and a join that dropped a record leaves no trace. `DatasetProvenance` acknowledges three
source systems (`contract`, `billing`, `product`) — as **dataset-level free text**, and only `billing` is
cross-checked against a governed namespace (`declaredBillingSource` in `sourceNamespace.ts`);
`sourceSystems.contract` and `.product` are validated for **non-blankness only**
(`validateDataset.ts:629-631`).

### 2.4 · The namespace layer is ready; the contract layer is not

A correction worth recording, because the earlier audit's framing has since changed:

```ts
// src/contract/leakInstanceIdentity.ts
export const SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true;
```

Source-namespace resolution is **closed**: a governed registry, a per-boundary permitted set and a
per-dataset binding exist, and `sourceResolutionHash(boundaryId, datasetFingerprint, lineage)` shows the
granularity — **one resolved namespace per dataset**. That is exactly the shape a two-extract design
needs, and it already works.

What remains open is the **contract** gap: no obligation-level identifier, so
`OBLIGATION_IDENTITY_FIELDS` is empty and the candidate firewall refuses — for one reason now instead of
two.

### 2.5 · There is no multi-extract intake

```ts
// src/contract/assessmentExecution.ts
readonly datasetFingerprint: string;   // ExecutionBinding — SINGULAR
```

An execution binds **exactly one** dataset. There is no pair, no set, no ordered tuple. A design needing
two extracts needs this changed, and that change touches `canonicalBinding` → `PAX-` (§8.6).

### 2.6 · The structural proof: a missing invoice is **unrepresentable** in 2.0.0

This is the finding that settles the architecture question, and it needs no new concept — only the
requirement tiers already in the contract.

`next_invoice_due_at` and `next_invoice_amount` are **`required`**. So consider a subscription for which
billing never created an invoice. The customer's export can contain, for that subscription, exactly one of:

1. **No row at all.** The missing invoice is invisible: there is nothing to assess, nothing to exclude,
   and nothing in any count. NH cannot distinguish "this subscription had no invoice due" from "this
   subscription is not in the file".
2. **A row with those fields blank.** The adapter returns `exclude(id, "missing_required_field", f)`
   before reading anything else. The row is rejected, lands in the intake's rejection report, and enters
   no detector — and under the decision already recorded, rejected rows are **quarantined, never counted**
   ([`GOVERNED_ISSUES_V1.md`](GOVERNED_ISSUES_V1.md) §3).
3. **A row with those fields invented.** Then it is not a missing invoice, and the number is fiction.

> **Therefore: in contract 2.0.0 a missing invoice either does not appear, or appears only as a rejected
> row. Under no circumstances can it be detected or valued. The gap is in the contract's shape, not in the
> detector.**

This is the architectural issue previously labelled **B2** — *the missing thing has no row* — proven from
the requirement tiers rather than asserted.

---

## 3 · Cross-system design

### 3.1 · DESIGN A — single extract, expectation fields repeated onto observed rows

Add e.g. `expected_invoice_due_at`, `expected_invoice_amount`, `billing_cadence` to the existing row.

**It cannot answer the question.** A truly absent invoice has **no row**, so there is no row on which to
repeat the expectation (§2.6). Design A can detect only cases where *some* row exists for the period — i.e.
a **wrong** invoice (wrong amount, wrong date), which is undercharge/incorrect, not absence. It converts
"missing invoice" into a different and already-reachable question.

It also fails §1.1 twice over: the expectation would travel inside the **billing** extract, so the system
that failed to act asserts what it should have done; and because the expectation and the observation are
the same row, a billing omission deletes both halves simultaneously.

| Criterion | Design A |
|---|---|
| Detect a truly absent row | **NO — structurally impossible** |
| Provenance | Expectation inherits the billing extract's provenance. Wrong system. |
| Source-system ownership | Collapsed into one. The seam disappears. |
| Row grain | Unchanged (one obligation per row) — which is the problem: no obligation, no row. |
| Obligation identity | Still absent. |
| Temporal semantics | Expectation and observation share one timestamp set; cannot distinguish "not yet invoiced" from "never invoiced". |
| Corrections / amendments | No separate record to amend. An amendment overwrites the expectation in place. |
| Cancellations | Only as today, and only where a row exists. |
| Duplicate risk | Low — but only because there is nothing to join. |
| Cross-department handoff | **Undetectable.** The handoff is exactly what is collapsed. |
| Customer burden | **Lowest** — three columns on an existing export. |
| Auditability | Weak: no independent record that an expectation existed. |
| False-positive risk | High in the one case it can report, because the expectation is unverifiable. |

**REJECTED** — and not because it is easier. It is rejected because it cannot detect absence, which is
the entire point.

### 3.2 · DESIGN B — separate expectation / entitlement extract, joined against billing observations

Two extracts: an **expectation extract** from the contract/entitlement/order system, and the existing
**billing extract**. A missing invoice is an expectation row with no matching billing row.

This is the only family of designs that can detect absence, because **the expectation row exists even when
the invoice does not.** Absence becomes a *present* fact about a *present* record.

| Criterion | Design B |
|---|---|
| Detect a truly absent row | **YES** — the expectation row is the evidence |
| Provenance | Two provenances, two `extractedAt`, two coverage windows. Richer and verifiable. |
| Source-system ownership | **Separate, as it must be.** Contract system owns expectations; billing owns invoices. Satisfies §1.1. |
| Row grain | Expectation extract is one row per **(obligation, period)**; billing stays one row per obligation. |
| Obligation identity | **Required and currently absent** — the join key. This is the blocker. |
| Temporal semantics | Each side carries its own coverage window; "not yet invoiced" vs "never invoiced" is decidable from the expectation's period against `asOf`. |
| Corrections / amendments | Representable: an amendment is a new expectation row with its own effective date. |
| Cancellations | Representable on the **expectation** side, which is where termination belongs. |
| Duplicate risk | **Real** — two expectation rows for one period, or one invoice matching two expectations. Needs the duplicate-cycle discipline applied to the pair. |
| Cross-department handoff | **This is the detector.** Contract → billing is precisely the seam. |
| Customer burden | **High** — a second export from a different system, with a shared key. The real cost. |
| Auditability | **Strong** — two independently-sourced records, each hashed, each with its own namespace. |
| False-positive risk | Moderate and **controllable** (§5), because the termination facts live on the expectation side. |

### 3.3 · DESIGN C — Design B with the iteration direction and the pair identity governed

Design C is **not a third architecture**; it is Design B with two specific properties made part of the
governed binding rather than left to the implementation. Presented separately because both are the
difference between a correct detector and a plausible-looking one, and neither is implied by "join two
extracts".

**C.1 · The expectation extract drives the iteration.** A naive implementation joins
billing → expectation and asks "does this invoice match an expectation?" — which finds *unexpected*
invoices and **never** finds unmatched expectations, because it only ever visits rows that exist. In
Design C the expectation side is the denominator and the loop runs over it, so **an unmatched expectation
is a positive iteration result rather than a negative lookup.** Absence is then detected by construction,
which is testable; "we would have noticed" is not.

This is the same lesson as `splitCohorts`: the population is partitioned by iterating the whole set, not
by looking things up.

**C.2 · The binding names an ordered pair.** The execution binds `(expectationDatasetFingerprint,
billingDatasetFingerprint)` as an **ordered** pair, with its own resolved namespace each, so the frozen
proof records which extract was the expectation and which was the observation. Swapping them is then a
different execution identity rather than a silent reinterpretation — and the recorded claim can never be
ambiguous about which system was supposed to act.

**RECOMMENDED: Design C.** It is the only design that detects absence (B's property) *and* makes the two
ways of getting it subtly wrong structurally impossible.

---

## 4 · Money model — three classes, never blended

| Class | Condition | Monetary treatment |
|---|---|---|
| **MISSING_EVENT_KNOWN_AMOUNT** | Existence authoritative (A/B-contractual/E-contractual/G) **and** amount authoritative (C, or an amount carried on the expectation row from the contract system) | Exposure = **the expected amount, exact integer minor units**, copied verbatim. |
| **MISSING_EVENT_UNKNOWN_AMOUNT** | Existence authoritative, amount **not** | **Detected and counted. Exposure = UNKNOWN.** Never zero, never estimated, never in any money total. It appears as a count plus an explicit "amount unavailable". |
| **MISSING_EVENT_UNKNOWN_EXISTENCE** | Existence not authoritative | **Not a finding at all.** Fail closed. Not reported as a missing invoice under any label. |

**Barred absolutely**, and these are the exact routes by which this detector would manufacture money:

* the previous invoice's amount,
* an average or median of prior invoices,
* a plan or list price not present as governed data,
* any statistical or model prediction,
* proration arithmetic over an assumed period.

Any of those would be an **ESTIMATE**. If an estimation product is ever wanted it is a separately governed
thing with its own ledger — `Revenue Opportunity`, never `Revenue Returned` — and it may not enter the
OBSERVED surface. "Unknown amount" is a **feature** of this detector: a CFO can act on *"eleven invoices
were never raised and we cannot price three of them"*; they cannot act on a number we made up.

---

## 5 · Adversarial false-positive controls

For each: the evidence that prevents NH from manufacturing a missing invoice. Every one of these must be
representable on the **expectation** side, which is the main functional requirement the expectation
extract must satisfy.

| Case | Evidence that prevents the false positive |
|---|---|
| **Legitimate cancellation** | A dated termination on the expectation row, effective **before** the period. Undated ⇒ fail closed (the existing `undated_terminal_state` discipline). |
| **Contract expiry** | The expectation's own `period_end` / term. An expectation whose period ends before the missing invoice's period does not expect it. |
| **Paused subscription** | A dated pause interval on the expectation. A period inside a pause expects nothing. Without a pause representation, **a pause is indistinguishable from an omission** — so if the extract cannot express pauses, this must fail closed rather than report. |
| **Amended billing schedule** | Amendment as a **new expectation row with its own effective date**, and the superseded row marked as such. The detector must read the expectation in force **for that period**, not the latest row. |
| **Free period** | An expectation row with a **zero** contractual amount, which is a *legitimate zero obligation* and not a missing invoice. Note this cuts against the current `zero_amount` rejection and needs its own rule on the expectation side. |
| **Credit period** | Same as free period, plus the credit's own record. A credited period expects no cash invoice. |
| **Already billed under another identifier** | The join key must be the **obligation reference**, not a derived composite. This is precisely why `cycleId`'s fallback hierarchy was ruled unusable for identity — a derived key makes a re-keyed invoice look absent. |
| **Duplicate entitlement** | Two expectation rows for one period ⇒ **refuse both**, exactly as the 2026-09-25 duplicate-cycle rule refuses all colliding rows rather than picking one. Otherwise one invoice satisfies one expectation and the other reads as missing. |
| **Timezone / date boundary** | Calendar-date normalisation through the existing governed primitives; the expectation's period is a closed calendar interval. An invoice dated on a boundary belongs to exactly one period by a stated rule. |
| **Late invoice rather than missing** | The invoice exists ⇒ matched ⇒ **not** missing. Lateness is a different finding with **zero** missing-invoice exposure. The match is on (obligation, period), never on the due date. |
| **Invoice generated after `asOf`** | The existing as-of discipline: an invoice dated after the cut-off is invisible, so the expectation would read as unmatched. **This is the single most dangerous false positive** — a short lag between period and invoicing would mark every recent period as missing. Mitigation: a **governed invoicing grace window** on the expectation side, so a period is only assessed once its grace has elapsed before `asOf`. The grace must be a *governed analysis term*, not an operator input, exactly like `stallThresholdDays`. |
| **Zero-value contractual period** | A zero expected amount is a legitimate expectation of no cash. Report as satisfied, never as missing. |
| **Currency mismatch** | The existing fail-closed rule: one currency per dataset, and a cross-currency pair is refused rather than converted. With two extracts, **both** must agree with the governed policy currency. |
| **Partial period / proration** | A prorated period's amount is **not** derivable by NH (§4 bars the arithmetic). So: existence may be authoritative while the amount is **UNKNOWN** — this is the primary real-world source of the unknown-amount class, not an edge case. |
| **Customer / account merge** | Obligation references must be stable across a merge, or the pre-merge expectations read as absent. Requires the expectation extract to carry the **surviving** reference, and a merge event is otherwise indistinguishable from mass omission. A stated limitation if unrepresentable. |
| **Entitlement transfer** | Same shape: the expectation must follow the obligation to its new holder. A transfer without a carried reference manufactures a missing invoice on one side and an unexpected one on the other. |

Two of these — **invoice-after-`asOf`** and **pause** — are strong enough to sink the detector on their
own if unrepresented. They are the gating functional requirements, not refinements.

---

## 6 · Synthetic ground-truth design (designed, not implemented)

Twelve planted cases, driven through whatever two-extract intake is eventually built:

| # | Case | Expected result |
|---|---|---|
| 1 | True missing invoice, authoritative amount | **Positive**, exposure = expected amount, exact minor units |
| 2 | True missing invoice, no authoritative amount | **Positive**, exposure **UNKNOWN** (counted, not valued) |
| 3 | Legitimate cancellation dated before the period | Negative, $0 |
| 4 | Expired contract (period after term end) | Negative, $0 |
| 5 | Paused billing covering the period | Negative, $0 |
| 6 | Schedule amendment superseding the period | Negative, $0 — and the **superseded** row must not fire either |
| 7 | Late but existing invoice | Negative for missing-invoice, $0 exposure |
| 8 | Duplicate invoice for one expectation | Negative, and surfaced as a duplicate |
| 9 | Wrong currency on either side | Refused, fail-closed, $0 |
| 10 | Prorated partial period | **Positive with UNKNOWN amount**, never a computed proration |
| 11 | Normal expected + observed pair | Negative, $0 |
| 12 | Multiple obligations per account, one missing | Exactly one positive; the others negative |

Plus the odd-cent case on #1, and an invoice dated after `asOf` inside the grace window (negative) and
outside it (positive) — the pair that proves the grace window works in both directions.

**Expected metrics:**

```
true-positive monetary exposure        = Σ expected amounts of cases 1 (+ odd-cent)
true-positive non-monetary events      = count of cases 2 and 10
false-positive money                   = $0.00      ← cases 3-9, 11, 12 contribute nothing
double-counted money                   = $0.00      ← see §7.2
monetary recall / precision             measured against the KNOWN-amount class only
```

The unknown-amount class is reported as a **count** with its own recall, never folded into a money
recall — a detector that found eleven missing invoices and could price eight has two scores, not one
blended one.

---

## 7 · Business value

### 7.1 · It asks a question D1/D2 cannot

Detectors #1 and #2 both begin from **an obligation that exists in the admitted data** and ask whether it
was settled. Their union is the whole accepted cycle population. Every question they can answer is of the
form *"this obligation is unpaid."*

Missing invoice asks:

> **What money should have entered the revenue chain but never created an obligation record at all?**

That population is **not in the billing extract**. It is therefore disjoint from the accepted cycle
population *by construction* — not by a disjointness proof over cohorts, but because the rows are in a
different file, sourced from a different system.

### 7.2 · The CAPABILITY is incremental; the AMOUNT is dataset-dependent

This is the decisive contrast and the reason the priority order is right:

| | Population | Incremental union money |
|---|---|---|
| Detector #3 (failed payment) | A **subset** of D1 ∪ D2 | **$0.00** — attribution only |
| **Missing invoice** | **Disjoint** from D1 ∪ D2 — not in the billing extract | **Dataset-dependent; may be $0.00** |

**The corrected claim, because an earlier draft of this section overstated it as "> $0.00 by
construction":**

> **Missing Invoice creates the capability to identify incremental exposure outside D1/D2. Actual
> incremental union money is dataset-dependent and may be $0.00.**

**Disjointness is structural; the amount is not.** The population claim is unchanged and does not depend on
any dataset: those rows are in a different file, from a different system, and are absent from the billing
extract. But exposure exceeds zero only when **all four** of these hold — an authoritative expectation
exists, the expected event is genuinely absent, an **authoritative expected amount** exists (§4), and every
exclusion/lifecycle control passes (§5). A dataset in which billing did its job correctly yields **$0.00**,
and that is a *correct* result, not a failure of the detector. Conflating "a population we can now reach"
with "money we will certainly find" is the same error as counting a forecast as proof, one level down.

Double counting is impossible in the matched direction: a matched expectation means the invoice exists, so
it is in the billing extract, so it is already D1/D2 territory and contributes **zero** missing-invoice
exposure. The two surfaces meet only where one of them is empty.

### 7.3 · It is the cross-department seam

```
contract / entitlement / CRM
          ↓            ← the handoff NH would detect
   billing expectation
          ↓
   invoice / billing system
```

The prior audit concluded that cross-department leakage is not a detector problem but an **intake** problem,
because the customer pre-joins the systems and NH cannot see what the join lost. Design C is the first
architecture that changes that: with two independently-sourced extracts, **NH performs the join itself**,
and a record present on one side and absent on the other is visible rather than silently dropped.

**Does the architecture genuinely answer the question?** Yes, conditionally — and the condition is the
honest part: only to the extent the expectation extract can represent **termination, pause, amendment and
a stable obligation reference**. Without those, the detector cannot distinguish an omission from a
legitimate end, and §5 shows it would manufacture money in the most common lifecycle events. **Those four
are functional requirements, not nice-to-haves.**

---

## 8 · GO / NO-GO report

| # | Item | Answer |
|---|---|---|
| **1** | Exact business mechanism | A contractual obligation to invoice was established in the contract/entitlement/order system; the billing system never created the invoice; no obligation record therefore exists, so no downstream process — collection, dunning, revenue recognition — ever sees it. The money never enters the revenue chain. |
| **2** | Authoritative expectation source required | A **contract-system** record of the obligation to invoice: class **A**, **B-contractual**, **E-contractual** or **G** (§1.2), carrying period and termination. Class **D** (historical pattern) is **refused** as a source of existence. |
| **3** | Minimum data required | An expectation extract, one row per **(obligation, period)**: a stable **obligation reference**; the **period** (start, end); an **expected invoice date**; an **expected amount** (optional — absence yields the unknown-amount class); **currency**; a **dated termination/expiry**; a **dated pause interval**; an **amendment effective date with supersession**. Plus provenance for the contract system, verified rather than declared. |
| **4** | Recommended architecture | **DESIGN C** — a separate, independently-sourced expectation extract, the expectation side driving the iteration, bound as an **ordered pair** with per-dataset namespaces. Design A is rejected as structurally incapable (§3.1), not as merely weaker. |
| **5** | Multi-extract intake required? | **YES, unavoidably.** `ExecutionBinding.datasetFingerprint` is singular today. A missing invoice has no row in the billing extract, so a second extract is the only place its evidence can live. |
| **6** | Identity implications | **Significant, and this is the largest cost.** An ordered dataset pair changes `canonicalBinding`, which feeds **both** `hashExecutionBinding` **and** `deriveExecutionId` → every `PAX-` identity. The submission identity `pds` is derived per dataset and would need a pair-level analogue. By the contract's own policy, "change the identity/idempotency derivation" is **MAJOR**. The Detector #2 lesson applies directly: this must be a **new, separately versioned artefact family** for reconciliation executions, leaving the single-dataset path byte-identical — historical `pds_1bc639b3`, `PAD-a04577ae` and `PAX-8ad0089a` untouched and still reproducible. |
| **7** | `sourceNamespace` implications | **Favourable — the machinery already exists.** `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true`, and resolution is already **per dataset** (`sourceResolutionHash(boundaryId, datasetFingerprint, lineage)`), so two extracts naturally resolve to two namespaces. Two gaps: `declarationChecked` cross-checks only `declaredBillingSource`, so an equivalent check is needed for the **contract** system (today `sourceSystems.contract` is validated for non-blankness only, `validateDataset.ts:629`); and the reserved class-grained names must not be reused as instance namespaces, which the existing validator already enforces. |
| **8** | Obligation-identity implications | **This is the gating blocker, and it is the same one.** `OBLIGATION_IDENTITY_FIELDS` is frozen empty, so NH has no obligation-level join key — and the join key is the detector. It must be a **real source-system reference**, never a derived composite: a derived key makes a re-keyed or merged invoice read as absent (§5). Closing this gap is a prerequisite for *both* the missing-invoice detector *and* the already-built candidate path, which refuses on exactly this condition. **It is the highest-leverage contract decision available.** |
| **9** | D1/D2 implications | **None, and that must be enforced.** The billing extract's reading, `classifyPayment`, `ObservedSummary`, the behaviour fingerprint, `canonicalFinding` and Detector #2's exposure all stay byte-identical. The missing-invoice surface is a **new artefact with its own scheme, method version and witness**, following the Detector #2 pattern. |
| **10** | Contract-version implication | **MAJOR.** Not for the new fields — a new optional extract could in principle be minor — but because multi-extract intake changes the **identity/idempotency derivation**, which §10 defines as major. Expect **3.0.0**, with 2.x row semantics declared identical via `MAJOR_ROW_SEMANTICS` so existing exports keep working. The obligation-reference promotion may itself be major if it is ever **required**. |
| **11** | Exact monetary rule | `MISSING_EVENT_KNOWN_AMOUNT` ⇒ exposure = the expected amount, exact integer minor units, copied verbatim from the expectation row. No other class carries money. |
| **12** | UNKNOWN-money rule | `MISSING_EVENT_UNKNOWN_AMOUNT` ⇒ **detected, counted, exposure UNKNOWN.** Never zero, never estimated, never in a money total, never averaged from prior invoices or a plan price. Reported with its own count-based recall, never blended into a monetary recall. |
| **13** | False-positive controls | Sixteen cases in §5. The two gating ones: **invoice generated after `asOf`** (needs a *governed* invoicing grace window, an analysis term like `stallThresholdDays`, never an operator input) and **paused subscription** (needs a dated pause interval, else fail closed). |
| **14** | Relationship to existing detectors | **Disjoint by construction**, not by proof over cohorts: the population is absent from the billing extract entirely. A *matched* expectation is in D1/D2 territory and contributes zero here, so the surfaces meet only where one is empty. |
| **15** | Expected incremental union coverage | **A genuinely new capability** — the first since Detector #1 — whose realised money is **dataset-dependent and may be $0.00** (§7.2). Unquantifiable today: the frozen corpus is a single billing extract and contains **no** expectation side, so there is no ground truth and no honest estimate. Quantification requires either a real two-system pilot extract or a new synthetic generator producing both sides. |
| **16** | What NH may claim (if built) | That a contractual obligation to invoice existed, evidenced by an independently-sourced record pre-dating the period; that no corresponding billing event exists as of the governed cut-off; and the **exact** obligated amount where the expectation carries one, or an explicit **unknown** where it does not — all labelled **OBSERVED**. |
| **17** | What NH may NOT claim | That the money is recovered, recoverable, returned or proven. That the invoice *will* be raised or collected. Any **estimated** amount for the unknown class. That a pattern of past invoices establishes a future obligation. That the omission was anyone's fault — the detector reports a missing handoff, never a cause or a culprit. And nothing here creates a Recovery Case or stages a candidate. |
| **18** | Smallest safe implementation sequence | **S1** — close the obligation-identity gap in the data contract (a real source reference; prerequisite for this detector *and* the candidate path). **S2** — declare the expectation extract as a contract artefact: fields, requirement tiers, validation, termination/pause/amendment semantics. **S3** — the governed invoicing grace window as an analysis term, proposed and activated by two identities like every other. **S4** — contract-system namespace verification, mirroring `declaredBillingSource`. **S5** — the ordered-pair reconciliation binding as a **new artefact family**, single-dataset path untouched. **S6** — a two-sided synthetic generator and the §6 ground truth. **S7** — the pure reconciliation detector with its own scheme, method version and witness. **S8** — persistence, then operator surface. **Each step is independently useful, and S1 pays for itself regardless of whether this detector is ever built.** |

---

## 9 · The decision question, answered

> **Can NH detect money that should have entered the billing system but never did, without inventing the
> expectation?**

**Yes — and only one way.** The expectation must arrive as an **independently-sourced extract from the
system that created the obligation**, and NH must perform the join itself, iterating the expectation side
so that absence is a positive result. Everything else either invents the expectation (historical pattern,
plan assumption, averaged amount) or cannot see the absence at all (single-extract designs, §2.6).

**What real customer data is required**, minimally and concretely:

1. A **stable obligation reference** shared by the contract system and the billing system. *Without this
   there is no detector* — and it is the same blocker the candidate path has waited on.
2. An **expectation extract** from the contract/entitlement/order system: one row per (obligation,
   period), with period bounds, expected invoice date, currency, and — critically — **dated termination,
   dated pause, and amendment-with-supersession**. Without those three, a legitimate ending is
   indistinguishable from an omission and the detector manufactures money in the normal lifecycle.
3. An **expected amount** where the contract system holds one. Where it does not, the finding is still
   real and its exposure is **UNKNOWN**.
4. **Verified provenance for the contract system**, not a declaration — the billing side already has this.

**What is NOT required:** no change to the billing extract, no change to D1/D2, no change to any existing
identity, and no estimation capability of any kind.

**Cost, stated plainly.** This is the most expensive capability analysed so far: a MAJOR contract version,
a second extract the customer must produce from a different system, a new artefact family for pair-bound
executions, a new governed analysis term, and a two-sided synthetic generator. It is also the **only**
analysed capability that finds money NH currently cannot see at all, and the only one that detects a
cross-department handoff failure.

**Nothing above is implemented, and nothing above is authorised.** The next decision is **S1** — the
obligation-identity contract gap — which is worth taking on its own merits and is a prerequisite for two
separate capabilities.
