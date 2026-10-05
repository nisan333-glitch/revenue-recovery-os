# S1 · Obligation identity — read-only audit of the prior staging and revert (v1)

**Status: governance record, 2026-10-05.** A read-only audit of the repository and its git history. **No
contract change, no field declared, no detector built.** Contract remains **2.0.0**;
`OBLIGATION_IDENTITY_FIELDS` remains `Object.freeze([])`. The only code change shipped alongside this
record is **S1b**, two behaviour-preserving test corrections (§8).

This exists because the constitution requires a discovered gap to be documented before it is edited, and
because this ground has been walked once already. Three of the findings below were established on
2026-10-01 and then reverted *with their code*, which is how one of them came to be independently
re-derived four days later. Writing them down is cheaper than deriving them a third time.

---

## 1 · The prior revert was NOT a rejection of the semantic idea

`obligation_ref` was never found to be the wrong concept. The staging was reverted for reasons about
**wiring, evidence and honesty**, every one of which is fixable, and none of which is an objection to an
obligation-level identifier existing.

Stated plainly so it cannot be misread later: **nothing in the history forbids declaring
`obligation_ref`.** What the history forbids is declaring it the way it was declared.

## 2 · Why it was actually reverted — four reasons

From `625c51c`, which reverted `3aa0d09`, `6e3c512` and `36ce453` in full:

1. **No production consumer.** `observeObligationReferences` had exactly two call sites, both inside its
   own test file. The field was accepted and never observed.
2. **Evidence could not be collected truthfully.** The value died at every boundary leaving the request:
   `acceptedCycles` is deliberately stripped from `PilotIntakeResponse`, the submission record stores
   finding **codes** only, `AssessmentResult` has no cycles field, and `projectExecutionInput`
   allow-lists exactly one attribute. **Six of the seven facts the future MAJOR decision needed were
   uncollectable**, and the seventh (rows lost to cycle collision) predated the work and carries no
   reference. The only durable trace was `NH-DC-2022` — which records that *some* reference was badly
   shaped, never what any reference was, and nothing at all when every reference was well formed.
3. **Customer-facing prose overstated what was happening.**
   `CUSTOMER_PILOT_DATA_CONTRACT_V1.md` told customers the field is *"recorded and reported back to you"*
   and that *"we are collecting it"*. Both false — it was discarded at the end of the request.
   `proseClaims.test.ts` did not catch it because that guard scans for data-locality claims only.
4. **The verification gate could not distinguish intentional inertness from missing wiring.** The gate
   was *"nothing is persisted"*, and the module passed it — by persisting nothing **and also by doing
   nothing**. A suite that exercises a module only from its own test file cannot tell *correctly inert*
   from *not wired up*. **Reachability was never asserted.**

(The staging was also unauthorised, which is recorded in the revert but is a process fact rather than an
architectural one.)

## 3 · No implementation residue survives the revert

The revert produced a tree **byte-identical** to `a800241` — both resolve to tree `84b5be5f`. Verified in
the current tree by search:

| Artefact | Present today? |
|---|---|
| `NH-DC-2022` | **absent** |
| `observeObligationReferences` | **absent** |
| "recorded and reported back to you" / "we are collecting it" | **absent** |
| `obligation_ref` in any contract field table or adapter | **absent** |

The only mentions of `obligation_ref` in the repository are in design records that discuss it:
`DUAL_MAJOR_SEMANTIC_CHANGE_V1.md`, `DETECTOR_3_FAILED_PAYMENT_V1.md`,
`MISSING_INVOICE_ARCHITECTURE_V1.md`, and this file.

**Two exceptions, and they are the subject of S1b** — the revert restored two tests that the bump had
fixed. See §8.

## 4 · Surviving architectural decisions and evidence limitations

The revert discarded the code and kept the reasoning. These stand, and anything built next must honour
them.

**4.1 · Aggregate rows are structurally invisible** (`36ce453`, GAP 1). One row carrying two obligations
cannot be detected: the only two row-identity predicates — `duplicate_cycle_id` and
`DUPLICATE_SOURCE_ROW` — both detect *many-rows-to-one-identity*, never *one-row-to-two-obligations*.
**Grain is a customer assertion and no contract field can promote it**: a row-grain flag would hand grain
authority to the beneficiary, which the standing architecture test rejects. Only independently signed
per-obligation source evidence could enforce it, and that is lane-2 infrastructure.

**4.2 · Zero synonyms, and the exact normalisation inventory** (`36ce453`, GAP 2). `invoice_number` is a
display sequence commonly re-issued on correction; `billing_document_id` may name a credit or debit memo;
`obligation_id` is NH's own vocabulary rather than a real export header; `invoice_id` is UNKNOWN on every
property the identity needs. And normalisation is **BOM strip, CR/CRLF→LF across quoted fields, quote
collapsing, and a cell trim** — with **no case folding and NO Unicode normalisation**, so two visually
identical references are two identities. The strongest claim the contract may make is *exact UTF-8 bytes
after surrounding-whitespace removal*, with both consequences declared rather than discovered.

**4.3 · `dedupeCollisions` runs before any obligation-level predicate could** (`36ce453`, GAP 3), so a
reference cannot rescue a row that is already gone. And the one candidate completeness predicate — zero
`duplicate_cycle_id` — is **satisfiable by pre-aggregating two invoices into one row**, which is the very
thing that destroys grain. *"A gate that points the incentive at the failure is worse than no gate,
because it looks like one."*

**4.4 · OPTIONAL, never RECOMMENDED** (`36ce453`, GAP 4). `RECOMMENDED_FIELDS` feeds
`missingRecommendedColumns`, which the admission gate checks against a **governed, version-pinned**
`maxMissingRecommendedColumns`. Every existing export would gain one, and a boundary sitting at its
threshold would flip ADMISSIBLE to NOT_ADMISSIBLE **with no remedy, because anti-tuning forbids raising a
threshold after seeing the result**. That is *"tighten a rule so a previously valid dataset is now
rejected"* in substance — major, despite the policy's letter calling it minor.

> **This is the same finding recorded independently as [`GOVERNED_ISSUES_V1.md`](GOVERNED_ISSUES_V1.md) §1
> on 2026-10-05, four days later, while scoping Detector #3.** The re-derivation is corroboration, not
> news. Governed issue #1 should be read as citing `36ce453`; two independent routes reached it, which is
> the strongest evidence available that the policy text is genuinely wrong rather than merely awkward.

**4.5 · `obligation_ref` is explicitly NOT authorised as a replacement cycle identity**
(`DUAL_MAJOR_SEMANTIC_CHANGE_V1.md`, DECIDED 4): *"No replacement cycle identity is authorized.
Specifically not chosen: `cycle_id` precedence · composite identity · `obligation_ref` · source-native
record identity · due-date / window identity · any NH-derived fingerprint."* A negative authorisation that
remains in force. It also records that **D2 — what `subscription_id` means — is OPEN pending real customer
evidence**, and that the frozen corpus cannot decide it, because
`scripts/synthetic-validation-2026-09-27/generate.mjs` emits `subscription_id: synthetic-sub-${id}` with
`id` varying **per row** — semantically an invoice id — so the frozen cycles never exercised D2 and *"would
score every candidate option identically"*.

## 5 · The bias problem — identity evidence collected after upstream rejection cannot validate identity

The sharpest finding in the history, from the revert itself:

> *"Because D1 and D2 still discard rows upstream, and discard them precisely for the multi-invoice
> subscriptions a future grain change exists to serve, any durable record built today would accumulate
> evidence drawn from the easy half of the data, biased toward 'the reference looks stable and unique'."*

Spelled out: obligation references observed by NH today would be observed **only on rows that survived
`dedupeCollisions`** — i.e. overwhelmingly single-invoice subscriptions. The cases an identity model most
needs to be tested against — consolidated billing, split billing, re-keying, merges, migrations — are
exactly the cases whose rows are **discarded before any reference could be read**.

**Consequence, binding on any future evidence-gathering slice:** an identity model validated on
post-rejection evidence is validated on the cases it cannot fail. Evidence must therefore be gathered
**before** or **across** the rejection boundary, or it must not be used to justify an identity model at
all. This is why §7's sequence puts a two-sided synthetic generator *before* the field declaration: the
generator can produce the difficult cases that the real corpus structurally cannot.

## 6 · A generic invoice-level `obligation_ref` is not sufficient for cross-system reconciliation

The prior design contemplated `obligation_ref` as a component of **candidate leak-instance identity** —
`(boundaryId, recoveryType, sourceNamespaceId, obligationRef)` — entirely **within one extract**. Missing
Invoice needs something different: a **join key between two independently-produced extracts**. The
candidate key needs only to be unique and stable *within one source*; a join key must additionally be *the
same value in two separately-exported systems*.

The two sides identify at different grains. The expectation side identifies a **scheduled obligation**
(entitlement × period); the billing side identifies an **invoice**, which may bundle several scheduled
obligations or split one across several. So the relationship is **many-to-many in general**, and a single
shared invoice-level key fails in both directions:

| Event | Effect on a single shared key |
|---|---|
| one expected event → multiple invoices (split billing) | **Misses a real missing invoice** — the first invoice matches, the unbilled remainder looks satisfied |
| multiple expected events → one invoice (consolidated billing) | **Manufactures false missing invoices** — and §4.1 says the aggregate row cannot even be recognised as an aggregate |
| re-keying | **Manufactures** — the new key matches nothing |
| account merge / split | Manufactures or hides, depending which side keeps the key |
| **source-system migration** | **Catastrophic — every key changes at once, so the entire expected book reads as missing** |

That last row is the decisive one. A billing migration is a routine customer event, and under a single
shared key it would produce a report claiming nothing had ever been invoiced.

**Therefore:** an invoice-level `obligation_ref` may be a *precision refinement* where a source system
genuinely stamps a schedule-line reference on both sides, but it cannot be the correlation mechanism.
Model options and the recommended direction are in
[`MISSING_INVOICE_ARCHITECTURE_V1.md`](MISSING_INVOICE_ARCHITECTURE_V1.md); the grain question itself is
deferred to the D2 decision package, which is **not** decided here.

## 7 · Global REQUIRED identity is rejected for now

Making an obligation identifier globally **required** would reject datasets that are **still useful to
Detectors #1 and #2**, which need no such identifier and measure real money without it. That is a certain
loss of working capability in exchange for an uncertain gain.

**The repository already has the right pattern, and it is load-bearing:** `leakInstanceIdentityStatus`
fails closed on `leak_instance_identity_unavailable`, and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` is a
**separately named** prerequisite — deliberately separate *"because collapsing them would let closing
either look like closing both"*. Capability gating per detector, not a global admission rule.

**Decision: optional at the contract level; a named, per-detector prerequisite where a detector genuinely
requires it.**

### 7.1 · Missing Invoice must fail closed when its own prerequisite is unavailable

Without authoritative cross-system correlation, NH cannot distinguish **"not billed"** from **"billed, and
we could not match it"**. Those are a finding and a guess respectively.

> **Missing Invoice makes no monetary finding, and no event finding, when its authoritative correlation
> prerequisite is unavailable. It refuses, under its own named prerequisite, and says so.**

A refusal is the correct output. A dataset that cannot support Missing Invoice remains fully assessable by
Detectors #1 and #2, and nothing about those figures changes.

### 7.2 · An identity or correlation field must not be introduced without its production consumer

This is the lesson of §2, stated as a rule:

> **No identity or correlation field is declared until the production code that reads it ships in the same
> slice.** A declared-but-unconsumed field collects no evidence, invites customer-facing prose that
> overstates what happens to it, and passes an inertness gate that cannot distinguish *correctly inert*
> from *not wired up*.

**This corrects a statement made in this repository's own planning on 2026-10-05**, that closing the
obligation-identity gap *"pays for itself regardless of whether this detector is ever built"*. On the
evidence of `625c51c` that is wrong, and it is withdrawn. The *decision* is worth making early and costs
nothing; the *declaration* must ship with its consumer.

## 7.3 · Corrected monetary claim for Missing Invoice

> **"Missing Invoice creates the capability to identify incremental exposure outside D1/D2. Actual
> incremental union money is dataset-dependent and may be $0."**

Monetary exposure exceeds zero only when **all four** hold: an authoritative expectation exists; the
expected event is genuinely absent; an authoritative expected amount exists; and every
exclusion/lifecycle control passes.

**What is NOT weakened.** The **population** claim stands exactly as written: the Missing Invoice
population is disjoint from Detectors #1 and #2 *by construction*, because the rows are in a different
file, sourced from a different system, and are not in the billing extract at all. A matched expectation
means the invoice exists and is therefore D1/D2 territory, contributing zero here — so the surfaces meet
only where one of them is empty. Disjointness is structural; the **amount** is dataset-dependent. Two
different claims, and only the second was overstated.

Corrected in `MISSING_INVOICE_ARCHITECTURE_V1.md` §7.2 and in `CLAUDE.md`'s missing-invoice decision
paragraph. The UNKNOWN-money rule is unchanged: existence established and authoritative amount unavailable
⇒ **counted, never valued, never estimated, never averaged from prior invoices or a plan price.**

---

## 8 · S1b — the two version tests, hardened

The revert restored two tests that pin the **implemented** contract version as a literal. Both would fail
on any future bump, and for the wrong reason. Every other version test in the repository already
parameterises the implemented version explicitly — `pilotDataContract.test.ts` test 10c
(`at2 = (v) => isSupportedContractVersion(v, "2.0.0")`) and every case in
`interpretationSelection.test.ts` (`pick(declared, implemented)`) — so this was **two assertions, not a
class of them.**

| Was | Now | Why the literal was wrong |
|---|---|---|
| `pilotDataContract.test.ts` · `isSupportedContractVersion("2.0.1") === false`, with no implemented-version argument | derives `impl` from `PILOT_DATA_CONTRACT_VERSION` and probes `major.minor.(patch+1)` and `major.(minor+1).0` | At an implemented 2.1.0, `2.0.1` is an **older minor of the same major**, which `acceptsOlderMinorOfSameMajor` **promises to accept** ⇒ the correct answer flips to `true`. The intent was always "implemented, plus one" |
| `identityDerivation.test.ts` · `expect(row.contractVersion).toBe("2.0.0")` | `toBe(PILOT_DATA_CONTRACT_VERSION)` | It asserted the build's identity rather than the behaviour under test. The sibling `declaredVersion: "2.0.0"` was derived too, because the scenario is "declared as current", not "declared as 2.0.0" |

**Behaviour-preserving**: contract stays 2.0.0, no accepted/rejected population changes, no `pds`/`PAD`/
`PAX` movement, no `findingHash` movement, no calculation-method movement, no schema change, no production
detector change. Only test files and a test title changed.

### 8.1 · Four proofs, run against the real code and reverted byte-identically

| Proof | What was done | Result |
|---|---|---|
| **A** · survives a legitimate bump | `PILOT_DATA_CONTRACT_VERSION` temporarily set to `2.1.0`, corrected tests run | **42/42 and 17/17 pass.** The whole contract test file now survives a minor bump |
| **B** · the landmine was real | Pre-fix tests restored, constant still `2.1.0` | **Both fail, exactly as predicted**: `expected true to be false` (the `2.0.1` probe) and `expected '2.1.0' to be '2.0.0'` (the persisted version) |
| **C** · still bites a version regression | Constant restored; the newer-than-implemented refusal deleted from `isSupportedContractVersion` | **Fails** — the derived probes flip, and tests 10b and 10c catch it too |
| **D** · still bites a semantic regression | `validateDataset.ts:503` made to record `"1.1.0"` instead of the implemented constant | **Fails cleanly**, one assertion: `expected '1.1.0' to be '2.0.0'` |

Proof D was run twice. The first attempt recorded `input.declaredVersion`, which produced 500s across the
suite — a pass by accident rather than by the assertion under test. It was sharpened to a **valid but
wrong** version so that only the guarded assertion can break. Recorded because the distinction generalises:
*a falsifier that fails for a secondary reason has not proved the test bites.*

Every modified source file was restored and verified byte-identical by `sha256sum -c`.

---

## 9 · What this record does NOT decide

* **Which grain** Missing Invoice reconciles at — deferred to the D2 decision package.
* **Whether `obligation_ref` is ever declared**, and in what form.
* **D1's release treatment**, which `DUAL_MAJOR_SEMANTIC_CHANGE_V1.md` leaves explicitly open as *"the
  choice is a human's"*.
* **Any contract version movement.** Contract is **2.0.0** and is not bumped by this slice.
