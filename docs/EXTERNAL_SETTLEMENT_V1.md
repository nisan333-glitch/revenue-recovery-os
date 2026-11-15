# Stage 8 · external settlement attestation

**Date:** 2026-11-15 · **Owner-approved** · **Local development and tests only**
**Baseline:** `8204f68`, CI #339 green (6/6) · **Scheme:** `nh-settlement-v1` · **Method:** `xsa-2026.1`
**Status:** built, tested, mutation-proved. **Behind a flag that is OFF by default, with no production
consumer** — deliberately, see §8. No contract, schema, migration or frozen artefact was touched, no
customer data was used, and **no observed amount became Revenue Returned.**

---

## 1 · What was wrong

The PROVEN gate already refuses unless every outcome-role evidence record is `independent`, and
`evidenceStore.ts:92` derives that from a verified Ed25519 attestation. But `OUTCOME_EVIDENCE_TYPES`
declares exactly one source system — `billing`, the customer's **own** system.

> **So today's `independent` means independent of the NH OPERATOR, not independent of the COMPANY.**

That is a real control — it stops an operator substantiating their own claim — and it is not what a CFO
means by independent settlement evidence. A bank record ingests fine (`sourceSystem` is free text at
`schemas.ts:146`) and then derives role `supporting`, so the gate answers `NO_OUTCOME_EVIDENCE`. The
capability was unreachable by construction, not merely unbuilt.

## 2 · The rules this establishes

> **AUTHORISATION IS NOT SETTLEMENT, AND CAPTURE IS NOT EITHER.** Five states stay distinguishable —
> `AUTHORIZED`, `CAPTURED`, `PSP_SETTLED`, `BANK_CREDITED`, `REVERSED` — and exactly two assert that
> money arrived. **The load-bearing exclusion is `CAPTURED`:** a capture is an instruction the COMPANY
> issues, so counting it would let the beneficiary's own action substantiate the beneficiary's own
> claim. A boolean `settled` would let `AUTHORIZED` wear `BANK_CREDITED`'s guarantee.

> **A SOURCE MAY ONLY ASSERT WHAT IT COULD KNOW.** A bank sees credits and debits; it cannot see a card
> authorisation. A record claiming a bank asserted `AUTHORIZED` is not weak, it is **incoherent**, and it
> is refused on that ground rather than on its amount. This is the transaction-type requirement made
> structural rather than documentary.

> **REPLAY AND STALENESS ARE TWO JOBS, AND ONE WINDOW WAS DOING BOTH BADLY.** `sourceVerification`
> refuses a signature older than five minutes. That is right for a live connector and makes a bank
> statement **unusable**, because a bank signs a statement when it produces it. Replay is now defended by
> a **single-use nonce inside the signed payload**; staleness by a separate, generous bound. A window is a
> weak replay defence at any length, so lengthening it costs nothing once the nonce exists.

> **AND TWO TIMES STAY DISTINGUISHABLE.** `issuedAt` is when the attestation was **signed**; `valueDate`
> is when the money **cleared**. A value date far older than the signature is ordinary. The reverse — a
> settlement attested before it happened — is refused.

> **ONE ARRIVAL OF MONEY IS COUNTED ONCE.** The sum is over **distinct settlement identities**
> `(scheme, boundary, sourceSystem, externalSettlementRef)`, never over records. Two attestations of one
> settlement are the same money: the second is corroboration and adds nothing. Summing by record rather
> than by identity is how a figure doubles.

> **FACTS FROM TWO EXTERNAL SOURCE SYSTEMS ARE NEVER SUMMED.** A provider payout and a bank credit are
> routinely the **same money under two references** — the payout *is* the credit — and nothing in either
> record establishes that they are not. So a second source system contributes **no money**. Corroborating
> across sources needs a source-stated link that neither party emits today.

> **A REVERSAL OUTRANKS THE ARITHMETIC.** If any cited fact says the money went back, the question is not
> whether the rest sums. A reversal after approval is a **new linked proof revision**, never an overwrite.

> **THE SCHEME ID IS INSIDE THE SIGNED PAYLOAD, FIRST.** A settlement attestation can never be replayed
> as an evidence attestation, and a future scheme cannot collide with this one **even under the same key
> material**.

## 3 · Authorisation versus settlement, as implemented

| state | what it means about money | may substantiate? | who may assert it |
|---|---|---|---|
| `AUTHORIZED` | a reservation against a credit line; it can expire | **no** | psp |
| `CAPTURED` | the company has claimed the authorised money | **no — our own instruction** | psp |
| `PSP_SETTLED` | the provider has paid out | **yes** | psp |
| `BANK_CREDITED` | the company's bank states the funds are in the account | **yes** | bank |
| `REVERSED` | reversal, chargeback or refund | **no — and it blocks the claim** | bank, psp |

## 4 · Tenant isolation, at two independent layers

| layer | mechanism | what it stops |
|---|---|---|
| payload | `boundaryId` is inside the signed tuple | an attestation cannot be **moved** between tenants |
| key registry | a key is registered per `(boundaryId, sourceSystem, sourceKind)` | a shared key cannot **sign** for another tenant |
| pure core | the tenant is re-checked against the server's own boundary | a decision does not depend on an upstream guard having run |

**The tenant check runs before anything about the money**, and a test supplies a fact that is *also*
wrong on its amount to prove the ordering: a refusal describing the wrong tenant's figures would send a
reader to the wrong book.

## 5 · The refusal vocabulary — sixteen codes, all fail closed

`EXTERNAL_SETTLEMENT_NOT_ENABLED` · `NO_EXTERNAL_SETTLEMENT_EVIDENCE` · `SETTLEMENT_FACT_MALFORMED` ·
`SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE` · `SETTLEMENT_NOT_FINAL` · `SETTLEMENT_REVERSED` ·
`SETTLEMENT_TENANT_MISMATCH` · `SETTLEMENT_SOURCES_NOT_SUMMABLE` · `SETTLEMENT_ATTESTATION_REPLAYED` ·
`SETTLEMENT_ALREADY_SUBSTANTIATED` · `SETTLEMENT_REFERENCE_MISMATCH` · `SETTLEMENT_PAYER_MISMATCH` ·
`SETTLEMENT_CURRENCY_MISMATCH` · `SETTLEMENT_AMOUNT_INSUFFICIENT` · `SETTLEMENT_PRECEDES_CORRECTION` ·
`SETTLEMENT_VALUE_DATE_IN_FUTURE`

Ordered **most structural to most arithmetic**, so the refusal a caller receives is the one that tells
them what to do — `outcomeEvidence`'s rule, followed rather than reinvented. **No refusal echoes a
reference or an amount**, asserted by a test that checks the message against the real values.

## 6 · Mutation results · 17 of 17 caught, and the one that first survived

| # | mutation | verdict |
|---|---|---|
| M01 | drop the feature-flag gate | caught |
| M02 | treat `CAPTURED` as final | caught (2 tests) |
| M03 | sum by record instead of by identity | caught |
| M04 | allow summing across source systems | caught |
| M05 | drop the tenant check | caught |
| M06 | drop the nonce replay check | caught |
| M07 | accept a shortfall | caught |
| M08 | drop the already-substantiating check | caught |
| M09 | drop the source-kind coherence check | caught |
| M10 | drop the future-value-date check | caught |
| M11 | drop the correction-precedence check | caught |
| M12 | ignore a reversal | caught |
| **M13** | **remove the scheme id from the signed payload** | ***SURVIVED*, then caught** |
| M14 | drop the key's tenant binding | caught |
| M15 | widen the staleness bound to never expire | caught |
| M16 | coerce the feature flag to truthy | caught (5 tests) |
| M17 | drop the nonce format check | caught (3 tests) |

**M13 is the finding, and it was in my own test rather than in the code.** Removing the scheme id broke
nothing: my two cross-scheme tests sign an evidence payload and verify it as a settlement, and those
payloads differ in **shape** — 10 elements against 13 — so they never collide whether the scheme id is
present or not.

> **A test that passes for a reason other than the one it names cannot detect the removal of the
> mechanism it claims to prove.** The tests were true and irrelevant, which is worse than false. The
> actual claim the scheme id makes is about a FUTURE scheme of the **same shape**, so the control is now
> a payload differing in **exactly one element** — same key, same tenant, same money, same nonce, same
> instant — and it fails the moment the scheme id leaves the payload.

Both implementation files are **byte-identical** after the mutation run, asserted by hash.

## 7 · Test coverage

| suite | tests |
|---|---|
| `src/domain/externalSettlement.test.ts` | **37** — the pure decision, every refusal, three positive controls |
| `server/services/settlementVerification.test.ts` | **46** — forgery, tamper on all eight signed fields, cross-scheme both directions, tenant/source/kind bindings, freshness, nonce, registry, flag |
| `server/services/externalSettlementGate.test.ts` | **12** — end to end on signed synthetic data, plus the no-consumer guard |

**Three positive controls**, because a build that refused everything would satisfy every negative
assertion and be useless: a bank credit, a PSP payout, and two tranches of one source summing correctly.

**The flag-off test asserts the ledger is never read**, not merely that the verdict matches: a disabled
build must do no work and touch no state.

## 8 · Why this is NOT wired into the PROVEN gate, and what it waits on

Two facts the decision needs **do not exist in the persisted model**:

1. **An external payer reference on the case.** A case carries a pseudonymous `sourceRef` under NH's own
   HMAC key. A bank names the payer in the bank's terms. Nothing maps one to the other, and NH must not
   invent the mapping — that would be authoring the identity it is meant to read.
2. **A settlement ledger.** Replay defence needs the nonces already seen; one-arrival-counted-once needs
   the identities already substantiating another claim. Both are persisted state, and persistence means a
   schema migration — which is not authorised.

> **A gate that reads fabricated inputs is worse than an absent gate, because it reports enforcement
> that is not happening.** So the mechanism is complete and proven, the dependencies are named in the
> module itself, and a **structural guard asserts no production module imports it yet** — the pattern the
> expectation extract set. The guard reads **import specifiers only**, because *a term is not a claim, a
> prose mention is not an import, and a string literal is not a dependency*, and it asserts its own
> positive half so it cannot become vacuous. **It must MOVE WITH ITS CONSUMER when the schema slice
> lands, never be deleted.**

## 9 · What this does NOT do

- **It does not move the extract authority ladder.** `AUTHORITY_VERIFIED` there needs a different
  channel — `SIGNED_EXPORT`, `SYSTEM_OF_RECORD_ATTESTATION`, `NH_PERFORMED_FETCH` or
  `THIRD_PARTY_RECONCILIATION` — and nothing here implements one. Every readiness level stays
  **PROVISIONAL** at a `SOURCE_NATIVE` ceiling.
- **It does not change any existing figure or behaviour.** The flag is off by default and throws on any
  value but `true`/`false` rather than coercing, because a typo must not silently decide a financial gate.
- **It adds no key governance.** Blocker A2 stands: the registry is still a parsed environment variable
  with no registration, rotation, revocation, expiry or audit of who added a key. That is the next
  prerequisite for trusting anything this module verifies.
- **It establishes no causation.** `causationEstablished` is the literal `false`. The correction preceding
  the money is necessary evidence of a relationship and never proof that one caused the other.
- **It proves nothing financial.** Every fact in every test is synthetic and signed by a key generated in
  the test process. **No Recovery Case has ever originated from real customer data, and no observed
  amount became Revenue Returned.**
