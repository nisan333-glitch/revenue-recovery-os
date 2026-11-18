# B2 · Institution track — evidence list, approach wording, verification process, stop conditions,
# and the synthetic-only fallback

**Status:** prepared. **No approach has been sent and no institution is named or contacted.**
**Date:** 2026-11-18. Builds on `docs/K5_INSTITUTION_APPROACH_PACKAGE_V1.md`, which stands; this adds
the four things that package left to the owner, and one correction.

---

## 0 · The correction that reframes this track

`docs/K5_INSTITUTION_APPROACH_PACKAGE_V1.md` reads as though an institution were needed for a first
pilot. **It is not.** `citedSettlements` is optional on the approval request and can only add
refusals; `PROVEN` is reached from signed outcome evidence alone (`src/domain/outcomeEvidence.ts`).

So this track buys **one specific upgrade**: it moves a proof from *the customer's own system of record
attested it* to *a party with no interest in the number corroborated it*. That is the difference
between a figure a CFO can audit internally and a figure an external auditor can rely on — valuable,
and **not** the first milestone.

**Consequence for sequencing:** run pilot #1 without a bank. Open this track in parallel, because the
lead time is months and it is the only path to `AUTHORITY_VERIFIED`.

---

## 1 · Evidence the institution must provide

Six items. Two more are established by NH and are listed so the ask is visibly complete.

| # | item | form | issued by | NH can check? |
|---|---|---|---|---|
| **E1** | **Published channel** for key delivery — a page on their own domain, a clause in the existing contract, or an entry in a regulator's register that names it | a URL or a document reference, plus a record of how NH located it independently | the institution, published | **no** |
| **E2** | **Legal entity** — registered name and company number, or an LEI | a registry extract, dated | a companies registry | **no** |
| **E3** | **Regulatory standing** — licence or authorisation number, the permissions it covers, current status | the regulator's own register entry, dated | the financial regulator | **no** |
| **E4** | **Authorised role** — written confirmation that the role supplying the key may do so, obtained through E1's channel and **not** through the sender's reply path | a message or letter via the published channel | the institution | **no** |
| **E5** | **Key control** — a signature over a nonce NH chooses, under the key being registered | the nonce, the response, and NH's verification result | the institution, under that key | **YES** |
| **E6** | **Fingerprint confirmation** — the public key's fingerprint read back on a **second**, different channel | a call log or portal message recording the confirmation | the institution | **no** |
| — | *Ceremony record* | channel, who confirmed, fingerprint, window, nonce, date, both NH identities | NH's operator | shape only |
| — | *Second person* | one NH identity proposes, a **different** one verifies | NH's append-only ledger | **YES** — a database trigger refuses the alternative |

**Two of eight are mechanical.** The other six are claims NH records and cannot verify, each stored as
a **non-blank citation** so a bare tick is unrepresentable. Nothing about this list is negotiable
downward: the register refuses `INSTITUTION_CITATION_MISSING` and names every missing one.

**No person is named.** E4 confirms a **role**. Minimization — the pilot needs joins, dates and
amounts, not people.

---

## 2 · Approach wording — short, professional, unsent

> **Subject:** Signed settlement confirmations for an audited revenue-recovery pilot
>
> We are running a small, auditable pilot with one of your customers. When they issue a corrective
> invoice and you receive the payment, we would like a signed confirmation from you that the money
> arrived.
>
> Concretely, we are asking for three things:
>
> 1. **A public key**, delivered through a channel you publish — not in a reply to this message. We
>    hold the public half only; we never hold, and cannot use, a private key of yours.
> 2. **A short signed statement per settlement**: your own reference for the payment, the invoice it
>    pays, the payer identifier your customer has agreed with you, the amount, the currency, whether
>    the funds are final, and the value date. The payload format is fixed and documented; it is one
>    JSON object and one Ed25519 signature.
> 3. **A fingerprint confirmation** on a second channel, so we can be sure the key we registered is
>    the key you published.
>
> We are **not** asking for access to any of your systems, for credentials, for a feed, for a portal
> account, or for any customer-level data beyond the fields above. We never ask you to state what was
> owed — only what was received. The confirmation describes a settlement that has already happened and
> sits nowhere in your payment path, so it cannot delay or block one.
>
> On our side: we store a keyed pseudonym of your reference and never the reference itself; a refusal
> from our system never echoes your data; and a verified signature is recorded as proof that a
> registered key was used — never as a statement that we have verified your institution. Those are
> separate records in our system, by design.
>
> Volume for the pilot is one signed statement per settlement, on the order of single digits. Happy to
> send the payload specification and answer technical questions before anyone commits to anything.

**Not sent. No recipient, no institution, no date.** Sending it is the owner's decision.

---

## 3 · Identity and authorisation verification process

Nine steps, in order. Each either produces a stored citation or is refused.

1. **Locate the channel independently (E1).** From the institution's own domain, the existing
   contract, or a regulator's register — never from the message that offered the key. Record how.
2. **Establish the legal entity (E2)** from a companies registry. Record the number, the name as
   registered, the jurisdiction and the date.
3. **Establish regulatory standing (E3)** from the supervising authority's register. A real company is
   not necessarily one permitted to settle payments; these are different facts from different
   authorities and conflating them would let a dissolved or unlicensed entity pass.
4. **Confirm the authorised role (E4)** through E1's channel. An entity being real does not make a
   particular sender its agent, and a compromised mailbox inside a genuine institution is the most
   ordinary form of this attack.
5. **Propose the institution** in the governed register. One NH identity, with all six citations and
   the facts from steps 2–3. State `PROPOSED`.
6. **Receive the key** through E1's channel, and **challenge it (E5)**: NH chooses a fresh nonce, the
   institution signs it, NH verifies against the key it is about to register.
7. **Confirm the fingerprint (E6)** on a second channel.
8. **Verify the institution** — a **different** NH identity, with every citation present and the
   registered key named. A database trigger refuses a row where the verifier is the proposer. State
   `VERIFIED`.
9. **Activate the key.** The activation gate derives the institution's state for the key's own
   `(boundary, sourceSystem)` and refuses unless it is `VERIFIED`.

**What each step does not establish** is recorded with it. E5 proves control of a key and nothing
about who holds it; E2 proves the entity exists and nothing about this sender; the ceremony record is
checked for completeness, not for truth.

---

## 4 · Stop conditions for this track

Any one halts the track and is reported to the owner before anything else happens.

1. The institution will not deliver the key through a channel it publishes, and offers a reply-path
   delivery instead.
2. The regulator's register does not list the entity, or lists it as other than current.
3. The authorised-role confirmation arrives through the sender's own reply path.
4. The fingerprint cannot be confirmed on a second channel.
5. The institution asks to state the **expected** amount, or to mark a payment as a duplicate. Both
   are refused by contract: billing stating the expectation is billing auditing itself, and
   duplication is a conclusion NH must reach, never a field a counterparty supplies.
6. Anyone proposes to register the institution on fewer than the six citations, or to tick a condition
   without a record behind it.
7. A governed row stops matching its own witness.
8. The institution requires NH to hold a private key, or to place the confirmation inside their
   payment path.

---

## 5 · The synthetic-only fallback, if no institution cooperates

**This is the plan of record until an institution says yes**, not a consolation prize.

| | with a cooperating institution | synthetic-only |
|---|---|---|
| detection | real customer extracts | real customer extracts — **unchanged** |
| correction | real corrective invoice | real corrective invoice — **unchanged** |
| outcome evidence | customer's billing system signs | customer's billing system signs — **unchanged** |
| `PROVEN` reachable | yes | **yes** |
| settlement citation | real bank attestation | **omitted** — it is optional |
| authority ceiling | `SOURCE_ATTESTED`, rising only when all six citations exist | `SOURCE_ATTESTED` |
| what the figure means | *the system of record attested it, and a third party corroborated the arrival* | *the system of record attested it* |
| verdict vocabulary | `BEHAVIOUR_CONFIRMED · PROVISIONAL` | `BEHAVIOUR_CONFIRMED · PROVISIONAL` |

**The only thing lost is third-party corroboration of the arrival.** Everything else about the pilot —
real detection, real money, a real corrective invoice, a real signed collection, separation of duties,
one-arrival-counted-once, an auditable proof — is identical.

**And the settlement machinery can still be exercised synthetically** against the institution register
with a synthetic bank, exactly as CI does today: a signed attestation, an atomic claim, the replay and
double-count refusals, the compromise report. That demonstrates the capability to a prospect without
claiming an institution was verified. The fixture names itself *(NOT A REAL INSTITUTION)* in the legal
entity field, so a screenshot cannot be mistaken for a real one.

---

## 6 · What this track does NOT establish

- **No institution is verified — not one.** The register is empty.
- `THIRD_PARTY_RECONCILIATION.implemented` stays `false`, and a test asserts no channel reaching
  `AUTHORITY_VERIFIED` is implemented, so the rung cannot open by editing a flag.
- A verified signature is never a verified institution. `signatureAloneLeavesRefusals()` derives what
  remains outstanding when every cryptographic condition is satisfied; it is a function, not a
  sentence.
- Nothing here has been sent, and no observed amount became Revenue Returned.
