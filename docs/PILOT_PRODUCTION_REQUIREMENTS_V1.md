# Financial pilot · production requirements, stop conditions and control plan

**Status:** a requirements list. **Nothing in it has been executed.**
**Date:** 2026-11-18.

Every figure referenced anywhere in this repository is synthetic. **No observed amount became Revenue
Returned**, and nothing below changes that.

This document exists because the settlement path is now built and tested end to end against isolated
databases, and the next step is not more code — it is a set of decisions and operations that only the
owner can authorise. Each item states what it is, why it is needed, who owns it, and what happens if
it is skipped.

---

## 1 · The two things that block a real pilot, and neither is code

| # | Blocker | Owner | Why NH cannot close it |
|---|---|---|---|
| **B1** | Billing and the bank must quote the **same payer identifier** | the customer's finance owner, with their bank or PSP | Both statements are signed by institutions NH does not control. If they choose different identifiers both are honest, both verify, and they do not match. Software can compare them; it cannot make them agree. A mapping table maintained by the customer's own team is **refused** — it would hand the beneficiary control over which settlement matches which case — and so is matching on amount, date or name resemblance. |
| **B2** | An institution must be **independently verified** | the owner — it needs a real institution and a decision to onboard one | Six of the eight K5 conditions need evidence from outside this system: a company registry, a regulator's register, a signatory schedule, a published channel, an out-of-band fingerprint and a recorded ceremony. No provenance channel reaching `AUTHORITY_VERIFIED` is implemented, and none can be without a counterparty. |

Until both are closed: the authority ceiling stays `SOURCE_ATTESTED`, every readiness level stays
**PROVISIONAL**, and the pilot's verdict vocabulary tops out at **`BEHAVIOUR_CONFIRMED · PROVISIONAL`**
— never `VERIFIED` and never `ACCEPTED`. Passing cannot clear what passing does not touch.

---

## 2 · Production requirements · NOT EXECUTED

### 2.1 Migrations

Three schema designs live in `scripts/migration-design/` and **deliberately not** in
`prisma/migrations/`. A file in `prisma/migrations/` is applied by `prisma migrate deploy` on every
deploy, so committing one would *be* the production schema change, pending nothing but a deploy.

| design | tables | applied to |
|---|---|---|
| `settlement-key-register-up.sql` | `settlement_signing_keys`, `settlement_signing_key_events` | disposable test databases only |
| `settlement-ledger-up.sql` | `settlement_consumptions` | disposable test databases only |
| `institution-register-up.sql` | `governed_institutions`, `governed_institution_events`, `governed_institution_verifications` | disposable test databases only |

**To go to production, each needs, in this order:**

1. An owner's explicit authorisation naming the design file and the target environment.
2. Promotion into `prisma/migrations/` as a dated migration — **unchanged**, so that what was tested is
   what is applied.
3. A dry run against a restored copy of the production database, not a fresh one: a fresh database
   proves the DDL parses and nothing about colliding with what is already there.
4. `nh_reject_mutation()` confirmed present. All three designs depend on it from the EP-2 immutability
   migration; a target lacking it fails at the trigger and leaves the tables unprotected if the error
   is ignored.
5. The rollback script tested **on the same restored copy**, with its own limit stated: once a real
   institution is verified or a real arrival is claimed, a `DROP` is **destruction of governance
   evidence, not a rollback**. From that point the correct reverse is `WITHDRAW`/`REVOKE` through the
   ledger, or a corrective claim — never a drop.

**One amendment licence ends at production.** `settlement-ledger-up.sql` was *amended* rather than
`ALTER`ed twice, on a premise proved three ways: nothing in `prisma/migrations/` creates the table, its
only consumer is a disposable per-test database, and `claim()` had no caller outside its own test. **The
moment any durable database holds that table, that licence is void** and the correct form is an `ALTER`.

### 2.2 `NH_SETTLEMENT_DIGEST_KEY`

The ledger stores a **keyed pseudonym** of a bank's settlement reference — `hmac-sha256:<64 hex>` under
a server-held key — never the reference itself. So the ledger holds no confirmable payment identifier,
and a reader who obtains the table cannot test a guessed reference against it without the key.

| requirement | detail |
|---|---|
| **generation** | 32 bytes from a CSPRNG. Not derived from any other secret, not a passphrase. |
| **storage** | the deployment's secret store. Never in a repository, a `.env` committed anywhere, a log, a CI variable visible in build output, or this document. |
| **availability** | the approval path **fails closed** without it: no digest, no claim, no proof. |
| **rotation** | `settlementLedgerStore.claim()` **refuses** when the stored `digest_key_fingerprint` does not match the running key's. That is deliberate: a rotated key would compute a different pseudonym for the same arrival, so one-arrival-counted-once would silently stop holding. A rotation is therefore a **governed operation with its own plan**, not a routine credential roll. |
| **fingerprint** | `settlementDigestKeyFingerprint()` is an HMAC over a fixed label, truncated — it identifies the key without revealing it, so a mismatch is detectable without storing the key anywhere. |

**Not executed. No key has been generated, and none is present in any environment.**

### 2.3 Operational prerequisites

| # | requirement | why |
|---|---|---|
| P1 | At least one registered settlement key, **activated by a second identity** | `ProposeSettlementKey` and `ActivateSettlementKey` are held by different roles; a key nobody independently activated is a key the proposer put in force. |
| P2 | A `VERIFIED` institution for that key's `(boundary, source_system)` | Without it the authority ceiling cannot exceed `SOURCE_ATTESTED`. See `docs/K5_INSTITUTION_ADMISSION_V1.md`. |
| P3 | Signed evidence from billing carrying `payerExternalRef` | The case's payer comes **only** from a source system's signature — not the request (the beneficiary) and not the detector (the customer's own extract). Without it every cited settlement refuses. |
| P4 | A bank attestation endpoint or file drop, with the agreed payload | The attestation signs an ordered payload with a single-use nonce. The format is fixed by `sourceSigningPayload`; the institution's integration team implements the signer. |
| P5 | Two governance identities at NH | Propose ≠ verify for institutions, propose ≠ activate for keys, author ≠ approver for proofs. One person cannot run this pilot. |

---

## 3 · Stop conditions

**Any one of these stops the pilot. None is waivable by whoever is running it.**

| # | condition | why it stops rather than warns |
|---|---|---|
| S1 | A payer mismatch appears between two **attested** statements | Two institutions disagree about who this case concerns. Resolving it by choosing one would be NH deciding an identity question on an arbitrary rule. |
| S2 | `INSTITUTION_WITNESS_MISMATCH` or a key witness mismatch | A governed row changed after it was registered. The register must be investigated, not re-registered over — re-registering replaces the evidence rather than explaining it. |
| S3 | A settlement key is found compromised | Every arrival resting on it must be placed inside or outside the exposure window before any further proof. Arrivals whose signing instant was never recorded are **unplaceable, never read as unaffected**. |
| S4 | An arrival is refused `SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM` unexpectedly | Either the bank re-sent an arrival under a new reference, or two cases are claiming one payment. Both need an answer before any further claim. |
| S5 | The digest-key fingerprint does not match | The ledger's identity function has changed under it. Counting-once has stopped holding for every arrival recorded before the change. |
| S6 | A proof reaches `PROVEN` on a path nobody expected | The gate is the only route. An unexpected one is a bypass, which this repository has already found once. |
| S7 | A real customer identifier appears in a log, a refusal message or a report | Refusals are **codes-only** by rule. A leak means a sanitization boundary has moved. |
| S8 | Anyone proposes to widen a control to make the pilot pass | *Do not conceal failures or weaken assertions merely to obtain green results.* A refusal that is correct is a result, not an obstacle. |

---

## 4 · Risks, ranked by what they would cost

| # | risk | likelihood | cost if it happens | mitigation in place |
|---|---|---|---|---|
| R1 | **Payer identifiers never agree**, so the pilot refuses every settlement | **high** — it is the default unless someone agrees a clause | the pilot produces no proof at all | stated as B1 with a named owner, before anybody builds against it; the refusal is loud and named rather than silent |
| R2 | **A signature is read as institutional verification** | medium — it is the natural misreading | a proof rests on a keypair anyone could generate | `signatureAloneLeavesRefusals()` derives the gap; a test asserts no channel reaching `AUTHORITY_VERIFIED` is implemented; the attestation entry in the data contract says it in terms |
| R3 | **One arrival substantiates two proofs** | low | double-counted revenue — the worst failure available | a unique index is the control and the gate's read is the diagnosis; proved under two simultaneous approvals |
| R4 | **The beneficiary authors the institution claim** | **present today** | an unevidenced identity claim inside a K5 ceremony | found and reported (§6 of the admission doc), pinned by three tests, **not patched** — it changes the HTTP contract |
| R5 | **A production migration applied without a restored-copy dry run** | medium | a failed deploy, or tables created without their triggers | §2.1 step 3, and the explicit note that a fresh database proves nothing about collisions |
| R6 | **A digest key rotated as a routine credential roll** | medium | counting-once silently stops holding | `claim()` refuses on a fingerprint mismatch rather than computing a new pseudonym |
| R7 | **A green pilot is quoted as acceptance** | **high** — it is what everyone wants to hear | a synthetic result presented as a verified one | the verdict rule is written before any run, caps at `BEHAVIOUR_CONFIRMED · PROVISIONAL`, and a test asserts the string contains neither `VERIFIED` nor `ACCEPTED` |
| R8 | **An institution is revoked and someone expects proofs to reverse** | low | either a false reversal or a false reassurance | the ceiling is answered **as of an instant**; revocation reverses no proof and the exposure is *reported* |

---

## 5 · Ownership

| area | owner |
|---|---|
| authorising a production migration, a digest key, a deploy | **the owner, explicitly, per item** |
| the shared payer identifier | the customer's finance owner, with their bank or PSP |
| the bank-side attestation signer | the institution's technical owner |
| billing-side signed evidence carrying the payer reference | the customer's billing / ERP technical owner |
| the six out-of-band K5 citations | the owner |
| the second governance identity | the owner |
| whether `institutionIdentityVerified` becomes derived (R4) | the owner — it is an HTTP contract change |
| whether `settled_at`-style refusals should reject a row (open contract questions) | the owner |

---

## 6 · Control plan

**Before anything is enabled**

1. Confirm the branch's commits are the ones intended, by SHA.
2. Run the full regression: root suite with and without a database, `test:ep2`, the browser journey,
   all six verifiers, every typecheck, purity, build. Record the counts.
3. Confirm **no** production migration is in `prisma/migrations/` that was not authorised by SHA.
4. Confirm the digest key exists in the target secret store and **nowhere else**.

**At each enablement step, one at a time**

5. Enable the external-settlement path for **one** boundary. Not globally.
6. Register one key; have a **different** identity activate it.
7. Propose one institution; have a **different** identity verify it, with all six citations present.
8. Run one case end to end. Expect a refusal if B1 is unresolved — **that refusal is the correct
   result**, not a failure of the step.

**Continuously**

9. Every refusal code that fires is recorded with its case and its cause. A refusal nobody looked at
   is a control nobody is operating.
10. Any arrival whose signing instant is absent is counted as **unplaceable** and reported as such.
11. Reconcile NH's claimed arrivals against the institution's own statement **independently** — monthly
    at least. This is the only check in the plan whose corroborating party is not party to the claim,
    and it is the one that would eventually justify `AUTHORITY_VERIFIED`.
12. Any stop condition in §3 halts the pilot and is reported to the owner before anything else happens.

---

## 7 · What is NOT in this plan, deliberately

- **Settlements summed across more than one institution.** Refused by name: two attestations are two
  statements about two arrivals, and adding them asserts a relationship neither makes.
- **Foreign exchange.** NH holds no rate, and a governed rate is a source fact nobody has supplied.
- **Partial settlement scaling a proof down.** The claim is the claim; a short total refuses rather than
  being quietly restated as a smaller recovery.
- **Any detector family other than the one that opened the case.** The pilot measures the settlement
  path, not detection reach.
- **A route, a screen or any production consumer of the institution register.** It is built, tested and
  imported by nothing in production. Wiring it is its own slice with its own evidence.
