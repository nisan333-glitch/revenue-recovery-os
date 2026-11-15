# Settlement key governance · K1 and K5 implementation plan

**Date:** 2026-11-15 · **PLAN ONLY — nothing implemented, no code changed**
**Baseline:** remote `e1df5b2`, CI #340 6/6 green · design predecessor: `docs/SETTLEMENT_KEY_GOVERNANCE_DESIGN_V1.md`
**Permitted for this round:** research, planning and read-only inspection. No code, no push, no migration.

---

## 0 · A scoping correction to K1, offered before the plan rests on it

The instruction reads *"KMS for private keys under REVENIQ's control, insofar as required"*. Taken from
the code, the honest answer is:

> **Stage 8 requires NO private key under REVENIQ's control at all.** The bank or PSP signs; NH only
> **verifies**. `SettlementVerifier` holds Ed25519 **public** keys and nothing else, and the one place a
> private key appears anywhere near this product is the browser journey, which generates an ephemeral
> pair per run and deliberately keeps the private half out of the API process.

A KMS protects **secrets**. A public key is not a secret: it needs **integrity and provenance**, not
confidentiality. So a KMS buys stage 8 very little, and the real problem is a different one —
*which public key is genuinely the institution's, who said so, and when was it in force*. That is a
**register** problem, not a secret-storage problem.

**A KMS becomes genuinely necessary the moment NH signs anything itself** — its own attestations, an
export signature, or envelope encryption of stored material. None of that exists today. The plan
therefore proposes the register first and names the KMS as a **deferred, separately-triggered**
decision, with the trigger stated so it is not forgotten.

---

## 1 · Step 1 · the push verification you asked for, result only

| Check | Result |
|---|---|
| Remote branch unchanged | **`e1df5b2`** — exactly where CI #340 left it |
| `6174a96` contents | **one file**, `docs/SETTLEMENT_KEY_GOVERNANCE_DESIGN_V1.md` |
| Any path outside `docs/` | **none** |
| Any `.ts/.tsx/.js/.mjs/.json/.prisma/.sql/.yml` | **none** — no code, no schema, no workflow |
| Fast-forward possible | **YES**, no force needed; 1 commit ahead |
| Working tree | clean |

**Not pushed.** Awaiting your explicit approval, as instructed.

---

## 2 · What already exists, and is reused rather than reinvented

This is the part that makes the estimate small. Every governance primitive this needs is already built
and in production use for a *weaker* object:

| Primitive | Where | Reused for |
|---|---|---|
| `DRAFT / ACTIVE / FROZEN / RETIRED` + legal transitions | `src/contract/policyLifecycle.ts:18` | the key lifecycle |
| propose/activate with **proposer ≠ activator** | `server/services/sourceAuthorityService.ts:52` | key registration |
| capability model with `Propose*` on author/operator and `Activate*` on **steward** | `server/auth/identity.ts:57` | **no new role is added** |
| witness hash + verify-on-resolve | `src/contract/policyHash.ts:18,45,54` | the register row's integrity |
| append-only by database trigger | `nh_reject_mutation()`, `prisma/migrations/20260726153500_ep2_immutability` | the key event ledger |
| a two-table register: stable id + immutable versions | `prisma/migrations/20260930120000_step5a_source_namespaces` | key + key version |
| `SELF_ASSERTED_AUTHORITY_PARAMETERS` | `src/contract/sourceFactAuthority.ts` | refusing a caller that vouches for its own key |

> **No new role, no new lifecycle vocabulary, no new witness scheme pattern.** The steward already
> activates source authority and *still cannot count*, so giving it key activation adds authority over
> provenance and **no path to a number** — which is the stated reason the source-authority capabilities
> were placed there.

**And the gap is exactly as narrow as that table implies:** both trust roots are today
`JSON.parse(env.NH_EVIDENCE_SOURCE_KEYS ?? "[]")` and `…NH_SETTLEMENT_SOURCE_KEYS…`. There is **no KMS,
no secret manager and no vault anywhere in the repository** — verified by search, and the only match was
a lockfile string.

---

## 3 · K1 · architecture

### 3.1 · Recommended — **Option A: governed Postgres register, public keys only**

```
institution ──(K5 ceremony)──▶ ProposeSettlementKey ──▶ DRAFT
                                                          │  steward, a DIFFERENT identity
                                                          ▼
                                                   ActivateSettlementKey ──▶ ACTIVE
                                                          │
       verify(fact, attestation) ──▶ resolve by keyId ──▶ witness re-checked ──▶ validity AT issuedAt
                                                          │
                                        RETIRED (rotation / expiry)  ·  REVOKED_COMPROMISED
```

| | |
|---|---|
| **Pros** | integrity lives in the same append-only ledger the rest of the product's trust rests on; a historical decision is reproducible **from our own tables** with no external retention dependency; no new infrastructure, no new vendor, no egress on the verification path; the propose/activate split and the witness check are code that already exists and is already tested |
| **Cons** | we operate the register ourselves, so its backup and restore become part of the trust story; no HSM attestation to show an auditor; a database compromise is a register compromise — mitigated, not removed, by the witness and the append-only trigger |
| **Operational cost** | one migration, two tables, no runtime dependency; rotation and revocation are governed API calls, so **revocation latency is one request** |

### 3.2 · Alternative — **Option B: KMS / secret-manager-hosted key register**

| | |
|---|---|
| **Pros** | HSM-backed, familiar to a security review, centralised rotation tooling, IAM audit trail maintained by the provider; the obvious choice **if** NH ever holds private keys |
| **Cons** | the integrity story becomes *trust the provider's IAM*, which sits **outside** the ledger everything else rests on; the register's history lives in two places and they can disagree; **reproducing a historical decision then depends on the provider retaining key versions and their timestamps** — and rule 5 says a proof is reproducible *forever*, which must not become a function of a vendor's retention policy; every verification needs a fetch or a cache, and a cache reintroduces exactly the integrity question the KMS was meant to settle |
| **Operational cost** | cloud dependency on the proof path, IAM administration, per-call latency and cost, and a second audit surface |

### 3.3 · Rejected — **Option C: signed manifest in the repository**

Attractive because git history *is* an audit log and a review *is* an approval. **Rejected on one
property:** registering or revoking a key requires a deploy, so **revocation latency equals deploy
latency**. For a compromised key that is unacceptable. It also only moves the problem: the manifest's
signer becomes a new trust root with the same unsolved bootstrap.

### 3.4 · The retroactive-compromise rule — the sharpest point in K1

Your fourth K1 bullet — *reproducing historical decisions while accounting for key revocation and the
exposure date* — forces two times apart that are easy to conflate:

| time | meaning |
|---|---|
| `revokedAt` | when **we declared** the key revoked |
| `exposureFrom` | the earliest instant the key **may have been** in the wrong hands |

> **A frozen proof is NEVER recomputed.** What is re-derived is its *trust status*: a proof whose
> receipt's `issuedAt` falls at or after `exposureFrom` is **`FLAGGED_COMPROMISED_WINDOW`**; one before
> it is **`UNAFFECTED`**. The proof's own bytes, amount and approval stand untouched — rule 5 is
> absolute and rule 6 says learning changes future decisions only.

> **And `exposureFrom` is frequently UNKNOWN, which must not default to `revokedAt`.** Defaulting that
> way would silently clear **every** past proof the key ever signed, which is the flattering direction.
> An unknown exposure start means **the whole of the key's life is the window** — *not computed is not
> zero*, applied to time rather than to money.

This is reproducible from Option A's own tables and is the concrete reason Option B's vendor-retention
dependency matters: answering *"which frozen proofs rest on a key compromised from an unknown date"*
requires the key's full version history to still exist.

---

## 4 · K5 · initial registration of an external key — the ceremony

**The deepest problem, and governing the key perfectly after it arrives establishes nothing about
whether it is the right key.**

| # | Step | Requirement | Refusal if unmet |
|---|---|---|---|
| **C1** | Obtain | the key arrives through a channel the institution controls and publishes — a documented endpoint on the institution's own domain, a certificate chain, or a physically/out-of-band confirmed fingerprint. **Never an email attachment, never a value typed into a form by the submitting party** | `KEY_CHANNEL_NOT_AUTHORITATIVE` |
| **C2** | Verify the party | the institution's identity is established independently of whoever supplied the key | `KEY_INSTITUTION_NOT_VERIFIED` |
| **C3** | Verify ownership | the institution demonstrates control of the private half — a **challenge-response signature over a nonce NH chooses**, which is the only check here that is not paperwork | `KEY_OWNERSHIP_NOT_DEMONSTRATED` |
| **C4** | Record the ceremony | channel, who confirmed, fingerprint, validity window, and the challenge-response receipt, as an append-only ledger entry | `KEY_CEREMONY_RECORD_MISSING` |
| **C5** | Propose | `ProposeSettlementKey` — author or operator, bound to boundaries the proposer actually holds | `403` |
| **C6** | Activate | `ActivateSettlementKey` — **steward, and a different `actorId`** | `KEY_PROPOSER_MAY_NOT_ACTIVATE` |
| **C7** | Refuse everything else | a key that has not completed C1–C6 verifies **nothing**; absence is a refusal, never a pass | `SETTLEMENT_KEY_NOT_REGISTERED` |

**C3 is the only cryptographic step and it is what makes the rest more than a form.** A fingerprint
confirmed out of band plus a signature over a nonce NH chose establishes that the party we spoke to
holds the private half *now*. Everything else in the ceremony is provenance paperwork — necessary, and
not evidence on its own.

> **A request may never assert its own key's authority.** `SELF_ASSERTED_AUTHORITY_PARAMETERS` already
> names the words that are refused rather than honoured — `authoritative`, `verified`, `trusted`,
> `attested`, `signed` — and a registration request must be refused the same way. The ceremony's verdict
> is **computed by NH from what it checked**, never supplied.

---

## 5 · Step 3 · security controls to be tested

Each row names what already exists at `e1df5b2` and what is new. **"Exists" means a test runs today**,
not that the area is covered in principle.

| # | Threat | Exists today | New tests required |
|---|---|---|---|
| **S1** | Forgery / key substitution | 8 tamper tests over every signed field; unregistered key; wrong-key signature; 3 malformed-signature shapes | a key **swapped in the register itself** is caught by the witness re-check on resolve; a second key registered under an existing `keyId` is refused |
| **S2** | Registration in the wrong tenant | the key's `boundaryId` binding and the tenant inside the signed payload are both checked | **proposing** a key for a boundary the proposer does not hold is `403`; activating across tenants is `403`; the ceremony record cannot name a boundary the actor lacks |
| **S3** | Replay / double use of evidence | nonce bound into the signature; replay refused from `seenNonces`; one settlement attested twice counts **once**; cross-source summation refused | nonce uniqueness **persisted and enforced under concurrency** (two simultaneous approvals citing one nonce → exactly one succeeds); a settlement identity consumed by another claim refused across cases |
| **S4** | Rotation and revocation | — | an attestation signed in the **overlap window** under the old key still verifies; one signed after `validUntil` is `SETTLEMENT_KEY_EXPIRED` (distinct from *not registered*); a revoked key verifies nothing **new**; `RETIRED` and `REVOKED_COMPROMISED` are separately reachable and never collapse |
| **S5** | Retroactive compromise | — | with `exposureFrom` set, proofs before it are `UNAFFECTED` and those at/after it are `FLAGGED`; with `exposureFrom` **unknown**, **every** proof by that key is flagged; **the proof rows are byte-identical afterwards**, asserted by hash |
| **S6** | Evidence altered after signing | every one of the 8 signed fields breaks the signature when changed | a receipt frozen into a proof still verifies against the **archived** register row, not the current one |
| **S7** | Bypassing the approval process | the flag throws rather than coercing; no `authoritative`-style parameter is honoured | `ACTIVATE` without a prior `PROPOSE` is refused; propose+activate by **one identity** is refused; a direct `UPDATE`/`DELETE` on the key tables is refused **by the database trigger**; a key in an environment variable alone **grants nothing** once the register exists |

**Two controls that must exist or the suite proves nothing:**
- **A positive control per stage** — a fully-registered key verifying a correct attestation, because a
  build that refused everything would satisfy every row above.
- **A mutation set**, as stage 8 had: 17 of 17 caught there, and **M13 survived the first pass** because
  a test passed for a reason other than the one it named. The same discipline applies here.

---

## 6 · Files and modules

| File | New / changed | Role |
|---|---|---|
| `src/contract/settlementKeyLifecycle.ts` | **new** | states, legal transitions, `validAt(issuedAt)`, the compromise-window rule. **Pure, no imports** |
| `src/contract/settlementKeyWitness.ts` | **new** | `SETTLEMENT_KEY_HASH_SCHEME`, hash + `matches`, mirroring `policyHash.ts` |
| `server/persistence/settlementKeyStore.ts` | **new** | the register and its event ledger; `state` **derived**, never stored |
| `server/services/settlementKeyGovernance.ts` | **new** | propose / activate / rotate / revoke, proposer ≠ activator |
| `server/services/settlementKeyCeremony.ts` | **new** | C1–C4, including the C3 challenge-response |
| `server/services/settlementVerification.ts` | **changed** | resolve from the register instead of the env var; witness re-check; validity at `issuedAt`; two new refusals |
| `server/services/externalSettlementGate.ts` | **changed** | the `SettlementLedger` port gains its real implementation |
| `server/auth/identity.ts` | **changed** | three capabilities — `ProposeSettlementKey`, `ActivateSettlementKey`, `RevokeSettlementKey`. **No new role** |
| `server/http/schemas.ts`, `server/app.ts` | **changed** | three governed routes |
| `prisma/schema.prisma` + one migration | **changed** | two tables, append-only triggers, **no status column** |
| tests | **new** | ~70, per §5 |

---

## 7 · Staged implementation plan, with acceptance conditions

| Slice | Content | Acceptance | Owner gate |
|---|---|---|---|
| **G1** | the pure lifecycle + witness (`src/contract/*`) | states, transitions, `validAt`, the unknown-exposure rule; **mutation-proved**; `check:purity` clean; **nothing wired** | none — buildable today |
| **G2** | the register, store and governance service, **behind the existing flag** | propose/activate/rotate/revoke; proposer ≠ activator; witness re-checked on resolve; append-only triggers refuse direct mutation; S1, S2, S4, S7 | **K1** — where key material lives |
| **G3** | the ceremony (C1–C4) incl. challenge-response | S2 and S7 extended; a key without a ceremony record verifies nothing | **K5** — the channel |
| **G4** | `settlementVerification` resolves from the register; env var becomes bootstrap-only | S1, S4, S6; every stage-8 test still green; **95 existing tests unchanged** | — |
| **G5** | the real `SettlementLedger`; persisted nonce and identity uniqueness | S3 under concurrency | migration |
| **G6** | retroactive compromise reporting | S5, with **proof rows proved byte-identical** | **K4** |
| **G7** | wire into the PROVEN gate | the external payer reference exists; end-to-end on synthetic signed data; flag-off path byte-identical | the payer-reference decision |

**G1 is buildable with no owner decision at all** and is ~15 % of the work: it is pure, it is the part
every later slice depends on, and it cannot be wrong in a way that touches the product.

---

## 8 · Owner decisions still required

| # | Decision | Blocks | Why it is not mine |
|---|---|---|---|
| **K1** | Option A (governed Postgres register) or Option B (KMS) | G2 onward | infrastructure and security architecture with a cost |
| **K1b** | whether NH will ever hold a private key — the KMS trigger | deferred | a product-direction question, not a storage one |
| **K5** | the authoritative channel per institution, and who performs C2 | G3 | a relationship and a legal matter |
| **K2** | may the proposer's team also hold the steward role in a pilot | G2 | separation-of-duties policy |
| **K3** | the rotation overlap window's length | G2/G4 | depends on the institution's statement cadence |
| **K4** | does a `REVOKED_COMPROMISED` key **block new approvals** on cases whose existing proofs rest on it | G6 | two defensible positions; it changes what an operator may do today |
| **P1** | the external payer reference on the case — where it comes from authoritatively | G7 | a data-source decision; NH must not invent the mapping |

---

## 9 · Risks that remain before wiring to PROVEN

1. **The bootstrap risk is irreducible by code.** If C1 and C2 are weak, every downstream control is
   rigour applied to the wrong key. **This is the single largest residual risk and it is organisational.**
2. **A register compromise is a trust-root compromise.** The witness and the append-only trigger make it
   *detectable*, not impossible, and a restore from backup is exactly the exposure the terms register
   already refuses to treat as acceptable for itself.
3. **`exposureFrom` is usually unknown**, so a real compromise will flag a key's entire history. That is
   correct and it will be operationally painful; pretending otherwise now is worse.
4. **The extract authority ladder does not move.** `AUTHORITY_VERIFIED` there needs a different channel;
   every readiness level stays **PROVISIONAL**. Closing K1 and K5 does **not** change that.
5. **The two authority systems remain unlinked** — the PROVEN gate still does not read the extract
   ladder, so *"was this case's data authoritative?"* has no answer on the proof.
6. **No causation, ever.** `causationEstablished` is the literal `false`.
7. **The no-summing refusal is keyed on `sourceSystem`**, so two genuinely independent institutions are
   also refused. It errs toward refusal and never toward counting money twice.

---

## 10 · Conclusion

**Ready to implement with no further decision:** **G1** — the pure lifecycle, `validAt(issuedAt)`, the
witness, and the unknown-exposure rule. Pure, mutation-provable, wired to nothing.

**Blocked, and on what:**
- **G2–G4** on **K1** (register or KMS) and **K5** (the channel). These are the two I named last round
  and neither has moved.
- **G5** on a migration.
- **G6** on **K4**.
- **G7** on **P1**, the external payer reference.

**The smallest approval that unblocks the most: K1 = Option A.** It is the only decision that turns
roughly 60 % of the plan from blocked into buildable, it requires no vendor and no new infrastructure,
and the plan's own recommendation is that **a KMS is not what stage 8 needs** — NH holds no private key
on this path, and a public key needs integrity and provenance rather than secrecy.

**What is still true and must not be rounded up:** nothing here makes any figure real. Every fact in
every test is synthetic. **No Recovery Case has ever originated from real customer data, nothing reaches
`AUTHORITY_VERIFIED`, and no observed amount became Revenue Returned.**
