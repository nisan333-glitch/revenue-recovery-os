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
| `declaredVersion` | **inert** — read by nothing | Not a choice anyone makes about the run: both clients send the build constant. Physical removal is a breaking wire change, deferred. |
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

## 6 · Falsifiers

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

## 7 · What this is not

It is **not** proof, not a Recovery Case, not an authority-ledger entry and not a counted dollar. Lane 1
pilot assessment remains `constitutesProof: false`. This slice makes an *observation* governed by a
record the beneficiary cannot author; it turns no observed amount into Revenue Returned.

`calculationMethodVersion` stays explicitly **open** and out of the submission identity
(`docs/ASSESSMENT_IDENTITY_V1.md`). It is not a `pds` component and this slice does not touch it.

## 8 · Still open

* **S5 · physical removal of `request.declaredVersion`** from the service type, the HTTP schema and both
  clients. Breaking on the wire, so it is its own slice with its own migration.
* **The pre-snapshot population.** Rows with a NULL snapshot remain reachable only by legacy discovery.
  They become fully authoritative only by being re-submitted; nothing backfills them.
