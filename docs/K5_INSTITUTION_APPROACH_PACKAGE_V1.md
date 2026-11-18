# B2 · Approach package for a financial institution

**Status:** prepared, **not sent**. No institution has been contacted, named, or identified.
**Date:** 2026-11-18.

This is what NH would ask a bank or PSP for, and what it would commit to in return. It exists so the
first real conversation is about a defined, minimal request rather than an open one.

**Nothing in this document is an instruction to make contact.** Sending it is the owner's decision.

---

## 0 · The one-paragraph version, for the first email

> We have built a settlement-verification path that turns a bank's own signed statement about a
> payment into auditable evidence that a specific corrective invoice was collected. We are asking for
> a narrow pilot: one payer, one corrective invoice, one signed attestation per settlement. We need a
> public key delivered through a channel you publish, a signature over a fixed payload, and one agreed
> payer identifier. We do not need access to your systems, we hold no private key of yours, and we
> never ask you to assert anything about the amount owed — only about the money that arrived.

---

## 1 · What NH asks for, in four items

| # | Ask | Why it is the minimum |
|---|---|---|
| **A1** | A **public key** (Ed25519), delivered through a channel the institution publishes — not in a reply to our email | A key that arrives by the same path as the request proves nothing about who sent it. The channel is the only thing that ties the key to the institution. |
| **A2** | A **signature over a fixed payload** for each settlement: the institution's own settlement reference, the corrective invoice reference, the payer reference, amount, currency, finality, value date, and a single-use nonce | This is the whole mechanism. NH verifies the signature against the registered key and compares the signed facts against the case. |
| **A3** | The **fingerprint of that key confirmed on a second channel** — a call, a portal message, anything that is not the channel the key arrived on | A challenge-response succeeds against whatever key was substituted along with the challenge. Reading the fingerprint back is what closes substitution. |
| **A4** | **One agreed payer identifier**, quoted identically by the customer's billing system and by the institution's remittance | NH compares two independent statements about who paid. Nothing in software can make two institutions choose the same string; it is a clause, not a feature. |

### What NH does NOT ask for

Stated explicitly, because a narrow ask is only credible if the exclusions are named.

- **No access to any system of yours.** No API credentials, no portal login, no file-share account.
- **No private key.** NH holds the public half only and verifies; it never signs on the institution's
  behalf and never could.
- **No statement about what is owed.** `expected_amount` on the billing side is refused by NH's own
  contract — an institution asserting the expectation would be auditing the party it settles for.
- **No duplicate judgement.** NH never asks whether a payment is a duplicate: that is a conclusion NH
  must reach from evidence, not a field a counterparty supplies.
- **No customer-level data.** The payer reference, the invoice reference, the amount and the date. No
  names, no addresses, no account numbers beyond the reference the institution already quotes.
- **No change to your settlement process.** The attestation describes a settlement that happened; it
  does not sit in the payment path and cannot delay or block one.

---

## 2 · The evidence NH must gather about the institution, and who issues it

This is the part most likely to be misread as bureaucracy. It is not: it is the half a signature cannot
supply. **A valid signature proves control of a key and nothing about who holds it.**

| # | Condition | Evidence | Issued by | Can NH check it? |
|---|---|---|---|---|
| C1 | The channel is the institution's own | A record of how it was located — domain, contract clause, regulator register entry — with the date | the institution, published independently | **no** |
| C2a | The legal entity is real | Company registration number and legal name from the companies registry | a companies registry | **no** |
| C2b | This sender speaks for that entity | Confirmation that the individual or system supplying the key is authorised, obtained through C1's channel and **not** through the sender's own reply path | the institution, through its published channel | **no** |
| C2c | The entity is licensed | Its entry in the supervising authority's own register: licence number, permissions, current status | the financial regulator | **no** |
| C3 | Control of the key | A challenge-response over a nonce NH chooses, verified against the key about to be registered | the institution, under that key | **YES** |
| C2d | The key was not substituted | The fingerprint confirmed on a second, different channel | the institution | **no** |
| C4 | The ceremony is recorded | Channel, who confirmed, fingerprint, validity window, nonce and response, date, and the two NH identities | NH's operator | shape only |
| C2e | A second person approved | NH's own append-only governance ledger: one identity proposes, a **different** one verifies | NH's ledger | **YES** |

**Two of eight are mechanical. Six are claims NH records and cannot verify**, and the register stores a
non-blank citation for each so a bare tick is unrepresentable. That is the honest shape, and it is
generated from `src/contract/k5EvidenceCatalogue.ts` — the operator checklist in
`docs/K5_EVIDENCE_CHECKLIST_V1.md` is rendered from the same source, so it cannot drift.

### Signing authority

NH does **not** ask who at the institution is authorised, by name. It asks that the **role** be
confirmed through the institution's own published channel (C2b). Minimization: the pilot needs joins,
dates and amounts, not people. Names, where they exist at all, stay in the institution's own record and
in NH's out-of-band ceremony file — never in a row NH hashes and stores.

---

## 3 · The shared payer identifier — the one commercial clause

This is the only item that cannot be solved by either side alone, and it is worth putting in front of
the institution early rather than discovering it at reconciliation.

**The requirement.** The corrective invoice the customer's billing system raises and the remittance the
institution sends must quote the **same** payer identifier.

**Why NH cannot fix it.** Both statements are signed by institutions NH does not control. If billing
names the payer by its own customer number and the bank names it by an account identifier or a
free-text remittance line, both statements are honest, both verify, and they do not match.

**What NH refuses to do about it, and why.**

- **No mapping table.** A mapping maintained by the customer's own team would hand the beneficiary
  control over which settlement matches which case — the exact lever the comparison exists to remove.
- **No fuzzy matching.** Amount and date proximity are the first things that look like a match and the
  first things an unrelated payment also satisfies. Matching on them would make NH the author of the
  relationship it is supposed to be reading.

**What happens until it is agreed.** Every cited settlement is refused, by name:
`SETTLEMENT_PAYER_MISMATCH` when both sides are attested and disagree,
`SETTLEMENT_CASE_PAYER_NOT_RECORDED` when billing has not signed one at all. The pilot produces no
proof. That is the correct outcome, not a defect.

**Owner:** the customer's finance owner, with the institution.

---

## 4 · Pilot scope

| | |
|---|---|
| **Boundary** | one |
| **Institution** | one |
| **Payer** | one |
| **Recovery Case** | one |
| **Corrective invoice** | one |
| **Settlement** | one arrival, one attestation |
| **Duration** | as long as one correction takes to be raised and paid |
| **Volume** | one signed payload per settlement. No feed, no polling, no batch. |

### Explicitly out of scope

- Settlements summed across more than one institution — refused by name, because two attestations are
  two statements about two arrivals and adding them asserts a relationship neither makes.
- Foreign exchange — NH holds no rate.
- Partial settlement scaling a proof down — a short total refuses rather than being restated as a
  smaller recovery.
- Any detector family other than the one that opened the case.
- Production migration and the production digest key. Neither is executed; both are listed in
  `docs/PILOT_PRODUCTION_REQUIREMENTS_V1.md`.

---

## 5 · What NH commits to

| # | Commitment | How it is enforced, not promised |
|---|---|---|
| K1 | NH never holds a private key of yours | NH only verifies. There is no signing path for an external key anywhere in the codebase. |
| K2 | NH stores no confirmable payment identifier | The ledger holds a **keyed pseudonym** — HMAC-SHA256 under a server-held key — of your settlement reference, never the value. |
| K3 | A refusal never echoes your data | Refusals are codes-only by rule; a test performs the attack and asserts no reference or amount reaches the output. |
| K4 | One arrival is counted once | A unique index, not a read-then-check. Proved under two simultaneous approvals. |
| K5 | A signature is single-use | The nonce is recorded; a replay refuses under its own distinct code. |
| K6 | **A verified signature is never presented as a verified institution** | `signatureAloneLeavesRefusals()` derives what remains outstanding when every cryptographic condition is met. It is a function, not a sentence. |
| K7 | Withdrawing your participation reverses nothing | Authority is answered **as of an instant**, so what an attestation was authorised by at the time it stays authorised by. A withdrawal changes future decisions only. |
| K8 | You can be told exactly what rests on a key | If a key is ever compromised, NH can place every arrival that rests on it inside or outside the exposure window — and an arrival whose signing instant was never recorded is reported as **unplaceable**, never as unaffected. |

---

## 6 · What a successful pilot does and does not establish

**Does:** that a bank's signed statement about one real arrival of money can be verified against one
real Recovery Case, that the money is counted once, and that every shortcut is refused by name.

**Does not:**

- It does **not** make NH's detection broader. The pilot measures the settlement path.
- It does **not** reach `AUTHORITY_VERIFIED` on the strength of signatures. That rung needs a channel
  whose corroborating party is not party to the claim — the strongest candidate being **independent
  third-party reconciliation of NH's claimed arrivals against the institution's own statement**, which
  is also the only item in §5 that nobody at NH or the customer can fake.
- It does **not** license a figure. A fully passing pilot is **`BEHAVIOUR_CONFIRMED · PROVISIONAL`**,
  never `VERIFIED` and never `ACCEPTED` — a rule written before any run, because passing cannot clear
  what passing does not touch.

---

## 7 · Stop conditions NH will act on during the pilot

Shared with the institution deliberately: a counterparty should know what would make us stop.

1. Two **attested** statements disagree about who the payer is.
2. A governed row no longer matches its own witness.
3. A key is found compromised — every arrival resting on it is placed before any further proof.
4. An arrival is refused as already counted when nobody expected it.
5. Anything we claim appears in a log or a refusal that should not.
6. Anyone proposes widening a control to make the pilot pass.

---

## 8 · What is needed before this is sent

| # | Item | Owner |
|---|---|---|
| 1 | A decision to approach an institution at all | **the owner** |
| 2 | Which institution, and through what existing relationship | **the owner** |
| 3 | A customer willing to run one case, with a finance owner who can agree §3 with their bank | **the owner** |
| 4 | Two governance identities at NH | **the owner** |
| 5 | The production migration and digest key, when the pilot moves off isolated databases | **the owner**, per item |

**Nothing above has been done, and no contact has been made.** Every figure anywhere in this repository
is synthetic, and **no observed amount has become Revenue Returned.**
