# Pilot plan · one customer, one case, one auditable proof

**Status:** plan. Nothing in it has been executed, and the one code slice it names is not built.
**Date:** 2026-11-18, at `98b63a2`.

**The separation this document exists to hold:**

> **SYNTHETIC SUCCESS and REAL FINANCIAL PROOF are two different claims and are never reported as one.**
> Everything green in CI today is synthetic success: it establishes that NH's mechanisms behave
> correctly on data NH generated. A real financial proof establishes that a specific dollar left a
> specific customer's leak, was corrected, was collected, and can be re-derived by their CFO from two
> documents. **NH has the first and has never had the second.**

---

## 1 · Entry conditions

All six must hold before the pilot starts. Each is a fact someone can check, not a judgement.

| # | condition | owner | how it is checked |
|---|---|---|---|
| **E1** | The **two-extract intake route** exists and is exercised end to end in CI | NH | a CI job takes two extracts and produces a candidate |
| **E2** | A customer has supplied **both extracts** and the readiness report reads **L2 or better** | customer, NH verifies | `evaluateDataReadiness` on their real files |
| **E3** | The customer's billing system can **sign** an evidence claim, and NH's operator has registered the public key | customer's billing owner | a test signature verifies against the registered key |
| **E4** | **Two NH identities** exist with distinct governance roles, and a customer operator exists | NH + customer | the roles are assigned and separation of duties is live |
| **E5** | Secrets are in a secret store: `NH_RECONCILER_PSEUDONYM_KEY`, `NH_INGEST_SOURCE_REF_KEY`, `NH_EVIDENCE_SOURCE_KEYS` | NH, **owner-authorised** | present in the target environment and nowhere else |
| **E6** | A **DPA** and a **retention period** are agreed in writing | owner + customer | signed |

**Not entry conditions, and this is the change from previous plans:** a bank, a verified institution,
`NH_SETTLEMENT_DIGEST_KEY`, the settlement ledger migration, obligation-grained identity, and a
correction channel for any activation mechanism. All are deferrable — see
`docs/PILOT_BLOCKER_MAP_V1.md` §4.

---

## 2 · Minimum data required

Two files. Nothing else.

### Export A — the contract schedule (expectation extract)

Five required facts per row, one row per expected obligation:
the payer reference, the entitlement reference, the schedule-line reference, the period, and the
expected amount. `expected_amount` may be **blank** — that is an accepted UNKNOWN which preserves the
row; it is a missing **column** that is a fault.

### Export B — the billing export (invoice lines)

Six required facts per row, one row per invoice line:
the payer reference, the obligation reference, the invoice reference, the line amount, the date the
line was **raised**, and the credit flag.

> **Export B is INVOICES, not payments.** An unpaid invoice is exactly as useful to us as a paid one.
> A finance team that hears "settlement" and reaches for the cash-application system will export the
> wrong file.

### What the pilot dataset must additionally be, for the first case

- **One obligation per payer**, or the account-grained candidate merges two into one. The grain
  disclosure is rendered either way, but a merged candidate makes the first proof harder to read.
- **At least one genuine under-billing** — a real shortfall the customer did not know about, or knew
  about and had not acted on. A dataset with no shortfall yields **$0.00 detected**, which is a
  correct answer and a failed pilot.
- In **one currency**. A row in another currency is excluded rather than converted.

---

## 3 · Success metrics

Three tiers, reported separately and never summed.

### Tier 1 — detection (business)

| metric | target | how measured |
|---|---|---|
| D1 | the reconciliation produces **≥ 1** `UNDER_BILLED`, unpaired, priced candidate | the candidate queue |
| D2 | the customer's finance owner agrees **≥ 1** candidate is a real shortfall they would pursue | their written confirmation |
| D3 | **zero** candidates the customer identifies as fabricated | their review of every candidate |
| D4 | refused and UNKNOWN units are **reported, not zeroed**, and the customer understands the figure | the refused-exposure read |

**D3 is the one that cannot be traded.** A single fabricated candidate costs more credibility than ten
found shortfalls earn.

### Tier 2 — the loop (product)

| metric | target |
|---|---|
| L1 | one candidate is promoted to a Recovery Case by an authorised operator, and the other candidates stay pending |
| L2 | baseline locked **before** any outcome exists |
| L3 | the corrective invoice is raised by the customer and **signed** by their billing system |
| L4 | the case reads `INTERVENED`, and Revenue Returned reads **NOT COMPUTED** — a fix is not a recovery |
| L5 | the collection is **signed** by their billing system; the case reads `EVIDENCED`, and Returned still reads **NOT COMPUTED** — evidence is not money |
| L6 | an **approver who is not the author** freezes the proof |
| L7 | the case shows the **identified exposure and the proven return as two different numbers** on one screen |

### Tier 3 — the proof (financial, and the only one that is new)

| metric | target | how it is proven |
|---|---|---|
| **P1** | Revenue Returned = `Collected − Baseline`, and the customer's CFO **re-derives the same figure from their own two documents** — the corrective invoice and the bank statement line | their written confirmation of the figure, independently |
| **P2** | the proof names the model version, the policy version, the threshold, the baseline method, the evidence references and the calculation used at approval | the frozen `Proof` record |
| **P3** | the figure is reproducible from the frozen record **after** the pilot, with no recomputation | re-read the proof |
| **P4** | the figure is labelled **PROVISIONAL** at a `SOURCE_ATTESTED` ceiling everywhere it appears | the readiness report and the CFO view |

**P1 is the pilot.** Everything else is scaffolding for it.

---

## 4 · How Revenue Returned is proven without double counting

Four independent mechanisms, each of which must hold. None is a convention.

1. **The baseline is locked before any outcome exists.** `EstablishBaseline` precedes `IngestEvidence`
   in the lifecycle, and a baseline at or above the exposure is refused — it would leave no room for a
   recovery. So the subtrahend cannot be chosen after the result is known.
2. **One candidate → one case, enforced twice.** `sourceCandidateId` is UNIQUE on the case root, and
   the candidate leaves the queue on promotion. Two independent mechanisms, and the EP-19 journey
   exercises both.
3. **Collected comes only from signed outcome evidence**, summing to at least the claim
   (`outcomeEvidence.ts`). A claim above the evidence is refused; a record stating no amount is **NOT
   COMPUTED, never zero**, so an absent contribution cannot be invisible in the arithmetic.
4. **If a settlement is cited at all, one arrival is counted once** by a unique index on the keyed
   digest, inside the proof's own transaction — not a read-then-check. Proved under two simultaneous
   approvals.

**And the account-grain disclosure is rendered on the case**, so a reader is told that the identity
cannot distinguish two obligations of one account, and whether a second observation was absorbed.
That is reported, not silently assumed away.

**What is still not prevented, stated because the CFO will ask:** if the customer's team pursues the
same shortfall outside NH and the money arrives once, NH's proof and their own tracking both describe
it. NH counts it once; the *organisation* may count it twice in two systems. That is a reporting
discipline question for the customer, and NH cannot close it.

---

## 5 · PROVEN criteria — the exact bar

A proof is minted only when **all** of these hold. Verified against the code, not summarised from
memory.

| # | requirement | enforced by |
|---|---|---|
| 1 | the case has a governed root and a locked baseline | `recoveryCaseStore`, lifecycle |
| 2 | the approver is **not** the author or the operator who opened it | `enforceSeparation` |
| 3 | the `recoveryReason` is in the closed vocabulary **and** has a declared correction channel | `correctionMapping` — today only `BillingCorrection` |
| 4 | an **executed correction** exists: signed, not beneficiary-controlled, `independent` | `executedCorrection.ts:105` |
| 5 | **≥ 1 outcome-role** evidence record, signed, `independent`, stating a whole amount in the proof's currency, summing ≥ the claimed collected | `outcomeEvidence.ts:97-160` |
| 6 | confidence ≥ `PROOF_THRESHOLD`, positive uplift, and a stated reason — for the **Auditable** subset | `invariants.ts`, `outcomes.ts` |
| 7 | if settlements are cited: verified under a registered, in-force key, final, after the correction, matching invoice, payer, currency, amount, and not already counted | `externalSettlement.ts`, `settlementClaim.ts` |

**Requirement 7 is skipped when nothing is cited.** That is the whole reason a bank is not an entry
condition.

---

## 6 · Responsibility per stage

| stage | NH | customer | owner's approval needed? |
|---|---|---|---|
| build the two-extract route | **NH** | — | **yes** — it is a code slice |
| supply both exports | — | **data owner** | no |
| judge readiness | **NH** | — | no |
| register the billing signing key | **NH steward** | billing technical owner provides it | **yes** — a key enters an environment |
| run the reconciliation | **NH** | — | no |
| review candidates | — | **finance owner** | no |
| promote one candidate | — | **operator** | no |
| lock the baseline | — | **operator** | no |
| raise the corrective invoice | — | **finance / billing** | no |
| sign the correction and the collection | — | **billing system** | no |
| approve the proof | **approver**, never the author | — | no |
| state the figure to anyone outside | — | — | **yes** |

---

## 7 · Risks and stop conditions

### Risks, ranked by what they cost

| # | risk | likelihood | cost | mitigation |
|---|---|---|---|---|
| R1 | the dataset contains **no real shortfall**, so the pilot detects $0.00 | **medium** | the pilot ends with a correct answer and no story | qualify the dataset before starting: ask whether they have ever found an under-billing by hand |
| R2 | the billing system **cannot sign** | **medium–high** | no `PROVEN` at all; the pilot stops at `EVIDENCED` | establish E3 before anything else; it is the only external dependency on the critical path |
| R3 | a candidate the customer calls **fabricated** | low | credibility, which is the asset | every refusal and UNKNOWN is reported; the pairing hold and the ambiguity refusal exist precisely to avoid this |
| R4 | the account grain **merges** two obligations and the first case reads oddly | medium | confusion, not a wrong figure | require one obligation per payer in the pilot dataset; the disclosure renders either way |
| R5 | the proof is quoted **without** its PROVISIONAL qualifier | **high** — it is what everyone wants to do | a synthetic-grade claim presented as audited | the verdict vocabulary caps at `BEHAVIOUR_CONFIRMED · PROVISIONAL`, and a test asserts the string contains neither `VERIFIED` nor `ACCEPTED` |
| R6 | the customer's own team **also** counts the recovery | medium | double counting in *their* reporting, not in NH's | state it in writing at the start (§4) |
| R7 | a secret is placed in a repository or a CI variable | low | severe | secret store only; nothing in this plan requires a key in code |

### Stop conditions — any one halts the pilot and is reported before anything else

1. Two **attested** records disagree about who the payer is.
2. A governed row stops matching its own witness.
3. An arrival is refused as already counted when nobody expected it.
4. A real customer identifier appears in a log, a refusal or a report.
5. A proof reaches `PROVEN` by a path nobody expected.
6. **Anyone proposes widening a control to make the pilot pass.** A correct refusal is a result.
7. The customer asks NH to state what was owed from the billing side, or to mark a payment as a
   duplicate. Both are refused by contract.

---

## 8 · What a green pilot establishes, and what it does not

**Establishes:** that NH found a real shortfall in a real customer's book, that a correction was
raised and collected, that the money is counted once, that the figure is `Collected − Baseline` from
signed evidence under a baseline locked beforehand, and that the customer's CFO re-derived the same
number from their own documents.

**Does not establish:**

- **Not** that the attesting system is independent of the beneficiary. It is the customer's own
  billing system. The figure is `SOURCE_ATTESTED` and **PROVISIONAL**.
- **Not** that NH's detection is broad. One detector family, one mechanism, one currency.
- **Not** `AUTHORITY_VERIFIED`, which needs a corroborating party not party to the claim.
- **Not** a repeatable outcome. One case is one case.
- **Not** any figure beyond the one proven. Identified exposure stays in the Revenue Opportunity
  ledger and is never summed with it.

---

## 9 · The one slice this plan requires

**Two-extract pilot intake.** A route that accepts an expectation extract and a billing extract for a
boundary, validates both with the validators that already exist, records the readiness level, and
enqueues **one** reconciliation task.

- **No** new detector, **no** monetary logic, **no** change to the reconciliation core, **no** contract
  version change, **no** change to the `PROVEN` gate, **no** production migration.
- The validators, the readiness evaluator, the observer, the candidate store and the queue all exist.
- It is the only thing between the engine and a customer's files.

**Not built.** It needs the owner's approval, like any code slice.
