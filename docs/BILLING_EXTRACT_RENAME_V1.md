# Billing extract rename · `nh.settlement-extract@1.0.0` → `nh.billing-extract@1.0.0`

**Decided and built 2026-10-07.** Owner decision. Pilot-data trust rule; it turns no observed amount
into proven Revenue Returned, changes no monetary figure and touches no production reconciliation.

---

## 1 · What prompted it

The semantic audit of the customer intake package found one field describing two different business
events, and the archaeology (commit `06f314a`) proved the semantics had never drifted: the event has
always been **a charge being raised**. Two column names and the artefact's own name leaned towards
payment, and the remedy shipped at the time was a *caveat* — the documents told the customer to read
`settled_at` as a raise date.

The owner's judgement was that the caveat is a stand-in for the fix, and that the fix is cheapest now:
the extract had never been sent to anyone, held no customer data and had no production consumer.

**One audit finding makes the rename more than readability.** The token was already overloaded inside
this repository **with the opposite meaning**:

| site | artefact | `settled_*` means |
|---|---|---|
| `saasActivation.ts:76` — `paid_amount: ["amount_paid", "settled_amount"]` | contract 2.0.0 | **PAID** |
| `pilotDataContract.ts:391` — `settledAmountMayNotExceedObligation` | contract 2.0.0 | **PAID** |
| `settlementExtract.ts` — `settled_amount` | settlement extract 1.0.0 | **BILLED** |

One token, two opposite events, two live artefacts. Both contract-2.0.0 sites are **correct in their own
artefact** and are untouched; the rename removes the collision from the other side.

---

## 2 · The version decision

> **`nh.billing-extract@1.0.0` — a new identity with a fresh version line, not `2.0.0`.**

A version is a claim about *that id's* history. `nh.billing-extract@2.0.0` would assert a `1.0.0` under
that id which never existed and which no customer could have built against — the repository's own defect
class: *a version signalling a change that did not happen is its own defect*
(`expectationExtractCorrections.ts`). Succession is recorded as a **link**,
`SETTLEMENT_EXTRACT_STATUS.supersededBy`, never as a number.

**It is not compatibility, and must never read as such.** A file declaring the old id is refused outright
as an unknown artefact. That is a *stronger* protection than a major bump, because there is no silent
upgrade path at all — a mis-declared file cannot be half-accepted.

Had the id stayed, the rename would have been a **MAJOR**. `COMPATIBILITY_POLICY.major` lists
*"Remove or rename a field"* verbatim, and the rename fails the test the expectation extract's 1.1.0
rationale cites in **both** directions: a `settled_at` file was accepted and would now be refused; an
`invoice_raised_at` file was refused and would now be accepted.

| | from | to | why |
|---|---|---|---|
| artefact id | `nh.settlement-extract` | `nh.billing-extract` | named for the event it records |
| version | `1.0.0` | `1.0.0` (new line) | semver is scoped to an id |
| scheme | `nh-settlement-extract-v1` | `nh-billing-extract-v1` | a shape change is a new scheme id |
| codes | `NH-SX-####` (16) | `NH-BX-####`, same numbers | the prefix is part of artefact identity |
| validation method | `sxv-2026.1` | `bxv-2026.1` | id-namespaced; the algorithm did not move |
| `DATA_READINESS_SCHEME` | `…-v1` | `…-v2` | `ReadinessReport.settlement` → `.billing` |
| `DATA_READINESS_METHOD_VERSION` | `rdy-2026.1` | **unchanged** | no level, gate, count or refusal changed |
| **global contract** | **2.0.0** | **2.0.0** | unaffected |

**Global contract 2.0.0 is unaffected, structurally** — not by assertion. The extract has its own id,
version, scheme, method version and code catalogue; it is imported by exactly the readiness-path files;
and it enters no hash, no `pds`, no `PAD-`, no `PAX-`, no idempotency derivation, no Prisma model, no API
and no screen. Its own version comment states the property the sibling pattern exists to preserve: *a
change here never re-identifies a pilot submission and never forces a re-assessment.*

---

## 3 · Where the rename stops — the artefact boundary

> **The English word *settlement* is correct wherever it names the act of settling an obligation. It is
> renamed only where it named THIS ARTEFACT or its schema.**

**Kept deliberately.** `EXPECTED_SETTLEMENT_COUNT_AVAILABLE` is genuinely about settlement *events* —
how many settlements an obligation expected — and renaming it would destroy a true distinction. It sits
inside the renamed `BILLING_CAPABILITIES` array, which is the repository's standing *stay
distinguishable* rule applied as usual. Likewise `SETTLEMENT_COUNT_UNAVAILABLE` and the
`settlement_count / expected_attempts` stopped candidate.

**Byte-identical afterwards, and verified by hash on every run:** `reconciliationCore.ts` (`60e71f6f…`,
including `SettlementHypothesis` and `settlementsByUnit`, where the word is correct),
`reconciliationScenarios.ts` (`7dd786ba…`), `grainCandidates.ts`, the obligation-aware reading, both
frozen packages, both rulers and all ground truth.

---

## 4 · Preserving 1.0.0 — evidence, not machinery

The owner required that the 1.0.0 schema and its decision history stay **inspectable**, and separately
that **no compatibility machinery** be invented without a consumer. Those pull in opposite directions
only until the distinction is drawn:

> **A frozen record of DATA is evidence. A parser is machinery.**

* **Preserved** at `src/contract/historical/settlementExtract_1_0_0.ts` and
  `settlementExtractCodes_1_0_0.ts`: the field table, the stopped candidates, the claim boundary and
  every line of decision prose, unchanged. The only additions are a `HISTORICAL · SUPERSEDED BY` header,
  the moved import path, and `SETTLEMENT_EXTRACT_STATUS`.
* **Not preserved**: the validator. It is a parser that could accept `settled_at` again, so it was
  renamed *forward* to `billingExtractValidator.ts`. A test asserts the historical directory exports no
  function and contains nothing that validates.
* The `NH-SX-####` catalogue is kept because **a historical record cites a code**, and a record whose
  codes cannot be looked up cannot be read. `docs/CUSTOMER_DATA_READINESS_V1.md` says the V3 package
  answered `NH-SX-3001`; that sentence stays true and resolvable.

Same discipline as `BENCHMARK_REVISION_V2` (*a defective measurement is invalidated and preserved, never
deleted and never silently replaced*) and `expectationExtractCorrections.ts`, applied to a schema.

### The equivalence is DERIVED, not asserted

`historical/settlementExtract_1_0_0.test.ts` (10 tests) computes the claim rather than stating it:

1. the record still carries `settled_at` and `settled_amount` — it is the record *of* them, so it must
   not be "fixed";
2. **the rename map applied to the old column list reproduces the new one exactly, in order** — which is
   what "byte-for-meaning equivalence" means operationally;
3. every field keeps its tier, kind, PII class, capability, source-observability and owner, field for
   field, with `neededBy` compared through the capability rename;
4. no field was added, removed, promoted or demoted;
5. `NH-BX-####` is `NH-SX-####` with the prefix replaced and the number, severity, owner and `since`
   intact;
6. the recorded **event** carries over word for word — `theEvent`, all four `isNot` exclusions,
   `dateMeans`, `amountMeans` — while `nameCaveat` is absent from the successor and present on the
   predecessor, so the caveat's retirement is itself pinned;
7. the stopped candidates and the claim boundary carry over unchanged;
8. the record is imported by **its own test and nothing else** — asserted in both directions, because a
   guard that cannot tell *correctly inert* from *not wired up* was the `obligation_ref` failure.

**Five mutations were tried and all five fail**, including a tier change smuggled in as a rename and a
severity change hidden under the prefix swap.

---

## 5 · The customer-facing change

The caveat is **gone**, and its absence is a checked obligation: a stale warning about names that no
longer exist is the same class of defect as the contradiction it was covering for. In its place the
request states the meaning positively, and the dictionary carries a **"What this is NOT"** row on both
renamed fields — because a billing analyst can still put a payment date in a date column.

The **"Export B is INVOICES, not payments"** block **stays**. The hazard it addresses is a finance team
hearing "settlement" and reaching for the cash-application system; that is about the concept, not the
column name, and the artefact is still *about* settlement in the ordinary sense even though it records
charges. *An unpaid invoice is exactly as useful to us as a paid one.*

`settlement_template.csv` / `settlement_example.csv` → `billing_template.csv` / `billing_example.csv`.

**New falsifiers.** No customer-facing artefact — the seven documents **and the four CSVs** — may contain
`settled_at`, `settled_amount`, `nh.settlement-extract`, the old filenames, or any misleading-name
warning. The successor's names are asserted on the **schema**, so a document cannot be the only place
they exist. And no module outside the historical record may read or map a retired column name, which is
the no-compatibility-layer constraint made structural.

---

## 6 · Two guards caught my own instruments first

**The readiness control pinned the code family in a regex.** `/^NH-(EX|SX)-\d{4}$/` is an alternation, so
a literal `NH-SX-` → `NH-BX-` rename could not see it; 2 of 25 control checks failed on codes that were
perfectly correct. The control did its job.

**The importer guard counted a citation as a dependency.** Its first form stripped comments and then
matched the retired filename anywhere, so it flagged `billingExtract.ts` — whose *version history string*
names the retired module, which is a citation — and flagged the record itself for importing its own code
catalogue. It now matches **import specifiers only**.

> **Eighth instance in this repository of the same lesson: a structural guard must read code, and
> specifically the construct it is actually asking about.** A term is not a claim, a prose mention is not
> an import, and a string literal is not a dependency.

---

## 7 · Verification

**165/165** package checks · **25/25** readiness control, V3 → **L1** and the variant → **L2** unchanged ·
**1071 passed + 1 skipped** on a fresh database **and** again with no database configured · **599/599**
ep2 · **120/120** browser journey · `build`, `build:server` and both typechecks clean · `check:purity`
clean · `recon:verify` and `recon:ref:verify` clean · `verify:evidence` clean · `verify:registers` clean
on a fresh database · `git diff --check` clean.

**Preservation, by hash:** `reconciliationCore.ts` `60e71f6f`, `reconciliationScenarios.ts` `7dd786ba`,
V3 scorer `060359f5`, `ground-truth.csv` `0f5558e4`, V3 `observation.csv` `0ef21e40`, variant
`observation.csv` `76465e96`, `expectation.csv` `31992d23`, `planted-register.json` `111db9d1`.
`PILOT_DATA_CONTRACT_VERSION = "2.0.0"`, `EXPECTATION_EXTRACT_VERSION = "1.1.0"`,
`OBLIGATION_IDENTITY_FIELDS = []`. The $79,846.00 synthetic result is preserved as historical evidence
and no monetary or readiness figure moved.

**Not in this slice:** production reconciliation · production multi-extract identity · API · UI ·
customer data · merge · deploy.

---

## 8 · What is still open

* **The artefact is still *about* settlement in the ordinary sense** while recording charges, which is
  why the Export B warning stays. That is a property of the domain, not a defect to fix.
* **`EXPECTED_SETTLEMENT_COUNT_AVAILABLE` remains unavailable** — the fact belongs to the contract
  system, and on the synthetic evidence it buys event-level proof and no additional money.
* **Nothing reaches `AUTHORITY_VERIFIED`.** No provenance channel exists, so every readiness level stays
  **PROVISIONAL** with a ceiling of `SOURCE_NATIVE`. That, not the naming, is what still blocks a first
  real export.
