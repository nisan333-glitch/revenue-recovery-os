# Financial trace — one obligation, end to end

Issue #18, Priority 3. Baseline `99d091c` (CI 6/6, run 42177005443); pre-registration `f706202`.

**What this slice answers.** The owner's goal is *a product able to present reproducible financial
evidence, not just a screen showing amounts*. A screen showing `$600.00 returned` is not evidence: the
reader cannot tell which records the figure came from, which stages production code actually executed,
which inputs NH itself produced, or whether anyone outside NH ever asserted the settlement. The trace
produces that answer as data — ten ordered stages, each naming the table its facts came from, each
carrying two class fields, with a canonical form a reader re-derives with `sha256sum`.

---

## 1 · The governing rules this slice establishes

> **A stage carries TWO class fields and they are never collapsed.** `executionClass` says whether real
> production code ran; `inputClass` says who produced the input. A stage can be `EXECUTED` and
> `SIMULATED` at once — nine of the ten are — and reporting only the first half is how a demo gets
> mistaken for a pilot. The owner's three words map on exactly: *simulated* → `inputClass: SIMULATED`,
> *executed* → `executionClass: EXECUTED`, *attested* → `inputClass: ATTESTED`, which **nothing in this
> build reaches**.

> **Revenue Returned is WITHHELD, and the verdict is derived from the shape of the record.** An Ed25519
> signature verifying establishes that the payload was signed by a key in NH's configured trust registry
> and **nothing about who holds that key**. `SourceReceipt` records `method`, `keyId`, `issuedAt`,
> `verifiedAt`, `payloadSha256`, `signedPayload`, `signature` and `publicKeyPem`; `SourceTrustKey`
> records `keyId`, `sourceSystem` and `publicKey`. Not one field names a holder, a provenance channel or
> an issuing system — so an NH-generated fixture key and a customer's system-of-record key are
> **indistinguishable once verification has succeeded**. It is explicitly **not** a keyId string match:
> the demo key happens to be named `SYNTHETIC-DEMO-billing-…`, and *a term is not a claim*. A test
> asserts the absence at the type level, so the verdict flips on its own the day a holder field exists.

> **Every applicable reason is reported, not the most specific one.** `revenueReturned.codes` is a list.
> The build-level reason is pushed **first** and is always present, because a case-level reason that
> displaced it would make a general limitation look like one case's problem — and then vanish when that
> case's problem was fixed.

> **A ledger of statements is not a ledger of money.** `SOURCE_STATED` is declared non-additive and
> reports `NOT ADDITIVE — n separate statements`. Found by running the command, not by reading it: the
> first form printed `SOURCE_STATED: $5,700.00`, the expected amount plus the billed amount plus the
> residual plus each observation plus the stored figure plus the evidence amount — six statements about
> one obligation, several restating each other, summed into a figure no record asserts. **A trace built
> to prevent that kind of number must not print one itself.**

> **An aggregate of nothing established is not zero.** A ledger whose every figure is `null` reports
> `NOT ESTABLISHED`, not `$0.00`. The accumulator starts at the first established figure rather than at
> a zero — the "not computed is not zero" rule applied inside an aggregate, found by a renderer test.

> **One lane boundary is kept rather than borrowed.** `PROVENANCE_CHANNELS` already records that the four
> channels reaching `AUTHORITY_VERIFIED` are unimplemented, but that catalogue governs the *customer-data
> readiness* lane and settlement verification is the *proof* lane. Reading one lane's fact as the other's
> is the mistake already on record twice here. The proof lane's verdict is derived from the proof lane's
> own types; the readiness catalogue is corroboration, labelled as a different lane.

---

## 2 · What the trace reports, on a case that really reached a frozen proof

Run on the real path end to end (`npm run trace:seed` then `npm run trace:case`):

| # | Stage | Status | execution / input | Figure |
|---|---|---|---|---|
| 1 | SOURCE_OBLIGATION | ESTABLISHED | EXECUTED / SIMULATED | expected $1,600.00 · billed $1,000.00 · residual $600.00 |
| 2 | DETECTION | ESTABLISHED | EXECUTED / SIMULATED | detector statement $600.00 |
| 3 | CANDIDATE | ESTABLISHED | EXECUTED / SIMULATED | — |
| 4 | REVIEW | ESTABLISHED | EXECUTED / SIMULATED | — |
| 5 | RECOVERY_CASE | ESTABLISHED | EXECUTED / SIMULATED | at risk $600.00 (OBSERVED_EXPOSURE) |
| 6 | BASELINE | ESTABLISHED | EXECUTED / SIMULATED | $100.00 (BASELINE) |
| 7 | **PROPOSED_CORRECTION** | **REFUSED** | **NOT_IMPLEMENTED** / NOT_ESTABLISHABLE | — |
| 8 | CORRECTION_RECORD | ESTABLISHED | EXECUTED / SIMULATED | every amount observed; no corrected figure offered |
| 9 | **SETTLEMENT_EVIDENCE** | **REFUSED** | EXECUTED / SIMULATED | $700.00 as stated |
| 10 | PROOF | ESTABLISHED | EXECUTED / SIMULATED | $600.00 (PROVEN_REVENUE_RETURNED) |

**And the verdict: `REVENUE RETURNED · ESTABLISHED: NO`** — with the proof chain's own $600.00 carried
beside it for audit, withheld under `REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED`. The proof is
internally valid, separation of duties held, the baseline was locked before the outcome was known, and
the figure is still not money the business got back.

---

## 3 · The six failure scenarios, and the two whose pre-registered outcome did not happen

| | Scenario | Pre-registered | Measured |
|---|---|---|---|
| **F1** | negative residual | REFUSED · `NEGATIVE_RESIDUAL_NOT_EXPOSURE`, exposure null | **as pre-registered** |
| **F2** | duplicate / replay | `REPEATED_IDENTICAL_OBSERVATION`, exposure counted once | **as pre-registered** |
| **F3** | account aggregate | gate refuses `OBLIGATION_COVERAGE_IS_AGGREGATE` | **as pre-registered** |
| **F4** | unresolved reference | gate refuses `OBLIGATION_FACTS_INCOMPLETE` | **the scenario cannot be constructed** |
| **F5** | mismatched arithmetic | gate refuses `OBLIGATION_FACTS_INCONSISTENT` | **the scenario cannot be constructed** |
| **F6** | no double counting | five ledgers, no sum | **as pre-registered, by a different instrument** |

**F1 found a real hazard that was not known before this slice.** `assertCandidateSignal` requires
`amountAtRiskMinor >= 0` and requires `residualMinor` to equal `expectedMinor − billedMinor`, and
`recovery_cases_amount_valid` requires the stored at-risk amount to be non-negative — but **nothing
requires the at-risk figure and the obligation coverage to agree, and nothing refuses a negative
residual.** So a candidate carrying a positive $600.00 at risk beside coverage saying the company
over-billed by $600.00 passes every existing check and is promoted into a case. The trace re-derives the
sign and refuses to report exposure for it, preserving all three source figures. Whether the *detector*
should refuse such a signal is a contract decision with an owner; it is reported, not patched.

**F4 and F5 are stronger than pre-registered, and the deviation is recorded rather than the
pre-registration rewritten.** Three independent defences sit in front of the gate, each measured:

1. `assertCandidateSignal` refuses to **create** either defect.
2. A row **inserted directly** — the database imposes no schema on the signal json — cannot be
   **promoted**: the promotion path re-asserts the signal. **My first guess was wrong and measurement
   corrected it:** I expected the refusal at review. The review is **accepted** and the refusal lands at
   promotion, so an operator can accept a candidate that can never become a case and learns so only at
   promotion. Reported as an observation; moving where a governed refusal fires is not this slice's call.
3. A **valid** candidate cannot be corrupted afterwards — `agent_case_candidates` is append-only by
   trigger, and the `UPDATE` is refused.

So the gate's two branches are unreachable from the database. They are still exercised, purely, against
the predicate the gate delegates to — *unreachable from the database* is not reported as *untested*.

**F6 changed instrument, and the reason is worth keeping.** The first form searched the payload for
cross-ledger sums. It failed on `80,000`, which is `60,000 + 20,000` **and** a legitimate observed
amount — a string search cannot tell a sum from a record. The load-bearing check is therefore the
**positive** one: every figure the trace reports is a value that exists in a record, or the one
documented derivation. A summed figure would appear as a value no record holds. The narrow negative
survives for the four sums that do not collide, with its limit stated in the test.

---

## 4 · A defect in my own fixture, and the lesson that generalises

The Correction Ledger journey dropped to **11/14** on a database that had run the whole suite. The cause
was `scripts/seed-ledger-observations.ts` from the previous slice: it wrote the deliberately-tied pair
with `max(event_sequence) + 1000` **over the whole table**. On a database where another test had planted
a sequence near the safe-integer ceiling, that exceeded `Number.MAX_SAFE_INTEGER` and
`observationsFromRows` **correctly refused the entire boundary** — the journey read zero records and
three checks failed against a product behaving exactly as designed.

The explicit sequence was never needed: two signals in **one** task result inherit that one event's
sequence whatever its value, which is precisely what makes them tied. Removed; the journey is **25/25
on the polluted database**, which is a stronger result than it had before.

> **A fixture that computes a value from the whole table's state behaves differently depending on every
> other test that ever ran against that database.** And this hid in CI *because* CI's database is nearly
> empty — the journey job runs migrations and the journeys and nothing else. So the inverse of *a test CI
> never runs is not a guard* also holds: **a test that has only ever run against a pristine database is
> not a guard against a real one.**

**A second observation, reported not fixed.** `verify:registers` exits 1 with *20 of 466 records FAILED
integrity* on that same shared database — because `admissionPolicyTamperEvidence.test.ts` **deliberately
plants mismatching rows** to prove the gate refuses them. On a fresh database with only migrations and
the journey, exactly CI's shape, the sweep is clean at exit 0. The sweep is not safe to run against a
database that has executed the tamper-evidence suite, and CI is unaffected.

---

## 5 · What is NOT claimed

That a billing correction was issued — stage 7 reports `NOT_IMPLEMENTED` and `BillingCorrection` remains
a `RecoveryReason` label a proof carries, with execution specified in
[`BILLING_CORRECTION_EXECUTION_SPEC_V1.md`](BILLING_CORRECTION_EXECUTION_SPEC_V1.md) and blocked on the
owner's S-DUP-4 precedence decision. That money was collected — no independent source has ever signed
anything. That any observed amount became Revenue Returned. **Every figure is synthetic**, and the
settlement key is generated per run by the harness, which is exactly why stage 9 refuses.

**The PROVEN gate does not yet consider an unresolved billing correction.** A case carrying
`CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED` can still reach a frozen proof on this build: the trace
reports both facts side by side and does not patch the gate, because that conjunct is ChatGPT's
assignment under Issue #18.
