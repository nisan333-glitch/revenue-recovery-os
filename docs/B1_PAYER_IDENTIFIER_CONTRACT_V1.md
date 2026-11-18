# B1 · The shared payer identifier — contract

**Status:** contract, at `98b63a2`. **Nothing is implemented by this document**, and the one change it
proposes is marked as a proposal with an owner.
**Date:** 2026-11-18. Synthetic examples only. No bank approval and no customer consent is asserted.

**Scope.** This governs the identifier only. It is required **only** when a settlement citation is
used; a first pilot can reach `PROVEN` without one — see `docs/PILOT_BLOCKER_MAP_V1.md` §0.

---

## 1 · What it is, and the one sentence that decides everything

> **The payer identifier is ONE string, chosen by the customer, that BOTH their billing system and
> their bank quote, unchanged, on the records NH compares.**

NH compares two independent institutional statements about who paid. It does not resolve, map,
normalise or guess. The comparison in force today is byte-exact:

```ts
// src/domain/externalSettlement.ts:359
if (fact.payerExternalRef !== input.casePayerExternalRef) → SETTLEMENT_PAYER_MISMATCH
```

---

## 2 · Source and ownership

| | |
|---|---|
| **Who chooses the value** | the customer's finance owner, agreed with their bank or PSP. **Not NH.** |
| **Who owns it appearing on the billing side** | the customer's billing / ERP technical owner |
| **Who owns it appearing on the remittance** | the customer's bank or PSP relationship owner |
| **Who owns the agreement that the two match** | the customer's finance owner |
| **What NH owns** | comparing them, and refusing when they differ |

**NH never supplies, derives or defaults it.** There is no request field through which a caller can
state the payer the attestation must match: the case's value comes only from a claim a source system
**signed** (`caseSettlementContext.ts:107-135`). A caller who could state it would state whatever the
attestation says, and the check would compare the caller against himself.

**Why no mapping table, ever.** A mapping maintained by the customer's own team hands the beneficiary
control over which settlement matches which case — the exact lever the comparison exists to remove.
NH refuses to accept one and will not build one.

---

## 3 · Where it must appear

| # | record | field | who signs it | required? |
|---|---|---|---|---|
| R1 | the **evidence claim** the billing system signs for this case | `payerExternalRef` | billing / ERP, Ed25519 under a key registered in `NH_EVIDENCE_SOURCE_KEYS` | **required** for any settlement citation |
| R2 | the **settlement attestation** the bank signs | `payerExternalRef` | bank / PSP, Ed25519 under a key in the governed key register | **required** in every attestation |

Both are **inside the signed payload**, not beside it: `sourceSigningPayload` places the payer before
`issuedAt` in the v2 evidence scheme, and the settlement payload carries it under `nh-settlement-v1`.
So neither value can be added, stripped or altered after signing without the signature failing.

**It appears nowhere else.** NH stores no payer column on the case, the candidate or any evidence row
— a test reads a persisted evidence row and fails if any top-level column name contains `payer`. The
only place the value is readable is **inside a verified receipt**.

---

## 4 · How an exact match is proven

1. **Both values are inside signatures NH verifies** against separately registered keys. Neither side
   can be edited in transit, and neither party can produce the other's.
2. **The case's value is read from the record**, never from the request. The bank's value is read from
   the attestation NH verified.
3. **The comparison is byte-exact.** No trimming, no case folding, no Unicode normalisation, no
   punctuation stripping, no prefix matching, no similarity.
4. **Two signed records that disagree establish nothing.** If a case carries two source-attested payer
   references with different values, the resolver returns `null` and the approval refuses. Picking the
   earliest, the latest or the correction's would be NH deciding an identity question on an arbitrary
   rule (`caseSettlementContext.ts:120-131`). The refusal reports the **count** and never the values.

### Why NH refuses to normalise, stated with its cost

The repository's standing rule — *zero synonyms, no case folding, no Unicode normalisation, so two
visually identical references are two identities* — exists because any normalisation is NH **deciding
that two different strings are the same party**. That is authoring identity, not reading it.

**The cost is real and is not hidden:** `ACME-001` and `acme-001` refuse. A trailing space refuses. A
non-breaking space refuses. The remedy is configuration before the pilot starts, not leniency in the
comparison.

---

## 5 · Cases that MUST refuse

| # | case | code | why it is not negotiable |
|---|---|---|---|
| F1 | billing signed no payer reference | `SETTLEMENT_CASE_PAYER_NOT_RECORDED` | there is nothing to compare; nothing is inferred |
| F2 | the attestation carries no payer, or a blank/padded one | `SETTLEMENT_FACT_MALFORMED` | a blank is not a payer, and a padded value is a different value |
| F3 | both are attested and **differ by any byte** | `SETTLEMENT_PAYER_MISMATCH` | two institutions disagree about who paid |
| F4 | two signed records on the case name **different** payers | resolver returns `null` → `SETTLEMENT_CASE_PAYER_NOT_RECORDED` | a contradiction about who the case concerns |
| F5 | the payer matches but the invoice reference does not | `SETTLEMENT_REFERENCE_MISMATCH` | right payer, wrong money |
| F6 | the value contains a control character | `SETTLEMENT_FACT_MALFORMED` | a control character is how a value impersonates a separator in a hash preimage |

**No refusal here is waivable by configuration, a flag, or an operator.** There is no override and none
will be added: an override is a lever for the party who benefits from the match.

---

## 6 · How approximate and duplicate matching are prevented

### Approximate matching is unrepresentable, not merely discouraged

- The comparison is a `!==` on two strings. There is no threshold, no distance, no candidate set.
- **Amount, date and name resemblance are excluded by name.** The taint-scope rule already forbids
  them: *amount similarity, date proximity alone and any name resemblance are excluded, because each
  would make NH the author of the relationship it is supposed to be reading.*
- NH holds no customer master data, so it has nothing to resolve against even if it wanted to.

### Duplicates are prevented by the ledger, not by the identifier

The payer identifier is **not** the money's identity and must never be used as one. One payer has many
arrivals.

| mechanism | what it stops | where |
|---|---|---|
| unique index on the keyed digest of `externalSettlementRef` | the **same arrival** substantiating two proofs | `settlement_consumptions`, `one_arrival` |
| unique index on `(boundary, nonce)` | the **same attestation** being presented twice | `one_use` |
| the claim shares the proof's transaction | a refused approval releasing nothing, and a race counting twice | `proofService.ts` + `settlementClaim.ts` |
| `sourceCandidateId` UNIQUE on the case root | two cases from one candidate | `RecoveryCaseRecord` |

**A matching payer is necessary and never sufficient.** The invoice reference, the amount, the
currency, the finality, the value date and the arrival's own identity are all checked separately, and
each has its own refusal.

---

## 7 · One proposed change, with its owner

**The problem.** `SETTLEMENT_PAYER_MISMATCH` says only *"the payer the external system names is not the
payer recorded on this case"*. For a difference a human cannot see on two screens — case, a trailing
space, a non-breaking space, a zero-width character — the operator is told the pilot is blocked and
not what to fix. They can compare their own two source records, which is the right division of labour;
but an invisible difference defeats that too.

**The proposal.** Report, alongside the refusal, **whether the two values would be equal under a
normalisation NH refuses to apply** — case folding, Unicode NFC, and trimming — as three booleans and
nothing else:

```
SETTLEMENT_PAYER_MISMATCH
  wouldMatchIfCaseFolded:  true
  wouldMatchIfTrimmed:     false
  wouldMatchUnderNfc:      false
```

**Why this is safe.** It echoes **neither value, no substring, no length and no digest**. Three
booleans over a pair the operator already holds both halves of. It tells them *where to look* without
telling them *what the values are*, and it does not change the comparison by one byte: the refusal
still fires.

**Why it is a proposal and not done here.** It touches `externalSettlement.ts`, which is on the
`PROVEN` path, and this phase is read-only by instruction. It is also the kind of diagnostic that must
be argued before it is built, because every addition to a refusal message is a small leak budget.

**Owner: you.** It is a 20-line change plus tests, and it is the difference between a pilot that stalls
on an invisible character and one that fixes it in an hour.

---

## 8 · What the customer is actually asked to do

One paragraph, which is the whole commercial ask for B1:

> Choose one identifier for the paying entity — your own customer number is usually right. Make sure
> your billing system puts it on the corrective invoice record it signs for us, and ask your bank or
> PSP to quote **the same string, unchanged**, on the remittance advice they sign. Same case, same
> spacing, no added prefix. If the two differ by a single character we will refuse the settlement
> rather than guess, and we will tell you that they differ.

**No part of this requires NH to see your customer list.**

---

## 9 · What this document does NOT do

- It asserts **no** bank approval, no customer consent and no institution.
- It changes no code, no contract version and no refusal.
- It does not make the payer identifier a precondition for a first pilot: the settlement citation is
  optional, and `PROVEN` is reachable from signed outcome evidence alone.
- It turns no observed amount into Revenue Returned.
