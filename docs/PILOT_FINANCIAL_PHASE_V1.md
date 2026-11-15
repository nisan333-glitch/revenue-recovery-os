# Pilot financial phase · verified state, exact gaps, and the smallest safe slice

**Date:** 2026-11-15 · **Baseline:** `claude/pilot-reconciler-demo-v1` @ `386e0c3`, CI #338 green (6/6)
**Status:** ANALYSIS ONLY. Nothing in this document is implemented. No contract, schema, version
constant or frozen artefact was changed. No push beyond `386e0c3`, no deploy, no customer data, and
**no observed amount became Revenue Returned.**

---

## 0 · The finding that reframes all four priorities

**There are TWO independent lanes into a Recovery Case, and the frozen contract blocks only one of
them.** Every prior readiness report, including my own, has described the blocker as if it were
singular. It is not.

| | **Lane A · pilot assessment** | **Lane B · detector signal** |
|---|---|---|
| intake | pilot CSV, contract 2.0.0 | an `AgentHandler` observation |
| identity | `leakInstanceIdentityStatus()` | `candidateDedupeGrain(signal)` |
| obligation grain | **blocked** — `OBLIGATION_IDENTITY_FIELDS = []` | **available** — `obligationCoverage.kind === "SINGLE_OBLIGATION"` |
| staging ref | `stagedSourceRef(key, boundaryId, entityId)` — **account-grained** | `caseCandidateDedupeKey` — **obligation-grained under scheme v2** |
| reaches a case | no | **yes** |
| state | refused at `governedSignalStaging.ts:186` | **implemented, tested, and disabled by an environment flag** |

Lane B's detector for the one provable mechanism already exists:
`server/agents/reconciliationObserver.ts:75` declares `RECONCILIATION_RECOVERY_TYPE =
"RevenueUnderBilled"` — the **only** `LeakageType` whose recovery reason has a declared correction
channel. It is registered at `server/agents/activationDetector.ts:109` behind
`NH_RECONCILIATION_OBSERVER_ENABLED`, and that variable is set in **no committed deployment
manifest** — only in tests, the browser journey and one doc.

> **So the gate on a real BillingCorrection pilot is a deployment decision and an evidence-authority
> decision — not a frozen-contract change.** The contract change (Priority 1) is the right long-term
> fix for Lane A and is **not** on the critical path to a first financial pilot.

**One correction to my own reading, made while auditing rather than after.** I first read
`obligationCoverage` on the observer as unconditionally `SINGLE_OBLIGATION`. It is not:
`coverageForCandidate` (`reconciliationObserver.ts:405`) returns `SINGLE_OBLIGATION` only when a payer
has **exactly one** qualifying unit, and `ACCOUNT_AGGREGATE` with **no per-obligation figures** when
it has more. That is the correct shape, and it is what makes the eligible pilot population
self-selecting rather than asserted.

---

## 1 · Priority 1 · Obligation identity

### 1.1 · Verified current implementation

| Component | State | Evidence |
|---|---|---|
| Canonical identity shape | **built** — 4 components, no fallback | `src/contract/leakInstanceIdentity.ts:145` |
| Canonical encoding | **built** — `scheme ‖ NUL ‖ boundaryId ‖ NUL ‖ recoveryType ‖ NUL ‖ sourceNamespaceId ‖ NUL ‖ obligationRef` | `:218` |
| Component validation | **built** — type, empty, padding, control chars, 256-byte bound | `:175` |
| Injectivity | **built** — NUL rejected in every component, so the join is injective | `:175` |
| Refusal vocabulary | **declared**, 5 reasons | `:127` |
| Status predicate | **built**, data-independent, refuses for exactly one reason today | `:263` |
| Source namespace prerequisite | **CLOSED** — `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE = true` | `:124` |
| Pseudonymisation | **built** — `sourceRef` derived FROM the canonical key, never the reverse | `src/contract/leakInstanceSourceRef.ts:104` |
| Candidate dedupe key v2 | **built and obligation-grained** | `server/agents/caseAdmission.ts:110` |
| Grain disclosure on read surfaces | **built**, three states kept distinguishable | `src/domain/caseIdentityGrain.ts` |
| PROVEN eligibility leg A | **built**, 7 refusal codes | `src/domain/provenEligibility.ts:60` |

**This is far more built than "the contract declares no field" suggests.** The identity model, its
encoding, its validation, its refusals and its consumers all exist. One component has no source.

### 1.2 · The exact gaps, measured

| # | Gap | Evidence | Owner |
|---|---|---|---|
| **G1** | `OBLIGATION_IDENTITY_FIELDS` is a frozen empty array | `leakInstanceIdentity.ts:53` | contract |
| **G2** | Three of five refusals have **ZERO production consumers** — `_incomplete`, `_malformed`, `_ambiguous` exist only as union members | `grep` over `src` + `server` excluding tests returns only the declaration | engineering |
| **G3** | Lane A staging is **account-grained at the point of writing**: `stagedSourceRef(…, attribution.entityId)` | `governedSignalStaging.ts:198` | engineering |
| **G4** | `PilotAssessmentEntityAttributionRecord` is `@@id([executionId, sourceRef])` with an account-grained `sourceRef`, so the table **cannot hold two obligations of one account** whatever the contract declares | `prisma/schema.prisma:531` | **owner — migration** |
| **G5** | The completeness gate is satisfiable by **pre-aggregating** rows until every survivor carries a reference | `docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md` §4 | owner, known & unclosed |
| **G6** | Lane B's `obligationRef` is **NH-derived**, not source-stated: `HMAC(key, ["reconciliation-obligation", entitlementRef, periodStart, periodEnd])` | `reconciliationObserver.ts:393` | owner — see 1.4 |

**G4 is the real blocker for Lane A, and it is a schema migration, not a contract field.** The
migration is already designed and tested on an isolated database (`scripts/migration-design/`,
`docs/D2_OPTION_B_VALIDATION_V1.md`, 21 tests) and deliberately **not** in `prisma/migrations/`,
because a file there is applied by `prisma migrate deploy` on every deploy and would *be* the
production schema change.

### 1.3 · Proposed stable obligation-level identity mapping

**No change to the derivation.** `canonicalLeakInstanceKey` is correct as written and is reused
unchanged. The mapping is only about where `obligationRef` comes from:

| Lane | Source of `obligationRef` | Authority | Status |
|---|---|---|---|
| A · pilot assessment | a new OPTIONAL `obligation_ref` column, billing-stated | **source-stated** | proposed, `docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md` |
| B · reconciliation observer | `(entitlementRef, periodStart, periodEnd)` of a unit the core did not refuse | **NH-derived** | live, flag-disabled |
| B · secure CSV | `obligationIdentity` column, HMAC-pseudonymised in its own namespace | **source-stated** | live, `secureCsvIngestion.ts:110` |

**Zero synonyms, no case folding, no Unicode normalisation** — binding and unchanged. `OBLIG-1` and
`oblig-1` are two identities; NFC and NFD `café` are two identities. Any folding we performed would be
NH authoring the identity it is supposed to be reading.

### 1.4 · The honest limit of an NH-derived reference

Lane B's reference is derived from a unit's **bounds**, not from a source statement. It is defensible
only because the reconciliation core already **refuses** the cases where a unit is not one obligation —
`REFUSED_AMBIGUOUS_LIVE_LINES` when two unsuperseded expectation lines claim one unit. So a surviving
unit carries exactly one unsuperseded line.

**That is necessary evidence and not proof.** A reschedule that moves a period boundary changes
`periodStart`/`periodEnd` and therefore changes the derived reference — the exact instability
`OBLIGATION_IDENTITY_FIELDS`' doc comment names as disqualifying. **Consequence, stated rather than
buried: a rescheduled obligation would read as a new one in Lane B.** A source-stated
`obligation_ref` is the only form that survives a reschedule, which is why Priority 1 remains worth
doing even though it is off the pilot critical path.

### 1.5 · Required negative controls

| Control | Must prove | Why it is not covered today |
|---|---|---|
| **N1 · collision** | two accepted cycles claiming one identity ⇒ `leak_instance_identity_ambiguous`, **whole submission refused**, zero rows written | no production implementation (G2) |
| **N2 · missing identity** | some rows carry a reference and some do not ⇒ `leak_instance_identity_incomplete`, refused **whole**, never 90 % staged | same |
| **N3 · malformed** | empty / padded / control character / > 256 bytes ⇒ `leak_instance_identity_malformed` | validation exists; the refusal has no caller |
| **N4 · cross-tenant** | the same `obligationRef` under two `boundaryId`s ⇒ **two** identities, and `boundaryId` is taken from the authenticated context and **never** from a file or request body | partially covered: `leakInstanceIdentity.test.ts:169` proves the keys differ. **Not** covered: that no file or request field can set `boundaryId` on this path |
| **N5 · reschedule** | a due-date change does **not** split one obligation into two candidates under a source-stated ref, **and does** under the NH-derived ref — asserted in both directions so the limit in 1.4 cannot be lost | not covered at all |
| **N6 · correction stability** | a corrected observation of the same obligation resolves to the **same** dedupe key | covered: `caseAdmission.ts:113` and its tests |

**N4's uncovered half is the security-relevant one.** A cross-tenant negative control that only
compares two keys proves the function is injective; it does not prove the tenant cannot be chosen by
the caller. That needs a structural test over the call sites, not another key comparison.

---

## 2 · Priority 2 · Independent financial authority

### 2.1 · The finding: there are TWO authority systems, and they are not connected

| | **Extract authority** | **Evidence authority** |
|---|---|---|
| governs | the customer's CSV extracts | individual evidence records on a case |
| ladder | `PRESENT → VALID_FORMAT → SOURCE_NATIVE → SOURCE_ATTESTED → AUTHORITY_VERIFIED` | `beneficiary_controlled` / `independent` |
| where | `src/contract/sourceFactAuthority.ts` | `server/persistence/evidenceStore.ts:92` |
| mechanism | declaration + checks NH can perform | **Ed25519 signature verification** |
| ceiling today | **`SOURCE_ATTESTED`**, every level PROVISIONAL | **`independent` is reachable** |
| read by the proof gate | **NO** | **YES** |

**Measured, not inferred:** `grep` for `sourceFactAuthority`, `SourceFactAuthority`,
`AUTHORITY_VERIFIED`, `evaluateDataReadiness` and `ReadinessReport` across `server/` and `src/domain/`,
excluding tests, returns **nothing**. The PROVEN gate does not read the extract ladder, and the
readiness evaluator does not read evidence trust.

> **Neither system's state implies the other's.** An extract at `SOURCE_NATIVE`/PROVISIONAL can feed a
> case whose proof is minted from `independent` evidence, and a `SOURCE_ATTESTED` extract guarantees
> nothing about any proof. This is harmless **today only because Lane A reaches no case at all.** The
> day Lane A opens, it becomes a live defect: the question *"was the data this case came from
> authoritative?"* would have no answer on the proof.

### 2.2 · What "independent" means today, exactly

```
evidenceStore.ts:92   trustClassification: input.sourceVerification ? "independent" : "beneficiary_controlled"
```

One hinge: a **verified Ed25519 attestation recorded by the server**. The PROVEN gate then refuses
unless every outcome item is `sourceVerified && !beneficiaryControl && trustClassification ===
"independent"` (`src/domain/outcomeEvidence.ts`, `OUTCOME_EVIDENCE_NOT_AUTHENTICATED`).

**And the signing source is the customer's own billing system.** `OUTCOME_EVIDENCE_TYPES` declares
exactly one source — `billing: ["invoice_paid", "payment_received"]` (`src/domain/evidenceRole.ts:42`).

> **So today's `independent` means independent of the NH OPERATOR, not independent of the COMPANY.**
> That is a real control — it stops an operator substantiating their own claim — and it is **not** what
> a CFO means by independent settlement evidence. `THIRD_PARTY_RECONCILIATION` is the only channel in
> the catalogue whose corroborating party is not party to the claim.

### 2.3 · The minimum external settlement evidence

The smallest set that moves a *settlement* fact from company-attested to externally verified:

| # | Fact required | From | Why it is minimal |
|---|---|---|---|
| **E1** | the settled amount in minor units and its currency | bank or PSP | the arithmetic the gate already performs |
| **E2** | the value date the funds cleared | bank or PSP | establishes the outcome followed the correction |
| **E3** | a reference tying the settlement to the corrective invoice | bank or PSP remittance field | without it the money is not attributable to this case |
| **E4** | the payer identity as the external system holds it | bank or PSP | lets NH check the payer, not take it on trust |
| **E5** | a signature over E1–E4 by a key the submitter does not hold | the external system | the entire point of the rung |

**No sixth fact.** The expected amount must NOT come from the external source — billing stating the
expectation is billing auditing itself, and the same rule already refuses `expected_amount` on the
billing extract.

### 2.4 · What blocks E1–E5 today, in order of difficulty

| # | Blocker | Evidence | Kind |
|---|---|---|---|
| **A1** | the production key registry is **empty by default** — `JSON.parse(env.NH_EVIDENCE_SOURCE_KEYS ?? "[]")`, and `server/app.ts:101` constructs `new SourceVerifier([])` when unset | `sourceVerification.ts:55` | deployment |
| **A2** | **no key governance at all** — no registration, rotation, revocation, expiry or audit of who added a key. A key in an env var is a secret with no lifecycle | measured: the only references are the parse and the constructor | **owner** |
| **A3** | a **5-minute freshness window** — `now - issued > 300_000` is refused, as is `issued > now + 30_000`. A stored bank statement signed hours earlier **cannot be used**: the signature must be produced at submission time by a live connector | `sourceVerification.ts:38` | **owner — design** |
| **A4** | `OUTCOME_EVIDENCE_TYPES` is a **closed map keyed on `billing` only**, so a record with `sourceSystem: "bank"` derives role `supporting` and the gate answers `NO_OUTCOME_EVIDENCE`. `sourceSystem` is free text at ingestion (`schemas.ts:146`), so the record is accepted and then cannot count | `evidenceRole.ts:42`, `:89` | contract addition |
| **A5** | `trustClassification` is **binary**, so bank-verified and billing-verified are the same value. Promoting one without distinguishing them would let the weaker wear the stronger's guarantee | `evidenceStore.ts:92` | **owner — design** |
| **A6** | the extract ladder's `AUTHORITY_VERIFIED` needs a **different** channel — the four unimplemented ones in `PROVENANCE_CHANNELS` — and closing A1–A5 does **not** move it | `sourceFactAuthority.ts:118` | owner |

**A4 and A5 together are the contract addition**, and they must land as one: adding `bank` to the
outcome map without a third trust state would make a bank-attested and a billing-attested collection
indistinguishable on the proof, which is the *stay distinguishable* rule.

### 2.5 · Verification, reconciliation, refusal and audit requirements

**Verification.** Ed25519 over an ordered, versioned payload — the existing
`sourceSigningPayload` shape, extended to a new scheme id rather than widened, so a settlement
attestation can never be replayed as an evidence attestation. The key must be registered against the
external `sourceSystem` and the verifier must refuse a key registered for another system — the
existing `trusted.sourceSystem !== claim.sourceSystem` check already does this.

**Reconciliation.** The external settled amount must equal the claimed collected amount in the same
currency. The existing arithmetic is correct and is reused: `OUTCOME_EVIDENCE_INSUFFICIENT`,
`OUTCOME_EVIDENCE_CURRENCY_MISMATCH`, and `OUTCOME_EVIDENCE_AMOUNT_NOT_STATED` — *missing is not zero*.
E3 must additionally match the corrective invoice reference recorded on the correction evidence, and a
mismatch is a **named refusal**, never a warning.

**Refusal.** Fail closed, with a code per cause, and the code must say which half is missing:
unregistered key, wrong source system, stale or future attestation, bad signature, no external outcome
record, reference mismatch, amount shortfall, currency mismatch. **A single generic 403 satisfies a
gate and fails a reader.**

**Audit.** The proof must freeze what it relied on: the scheme id, the key id, the payload hash, the
verified-at timestamp, and the external reference — the existing `SourceReceipt` shape. Once frozen it
is immutable; a later dispute or reversal creates a **new linked proof revision**, never an overwrite.

---

## 3 · Priority 3 · The BillingCorrection pilot journey

One limited journey, nine stages. Every gate below is **already implemented** unless marked.

| # | Stage | Gate | Refusal if it fails |
|---|---|---|---|
| 1 | **Detect** — the reconciliation observer compares an expectation extract with a billing extract and emits `RevenueUnderBilled` for each unpaired `UNDER_BILLED` unit | `reconciliationObserver.ts`; paired, over-billed, refused and unpriced units are **not** candidates | — (counted, not zeroed) |
| 2 | **Stage** — one candidate per payer; **one unit ⇒ `SINGLE_OBLIGATION`**, several ⇒ `ACCOUNT_AGGREGATE` with no per-obligation figures | `coverageForCandidate:405` | — |
| 3 | **Admit** — `assertCandidateSignal` + an admission policy for the recovery type; dedupe key v2 is obligation-grained | `caseAdmission.ts:110` | `no admission policy exists for recovery type` |
| 4 | **Review** — a human decides, with a reason. A decision with no reason is refused and creates no case; acceptance is **not** promotion | `candidateReview.ts` | 4xx, no case |
| 5 | **Promote** — operator role + boundary; `RecoveryCaseRecord.sourceCandidateId` is UNIQUE, so a second case for one candidate is impossible | `postgresCandidateReviewStore.promote` | 409 |
| 6 | **Author + baseline** — baseline locked **before** the intervention, by someone who is not the approver | `baselineTemporallyValid` | `baseline trust violation` |
| 7 | **Correct** — the billing system raises the corrective charge and attests it: `billing` + `corrective_invoice_issued` \| `billing_corrected`, Ed25519-signed | `executedCorrection` + `correctionMapping` | `NO_EXECUTED_CORRECTION_RECORD`, `CORRECTION_CHANNEL_NOT_DECLARED`, `CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON` |
| 8 | **Settle** — **the external settlement attestation.** `bank`/`psp` + E1–E5 | **NOT IMPLEMENTED — A4/A5** | would be `NO_OUTCOME_EVIDENCE` today |
| 9 | **Approve** — approver ≠ author; leg A requires one obligation; outcome evidence independent, amounts sufficient, correction **precedes** collection | `provenEligibility` + `financialOutcomeSufficiency` + `proofService` | 7 + 7 named codes |

**The eligible population is self-selecting and must be stated to the customer as such:** only a payer
with **exactly one** unpaired under-billed unit can reach PROVEN. An `ACCOUNT_AGGREGATE` candidate is
refused `OBLIGATION_COVERAGE_IS_AGGREGATE` — correctly, because no single obligation underlies the sum.

**Stage 8 is the whole gap.** Stages 1–7 and 9 exist, are tested, and run end to end in a real browser
(`e2e/journey.mjs` §13, inside a journey measured at **200/200 recorded checks** on this commit) on a detector finding. What that journey does **not** do is prove a
settlement against a party outside the company: its evidence is signed by an **ephemeral key generated
per run**, which is honest synthetic proof of the mechanism and establishes nothing financial.

**`causationEstablished` is the literal `false`.** The correction preceding the collection is necessary
evidence of a relationship and never proof of causation. A pilot report must not round that up.

---

## 4 · Priority 4 · Pilot acceptance

### 4.1 · Acceptance criteria — measurable, and each one falsifiable

| # | Criterion | Measured by | Pass |
|---|---|---|---|
| **AC1** | Every candidate traces to a detector run over customer-supplied extracts; none is hand-authored | no UI creates a signal; `signalId` is a digest of the observation | 100 % |
| **AC2** | Every PROVEN proof cites outcome evidence signed by a key **the customer's operator does not hold** | `SourceReceipt.keyId` ∈ external registry | 100 % |
| **AC3** | Proven Revenue Returned = Σ(`collected − baseline`) over frozen proofs, and reconciles to the waterfall with **no unexplained residual** | `reconciliation.ts` buckets | residual = 0 |
| **AC4** | Revenue Opportunity and Revenue Returned are reported apart on every surface, and an absent proof renders **NOT COMPUTED**, never `$0.00` | `ProvenRevenueFigure`; the markup contains no `$0.00` | asserted |
| **AC5** | Author ≠ approver on every proof; no actor both authored and approved | `enforceSeparation` over the authority ledger | 0 violations |
| **AC6** | Every refusal reaching an operator carries a **code** and names the missing half | code vocabulary coverage | 100 % |
| **AC7** | No customer cell value appears in any report, log, CLI output or error path | the existing codes-only guards, extended to the settlement path | 0 occurrences |
| **AC8** | The eligible population is stated as a count and a share, with aggregate-coverage payers **counted, not hidden** | candidate grain census | reported |

**AC3's residual = 0 is the load-bearing one.** It is the property that makes the figure honest rather
than flattering, and it is the one a CFO can re-derive.

### 4.2 · Failure conditions — any one of these stops the pilot

| # | Condition | Why it is terminal |
|---|---|---|
| **F1** | a proof is minted whose outcome evidence is not externally attested | the claim is company-attested and AC2 is false |
| **F2** | one actor authored and approved the same proof | the beneficiary determined the number |
| **F3** | a figure labelled proven includes a forecast, or the two ledgers are summed anywhere | the constitution's first rule |
| **F4** | an aggregate-coverage candidate reaches PROVEN | no single obligation underlies the money |
| **F5** | a customer cell value reaches a report, log or error | privacy, and the diagnostic path is where it happens |
| **F6** | a reversal, refund or dispute **overwrites** a proof instead of creating a linked revision | rule 9; history must stay immutable |
| **F7** | the external key registry is changed without an audited record of who changed it | A2 — the trust root becomes unaccountable |
| **F8** | a rescheduled obligation opens a second case for one real leak | the identity instability in §1.4 |

### 4.3 · Security controls

- **Keys.** The external public key registry must be auditable, not an env var. The private half stays
  with the external party and reaches NH **never** — the browser journey's split (public half to the
  API process, private half to one script) is the pattern.
- **Roles.** Operator, steward and approver stay distinct; the case's own operator does **not** hold
  `AuditRead`, and widening that is a governance change, not a convenience.
- **Boundary.** Every read is boundary-scoped from the authenticated context; no request parameter
  names a boundary. N4's uncovered half must be closed with a structural test.
- **Pseudonymisation.** Raw identifiers never leave the intake; `obligationRef` and `sourceRef` are
  HMACs in separate namespaces so the two can never collide.
- **Diagnostics.** Codes only. The settlement path must inherit the codes-only guard, because an
  external reference is customer data.
- **Append-only.** Evidence, authority events, admission decisions and proofs are append-only by
  trigger, not by convention.

### 4.4 · Rollback

| Layer | Rollback | Reversible? |
|---|---|---|
| detector | set `NH_RECONCILIATION_OBSERVER_ENABLED=false` — no new signals | **yes, immediately** |
| candidates | leave in place; a candidate is not a claim | yes |
| cases | cannot be deleted — append-only by design | **no** |
| proofs | cannot be unmade; a reversal is a **new linked revision** | **no, by design** |
| schema migration (G4) | the designed migration has a tested DOWN that **refuses while a collision exists**, because collapsing two rows means choosing which obligation's figure survives | **conditionally** |
| reported figures | a withdrawn proof's money leaves `counted` and appears in its own bucket; the waterfall still accounts for every gross dollar | yes |

> **Rollback is NOT symmetric, and a pilot plan that implies it is misleads.** Turning the detector off
> is instant. Un-proving a proof is impossible by construction — that is the immutability the product
> sells. **The reversible decision is whether to detect; the irreversible one is whether to approve.**

### 4.5 · Synthetic readiness versus real financial proof

| | **Synthetic readiness — what is proved today** | **Real financial proof — what is not** |
|---|---|---|
| detection | the core finds $62,446.00 of planted money with $0.00 fabricated on a frozen package | nothing has been run on a customer's book |
| the loop | Identify → Fix → Prove end to end in a real browser, **200/200 recorded checks** measured on `386e0c3`, on a detector finding | the evidence is signed by an **ephemeral per-run key** |
| proof machinery | candidate store, immutable reviews, separation of duties, frozen proofs, linked revisions | **no proof has ever rested on externally attested settlement** |
| figures | seed proven $5,500.00, auditable $5,500.00 | **every figure is synthetic** |
| extract authority | `SOURCE_ATTESTED` ceiling, every level PROVISIONAL | `AUTHORITY_VERIFIED` is unreachable |
| origination | — | **no Recovery Case has ever originated from real customer data** |

**The one sentence that must survive summarising:** the machinery is built and exercised; **no dollar
in this system has ever been proven from a real customer's money.**

---

## 5 · File-level implementation plan

Ordered by dependency, not by preference. **Nothing here is authorised.**

### Slice 1 · Settlement authority (unblocks stage 8 — the only gap on the pilot path)

| File | Change |
|---|---|
| `src/domain/evidenceRole.ts` | add an `external` source to `OUTCOME_EVIDENCE_TYPES` with its own types; keep `billing` unchanged |
| `src/domain/outcomeEvidence.ts` | require at least one **externally** attested outcome item; new codes `NO_EXTERNAL_SETTLEMENT_EVIDENCE`, `SETTLEMENT_REFERENCE_MISMATCH` |
| `server/persistence/evidenceStore.ts` | a **third** trust state so external-verified ≠ billing-verified; never collapse them |
| `server/services/sourceVerification.ts` | a **new scheme id** for a settlement payload, so it cannot be replayed as an evidence attestation; the freshness window becomes a per-scheme parameter |
| `server/services/proofService.ts` | freeze the settlement receipt into the proof |
| `prisma/schema.prisma` | **owner decision** — a nullable column for the third trust state; append-only, no backfill |

### Slice 2 · Key governance (A2 — a prerequisite for trusting slice 1)

| File | Change |
|---|---|
| `server/persistence/sourceKeyRegistry.ts` (new) | registered, append-only external keys with who, when and why |
| `server/services/sourceVerification.ts` | read the registry instead of the env var; env becomes the bootstrap path only |

### Slice 3 · Lane A obligation identity (Priority 1 — NOT on the pilot path)

| File | Change |
|---|---|
| `prisma/migrations/…` | **owner — production migration.** The designed PK split, DOWN included |
| `src/contract/pilotDataContract.ts` | the OPTIONAL `obligation_ref` field, contract `2.0.0 → 2.1.0` |
| `src/contract/leakInstanceIdentity.ts` | `OBLIGATION_IDENTITY_FIELDS = ["obligation_ref"]` |
| `src/contract/saasActivation.ts` | carry the value onto the accepted cycle |
| `server/services/governedSignalStaging.ts` | obligation-grained attribution; the three population refusals (G2) |
| `server/services/governedSignalEmitter.ts` | the same refusals at emission |

**The order is binding:** the consumer ships before the producer, and the migration before the field.
A file declaring `2.1.0` on a `2.0.0` build is refused; the reverse is accepted.

---

## 6 · Tests and negative controls required

| # | Test | Must fail when |
|---|---|---|
| T1 | a billing-only attested collection is **refused** | the external requirement is removed |
| T2 | an external attestation signed by an **unregistered** key is refused | the registry check is bypassed |
| T3 | an attestation signed for **another source system** is refused | the `sourceSystem` binding is dropped |
| T4 | a **stale** and a **future** attestation are both refused, each by its own code | the window is widened |
| T5 | a settlement reference that does not match the corrective invoice is refused | the match becomes a warning |
| T6 | external-verified and billing-verified are **distinguishable on the proof** | the third trust state is collapsed |
| T7 | a settlement payload **cannot** be replayed as an evidence attestation | the scheme id is shared |
| T8 | **N1–N5** above, each as its own refusal, refused **whole** | any becomes partial |
| T9 | `boundaryId` on the identity path comes from the authenticated context — **structural**, over call sites | a request field can set it |
| T10 | a reversal creates a **linked revision** and the original proof is **byte-identical** afterwards | an overwrite is introduced |
| T11 | **positive control** — a fully attested BillingCorrection reaches a real 201 and a frozen proof | the build refuses everything |
| T12 | no customer value in any report, log, CLI or error on the settlement path, with forbidden strings **computed from the fixture** rather than hardcoded | a detail string is rendered |

**T11 is not optional.** A build that refused everything would satisfy T1–T10 and be useless.

---

## 7 · Dependencies and owner decisions

| # | Decision | Why only the owner can take it | Blocks |
|---|---|---|---|
| **D1** | Which external party attests settlement — bank, PSP, or both | it is a commercial and legal relationship | slice 1, stage 8 |
| **D2** | How the attestation is produced given the 5-minute window: a live connector, or a longer window for a stored statement with a stated weakening | it trades operational cost against evidentiary strength | A3 |
| **D3** | Whether the external key registry is a table, a KMS, or a signed manifest | security architecture with a cost | slice 2 |
| **D4** | Whether to run the production migration for Lane A | a production schema change | slice 3 |
| **D5** | Contract `2.0.0 → 2.1.0` with `obligation_ref` OPTIONAL | a customer-facing contract change | slice 3 |
| **D6** | Whether the two authority systems should be **linked** — i.e. whether a proof must record the extract authority its case came from | it tightens the gate and may refuse cases that pass today | §2.1 |
| **D7** | Whether an `ACCOUNT_AGGREGATE` payer is excluded from the pilot or offered a manual split | it sets the eligible population | pilot scope |
| **D8** | Enabling `NH_RECONCILIATION_OBSERVER_ENABLED` in any real environment | it is a deployment change | the whole pilot |

---

## 8 · Recommended smallest safe development slice

**Slice 1, stage 8 only: the external settlement attestation — behind the existing disabled flag, on
synthetic data, with no deployment.**

| | |
|---|---|
| **Why this one** | it is the **only** gap on the BillingCorrection pilot path. Stages 1–7 and 9 exist and are CI-exercised. Nothing else unblocks a financial pilot |
| **Why not Priority 1** | Lane A needs a **production migration** (G4) before a contract field buys anything, and Lane B already reaches a case without it. It is the right long-term fix and the wrong next step |
| **Size** | 5 files touched, ~12 tests, one owner decision (D1) needed before the source system can be named |
| **Risk** | low and bounded: the change **tightens** a gate. Its failure mode is refusing a proof that would have passed, never minting one that should not |
| **Reversible** | yes — no schema change if the third trust state is deferred to a read-time derivation, no contract change, no deploy |
| **What it does NOT do** | it does not move the extract ladder off `SOURCE_ATTESTED`, does not open Lane A, and does not make any figure real |

**Sequencing note:** D1 can be answered in parallel with building the mechanism, because the mechanism
is source-agnostic — what D1 settles is which `sourceSystem` string and which key go in the registry.

---

## 9 · Evidence links

| Claim | Evidence |
|---|---|
| baseline green | CI #338 — `actions/runs/43663580868`, 6/6 jobs, `head_sha = 386e0c3` |
| EP-9 passed | `actions/runs/43663580868/job/132657985825`, 12/12 steps |
| CI figures | portable suite 1916 passed / 5 skipped; `test:ep2` 989 / 9 |
| two authority systems unlinked | `grep` over `server/` + `src/domain/` for the five identifiers in §2.1 returns nothing |
| three refusals unconsumed | same method, `leak_instance_identity_{incomplete,malformed,ambiguous}` |
| observer disabled | `NH_RECONCILIATION_OBSERVER_ENABLED` appears in no committed manifest |
| prior proposal + errata | `docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md` |
| migration validated | `docs/D2_OPTION_B_VALIDATION_V1.md`, 21 tests on an isolated database |
| proof gate review | `docs/PROVEN_GATE_REVIEW_V1.md`, `docs/PROOF_BYPASS_CLOSURE_V1.md` |

---

## 10 · Next execution steps

1. **Owner answers D1** — which external party attests settlement. Everything in slice 1 that needs a
   name waits on it; the mechanism does not.
2. **Build slice 1 locally**, synthetic only, behind the disabled flag, with T1–T7, T11 and T12.
3. **Report the measured result**, including which negative controls fail closed and which do not.
4. **Then** D2 and D3, which decide whether slice 1's evidence is operationally obtainable at all.
5. **Priority 1 (slice 3) is queued behind D4 and D5** and is explicitly not next.

**Not authorised and not done:** push beyond `386e0c3`, merge, deploy, production migration, real
customer data, executing a financial correction, or any change to a frozen contract or business rule.
**No PROVEN claim and no pilot success is asserted anywhere in this document.**
