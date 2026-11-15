# Settlement key governance · DESIGN ONLY

**Date:** 2026-11-15 · **Owner-approved as design, explicitly NOT as code** · **Nothing implemented**
**Prerequisite for:** trusting anything `server/services/settlementVerification.ts` verifies
**Baseline:** `e1df5b2` · **Blocker it closes:** A2 from `docs/PILOT_FINANCIAL_PHASE_V1.md` §2.4

**Design decision recorded (owner, 2026-11-15):** bank **and** PSP are both supported verification
sources, chosen by transaction type, with **no obligation to use both** in any one transaction. That is
already what `e1df5b2` implements — `SETTLEMENT_SOURCE_KINDS = ["bank", "psp"]`, a per-kind table of
what each may assert, and two positive controls proving a bank credit **alone** and a PSP payout
**alone** each suffice.

---

## 1 · The exposure today, stated exactly

```
sourceVerification.ts:55   JSON.parse(env.NH_EVIDENCE_SOURCE_KEYS ?? "[]")
settlementVerification.ts  JSON.parse(env.NH_SETTLEMENT_SOURCE_KEYS ?? "[]")
```

A trust root is a parsed environment variable. There is **no registration, no rotation, no revocation,
no expiry and no record of who added a key**. Whoever can set a deployment variable can mint the
authority that decides whether a dollar is proven.

> **A trust root must be governed at least as strictly as the definitions it authorises.** The
> AssessmentPolicy that merely decides *which rows count* is proposed by one identity and activated by
> another, versioned, hash-committed and verified against its own witness on every resolve. The key that
> decides *whether money is proven* is a string in an environment variable. **The weaker thing is
> governed and the stronger thing is not.**

## 2 · The rules this design establishes

> **A KEY IS A GOVERNED DEFINITION, NOT CONFIGURATION.** It is registered, versioned, append-only, and
> its register row is verified against its own witness **wherever it is resolved for use** — never
> trusted as stored. That is the 2026-10-04 register tamper-evidence decision applied to a second
> register, and it is the same reason `policyHashMatches` had to gain a production caller.

> **PROPOSER ≠ ACTIVATOR.** A key reaches `ACTIVE` only when a second identity activates what the first
> proposed, exactly as `sourceAuthorityService.ts:52` already enforces for a source authority. One
> person registering a bank key and then approving it is the Trust Invariant's standing test answered
> the wrong way.

> **VERIFICATION READS THE KEY'S VALIDITY AT `issuedAt`, NEVER AT "NOW".** This is the load-bearing rule
> and the easiest one to get wrong. A proof is **immutable and reproducible forever** (rule 5). If
> verification asked *"is this key valid now?"*, then re-verifying a frozen proof after the key expired
> would answer differently from the day it was approved — the historical proof would stop reproducing.
> So the question is always *"was this key valid at the instant the attestation was signed?"*

> **ROTATION IS ADDITIVE, NEVER IN-PLACE.** A new key is a new row with its own validity window; the old
> row is `RETIRED` and **kept**. An overlap window is required, because a bank signs a statement when it
> produces it and a submission arrives days later — an instant cutover would refuse statements signed
> legitimately under the previous key.

> **REVOCATION STOPS FUTURE PROOFS AND DOES NOT REWRITE PAST ONES.** Learning may change future
> decisions only (rule 6). A revoked key's existing frozen proofs stay exactly as they are and become
> **FLAGGED**, which is a per-row marker, never a rewrite of history — the `ADMISSION_POLICY_PROVENANCE`
> §11 remedy. **And compromise is not rotation:** a key retired on schedule raises no question about its
> past attestations, while a key revoked *as compromised* raises one about every attestation it ever
> signed. Those are different facts and must not share a state.

> **EVERY TRANSITION IS AN APPEND-ONLY LEDGER ENTRY NAMING AN ACTOR.** Who proposed, who activated, who
> revoked, when, and why. A trust root whose history cannot be read is a trust root nobody can audit.

## 3 · The lifecycle

Mirrors `src/contract/policyLifecycle.ts` rather than inventing a second vocabulary, with one addition
the existing states cannot express.

| state | meaning | may verify an attestation signed in its window? |
|---|---|---|
| `DRAFT` | proposed, not yet activated | **no** |
| `ACTIVE` | in force | **yes** |
| `RETIRED` | superseded by rotation, or expired on schedule | **yes, for its own window** |
| `REVOKED_COMPROMISED` | **new** — believed to be in the wrong hands | **no, and past proofs are FLAGGED** |

`RETIRED` and `REVOKED_COMPROMISED` **must stay distinguishable**, and collapsing them is the exact
failure this repository has recorded a dozen times: one says *this key's work stands and it signs
nothing further*, the other says *this key's work is in question*. A single `INACTIVE` would hide which.

## 4 · The register row

| field | why |
|---|---|
| `keyId` | the signature names it |
| `boundaryId`, `sourceSystem`, `sourceKind` | the three bindings `e1df5b2` already checks before the signature |
| `publicKey` | Ed25519 SPKI PEM; the private half must never reach NH |
| `validFrom`, `validUntil` | the window `issuedAt` is tested against — **not** "now" |
| `state` | the four above, **derived** from the ledger, never a stored mutable column |
| `registerWitness` | a hash over the row, verified on every resolve |
| `proposedBy`, `activatedBy` | two distinct identities, enforced |

**`state` is derived, not stored.** A status column is a mutable cache of an immutable ledger, which
this repository has refused for admission decisions, analysis terms, execution events and case status
alike. `prisma/schema.prisma` gains a key table and a key-event table, and no status column.

## 5 · Expiry, and the question it forces

A key needs a `validUntil`, and the honest consequence is that **an attestation signed after a key
expired is refused even if the key was never compromised.** That is correct and it is also an
operational hazard: a customer's bank rotating keys without telling us would silently start producing
refusals. The mitigation is reporting, not leniency — a named refusal (`SETTLEMENT_KEY_EXPIRED`,
distinct from `SETTLEMENT_KEY_NOT_REGISTERED`) so an operator can tell *we do not know this key* from
*we knew it and its window has closed*.

## 6 · Authorisation audit — the questions it must answer

1. Which keys could have signed a proof-bearing attestation on a given date?
2. Who proposed each, who activated it, and were they different people?
3. Has any key ever been revoked as compromised, and **which frozen proofs rest on it?**
4. Did any attestation verify against a key outside its validity window? *(Must be impossible, and the
   audit must be able to show it rather than assume it.)*
5. Has any register row changed since it was written? *(The witness answers this, and it must be
   checked on resolve rather than at registration only.)*

**Question 3 is the one a CFO will ask**, and answering it requires the proof to have frozen the
`keyId` — which `e1df5b2` already does, in `SettlementReceipt`.

## 7 · Owner decisions this design does NOT take

| # | Decision | Why it is not mine |
|---|---|---|
| **K1** | Where the key material lives: a Postgres table, a KMS, or a signed manifest in the repository | security architecture with a cost and an operational owner |
| **K2** | Who holds the activator role, and whether it may be the same team as the proposer in a pilot | a separation-of-duties policy decision |
| **K3** | The rotation overlap window's length | depends on the external party's statement cadence |
| **K4** | Whether a `REVOKED_COMPROMISED` key **blocks new approvals on cases whose existing proofs rest on it** | this is a policy choice between two defensible positions, and it changes what an operator may do today |
| **K5** | How a key is first obtained from the bank or PSP, and how that channel is itself trusted | the bootstrap problem; a key fetched over an untrusted channel governs nothing |

**K5 is the deepest and must not be glossed.** Governing a key perfectly after it arrives establishes
nothing about whether it is the right key. A registration ceremony — out-of-band confirmation, a
certificate chain, or a published key the institution hosts itself — is a prerequisite for the whole
mechanism, and no amount of lifecycle rigour substitutes for it.

## 8 · What must NOT be built

- **No private key ever reaches NH.** Not for testing, not for convenience. The browser journey's
  existing split — public half to the API process, private half to one script — is the pattern.
- **No "trusted" or "verified" flag a caller may supply.** `SELF_ASSERTED_AUTHORITY_PARAMETERS` already
  lists the words that are refused rather than honoured, and a key registration request must be refused
  the same way if it tries to assert its own authority.
- **No retroactive re-verification that can change a frozen proof's answer.** Rule 5 is absolute.
- **No `INACTIVE` state** collapsing retirement and compromise.

## 9 · Status

**Nothing in this document is implemented.** No file under `src/`, `server/`, `prisma/` or `e2e/` was
touched by it. The design is recorded so the next slice can be judged against a written intent rather
than assembled from a conversation, and **the five owner decisions above block implementation** — K1 and
K5 strictly, because a key store and a registration ceremony cannot be chosen by a developer.
