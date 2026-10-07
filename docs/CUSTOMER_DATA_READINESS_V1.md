# Customer Data Readiness · can a real customer supply the facts?

**Recorded and built 2026-10-07.** A **validation-only** path: it computes no customer leakage, creates
no monetary finding, no Recovery Case, and persists nothing. Contract **2.0.0** unchanged, both frozen
synthetic packages untouched, `OBLIGATION_IDENTITY_FIELDS` still `[]`.

---

## 1 · Why this slice, and what it refuses to do

The synthetic phase answered *can NH find money* — **$60,246.00 → $79,846.00 headline claimable with
$0.00 fabricated**, on synthetic data. The open question became **can a real customer hand us the
authoritative facts that capability rests on**, which is a different question and is answered by
looking at files rather than at money.

So the readiness path answers exactly one thing: *do these two exports contain the authoritative source
facts NH needs to attempt trustworthy money reconciliation?* It does **not** estimate how many dollars
are blocked. Doing so before reconciliation has ever run on a customer's data would be a forecast
presented as a finding — the one blend the constitution forbids outright. A test walks the whole
returned object and fails on any monetary key or `$`-figure.

## 2 · The three new artefacts

### 2a · `nh.settlement-extract@1.0.0` — the billing side, which did not exist

There was no governed billing/settlement schema at all. Contract 2.0.0 describes a *subscription
observation* with `next_invoice_due_at` **required**, which cannot carry an invoice line; the synthetic
`observation.csv` was a benchmark artefact with no contract. So this is a third artefact — own id,
version, scheme, `sxv-2026.1` method version and `NH-SX-####` catalogue — and an **additive sibling**,
the pattern Detector #2 and the Expectation Extract already set.

**One row is ONE SETTLEMENT LINE.** Six required facts: `invoice_ref`, `invoice_line_ref`, `settled_at`,
`settled_amount`, `currency`, `payer_ref`. Five **fail-closed capabilities**, each closing on a missing
*conditional* fact and **rejecting no row** — capability gating per detector, never global dataset
rejection.

**`invoice_line_ref` is a position, and that is acceptable here** precisely because it is scoped to its
invoice and never used as a cross-system key. The grain study's finding stands: `invoice_line_id` is not
a reference to the obligation it settles. That is what `obligation_ref` is for.

**The asymmetry with the expectation side, stated because it looks like an inconsistency and is not:**
`expected_amount` may be a declared UNKNOWN that preserves its row; `settled_amount` may not. What was
**owed** can genuinely be unknown — a usage line the contract system cannot price. What was **billed**
cannot be: a billing system that cannot value its own line cannot evidence it.

**Its own `STOPPED_FIELDS`**, each with its reason — most sharply `expected_amount` on the billing side,
the exact mirror of the expectation side's stopped `invoice_ref`: it would let billing assert what was
*owed*, and the whole architecture rests on the expectation originating elsewhere. Also stopped:
`is_duplicate` (a beneficiary-controlled flag over which lines count — duplication is a conclusion NH
must reach, never a field the customer supplies), `settlement_count` (billing cannot state what was
expected *of* it), and any NH-derived or composite `obligation_ref`.

### 2b · `sourceFactAuthority.ts` — the ladder, and where it honestly stops

Named to be unconfusable with `domain/authority.ts`, which is about **actors** — who may approve a
proof. This is about **sources**: whether a fact in a file can be relied on at all. Blurring them would
make *an authorised actor uploading an unverified file* read as trustworthy, which is the case that must
not.

`PRESENT` → `VALID_FORMAT` → `SOURCE_NATIVE` → `AUTHORITY_VERIFIED`, with `AUTHORITY_UNVERIFIED` as an
explicit terminal state **outside** the order rather than its bottom rung.

> **Structural presence is not authority, and a request parameter can never declare a source
> authoritative.** The caller is the beneficiary of a larger number.

**Nothing in this slice reaches `AUTHORITY_VERIFIED`**, and that is a result rather than an omission: no
provenance channel exists. The four that would lift it — signed export, system-of-record attestation,
NH-performed fetch, third-party reconciliation — are declared with `implemented: false`, and a test
reads that flag. So the ceiling is `SOURCE_NATIVE` + `AUTHORITY_UNVERIFIED`, and **every level is
reported `PROVISIONAL`**. The refusal of self-vouching is **structural**: `evaluateDataReadiness` has no
parameter by which provenance could be asserted, because a field that exists and is rejected still
invites someone to ask what it would take to be accepted. Self-asserting keys that do arrive are listed
in `refusedSelfAssertedAuthority` so the refusal is visible rather than silent.

### 2c · `dataReadiness.ts` — a level, never a boolean

| Level | Requires |
|---|---|
| `L0_NOT_READABLE` | an extract-level fault on either side |
| `L1_STRUCTURALLY_VALID` | both files parse and carry their required columns |
| `L2_MONETARY_RECONCILIATION_POSSIBLE` | + billing states the obligation link, both sides period-keyed, currency comparable |
| `L3_EXACT_MONEY` | + an authoritative amount on **every** accepted unit, credits told apart |
| `L4_EVENT_PROOF` | + an authoritative **expected settlement count** — **unreachable**, by evidence |

A boolean "ready" would announce a capability from a subset of the facts it needs — the error the
`coverage.event` correction had just fixed one layer in. The presence of `obligation_ref` licenses L2 and
leaves L3 and L4 closed.

**Every blocked capability names three things**, which is what makes a readiness report a request rather
than a complaint: `missingSourceFact` · `owningSourceSystem` · `blockedMoneyDiscoveryCapability`, plus
the contract code to look up.

## 3 · The control found a defect in my own gate · the global taint, repeated

The first form of the obligation-link gate also required `danglingObligationRefs === 0`. On the frozen
variant that dropped the whole dataset to **L1**, and the diagnosis is the point:

**11 settlement rows of 597** name an obligation whose *expectation* row was correctly quarantined — **2**
for ambiguous live lines (`NH-EX-2016`, M17) and **9** for a non-governed currency (`NH-EX-2008`, M19).
Every one is accounted for; the billing references are fine and the contract side is what could not be
accepted.

> **Blocking monetary reconciliation for an entire dataset over 11 unjoinable rows of 597 is the
> dataset-global taint defect in new clothing.** *Doubt is scoped to the evidence that creates it, and a
> detector that refuses everything is not cautious but unusable.* 586 settlements resolve perfectly, and
> telling a customer reconciliation is impossible for a 98%-joinable book would simply be false.

So a dangling reference is a **per-unit** condition: counted, carrying `danglingObligationRefNote` that
states what it means and points at the expectation rejection codes that explain it, and **gating nothing
at dataset level**. The level semantics stay clean — L2 is *the join can be formed*, L3 is *amounts are
authoritative throughout*.

This was my design error, written into the plan before any evidence, and the control caught it. No
figure moved, because this path has no figures.

## 4 · The erratum · history preserved, not rewritten

`EXPECTATION_EXTRACT_FIELDS`' `STOPPED_FIELDS` already **stopped** *"obligation_ref as a cross-system
join key"*. Measurement has since partly overturned it. The record is **preserved unchanged** and
corrected by an append-only erratum in a **separate file**, so append-only is structural rather than
promised:

> **A superseded conclusion is CORRECTED AND PRESERVED, never deleted and never silently rewritten** —
> the benchmark-revision discipline applied to a design record.

| | |
|---|---|
| **No longer valid** | *"a billing migration re-keys the entire book at once, so the whole expected book would read as missing."* **Refuted by measurement:** M14 (bare re-key) 12 refusals → 0 and M15 (28-entitlement whole-book migration) both resolved **from the reference alone, with no alias map** — because a stable external reference was never billing's internal key. The objection assumed the reference would be the thing re-keyed. |
| **Still binding** | the two sides identify at **different grains**; consolidation and splitting are **many-to-many** (M05/M06, handled monetarily and explicitly *not* as events); `schedule_line_ref` stays scoped **within** the expectation extract; **the grain question remains open**; a *generic invoice-level* reference is still not sufficient — what was measured is an **obligation-level** one |
| **Resolved by relocation** | the key lives on the **billing/settlement** side and stays stopped on the expectation side, which is what the grain study concluded: *the obligation reference must be on the billing side* |

Causing commits are recorded on the erratum: `bc2303a` (the counterfactual) and `2bf1581` (the
pairing-order correction). A `SUPERSEDED IN PART` marker sits beside the original so no reader can miss
it, while the recorded `why` prose is **byte-identical** — pinned by a test that quotes it in full.

**No version bump.** `EXPECTATION_EXTRACT_VERSION` stays `1.1.0`: fields, tiers, validator semantics and
acceptance behaviour are all unchanged, and a version signalling a change that did not happen would
force a re-reading of every extract to express a dependency that does not exist.

### And the guard that had to move with it

`expectationExtract.test.ts` asserted **no production importer at all** — written when the extract was
deliberately unwired, enforcing the `obligation_ref` revert rule that *the slice which wires a field must
ship its consumer with it*. **This slice is that consumer.** The guard is therefore **narrowed, not
retired**: the importers must be exactly the four readiness-path files, named, and **no monetary,
reconciliation or assessment module may reach it** — which is what the guard was actually protecting.

Its scan now strips comments, because `settlementExtract.ts` *mentions* the erratum in prose and the
first form counted that as a dependency. Fourth instance of that lesson here: **a structural guard must
read code, not documentation.**

## 5 · The control results · read-only over both frozen packages

`npm run readiness:control` — **25/25 checks pass.** It reads `expectation.csv` and `observation.csv`
from both fixture directories and writes nothing: no regeneration, no re-freeze, no re-run of the money
benchmark, no re-score. `recon:verify` and `recon:ref:verify` both still pass afterwards.

| | **V3** (no obligation_ref) | **Variant** (obligation_ref supplied) |
|---|---|---|
| level | **L1_STRUCTURALLY_VALID** (PROVISIONAL) | **L2_MONETARY_RECONCILIATION_POSSIBLE** (PROVISIONAL) |
| authority | SOURCE_NATIVE / unverified | SOURCE_NATIVE / unverified |
| expectation | 601 accepted · 13 rejected · 4 UNKNOWN amount · `PARTIAL` | identical |
| settlement | 597 accepted · 0 rejected · **0** with obligation_ref · 6 credits | 597 accepted · 0 rejected · **597** with obligation_ref · 6 credits |
| dangling refs | — | **11**, counted and interpreted |
| blocked | 4 | **3** |

The six required recognitions, each asserted:

1. **V3 → `NH-SX-3001`**, missing billing-side obligation identity, ceiling L1
2. **variant → L2**, the higher reconciliation level reachable
3. **M16's blank amounts → UNKNOWN**, rows **preserved**, roll-up `PARTIAL`, never $0, L3 refused
4. **M17 → `NH-EX-2016`**, additive-obligation capability **unresolved**, not assumed
5. **M19 → no conversion**, exact money unavailable where currency is not comparable
6. **no fabricated authority** — both cap at `SOURCE_NATIVE`, both `PROVISIONAL`, neither computes money

## 6 · Exactly why a customer dataset would fail readiness

| Failure | Code | Level effect |
|---|---|---|
| a required column absent from either header | `NH-SX-1002` / `NH-EX-1002` | **L0** |
| an undeclared column (refused, never ignored) | `NH-SX-1003` | **L0** |
| a duplicated column — which wins would be file position | `NH-SX-1004` | **L0** |
| an empty extract — never read as "nothing was billed" | `NH-SX-1001` | **L0** |
| a blank required cell | `NH-SX-2001` | row quarantined |
| a blank `settled_amount` — no UNKNOWN on this side | `NH-SX-2001` | row quarantined |
| a negative amount not marked as a credit | `NH-SX-2004` | row quarantined |
| two rows sharing `(invoice, line)` — **both** excluded | `NH-SX-2006` | rows quarantined |
| a non-ISO currency | `NH-SX-2007` | row quarantined |
| **no `obligation_ref` column** | `NH-SX-3001` | **capped at L1** |
| a *partially* populated `obligation_ref` | `NH-SX-3001` | **capped at L1** |
| no `period_start`/`period_end` on the billing side | `NH-SX-3003` | **capped at L1** |
| currency not comparable across the two files | — | **capped at L1** |
| any accepted obligation with an UNKNOWN amount | `NH-EX-3006` | **capped at L2** |
| no `is_credit` column | `NH-SX-3002` | **capped at L2** |
| no expected settlement count (always) | `NH-SX-3005` | **L4 unreachable** |

## 7 · Which system normally owns each fact

| Fact | Owner |
|---|---|
| obligation identity, period, expected amount, currency, payer, lifecycle dates, amendment lineage, component identity, **expected settlement count** | **Contract / CRM / CLM** |
| invoice and line identity, settlement date, settled amount, currency, payer, **`obligation_ref`**, credit flag, settled period, migration lineage | **Billing / ERP** |
| independent confirmation that a settlement cleared | *Payments processor* — not requested in the first pilot |

Every `NH-SX-####` code carries `ownedBy`, so a readiness report tells a customer which team to route it
to rather than only that something is missing.

## 8 · Boundary

Observation only. `claimBoundary` carries `computesMoney: false`. No production reconciliation, no
Missing Invoice detector, no multi-extract production identity, no contract bump, no API, no screen, no
persistence. Nothing here turns any observed amount into proven **Revenue Returned** or **Auditable
Revenue**, and no customer data has been seen.

---

## 9 · APPEND-ONLY · the artefact was renamed on 2026-10-07

**Everything above is preserved as written.** It describes `nh.settlement-extract@1.0.0`, which is now
**RETIRED**, and its `NH-SX-####` codes, which are now `NH-BX-####` with the same numbers. Those
references are left intact on purpose: they record what was built and what the V3 package actually
answered, and the retired catalogue is preserved at
`src/contract/historical/settlementExtractCodes_1_0_0.ts` so every code cited above still resolves.
A historical record keeps the codes it recorded.

**What changed, and nothing else:**

| above | now |
|---|---|
| `nh.settlement-extract@1.0.0` | **`nh.billing-extract@1.0.0`** (new id, fresh version line) |
| `settled_at` | **`invoice_raised_at`** |
| `settled_amount` | **`invoice_line_amount`** |
| `NH-SX-####` | **`NH-BX-####`**, same numbers, severities and owners |
| `sxv-2026.1` | **`bxv-2026.1`** |
| `ReadinessReport.settlement` | **`.billing`**, so `DATA_READINESS_SCHEME` is now `…-v2` |
| `SETTLEMENT_OBLIGATION_LINK_AVAILABLE`, `SETTLEMENT_PERIOD_AVAILABLE` | `BILLING_…` |

**Unchanged:** every readiness level, gate, conjunct, count and refusal — so
`DATA_READINESS_METHOD_VERSION` stays `rdy-2026.1`. The ladder, the authority semantics, the
`AUTHORITY_UNVERIFIED` terminal state, the per-unit dangling rule, the no-money guarantee, the field
tiers, the capabilities and the stopped fields are all exactly as described above. V3 still caps at
**L1** and the variant at **L2**.

`EXPECTED_SETTLEMENT_COUNT_AVAILABLE` kept its name deliberately: it is about settlement *events*, which
is what the word correctly means there.

Full treatment, including why the successor is `1.0.0` rather than `2.0.0` and why the predecessor's
schema is preserved while its validator is not, in
[`docs/BILLING_EXTRACT_RENAME_V1.md`](BILLING_EXTRACT_RENAME_V1.md).
