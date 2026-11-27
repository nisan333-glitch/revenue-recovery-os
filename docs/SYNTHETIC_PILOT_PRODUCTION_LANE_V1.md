# The synthetic pilot, through the production lane · and the blocker it found

**Date:** 2026-11-27 · **Commit:** `40edae3` · **Status:** `SYNTHETIC_VALIDATED` — **never**
`REAL_CUSTOMER_PROVEN`. Every figure below is generated data. **No observed amount became real
Revenue Returned.**

---

## 1 · What was run, and why it is not another harness

Three harnesses already existed and none answered the question. `e2e/journey.mjs` drives the
production stack on a **three-candidate** book and reaches PROVEN.
`scripts/reconciliation-synthetic/run.ts` drives a **realistic 600-row company** but through
`src/benchmark/reconciliationCore.ts`, which the V2 audit measured as having **zero production
callers**. `server/agents/syntheticPilot.ts` drives one `ActivationMissed` case, whose proof leg is a
refusal by construction.

So this exercise put the **realistic company** through the **production stack**:

```
POST /pilot/pairs → real worker → reconciliationObserver.ts → candidates
  → review → promote → cases → author → baseline → intervention
  → signed correction → signed outcome → POST /proofs
```

**Nothing was generated.** `e2e/fixtures/reconciliation-obligation-ref/` was frozen on 2026-11-24
under a tracked lock — 614 expectation rows, 597 billing rows, 60 payers, 119 entitlements, and a
ground truth of 19 planted mechanisms totalling **$85,942.00** — three days before this was asked
for. Authoring the truth and the result in the same week is what the freeze control exists to
prevent. `scripts/pilot-synthetic-company/project.ts` only renames columns into the governed
contracts, and **both freeze verifiers pass afterwards**, which is how the read-only claim is
evidenced rather than promised.

---

## 2 · The result

| | |
|---|---|
| pair admitted | `POST /pilot/pairs` → **200**, real worker task **succeeded** |
| readiness | **L2_MONETARY_RECONCILIATION_POSSIBLE** (601/614 expectation rows accepted, 597/597 billing) |
| candidates created | **9**, in the production database |
| **Revenue Opportunity** (OBSERVED exposure) | **$76,458.30** |
| **Revenue Returned** (PROVEN, synthetic) | **$2,758.01** over **2** cases |
| cases the gate refused | **7 × `OBLIGATION_COVERAGE_IS_AGGREGATE`** |

Against the frozen truth: true positive **$56,858.30**, false negative **$9,483.70**, **monetary
recall 66.16%**, **3 of 3** required refusals honoured, 5 correct silences, and — the figure worth
most — **$0.00 of exposure on any entitlement the truth planted nothing in.**

---

## 3 · The blocker, measured

> **The production detector finds $76,458.30 and only $3,064.45 of it — 4.01% — can ever reach
> PROVEN.** The rest is refused because the candidate key is account-grained, so one payer's several
> obligations become one case, and `provenEligibility` refuses an aggregate by design.

`reconciliationObserver.ts:106` says it in terms — *"ONE candidate per payer"* — and line 343 groups
`byAccount`. With ~2 entitlements per payer in a realistic book, most candidates merge. The
three-candidate demo reaches PROVEN **because each of its payers holds exactly one obligation**; that
is the property a realistic company does not have, and it is why no existing harness could have shown
this.

**And the grain is one the repository already rejected.** The benchmark study measured payer-grain,
recorded *"$56,858.30 at 66.16% recall"*, found 12 of 19 cases unattributable, and concluded it
**must never ship as the reconciliation grain** (CLAUDE.md:632). This run reproduces **both figures
exactly** on the production module. The two were never connected because the benchmark core has no
production callers — *a capability in the benchmark lane is not a product capability*, and its
converse: **a defect found in the benchmark lane was never checked against the production lane.**

One difference is stated rather than smoothed over: the recorded payer-grain study also **fabricated
$12,798.80** (the M12 pause figure). The production observer does **not** — M12 is a correct silence
here and exposure outside planted mechanisms is $0.00. So the two implementations agree on recall and
true-positive money and differ on false positives; they are not the same code and this does not claim
they are.

**The remedy is already designed and is not a new idea.**
[`docs/architecture/OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md`](architecture/OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md)
holds it, and the 2026-10-20 investigation established the real prerequisite: not the contract field
but a **primary key** — `PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])`
with `sourceRef` account-grained, so the table cannot hold obligation-grained rows whatever the
contract declares. **The migration comes first.** Nothing here implements it; this run is the
evidence that it is worth doing and the measure of what it would unlock.

---

## 4 · Adversarial probes · 7 refused, each by its own mechanism

| probe | result |
|---|---|
| claiming more collected than the signatures substantiate | **403** |
| the author approving their own case | **403** |
| a recovery reason with no declared correction channel | **403** |
| a reason outside the closed vocabulary altogether | **400** |
| a second proof on a case that already has one | **409** |
| re-ingesting the same signed outcome evidence twice | **409** |
| evidence whose amount was altered after it was signed | **403** |

**Two of these were measured wrongly first, and the correction is the point.** Run *after* approval,
the over-claim and vocabulary probes both returned **409** — *this case already has a proof*, which
fires before either check. A reader would have concluded over-claiming is blocked; what was
demonstrated is that a **second proof** is blocked.

> **A probe refused for a different reason is not a measurement of the thing it names.**

They now run on a single-obligation case **before** its legitimate proof, and each returns its own
status. Same family as the configuration harness's *a probe the subject refuses is not a
measurement*, and the same remedy: look at what the refusal actually says.

---

## 5 · Three more defects, all in my own instruments

* **The truth parse read every cell as `undefined`.** `parseStrictCsv` returns
  `{rowNumber, cells}` keyed by column name; the scorer indexed the row as an array. The output was a
  tidy table of 19 blank mechanisms with UNKNOWN amounts that looked like a finding about the data.
* **The provable fraction read `0.00%` against a real 4.01%.** It accumulated inside the
  per-mechanism loop, so when the parse broke and nothing matched it reported a figure that cannot be
  reached from the product's own output. It is a property of the plan and is now computed from the
  plan.
* **The queue read zero from a 200 that carried nine.** The route returns a bare array and the
  harness guessed `{candidates: [...]}`. An empty queue is a legitimate state, so a shape assumption
  that reports one is worse than an error.

---

## 6 · What this does NOT establish

No customer, no real invoice, no real settlement, no bank, no institution verified. The signing key
is generated per run by the harness and discarded, so "independent" means *signed by a key in NH's
registry* and nothing about who holds it. The two proofs are real frozen proofs over synthetic
evidence: **`SYNTHETIC_VALIDATED`**, and the separation from `REAL_CUSTOMER_PROVEN` is maintained in
the harness's own output rather than only in prose.

Real-world dependencies are unchanged and listed separately in
[`FIRST_REAL_MONEY_PROOF_V1.md`](FIRST_REAL_MONEY_PROOF_V1.md) §7.

---

## 7 · Commands

```bash
npm run pilot:company        # the full loop, end to end, on a disposable database
npm run pilot:company:score  # blind score against the frozen ground truth
npm run pilot:company:plan   # the coverage split, both frozen packages
```

Each refuses a `DATABASE_URL` that does not name a disposable database. The PROVEN gate, every
contract, every version constant and both frozen packages are **untouched**.
