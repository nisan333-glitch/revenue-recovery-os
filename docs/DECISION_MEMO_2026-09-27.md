# Decision memo — admission remedy, and the 65.4% gap

**2026-09-27 · from `37a2491` · read-only investigation · no production change, no frozen-evidence change.**

Two tracks were asked for. One closes; the other does not, and the reason it does not is a single product
decision that turns out to matter more than any detector on the list.

**Headline.** Track 1 needs no further work — the evidence says the invariant was the whole gap and EP-30
already documented it. Track 2 cannot start, because the only path that reads a customer's real data
**cannot** emit a recovery signal, and the only path that reaches Proof **cannot** read a customer's data.
Every detector on the roadmap is worth a different amount depending on how that is resolved, so the
decision comes first — as `CLAUDE.md` requires.

---

## 1 · Verified baseline

| | |
|---|---|
| Head | `37a2491` · working tree clean |
| Freeze 2026-09-26 | `173714237da63c4b…` · `gitHead 117ded4d` · **INTACT** |
| Freeze 2026-09-27 | `c042f004d8a7300e…` · `gitHead 5478a7d8` · **INTACT** |
| Regression at `37a2491` | `test` 513 (512+1 skipped without `DATABASE_URL`) · `test:ep2` 448 · journey 86/86 · purity · `tsc` · `build` · `build:server` |
| CI | green, all four jobs |

Measured leakage baseline, unchanged and not recomputed here: **$122,250.66** planted Synthetic
Ground-Truth Leakage · **$42,350.66** detected (3 classes) · **$14,800.00** representable but undetected
(2) · **$65,100.00** not representable (6) · **$79,900.00 = 65.4% invisible** · six of six out-of-schema
classes detected zero times.

---

## 2 · Admission remedy A–E — and the recommendation

### The finding that settles it: the pair is already enforced end to end

Before comparing remedies, one thing had to be established, because if it were false several remedies
would be mandatory rather than optional.

**The `(extract, terms)` pair is already binding at both gates, in code, today:**

* `deriveIdempotencyKey` (EP-28) folds the governed `asOf`, `stallThresholdDays` and `currency` into the
  submission identity.
* `deriveAdmissionDecisionId` (`assessmentExecution.ts:53-71`) folds **`idempotencyKey`** into the decision
  id — so the admission decision's identity carries the terms transitively.
* The schedule path re-derives the key from its **own** request and looks the decision up by it
  (`pilotAssessmentService.ts:268`), so scheduling under terms other than the ones that admitted the file
  finds **no decision** and refuses `NH-AX-1001`.
* `PilotAssessmentExecutionRecord` already persists the admission policy **and** `assessmentPolicyId`,
  `asOf`, `stallThresholdDays`, `currency` side by side.

**So there is no correctness gap, no auditability hole in the execution record, and no way to execute under
a definition other than the one that judged the file.** Remedies that exist to *create* that binding are
solving a problem the code already solved.

One legibility nit, recorded and deliberately not made into work: `pilot_dataset_submissions` stores
`admission_policy_id/version/hash` but not the terms in readable columns. They are recoverable from the
key and stated explicitly on every execution row, so this is a convenience, not a gap.

### The comparison

Columns 3–9 of the brief, condensed to what differs. "New lever" and "SoD / anti-tuning" were checked for
every option and the answer is uniform, so it is stated once: **none of A–E introduces a tuning lever, and
all preserve separation of duties and anti-tuning** — because the sighting is keyed on the **fingerprint**
(`pilotIntakeService.ts:279`, store returns the *existing* `firstSeenAt`), which no remedy touches. EP-30
measurement **C** confirmed that by execution.

| | **A** remove `undetermined` | **B** scope to the original reading | **C** pair bar⇄terms versions | **D** re-assessment mode | **E** document + light warning |
|---|---|---|---|---|---|
| **Semantic change to admission** | The bar loses the ability to require live in-flight cycles at all | A verdict becomes a property of a *lineage*, not of `(extract, terms)` | A bar is only ever in force *for* a definition | Two admission semantics: first-judgement vs re-judgement | **None.** The verdict's existing meaning is written down |
| **Invariant preserved / changed** | Preserves all; narrows the option surface | **Changes** the stated invariant, and risks carrying a stale fitness verdict forward — against Trust rule 2 | Preserves; makes the coupling explicit in the governance model | Preserves; duplicates the semantics | Preserves all |
| **First vs governed re-assessment** | Identical treatment (the state is simply not requirable) | Deliberately **different** — that is the point, and the risk | Identical rules, explicit pairing | Deliberately different | Identical |
| **Backward compatibility** | **Breaking and unrecoverable in the worst case** — see below | Needs a descent notion that does not exist | Migration for every bar in force; two governed objects become one pair | Additive but doubles the surface | **Fully compatible** |
| **Required changes** | `RequiredLifecycleState` type, `LIFECYCLE_STATES`, transport enum, UI checkbox, hash-scheme consideration, tests | New schema (lineage), new service logic, new tests, new governance question | Schema + store + service + UI + migration + tests | Schema + transport + service + UI + tests | Documentation (**done in EP-30**) |
| **Repo evidence supports it?** | **Partly** — facts 3, 4, 5 support removal; nothing supports the claim that the requirement is meaningless | **No** — requires a new product assumption about descent | **No new need** — the pair is already enforced (above); it would restate in the schema what the identity already binds | **No** — EP-30 ruled out the contradiction that would have forced it | **Yes, fully** |

### Remedy A's failure mode, which is the reason it is not recommended

Established from the code, not assumed:

1. `pilot_admission_policies` is **append-only** — `pilot_admission_policies_no_mutation`
   (`20260923070000_ep14…/migration.sql:51`). A bar row can never be edited.
2. The store **casts** rather than validates on read (`pilotAdmissionPolicyStore.ts:43`); validation happens
   in `evaluateAdmission`.
3. So a stored ACTIVE bar naming `undetermined` would, after A, fail `validateAdmissionPolicy`
   (`THRESHOLD_INVALID`, `pilotAdmissionPolicy.ts:126-131`) and make **every dataset in that boundary
   `NOT_ASSESSABLE`**.
4. It cannot be fixed by editing the bar (1). A **new** bar version can be proposed and activated — and then
   the anti-tuning rule refuses it for every fingerprint already sighted.

**Net: a deployment with such a bar in force would have those datasets permanently unassessable.** Nothing
in this repository configures such a bar and nothing is deployed, so the window where A is safe is *now* and
it closes on first production use. That is a real consideration and it is the user's to weigh — but it is an
argument about timing, not about correctness, and it does not make A right.

### Ranking, by evidence and architectural consistency

**E ≫ A > C > D > B**

* **E** is the only option the evidence fully supports, and the only one that changes nothing.
* **A** is the only other option with repository evidence behind it (facts 3–5: the state is disowned by
  `NH-AG-2007`'s own remediation, documented as *not classifiable*, and used by no configuration) — but the
  requirement *"your export must contain cycles still in flight"* is a coherent commercial ask, so removing
  it trades away a capability to close a trap E also closes.
* **C** would be the right model if the pair were not already bound. It is.
* **D** was ruled out by EP-30: there is no contradiction for a second semantics to resolve.
* **B** is last because it is the only option that would *weaken* an invariant.

### Recommendation

> **Adopt E, and recognise that EP-30 already delivered it. No further work is required.**

The invariant is stated in `ADMISSION_TERMS_COUPLING.md` and in `ANALYSIS_TERMS_GOVERNANCE.md`; the pair is
enforced in code; the anti-tuning rule holds across a re-reading, measured. **Saying this plainly as the
brief asked: the evidence shows no change is required beyond documenting the invariant, and that
documentation exists.** Track 1 is closed.

The one thing I would *not* build as its own slice, but would fold into the next UI change that touches that
screen: a line next to the `undetermined` checkbox saying the requirement is relative to the governed
cut-off. It is a hint, not a guard, and it does not deserve a slice.

---

## 3 · The 65.4% gap, decomposed

Every planted class, every invisible dollar, in the four requested categories. **Amounts are from the
independent business register** (`business_leakage_minor`), which was written from the narratives and never
from NH's semantics.

### The architectural fact that governs every row below

There are **two lanes**, and they do not meet.

| | **Lane 1 · pilot assessment** | **Lane 2 · agent / case lane** |
|---|---|---|
| Reads | the customer's real CSV export, through the governed data contract | a **pre-computed signal** CSV (`sourceIdentity, recoveryType, observedAt, amountAtRiskMinor, …`) or a normalized observation payload |
| Output | **one aggregate finding** — counts and five money totals. No per-entity output | `CandidateSignal` per entity, with a pseudonymous `sourceRef` (`hmac-sha256:<64 hex>`) |
| Reaches Fix/Prove | **No — by construction.** `constitutesProof: false as const`, `createsRecoveryCase: false as const` (`assessmentExecution.ts:440-445`), and `assessmentExecution.boundaries.test.ts:97` asserts the agent has *no branch* that emits a signal | **Yes, end to end and proven** — `csvProof.postgres.test.ts` links "ingestion, human review, promotion, action and immutable proof" |
| Detectors | one: `classifyStall` | one: `activation-deadline-v1` → `ActivationMissed` |

**Consequence, and it is the core of this memo: the only path that reads real business data cannot emit a
recovery signal, and the only path that reaches Proof cannot read business data.** So *every* entry in
category A or B below, built on lane 1, buys **Identify only**. It cannot become Fix or Prove, however good
the detector is.

Two further hard constraints, both from the code:

* **T2 proof requires case-level traceability** — *"the claim points to a specific account, not an aggregate
  trend"* (`PROOF_MODEL.md:166-167`). Lane 1's output is an aggregate over de-identified ordinals. So lane 1
  can never produce T2, and the ledger separation is not the obstacle — the output shape is.
* **The swarm is deferred** until *"agent #1 is proven end-to-end on **real data**"* (`ARCHITECTURE.md:172`).
  Agent #1 exists and is proven on **synthetic** data. The guard is still binding, which caps how many
  detectors it is legitimate to build now at roughly **one**.

### Category A — representable with today's fields, detector missing

**One rule covers both classes in this category, and that was checked against the frozen bytes rather than
assumed.** At `asOf 2026-06-30`:

| Scenario | Class | `next_invoice_due_at` | Amount | Settled? | Terminal? |
|---|---|---|---|---|---|
| S18 | `unpaid_invoice_without_activation_stall` | 2026-04-01 — **past due** | $9,300.00 | no `paid_amount`, no `next_invoice_paid` | no |
| S17 | `near_miss_exact_threshold` | 2026-04-01 — **past due** | $5,500.00 | no `paid_amount`, no `next_invoice_paid` | no |

Both are past due, unsettled, not cancelled and not refunded. So a single overdue-obligation rule surfaces
both — **the entire "representable but not detected" bucket, $14,800.00** — and S17 needs no
threshold-boundary detector of its own. See category D.

| Class | Amount | % of gap |
|---|---|---|
| `unpaid_invoice_without_activation_stall` | $9,300.00 | 11.6% |
| `near_miss_exact_threshold`, caught by the same rule | $5,500.00 | 6.9% |
| **Total** | **$14,800.00** | **18.5%** |

* **Input fields:** all present and `required`/`recommended` today — `next_invoice_due_at`,
  `next_invoice_amount`, `paid_amount`, `next_invoice_paid`, `cancelled_at`, `refunded_at`.
* **Detector logic:** an obligation whose due date has passed at `asOf`, not fully settled, not in a terminal
  state — **independent of activation**. Today both such cycles land in `reference` (they activated inside
  the window) and are therefore absent from every stalled total.
* **Output object:** a new cohort + money figure on the existing aggregate finding. No new object.
* **Entity-level evidence:** not required for Identify. **Required for anything beyond it.**
* **Fix/Prove:** **Detected Revenue Opportunity only**, on lane 1. Never Proof.
* **False-positive risk: low.** It is an arithmetic fact about a date and two amounts, not an inference.
* **Attribution risk: none** — nothing is attributed; it is an observation.
* **Complexity: low.** No contract change, no migration, no new governance object.
* **Testability: high** — the frozen fixture already contains the class and the cent-tag scheme decodes it.
* **Dependencies:** none.
* **Real-world definition independent of the fixture: yes** — standard accounts-receivable aging. An
  overdue obligation is money at risk whether or not onboarding went well.

### Category B — needs contract fields, fits the existing assessment architecture

The enabling fact: **`cohort.ts` is already domain-neutral.** Its own header states it "references only
expectationAt / observationAt / the threshold N … no SaaS, activation, invoice or ARPA assumptions". So a
class expressible as *an expectation with a deadline and an observation* needs an **adapter**, not a new
detector.

| Class | Amount | % of gap | Existing domain support | What it really needs |
|---|---|---|---|---|
| `renewal_at_risk` | **$24,000.00** | **30.0%** | `RenewalAtRisk` **LeakageType + full PLAYBOOK** — `creationRule`, `economicThreshold` 10000, `expectedProofEvent` "Renewal booked / second invoice paid", `recommendedReason: RenewalOutreach` | 3 fields (`contract_end_at`, `renewal_date`, `renewal_status`) + an adapter mapping them to `expectationAt`/`observationAt`. **No new detector logic, no new LeakageType, no new play.** |
| `expansion_stalled` | $9,500.00 | 11.9% | `ExpansionStalled` LeakageType + PLAYBOOK | 3 fields + a **quantity** comparison (`purchased_seats` vs `entitled_seats`) and a unit price to size the amount — beyond a pure date/observation adapter |
| `discount_leakage` | $6,200.00 | 7.8% | none | 3 fields + a **cross-cycle amount** comparison (did billing return to `list_price` after `discount_expires_at`) |

**Renewal is the strongest candidate in the entire decomposition**, and not because the fixture contains it:
it is the one class where the LeakageType, the creation rule, the economic threshold, the expected proof
event and the recovery play **all already exist in `src/domain`** and were written before any of this
validation work. The repository has been ready for it for a long time. It is also the largest single class,
at 30.0% of the gap.

* **Entity-level evidence:** required for Fix/Prove; not for Identify.
* **False-positive risk: medium** — "no renewal signal" is an absence, and an absence in an export can mean
  *not renewed* or *not exported*. This is the `NH-DC` provenance problem in a new place and must be
  answered by a declared-absence convention, not guessed.
* **Attribution risk: medium on lane 2** — a renewal that lands after outreach is the textbook confounder,
  which is exactly what T2's causal-window and confounder factors exist to grade.
* **Complexity:** renewal **medium** (contract minor version, adapter, tests, fixture); expansion and
  discount **medium-high**.
* **Testability: high**, but it needs a **new independent synthetic cycle** — the frozen fixtures must not be
  extended, and a class the current contract cannot express has no rows in them.

### Category C — needs a genuinely new detector or lifecycle model

| Class | Amount | % of gap | Why it is not category B |
|---|---|---|---|
| `usage_adoption_decline` | **$18,000.00** | **22.5%** | A **trend over a window** against a baseline of normal usage — not a deadline miss. `classifyStall` cannot express "collapsed to near zero". Needs a new lifecycle model and a normal-usage baseline, which is itself a Trust question: whoever defines "normal" influences the number. `LowAdoption` PLAYBOOK exists; the detector does not. |
| `dunning_failure` | $4,300.00 | 5.4% | Retries exhausted then **abandoned** is a terminal state reached by a *process*, not a stall. Its hardest question is the boundary against `excludedValue`: an abandoned charge may be a write-off, not recoverable leakage. |
| `credit_note_misapplied` | $3,100.00 | 3.9% | A **cross-row reconciliation** defect ("a credit masked an unpaid invoice"), not a lifecycle state at all. Closest existing analogue is the duplicate-cycle collision rule, not the cohort model. |

### Category D — cannot be justified from the evidence

**No class lands here, and no dollar is written off as unjustifiable — but one *framing* is rejected.**

**`near_miss_exact_threshold` as a class of its own: rejected, $0.** The "gap" is a **boundary convention**:
`classifyStall` uses strictly-greater-than, so a cycle activated at exactly `signed + N` is `reference`. That
is the definition of N doing its job, and no business asks for "cycles exactly on the threshold" as a
category — building a detector for it would be **optimising for the fixture**. The fixture's own note
concedes the tension: *"the invoice IS unpaid — a revenue operator would very likely want to see this money
somewhere."* The honest resolution is that the money is real and the *class* is not: S17's invoice is
overdue and unsettled, so **category A's single rule already surfaces it**, on the correct grounds. Its
$5,500 is counted once, in A.

This is the one place where the decomposition deliberately disagrees with the fixture's own taxonomy.

### The arithmetic

| Category | Classes | Amount | % of the $79,900 gap |
|---|---|---|---|
| **A** representable today, one rule missing | 2 | **$14,800.00** | **18.5%** |
| **B** new fields, existing architecture | 3 | $39,700.00 | 49.7% |
| **C** new detector / lifecycle model | 3 | $25,400.00 | 31.8% |
| **D** not justifiable | 0 | $0.00 | 0% |
| | **8** | **$79,900.00** | **100%** |

**A alone closes the whole representable-but-undetected bucket — $14,800.00, 18.5% of the gap, for no
contract change at all.** **A + B = $54,500.00 = 68.2% of the measured gap**, which would take value
coverage from 34.6% to 79.2% of planted leakage.

**Those percentages are properties of this fixture and nothing else.** The class mix was designed to *expose*
gaps, so it deliberately over-weights the out-of-schema classes; a real customer's distribution is unknown
and may invert the ranking entirely. They measure this experiment's gap, never revenue.

---

## 4 · Proposed capability roadmap, in dependency order

**Slice 0 is a decision, not code, and it gates the value of everything after it.**

| # | Slice | Depends on | Kind |
|---|---|---|---|
| **0** | **Decide whether lane 1 may emit per-entity `CandidateSignal`s** — the bridge | — | **Product / constitution decision.** See §5 |
| 1 | `RenewalAtRisk` end to end: contract minor version (+3 fields), adapter to `expectationAt`/`observationAt`, detector, and — if slice 0 says yes — candidate emission into the existing review→case→proof chain | 0 | Largest class; zero new domain objects |
| 2 | A **new independent synthetic validation cycle** covering renewal, with ground truth frozen before the run | 1 | Measurement, not capability |
| 3 | The overdue-obligation (AR) detector, category A — **$14,800, no contract change** | — (independent of 0 and 1) | Identify-only unless 0 says yes |
| 4 | `ExpansionStalled`, then `discount_leakage` | 1, 2 | Reuses the adapter pattern slice 1 establishes |
| 5 | `dunning_failure` — with its write-off boundary decided first | 4 | Needs a definition decision |
| 6 | `usage_adoption_decline` — needs a governed "normal usage" baseline, which is a Trust-Invariant design problem in its own right | 5 | Largest C class, hardest |
| — | `credit_note_misapplied` | unscheduled | Reconciliation, not a cohort; belongs with the contract's integrity rules |

**Why renewal before the AR detector, even though AR is cheaper — and it is close.** AR is $14,800 for no
contract change, which is better value per unit of work than renewal's $24,000 for a contract minor version
plus an adapter. The ordering rests on one thing only: **AR adds detection to a lane that cannot prove
anything**, while renewal is the one class that can traverse **Identify → Fix → Prove** using objects that
already exist — which is what `CLAUDE.md` means by *never ship a slice of the loop as the product*. If that
consideration is set aside, AR wins on economics, and if slice 0 is decided **against** the bridge then the
ordering flips outright: nothing on lane 1 can reach Prove, so the cheapest Identify win is the right one and
slice 3 goes first.

**Detection and proof, kept apart — explicitly.** Slices 1, 3, 4, 5, 6 improve **Identify**. None of them
improves **Prove**. Proof improves only through slice 0 plus the review→case→proof chain that already exists.
Every figure any of these detectors produces is **Detected Revenue Opportunity** and must be labelled so;
none is Recovered Revenue and none is Revenue Returned, proven or auditable.

---

## 5 · The first slice — and why it is a decision, not code

The brief asks me to stop only if a genuine product decision remains unresolved. **One does, and it is
prior to every engineering slice.**

> **Decision 0 — may a pilot assessment execution emit per-entity `CandidateSignal`s?**
>
> Today it may not, deliberately and structurally: `createsRecoveryCase: false as const`,
> `constitutesProof: false as const`, and a boundaries test asserting the agent has no branch that could
> construct a signal. Lane 2 solves the privacy problem with a pseudonymous `sourceRef`
> (`hmac-sha256:<64 hex>`), so a bridge is technically available and would not require raw identifiers.
>
> **Answering "yes" changes what a pilot assessment *is*** — from an observation about a population to a
> producer of governed per-account work items. That is a core-definition change and per `CLAUDE.md` →
> *Changing this constitution* it goes through the constitution **before** code.

**My recommendation on decision 0: yes, bridge it — via the pseudonymous `sourceRef` already in use, with
the human review step kept mandatory.** The grounds are the constitution's own, not convenience:
*"never ship a slice of the loop as the product"* and *"a CFO/CRO/CEO does not buy Detection"*. Lane 1 is the
only path a customer's data actually enters, and while it cannot emit signals, every detector built on it
makes the product **more** of a detection product, not less. The Trust Invariant is not threatened: the
signal would carry a pseudonym, the review→case→proof chain already requires an accepted review by a
different identity (`recovery_cases_require_accepted_review`), and `constitutesProof: false` would remain
true of the *assessment* — a case still has to earn its proof separately.

**Against it, stated fairly:** it widens the pilot path's blast radius, it makes the de-identification
boundary load-bearing in a new way, and `ARCHITECTURE.md`'s guard — *build no more agents until agent #1 is
proven on **real** data* — is arguably a reason to prove the existing lane on a real pilot before wiring a
second producer into it. That argument is strong enough that I am not treating my recommendation as settled.

### The slice that follows, specified for execution on a "yes"

**EP-31 · `RenewalAtRisk` on the governed path — Identify, with the Fix/Prove chain reachable.**

Scope, in three reviewable commits:

1. **Contract minor version** (`2.1.0`, additive — no row semantics change, so `MAJOR_ROW_SEMANTICS` is
   untouched): three `recommended` fields `contract_end_at`, `renewal_date`, `renewal_status`. Absence must
   be a *declared* absence, not an inferred one.
2. **Adapter + cohort reuse**: map the renewal obligation onto `expectationAt` / `observationAt` and reuse
   `classifyStall` unchanged. No new detector logic, no change to `invariants.ts` or `outcomes.ts`.
3. **Candidate emission behind an explicit flag**, using `RenewalAtRisk`'s existing PLAYBOOK
   `economicThreshold` (10000) and `expectedProofEvent`, with a pseudonymous `sourceRef` and the mandatory
   review step.

**Acceptance criteria — all binary:**

* A renewal obligation past `contract_end_at` at `asOf` with no `renewal_status` commitment is classified
  `stalled` by **unmodified** `classifyStall`; `git diff` on `src/assessment/cohort.ts` is empty.
* `requiredLifecycleStates` semantics, the admission bar, the governed AssessmentPolicy, the C3 identity
  derivation and both freezes are **untouched**; both composites re-verify INTACT.
* `PILOT_DATA_CONTRACT_VERSION` is `2.1.0`; a `1.x` and a `2.0.0` declaration both still admit
  (§10's window intact); the golden vector `pds_1bc639b3…` is **unchanged**, proving the identity derivation
  did not move.
* A missing renewal column produces a declared-absence finding, never a silent "not renewed".
* An emitted candidate carries `recoveryType: "RenewalAtRisk"`, an `hmac-sha256:` `sourceRef` and **no raw
  identifier**; a test asserts no raw `entity_id` reaches `agent_case_candidates`.
* Promotion without an accepted review still returns **409**; the accepted review must be a **different
  actorId** from the emitter.
* The assessment finding still declares `constitutesProof: false`, `constitutesRevenue: false`; the aggregate
  finding gains **no** proven or forecast figure, and `check:purity` stays clean.
* A **new** synthetic-validation cycle (new directory, new freeze, ground truth frozen before the run)
  measures renewal detection with precision/recall and monetary accuracy, and reconciles every dollar to a
  planted scenario. The two existing freezes are not read for writing and re-verify INTACT.
* Full regression green; `test` ≥ 513, `test:ep2` ≥ 448, journey ≥ 86/86.
* No figure anywhere is labelled Recovered Revenue or Revenue Returned.

**On a "no" to decision 0**, the slice becomes **EP-31′ · the overdue-obligation detector** — category A,
**$14,800 (18.5% of the gap, the whole representable-but-undetected bucket)**, no contract change, no new
fields, Identify-only and labelled as such, with the same freeze-integrity and claim-boundary criteria. It is
the cheapest real coverage available and it needs no decision from anyone; the only reason it is not slice 1
is that it cannot reach Fix or Prove.

---

## 6 · What remains unknown

1. **The real-world distribution of leakage.** Every percentage here is a property of a fixture built to
   expose gaps. Whether renewal or adoption or AR dominates a real customer's leakage is **unmeasured**, and
   the roadmap's ordering rests on the repository's readiness, not on demand evidence.
2. **Whether any of it is wanted.** `CLAUDE.md` is explicit that the bottleneck is demand proof, not
   architecture. Nothing in this memo is demand evidence. Six detectors built on a guess is the failure mode
   the Build Filter exists to prevent.
3. **Whether declared absence is workable for renewal.** "No renewal signal" must be distinguishable from
   "the column was not exported". The contract has conventions for this; whether real exports can satisfy
   them is unknown.
4. **`calculationMethodVersion`** remains explicitly open and out of the identity, untouched here.
5. **Whether agent #1 works on real data.** `ARCHITECTURE.md`'s guard turns on this and it has never been
   tested outside synthetic fixtures.
6. **The "normal usage" baseline** that `usage_adoption_decline` needs is an unsolved Trust problem: whoever
   defines normal influences the number, which is the Trust Invariant's standing question.

---

## 7 · What would falsify the recommendation

**Track 1 (adopt E, no work):**

* Evidence that a bar and its terms can diverge somewhere I did not look — a *third* call site that
  evaluates admission without re-deriving the identity. I checked intake and schedule; a path I missed would
  make **C** necessary rather than redundant.
* A real pilot activating a bar that requires `undetermined`. That would convert A's "now-or-never" window
  from theoretical to urgent, and the recommendation to leave A alone with it.

**Track 2 (bridge, then renewal):**

* **A decision of "no" on the bridge** — then renewal loses most of its value and the AR detector goes
  first. This is the single largest swing in the memo.
* **Demand evidence pointing elsewhere.** One customer saying "our leak is failed payments" outranks every
  percentage in §3, and would promote `dunning_failure` from slice 5 to slice 1.
* **Renewal absence turning out to be unrepresentable in practice** — if real exports cannot distinguish
  "not renewed" from "not exported", the class drops to category C and expansion or AR leads instead.
* **`classifyStall` turning out not to generalise.** My claim that renewal needs only an adapter rests on
  the module's own domain-neutrality statement. If a renewal obligation cannot be expressed as one
  `expectationAt`/`observationAt` pair — for example if it needs a *commitment window* rather than a
  deadline — renewal moves to category C and the whole ordering changes.
* **Agent #1 failing on real data**, which would make building producer #2 premature under
  `ARCHITECTURE.md`'s own guard.

---

**No production change, no frozen-evidence change, no merge, no deploy.** Nothing in this memo counts,
claims or implies recovered money. The only figures it contains are planted Synthetic Ground-Truth Leakage
and Detected Revenue Opportunity.
