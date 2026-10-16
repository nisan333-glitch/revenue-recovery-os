# NH diagnostic capability audit · V2 · 2026-10-16

**What NH can actually detect, prove and recover — measured, not asserted.**

Branch `claude/pilot-journey-v1`, audited at `c06d57c06a11c36f4bc5c36d8394551f89757438`. Supersedes
[`NH_DISCOVERY_COVERAGE_AUDIT_V1.md`](NH_DISCOVERY_COVERAGE_AUDIT_V1.md) **in part**; that document is
preserved byte-identical and every one of its claims was re-derived here rather than quoted.

**Nothing in the product was changed to produce this audit.** No detector, no monetary calculation, no
contract, no version constant, no frozen artefact. The one thing built is a read-only measurement tool.

---

## 0 · The method, fixed before the findings

### 0a · Two lanes, and the distinction decides every row below

| | **Lane A · production** | **Lane B · benchmark** |
|---|---|---|
| entry point | `assessmentExecution.ts:542` → `assess()` | `scripts/reconciliation-*/run.ts` → `src/benchmark/reconciliationCore.ts` |
| input | a customer's contract-2.0.0 CSV | two-sided synthetic fixtures |
| production callers | the governed worker, the HTTP API, two UI screens | **zero** |
| governed | yes — policy, admission, append-only proof chain | no |

`src/benchmark/reconciliationCore.ts` is imported by two harness scripts, five of its own tests,
`obligationAwareReconciliation.ts` and one evidence test. **No `server/` module, no `src/contract/`
module, no UI.** So every figure from the reconciliation work — **$62,446.00 true positive, 72.66%
recall, $0.00 false positive** — is a measurement of a benchmark module, honestly obtained and **not a
statement about the product's own path.** A capability in lane B is not a product capability, and this
report says so per category rather than once in a footnote.

### 0b · The verdict vocabulary

Five values, chosen so *"we have code"* and *"a customer would get an answer"* cannot be conflated:

* **`PRODUCTION`** — reachable from `assess()` on contract-2.0.0 input, tested.
* **`BENCHMARK_ONLY`** — implemented and measured, no production caller.
* **`PARTIAL`** — one leg present, a named leg missing.
* **`BLOCKED_BY_CONTRACT`** — no representable input; the missing column is named.
* **`ABSENT`** — no code.

### 0c · The scoring rubric, written before any cell was filled

Each of the eight categories scores 0–10. The components are additive and each is a checkable fact:

| component | points | test |
|---|---|---|
| reachable from `assess()` on customer input | 4 | a production caller exists |
| measured against an independent frozen ground truth | 3 | a tracked score or baseline reports it |
| per-instance attribution in the product's **own** output | 1 | an operator can act on a specific obligation |
| no false positives in that measurement | 1 | measured FP money is $0.00 for the category |
| the finding can open a Recovery Case | 1 | a path from the finding to a `RecoveryEvent` exists |

**Caps, applied after the components:** `BENCHMARK_ONLY` ≤ **4**, `PARTIAL` ≤ **5**,
`BLOCKED_BY_CONTRACT` and `ABSENT` = **0**. The `BENCHMARK_ONLY` cap is the rubric's most consequential
choice and is deliberate: a measured capability no production path can reach earns at most the score of
an unmeasured production one.

**Three scores are reported and never blended** — the eight-category score, V1's continuity scores on
V1's own denominators, and recovery-proof on its own. Averaging detection with proof is the conflation
the constitution forbids, and an audit that did it would be the first thing a CFO should distrust.

### 0d · Evidence standard

Every monetary figure traces to one of three sources, named at each use: a **tracked baseline**
(`verify:baselines`), the **tracked 2026-09-27 score**, or the **dated re-measurement**
`docs/audit/cycle2-remeasured-2026-10-16.json`. A figure with no source is not published. Where evidence
cannot support a metric it is **NOT ESTABLISHED**, and that verdict is used freely below.

**Enforced, not promised.** A test extracts every `$N.NN` in this document and requires it to be a
minor-unit integer in a tracked source or a *declared derivation whose own inputs are in tracked sources*,
so arithmetic cannot launder an invented number. It caught an orphan in this report while it was being
written: **$9,800.00**, quoted from `CLAUDE.md`, is a delta between two baselines and appears in neither.

**One source had to be tracked to make this true.** `e2e/fixtures/synthetic-validation-2026-09-27/score.json`
is the only place the 2026-09-27 figures exist, and it was untracked — so the comparison table in §2a
quoted a file a clean checkout does not have, which is the "receipt for a lost artefact" problem in this
report's own evidence. It is now tracked under the governance decision that already covers its class: *a
recorded historical measurement is preserved evidence, not a disposable generated output.* It is **not**
hash-covered by the evidence record, so `verify:evidence` does not check it, and that limit is stated
rather than implied.

---

## 1 · The capability matrix

| # | Category | Verdict | Score | Lane |
|---|---|---|---|---|
| 1 | Contract-to-invoice discrepancies | `BENCHMARK_ONLY` | **4** | B only |
| 2 | Missing, delayed and incomplete billing | `PARTIAL` | **5** | A (overdue-unpaid) + B (missing) |
| 3 | Incorrect pricing, discounts and credits | `BLOCKED_BY_CONTRACT` | **0** | — |
| 4 | Partial payments and collection gaps | `PRODUCTION` | **9** | A |
| 5 | Duplicate billing and reconciliation errors | `PARTIAL` | **3** | A discards, B observes |
| 6 | Cross-system identity mismatches | `PARTIAL` | **3** | A half, B measured |
| 7 | CRM-to-activation handoff failures | `ABSENT` + `BLOCKED_BY_CONTRACT` | **0** | — |
| 8 | Renewals, retention, recurring revenue | `ABSENT` | **0** | — |

### 1 · Contract-to-invoice discrepancies — `BENCHMARK_ONLY` · 4/10

**Implemented.** A complete monetary reconciliation engine: `reconcile()` in `reconciliationCore.ts`,
governed taint scoping, pairing by authoritative relationship, an ambiguous-live-lines refusal, and an
obligation-aware reading in `obligationAwareReconciliation.ts`.

**Tested and proven.** Extensively, in lane B. On the frozen V3 package at entitlement grain (tracked
baseline `baseline.v3.postcapability.json`): planted **$85,942.00**, true positive **$62,446.00**, false
positive **$0.00**, false negative **$3,896.00**, monetary recall **72.66%**, precision **76.11%**. On the
obligation-ref variant, headline claimable money rises to **$79,846.00** with false positive still
$0.00.

**Missing.** Any production caller. **Score 4** by the cap, and the cap is the finding.

### 2 · Missing, delayed and incomplete billing — `PARTIAL` · 5/10

**Implemented and production.** Detector #2 (`nonStalledExposure.ts`) prices overdue unsettled obligations
on the complement of the stalled cohort — an overdue unpaid invoice on an account that activated on time.
**Measured this slice: it detects exactly the $14,800.00 the 2026-09-27 score recorded as a gap** (below).

**Missing.** A *never-invoiced* obligation is **structurally unrepresentable** in contract 2.0.0:
`next_invoice_due_at` and `next_invoice_amount` are required, so such a subscription either has no row or
a rejected one, and rejected rows are quarantined. The architecture that would close it needs an
independently-sourced expectation extract ([`MISSING_INVOICE_ARCHITECTURE_V1.md`](MISSING_INVOICE_ARCHITECTURE_V1.md));
the contracts exist (`nh.expectation-extract@1.1.0`, `nh.billing-extract@1.0.0`) and **nothing consumes
them in production.**

**Delayed vs missed is not distinguished in any output** — a finding carried unchanged from V1.

### 3 · Incorrect pricing, discounts and credits — `BLOCKED_BY_CONTRACT` · 0/10

Contract 2.0.0 declares 21 columns and **none of them is a price, a list price, a discount, a credit note
or a contracted value**. The only adjacent field is `is_credit` on the billing extract, a boolean that
*excludes* a line from billed money — not a credit reconciliation. The single `discount` string in the
repository is prose in a comment.

The frozen cycle-2 truth plants `discount_leakage` at **$6,200.00** and `credit_note_misapplied` at
**$3,100.00**, both marked `representable: false` with the missing columns named. **Nothing to measure.**

### 4 · Partial payments and collection gaps — `PRODUCTION` · 9/10

**Implemented, production, measured exactly.** `classifyPayment()` (`paymentState.ts:19`) returns
`PartiallyPaid`, and both detectors carry a partial-outstanding surface. Strictly as-of the cut-off: a
payment after `asOf` is invisible, with no future-information leakage.

**Measured** on the frozen package: `observed.partialOutstanding` = **$4,000.08**, equal to the truth's
expected bucket total to the cent, with all three contributing scenarios attributed by ablation —
including S09 at **$0.05**, a one-cent boundary case.

**The one point deducted, by the rubric:** no per-instance attribution in the product's own output.
`AssessmentResult` is aggregate-only; the cohort arrays are discarded at `assess.ts:71-72`. Attribution in
this audit required ablating the input 43 times. **An operator is told how much and not which.**

### 5 · Duplicate billing and reconciliation errors — `PARTIAL` · 3/10

**Production behaviour is deliberate exclusion, not detection.** `dedupeCollisions()` (`assess.ts:37`)
excludes **both** rows sharing a derived cycle identity — correct, constitutionally required, and it
*destroys* the economic signal rather than reporting it. The 2026-09-25 decision says so explicitly.

**Lane B observes it and refuses to name it.** `obligationAwareReconciliation.ts:256` reports
`MULTIPLE_SETTLEMENTS_OBSERVED` and **never the word duplicate**, because one obligation legitimately
settled by two lines is structurally identical to a double-bill without an authoritative **expected
settlement count** — a second source fact nobody supplies.

### 6 · Cross-system identity mismatches — `PARTIAL` · 3/10

**Half built, and the two halves are named apart on purpose.**
`SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true` (`leakInstanceIdentity.ts:124`) — the governed per-boundary
namespace registry exists. `OBLIGATION_IDENTITY_FIELDS = []` (`:53`) — the obligation identifier does not.
So `leakInstanceIdentityStatus()` returns `establishable: false`.

**Lane B measured what closing it is worth:** on the obligation-ref variant, M14 (a bare re-key) and M15
(a whole-book migration) both resolve **from the source's own reference with no alias map**, releasing
$9,800.00 and making a 28-entry alias map unnecessary.

### 7 · CRM-to-activation handoff failures — `ABSENT` + `BLOCKED_BY_CONTRACT` · 0/10

No CRM stage, owner, lead, opportunity, first-response or routing field exists anywhere in any contract.
`typicalSourceSystem: "crm"` in `pilotDataContract.ts:104` is **metadata about where `entity_id` usually
comes from**, not a CRM field — a citation that has to be read correctly before concluding anything.

### 8 · Renewals, retention and recurring revenue leakage — `ABSENT` · 0/10

`RenewalAtRisk` exists as a `LeakageType` value, a `PLAYBOOK` entry whose `creationRule` is the prose
*"Renewal at risk within X days of the term end with no commitment"*, two `reasons.ts` strings, and
**rows in `src/data/seed.ts` and `seedTrust.ts`**. There is **no predicate anywhere**. The frozen truth
plants `renewal_at_risk` at **$24,000.00**, `usage_adoption_decline` at **$18,000.00** and
`expansion_stalled` at **$9,500.00**, all `representable: false`.

### The finding that outranks the matrix · the loop runs on seed data

`AssessmentResult` reaches exactly two **display** screens, `PilotReadinessScreen.tsx` and
`DataQualityCohortScreen.tsx`. It never becomes a `RecoveryEvent`. Every `RecoveryEvent` in the product
comes from **22 hand-authored rows** in `src/data/seed.ts` (14) and `seedTrust.ts` (8).

So the Identify → Fix → Prove loop the constitution requires is demonstrated on fixtures, and the real
assessment path terminates at two read-only screens. **Four independent blocks**, each sufficient alone:

1. `OBLIGATION_IDENTITY_FIELDS = []` → candidate emission refused (`governedSignalStaging.ts:186`);
2. `LeakageType` is six lifecycle values — **none of the eight categories has one**, so even an unblocked
   detector would have nothing to open a case as;
3. `AssessmentResult` is aggregate-only — no instance to attach a case to;
4. `constitutesProof: false as const` across eight modules.

**Closing any single one changes nothing.**

---

## 2 · Measured performance

### 2a · Lane A, re-measured on the current build · 2026-10-16

Read-only, by leave-one-out ablation over the product's own public output. Inputs hash-verified against
the tracked evidence record before measuring; every frozen artefact byte-identical afterwards. Full
record: `docs/audit/cycle2-remeasured-2026-10-16.json`.

| | 2026-09-27 (tracked `score.json`) | **2026-10-16 (this audit)** |
|---|---|---|
| business leakage classes | 11 | **11** |
| detected | 3 · 27.27% | **5 · 45.45%** |
| representable, not detected | 2 · **$14,800.00** | **0 · $0.00** |
| not representable | 6 · $65,100.00 | **6 · $65,100.00** |
| value detected | $42,350.66 · 34.64% | **$57,150.66 · 46.75%** |
| false positive | not measured | **$1,000.00** |

**Detector #2 closed exactly the recorded gap** — S17 `near_miss_exact_threshold` $5,500.00 and S18
`unpaid_invoice_without_activation_stall` $9,300.00, summing to **$14,800.00 to the cent**, against a
ground truth frozen eight days before the detector shipped and authored without knowledge of it. That is
the strongest positive finding in this audit.

**Completeness: residual $0.00 on all nine reported fields of all three datasets.** Every dollar the
product reports is attributed to a scenario or to the filler cohort, so no money is unexplained and no
masking pair exists.

### 2b · The number that reframes the problem

> **NH's value coverage (46.75%) is now EXACTLY the fraction of planted money contract 2.0.0 can
> represent.** Representable money is $57,150.66; detected money is $57,150.66. They are identical.

* **Recall on representable leakage: 100.00%.**
* **Monetary precision: 98.28%** ($57,150.66 detected against $1,000.00 fabricated).
* **Structurally unreachable: $65,100.00 — 53.25% of planted money**, in six classes with no
  representable column.

**So NH's detection problem is reach, not accuracy.** Within what its contract can carry it finds
everything the frozen truth plants. Further detection gains require **new source facts, not better
detectors** — which is what makes the ranking in §4 a data-acquisition question rather than an
algorithms question.

### 2c · The $1,000.00 false positive

S33 carries `signed_at = "2026-03-01 09:30:00"` — a wall-clock datetime with no offset. The frozen truth
expects the row **excluded** (`malformed_or_ambiguous_date`; *"a wall-clock time with no offset is not a
point in time"*; business leakage **$0**). The current build **accepts it and books $1,000.00 into
`observed.observedUnpaid`**, the product's headline monetary figure.

**The mechanism is deliberate, not a parser bug.** `dateNormalize.ts:37` matches
`/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/` under the comment *"ISO (optionally with a time/zone we drop)"*
and truncates to day granularity by design. Every comparison downstream is `epochDay`-based, so the
reading is internally coherent.

**The disagreement is substantive, and bounded.** A timezone-less wall clock is genuinely ±1 day
ambiguous — `2026-03-01 09:30` is 2026-02-28 at UTC−11 — and the stall rule is a **day-threshold** rule,
so near a boundary this silently resolves the ambiguity in one direction and could flip a classification.
That is the F34 shape the constitution already records. For S33 specifically the obligation is months past
its deadline, so **this particular dollar is correctly classified on the stall axis even though the row
arguably should never have been admitted.**

**Reported, not fixed.** Whether a timezone-less datetime should be refused is a contract decision with
an owner, and this is an audit.

### 2d · Lane B, cited from tracked baselines

`baseline.v3.postcapability.json` and `baseline.variant.postcapability.json`, both verified by
`verify:baselines`:

| candidate | TP | FP | FN | recall | precision |
|---|---|---|---|---|---|
| `A_SUBSCRIPTION` (entitlement × period) | **$62,446.00** | **$0.00** | $3,896.00 | **72.66%** | 76.11% |
| `D_PAYER_PERIOD` (aggregate) | $3,064.45 | $0.00 | $63,277.55 | **3.57%** | 100% |
| `F_OBLIGATION_REF` (variant) | $62,446.00 | $0.00 | $3,896.00 | 72.66% | 76.11% |

`D_PAYER_PERIOD`'s 3.57% is **a diagnosis, not a regression**: that grain merges sibling entitlements, so
nearly every unit is an unsupported aggregation the core correctly refuses. `B_CONTRACT` and
`C_SCHEDULE_LINE` are **NOT CONSTRUCTIBLE** — billing emits neither.

### 2e · NOT ESTABLISHED

* **Precision and recall for categories 3, 7, 8** — nothing is representable, so nothing can be measured.
* **Root-cause explanation quality** — no rubric exists, and authoring one inside the audit that then
  scores the product would be marking my own work.
* **Any lane-A figure beyond observed exposure** — `estimated` and `forecast` are the literal
  `"unavailable_in_validation_slice"` and `proven` is `zeroMoney` (`assess.ts:115-118`). NH has **no
  estimate, no forecast and no baseline**, only direct observation.
* **Everything about real customer data.** None exists. Every figure in this report is synthetic.

### 2f · A defect in the ruler, recorded and not repaired

S09 carries `cent_tag: 4` against `expected_amount_minor: 5`, so the frozen truth's
`partialOutstanding` tags sum to 7 while its own declared total's cents are 8, and the bucket is
**undecodable by the truth's own arithmetic**. NH reported $4,000.08 — the truth's expected total exactly.
**The ruler has the defect; the product agrees with the ruler's money.** That is a governed benchmark
revision question, so the frozen file is untouched and no figure in this report improves because of it.

---

## 3 · The scores

### 3a · Eight-category, production-weighted

```
4 + 5 + 0 + 9 + 3 + 3 + 0 + 0  =  24 / 80
```

> ## **3.0 / 10**

### 3b · V1's continuity scores, re-derived at HEAD on V1's own denominators

| V1 score | V1 (2026-10-04) | **HEAD (2026-10-16)** | moved? |
|---|---|---|---|
| **A · detection coverage** | 1 family — the stall rule | **2 families** — the stall rule **+ Detector #2** | **yes** · 9.1% → **18.2%** /11 · 4.0% → **8.0%** /25 |
| **B · monetary coverage** | 1 family, observed only | **2 families**, observed only | **yes**, identically |
| **C · recovery-proof coverage** | **0** | **0** | **no** |

### 3c · Recovery-proof, scored alone

> ## **0 / 10**

Four independent structural blocks. Not a configuration, not a flag, not a gap in coverage — the product
cannot turn anything it detects into a Recovery Case, and the demo that appears to show otherwise runs on
22 hand-authored rows.

### 3d · Why three numbers and not one

**3.0/10** says *how much of the commercial leakage surface a customer would get answers for*. **18.2%**
says *how much of the detectable family space is built*. **0/10** says *how much of it becomes money*.
A single blended figure would hide the only fact that matters commercially: NH is **accurate within a
narrow reach and cannot close the loop at all**.

---

## 4 · The three highest-impact engineering improvements

Ranked on the five axes you specified, with the ranking derived from §1–§2 rather than asserted.

### #1 · A governed object the detectors can open a case as

| axis | assessment |
|---|---|
| leakage detection potential | **none directly** — it detects nothing new |
| evidence quality | highest — it is the only one that moves **score 3c off zero** |
| false-positive risk | **low**: it adds no detection, so it fabricates nothing |
| complexity | medium — a new `RecoveryType` family, per-instance output from `assess()`, and the identity prerequisite |
| CFO/CEO demonstrability | **highest**. Today the demo is seed data. This makes it the customer's own |

It is first **because nothing else can be sold without it.** A CFO buys *"I found it, I fixed it, I
returned cash"*; NH currently stops at the first clause for two families and the loop on screen is
fixtures. Detection improvements multiply a factor that is currently zero.

**Acceptance criteria.** On the frozen cycle-2 package, a `Detector #2` finding produces a staged
candidate with a per-obligation reference and a `RecoveryType`; `leakInstanceIdentityStatus()` returns
`establishable: true`; one Recovery Case is created end to end in the browser journey from an
**assessment** rather than from seed; `proven` stays `zeroMoney` until an outcome is evidenced;
`constitutesProof: false` is unchanged on every assessment surface; and **$0.00 of Revenue Returned is
claimed from a detection alone.**

### #2 · Close the obligation-identity gap · `OBLIGATION_IDENTITY_FIELDS`

| axis | assessment |
|---|---|
| leakage detection potential | **measured**: $9,800.00 of $85,942.00 planted in a controlled lane-B experiment — the only field tested that unlocked any money |
| evidence quality | high — a controlled counterfactual with both controls reproducing the baseline identically |
| false-positive risk | **measured $0.00** before and after |
| complexity | medium-high — a contract addition, a governed capability gate, and it is #1's prerequisite |
| CFO/CEO demonstrability | high — it is **one column in one export**, which is a short conversation |

It is the named prerequisite for #1, for candidate emission, and for the missing-invoice detector. The
pilot intake package already asks for it.

**Acceptance criteria.** `OBLIGATION_IDENTITY_FIELDS` is non-empty and governed; readiness reaches
**L3** on the variant package; `F_OBLIGATION_REF` retains TP $62,446.00 and FP $0.00; the identity is
capability-gated per detector and **fails closed** when unavailable; no dataset that passes today is
refused.

### #3 · Wire the reconciliation core into the production path

| axis | assessment |
|---|---|
| leakage detection potential | **highest measured**: $62,446.00 TP at 72.66% recall on frozen synthetic data |
| evidence quality | high **in lane B**, and **zero in lane A** — that is exactly the gap |
| false-positive risk | **measured $0.00** on the frozen package, after four corrections |
| complexity | **highest** — it needs the reconciliation grain decision, which is still open, plus multi-extract intake and a MAJOR contract version |
| CFO/CEO demonstrability | highest — it is the only thing that finds contract-to-invoice money at all |

It is **third despite the biggest number**, and that ordering is the audit's main recommendation. Wiring
it before #1 would produce a second engine that finds money and still cannot open a case; wiring it
before #2 would hit the identity wall the grain study already documented. The sequence is not negotiable
by preference — it is a dependency order.

**Acceptance criteria.** A production caller exists outside `src/benchmark/`; on the frozen V3 package the
production path reproduces TP $62,446.00, FP $0.00 and recall 72.66% **field for field**; the ambiguous-
lines refusal and the taint scope are unchanged; `reconciliationCore.ts` stays byte-identical at
`60e71f6f` or its movement is a governed revision with its own freeze; and `NO_LEAKAGE` remains
unrepresentable.

---

## 5 · The roadmap to 9.5/10

**9.5/10 on the eight-category rubric requires seven of eight categories at `PRODUCTION` with measured
precision/recall, per-instance attribution, zero false positives and a case path.** That is a
data-acquisition programme, not a sprint, and the honest statement of distance is:

| stage | delivers | eight-category score |
|---|---|---|
| **now** | 2 production detectors, aggregate, no case path | **3.0** |
| **A** · #1 + #2 | categories 2 and 4 fully closed; recovery-proof off zero | ~**4.5** |
| **B** · #3 | category 1 production; category 5 and 6 partial → production | ~**6.5** |
| **C** · expectation + billing extracts consumed in production | category 2's *missing-invoice* leg | ~**7.5** |
| **D** · pricing/credit and CRM/renewal source facts | categories 3, 7, 8 — each needs a **MAJOR** contract version and new customer exports | ~**9.0** |
| **E** · a real pilot with `AUTHORITY_VERIFIED` provenance | every figure above stops being synthetic | **9.5** |

**Stages D and E are not engineering-limited.** D needs columns no customer has been asked for yet; E
needs a signed export, a fetch NH performs itself, a machine-issued attestation or third-party
reconciliation — **none of which exists**, so every readiness level is still `SOURCE_NATIVE`/PROVISIONAL.

**A 9.5 reachable only on synthetic fixtures would be worth very little**, and the rubric is deliberately
built so that it cannot be reached that way: stage E is the last 0.5.

---

## 6 · Limitations and unproven claims

1. **Every figure is synthetic.** No customer data exists. **No observed amount is Revenue Returned or
   Auditable Revenue**, no Recovery Case was created, and neither ledger moved.
2. **$62,446.00 is a benchmark figure** from a module with zero production callers. Quoted without that
   qualifier it overstates the product by a wide margin.
3. **The eight-category denominator is yours, not canonical.** V1 used 11 and 25 families and produced
   very different percentages. All three framings are reported; none is "the" score.
4. **100% recall on representable leakage is a statement about one frozen package of 43 scenarios**, not a
   coverage claim about any real book.
5. **The $1,000.00 false positive is a disagreement with a frozen truth**, not a proven bug. The product's
   day-granularity reading is internally coherent; the contract question is open.
6. **The ruler has a known defect** (§2f) and a benchmark revision has not been performed.
7. **Ablation measures a marginal effect.** Two scenarios masking each other would each show a zero
   delta; the completeness identity ($0.00 residual on all 27 field×dataset pairs) is what rules that out
   here, and it is the only thing that does.
8. **Root-cause explanation quality and operator actionability are NOT ESTABLISHED.**
9. **This audit built a measurement tool and changed nothing else.** Phase 3 — the 30+ adversarial
   scenario pack — is a separate slice and has **not** been run.

---

## 7 · The answer in one paragraph

NH is **unusually disciplined and very narrow**. Within the slice of reality contract 2.0.0 can express it
now finds **100% of planted leakage with 98.28% monetary precision**, and Detector #2 closed a $14,800.00
gap exactly, verified against a truth authored before it existed. Outside that slice it sees **53.25% of
planted money not at all**, for a structural reason — no column carries it. Its reconciliation engine is
genuinely strong and **no production path calls it**. And it cannot convert a single thing it detects into
a Recovery Case, for four independent reasons, while the demo that suggests otherwise runs on 22
hand-authored rows. **The bottleneck is not detection accuracy. It is reach, and the loop.**
