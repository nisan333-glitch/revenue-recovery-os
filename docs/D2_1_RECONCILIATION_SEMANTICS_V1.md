# D2.1 · Reconciliation semantics — decision package (v1)

**Status: PROPOSAL, 2026-10-05. Read-only. Nothing implemented.** No contract change, no new field, no
schema change, no detector, no identity movement. Contract remains **2.0.0**. No `CLAUDE.md` paragraph is
written for the undecided parts; §3 is marked as the one piece proposed *for* the constitution.

Accepted inputs: the A/B/C separation is the working architecture, and **entitlement × governed billing
period** is the working floor with schedule-line × period preferred.

---

## 1 · Blast radius — and a correction larger than the one requested

The challenge was that my claim — *"any non-zero residual in a dataset is a reason to distrust every zero
in that dataset"* — was too broad. It was. But working out the minimum justified scope showed the claim
was **conceptually wrong, not merely wide**, and the correction changes the design.

### 1.1 · Contamination does not flow from a non-zero residual to a zero residual

A zero residual at grain `g` means `Σexpected(g) = Σobserved(g)`. For that zero to be **false**, offsetting
errors must lie **inside `g` itself** — concealment cases 1 (missing + overcharge) and 5 (duplicate masking
an omission). Both are internal.

A non-zero residual at some **other** grain `g′` is therefore **not evidence about `g`'s internals**. The
two facts are unconnected. My original claim asserted a relationship that does not exist.

So the apparent "contamination" resolves into two different things that were conflated:

| | What it is | Scope | Remedy |
|---|---|---|---|
| **A's standing blind spot** | A zero residual cannot exclude internal offsetting (cases 1, 5) | **Every** zero residual, in **every** dataset, **always** — not dataset-specific | **B**, event reconciliation. Not a wider warning |
| **Offset pairing** | A *positive* residual may be the counterpart of a *negative* residual elsewhere, making it a displacement rather than missing money (cases 2, 3, 4, 6) | **Bounded by mechanism** — §1.2 | Correlate and flag; **never net** |

Both corrections point the same way: **the warning belongs on the positive residuals, not on the zeros.**
Zeros carry a permanent, grain-independent claim boundary (§3); they do not carry dataset-specific doubt.

### 1.2 · The minimum justified blast radius

Pairing is justified **only where a named mechanism could have moved money between the two grains.** "In
the same file" is not a mechanism.

| Candidate scope | Mechanism | Justified? |
|---|---|---|
| same entitlement × period | internal offset — cases 1, 5 | **Not pairing.** Invisible to A by construction; it is §3's blind spot |
| **same entitlement, adjacent period** | invoice raised early or late — a timing displacement | **YES — strongest.** Common, and tightly bounded: adjacent within the governed invoicing grace window |
| **same billing batch / invoice run** | one run double-processed some lines and skipped others — exactly case 5's shape at scale | **YES, and the tightest scope available** — but requires an authoritative batch identifier, which NH does not have |
| **sibling entitlements of the same contract** | allocation error inside a contract — case 3 | **YES** |
| **sibling contracts of the same customer** | allocation error inside a payer — case 3, one level up | **YES, weaker.** Requires the contract→customer relation to be authoritative |
| cross-customer | wrong payer — case 2 | **ONLY with an authoritative payer hierarchy** (parent/child, shared billing account). Without it, two unrelated customers' residuals are not pairable, and pairing them would let **any surplus anywhere excuse any shortfall** — which is the netting defect wearing a different hat |
| same currency | none. Currency is a property, not a channel | **NO** |
| same source namespace | none by itself — the namespace *is* the billing system, so this is the dataset | **NO** |
| same dataset | none. Co-location in a file is not a mechanism | **NO — this was my error** |

**The rule:**

> **A positive residual's interpretation is qualified only by a negative residual reachable through a NAMED
> MECHANISM, and only within the same governed reconciliation unit and tenant boundary.** In descending
> strength: (1) same entitlement, adjacent period, within the governed grace window; (2) same billing
> batch, where a batch identifier is authoritative; (3) sibling entitlements of one contract; (4) sibling
> contracts of one customer, where the payer relation is authoritative. **Nothing else.** Same currency,
> same namespace and same dataset are not mechanisms and create no qualification.

**And the qualification is reported, never applied.** A paired positive residual is flagged
`PAIRED_CANDIDATE` with the mechanism named and the counterpart identified. It is **not** netted, **not**
suppressed, and **not** silently removed from the ledger — it is held out of the headline money metric
pending C, which is §2's `unpairedPositiveExposure`.

---

## 2 · Signed money semantics

### 2.1 · Canonical convention — one, stated once

```
expected(g)  = Σ authoritative expected amounts in force for grain g
observed(g)  = Σ billed amounts allocatable to g, EXCLUDING credits,
               excluding dated refunds and cancellations as today
residual(g)  = expected(g) − observed(g)            ← SIGNED. clampNonNegative is NOT applied.
```

| Sign | Name | Meaning | Treatment |
|---|---|---|---|
| `> 0` | **UNDER_BILLED** | Potential missing or short-billed money | Candidate exposure, **OBSERVED** only |
| `= 0` | **MONETARILY_BALANCED** | Monetary equality **at this grain**, and nothing more | §3 |
| `< 0` | **OVER_BILLED** | Potential over-billing or unexpected billing | A **liability signal**. Never exposure |

**A negative residual is not recovered revenue, and not revenue of any kind.** It is money the company may
owe back or billed without an established expectation. It never enters an exposure total, a recovery
figure, or any ledger. The vocabulary is `OVER_BILLED` / *gross negative discrepancy* — never *recovered*,
*returned*, *proven*, or *offsetting*.

### 2.2 · The no-netting rule

> **Positive and negative residuals from independent grains are NEVER netted to produce a smaller
> company-level leakage number.** Netting is a presentation that destroys findings: a $100 missing
> obligation and an unrelated $100 surplus are two problems, and their sum is zero problems, which is
> false.

Reported figures, and the first is the primary money-finding metric:

| Figure | Definition |
|---|---|
| **`unpairedPositiveExposure`** | **Σ positive residuals with NO mechanism-linked counterpart. THE PRIMARY MONEY METRIC.** |
| `pairedPositiveCandidates` | Σ positive residuals flagged `PAIRED_CANDIDATE` (§1.2), each naming its mechanism and counterpart |
| `grossPositiveExposure` | `unpaired + paired` — the full positive side |
| `grossNegativeDiscrepancy` | Σ \|negative residuals\|, reported as a magnitude with its own sign convention stated |
| `netResidual` | `grossPositive − grossNegative`, **optional, never primary, never labelled leakage** |
| `unresolvedGrainCount` | grains refused or not reconcilable, by reason |
| `coverageExcludedCount` | expectations excluded for want of an authoritative amount (§2.3) |

The headline therefore **cannot** hide a $100 missing obligation behind an unrelated −$100 surplus: an
*unrelated* surplus never enters `unpairedPositiveExposure`'s computation at all, because that figure is a
sum over positives only.

### 2.3 · UNKNOWN money — the trap is in the denominator

An expectation with no authoritative amount cannot enter `expected(g)`. Silently omitting it makes the
residual **understate**: a missing invoice becomes invisible *because* it could not be priced.

> **An unpriced expectation reduces the residual's declared COVERAGE, never the residual itself.** Every
> finding carries *"computed over N of M expectations; K excluded for want of an authoritative amount."* A
> residual with `K > 0` is a **lower bound** and is labelled as one.

Separately, and unchanged: an unpriced expectation that is **absent** is still a real **event** finding
with exposure **UNKNOWN** — counted, never valued, never averaged from prior invoices, never taken from a
plan price, never prorated by NH.

---

## 3 · Zero does not mean correct — proposed for the constitution

This is the one piece proposed **for** `CLAUDE.md`, because it is a claim rule rather than an architecture
choice, and because it is the sentence most likely to be quoted wrongly by someone reading a dashboard.

> **A zero monetary residual proves monetary equality at the governed reconciliation grain, and nothing
> else.**
>
> It does **not** prove event correctness, the absence of duplicate billing, the absence of a missing
> obligation, correct customer allocation, correct entitlement allocation, correct invoice identity,
> correct timing, or correct attribution.
>
> Monetary reconciliation may therefore report **`MONETARILY_BALANCED`**. It may **never** imply
> **`NO_LEAKAGE`** — that claim requires the independently gated **B** (event) and **C** (attribution)
> capabilities to support it, and each fails closed on its own named prerequisite.

Two implementation consequences, so this cannot decay into a footnote:

* The status is a **literal in the payload**, like `claimBoundary` — `MONETARILY_BALANCED`, never a bare
  `0` or a green tick. A reader must not be able to reach "no leakage" by looking at a number.
* `NO_LEAKAGE` **does not exist as a value** in the A surface's type. It is unrepresentable rather than
  merely discouraged, in the same way `constitutesProof: false as const` is a type-level fact rather than
  a convention.

---

## 4 · Grain selection — governed, not hard-coded

Entitlement × period is **not** universally correct; it is the best floor *we can currently name*. The
governed rule selects per dataset pair.

### 4.1 · The rule

> **Select the FINEST authoritative source-native grain `G` at which, for every obligation in scope:**
> 1. an **independent monetary expectation** exists at `G` — sourced outside the system that bills;
> 2. the **expected amount** at `G` is authoritative, or explicitly UNKNOWN (§2.3);
> 3. **lifecycle state** — termination, pause, amendment supersession — is authoritative at `G`;
> 4. **period boundaries** at `G` are authoritative;
> 5. **observed billing is allocatable to `G` without invented correlation.**
>
> **An NH-derived synthetic grain is never authoritative identity** and is not a candidate. If no `G`
> satisfies all five, the pair is **NOT_RECONCILABLE** and is refused.

### 4.2 · Falling back to a coarser grain is NOT graceful degradation

This is the part that is easy to get wrong, and it follows directly from §1: a coarser grain **conceals
more** (D2 §3 cases 2, 3, 4, 6 net away as the grain widens). So a coarser result is not a weaker answer to
the same question — it is a **different and more concealing** answer.

Therefore: **refusal is the default fallback.** A coarser reconciliation is permitted only when explicitly
requested, is labelled with the grain actually used **and its concealment class**, and is **never compared
against or aggregated with** a finer-grain result.

### 4.3 · Mixed grains within one pair

If some obligations support schedule-line and others only entitlement: **do not mix.** Reconcile each
grain cohort separately and report per cohort. A single figure spanning two grains has two concealment
profiles and is not interpretable.

### 4.4 · Candidate comparison

| Grain | Expectation exists at it? | Amount authoritative? | Lifecycle at it? | Allocatable? | Verdict |
|---|---|---|---|---|---|
| **order-line × period** | Order lines are commercial, not billing-period, objects; recurring obligations derive from them | Often (price) | Rarely — amendments live on the entitlement | Weak | **Candidate only where orders carry period schedules** |
| **contract-line × period** | Yes where contracts are line-itemised | Often | Sometimes | Medium | **Good candidate**; equivalent to schedule-line where contract lines carry schedules |
| **schedule-line × period** | **Yes — the native unit of "this is due then"** | Usually | Usually | **Strongest** — a schedule line is close to a per-obligation key, which also brings **B** within reach | **PREFERRED where authoritative** |
| **entitlement × period** | **Yes** | Usually | **Usually — amendments and pauses live here** | Medium | **FLOOR** |
| subscription × period | Contested (`subscription_id`'s meaning is the open D2 question) | — | — | — | **Declared, weaker fallback only, and only after D2 settles** |

**Capability gating, not guessing:** each grain is a named prerequisite. A pair that supports only
`entitlement × period` runs A at that grain and **gates B closed** (no per-obligation key). A pair that
supports `schedule-line × period` may run A **and** B. A pair that supports neither is refused. The
prerequisites are **separately named**, following
`SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` / `leakInstanceIdentityStatus`, so closing one cannot look like
closing both.

---

## 5 · The two-sided synthetic benchmark

Designed, **not implemented**. Grain = entitlement × period unless stated. `A` = signed residual;
`B` = event verdict; `C` = attribution verdict; `UNION` = contribution to `unpairedPositiveExposure`;
`UNK` = unknown-amount count; `FP` = false-positive money.

| # | Case | A | B | C | UNION | UNK | FP |
|---|---|---|---|---|---|---|---|
| 1 | expected 100 / observed 0 | **+100** | MISSING | — | **+100** | 0 | 0 |
| 2 | expected 100 / observed 80 | **+20** | MATCHED | ok | **+20** | 0 | 0 |
| 3 | expected 100 / observed 100 | **0** `MONETARILY_BALANCED` | MATCHED | ok | 0 | 0 | 0 |
| 4 | expected 100 / observed 120 | **−20** `OVER_BILLED` | MATCHED | ok | 0 | 0 | 0 |
| 5 | missing 100 + **unrelated** overbilling 100 | +100 at g₁, −100 at g₂ | MISSING at g₁ | ok | **+100** (no mechanism links them) | 0 | 0 |
| 6 | **duplicate 100 masking missing 100** (same grain) | **0** ← false zero | **DUPLICATE + MISSING** | ok | 0 from A; **+100 from B** | 0 | 0 — but **false negative 100 when B is gated** |
| 7 | wrong entitlement, equal company total | +100 at E₁, −100 at E₂ | both MATCHED | **MISALLOCATED** | **0** — paired by mechanism (3); the company was paid | 0 | **0 with pairing; 100 without** |
| 8 | wrong customer, equal company total | +100 at X, −100 at Y | both MATCHED | MISALLOCATED | **0** if a payer hierarchy is authoritative, else **+100** | 0 | **0 with hierarchy; 100 without** ← residual risk |
| 9 | timing shift between adjacent periods | +100 at P₂, −100 at P₁ | MATCHED | ok | **0** — paired by mechanism (1) | 0 | **0 with pairing; 100 without** |
| 10 | split invoices summing correctly | **0** | MATCHED (split noted) | ok | 0 | 0 | 0 |
| 11 | consolidated invoices summing correctly | **0** if allocatable; **REFUSE** if the invoice total cannot be allocated | MATCHED | ok | 0 | 0 | 0 |
| 12 | proration | residual over **reduced coverage**; the prorated expectation excluded | MISSING w/ UNKNOWN amount if absent | ok | 0 | **1** | 0 |
| 13 | legitimate pause | **0** / no unit | — | — | 0 | 0 | **0 if the pause is represented; +100 FP if not** |
| 14 | cancellation | **0** / no unit | — | — | 0 | 0 | **0 if dated; +100 FP if undated** |
| 15 | amendment | **0** — the expectation *in force for that period* | MATCHED | ok | 0 | 0 | **0 if supersession is represented** |
| 16 | renewal | **0** | MATCHED | ok | 0 | 0 | 0 |
| 17 | source-system re-key | mass unmatched keys | UNAVAILABLE | — | **0 — REFUSED** by the unmatched-identity rate check | 0 | **0 with the check; potentially the whole book without it** |
| 18 | billing-system migration | the extreme of 17 | UNAVAILABLE | — | **0 — REFUSED** | 0 | same |
| 19 | currency mismatch | **REFUSE** the unit; never convert | — | — | 0 | 0 | 0 |
| 20 | UNKNOWN expected amount | excluded from `expected`; coverage declared, result a **lower bound** | MISSING w/ UNKNOWN if absent | ok | 0 | **1** | 0 |

### 5.1 · What the benchmark must prove, and the part that is not optional

**Targets:** `FP money = $0` and `double-counted union money = $0`.

But those targets hold **only under stated representation requirements**, and the benchmark's job is to
prove the requirements are necessary rather than to assume them. So each of cases **7, 8, 9, 13, 14, 15,
17, 18 must appear TWICE** — once with the enabling evidence present (expected FP `$0`) and once with it
absent (expected FP as shown). A benchmark containing only the represented variants would demonstrate that
the design works where it is easy, which is the selection-bias failure S1 §5 already recorded.

**Double counting is $0 by construction** in one direction only, and the reason is worth stating: a matched
expectation means the invoice exists, so it is in the billing extract and is D1/D2 territory, contributing
zero to the missing-invoice surface. The surfaces meet only where one is empty. **Case 6 is the honest
exception to "A is enough":** A reports `0` and B reports `+100`, so the two capabilities disagree, and the
disagreement is the finding.

**No recall or precision claim beyond the representable ground truth.** Cases 1 and 6 bound it: cases 1 and
5's class is representable and measurable; case 6's class is **invisible to A at any grain**, so A's recall
on it is **0 by construction**, and reporting a blended recall over both would overstate A.

---

## 6 · Implementation decision package

| # | Item | Answer |
|---|---|---|
| **1** | Recommended source-native grain model | **Finest authoritative `G` by §4.1.** Preferred `schedule-line × period`; floor `entitlement × period`; `contract-line × period` equivalent where contract lines carry schedules; `order-line × period` only where orders carry period schedules. Subscription × period a declared weaker fallback after D2 settles. **NH-derived synthetic grain is never authoritative.** |
| **2** | Fallback / capability gating | **Refusal is the default fallback** (§4.2) — a coarser grain conceals more, so it is a different question, not a weaker answer. Per-grain named prerequisites, failing closed independently; mixed grains reconciled per cohort, never merged (§4.3) |
| **3** | Signed residual formula | `residual(g) = expected(g) − observed(g)`, exact integer minor units, credits excluded from `observed`, **never clamped** |
| **4** | Sign semantics | `>0` UNDER_BILLED (candidate exposure, OBSERVED) · `=0` MONETARILY_BALANCED · `<0` OVER_BILLED (liability signal, never exposure, never "recovered") |
| **5** | No-netting rule | §2.2. Primary metric is **`unpairedPositiveExposure`**; `netResidual` optional and never labelled leakage |
| **6** | Blast-radius rule | §1.2 — four named mechanisms only; currency, namespace and dataset are **not** mechanisms. Qualification is **reported, never applied** |
| **7** | Zero-residual claim boundary | §3. `MONETARILY_BALANCED` is a payload literal; **`NO_LEAKAGE` is unrepresentable in the A surface's type** |
| **8** | Minimum expectation-extract fields | obligation/entitlement reference (source-native, stable) · period start · period end · expected amount **or** explicit unknown · currency · termination effective date · pause interval start/end · amendment effective date + supersession reference · schedule-line reference where available |
| **9** | Minimum billing-observation fields | the existing billing extract, **plus** allocatability to `G` — a reference to the entitlement/schedule-line the invoice line settles, and the period it covers. **An invoice total alone is insufficient** (case 11) |
| **10** | Lifecycle fields required | dated termination · dated pause interval · amendment with supersession · (renewal falls out of period ranges). **Each absent one converts a legitimate non-event into a false positive** (cases 13–15) |
| **11** | Identity / correlation prerequisites | **A**: entitlement + authoritative period. **B**: per-obligation correlation — does not exist, gated closed. **C**: dimensional identity with validity over time, plus a payer hierarchy for case 8. Plus an **unmatched-identity rate check**, modelled on `maxRejectionRate`, to refuse re-key and migration (cases 17–18) |
| **12** | SourceNamespace implications | **Favourable.** Resolution is already per dataset (`sourceResolutionHash(boundaryId, datasetFingerprint, lineage)`), so two extracts resolve to two namespaces with existing machinery. Gap: `declarationChecked` cross-checks only `declaredBillingSource`; the contract system needs the equivalent (`sourceSystems.contract` is non-blank-checked only). The reserved class-grained names must stay unusable as instance namespaces — already enforced |
| **13** | Multi-extract binding | An **ordered pair** `(expectation, billing)` with per-dataset namespaces, in a **new artefact family** — its own scheme, method version and witness, following the Detector #2 pattern so the single-dataset path stays byte-identical |
| **14** | `pds` / `PAD` / `PAX` | Single-dataset path **untouched**: `pds_1bc639b3`, `PAD-a04577ae`, `PAX-8ad0089a` all preserved. **Each extract is admitted separately** — its own `pds`, its own `PAD`, its own defect rates — and reconciliation requires **both** admitted, which is correct rather than incidental. The pair-bound execution needs its **own** identity prefix; it must **not** reuse `PAX-`, because `canonicalBinding` feeds `deriveExecutionId` |
| **15** | Contract version consequence | **MAJOR.** See §7 for the itemised reasons |
| **16** | Migration consequence | **No data migration and no backfill.** New tables for the expectation extract and the pair binding; nothing existing is rewritten; history untouched. 2.x row semantics declared unchanged via `MAJOR_ROW_SEMANTICS` so existing exports keep working |
| **17** | Relationship to D1/D2 | **No effect.** `classifyPayment`, `ObservedSummary`, the behaviour fingerprint, `canonicalFinding`, `hashFinding` and Detector #2's exposure all byte-identical. The billing extract gains **no** required field |
| **18** | Incremental-union-money rule | Capability is incremental; **amount is dataset-dependent and may be $0**. `unpairedPositiveExposure` is the contribution; paired candidates contribute **0** pending C; negatives contribute **0, ever** |
| **19** | Exact synthetic benchmark | §5, with every representation-dependent case run **twice** — enabled and disabled — per §5.1 |
| **20** | Smallest safe sequence | **1** Decide `subscription_id` (D2 proper) · **2** Declare expectation-extract **semantics** only, no fields (S1 rule: declaration ships with its consumer) · **3** Governed invoicing grace window as an analysis term · **4** Two-sided generator with all 20 cases **and their disabled variants** · **5** Pure reconciliation core over the generator only — signed residual, pairing, coverage, refusals, own scheme/version/witness, **reads no new contract field** · **6** Unmatched-identity rate check · **7** Contract-system namespace verification · **8** Ordered-pair binding as a new artefact family · **9** Persistence, then operator surface |

Step **4 before 5** is deliberate: the concealment cases are the specification, and a core built first
would be measured against the cases it happens to handle.

## 7 · What requires a MAJOR contract change, and why

| Change | Class | Why |
|---|---|---|
| **Multi-extract intake (ordered pair)** | **MAJOR** | `ExecutionBinding.datasetFingerprint` is singular, and `canonicalBinding` feeds **both** `hashExecutionBinding` **and** `deriveExecutionId`. Widening it changes the identity/idempotency derivation — major by the policy's own list |
| **Changing what `subscription_id` means** (if the fallback grain is pursued) | **MAJOR** | *"Change the MEANING of an existing field, even with an identical name and type"* |
| **Promoting any new field to `required`** | **MAJOR** | *"Add or promote a required field"* |
| **Adding a new `recommended` field** | **MAJOR in substance** | `missingRecommendedColumns` against a governed threshold of 0 — governed issue #1 |
| Expectation extract declared as `optional` fields on a **new** artefact | **not major by itself** | Additive; but it lands with the binding above, which is major |
| The reconciliation core, its scheme/version/witness | **not major** | A new sibling artefact — the Detector #2 pattern |
| Governed invoicing grace window | **not major** | A new governed analysis term, two-identity governed like the others |
| Unmatched-identity rate check | **not major** | A new refusal on a new path; refuses nothing that exists today |

---

## 8 · What this package does not decide

`subscription_id`'s meaning · whether any identity field is ever declared · whether a billing batch
identifier is worth requesting · D1's release treatment (*"the choice is a human's"*) · any contract
version movement. **Contract is 2.0.0 and is not bumped here. Nothing is implemented.**
