# K5 · Institution admission — the half a signature cannot supply

**Status:** built, unwired, and populated by nothing.
**Date:** 2026-11-18.
**Everything below is synthetic or prospective.** No real financial institution is named, proposed,
verified, or in any way recorded in this repository, and **no observed amount became Revenue
Returned.**

---

## 1 · The question this answers, and why signatures do not answer it

`settlementVerification` proves that a settlement attestation was signed under a key in NH's governed
key register, active at the stated signing instant, with a single-use nonce. That is sound and it is
tested. It establishes exactly one thing:

> **A valid signature proves CONTROL of a registered key. It proves nothing about WHO HOLDS IT.**

The authority ladder's only channel that reaches `AUTHORITY_VERIFIED` is third-party reconciliation,
and its defining property is recorded in `sourceFactAuthority.ts` as *"the third party is not party to
the recovery claim."* That is a statement about **who signed**. No quantity of signature verification
reaches it: a beneficiary with a freshly generated keypair produces attestations that verify perfectly.

So the ladder was blocked not on machinery but on a question about the world. This is where it is
answered — by a registry, a regulator, a published channel and two people at NH.

`src/contract/institutionAuthority.ts` makes the gap **derived rather than asserted**:
`CRYPTOGRAPHIC_CONDITIONS` is a frozen one-element list, and `signatureAloneLeavesRefusals()` computes
what remains outstanding when every cryptographic condition is satisfied. Promote a condition into the
cryptographic set, or remove the non-cryptographic ones, and that function returns an empty list and
its test fails. The sentence is the explanation; the function is the mechanism.

---

## 2 · The eight conditions

| # | Condition | Established by | NH can check it? |
|---|---|---|---|
| C1 | `legalEntityVerifiedIndependently` | an independent company registry | **no** — citation |
| C2 | `regulatoryStandingVerified` | the relevant regulator's own register | **no** — citation |
| C3 | `authorisedSignatoriesEstablished` | the institution's own governance records | **no** — citation |
| C4 | `channelIndependentlyVerified` | a channel the institution controls and publishes | **no** — citation |
| C5 | `keyControlDemonstrated` | **the server**, by resolving a named registered key | **yes** |
| C6 | `keyFingerprintConfirmedOutOfBand` | a second channel, out of band | **no** — citation |
| C7 | `ceremonyRecorded` | NH's own ceremony record | **no** — citation |
| C8 | `secondPersonApproval` | **the server**, from the event ledger | **yes** |

**Exactly one of the eight is cryptographic.** That is the whole content of the module.

### Why the six are citations and not booleans

NH cannot read a company register, a regulator's list or a signatory schedule. The honest form of that
evidence is therefore a **reference someone can be asked about** — who looked, at what, and when —
classified the way `provenanceAttestation` classifies what it cannot check: `UNCORROBORATED_CLAIM`.

A `NOT NULL` non-blank citation column makes a bare tick **unrepresentable** rather than merely
discouraged. That is the correction of a real defect, recorded in §6.

### Why C8 is derived and refused as an input

`secondPersonApproval` means *a second person approved this*. A verifier who could tick it while
verifying their own proposal would be the beneficiary determining the number. So:

- the service refuses `INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED` if a caller states it;
- the field **does not exist** on the submission type, so an existing caller cannot keep old behaviour
  by saying nothing — the shape that produced the proof-bypass;
- the **verification table has no column for it at all**, so there is nowhere to put the assertion; and
- a `BEFORE INSERT` trigger reads the institution's own `proposed_by_actor_id` and raises
  `INSTITUTION_PROPOSER_MAY_NOT_VERIFY`.

**The constraint is the control; the service's check is the diagnosis.** The service refuses first so
the refusal is legible; the trigger is what makes the rule true against a second write path, a bypass,
or a bug in the ordering.

### Why C5 is resolved and not ticked

`keyControlDemonstrated` records **which** registered key the institution demonstrated control of. The
service resolves it in the key register and requires it to be in force **and bound to this
institution's own boundary and source system** — one sender's demonstrated control may not stand in for
another's. The column carries a foreign key to `settlement_signing_keys`, so control of an unregistered
key (which NH holds no public half of, and therefore verified nothing with) cannot be recorded.

It also means a later compromise of that key can reach this verification.

---

## 3 · Admission process

1. **Propose.** A governance identity records the institution's facts: NH's own id, the boundary, the
   source-system name a settlement fact must carry, bank or PSP, and the legal entity, jurisdiction and
   **registry identifier** as an independent registry names them. The server computes the witness; a
   caller never supplies one. State: `PROPOSED`.

2. **Verify.** A **different** governance identity submits the six citations and names the key. The
   server assembles the evidence set, establishes C5 and C8 itself, and refuses on the first fact that
   does not hold — in this order, deliberately:

   | order | refusal | why it outranks the next |
   |---|---|---|
   | 1 | `INSTITUTION_WITNESS_MISMATCH` | *this row changed* outranks everything else about it |
   | 2 | `INSTITUTION_PROPOSER_MAY_NOT_VERIFY` | who you are outranks what you submitted |
   | 3 | `INSTITUTION_KEY_NOT_IN_FORCE` | an absent key outranks a mis-bound one |
   | 4 | `INSTITUTION_KEY_NOT_BOUND_TO_INSTITUTION` | the wrong sender outranks a missing citation |
   | 5 | `INSTITUTION_CITATION_MISSING` | names **every** missing one, never the first |

   State: `VERIFIED`. There is **no re-verify**: a withdrawn institution is proposed afresh, so the
   record says which admission a given attestation rested on.

3. **Withdraw** — the relationship ended, or we no longer rely on it. Says nothing about what the
   institution attested.

4. **Revoke, identity doubted** — we are no longer sure who we were talking to. This raises a question
   about **everything** that key ever signed, and it is reachable from `WITHDRAWN` too: an institution
   whose relationship ended can later be found to have been impersonated, and refusing that transition
   would leave governance unable to state what it just learned.

**`WITHDRAWN` and `REVOKED_IDENTITY_DOUBTED` never collapse into one "inactive".** Those are different
facts and a single state would hide which — the same reason `RETIRED` and `REVOKED_COMPROMISED` are
separate on a key, and the same reason `leakInstanceIdentityStatus` and
`SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart.

---

## 4 · Revocation reverses no proof

`institutionAuthorityCeiling(events, instant)` answers **as of an instant**, not *now*.

> **What an attestation was authorised by at the time is what it stays authorised by.** Learning changes
> future decisions only; it must never rewrite historical proof.

A revocation therefore recomputes nothing and reduces no figure by one cent. The exposure is
**reported** — that is `settlementCompromiseReport`'s job, and the ledger records the signing instant
precisely so an investigator can place each arrival inside or outside an exposure window.

This is also why there is no `state` column anywhere in the design. A status column is a mutable cache
of an immutable ledger, which this repository has refused for admission decisions, analysis terms,
execution events, case status and signing keys alike — and a stored column could only ever answer
*now*, while a frozen proof needs the answer as of when it was approved.

---

## 5 · What the register carries, and what it refuses to carry

**It carries no person.** The authorised signatories are a *condition* someone established out of band;
their names belong in that record, not in a row NH hashes and stores. Minimization — the same choice
`DatasetProvenance` and the provenance attestation form both made.

**The witness covers the seven immutable facts and nothing else.** No state, no events, no evidence: a
witness that moved when governance acted would make a legitimate verification read as tampering, which
is exactly what `settlementKeyWitness` leaves the lifecycle out to avoid.

**`source_system` is the load-bearing field.** A settlement fact names its source system, and the whole
point of this register is that *that name* has been tied to an independently verified legal entity. If
it could be edited after verification, a verified institution's authority would silently transfer to a
different sender while every stored receipt still pointed here. Hence the witness, the append-only
trigger, and a **unique index on `(boundary_id, source_system)`** — two institutions claiming one
sender would make *which institution does this attestation come from?* depend on which row was read
first, which is precisely how a competing legal entity would be introduced for an already-verified
sender.

---

## 6 · The defect this register uncovered, reported and NOT patched

Building it surfaced a finding in the **existing** key register.

`KeyRegistrationEvidence.institutionIdentityVerified` documents itself as *"the institution's identity,
established independently of whoever supplied the key."* It arrives over HTTP as a **required boolean
on the propose-key request** — no citation, no legal entity, no jurisdiction, no registry identifier, no
second person, and no lifecycle of its own. And `ProposeSettlementKey` is held by `author` and
`operator`, which is the **beneficiary side**.

It is not unchecked: a different identity activates, and may refuse the whole registration. It is
**unevidenced** — an activator looking at that row has nothing to check the claim against. That is the
Trust Invariant's standing test answered the wrong way: the party who benefits from a larger recovery
number authors a fact about who they were talking to.

**The intended end state** is that `institutionIdentityVerified` becomes **derived** from this register
— is there a `VERIFIED` institution for this boundary and source system? — and **refused as an input**,
exactly as this module refuses the two conditions it establishes itself.

**It is not changed here.** That alters the HTTP contract and every existing caller, so it is an
owner's decision rather than something to slip in beside the register that revealed it. Three
assertions in `institutionGovernance.test.ts` pin today's behaviour, and they **fail when the wiring
slice lands** — which is the point: a finding nothing asserts is free to be forgotten.

---

## 7 · What this does NOT do

- **`THIRD_PARTY_RECONCILIATION.implemented` stays `false`.** It may turn true only when an institution
  reaches `VERIFIED` here, which needs a real institution and an owner's decision to onboard one. A
  test asserts that no channel reaching `AUTHORITY_VERIFIED` is implemented, so the rung cannot open by
  an edit to one flag.
- **Nothing imports the register in production.** Asserted on **import specifiers** — a prose mention
  is not an import and a string literal is not a dependency. The only importers are its own tests. The
  day a proof path reads it, that is a wiring slice with its own evidence, per the `obligation_ref`
  revert rule: *the slice that makes a field load-bearing ships its consumer with it.*
- **No production migration.** The schema lives in `scripts/migration-design/`, never in
  `prisma/migrations/` — a file there is applied by `prisma migrate deploy` on every deploy, so
  committing one would *be* the production schema change. It has been applied only to databases a test
  creates and drops.
- **The register is empty.** Every fixture is synthetic, named *(NOT A REAL INSTITUTION)* in the legal
  entity field itself, in jurisdiction `ZZ`.
- **No proof, ledger figure, `PROVEN` gate or monetary surface changed.** Contract **2.0.0**, both
  extracts, every `*_VERSION`/`*_SCHEME` constant, `OBLIGATION_IDENTITY_FIELDS = []` and every frozen
  artefact are unmoved; `prisma/schema.prisma` is untouched.

---

## 8 · What would make an institution genuinely verified

The register is the mechanism. The evidence is an owner's to gather, and the honest list is short:

| condition | what is needed | who |
|---|---|---|
| C1 | a company-registry extract naming the entity and its number | owner |
| C2 | the regulator's own register entry for that entity | owner |
| C3 | the institution's authorised-signatory schedule | owner |
| C4 | a key delivered through a channel the institution publishes | owner + institution |
| C5 | a challenge-response under the delivered key | **already mechanised** |
| C6 | the fingerprint confirmed through a second, different channel | owner + institution |
| C7 | a recorded ceremony: channel, who confirmed, fingerprint, window, receipt | owner |
| C8 | a second governance identity at NH | **already mechanised** |

Two of eight are mechanised. **Six need a real counterparty**, and until they exist the ladder's ceiling
stays `SOURCE_ATTESTED` and every readiness level stays **PROVISIONAL**.

---

## 9 · Defects found while building this, all in my own instruments

1. **The importer guard expected the module itself in a grep for its own name.** A file does not contain
   its own filename as an import, so the scan returned one entry and the assertion was wrong about its
   own subject. Corrected to read import specifiers, with a second test proving the pattern finds a
   real importer when there is one — *a guard that cannot fire is no guard.* **Twelfth** recorded
   instance of this family.
2. **A privacy guard banned the token `"name "` over a joined blob of field names** and matched inside
   `legalEntityName jurisdiction` — a banned term found in a perfectly legitimate field. Now per field,
   with the one legitimate name field named. **Thirteenth** instance.
3. **A malformed-facts assertion had the validator's field order backwards.** The test was wrong and the
   code was right, which is the only way to discover that the order is part of the contract.
4. **A uniqueness assertion matched the index NAME in the error text.** Prisma surfaces
   `Key (institution_id)=(...) already exists` and not the index name, so a working guard read as
   broken. Now behavioural plus a catalogue query that says which index produced it — and a further
   test proving the index is **partial**, since one that forbade every repeated transition would
   satisfy the first assertion and break the register.
5. **Two mutations survived the first pass, both test gaps.** The NUL-separator test used two fields
   that are **not adjacent** in the preimage, with a third between them, so removing the separator could
   not make them collide; and the identity module's own test never exercised control characters. The
   separator property is now derived over **every** adjacent pair.
6. **The store's verification INSERT omitted a `NOT NULL` column** (`verified_by_role`). Caught by the
   positive control against the real database, not by a reading — which is why a store without a
   Postgres-backed positive control is not tested.
