# Final synthetic financial validation — consolidated report

**Status: `SYNTHETIC_PARTIALLY_VALIDATED`. Recommendation: NO-GO for acceptance, GO for the push.**
Reported separately from `REAL_CUSTOMER_PROVEN`, which remains **not reached and not approached**.
No synthetic amount in this document is real revenue.

Date: 2026-11-27. Branch `claude/pilot-reconciler-demo-v1`.

| | SHA | state |
|---|---|---|
| remote HEAD | `2dee2e1` | **CI RED — 2 of 6 jobs failing** |
| local HEAD | `67a558e` | all gates green |
| unpushed | `1b5ca9b`, `62d132f`, `67a558e` | awaiting SHA-specific approval |

---

## 1 · Phase 1 — the push happened; CI was not verified, and it was red

The four commits `641424b`, `e9a0618`, `4e4797f`, `2dee2e1` are on the remote. **The required
post-push CI verification had not been done.** Run #358 at `2dee2e1`:

| job | result |
|---|---|
| EP-19 Browser journey | pass |
| EP-10 Docker pilot smoke | pass |
| Frozen packages + intake verifiers | pass |
| Coordination status | pass |
| **EP-9 Postgres-backed verification** | **FAIL** — `test:ep2` |
| **Invariants + strict build** | **FAIL** — server test typecheck ratchet |

`c4fce22` was the last green run, so **both failures are mine**, and `2dee2e1`'s own commit
message claims "the ratchet ... green". **It was not**, and it is not green at that commit by any
run I can reproduce now. I either never ran it or read another gate's result as this one. Recorded
first because the rest of this report is only worth as much as that kind of claim.

## 2 · Failure 1 — the ratchet: 34 errors, and one of them was a gate I had switched off

Twenty-one were mechanical: `existsByDedupeKey` became **required** on `CaseCandidateStore`, so
every hand-rolled fake broke. Required **stays** required — an optional field lets an existing
caller keep its old behaviour by saying nothing. The fakes now **delegate** to the real in-memory
store they wrap, or answer **from the list they hold**, or **throw**. None returns a bare `false`:
a fake answering *"no aggregate covers this payer"* on no evidence would silently disable the
cross-case overlap gate in every test using it.

The other thirteen were worse than a typo. My own test declared **`minimumAmountAtRiskMinor`,
which exists nowhere in this repository.** The real field is `economicThresholdMinor`, and
`admission.ts:177` reads `signal.amountAtRiskMinor < policy.economicThresholdMinor` — `undefined`
makes that always false, so **all ten of those tests ran with the economic admission gate disabled
and passed.** No runtime assertion could have caught it. *An excess property that looks like a
governed term is worse than a missing one, because a reviewer believes it.*

## 3 · Failure 2 — a real concurrency defect in the candidate insert

`CONCURRENT IDENTICAL obligation claims create ONE row, not two` failed with a raw Postgres 23505
escaping `CaseAdmissionService.submit`: `Key (candidate_id)=(CC-…) already exists`. Not flaky —
the signature of a race.

`insertCandidateIfAbsent` wrote `ON CONFLICT (dedupe_key) DO NOTHING`, under a comment calling that
*the* dedup guarantee. `agent_case_candidates` carries **three** unique constraints —
`PRIMARY KEY (candidate_id)`, `UNIQUE (dedupe_key)`, `UNIQUE (candidate_id, boundary_id)` — and an
arbiter covers **one** index; every other unique violation is raised. So the advertised idempotency
held sequentially and broke under concurrency.

**The three constraints are one event**, which is what licenses dropping the arbiter:
`caseCandidateId` is `CC-` plus the first 24 hex of the dedupe key, so `candidate_id` is a *pure
function* of `dedupe_key`; `boundary_id` is in the preimage and re-checked; and
`assertCaseCandidateIdentity` enforces both before the insert. Which index reports the collision is
index-insertion order — **which is exactly why it was green locally and red in CI on one commit.**

Proved deterministically in SQL against the real table, because ten green runs after the fix prove
nothing (the test was green locally before the fix too): with the arbiter, a conflict arriving on
the primary key raises the **same 23505 CI reported**; with no arbiter the identical insert is
suppressed and one row remains; and a **CHECK violation is still raised either way**, so nothing
was traded for the atomicity.

**And the mutation survived my new tests.** Restoring the defect left **nine runs across both
suites green**, because the SQL cases build their own INSERT strings and never read the production
clause. The load-bearing guard is therefore **structural** — it reads the statement the function
actually sends, fails on the defective form, and a second case proves the predicate discriminates
so the first cannot be vacuously true. *A guard must read the construct it is asking about.*

## 4 · Phase 5 — the production route, and a governance refusal reported as the wrong thing

**My `2dee2e1` claim that the production approval path citing a settlement "remains NOT EXERCISED"
was wrong.** `proofServiceSettlement.postgres.test.ts` was already 44 passing tests over the live
`approve()`. I observed that the pilot harness cites no settlement — true — and concluded nothing
drives the route — false.

What was genuinely missing: **every citation that crossed HTTP ended in a refusal, and every
citation that reached a proof injected `deps`.** So the positive path had never crossed the wire.
Three cases now take **no `deps` at all** — flag, trust keys and digest key from the real
`process.env`, payer from the production resolver over source-signed evidence, body across
`approveProofSchema`, handler the one `app.ts:638` registers:

* **P5-1** — 201 over HTTP, proof frozen, `revenueReturned = collected − baseline`, ledger row
  naming that proof, digest recomputed under the **env** value.
* **P5-2** — a **rotated digest key refused at the route** (control 4, moved off the ledger unit
  test as the mandate requires), first proof untouched.
* **P5-3** — **rollback then retry** (control 5's missing half). The existing case proves the
  partial claim is *released* and never claims the money afterwards; release without a successful
  retry is indistinguishable from the arrival being **burned**, which would refuse a legitimate
  first claim forever.

**P5-2 found a pre-existing defect.** The refusal fired and misreported itself: the ledger's message
explains the table *"is append-only"*, and `errors.ts` mapped **any** `/append-only/i` message to
409 `immutable_record` — *"create a linked revision instead"* — for a condition whose own text says
it *"requires a governed rebuild, not a deploy"*. The money was correctly refused; **the remedy was
wrong.** Thirteenth recorded instance of a guard matching a **term** rather than a **claim**. Every
real trigger raises with the prefix `append-only: ` (six such raises against thirteen bare prose
mentions), so the mapper now keys on that, and `SettlementDigestKeyChangedError` is reported as
itself. Tightening alone would have produced a 500, so both halves landed together.

Four mutations, all caught. One earlier attempt was a **broken measurement, not a survivor** —
excision left invalid TypeScript, vitest printed *"No test files found"*, and a one-line summary
would have read as a pass; re-run with a 57-test control asserted on every pass.

Two of my own assertions were wrong, and the first matters: **`PROVEN` is not a stored `Proof.status`
at all.** The row says `Approved`; PROVEN is a *derived* case progress — exactly as the constitution
requires, *case status is derived from the append-only history, never stored.*

## 5 · Phase 6 — the measured result on the remediated tree

Identical to the pre-remediation run, to the cent. **That the two fixes moved no money is the
control, not a coincidence.**

| | |
|---|---|
| Revenue Opportunity (OBSERVED) | **$76,458.30** over 24 cases |
| Revenue Returned (PROVEN, synthetic) | **$68,812.48** over 24 cases |
| cases the proof gate refused | **0** |
| proof-eligibility coverage of detected exposure | **100.00%** (was 4.01%) |
| planted / accounted / **UNACCOUNTED** | $85,942.00 / $85,942.00 / **$0.00** |
| detected / attributed / **UNATTRIBUTED** | $76,458.30 / $76,458.30 / **$0.00** |
| fabricated money | **$0.00** at mechanism grain **and** unit grain |
| monetary precision | **100.00%** |
| the $7,645.82 gap | **is** the locked baselines at the harness's 10% — `Collected − Baseline` is the definition |

**Four kinds of money, never blended** (Phase 2, classified from the frozen truth's own words):

| pool | amount |
|---|---|
| MISSING_CASH (recoverable) | $77,257.30 |
| MISALLOCATED_RECEIVED (**already received** — never incremental recovery) | $6,096.00 |
| LIABILITY_OVER_BILLED (owed back) | $0.00 |
| COMPOSITE (several kinds, unsplit) | $2,588.70 |
| UNCLASSIFIED | $0.00 |
| **residual (must be $0.00)** | **$0.00** |

**Three recall definitions, each with its denominator and theoretical maximum:**

| definition | denominator | max | NH |
|---|---|---|---|
| 1 · TP / planted-total | $85,942.00 | 77.19% | 88.96% |
| 2 · TP / planted-detectable *(preserved)* | $66,342.00 | 100.00% | 85.70% |
| 3 · **missing-cash recovery recall** | **$57,657.30** | 100.00% | **98.61%** |

A 90% target is **only honest on definition 3**: definitions 1 and 2 both contain money the company
**already received**, so reaching 90% there would mean counting collected cash as recovery.
Definition 1's maximum is **below** 90% by construction.

The $799.00 shortfall on definition 3 is M18, and the per-unit diagnostic names it rather than
inferring it: both genuinely unbilled units read `REFUSED_UNMATCHED_IDENTITY` — refused by the
**taint rule**, not by pairing — and the money is **declared** in `refusedExposure` ($3,597.00 over
3 units, state `UNDETERMINED`). A refusal that reports itself is a different fact from a silent
miss, and my own frozen false-negative bucket counts both the same way. **That is a defect in my
ruler, and correcting it is a governed benchmark revision, not an edit.**

## 6 · Acceptance criteria — three fail, and one cannot be scored

| criterion | required | measured | verdict |
|---|---|---|---|
| monetary precision | ≥95% | 100.00% | **PASS** |
| missing-cash recovery recall | ≥90% | 98.61% | **PASS** |
| original recall metrics reported separately | — | 88.96% / 85.70% | **PASS** |
| evidence-supported proof eligibility | ≥90% | 100.00% | **PASS** |
| unsupported PROVEN claims | 0 | 0 | **PASS** |
| duplicate financial attribution | 0 | 0 | **PASS** |
| duplicate settlement | 0 | 0 | **PASS** |
| unexplained financial differences | 0 | $0.00 | **PASS** |
| full regression passes | yes | **locally yes, remote CI RED** | **FAIL** |
| every skipped test documented | yes | 6 named locally; **CI reported 9 and the delta is uninvestigated** | **FAIL** |
| frozen fixtures unchanged | yes | all byte-identical | **PASS** |
| **Phase 4** — aggregate retirement design | required | **not started** | **FAIL** |

**Full acceptance is therefore NOT declared**, on the mandate's own instruction: *do not declare
full acceptance if mandatory controls remain unexercised.* Control 6 — ACCOUNT_V1/OBLIGATION_V2
overlap at the money level — is exercised at the **ledger** and at the **service**, and **not** as
two cases promoted from candidates of different grains both citing one arrival through the route,
because the proof route never sees a candidate grain. The grain-independence of the settlement
digest is the reason the property holds; **that is an argument, recorded as an argument, not
counted as a verification.**

## 7 · Evidence — what actually ran, on a fresh isolated synthetic database

`npm run test` **2139 passed | 5 skipped** across 141/142 files · `npm run test:ep2` **1659 passed
| 6 skipped** across 122/122 files · `npm run test:journey` **200/200** · ratchet **0 errors / 0
files** as pinned · `typecheck:server`, `typecheck:scripts`, `check:purity`, `npm run build` clean ·
`pilot:verify` **242/242** · `readiness:control` **25/25** · `recon:verify`, `recon:ref:verify`,
`verify:evidence` green · harness freeze **6 scripts, composite `1daac2ab…08a23a`** · every frozen
artefact byte-identical, no ground truth modified, no threshold lowered.

The six skips are the pre-existing `authorityLedgerIntegrity.test.ts` entries labelled
*"PROPOSED · requires owner approval"* and *"requires a migration"*.

**Reported, not fixed: `verify:registers` is red against any database that has run the suite.** On a
never-used database: 0 records, exit 0, and the tool refuses to claim it verified anything. After
**one** `test:ep2` run on a fresh database: 462 records, **20 failing** — deterministic, 60 after
three runs. The tables are append-only, so *"changed after registration"* is impossible; the rows
were **written mismatched**, by `admissionPolicyTamperEvidence.test.ts` and
`registerIntegritySweep.test.ts`, which exist to prove the sweep catches exactly this. CI stays
green because its sweep runs against a database the suite never touches. Not caused by these
commits, and not fixed: teaching the sweep to ignore fixtures would weaken the one control it gives.

## 8 · Remaining blockers

1. **Remote CI is red.** The fix is local and unpushed; pushing needs SHA-specific approval.
2. **Phase 4 not started** — ACCOUNT_V1/OBLIGATION_V2 coexistence and safe aggregate retirement.
3. **The CI-vs-local skip delta (9 vs 6)** is uninvestigated.
4. **The frozen ruler's false-negative bucket** conflates *refused-and-declared* with *missed*.
   Correcting it is a governed benchmark revision with its own evidence and freeze.
5. **No institution is verified — not one.** The bank key is generated per run and discarded, so
   *"independently signed"* means signed by a key in NH's own register and nothing about who holds
   it. Every readiness level stays **PROVISIONAL** at a `SOURCE_NATIVE` ceiling.
6. **Nothing here is customer data.** No customer, no real invoice, no real settlement, no bank.

## 9 · Recommendation

**GO on the push** of `1b5ca9b`, `62d132f`, `67a558e` — the remote is currently broken and these
three are what repair it, with two genuine product defects fixed and nothing frozen touched.

**NO-GO on declaring synthetic acceptance.** Three mandatory criteria fail, one control is an
argument rather than a measurement, and the regression is only green on an unpushed tree.

**`SYNTHETIC_PARTIALLY_VALIDATED` · never `REAL_CUSTOMER_PROVEN`.** No observed amount became
Revenue Returned.
