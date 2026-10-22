# Extract-Fault Reporting · V1

**Status:** built · report-only · no validator change · no customer-contract change
**Date:** 2026-10-15
**Preserves:** contract **2.0.0** · expectation extract **1.1.0** · billing extract **1.0.0** ·
`exv-2026.1` · `bxv-2026.1` · `nh-customer-data-readiness-v2` · `rdy-2026.2` · `pav-2026.2` ·
`OBLIGATION_IDENTITY_FIELDS = []` · every frozen artefact · every `docs/pilot-intake/` artefact

---

## 1 · The gap

A readable CSV with the wrong columns came back `usable: false` and `L0_NOT_READABLE` carrying **no code
saying why**. The validator had already computed them — `NH-EX-1001..1004` and `NH-BX-1001..1004` sit in
`extractFaults` — and `evaluateDataReadiness` surfaced `rejectionCodes`, which is **row** level, while
dropping the extract-level codes entirely.

So the one case where NH says *"I cannot read this at all"* was the case where it explained least. Recorded
as §6b of [`LOCAL_PAIR_READINESS_V1.md`](LOCAL_PAIR_READINESS_V1.md) and pinned by a test, now turned over.

## 2 · The hazard the fix had to avoid, proved rather than assumed

`csvPairTransport.ts` is `const header = records[0]!`, **unconditionally**. A customer export with no
header row therefore makes the first **data** row the header, and `UNDECLARED_COLUMN`'s detail reads:

```
NH-EX-1003 · column "ENT-00041" is not declared by nh.expectation-extract@1.1.0
NH-EX-1003 · column "2026-03-01" is not declared by nh.expectation-extract@1.1.0
NH-EX-1003 · column "1499.00"   is not declared by nh.expectation-extract@1.1.0
```

That is real entitlement identity, a real date and a real **amount**, quoted verbatim. A headerless export
is an ordinary mistake, so a report that rendered details would leak customer data **precisely in the case
the diagnostic exists to diagnose.** The four faults split by provenance:

| fault | detail contains | file-controlled | safe to render |
|---|---|---|---|
| `*-1001` EMPTY_EXTRACT | `"no rows"` | no | yes |
| `*-1002` MISSING_REQUIRED_COLUMN | a declared constant from `*_REQUIRED_COLUMNS` | no | yes |
| `*-1003` UNDECLARED_COLUMN | a header string **from the file** | **yes** | **no** |
| `*-1004` DUPLICATE_COLUMN | a header string from the file | yes | only if declared |

## 3 · The rule

> **A diagnostic may name a column only when the NAME IS OURS.** A declared column name is a contract
> constant; a header string from the file is customer data of unknown kind — in a headerless export it
> *is* a data row. Codes are ours, so codes may be reported. The validator's `detail` is not, so it never
> leaves the validator.

## 4 · What was built

One field on each report block, mirroring `rejectionCodes` exactly:

```ts
extractFaultCodes: Object.freeze([...new Set(expectation.extractFaults.map((f) => f.code))].sort()),
```

Deduped and sorted like its sibling, so **neither list's order can depend on where in the header a fault
was found**. On a wrong-column pair the CLI now answers `["NH-EX-1002", "NH-EX-1003"]` where it previously
answered nothing.

**Neither governed validator is touched.** The `{code, detail}` record is unchanged, and
`expectationValidationWitness` — which hashes `[f.code, f.detail]` alongside the header and every raw cell
— is byte-identical **by construction**. That witness has no production caller, which is *not* why this is
safe: *"nothing fails today"* was named as the wrong test by the Detector #2 decision. It is safe because
the validators were not modified, and a canonical-shape pin now keeps the record at exactly two keys so a
later third field fails loudly instead of silently entering the preimage.

**The honest cost:** the report does not name *which* required column is missing, or where an unrecognised
one sits. The customer looks the code up and opens their file. Naming them safely would have meant adding
fields to both validators, because only the validator holds the header.

## 5 · Two distinctions asserted rather than assumed

**"No rows" must not collapse into "wrong shape."** Both are `usable: false` and both are `L0`, so without
the codes they are one undifferentiated *unreadable* — and the remedies are opposite. An empty extract
means *send us the obligations*; a wrong header means *fix the columns*. `NH-EX-1001` carries the rule that
an empty extract is **never** read as "nothing was owed".

**Extract level is not row level.** An unusable extract still reports `rejectedRows: 0` and
`rejectionCodes: []`, because no row was ever examined — claiming a rejected row would assert work that
never happened. That is what the original §6b pin was really protecting, and it survives the fix: the two
lists answer different questions and neither substitutes for the other.

## 6 · Version and contract determination, made before editing

| constant | verdict | why |
|---|---|---|
| `EXPECTATION_EXTRACT_VERSION` | **1.1.0**, untouched | no validator file changed |
| `BILLING_EXTRACT_VERSION` | **1.0.0**, untouched | no validator file changed |
| `exv-2026.1` / `bxv-2026.1` | untouched | the accept/reject function is identical |
| `DATA_READINESS_SCHEME` | stays **`-v2`** | the field is **additive**; a scheme id moves on a *breaking* shape change |
| `DATA_READINESS_METHOD_VERSION` | stays **`rdy-2026.2`** | no level, gate, conjunct, count or refusal changed, and no new state became reachable — `usable: false` and `L0_NOT_READABLE` already existed. The report stops *dropping* codes it already held |

**No public/customer-facing contract impact.** No column, tier, code, severity, capability or acceptance
behaviour moved, so a customer's file is judged identically and every `docs/pilot-intake/` artefact stays
byte-identical. All five constants are pinned by a test, because a version decision nothing asserts drifts.

## 7 · Falsification

Five mutations, each proved to fail:

| mutation | caught by |
|---|---|
| drop the field | 5 tests across both files |
| surface `detail` instead of `code` | both PRIVACY tests, plus 3 more |
| skip the dedupe and sort | the POSITIVE equality, in both files |
| map every fault to one code | the "stay distinguishable" negative |
| add a third key to the fault record | the CANONICAL shape pin |

The privacy test is the one worth reading: it performs the headerless case, **asserts the validator really
does quote the amount**, and then asserts none of it reaches the report — with the forbidden strings
computed from the validation rather than hardcoded, so the guard cannot drift from what the validator
produces.

## 8 · Reported, not actioned

> **One of the four below is since CLOSED — see §8b.** The verifier's raw-fault logging was not in §8's
> original list because it was found by the Gate 2 audit that followed; it is recorded there in full.

**a · `emit-package.ts` hardcodes the code this field now provides.** Because the report carried none,
`columnAbsent()` renders `side === "expectation" ? "NH-EX-1002" : "NH-BX-1002"` into the generated field
dictionary, its own comment admitting a `?` placeholder was the first attempt. That contradicts the rule
the dependency probe exists to enforce — *a customer-facing claim is generated from the behaviour of the
code that will judge their file, never authored beside it*. It is now **derivable**, and deriving it would
leave the rendered document byte-identical. **The named next slice.**

**b · the dead `asOf` test fixture.** `src/contract/dataReadiness.test.ts` still declares
`const E_TERMS = Object.freeze({ currency: "USD", asOf: "2026-06-30" })`, and `ExpectationExtractTerms`
declares only `currency`, `dateLocale` and `amountFormat`. This is the same defect removed from
`control.ts` on 2026-10-10, and it survives here for a specific reason worth recording: a **named `const`
escapes TypeScript's excess-property check**, which only fires on a fresh object literal at the call site
— so `typecheck:scripts` caught the one in `control.ts` and no project catches this one. It is inert, but
it reads as a governed **cut-off** handed to a validator whose stated property is that it *consults no
clock*. **An excess property that looks like a governed term is worse than a missing one, because a
reviewer believes it.** Not edited here, by instruction.

**c · catalogue asymmetry.** `billingExtractCodes.ts` carries `ownedBy`; `expectationExtractCodes.ts` does
not. So §6b's *"and its owner"* half is **not** delivered — rendering an owner for one side only would
announce a capability from a subset of the facts, which is the `coverage.event` error. Adding the field is
a contract change with an owner.

**d · `NH-*-1004` is unreachable through the CLI.** `parseStrictCsv` throws `CSV_DUPLICATE_HEADER` before
the validator sees a duplicate, so the duplicate-column fault is reachable only by calling the evaluator
directly, as the control and the tests do. Recorded so the code is not mistaken for dead.

## 8b · Gate 2 · closed 2026-10-15

The slice above proved detail-containment for the report, the CLI and every error path, and found one
exposure it did not close: `scripts/pilot-intake/verify-package.ts` passed
`JSON.stringify(val.extractFaults)` as a check **detail** at both sites, and the report loop prints every
detail **unconditionally, pass or fail**. So a fault detail could reach a log stream.

**The correct pattern was already on the next two lines.** The row-rejection checks immediately below
render `` `${r.rowNumber}:${r.code}` `` — code only — and a row rejection's detail quotes **cell values**,
a larger leak than a header name. The two fault checks were the inconsistent pair in an otherwise
sanitized block.

**And the sanitized surface already existed**, so no second sanitizer was written: both checks now render
from `ReadinessReport.*.extractFaultCodes`, whose detail-freeness §7 already proves against the headerless
case, with the fault **count** retained because the count is ours. Check semantics are untouched — the
predicates still read the validations, so pass/fail and the 242 count are unchanged.

> **A sanitized rendering is taken from the surface whose sanitization is already proved, never
> re-derived beside the call site.** A second implementation of the same rule is a second thing that can
> drift from it.

### The mutations name the load-bearing guard, and it is not the flattering one

Four mutations — restoring either `JSON.stringify(val.extractFaults)`, rendering `f.detail`, adding a
third stringify elsewhere — are caught by the **structural** test and by **none of them** by the
end-to-end one. On the committed clean examples the fault list is empty, so nothing is rendered either
way. The end-to-end test does run the real verifier and scan stdout and stderr together against detail
strings recomputed from the committed CSVs — the gate's literal wording — but `DIR` is hardcoded, so it
cannot induce a failing run. **That is recorded inside the test**, because a reader counting four passing
mutations would otherwise credit the wrong half.

The failing-verification case is therefore carried behaviourally: a **headerless** pair through the real
validators, asserting the validator does quote `ENT-00041` and `1499.00`, that the rendered values contain
neither, and that every rendered token matches `/^NH-(EX|BX)-\d{4}$/`.

### The gap it uncovered — CLOSED IN PART on 2026-10-15

> **RESOLVED for the four named verifiers.** `pilot:verify`, `readiness:control`, `recon:verify` and
> `recon:ref:verify` now run in a fifth CI job, fail-closed and proved by induction, after the blocker
> below was cleared: the frozen benchmark inputs were untracked, so three of the four would have thrown
> `ENOENT` on a clean checkout. See [`CI_VERIFIER_COVERAGE_V1.md`](CI_VERIFIER_COVERAGE_V1.md).
> **`verify:evidence` remains outside CI** and is the recommended next action. The paragraph below is
> preserved as the finding.

### The gap it uncovered, reported not fixed

**CI does not run `pilot:verify` at all.** The four jobs run `check:purity`, `test`, `build`,
`typecheck:scripts`, `test:ep2`, `test:journey` and `verify:registers`. So `pilot:verify` (242 checks),
`readiness:control` (25), `recon:verify` and `recon:ref:verify` execute **only when invoked by hand**.
This is why the regression test had to live in a vitest suite rather than as a self-check inside the
verifier — *a test CI never runs is not a guard* — and it is a larger gap than this slice: four
verifiers guarding frozen evidence, a customer-facing package and the readiness control are outside the
automated gate. **Its own slice.**

### What Gate 2 now is, exactly

Absolute for **validator detail strings**: no path — report, CLI stdout, CLI stderr, error branch, or
verifier log — renders one, and the structural guard covers all four files in the directory plus the
absence of any stderr site. It is **not** a categorical guarantee about verifier output: `check()` takes a
free-text detail at 240-odd call sites, and the new guard narrows the structural ban to validations,
fault lists, rejection lists and accepted rows — the constructs that actually carry customer text.
Breadth beyond that is a convention, not a mechanism.

## 9 · What this does NOT establish

Nothing about money, authority, provenance or proof. The report still contains no money, the rung still
caps at `SOURCE_ATTESTED`, every level stays **PROVISIONAL**, and **no observed amount became Revenue
Returned.** The residual risk is that the privacy property rests on a guard over the serialized report
rather than on the detail string being safe: the leaky string still exists inside the validator, one field
away from anything that decides to render it.
