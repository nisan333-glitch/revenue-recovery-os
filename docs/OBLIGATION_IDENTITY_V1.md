# Obligation identity — what names one billed obligation, and what cannot

**Status: DECIDED. Staged implementation AUTHORIZED as contract 2.1.0, NON-EMITTING.**
The MAJOR grain change (3.0.0) is a separate authorization and is **not** granted by this document.
Candidate emission stays disabled throughout. Nothing here describes current behaviour except where it
says so explicitly.

Companion documents: [`GOVERNED_DETECTION_V1.md`](GOVERNED_DETECTION_V1.md) (why the account grain is
unusable), [`ASSESSMENT_IDENTITY_V1.md`](ASSESSMENT_IDENTITY_V1.md) (submission identity — a different
object), [`ANALYSIS_TERMS_GOVERNANCE.md`](ANALYSIS_TERMS_GOVERNANCE.md), and
[`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md).

## Why this document exists

EP-31d built the candidate identity

```
scheme ‖ NUL ‖ boundaryId ‖ NUL ‖ recoveryType ‖ NUL ‖ sourceNamespaceId ‖ NUL ‖ obligationRef
```

and it still cannot be used. Step 5 closed one of its two prerequisites — a governed
`sourceNamespaceId` can now be resolved — leaving one: **the data contract declares no obligation-level
identifier**, so `OBLIGATION_IDENTITY_FIELDS` is empty and `leakInstanceIdentityStatus()` refuses.

A pre-flight memo proposed closing that gap with an additive `obligation_ref` field. A clarification pass
found **four defects in the memo itself**. They are recorded here before any code changes, as the
constitution requires: *"Document a discovered gap before editing — not silently patched, not retrofitted
to match what the code already does."*

## Gap 1 · The aggregate-row contradiction, and the honest classification

The memo said the system cannot verify whether one row aggregates several obligations, and an adversarial
matrix in the same memo said *"one cycle containing >1 obligation → refuse."* Both cannot be true. The
matrix row was wrong, and it is withdrawn.

There are exactly two row-identity predicates in the entire path:

| Predicate | Where | What it detects |
|---|---|---|
| `duplicate_cycle_id` / `NH-DC-2016` | `src/assessment/assess.ts` `dedupeCollisions`; `src/contract/validateDataset.ts` cycle grouping | many rows → one cycle identity. **Every** member of the group is excluded; no winner is chosen |
| `DUPLICATE_SOURCE_ROW` / `NH-DC-4001` | `src/contract/validateDataset.ts` | a byte-identical repeat of the declared-field tuple |

Both detect **many rows claiming one identity**. An aggregate row is the inverse: **one row carrying two
obligations' money under one identity**. It presents as a single, clean, non-duplicate row. Nothing
observes it, and `DatasetProvenance` declares `sourceSystems`, `dataOwnerRole`, `extractionMethod`,
`extractedAt`, coverage and `assertedIndependentOfBeneficiary` — **no row grain**. `extractionMethod` is
free text.

### The classification, stated once

| Claim | Class | Basis |
|---|---|---|
| Two rows → one cycle identity → refuse both | **A — detectable and fail-closed today** | `assess.ts` `dedupeCollisions` |
| Byte-identical repeated row → reject | **A** | `NH-DC-4001` |
| One obligation spread over more than one accepted cycle → refuse population | **B — enforceable after the additive change** | `leakInstanceAttribution.ts` `ambiguousKeys`; `leak_instance_identity_ambiguous` is already declared |
| Mixed presence: some accepted cycles carry a reference, others do not → refuse whole | **B** | `leak_instance_identity_incomplete` is already declared |
| **One cycle containing more than one obligation → refuse** | **C — a customer assertion NH cannot verify** | no predicate exists at any layer |

The B-class controls catch **splitting**, never **merging**. That asymmetry is the finding.

### Why a row-grain declaration does not fix it

A `row_grain: one_obligation_per_row` field would be necessary for attribution but is **not sufficient**,
and no contract field can make it sufficient. The uploader is the beneficiary. The contract already
annotates the precedent: `assertedIndependentOfBeneficiary` is *"Recorded as an ASSERTION. It never
satisfies the trust invariant on its own."* A grain flag is the same kind of object. Under the standing
architecture test — *can the party who benefits from a larger recovery number influence the baseline,
evidence, timing, attribution, approval, or historical calculation?* — handing grain authority to the
uploader is a reject.

The only control that would enforce grain is **independent source evidence**: per-obligation records
signed by the billing system (the Ed25519 path in
[`SOURCE_VERIFICATION_AGENT_GATE.md`](SOURCE_VERIFICATION_AGENT_GATE.md)) cross-checked against the
extract. That is lane-2 infrastructure, it does not exist for pilot extracts, and it is not a contract
field. **Grain is class C and stays class C under any additive change.**

## Gap 2a · No synonym is safe. Zero automatic synonyms.

The memo proposed `invoice_id`, `invoice_number`, `billing_document_id` and `obligation_id` as automatic
header synonyms. The repository establishes **no** semantic property of any of them; its only mentions are
negative, naming them as things that are not declared and never auto-detected.

| Proposed synonym | One immutable obligation? | Uniqueness scope | Stable across re-export / correction / reschedule? | Reusable? | Display or source-native? | Verdict |
|---|---|---|---|---|---|---|
| `invoice_id` | UNKNOWN — naming convention is not evidence | UNKNOWN | UNKNOWN | UNKNOWN | probably native, UNKNOWN | **excluded** |
| `invoice_number` | **No, not established.** Commonly a human-facing sequence assigned at finalisation, per-series, and **re-issued** when a document is corrected or credited | per-series at best; sequences commonly reset per series or per year | **NOT ESTABLISHED** — reissue on correction is the ordinary case | **plausibly yes** | **a display number** | **excluded — not safe enough to be identity-bearing** |
| `billing_document_id` | **No** — "billing document" is a superclass covering invoice, credit memo and debit memo in several ERPs, so the value may name a non-obligation document | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | **excluded** |
| `obligation_id` | n/a — this is *our* vocabulary. No billing system emits a column by that name | n/a | n/a | n/a | n/a | **excluded — inventing a synonym for a header that does not exist in the wild** |

**Decision: `obligation_ref` has zero synonyms.** The canonical header is the only auto-detected name. Any
other header reaches the field only through an **explicit operator mapping**, which `autoDetectMapping`
already flags (`synonymMatched`: *"A synonym match is a GUESS"*) and which `mappingId` stamps into the
result. An operator mapping is still a beneficiary-side choice, but it is a **recorded** one; an automatic
synonym is an unrecorded decision made by us. Neither is as strong as a source attestation, and the
contract says so rather than implying otherwise.

## Gap 2b · "No normalization" was false. The complete inventory.

Every transformation applied to a cell value between the uploaded bytes and the assessment layer:

1. **BOM strip** — `parse.ts`, first byte `0xFEFF`. Affects the first header cell only.
2. **`CR` and `CRLF` → `LF`, across the whole file including quoted fields** — `parse.ts` `splitRecords`,
   `text.replace(/\r\n?/g, "\n")`. A value containing a literal CR is altered.
3. **CSV quote interpretation** — `tokenizeLine` strips surrounding quotes and collapses `""` → `"`.
   Correct CSV behaviour, and still a value transformation: `"A""B"` becomes `A"B`.
4. **Header trim** — `parse.ts`.
5. **Cell trim, on every value in the file** — `parse.ts`, `(values[j] ?? "").trim()`.
6. **Short-row fill** — `values[j] ?? ""`: an absent trailing cell becomes the empty string.
7. **Mapping fill** — `columnMap.ts`, `cells[canonical] = r.cells[source] ?? ""`: an unmapped column
   becomes the empty string, indistinguishable from a present-but-empty cell. This is the mechanism
   behind defect D1.
8. **Second trim** — `validateDataset.ts` `cell()`. Idempotent, and it is the value `looksLikePii` and the
   duplicate-row content key see.
9. **Third trim** — `adapters/saasActivation.ts` on the id values.
10. **No case folding of values anywhere.** Headers are lower-cased for matching only; `currency` is
    upper-cased and is not an identifier.
11. **No Unicode normalization at all** — no NFC, no NFKC. `é` as U+00E9 and `e` + U+0301 are visually
    identical and are **two different identities**. A false-split hazard, opposite in direction to (5)'s
    false merge.
12. Not a transformation but a gate on identifier values: `looksLikePii` rejects email-shaped,
    phone-shaped and **Luhn-valid 13–19-digit** values. A purely numeric document id of that length that
    happens to satisfy Luhn is rejected as card-shaped. A real false positive for some billing systems.

### The claim the contract may actually make

> Identity is compared over the **exact UTF-8 bytes after surrounding-whitespace removal**, with CSV quote
> interpretation and `CR`→`LF` record normalization applied upstream, and with **no case folding and no
> Unicode normalization**.

Two consequences are declared rather than discovered: `" INV-1"` and `"INV-1"` become the **same**
identity — a merge the customer did not request — and two canonically-equivalent but differently-encoded
Unicode strings become **different** identities. The pipeline's trim is load-bearing, because
`leakInstanceComponentProblem` refuses untrimmed values and control characters outright.

### Syntax

`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` — narrower than `MAX_IDENTITY_COMPONENT_BYTES`, so it is the
binding constraint. It is a **syntactic** bound and establishes nothing about stability.

In 2.1.0 a value failing it is a **row warning, never a rejection**. A rejection would drop the row from
the population and so would change a measured number, which contradicts this field carrying no weight.
Tightening it to a rejection belongs to the MAJOR change, where the field becomes identity-bearing.

## Gap 3 · No predicate establishes completeness, so emission stays disabled

`dedupeCollisions` runs **before** any obligation-level predicate can exist: the collision pass consumes
the raw cycles and every later stage sees only the survivors. **An `obligation_ref` on a row cannot rescue
that row, because the row is already gone when the reference is read.**

| Scenario | `cycleId` becomes | Outcome today | Does `obligation_ref` change it? |
|---|---|---|---|
| Same subscription, two invoices, **two distinct references** | both rows → the `subscription_id` | **both excluded**, `duplicate_cycle_id`; the money reads zero | **No.** Two genuine obligations are silently lost |
| Same subscription, two invoices, **same due date** | both → the `subscription_id` | both excluded | No — the due date is irrelevant while `subscription_id` is populated |
| Same subscription, two invoices, **different due dates** | both → the `subscription_id` | both excluded | No — differing due dates do not help |
| **Blank `subscription_id`** + valid `cycle_id` + reference | `""` is not nullish, so `??` never reaches `cycle_id` → the derived composite `entity\|signed\|due` (**defect D1**) | accepted if the composite is unique; `cycle_id` **and** the reference are both discarded from the key | No — the key stays date-derived, so a reschedule renames the obligation |
| **Missing reference on one row** of an otherwise candidate-capable dataset | unaffected | accepted today | **Yes** — `leak_instance_identity_incomplete` refuses the population **whole**. Class B |

### The candidate predicate, and why it is rejected

*Zero `duplicate_cycle_id` exclusions anywhere in the dataset* does close the row-loss path: every way the
cycle key destroys a genuine obligation surfaces as `NH-DC-2016`. The admission bar does **not** already
do this — `NH-DC-2016` is in `DUPLICATE_CODES` and feeds `duplicateRate` against `maxDuplicateRate`, so
two obligations lost in a thousand rows are **admitted with the loss**. A rate threshold is not a
completeness test.

It is rejected for a stronger reason than incompleteness: **it is satisfiable by the exact transformation
that destroys grain.** A customer whose export trips it can make it pass by pre-aggregating two invoices
into one row per subscription — zero duplicates, one reference, a clean dataset, and an identity that
names one of the two obligations whose money it holds. The predicate would reward the class-C failure
mode, and the two files are byte-indistinguishable in structure. A gate that points the incentive at the
failure is worse than no gate, because it looks like one.

**Conclusion: there is no predicate that establishes completeness safely. Emission stays disabled.**

## Gap 4 · The version conclusion, re-proved against the policy text

`COMPATIBILITY_POLICY` states:

```
minor: Add an optional or recommended field. · Add a header synonym. ·
       Add a new rejection code for a case previously reported under a broader code. ·
       Relax a rule so that a dataset valid under X.Y is still valid under X.(Y+1).
major: Add or promote a required field. · Remove or rename a field. ·
       Change the MEANING of an existing field, even with an identical name and type. ·
       Tighten a validation rule so a previously valid dataset is now rejected. ·
       Change the identity/idempotency derivation.
```

Four distinct kinds of change, kept apart on purpose:

**(i) Public contract meaning — MINOR.** Declaring `obligation_ref` **optional**, `kind: "identifier"`,
matches minor item 1 literally. `MINIMIZATION_RULES.rejectUndeclaredColumns` is `true`, so such a column
is **rejected today** as `UNDECLARED_COLUMN`; declaring it is therefore also minor item 4, a strict
relaxation.

**(ii) `recommended` would be MAJOR in substance — so the field is `optional`.** This corrects the
pre-flight memo. "Optional **or** recommended" is minor by the text, but `RECOMMENDED_FIELDS` feeds
`missingRecommendedColumns`, an admission check against the **governed, version-pinned**
`maxMissingRecommendedColumns`. Every existing export would gain one, and any boundary sitting at its
threshold would flip ADMISSIBLE → NOT_ADMISSIBLE — with no remedy, because anti-tuning forbids raising a
threshold after seeing the result. That is major item 4 in substance. The `dataset_warning`
(`NH-DC-1010`) is harmless on its own; the admission check is not.

**(iii) Internal assessment behaviour — MAJOR, and for the stated reason.** Making `cycle_id` reachable
when `subscription_id` is blank, or keying at obligation grain, changes `cycleId` for datasets valid
today, which changes which rows are excluded as `duplicate_cycle_id`: a previously **accepted** row
becomes **rejected** (major item 4). It also changes `cycle_id`'s declared meaning — *"Alternative
cycle-level join key when subscription_id is not the billing grain"* — which is major item 3. The measured
amount moving is a **consequence**, not the test. Output changing is not by itself a major change.

**(iv) Identity derivations — untouched.** `deriveIdempotencyKey` hashes the derivation tag, the
contract id at **major** grain, `boundaryId`, `datasetFingerprint`, `dateLocale`, `amountFormat`,
`currency`, `asOf` and `stallThresholdDays`. **The field table is not among them**, and
`PILOT_DATA_CONTRACT_FIELDS` has exactly four non-test consumers — two `kind` filters, the duplicate-row
content key, and the field index — **none a digest**. So adding a field does not touch major item 5.
`CandidateLeakInstanceIdentity` is a separate scheme carrying its own version
(`LEAK_INSTANCE_IDENTITY_SCHEME`) and its own rule — *"A change here is a NEW scheme id, never a silent
re-grade"* — so its versioning is independent of semver on the CSV contract.

Two further verified bounds on the additive change:

* Adding a field changes the duplicate-row content key's **value** (one extra empty element) but **not its
  equivalence relation**, so `DUPLICATE_SOURCE_ROW` behaviour is unchanged on every existing dataset. The
  map is local and persisted nowhere.
* `projectExecutionInput` **allow-lists exactly one attribute**, `paid_timing`, and drops the rest. So
  carrying `obligation_ref` on `cycle.attributes` provably cannot move `canonicalExecutionInput`,
  `hashExecutionInput`, `canonicalBinding` or `deriveExecutionId`. The projection is already fail-closed
  against new attributes. The corollary: anything that reads the reference sits **outside** the execution
  input hash, so a shadow measurement must be report-only and must not be persisted on the execution row.

## The decision

> **Staged 2.1.0 is safe, and must remain NON-EMITTING until the MAJOR change.**

Not "safe and sufficient": gap 3 shows no predicate establishes grain completeness, and the only candidate
rewards the failure mode. Not "ship it all as one MAJOR": the additive field is independently safe and is
the only way to obtain evidence about the properties gap 2 marks UNKNOWN. Designing the MAJOR grain change
with zero observations of real `obligation_ref` values would be the worse order.

### Safety invariant

> **A declared column is not a declared identity.**

`OBLIGATION_IDENTITY_FIELDS` stays empty under 2.1.0, so `leakInstanceIdentityStatus()` keeps returning
`{ establishable: false, reason: "leak_instance_identity_unavailable" }`. This is not a special case bolted
on: that module's own admission rule already requires a field to be *"an identifier of the OBLIGATION …
and stable across re-exports AND across a reschedule of its own due date"*, and gap 2 establishes that no
proposed name meets it. A test pins it.

### Capability boundary

`obligation_ref` may be, and may be only:

1. declared `requirement: "optional"`, `kind: "identifier"`, **zero synonyms**, with the syntax above
   carried as a **row warning**;
2. carried onto `ExpectationCycle.attributes` — never into `cycleId`, never into the precedence chain;
3. reported as observability: how many accepted cycles carry it, how many distinct values, whether any
   value repeats, and how many rows were lost to `duplicate_cycle_id`;
4. used in a **report-only** shadow attribution surfacing `ambiguousKeys` and
   `unresolvedContributingCycles` — persisted nowhere, counted as nothing, never a candidate.

Out of scope: emission, staging, populating `OBLIGATION_IDENTITY_FIELDS`, any change to the cycle-key
precedence, synonyms, execution-column writes, persisted shadow results.

### What 3.0.0 still needs, and does not have

* Observations of **real** `obligation_ref` values — uniqueness, stability across a correction, behaviour
  across a reschedule. All UNKNOWN today.
* A grain control that is **not the beneficiary's own assertion**. Class C until independent per-obligation
  source evidence exists.
* The cycle-key precedence change and its migration, which reject every 2.x export by construction
  (`MAJOR_ROW_SEMANTICS` gains `3: []`).

Until all three exist, a candidate is not emitted. Nothing in this document turns any observed amount into
Revenue Returned or Auditable Revenue.
