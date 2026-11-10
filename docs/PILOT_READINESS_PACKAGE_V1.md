# REVENIQ — operational pilot-readiness package V1

**Date:** 2026-11-10 · **Measured on:** `5f48a75` · **Local only; nothing pushed, deployed or migrated.**
**Status:** this is the operational package. The engineering verdict is in §10.

---

## 0. The three financial categories, kept apart from the first page

Every number in a pilot belongs to exactly one of these, and the pilot agreement must name which.
**They are never summed into a single "recovery" figure.**

| Category | What it means | What NH can do today |
|---|---|---|
| **Corrected billing** | An invoice was re-issued or amended. The *bill* changed. | **Detected and provable.** A source-attested `corrective_invoice_issued` / `billing_corrected` record is required before any proof. |
| **Recovered cash** | Money arrived in the company's bank. | **Detected and provable**, via `invoice_paid` / `payment_received`. This is the only input to **Revenue Returned** = `Collected − Baseline`. |
| **Attributable financial outcome** | The cash arrived *because of* an intervention. | **NOT established, by construction.** `causationEstablished = false`, and no validated causal standard exists. See §4b. |

> A corrected bill is not cash. Cash is not attribution. A pilot that reports one number has blended all
> three, and the blend is the thing this product exists not to do.

## 1. Minimum customer data requirements

Two CSV exports. The full governed request, templates, field dictionary and worked examples already ship
in [`docs/pilot-intake/`](pilot-intake/) and are **generated from the field specs**, so a column cannot
appear in a template without appearing in the contract that validates it.

| Export | What one row is | Required facts |
|---|---|---|
| **A · Expectation extract** (`nh.expectation-extract@1.1.0`) | ONE expected obligation | 5 |
| **B · Billing export** (`nh.billing-extract@1.0.0`) | ONE invoice line | 6 |

**The one field that matters most, and why.** `obligation_ref` on the **billing** side — the reference
stating which contract obligation each invoice line settles. In a controlled experiment on synthetic data
it was the only field that increased claimable money, with no fabricated findings. **The figure is
withheld on purpose:** a number from data we generated would read as a forecast for the customer's book.

**It must be a mandatory-in-practice pair with `schedule_line_ref`** on the expectation side — proved by
measurement, not argued: dropping either one, as an absent column *or* as blank cells, takes readiness
from *exact money* down to *structurally valid*.

**Supplier is not issuer.** `obligation_ref` arrives in the billing export, but its *value* is the
contract system's. A billing team supplying its own internal key defeats the field's purpose.

**Export B is INVOICES, not payments.** The column names `invoice_raised_at` / `invoice_line_amount` say
so. A finance team that hears "settlement" and reaches for the cash-application system has exported the
wrong file — and an unpaid invoice is exactly as useful to us as a paid one.

**Not requested, deliberately:** `expected_amount` on the billing side (billing stating the expectation
is billing auditing itself), `invoice_ref` on the contract side, and `is_duplicate` (duplication is a
conclusion NH must reach, never a field the customer supplies).

## 2. Data access and authorization requirements

| Requirement | Mechanism that exists today |
|---|---|
| Boundary isolation | Every governed call takes an `ActorContext` carrying `boundaryIds`; `requireBoundaryAccess` refuses cross-boundary reads. No request parameter can widen it. |
| Role separation | Five roles, no administrator role: `author`, `operator`, `approver`, `verifier`, `steward`. |
| The beneficiary cannot approve | `author`/`operator` hold `Author`, `EstablishBaseline`, `Intervene`, `IngestEvidence`. **Neither holds `Approve`.** Separation of duties is enforced server-side, and an actor who only ever *revised* a proof is refused `Verify`. |
| Governance cannot count | `steward` holds `Flag`, `Halt`, `Exclude`, `ActivatePilotPolicy` — and **no path to a number**. |
| Customer may propose, never activate | The customer side may propose an admission bar or analysis terms; activation requires a different identity. *A bar you set for yourself is the first input to the number you benefit from.* |
| Audit reads are gated | `AuditRead` is held by `approver`, `verifier`, `steward` only. |

**Stated rather than hidden:** a case's own operator does **not** hold `AuditRead`, so a beneficiary
cannot read their own case's proof provenance. Widening that is a governance change with an owner.

**What the customer must grant:** read-only export rights on the two source systems, and one named
accountable **role** (not a person) to sign the provenance attestation. Nothing else. NH requires no
write access to any customer system, and performs no action in one.

## 3. Security and privacy safeguards

| Safeguard | State |
|---|---|
| Pseudonymous identifiers | `sourceRef` is `hmac-sha256:<64 hex>`, never a raw identifier, with the key id recorded. A missing key id is refused at emission rather than assumed current. |
| Source attestation | Ed25519 signatures over evidence payloads (`sourceVerification.ts`). Evidence whose amount was altered after signing is refused **at ingestion**. |
| Private-key separation | In the browser journey the API process receives only the public half; a page able to mint a source attestation would answer the trust invariant the wrong way. |
| Append-only history | Authority events, admission decisions, analysis terms and task events are append-only by database trigger, with no purge path. |
| Register tamper-evidence | Both governed registers are verified against their own stored witness **wherever they are resolved for use**, not trusted as stored. |
| Diagnostic output | The absorption diagnostic and the readiness report print **codes and our own labels only** — never a `sourceRef`, amount or digest. Proved by performing the leak and asserting it does not reach the report. |
| Input purging | `PurgeAssessmentInput` exists and is steward-only, with bounded auditable purging. |
| TLS / transport | TLS-termination contract, verified Postgres TLS, non-root container image, least-privilege CI. |

**The ceiling, stated plainly: nothing reaches `AUTHORITY_VERIFIED`.** Readiness runs to
`SOURCE_ATTESTED` at best and every level stays **PROVISIONAL**. See §9.

## 4. Financial baseline and measurement methodology

### 4a · The method

1. **Baseline locked before the outcome is known.** `EstablishBaseline` is author-only and the snapshot is temporally validated; a baseline established after the result would make the beneficiary the author of the number.
2. **Exposure is OBSERVED, never money.** The detector's at-risk figure is Revenue Opportunity. It is refused outright if it contradicts the obligation coverage it claims to describe (`AT_RISK_CONTRADICTS_COVERAGE`).
3. **Revenue Returned = `Collected − Baseline`,** computed by the kernel from signed outcome evidence and the locked baseline — never from the exposure figure. A claim exceeding what the evidence substantiates is refused `OUTCOME_EVIDENCE_INSUFFICIENT`.
4. **Auditable Revenue** is the CFO-grade subset: recovered + reason + `confidence ≥ PROOF_THRESHOLD` + positive uplift. An exclusion or provenance gap removes an amount from Auditable while the proven history is preserved.
5. **Excluded Recovery is mandatory** and cannot default to zero.
6. **Once approved, the proof is frozen** — model version, policy version, threshold, baseline method, evidence references and calculation, all captured at approval. A refund, reversal or dispute creates a **new linked revision**, never an overwrite.
7. **`null` means NOT COMPUTED, never `$0.00`.** A case with no proof, a case whose proofs were all reversed, and a case id that never existed are three different situations and read differently.

### 4b · What the method does NOT establish

**Attribution.** `causationEstablished = false` is a literal type that cannot express a positive claim.
The pilot may report that a correction was executed and that money arrived afterwards. It may **not**
report that the money arrived *because of* the correction. Granting that needs a separately validated
causal standard, which does not exist.

**Consequence for the pilot agreement:** the deliverable is *"$X of corrected billing, $Y of recovered
cash, both evidenced by sources the beneficiary cannot alter, attribution not claimed."*

## 5. Pilot success and failure criteria

Pre-registered here, before any customer data exists, so the result cannot be scored against a bar moved
afterwards.

### Success — all four must hold

| # | Criterion | How it is measured |
|---|---|---|
| S1 | Both exports reach **L2** or better (`MONETARY_RECONCILIATION_POSSIBLE`) | `readiness:control` on the customer's real files |
| S2 | At least one obligation reaches **PROVEN** through the governed path, author ≠ approver | a frozen `Proof` row with `revenueReturnedMinor > 0` |
| S3 | Every refused case carries a **named code and stage** | the acceptance-journey report shape, applied to real cases |
| S4 | **Zero** fabricated findings — no proof survives review as not-owed | customer confirmation per proven case |

### Failure — any one ends the pilot as NOT PROVEN

| # | Criterion |
|---|---|
| F1 | Either export cannot reach L2 (then the finding is a **data** finding, not a product failure) |
| F2 | A proof is minted that the customer disputes on the facts |
| F3 | Two obligations of one account are merged into one claim |
| F4 | A figure is reported that blends exposure with proven return |

**Explicitly NOT a success criterion: the size of the number.** A pilot that correctly finds $0 because
billing did its job is a **correct result**, and treating "a population we can now reach" as "money we
will find" is counting a forecast as proof.

## 6. Required customer approvals

| # | Approval | From whom |
|---|---|---|
| C1 | Export A and B may be produced and sent to NH | Data owner for each source system |
| C2 | The provenance attestation, signed by an accountable **role** | That role |
| C3 | The named `approver` identity — who may freeze a proof, and that it is **not** the person who authored the case | Finance leadership |
| C4 | The analysis terms (cut-off, stall threshold, currency) activated by a governance identity distinct from the proposer | Governance owner |
| C5 | Acknowledgement that attribution is **not** claimed (§4b) | Pilot sponsor |
| C6 | Pseudonymisation approach, or acceptance of raw identifiers inside the boundary | Privacy / security owner |

## 7. Rollback and incident procedures

| Situation | Procedure | Mechanism |
|---|---|---|
| A proof must be withdrawn | **Never deleted.** A new linked revision supersedes it; the original stays readable. | `Proof` chain with `previousProofId` |
| A case must be stopped mid-flight | `Halt` — steward-only, atomic, enforced on **every** governed mutation | `caseHalt` |
| An amount must leave the CFO ledger | `Exclude` — the amount leaves Auditable while the proven history is preserved | `trustGate` |
| A governed definition is found tampered | The row judges nothing and may not be put in force; governance may still **withdraw** its authority | register verification; `FROZEN`/`RETIRED` still permitted |
| Customer input must be destroyed | `PurgeAssessmentInput`, steward-only, bounded and auditable | `pilotInputRetention` |
| A migration must be undone | The attribution migration's rollback **REFUSES while a collision exists**, because collapsing two rows means choosing which obligation's figure survives | rehearsed, 13/13 |
| NH is wrong about a number | The pilot is paused, the dispute is recorded, and the proof is revised — not re-approved | §4a(6) |

**One incident path is deliberately absent: there is no mechanism to adjust a proven figure in place.**
That is not a gap.

## 8. Roles and responsibilities

| Role | Who | Responsibility |
|---|---|---|
| **Data owner (A)** | Customer, contract/ERP side | Produce Export A; attest it left the system unaltered |
| **Data owner (B)** | Customer, billing side | Produce Export B, including `obligation_ref` **as issued by the contract system** |
| **Pilot sponsor** | Customer, finance leadership | Accept §4b; name the approver |
| **Approver** | Customer, finance — **never** the case author | Freeze proofs |
| **Governance owner** | Customer or NH, must differ from the proposer | Activate analysis terms and the admission bar |
| **Privacy owner** | Customer | Approve the pseudonymisation approach |
| **NH operator** | NH | Run intake, readiness and assessment; promote candidates |
| **NH engineering** | NH | The gates. **Not** authorised to approve a proof |

## 9. Unresolved dependencies and estimated effort

| # | Dependency | Owner | Effort | Blocks |
|---|---|---|---|---|
| D1 | **`AUTHORITY_VERIFIED` is unreachable** — no provenance channel the submitter cannot alter. Needs a signed export, a fetch NH performs itself, a machine-issued system-of-record attestation, or third-party reconciliation | Owner + customer | **weeks**, and the last option is the only one whose corroborating party is not party to the claim | Every readiness level stays PROVISIONAL |
| D2 | **Option B not executed** — attribution PK is `(execution_id, source_ref)`, account-grained | Owner | **~1 day** (designed, rehearsed, 13/13 green) | Obligation-grained attribution from the assessment path |
| D3 | **An unsupported mechanism can reach PROVEN** — the channel refusal is computed but not blocking | Owner | **~0.5 day** + a decision on the synthetic pilot's scenario | Correctness of PROVEN coverage |
| D4 | **PROVEN reachable for 1 of 8 mechanisms** | Owner | not closable by engineering — needs attestable facts plus a causal standard | Seven mechanisms |
| D5 | **9 TypeScript test errors remain** | NH engineering | **~1 day**, individually reviewed | Nothing; ratcheted |
| D6 | **OpenAI credential + `api.openai.com` network policy** | Owner | owner action | The orchestrator's live path |
| D7 | **No real customer data has ever been processed** | Customer | the pilot itself | Every claim about a real book |

**Shortest safe path to a first real pilot:** D1 is the only *hard* blocker on trusting the result, and
it is satisfiable for a pilot by accepting `SOURCE_ATTESTED`/PROVISIONAL with the qualification preserved
— which the owner has already decided. So the path is: **request the two exports (ready now) → run
readiness on them → D2 and D3 in parallel (~1.5 days) → one obligation through the governed loop with a
real approver.** D4, D5, D6 and D7 do not block it.

## 10. Verdict

> ### READY FOR PILOT ONLY AFTER SPECIFIED APPROVALS

**Not READY FOR CONTROLLED PILOT**, because two engineering items touch correctness of the number and
one requires an owner decision that changes product behaviour: **D3** (an unsupported mechanism can
currently reach PROVEN) and **D2** (obligation-grained attribution unavailable from the assessment path).
Neither is a research problem; both are scoped and costed.

**Not NOT READY**, because the loop demonstrably works end to end on the supported mechanism, with the
refusals firing and the two ledgers held apart — 10/10 acceptance scenarios doing exactly what they were
pre-registered to do, 4 proven and 6 refused with distinct codes at distinct stages.

**The approvals required before a first real pilot are C1–C6 (§6), plus owner decisions on D2 and D3.**

**No observed amount has become Revenue Returned. Every figure in this package is synthetic, and nothing
here is a claim about any customer's book.**
