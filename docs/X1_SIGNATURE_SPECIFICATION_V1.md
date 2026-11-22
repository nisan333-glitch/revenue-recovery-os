# X1 · What the customer's billing system must sign

**Status:** specification. **No key is registered, no institution is named, no customer has been asked,
and nothing in this document is wired to a key store.** Date: 2026-11-22.

Every constant below — the scheme ids, the tuple order, the accepted evidence types, the signature
shape and the freshness window — is **pinned to the code by
`server/services/x1SignatureSpec.test.ts`**, which reads the modules that will actually judge a
customer's attestation and fails if this page drifts from them. *A customer-facing claim about what a
field is worth is generated from the behaviour of the code that will judge their file, never authored
beside it.*

---

## 0 · Why there are two signatures and not one

`PROVEN` is reached from signed outcome evidence alone — no bank is required (see
`docs/PILOT_BLOCKER_MAP_V1.md` §0). What is required is that **two different facts** are attested by a
system the beneficiary does not control:

| # | the fact | the gate that reads it | what a missing signature costs |
|---|---|---|---|
| **S1** | *we raised the corrective charge* | `src/domain/executedCorrection.ts` | `CORRECTION_NOT_AUTHENTICATED` — a recovery reason **names** a mechanism, it does not evidence one |
| **S2** | *this amount was collected* | `src/domain/outcomeEvidence.ts` | `OUTCOME_EVIDENCE_NOT_AUTHENTICATED` — a beneficiary may not substantiate their own collection |

Both gates require the same three properties on the record: `sourceVerified`, **not**
`beneficiaryControl`, and `trustClassification === "independent"`. That classification is assigned by
`server/services/evidenceStore.ts` **only** when a signature verified — an operator cannot set it.

**S1 must be recorded strictly before S2.** `executedCorrection` compares ingestion times and refuses
on equality, because `timestamp(3)` can place two writes in the same millisecond and *an order a clock
alone cannot separate is not an order*. Send the corrective-invoice attestation when you raise the
charge, not in one batch at the end.

### What "independent" does and does not mean here

It means **signed by a registered source system**. It is the system of record attesting — *not* a third
party. The customer's own billing system is not economically independent of the customer. That is why
this pilot's figure is **PROVISIONAL**, and why `AUTHORITY_VERIFIED` needs a party not party to the
claim. Stated here because it will otherwise be misread.

---

## 1 · The key

* **Algorithm: Ed25519.** Nothing else is accepted — `SourceVerifier` rejects any key whose
  `asymmetricKeyType` is not `ed25519` at construction.
* **The customer holds the private half. NH never receives it, and cannot use one.** NH is given the
  **public** key in SPKI PEM form.
* NH's operator registers it in `NH_EVIDENCE_SOURCE_KEYS`, a JSON array of
  `{ "keyId": "...", "sourceSystem": "billing", "publicKey": "-----BEGIN PUBLIC KEY-----\n..." }`.
* `keyId` must be unique across the registry; a duplicate is refused at startup.
* **The key's `sourceSystem` must equal the claim's `sourceSystem`.** A key registered for `billing`
  cannot sign a claim that names any other source. This is checked before the signature is.

**No key is registered today.** The registry is empty, and populating it for a real customer is a
secret-store operation with an owner — it is not done by this document.

---

## 2 · The signed bytes, exactly

The signature covers a **JSON array serialised with `JSON.stringify`**, UTF-8, with no whitespace. An
ordered tuple rather than an object, so there is no key-order ambiguity and no caller-chosen shape.

**Scheme `nh-evidence-v1`** — a claim with **no** payer reference:

```
["nh-evidence-v1", caseId, evidenceId, sourceSystem, sourceRecordId,
 evidenceType, observedAt, amountMinor, currency, issuedAt]
```

**Scheme `nh-evidence-v2`** — a claim **with** a payer reference (`payerExternalRef` is inserted
immediately before `issuedAt`, so v2 is v1 with one element added and never a reordering):

```
["nh-evidence-v2", caseId, evidenceId, sourceSystem, sourceRecordId,
 evidenceType, observedAt, amountMinor, currency, payerExternalRef, issuedAt]
```

**The scheme is selected by the claim's own shape, never declared by the caller.** NH builds the tuple
from the claim it received and verifies against that. Consequently **neither direction of tampering
survives**: adding a payer reference to a v1-signed claim makes NH build v2 and the stored signature
stops matching; stripping one from a v2-signed claim makes it build v1, and that fails too.

### The elements

| element | type | notes |
|---|---|---|
| `caseId` | string | NH's Recovery Case id. NH gives it to you; it is not yours to choose. |
| `evidenceId` | string | your id for this attestation, unique per case |
| `sourceSystem` | string | `"billing"` for both S1 and S2 (see §3) |
| `sourceRecordId` | string | your own record's id — the invoice number, the payment id |
| `evidenceType` | string | one of the values in §3 |
| `observedAt` | string | ISO-8601 UTC, when the event happened **in your system** |
| `amountMinor` | integer **or** `null` | **minor units** — 1 234.56 USD is `123456`. Required for S2. |
| `currency` | string **or** `null` | ISO-4217, e.g. `"USD"`. Required for S2. |
| `payerExternalRef` | string | v2 only — see §5 |
| `issuedAt` | string | ISO-8601 UTC, when you **signed**. Always last. |

`amountMinor` and `currency` are `null` in the tuple when the claim omits them — **they are not
dropped**. Omitting an element shortens the tuple and the signature will not verify.

---

## 3 · Which `evidenceType` to use

The role is **derived** from `(sourceSystem, evidenceType)` against a versioned allowlist. It is never
accepted as a request field, because a caller who could name the role could promote supporting
material into the outcome evidence a proof is summed from.

| signature | `sourceSystem` | `evidenceType` — use either | derived role |
|---|---|---|---|
| **S1** the corrective charge was raised | `billing` | `corrective_invoice_issued` · `billing_corrected` | `correction` |
| **S2** the money arrived | `billing` | `invoice_paid` · `payment_received` | `outcome` |

Anything else derives `supporting`, which **substantiates nothing** — it satisfies neither gate.

> **A credit note is deliberately absent.** It corrects billing in the opposite direction: money the
> company may owe back. Accepting it as evidence that a shortfall was fixed would invert the sign
> convention — `residual = expected − observed`, where negative is a liability signal and never
> exposure. Do not send one as S1.

---

## 4 · What NH does with it, and what refuses

The attestation is sent beside the claim as
`{ "keyId": "...", "issuedAt": "...", "signature": "<base64>" }`.

Checks, in order — **all of them before the signature is verified**, so an invalid request never
reaches the cryptography:

1. `keyId` is in the registry.
2. the key's `sourceSystem` equals the claim's `sourceSystem`.
3. `issuedAt` parses **and round-trips**: `new Date(Date.parse(x)).toISOString() === x`. So it must be
   the canonical ISO form, e.g. `2026-11-22T09:15:00.000Z`. `2026-11-22T09:15Z` is refused.
4. **freshness**: at most **30 seconds** in the future and at most **5 minutes** old. Sign at the
   moment you send. This is a replay bound, not a convenience window.
5. the signature matches `^[A-Za-z0-9+/]{86}==$` — standard base64 of the 64 raw Ed25519 bytes. Not
   hex, not base64url, no newlines.
6. the signature verifies over the tuple **NH rebuilt**, not over anything you declared.

Any failure is one refusal — `source attestation is invalid or expired` — and it **does not say
which check failed**. That is deliberate: a precise answer is an oracle. Use the conformance vectors in
§7 to find the problem on your side.

**On success NH stores a receipt** holding the method, key id, both timestamps, the SHA-256 of the
payload, the signed payload itself, the signature and the public key PEM. The proof is therefore
re-verifiable years later without NH being trusted to have checked correctly at the time.

---

## 5 · `payerExternalRef` — only if a bank will also attest

Optional, and **its absence is not a default**. Include it only when the settlement citation is in
scope; the citation is optional and a first pilot does not need one.

If you do include it, it must be **the same string, unchanged**, that your bank or PSP quotes on the
remittance they sign. The comparison is byte-exact: no trimming, no case folding, no Unicode
normalisation. `ACME-001` and `acme-001` refuse. See `docs/B1_PAYER_IDENTIFIER_CONTRACT_V1.md`.

---

## 6 · What NH will not accept, and why

| asked for | answer |
|---|---|
| a shared secret / HMAC instead of a key pair | **no** — NH would then hold material able to forge your attestation |
| NH holding your private key, or signing on your behalf | **no** — it is the Trust Invariant's standing test answered the wrong way |
| the role (`outcome` / `correction`) as a request field | **no** — derived from the allowlist above |
| `trustClassification: "independent"` as a request field | **no** — assigned only when a signature verified |
| a longer freshness window "because our batch runs nightly" | **no** — sign at send time; the window is a replay bound |
| a credit note as S1 | **no** — §3 |
| back-dating `issuedAt` to cover a late send | **no** — it is inside the signature and checked for freshness |

---

## 7 · Conformance, before anyone touches a real case

A customer can prove their signer is correct **without NH, without a case and without a key being
registered**, because the payload is a pure function. The procedure:

1. Generate a **throwaway** Ed25519 pair.
2. Build the tuple of §2 from fixed test values.
3. Sign the UTF-8 bytes of its `JSON.stringify` form.
4. Verify locally with the public half.

`server/services/x1SignatureSpec.test.ts` performs exactly this against the production
`sourceSigningPayload` and `SourceVerifier` with an ephemeral key, and prints the byte-level
expectations. It is the executable half of this page.

**No vector in this document uses a real key, a real case, a real invoice or a real payer.**

---

## 8 · What this specification does NOT do

- It registers **no key** and names **no customer or institution**.
- It does not make an attestation third-party corroborated: the signer is the system of record, so
  every figure it supports stays **PROVISIONAL**.
- It changes no code, no contract version, no scheme id and no refusal.
- It turns no observed amount into Revenue Returned.
