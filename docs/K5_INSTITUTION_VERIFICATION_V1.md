# K5 · verifying a financial institution and its official channel

**Date:** 2026-11-16 · **REQUIREMENTS, not an implementation** · the ceremony itself is G3
**Baseline:** `67dfa0e` (G2, CI #343 6/6) plus G2's routes and G4 built locally
**Governing instruction (owner, 2026-11-15):** *do not assume a challenge-response alone proves the
institution's identity.* Correct, and this document is written from that premise rather than around it.

---

## 0 · The premise, stated so nothing below can quietly drop it

> **NO INSTITUTION IS VERIFIED YET. NOT ONE.** There is no bank, no PSP, no channel, no fingerprint and
> no contact on record anywhere in this repository. Everything here is what would have to be true
> *before* a first key is activated, and the code already refuses the alternative: `keyMayBeActivated`
> returns false unless **all four** ceremony facts are stated, and `institutionIdentityVerified` is one
> of them.

> **A CHALLENGE-RESPONSE PROVES CONTROL OF A KEY. IT PROVES NOTHING ABOUT WHO HOLDS IT.** Anyone can
> generate an Ed25519 pair and answer a nonce challenge perfectly. So C3 is **necessary and never
> sufficient**, and the four facts are four separate booleans precisely so control cannot wear
> identity's guarantee.

---

## 1 · What must be verified, and who can verify it

Four things, and they fail independently. Collapsing any two would let one stand in for the other.

| # | Fact | What establishes it | What does NOT |
|---|---|---|---|
| **V1** | **The institution exists and is the one we contracted with.** | A regulator's own register — the FCA Register, the ECB/SSM list, an NMLS or state banking entry, a central-bank licence number — looked up **by us**, matched against the signed contract's legal entity name and registration number. | A letterhead. A domain name. An introduction by the customer, who is the beneficiary of a larger number. |
| **V2** | **The channel the key arrives through is the institution's own.** | A key published on a host the institution controls, retrieved over TLS whose certificate chains to that legal entity, **or** a fingerprint confirmed out of band on a number taken from the regulator's register rather than from the email. | An email attachment. A link sent in the same thread as the key. A portal the customer operates. |
| **V3** | **The person who hands it over is authorised to.** | A named role on the institution's side plus a counter-confirmation through V2's channel, recorded in the ceremony. | A job title in a signature block. |
| **V4** | **The holder controls the private key now.** | C3 — a signature over a nonce **NH chooses**, fresh, bound to the key id and the boundary. | V1–V3. Control and identity are orthogonal. |

**V1 is the one with no technical shortcut.** A regulator's register is a human lookup with a recorded
result; there is no API we can trust more than the register itself, and inventing a plausibility score
over a company name would be NH authoring the identity it is meant to be reading.

---

## 2 · The four attack shapes this must defeat

| # | Attack | What stops it | What would NOT |
|---|---|---|---|
| **A1** | An attacker generates their own keypair and presents it as the bank's. | V1 + V2: the key never arrived through the institution's channel and the entity was never matched to a register. | C3 — **the attacker passes it perfectly.** This is why challenge-response alone is insufficient. |
| **A2** | A real bank key, substituted for another tenant's. | The key is registered per `(boundaryId, sourceSystem, sourceKind)` and `boundaryId` is inside every signed payload. | A key list with no tenant binding. |
| **A3** | A compromised-but-genuine key, used after exposure. | Revocation with `exposureFrom`, and G4's **second** question: a revoked key supports no new proof even though it *was* in force when it signed. | `validAt` alone, which is historical by design. |
| **A4** | The customer's own staff hand us a key they generated, in good faith, because it was easier. | **V2 and V3, and nothing else.** The key will pass C3, the entity name will match, and the only thing that fails is the channel. | V1 and C3 together — which is exactly the pair most likely to be done well. |

**A4 is the likeliest failure in a real pilot**, and the least dramatic. It is not an attack; it is
convenience. A ceremony that treats V2 as paperwork will be defeated by it.

---

## 3 · What the ceremony must record, and why each item

Everything here is evidence for an auditor who was not present.

| Item | Why it is required |
|---|---|
| The regulator register consulted, the identifier found, the date, and who looked | V1 is a human act; without a record it is an assertion |
| The exact channel, and how it was confirmed to be the institution's | V2's failure mode is silent, so the method must be legible |
| The key fingerprint as received **and** as stored | Makes a substitution between the two visible |
| The nonce NH issued, and the signature over it | C3's receipt; a nonce NH did not choose proves nothing |
| The institution-side role that handed it over, and the counter-confirmation | V3 |
| The validity window the institution declared | Feeds `validFrom`/`validUntil`, which G1 tests `issuedAt` against |
| Two named NH identities: proposer and activator | Enforced in code — `KEY_PROPOSER_MAY_NOT_ACTIVATE` |

> **A ROLE, NEVER A PERSON, FOR THE INSTITUTION SIDE.** This follows `DatasetProvenance`'s existing
> choice and data minimisation: a pilot needs to know an accountable function signed off, not who.

---

## 4 · What is already enforced in code, and what cannot be

**Enforced today, and tested:**

| Control | Where |
|---|---|
| All four ceremony facts required before activation | `keyMayBeActivated`, refusing with every unmet condition named |
| Proposer ≠ activator | `activateSettlementKey` → `KEY_PROPOSER_MAY_NOT_ACTIVATE` |
| Capability split, no new role | `ProposeSettlementKey` on author/operator; `Activate`/`Revoke` on steward |
| A request may not vouch for its own key | `additionalProperties: false` — `authoritative`, `verified`, `trusted` are **400** |
| Tenant bound in the key row, in the signed payload, and re-checked in the core | three independent layers |
| A revoked key supports no new proof | G4's second question |
| An unknown exposure start flags the key's whole lifetime | `compromiseAssessment` |

**Not enforceable in code, and this is the honest boundary:**

> **NH cannot verify V1, V2 or V3 itself.** It can only record that someone claims to have done them,
> refuse to activate until all four are claimed, and make the claim auditable. **The booleans are
> attestations by the NH operator, not measurements** — which is precisely why `institutionIdentityVerified`
> is a *separate* field from the one check NH can actually perform.

So the register's integrity is strong and **its input remains a human claim.** A pilot brief that
presents four green booleans as four verified facts would be overstating exactly what this document
exists to prevent.

---

## 5 · What I need from you to proceed

| # | Needed | Blocks |
|---|---|---|
| **K5-a** | The institution(s): legal entity name and registration number, bank or PSP | V1 |
| **K5-b** | The official channel each will publish or confirm a key through | V2 — and A4 turns on this one |
| **K5-c** | Who at REVENIQ performs V1–V3 and records the ceremony, and who activates. **Two identities, not one** | the ceremony and `KEY_PROPOSER_MAY_NOT_ACTIVATE` |
| **K5-d** | Whether an institution that will not sign at all is in scope — if so, stage 8 cannot support that pilot and the honest answer is that no proof is possible, not a weaker proof | pilot scope |

**K5-d is the one most likely to be unwelcome and must not be softened.** If a bank will not sign an
attestation, there is no externally attested settlement, and the correct output is *no PROVEN claim* —
not a lower confidence, not a provisional proof. Claimed revenue is not proven revenue.

---

## 6 · Status

**Nothing is implemented from this document.** G3 is the ceremony, and it is blocked on K5-a and K5-b,
which are relationships rather than code. No institution is verified, no key is registered, nothing
reaches `AUTHORITY_VERIFIED`, and **no observed amount became Revenue Returned.**
