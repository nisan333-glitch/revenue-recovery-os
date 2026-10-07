# Minimal customer provenance attestation · the `SOURCE_ATTESTED` rung

**Decided and built 2026-10-07.** Owner decision: the absence of verified authority must not block
requesting or inspecting the first real customer exports. Pilot-data trust rule; it computes no money,
runs no reconciliation, and turns no observed amount into proven Revenue Returned.

---

## 1 · The question, and why it was not "build cryptography"

Readiness could say a customer's files are structurally capable of monetary reconciliation, and could say
nothing about whether they came from the systems they claim to come from. The ceiling was `SOURCE_NATIVE`
with `AUTHORITY_UNVERIFIED`, every level **PROVISIONAL**.

The owner's instruction was to solve *only the smallest practical provenance requirement*, and to **not
delay the customer request while solving it**. So the test applied throughout was: what is the cheapest
thing that carries **real** evidence, and what exactly does it fail to carry?

---

## 2 · Why a new authority state is necessary — the proof

**It cannot be `AUTHORITY_VERIFIED`.** That rung is defined in `sourceFactAuthority.ts` as *evidenced by a
channel the beneficiary cannot unilaterally alter*, and this repository already contains its one
implementation: `server/services/sourceVerification.ts` verifies Ed25519 over a payload signed by a key
**the source system holds and the submitter does not**, registered server-side, inside a 5-minute
freshness window. A data-owner attestation is authored by the submitting side — which the Trust
Invariant's standing test names explicitly (*"the person, team, **customer**, CFO, manager, or AI
agent"*) — and that side can revise the attestation and the file together. Mapping it to
`AUTHORITY_VERIFIED` would be false by the module's own definition and would breach rules 1 and 8.

**It cannot stay `SOURCE_NATIVE`.** That rung's own `ceilingReason` says *"**NOTHING** establishes that it
left that system unaltered."* With a row count committed before the result was known and then checked
against the file, that sentence is no longer true. Keeping it there would discard real evidence, which is
the mirror of overclaiming and just as wrong.

**They may not be collapsed.** *The unavailable states stay DISTINGUISHABLE, because collapsing hides
which half is missing* — the rule this repository has now applied for `leakInstanceIdentityStatus`,
`SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` and `UNAVAILABLE_BILLING_SIDE_UNKEYED`.

### Why it is not called `VERIFIED_FOR_PILOT`

The owner proposed that label and it was argued down on evidence rather than taste. A rung whose name
contains **VERIFIED** gets quoted without its qualifier — in a deck, by a CFO — and this repository has
already paid for exactly that failure: `settled_at` recorded a charge being raised and was read as a
payment until it was renamed two commits ago. `SOURCE_ATTESTED` says **who acted** and claims nothing
about verification.

`attested` **remains** in `SELF_ASSERTED_AUTHORITY_PARAMETERS` and is still refused as a request key. A
rung named for a thing the request may not say is precisely where someone will later try to say it, so a
test asserts both halves.

### The channel is new, not a reinterpretation of an old one

`DATA_OWNER_ATTESTATION` is separate from the pre-existing `SYSTEM_OF_RECORD_ATTESTATION`, which stays
`implemented: false`. That one means the **system** asserts it, machine-issued; this is a **role**
asserting it. Collapsing them would let the weaker channel wear the stronger one's guarantee. Channels
now carry `reaches`, so "a channel was implemented" can never imply "a strong rung became reachable" —
and the test that used to assert *no channel is implemented* was replaced with the property it was
actually protecting: **no channel that reaches `AUTHORITY_VERIFIED` is implemented.**

---

## 3 · The load-bearing rule

> **A rung may rest only on what NH can CHECK. A claim NH cannot check is recorded, attributed and
> labelled — never counted as evidence for it.**

Every declared fact is classified once, in `ATTESTATION_CLAIMS`:

| kind | meaning | the owner's six requirements |
|---|---|---|
| **CORROBORATED** | checked against the contents of the files | **3** identifiers preserved · **4** `obligation_ref` not composed from its own row · **6** pseudonymisation preserved the joins · plus the row count and the coverage window |
| **WELL_FORMED** | checked for shape only — a commitment, not yet a corroboration | **1** and **2** a system is named and the method is one of five · the export was taken on or after its window closed |
| **UNCORROBORATED_CLAIM** | not checkable, ever | **5** amounts, currencies and dates not estimated or reconstructed · pseudonyms not derived from the data · the files are the named systems' output |

**Three of the six have real corroboration and three have none.** The report says which, and the form
prints the word **NOTHING** beside each of the three. A form that hid the distinction would be collecting
a signature against work we never do.

`SOURCE_ATTESTED` requires **every** CORROBORATED and WELL_FORMED claim to pass. Denying all three
UNCORROBORATED claims leaves the rung standing — surprising, correct, and pinned by a test, because they
were never holding it up. What withdrawing them changes is the recorded text, which is the reason for
recording them.

### Two mechanics worth stating

**The row count is the only entry that is evidence rather than shape.** A count written down before the
result was known makes a later trim visible: an export quietly shortened no longer matches its own
declaration. It is the pre-registration shape the admission bar already uses.

**The join check catches the specific failure the sixth requirement is about.** Pseudonymising each file
independently — the common mistake — yields no shared payer and no formed join, and that NH can see. Both
checks are **necessary evidence and never proof**: a consistently re-keyed pair passes them, and the rung
does not claim otherwise.

**A contradicted attestation fails CLOSED and the contradiction is named**, because a declaration that
disagrees with the file is worse evidence than no declaration. An unreadable export makes the row count
`NOT_CHECKABLE` rather than contradicted — that is an extract fault with its own code, and blaming the
attestation would point the customer at the wrong thing — and *we could not look* still does not pass.

---

## 4 · A role, never a person

Reusing the choice `DatasetProvenance` already made for contract 2.0.0: minimization says the pilot needs
joins, dates and amounts, **not people**. The form asks for a role or team, says why, and a guard refuses
any request for a name or an email. An accountable individual belongs in the contract or the DPA, not in
a data submission.

---

## 5 · Nothing is gated on this

With no attestation the readiness report is **byte-for-byte what it was** — asserted by a control that
strips the authority block and compares everything else. The form itself tells the customer the exports
may be sent without it. So the request could have gone out before this shipped, and can go out now.

`DATA_READINESS_METHOD_VERSION` → **`rdy-2026.2`**, because a new state is genuinely reachable — a real
behavioural difference, unlike the rename, which moved names and nothing else. The **scheme stays
`-v2`**: the report gains an optional field, and this repository's precedent is that a scheme id moves on
a *breaking* shape change, as expectation extract 1.0.0 → 1.1.0 did without moving its own.

---

## 6 · Verification

**215/215** package checks, with five mutations proved to fail: a paraphrased claim, a removed
does-not-verify sentence, a request for a person's name, a promised verified state, and a form claiming
to be mandatory. **25/25** readiness control, both frozen packages still `SOURCE_NATIVE` and
PROVISIONAL — the no-change control. **1094 passed + 1 skipped** on a fresh database and again with none
configured · **599/599** ep2 · **120/120** journey · build, `build:server`, both typechecks,
`check:purity`, `verify:evidence`, `verify:registers`, `recon:verify`, `recon:ref:verify`,
`git diff --check` all clean.

Eleven attestation falsifiers, including the one that matters most: **`provisional` stays `true` at
`SOURCE_ATTESTED`**. It holds without any change to that predicate, because `provisional` is
`reached !== "AUTHORITY_VERIFIED"` and the new rung sits below it — so the rung *cannot* accidentally
un-provisionalise anything.

**Preservation, by hash:** `reconciliationCore.ts` `60e71f6f`, `reconciliationScenarios.ts` `7dd786ba`,
V3 scorer `060359f5`, `ground-truth.csv` `0f5558e4`, V3 `observation.csv` `0ef21e40`, variant
`observation.csv` `76465e96`, `expectation.csv` `31992d23`, `planted-register.json` `111db9d1`. Contract
**2.0.0**, expectation extract **1.1.0**, billing extract **1.0.0**, `OBLIGATION_IDENTITY_FIELDS = []`.
The $79,846.00 synthetic result is preserved as historical evidence; no monetary or readiness figure
moved.

---

## 7 · Two findings recorded rather than patched

**`ReadinessReport.level` claims an authority cap it does not implement.** Its comment says *"never above
what authority permits being relied on"*, while the level is computed from capabilities alone and
authority only sets `provisional`. It is the `coverage.event` shape. Harmless **today** because
`provisional` is true in every reachable state, so no level can be relied on unqualified either way.
Adding the cap would change readiness results for data nobody has re-read; deleting the sentence would
erase the discrepancy instead of recording it. The behaviour is pinned by a test that measures it —
authority moves a whole rung while the level does not move at all — and the sentence is left for its
owner.

**Two guards caught my own instruments first.** A structural check matched `provenanceEstablished` inside
the comment stating that the field is *not* accepted — so it failed on prose asserting the very property
it was testing for. **Ninth instance** in this repository of *a structural guard must read code, not the
words the code is talking about*. And an `ATTESTATION.md` guard pinned a literal phrase the generator
then stopped using; it now asserts the property on the **contract** rather than on the page's wording.

---

## 8 · What would justify `AUTHORITY_VERIFIED`

Only a channel the submitting side cannot alter. In rough order of cost:

1. **`SIGNED_EXPORT`** — the source system signs the bytes with a key it holds. `sourceVerification.ts`
   already does Ed25519 verification against a server-side key registry; what does not exist is a payload
   shape for a multi-row export, or a freshness model for a file that arrives by email rather than over a
   live connection. Its current payload is one evidence claim for one Recovery Case.
2. **`NH_PERFORMED_FETCH`** — NH reads the facts from the source system itself. Strongest and most
   invasive: there is no intermediate step in which a row can change.
3. **`SYSTEM_OF_RECORD_ATTESTATION`** — the system, not a person, asserts the extract is its own complete
   statement for the period.
4. **`THIRD_PARTY_RECONCILIATION`** — an independent record such as a processor or bank agrees with a
   settled amount. The only one of the four where the corroborating party is not party to the claim.

Until one exists, **`SOURCE_ATTESTED` is the ceiling and every level stays PROVISIONAL.**
