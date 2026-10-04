# Reference-first scheduling · v1

**Decided and built 2026-10-04.** Status: in force. Contract version unchanged (`2.0.0`). No identity
derivation changed; no stored `pds`, `PAD-` or `PAX-` moved.

> **The rule.** An execution is authorised by an immutable admission decision, not by what the request
> re-asserts about the reading. The request may **cite** the decision; every fact that decides what the
> run measures is then read **from that record** and the record's own submission identity is re-derived
> from those facts and compared before anything runs.

## 1 · The gap this closes

Scheduling used to begin by **validating** the re-supplied bytes under whatever the request claimed, and
the submission key that fell out of that validation was how the admission decision was found
(`findSubmission(report.idempotencyKey, boundaryId)`).

Four consequences, all of them against the Trust Invariant's first clause — *the evidence originates
from a source the beneficiary cannot unilaterally alter*:

1. **Every authoritative input came from the requester.** `declaredVersion`, `locale`, `amountFormat`
   and the analysis-terms reference were all request fields, and the policy was built from them.
2. **The closing check could not fail.** The record was selected *by* a hash of those same inputs, so
   comparing that hash against the record was a restatement, not evidence.
3. **`declaredVersion` was not even inert.** A malformed or unsupported value raises a
   `dataset_rejected` finding; `frozenReport` then returns `acceptedCycles: []`; projection finds zero
   cycles; the schedule is refused **`NH-AX-1009` — "no accepted cycle survived projection"**. So a
   caller's claim about the contract version could block a dataset the server had already judged, and
   the refusal blamed the data. Falsifier F1 reproduces this exactly.
4. **§10's two-major promise was unreachable at schedule time.** The discovery key embeds the *build's*
   contract major, so an admission recorded under a previous major could never be found — whatever
   `isSupportedContractVersion` and the `PREVIOUS_MAJOR_SUPPORT` ceiling registry said about it.

## 2 · The order, which is the design

| # | Step | Source of truth |
|---|---|---|
| 1 | least privilege | `requireCan` |
| 2 | tenant authorization | authenticated context only, never a body field |
| 3 | **the anchor** — load the immutable decision; the supplied bytes are its bytes; it hashes to its own id | `findSubmissionByDecisionId`, boundary-scoped |
| 4 | **the admitted terms** — date locale, amount format, governed analysis-terms address | the stored S4a snapshot + the append-only register |
| 5 | **the identity** — re-derive the submission key and compare, unconditionally | stored facts only |
| 6 | **contract support** — may this build still serve what it was admitted under | this build's current declarations |
| 7 | contract validation, under the **admitted** interpretation | the supplied bytes |
| 8 | governance, re-checked now | the admission bar's lifecycle |
| 9 | projection — accepted cycles only, de-identified | the report |
| 10 | persistence + enqueue, keyed by a deterministic id | — |

**Step 5 is before step 6 and they are not folded together.** Support is a question about *this build's
current declarations*, which a human may withdraw at any time. Identity is a question about an
*immutable record*. Answering them together would let a withdrawal of support report itself as the
record having changed — the error this repository has already refused once, for PAD v2.

**The major in step 5 comes from the decision, not from this build.** A stored key embeds the contract
major that was current when it was minted, so `deriveIdempotencyKey` gained an optional
`contractMajor`. Omitted — which is what the intake always does when minting a *new* identity — it is
byte-identical to before. Passed, it lets a verifier re-derive a historical identity under the major it
was actually minted under. Falsifier F3 shows what happens without it: a previous-major admission is
refused `NH-AX-1012` against data that never changed.

## 3 · Two named paths, never blended

**Reference-first** (`admissionDecisionId` cited). The decision is addressed directly. Nothing the
request claims about the reading takes part in finding it, so step 5's comparison is **evidence**.

**Legacy discovery** (no reference). The key is derived over caller-supplied interpretation and used as
the address, exactly as before. Kept because every admission recorded before the snapshot columns
existed can only be reached this way, and failing those closed would have broken scheduling for every
dataset already admitted — a destructive change, not a tightening.

Its limits are **stated, not papered over**: a record found this way already agrees with the inputs
that found it, so step 5 there is a **consistency check and not a lineage proof**; and because the key
embeds the build's major, it can only reach an admission from the same major.

The UI cites the reference. Proven by a matched pair of probes against the real browser journey: it
passes 86/86 when every *uncited* schedule is refused, and fails 7 checks when every *cited* schedule
is refused.

## 4 · What the request may and may not say

| Request field | Treatment | Why |
|---|---|---|
| `declaredVersion` | **gone** — S5 removed it from the type, the body and the client. An injected one is a 400 | Not a choice anyone makes about the run: both clients sent the build constant. See §11. |
| `locale`, `amountFormat` | absent, or equal to the admitted value | Naming a different one and running under the admitted one anyway would report a result nobody asked for. Naming a different one and *getting* it would let the beneficiary choose the reading. |
| `analysisTermsId` / `Version` | absent, or equal to the admitted pair | "A verdict computed under one definition does not authorise an execution under another." The extract must be **re-submitted** under new terms. |
| `datasetId` | informational, from the request as before | Contract 2.0.0 deliberately removed the uploader-controlled label from the identity. |
| `boundaryId` | an authorization **request** | Decided by `requireBoundaryAccess`; both lookups are boundary-scoped. |

The asymmetry between `declaredVersion` (ignored) and the rest (refused) is deliberate and is the
reason stated above, not an oversight.

## 5 · Three new refusal codes, and why three

| Code | Reason | What it says |
|---|---|---|
| `NH-AX-1011` | `admission_snapshot_unavailable` | The record does not carry enough of its own interpretation to be reproduced. A schema-epoch fact, or a defect — nobody's fault, fixed by re-submitting. Deliberately **not** backfilled: a snapshot written now from today's request would assert what the verdict was reached under, which is the one thing it cannot evidence. |
| `NH-AX-1012` | `submission_identity_mismatch` | It does carry enough, and what it carries does not re-derive its own stored key. A tamper or drift signal. Do not re-run. |
| `NH-AX-1013` | `request_contradicts_admission` | The record is sound and the **request** asks to run under something else. |

None of them is `NH-AX-1005` (`decision_binding_mismatch`). That code says *"the record changed after it
was written"*, and saying it when the build changed, or when the caller asked for something new, would
accuse immutable data of mutating.

## 6 · `calculationMethodVersion` — audited, and deliberately not changed

Asked explicitly: `AnalysisTerms` carries `calculationMethodVersion` and `hashAnalysisTerms` commits it,
so is treating `analysisTermsId`/`Version` as an *address* sound, given that `pds` commits only
`currency`, `asOf` and `stallThresholdDays`? Answered from the repository, with a probe rather than a
reading.

**1 · Can two governed rows share the three values and differ in `calculationMethodVersion`?**
**Not through a request — but yes across builds.** `analysisTermsSchema` is `additionalProperties: false`
and does not list the field (`schemas.ts:448`: *"it is a build constant, not an operator choice, so
letting a request state it would invite a definition blessed for an implementation that never ran it"*),
so a request naming it is a 400 and `makeAnalysisTerms` defaults it to `ASSESSMENT_CALC_VERSION`. The
column is nevertheless persisted per row and the register's primary key is
`(boundaryId, termsId, termsVersion)` — the field is **not** in the key. So registering v1 on one build,
bumping the constant, and registering v2 with identical values yields exactly that pair. Probe: both
tuples construct, the three values are identical, the **terms hashes differ**.

**2 · Can those differing values change results or runtime semantics?** **No — the stored value has zero
runtime reach.** `makePolicy` takes no such input and hardcodes the build constant (`policy.ts:76`); the
probe passed `assess-2027.9-fat` and got `assess-2026.1-thin` back. The only non-test readers of
`stored.terms.calculationMethodVersion` are the hash canonicalization and the read-back projection
(`pilotAnalysisTermsService.ts:231`). Nothing in `assess.ts` or the cohort/observed path sees it.

**3 · Does `pds` intentionally collapse the two rows, or is this an omitted semantic component?**
It collapses them — probe: identical `pds_2b34d697…` for both. But this is **preservation of an
undecided question, not a decision**. Because `pds` commits the governed *values* rather than the
address, two rows with identical values are one submission identity by design; that design simply never
ruled on this field.

**4 · What is actually guaranteed?** That it is **out, and recorded as open** —
`ASSESSMENT_IDENTITY_V1.md` §"Still open" (*"not decided here and needs its own answer"*) and again at
its step 10 (*"remains explicitly OPEN … this slice preserved its current state rather than deciding
it"*), `validateDataset.ts:591`, and `CLAUDE.md`. No document claims it is settled.

**5 · What does the authoritative re-derivation need?** **The address alone.** `deriveIdempotencyKey`
needs `currency`, `asOf` and `stallThresholdDays`; resolving `(boundaryId, termsId, termsVersion)`
returns all three from the append-only register. Neither the resolved `calculationMethodVersion` nor the
terms hash is needed as an identity component — and the hash is nonetheless **already enforced**, because
`resolveGovernedAnalysisTerms` verifies `analysisTermsHashMatches` before returning and refuses
`NH-AX-1010` otherwise. Probe: an altered `calculationMethodVersion` fails that witness. So S4b does
protect the field from tampering — through the witness, not through `pds`.

**Conclusion: the exclusion is not an identity defect, and S4 changes no identity.** A field that cannot
be operator-chosen and has no runtime reach does not let the beneficiary influence the number, which is
the standing architecture test.

### An adjacent defect, reported and NOT fixed here

Nothing checks that the build running an execution still matches the calculation method its governed
terms were **blessed for**. Confirmed by absence: the only readers of `ASSESSMENT_CALC_VERSION` are its
own declaration, `makePolicy`, and `makeAnalysisTerms`' default — there is no comparison anywhere.

So after a method bump: old rows keep their recorded value (the hash witness still matches, correctly,
since it is rebuilt from the row), `makePolicy` stamps the **new** constant into the execution binding,
and the run proceeds. The governed definition says *blessed for X*; the binding records *ran under Y*;
nothing refuses it. That is a genuine gap in stage C, orthogonal to the submission identity, and it is
left untouched: fixing it inside S4 would mean deciding the open identity question by implication.

## 7 · Falsifiers

Each was applied to `pilotAssessmentService.ts`, run, and reverted byte-identically (`sha256sum -c`
plus an empty `diff`).

| # | Falsifier | Must fail | Did fail |
|---|---|---|---|
| F1 | `declaredVersion` taken from the request again | A2 | A2, with **`NH-AX-1009` "no accepted cycle survived projection"** — the defect, reproduced |
| F2 | the step-5 comparison removed | C2, C3 | C2, C3 |
| F3 | re-derive under this build's major instead of the admitted one | dual-major 5 | dual-major 5 (`NH-AX-1012` instead of `NH-AX-1006`) |
| F4 | a cited reference tolerates an absent snapshot | D1 | D1 |
| F5 | the request may override the admitted interpretation | B2, B3 | B2, B3 |
| F6 | the cited reference resolved through the discovery lookup | most of A–D | 14 of 17 |
| F7 | probe · refuse every **uncited** schedule, then run the browser journey | nothing | journey 86/86 — the UI does cite |
| F7b | inverse probe · refuse every **cited** schedule | the journey | journey 76/83, 7 failures |
| F8 | re-derive under this build's major (repeat of F3, against the new previous-major trace) | A5 | A5 |
| F9 | `declaredVersion` from the request again | A2, **A2b** | A2 **and A2b** |
| F10 | support authorization removed entirely | A5 | A5 (the ceiling stops binding) |
| F11 | `declaredVersion` put back on the SCHEDULE schema | the two surface tests, A2, A2b | all four |
| F12 | `removeAdditional: true` — silent stripping instead of a 400 | the policy pin, A2, A2b | all three |
| F13 | the field put back on the scheduling TYPE | the source-level surface test | it did |
| F14 | the field removed from the INTAKE schema too (over-broad deletion) | the positive control | it did |

## 8 · `request.declaredVersion` inertness, reported per population (the S4 state)

> Superseded in mechanism by §11, which removed the field outright. Kept because it is the evidence the
> removal rested on: inertness was proven for both populations BEFORE the field was taken away, so S5 is
> a tightening of something already true rather than a change of behaviour smuggled in with a deletion.


The claim is global, and it is proven **separately** against both populations rather than asserted from
one. Structurally: `request.declaredVersion` is read nowhere in the scheduler — the only occurrences are
its type declaration, comments, and `decision.declaredVersion` (the stored one). `admittedUnder` comes
from `decision.declaredVersion ?? decision.contractVersion` in both paths, which is why the stored
`contractVersion` is sufficient and no legacy compatibility exception is needed.

| Population | Path | Probes | Result |
|---|---|---|---|
| snapshot-bearing admission | reference-first | `2.0.0`, `1.0.0`, `9.9.9`, `not-a-version` | all **scheduled**, one `executionId`, one `contractVersion` — test A2 |
| snapshot-bearing admission | legacy discovery | `9.9.9`, `not-a-version` | all **scheduled**, same `executionId` — test A2 |
| historical NULL-snapshot admission | legacy discovery | all four | all **scheduled**, one `executionId` — test A2b |
| historical NULL-snapshot admission | reference-first | all four | all **refused** `NH-AX-1011`, byte-identical `refusalDetail` — test A2b |

The last row matters as much as the others: "no observable difference" has to hold for *refusals* too, or
the field would still be a probe into which gate fired. F9 proves none of this is vacuous — reinstating
`request.declaredVersion` fails **both** A2 and A2b.

## 9 · The two populations, and the limit stated as evidence

| | New snapshot path | Legacy NULL-snapshot path |
|---|---|---|
| anchor | reference-first, boundary-scoped | key derived over caller interpretation |
| interpretation inputs | authoritative, stored | caller-supplied |
| `pds` re-derivation | **mandatory and exact** | **not claimed** |
| comparison | unconditional; fail closed `NH-AX-1012` | the key *is* the address, so nothing independent to compare |
| reconstruction | read, never enumerated | never enumerated, never fabricated |
| schedulability | preserved | **preserved** |

The limit is falsifiable, not merely stated. Test **D5**: a substituted stored key is *detected* on a
snapshot-bearing row (`NH-AX-1012`, test C2) and is *undetectable* on a NULL-snapshot row — there the key
is the address, so a wrong key is an address nothing lives at, and the refusal is `NH-AX-1001` *"no
admission decision exists for these bytes"*, **never** `NH-AX-1012`. The system does not report having
checked something it could not check. Citing the reference on such a row does not launder the gap either:
the snapshot gate fires first with `NH-AX-1011`.

## 10 · What this is not

It is **not** proof, not a Recovery Case, not an authority-ledger entry and not a counted dollar. Lane 1
pilot assessment remains `constitutesProof: false`. This slice makes an *observation* governed by a
record the beneficiary cannot author; it turns no observed amount into Revenue Returned.

`calculationMethodVersion` stays explicitly **open** and out of the submission identity
(`docs/ASSESSMENT_IDENTITY_V1.md`). It is not a `pds` component and this slice does not touch it.

## 11 · S5 · physical removal

**Done 2026-10-04.** S4 made the field inert; S5 removed it, so the claim stops depending on a reader
believing a comment. Removed from: the scheduling request type, the HTTP body
(`schedulePilotAssessmentSchema`), the assessment client, the rehearsal agent's shared request, and every
test fixture that constructed a schedule request with it. **Not** removed from the intake, where it is the
customer's own declaration about their export and is persisted as made.

### The policy for an injected field was already decided — it is pinned, not invented

`app.ts` sets `ajv: { customOptions: { removeAdditional: false } }` with the stated reason: *"so
`additionalProperties: false` REJECTS (400) an injected field … instead of silently stripping it."* So an
injected `declaredVersion` is a **400**, not a strip. Silent stripping would also be safe for the
*result*, but it would tell a caller their field was accepted — so the existing policy is the right one
and is what the tests hold. The refusal is a transport error and deliberately carries **no** `NH-AX`
code: a malformed request is not a governed scheduling decision.

### What the proof looks like after removal

The question is no longer "does varying it change the outcome" but "can it be stated at all".

| Population | Path | Without it | With it injected |
|---|---|---|---|
| snapshot-bearing | reference-first | **scheduled** | **400** ×4 values, no execution created |
| NULL-snapshot | legacy discovery | **scheduled** | **400** ×4 values, no execution created |
| NULL-snapshot | reference-first | refused `NH-AX-1011` (legacy, as before) | **400** ×4 values |

Both A2 and A2b assert the execution list is **unchanged** after the four rejected attempts — that is what
distinguishes *rejected* from *stripped and run*.

### Structural regression test

`server/http/scheduleRequestSurface.test.ts` pins the surface, because a behavioural test only covers the
field someone thought to inject. It asserts the body's property set as an **allowlist**, so any new field
fails until someone states what it is; that is what makes *"no caller-controlled version input re-enters
under another name"* checkable rather than hoped for. Two of its six assertions read **source text**,
since TypeScript types are erased and `tsconfig.server.json` excludes `server/**/*.test.ts` — the same
technique that already pins the Stage-A revision's inertness. Each negative has a positive control: the
intake schema must still require the field, and the intake client must still send it.

### Two files deliberately NOT edited

`scripts/synthetic-validation/run.mjs` and `scripts/synthetic-validation-2026-09-27/run.mjs` build their
schedule body by stripping only the two admission-policy fields, so `declaredVersion` is in it. Their
`run.mjs` **sha256 is a covered evidence component** (`77d30988…` for the 2026-09-27 run), so editing
either would break `verify:evidence` — a frozen-evidence mutation. Nothing in CI or the suites executes
them. They are records of a run under a prior request shape, and the 2026-09-27 runner's own header
already set the precedent: *"this file is the only one that had to change: the request shape did"* — a
shape change produces a **new** runner, never an edit to an old one. Consequence, stated rather than
discovered later: re-running either against a current build would get a 400 on its schedule POST.

## 12 · Still open

* **S5 · physical removal of `request.declaredVersion`** from the service type, the HTTP schema and both
  clients. Breaking on the wire, so it is its own slice with its own migration.
* **The pre-snapshot population.** Rows with a NULL snapshot remain reachable only by legacy discovery.
  They become fully authoritative only by being re-submitted; nothing backfills them.
* **`calculationMethodVersion` in the submission identity** — still open, deliberately (§6). Unchanged.
* **Build-vs-blessed calculation method — classified, kept open, next.** The adjacent defect in §6:
  nothing refuses an execution whose build no longer matches the `calculationMethodVersion` its governed
  terms were blessed for. Classified as an **execution compatibility / semantic binding** defect in
  stage C. It is explicitly **not** a submission-identity blocker and explicitly **not** a reason to
  change `pds`; it is also explicitly **not closed**. Its own focused slice follows S5.
