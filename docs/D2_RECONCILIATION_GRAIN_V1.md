# D2 · The reconciliation grain — decision package (v1)

**Status: PROPOSAL, 2026-10-05. Read-only. Nothing implemented.** No contract change, no new identity
field, no Missing Invoice code, contract remains **2.0.0**. This package answers one question and stops.

> **What is the smallest authoritative cross-system grain at which NH can reconcile expected money against
> observed billed money without manufacturing or hiding leakage?**

**Answer: entitlement × billing period** — or, where the contract system exposes them, **schedule-line ×
period**, which is finer and strictly better. And a correction to my own earlier proposal, which is the
most important thing in this document:

> **Model D as I first described it was wrong in one specific way: it clamped the residual to
> non-negative. That discards the surplus — and the surplus is precisely the signal that reveals the
> offsetting errors monetary reconciliation would otherwise hide.**

---

## 1 · The governing rule

Everything below follows from one principle, derived in §3 and not assumed:

> **The reconciliation grain must be no coarser than the finest grain at which an expectation can
> independently exist.** At any coarser grain, two real errors of opposite sign net to zero, and a netted
> zero is indistinguishable from correctness.

And its corollary, which is the claim discipline:

> **Aggregate equality never proves event correctness.** A zero residual licenses exactly one statement —
> *"no net shortfall at this grain for this period"* — and never *"billing was correct."*

## 2 · Three different reconciliations, three different identity strengths

The user's separation is correct and it is the key to shipping anything at all. These are not three views
of one thing; they answer different questions, need different evidence, and **fail independently**.

| | Question | Minimum identity | Finds | Cannot find |
|---|---|---|---|---|
| **A · Monetary reconciliation** | Is the total money right for this grain and period? | **Group × period** — a stable group key and an agreed period. No per-obligation key | Net under-billing; net over-billing | Anything that nets. Every case in §3 |
| **B · Event reconciliation** | Did *each* expected obligation produce a billing event? | **Per-obligation correlation** — the ability to say *this* expectation is matched by *that* invoice | A missing event **even when the money nets**; duplicates; splits | Amount errors on matched events (that is A's job) |
| **C · Attribution / correlation** | Which customer, entitlement or department does this money belong to? | The obligation's **dimensional** identity (entity, entitlement, and their validity over time) | Misallocation between customers or entitlements | Absence (that is B's job) |

**The practical payoff, and the reason this separation matters commercially:** **A is reachable with a much
weaker identity than B.** NH can ship A alone — honestly labelled with what it cannot see — and add B when
per-obligation correlation exists. Under the S1 capability-gating rule, B simply fails closed under its own
named prerequisite while A runs.

**The practical danger:** A reporting `$0` looks like a clean bill of health and is not one. If A ships
without B, the `$0` case must carry its boundary in the payload, the way `claimBoundary` already does —
not in a footnote.

## 3 · What monetary reconciliation can HIDE — six worked cases

Each uses a (group, period) with two expectations of $100 each, so Σ expected = $200. **Totals match in
every case, and in every case something is wrong.**

| # | Case | Billed | Σ billed | A's residual | What is actually wrong | Caught by |
|---|---|---|---|---|---|---|
| 1 | **Missing obligation + overcharge** | one invoice, $200, covering expectation 1 only | $200 | **$0** | Expectation 2 **never billed**; expectation 1 **overcharged by $100**. Two real leaks, opposite signs | **B** only |
| 2 | **Wrong customer allocation** | $200 billed, but to customer Y | $200 *at the wrong group* | **$0 only if the grain is coarse enough to contain both** | Money billed to the wrong payer | **A at a fine-enough grain**, else **C** |
| 3 | **Wrong entitlement allocation** | $200 billed against entitlement E2 for both | $200 | **$0 if the grain is the subscription or coarser** | E1's revenue recognised against E2 | **A at entitlement grain**, else **C** |
| 4 | **Missing event offset by another invoice** | period 1 billed $200, period 2 billed $0 | $200 across both periods | **$0 if the window spans both periods** | Period 2 never billed | **A at period grain** |
| 5 | **Duplicate billing masking a missing event** | expectation 1 billed **twice**, $100 + $100 | $200 | **$0** | Expectation 2 never billed; expectation 1 billed twice. **A duplicate conceals an omission** | **B** only |
| 6 | **Timing shift across periods** | the period-2 invoice raised in period 1 | $200 across both | **$0 if the window spans both**; **+$100 / −$100 if per-period** | Revenue recognised in the wrong period | **A at period grain**, as a *signed pair* |

**Three conclusions, and they are the whole design:**

**3.1 · Cases 2, 3, 4 and 6 are defeated by making the grain finer.** Each nets only because the
reconciliation window is wide enough to contain both halves. That is where §1's rule comes from.

**3.2 · Cases 1 and 5 cannot be defeated by any grain.** Both errors live *inside* the same (group,
period), so no refinement of the grain separates them. **Only per-obligation event reconciliation (B)
finds them.** This is the proof that A is insufficient, not merely imprecise — and case 5 is the ugly one,
because a **duplicate masks an omission**, so the two most common billing defects hide each other.

**3.3 · The signed residual is the tell, and clamping destroys it.** In cases 4 and 6 a per-period signed
residual shows `+$100` in one period and `−$100` in the other. Clamped to non-negative, the `−$100`
vanishes and the `+$100` is reported as a plain missing-invoice finding with no hint that its counterpart
exists one period over. So:

> **The residual is reported SIGNED. `clampNonNegative` is not applied, and any non-zero residual of
> either sign in a dataset is a reason to distrust every zero in that dataset**, because offsetting is
> demonstrably occurring in it.

A negative residual is independently meaningful anyway: it is **over-billing**, i.e. customer-favourable
and a potential liability — never company revenue leakage, and never added to an exposure total.

## 4 · Candidate grains

**First, a fact that bounds the whole comparison:** NH has **no entitlement, order, schedule-line or
billing-schedule concept at all** — verified by search across `src` and `server`; the single "entitlement"
hit is a comment in the unwired `revenueEvent.ts`. Every grain below except *subscription* and
*billing period* would require new contract fields on a new expectation extract. The comparison is
therefore about which grain is **correct**, not which is cheapest.

| Grain | Can an expectation exist at it? | Nets offsetting errors? | Exists in NH? | Verdict |
|---|---|---|---|---|
| **contract** | No — a contract spans many obligations and years | **Massively.** Hides 2, 3, 4, 6 and both halves of 1 and 5 | No | **Reject.** A gross sanity check at best |
| **order** | No — a point-in-time commercial event that generates recurring obligations; and orders are amended | Heavily | No | **Reject** as primary |
| **subscription** (no period) | No — one subscription owes money in many periods | Hides 4 and 6 outright | **Contested.** D2's open question: declared *"stable cycle-level join key"*, but `DUAL_MAJOR_SEMANTIC_CHANGE_V1.md` leaves its grain OPEN, and the synthetic generator emits it **per row**, semantically an invoice id | **Reject** without a period, and unusable until its meaning is settled |
| **entitlement** (no period) | Closer, but still spans periods | Hides 4 and 6 | No | **Reject** without a period |
| **obligation group** | Only if it maps to a real exported identifier | Depends | No | **Reject as stated.** My own earlier term, and it is too vague: "the set of obligations sharing a billing destination and period" is an **NH-derived composite**, which is barred. It must be named by a source system or not used |
| **billing period** (alone) | No — a period across all customers | Totally | Partially (`next_invoice_due_at`) | **Reject** |
| **entitlement × billing period** | **Yes — this is the native grain of an expectation** | Defeats 2, 3, 4, 6. Cannot defeat 1, 5 (nothing can) | No | **RECOMMENDED FLOOR** |
| **schedule-line × period** | **Yes, and finer** — one line of a billing schedule for one period | Same, and it brings B within reach, because a schedule line is close to being a per-obligation key | No | **RECOMMENDED where the source exposes it** |

### 4.1 · Why entitlement × period rather than subscription × period

Three reasons, in order of weight:

1. **An entitlement is what creates the obligation to bill.** It sits on the expectation side of the seam
   NH is trying to see, satisfying the independence standard (the expectation must not come from the system
   that was supposed to act). `subscription_id` is declared `typicalSourceSystem: "billing"` — it is the
   actor's own key.
2. **Entitlement identity usually survives amendment.** An amendment changes an entitlement's *terms*, not
   its identity, so the expectation can be restated without re-keying. A subscription is more often
   re-created on amendment, which looks like a missing invoice (§5).
3. **`subscription_id`'s meaning in NH is an open question (D2 itself).** Building the money model on the
   contested field would decide D2 by implementation, which the constitution forbids.

**The honest counterweight:** `subscription_id` exists today and entitlement does not. If a customer cannot
export an entitlement identifier, the fallback is subscription × period — **and the fallback must be
recorded in the finding**, because it is a weaker claim: it inherits whatever `subscription_id` turns out to
mean and it nets any error that crosses two subscriptions of one entitlement.

## 5 · The sixteen lifecycle events at the recommended grain

`E×P` = entitlement × period, signed residual, per period.

| Event | Behaviour at E×P | Manufactures? | Hides? |
|---|---|---|---|
| 1 · one-to-one billing | Residual 0 | No | No |
| 2 · one-to-many invoices | Several invoices sum into the period; residual 0 | No | No |
| 3 · many-to-one consolidated invoice | **Requires the invoice to be allocatable to E×P.** If billing exports one line per entitlement-period, fine. If it exports only an invoice total, the allocation is unavailable ⇒ **refuse, do not guess** | No, if it refuses | **Yes, if it guesses** — hence the refusal |
| 4 · split invoices | Both sum into the period; residual 0 | No | No |
| 5 · **proration** | Expected amount is often **not derivable** ⇒ UNKNOWN class (§7), excluded from Σ expected and declared as reduced coverage | No | Yes — and declared rather than silent |
| 6 · amendments | New expectation effective from its date; prior periods unchanged. **Requires the expectation in force FOR THAT PERIOD**, not the latest | No | No |
| 7 · renewals | A new period range under the same entitlement | No | No |
| 8 · pauses | Dated pause interval ⇒ the period expects nothing. **Without a pause representation, a pause is indistinguishable from an omission ⇒ fail closed** | **Yes if unrepresented** | No |
| 9 · cancellations | Dated termination before the period ⇒ expects nothing | No | No |
| 10 · credits | A credit is **not** a billing event. It must be a separate line, never netted into Σ billed, or a credit would mask a missing invoice (case 5's shape) | No | **Yes if netted** |
| 11 · quantity changes | An amendment (6) | No | No |
| 12 · currency changes | One currency per dataset is already governed. A mid-period currency change ⇒ **refuse the period**, never convert | No | No |
| 13 · **re-keying** | **E×P is immune** if the entitlement key survives. If the entitlement is itself re-keyed, every period reads as missing ⇒ needs a stated old→new mapping or a refusal | Yes if the key moves silently | No |
| 14 · **account merges** | The surviving entitlement must carry the pre-merge periods, else they read as missing | Yes if unrepresented | No |
| 15 · **source-system migration** | **E×P is far more robust than any invoice-level key** — no invoice key is used. But if entitlement ids change wholesale, same as 13 | Yes if unannounced | No |
| 16 · **overlapping billing periods** | **The hardest case.** If two expectations' periods overlap, an invoice may belong to either, and the residual is ambiguous ⇒ **refuse the overlapping set**. Do not apportion | No, if it refuses | **Yes, if it apportions** |

**Pattern worth naming:** every "manufactures" cell is an **absence of representation** (pause, re-key,
merge, migration), not a flaw in the arithmetic. That is a testable requirement list for the expectation
extract, and it is why §8 puts the extract's semantics before any detector.

## 6 · The money rule

Per (entitlement, period), in exact integer minor units, using the existing primitives:

```
expectedSum(E,P)  = Σ authoritative expected amounts in force for (E,P)
billedSum(E,P)    = Σ billed amounts allocatable to (E,P), EXCLUDING credits and
                    excluding dated refunds/cancellations as today
residual(E,P)     = expectedSum − billedSum          ← SIGNED. Never clamped.

residual > 0  UNDER-BILLED. Candidate exposure = residual. OBSERVED only.
residual = 0  NO CLAIM OF CORRECTNESS — "no net shortfall at this grain and period".
residual < 0  OVER-BILLED. Customer-favourable; a liability signal, never exposure;
              AND a distrust signal for every zero residual in the same dataset.
```

Refusals rather than guesses: unallocatable consolidated invoice (event 3) · overlapping periods
(16) · mid-period currency change (12) · period boundaries that disagree between the two extracts ·
an entitlement whose key cannot be matched (13/14/15).

## 7 · UNKNOWN handling — the trap is in the denominator

An expectation with no authoritative amount **cannot enter `expectedSum`**. If it is silently omitted, the
residual **understates** — a missing invoice becomes invisible *because* we could not price it. So:

> **An unpriced expectation reduces the residual's declared COVERAGE, never the residual itself.** Every
> finding carries: *residual computed over N of M expectations for this (E,P); K carry no authoritative
> amount and are excluded.* A residual with K > 0 is a **lower bound**, and must be labelled as one.

And separately, from the Missing Invoice decision, unchanged: an unpriced expectation that is *absent* is
still a real **event** finding with exposure **UNKNOWN** — counted, never valued, never averaged from
prior invoices, never taken from a plan price, never prorated by NH.

**Which reveals the complementarity precisely:** A cannot see an unpriced missing event at all; B can see
it and cannot price it. *A finds missing money it can price; B finds missing events it may not be able to
price.* Neither subsumes the other.

## 8 · Recommendation

| Item | Recommendation |
|---|---|
| **Exact grain** | **Entitlement × billing period** as the floor; **schedule-line × period** where the contract system exposes it. Subscription × period only as a declared, weaker fallback, and only after D2 settles `subscription_id`'s meaning |
| **Authoritative source requirements** | Expectation side from the **contract/entitlement** system (not billing), pre-dating the period, carrying period bounds, dated termination, dated pause, amendment-with-supersession, and an expected amount where it has one. Billing side must be **allocatable to (E,P)** — an invoice total alone is insufficient. Contract-system provenance **verified**, as `declaredBillingSource` already is, not merely non-blank |
| **Money rule** | §6. **Signed residual, never clamped.** Credits excluded from `billedSum`, never netted |
| **Identity / correlation model** | **A** needs entitlement + period only. **B** needs per-obligation correlation, which does **not** exist and is gated. **C** needs dimensional identity with validity over time. Three named prerequisites, failing closed independently — following `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` / `leakInstanceIdentityStatus`, which are separate precisely so closing one cannot look like closing both |
| **False-positive controls** | The five refusals of §6, plus every existing control. The two that sink the detector if unrepresented: **pause** (event 8) and **invoice generated after `asOf`** (the governed grace window) |
| **False-negative risks** | Cases 1 and 5 of §3 — **unfixable at any grain, B only**. Plus any unpriced expectation (§7), and anything inside a refused period |
| **UNKNOWN handling** | §7 — reduces declared coverage, never the residual. A residual with excluded expectations is a **lower bound** |
| **Customer data burden** | **High.** A second extract from the contract system at entitlement × period grain, with lifecycle facts, plus billing output allocatable to that grain. Materially more than Detector #3's two optional columns |
| **Compatibility / version** | **MAJOR** — multi-extract intake changes the idempotency derivation (`ExecutionBinding.datasetFingerprint` is singular; `canonicalBinding` feeds `deriveExecutionId`). A **new artefact family** so the single-dataset path stays byte-identical; 2.x row semantics declared unchanged via `MAJOR_ROW_SEMANTICS` so existing exports keep working. **No identity field is added to the billing extract** |
| **What NH may claim** | For a reconciled (E,P): a signed net residual in exact minor units, labelled **OBSERVED**, with declared coverage, and refusals stated by reason. Under-billing is **exposure**; over-billing is a **liability signal**; zero is **"no net shortfall at this grain"** |
| **What NH may NOT claim** | That a zero residual means billing was correct. That a positive residual identifies a specific absent invoice (that is B). Recovered, recoverable, returned or proven revenue. Any estimated amount. Any cause or culprit |

### 8.1 · Smallest safe implementation sequence

| Step | Work | Gate |
|---|---|---|
| **1** | **Decide `subscription_id`'s meaning (D2 proper)** — needed for the fallback grain, and the frozen corpus cannot decide it | Owner |
| **2** | **Declare the expectation extract's semantics**: entitlement × period, period bounds, dated termination, dated pause, amendment-with-supersession, optional expected amount. **Semantics only, no fields declared** — per the S1 rule, declaration ships with its consumer | Owner |
| **3** | **The governed invoicing grace window** as an analysis term, two-identity governed | Owner |
| **4** | **A two-sided synthetic generator** built to produce consolidation, splitting, re-keying, merges, migration, proration, overlapping periods — and **all six concealment cases of §3**, asserting that A reports `$0` on cases 1 and 5 and that the suite says so out loud. The real corpus structurally cannot reach these (S1 §5 bias) | Owner |
| **5** | **Pure reconciliation core** over the generator only: signed residual, declared coverage, five refusals. Its own scheme, method version and witness. **Reads no new contract field** | Owner |
| **6** | Contract-system namespace verification; then the ordered-pair binding as a new artefact family; then persistence and operator surface | Owner |

**Step 4 before step 5 is deliberate.** The concealment cases are the specification. A reconciliation core
built before them would be measured against the cases it happens to handle.

---

## 9 · What this package does not decide

`subscription_id`'s meaning (step 1) · whether any identity field is ever declared · D1's release
treatment, which remains *"the choice is a human's"* · any contract version movement. **Contract is 2.0.0
and is not bumped here.**
