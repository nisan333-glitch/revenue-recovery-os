# Evidence preservation · V1 · 2026-10-16

**Two tracks, one slice.** `verify:evidence` enters the CI gate (**Track A**) and the fifteen historical
reconciliation baselines are preserved under a new, accurately dated attestation (**Track B**).

Branch `claude/pilot-journey-v1`, from verified SHA `2171c40131fe7ec476a9680046a16b92fe310e57`.
Validation and preservation only: **no money, no Recovery Case, no API, no UI, no customer data, and no
observed amount became Revenue Returned.**

---

## 1 · The question, and why it had two answers

The CI-coverage slice closed the gate on four verifiers and reported a fifth, `verify:evidence`, as still
outside it — raising a governed question it deliberately did not answer: *is a recorded historical
**measurement** evidence to preserve, or output to regenerate?*

The owner answered it — **historical baseline measurements are preserved evidence, not disposable
generated outputs** — and approved both tracks. The investigation that preceded the answer found two
families that are genuinely different rather than two instances of one thing, which is why one answer
would have been wrong:

| | family A · `synthetic-validation*` | family B · reconciliation `baseline.*` |
|---|---|---|
| count | 20 covered artefacts (10 per cycle) | 15 files |
| covered by `verify:evidence` | **yes** | **no — not one of them** |
| tracked record before | 2 records in `e2e/evidence/` | 1 hash, in a doc |
| bytes tracked before | **10 of 20** — the scripts only | **0** |
| what it is | datasets, ground truth, prediction, scripts | hand-taken snapshots of a scorer's output |

**A factual error is corrected rather than quietly dropped.** The CI-coverage record states that
`verify:evidence` *"covers ten artefacts including the `baseline.*` recordings."* It does not. The two
families are disjoint, and that is exactly why this is two tracks. The erratum sits in
[`CI_VERIFIER_COVERAGE_V1.md`](CI_VERIFIER_COVERAGE_V1.md) §6 with the original prose preserved.

## 2 · The gate, discharged before anything was committed

The owner's stop condition was *"if original bytes or recorded hashes disagree, stop and report before
committing."* Checked first, on both families:

* **Family A · 20/20 agree.** `npm run verify:evidence` reports 10 covered artefacts verified on each
  cycle, with both evidence identities (`nhev_be6cadfb…`, `nhev_c88b0371…`) matching the tracked records.
* **Family B · 15/15 agree.** Every hash now in the ledger equals the hash measured independently
  *before any of this work began*, so the agreement is not the tool agreeing with itself. The one
  externally recorded hash, `5a951e406350d2a6b3c6d0d3cb3dde0fd154da230cd12e374826f0fdd5a82fef`, matches
  `BENCHMARK_REVISION_V2.md` §5 at full length, beside core `c80b35c5…` whose commit `fa28a80` re-hashes
  to that core (asserted by a test, not by eye).

**Nothing disagreed. Nothing was regenerated, overwritten, backdated or substituted.**

## 3 · The blocker, proven rather than argued

`verify:evidence` could not be wired because `.gitignore` excluded all of `e2e/fixtures/`, so the ten
fixture artefacts per cycle were present in a working tree and absent from Git. Demonstrated with
`git archive HEAD` into a temp directory before the fix:

```
✗ absent: e2e/fixtures/synthetic-validation/dataset.csv is absent — it cannot be verified from this checkout
… 10 in total
10 evidence verification failure(s). Nothing was regenerated and nothing was written.
```

The ten tracked **scripts** verified fine throughout, which is what isolates the cause. After the fix the
same `git archive` extraction exits **0** on both `verify:evidence` and `verify:baselines`.

> **A file present on disk and absent from the index is not preserved.** This is the same loss already on
> record: the V1 scorer's bytes *"had never been committed"*, so the artefact had to be **reconstructed**
> from recorded patches, and *that it needed reconstructing is the compounding half of that disclosure.*

## 4 · Inputs and outputs, decided on a checkable property

The previous slice's rule was *inputs are evidence; outputs are not*, with `results.json` ignored because
every run rewrites it. Both new families pass that test on something checkable, not on judgement:

* **No command writes a `baseline.*` file.** `score.mjs` writes `scoreboard.json` and `report.txt`;
  `run.ts` writes `results.json`. A baseline is a copy taken **by hand**. That is what makes it a
  preserved measurement rather than a regenerated output, and why tracking one cannot dirty the tree on a
  routine run — the test `results.json` fails. Pinned by a test that scans every tracked script for a
  **write construct** whose target names a baseline, not for the word.
* **No npm script and no CI step invokes `scripts/synthetic-validation*/generate.mjs` or `run.mjs`**, so
  the cycle fixtures cannot be rewritten by a routine run either.

Still ignored, in both families: `results.json`, `scoreboard*.json`, `report*.txt`, `raw-output.json`,
`score.json`, the superseded `*-v1`/`*-v2` generations, and the `FROZEN*` manifests.

**`FROZEN.json` is excluded deliberately.** It is not hash-covered by the evidence record — its
substantive content, `runParameters`, is covered **as a value** — so tracking it would put unverifiable
bytes in the evidence set. A consequence worth stating: `attest:evidence` cannot run from a clean
checkout, which is correct, because re-attesting is the act this scheme exists to make deliberate.

**One observation, recorded and bounded.** The on-disk `scoreboard.json` is byte-identical to
`baseline.v3.postcapability.json` and `report.txt` to `baseline.v3.postfix.txt`. That establishes what a
baseline **is** — a copy of a scorer output — and establishes **nothing** about when it was taken or
against which core. It is an observation over untracked run output, so it stays prose and **must never
become a check**.

## 5 · Privacy, checked rather than asserted

* **The ten cycle fixtures:** zero emails, zero phone numbers, zero person names, zero free text. Every
  identifier is `synthetic-`-prefixed and **semantic** — `synthetic-u-never-activated`,
  `synthetic-e-paid-exceeds` — naming the planted defect, which is the opposite of disguised real data.
* **The fifteen baselines:** aggregate scoreboards with **no identifiers of any kind**, only mechanism
  labels (`M02-missing-invoice`) and money over synthetic data.

**Twelfth instance of the recurring lesson, in my own scan.** The identifier probe looked for `syn-`/
`SYN-`, the prefix the *reconciliation* packages use, and reported **zero identifiers** on files where
every row carries one — because `synthetic-` does not match `\bsyn-`. One "phone number" was the datetime
`2026-03-01 09`. *A guard must read the construct it is actually asking about*, and the `.gitignore`
comment therefore states **this** family's prefix rather than copying the other family's.

## 6 · Track A · what is attested, and what is not

> **Continuity since 2026-09-30 — NOT original historical provenance.**

Neither cycle ever had a Git freeze. `verify.mjs` was a freeze-**creation** step whose `FROZEN <digest>`
output read as verification, and running it **overwrote the originally recorded `gitHead` and `frozenAt`**.
The recorded head was read with `git rev-parse HEAD`, which ignores a dirty tree, and both trees were
provably dirty — cycle 1's ground truth needs a generator newer than its recorded commit, cycle 2's
scripts did not exist at its recorded commit. So both records carry `systemUnderTestRevision: "unknown"`
and `historicalReproducibility: "downgraded"`, and **this slice does not establish the tested revision.**

Tracking the bytes changes what is verifiable **going forward**. It does not make them older.

### 6a · The limitation was being truncated away

The metadata print capped every value at 96 characters, so a CI log read, verbatim:

```
metadata · attestedNote: ... NOT an original Git freeze: e2e/fixtures/
```

losing the half that states **why**. **A gate that truncates the limitation is not preserving it.** Values
now print in full, and the distinction that licenses it is load-bearing: these are *our own constants in a
record we wrote*, not a validator `detail` quoting cells from a customer's file — which is what the
codes-only rule in `dataReadiness.ts` is about. Asserted by a test, not assumed: neither record contains
an email address or any `synthetic-` identifier, because both hold hashes and parameters only.

### 6b · The claim is derived, and printed on every run

`continuityLine` turns a record into one line:

```
attests  : continuity since 2026-09-30 · NOT original historical provenance · tested revision unknown
```

**Never a hardcoded date.** A literal that outlives the record justifying it is the shape of
`wouldBeLiftedBy` naming unbuilt channels, of `coverage.event` claiming a capability from one side of a
join, and of the stale `settled_at` caveat. A test feeds it a different record and requires a different
line, and a record with no `attestedAt` says *"an unstated date"* rather than inventing one.

It lives in `src/evidence/evidenceIdentity.ts`, not in the command, for the reason the local readiness CLI
already established: **a command whose claims cannot be imported cannot be falsified.** The verifier reads
argv and calls `process.exit` at the top level, so importing it to test one string would run it.

### 6c · Stale claims: corrected where prose, preserved where evidence

Tracking the artefacts made *"`.gitignore` excludes all of `e2e/fixtures/`"* false in three code headers.
Each now states the true historical fact — the artefacts were untracked **when the cycles ran**, so nothing
establishes the bytes between the run and the attestation — plus what changed and what did not.

**The two 2026-09-30 records carry the old wording and are not touched.** They were accurate when written,
they are attested evidence, and *rewriting an attestation is precisely what this scheme forbids.* The
correction lives in `attest-evidence.ts`'s note for future records, in the derived continuity line, and in
**append-only errata** on the two cycle reports whose prose is preserved byte-identical.

## 7 · Track B · the baseline ledger

`attest-evidence.ts` cannot preserve these and must not be bent into doing so: it is cycle-shaped, reads
`FROZEN.json`, and its covered components are datasets/groundTruth/prediction/scripts/runParameters. A
baseline is a different kind of object, so widening that scheme would change what
`nh-validation-evidence-v1` means and re-identify records that are already attested.

> **An additive, separately governed sibling artefact — never a widening of one whose canonical form is
> already hashed.** The pattern Detector #2, the Expectation Extract and the obligation-ref variant all
> set. A test asserts the cycle scheme and its covered components are byte-for-byte what they were.

`nh-benchmark-baseline-ledger-v1`, digest `nhbl_f3f2510a5897f4cd805c9434d8775bdcccbd29b95c11a89e6d890de5db1df4f1`,
pure, reusing `canonicalValue`/`framed`/`sha256Hex` rather than reimplementing them.

### 7a · The three refusals are required literals

| covered field | required value | why it cannot be established |
|---|---|---|
| `producingRevision` | `NOT_ESTABLISHED` | no baseline file carries a core revision, a scorer revision or a timestamp — their only top-level keys are `totalPlantedMinor`, `knownCases`, `unknownCases`, `mustRefuseCases`, `candidates` — and none was ever tracked |
| `historicalReproducibility` | `NOT_CLAIMED` | the core has moved four times (`c80b35c5` → `831b2dab` → `ec1efe95` → `fdc6c785` → `60e71f6f`) and every movement changed figures a baseline records, so a re-run answers with **this** core's numbers; reproducing one means checking out the historical core, which was not done. **Nothing refuses the attempt** — see §11.4 |
| `independentValidation` | `NONE` | one party produced, retained and attested all of it |

**Enforced, not described** — the `submitterStillControls` pattern, *because prose about a limitation can
be rewritten into optimism and a required literal cannot.* All three are **covered**, so softening one
changes the ledger identity *and* throws before it can be compared. Six flattering values are tried in a
test and all six are refused.

### 7b · The sharpest field

`producingRevision` — the revision that **produced** the measurement — is covered and `NOT_ESTABLISHED`.
`attestingRevision` — the revision at which we **hashed** the bytes, here the clean commit `001fe926`
carrying the tools that wrote the ledger — is **excluded metadata**. The two can never be collapsed. That
is `evidenceIdentity.ts`'s point-2/point-3 split applied to this family: **a record of when we looked is
not a record of what was tested.**

### 7c · Separate arrays, not one list with a flag

The owner asked for the authenticated baseline preserved *separately*. `authenticatedBaselines` holds the
one; `unauthenticatedBaselines` holds the fourteen. *The unavailable states stay distinguishable* is better
served by **a shape that cannot express the merged set** than by a label that can be misread — the same
reason `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart. A path in
both sets, in neither, or outside the declared fifteen is an error.

The authenticated entry retains its **original hash** and its **core relationship**:
`recordedHashSource: docs/BENCHMARK_REVISION_V2.md`, `recordedCoreSha256: c80b35c5…`,
`recordedCoreCommit: fa28a80`. What that establishes is **which measurement these bytes are** — not who
produced them or when, and the citation is a repository artefact the same party controls. **An
authenticated entry is better evidence than an unauthenticated one and is still not provenance.**

### 7d · Declared, never globbed · and the witness is read, not trusted

The fifteen paths are a declared constant. A glob would absorb a future `baseline.v4.*` into a ledger whose
prose was written about fifteen files — *a serialised artefact's schema is declared, never inferred from a
sample of its own rows*, already paid for once when `csv(rows)` silently dropped a late column. An
undeclared `baseline.*` on disk is a refusal in **both** tools.

Both tools re-read `BENCHMARK_REVISION_V2.md` and require the full 64-hex token. Copying the hash into the
ledger and comparing the ledger against itself is **the agreement that can only agree** — the
register-tamper-evidence defect, and reference-first scheduling before it. `citesHash` is **one**
implementation shared by both, *because a second implementation of a rule is a second thing that can drift
from it*; it refuses a prefix, a near-miss and a longer hex run that merely contains the hash.

### 7e · The ledger contains no money

Not scanned lexically but **walked**: the only numbers in the ledger are the fifteen byte counts. The same
rule the readiness report is held to — *a record about evidence must not quietly become a report of the
evidence's numbers.*

## 8 · CI

A fifth and sixth step on the existing read-only `frozen-verifiers` job, which declares no services
because none of the six touches a database, the network, HTTP, a clock or an RNG:

| step | what a pass means |
|---|---|
| `verify:evidence` | 20 covered artefacts unchanged · **continuity since 2026-09-30, not original provenance** |
| `verify:baselines` | 15 baselines unchanged since **2026-10-16** · no provenance, no reproducibility, no independent validation |

**The step names carry the limitation**, so it is in the job list and not only in a log. `verify:baselines`
verifies the thing the commit before it preserved, because *a tracked record nothing checks is a receipt
for a lost artefact* — the rule the whole slice rests on, so the gate and the preservation are one act.

The wiring assertion now builds its fail-closed pattern from **one list of six**, so a seventh verifier
cannot be added to one half and forgotten in the other.

## 9 · Falsification · thirteen induced defects, all fail closed

| # | induced defect | result |
|---|---|---|
| 1 | flip a byte in a tracked fixture CSV | `mismatch`, exit 1 |
| 2 | delete a tracked fixture | `absent`, exit 1 |
| 3 | edit `runParameters` in a tracked record | `identity`, exit 1 |
| 4 | **`git archive HEAD` → run both verifiers** | **exit 0 · the claim of the slice** |
| 5 | flip a byte in a baseline | `mismatch` ×2 (hash and size), exit 1 |
| 6 | delete a baseline | `absent`, exit 1 |
| 7 | remove the recorded hash from the citing document | `citation`, exit 1 |
| 8 | an undeclared `baseline.*` appears on disk | `undeclared`, exit 1 |
| 9 | soften `independentValidation` to `THIRD_PARTY` | `claim`, exit 1 |
| 10 | promote `producingRevision` to a real commit | `claim`, exit 1 |
| 11 | authenticated bytes disagree with the recorded hash | **attester REFUSES**, nothing written |
| 12 | an undeclared baseline, at attestation time | **attester REFUSES**, nothing written |
| 13 | the document stops citing the hash, at attestation time | **attester REFUSES**, nothing written |

The ledger is proven byte-identical after 11–13. And #4 is the one that proves the slice: before the
tracking commit it exited **1** with twenty `absent` failures.

## 10 · Verification

`build` · `build:server` · `tsc --noEmit` on all three projects · `check:purity` (21 core files) ·
`typecheck:scripts` · **`test` 1187/1187 with a database and 1186 + 1 skipped without** (`.env` removed
*and* `DATABASE_URL` unset) · **`test:ep2` 599/599** · **`test:journey` 120/120** · **`pilot:verify`
242/242** · **`readiness:control` 25/25** · `recon:verify` · `recon:ref:verify` · `verify:evidence` ·
`verify:baselines` · `verify:registers` on a clean DB (both registers empty, nothing reported as verified)
· `git diff --check` clean.

**Preserved, by hash and by empty diff.** `reconciliationCore.ts` `60e71f6f`, `reconciliationScenarios.ts`
`7dd786ba`, V3 scorer `060359f5`, `grainCandidates.ts` `1fdf7180`. Contract **2.0.0**, expectation extract
**1.1.0**, billing extract **1.0.0**, `exv-2026.1`, `bxv-2026.1`, `rdy-2026.2`, `pav-2026.2`,
`EVIDENCE_IDENTITY_SCHEME = nh-validation-evidence-v1`, `OBLIGATION_IDENTITY_FIELDS = []`. **No version
constant moved.** `git diff --stat` is empty over `server/`, `prisma/`, `e2e/journey.mjs`,
`docs/pilot-intake/`, `src/contract/`, `src/benchmark/`, `scripts/reconciliation-*/` and
`scripts/pilot-intake/`. Both existing evidence records are byte-identical.

`scripts/freeze` joined `typecheck:scripts` — **probed before being added**, all four files clean, so the
two new tools are held to `src/`'s bar and the two existing ones gain coverage at no cost.
`scripts/pilot-intake` stays out with its nine pre-existing errors.

## 11 · Three defects in my own instruments

All the same family, and the third is the sharpest kind.

1. **The privacy scan searched for the wrong prefix** (`syn-` against `synthetic-`) and reported zero
   identifiers on files where every row carries one. Corrected before its output was believed.
2. **The no-money check banned the token `totalPlantedMinor`** — and then failed on the ledger's own
   sentence explaining that `totalPlantedMinor` is one of the only five keys a baseline file carries. *The
   sentence saying a figure is absent is not the figure.* It now walks the parsed object: fifteen numbers,
   fifteen `.bytes`. **Fourteenth instance.**
3. **A guard that could not fire.** Generalising the fail-closed CI pattern from a working hardcoded regex
   to one built from the list, I escaped the colon as `\:` — which inside a `RegExp` source means a
   literal **backslash** followed by a colon, so the pattern matched nothing at all, including `|| true`.
   A colon needs no escaping in a regex, which is why the form it replaced worked.

> **A guard that cannot fire is not a weaker guard, it is no guard — and generalising a working check is
> exactly when it happens.** The test now asserts the pattern **fires** on a swallowed exit before trusting
> it not to fire on the real workflow, and the property was falsified end to end: `|| true` appended to the
> real step turns it red; reverting it turns it green. **Fifteenth instance.**

A fourth, in a guard from the previous slice and in the block being edited: the comment claimed the frozen
inputs *"are tracked"* while `existsSync` checked the filesystem. **A file in a working tree and absent
from the index is exactly the state that kept these verifiers out of CI**, and `existsSync` cannot see it.
It reads `git ls-files` now. **Thirteenth instance.**

## 12 · What this does not establish

* **Track A attests continuity from 2026-09-30 forward and nothing earlier.** The tested product revision
  is unestablished, and nothing here establishes it.
* **Track B attests continuity from 2026-10-16 forward and nothing earlier.** Fourteen baselines have no
  provenance of any kind in their bytes; one has a hash recorded in a document the same party controls.
* **No baseline is reproducible on this build**, and the ledger says `NOT_CLAIMED` rather than *blocked* — nothing refuses a re-run, it would simply answer a different question, which is exactly why the bytes had to be preserved.
* **Nothing about money, authority, proof or recovery.** Every figure in every preserved artefact is
  synthetic. No ledger moved, no Recovery Case was created, and **no observed amount became Revenue
  Returned.**

Carried forward unchanged: `emit-package.ts`'s hardcoded `NH-EX-1002`/`NH-BX-1002`; the dead `asOf`
fixture in `dataReadiness.test.ts:32`; the `ownedBy` catalogue asymmetry; `NH-*-1004` unreachable via the
CLI; `ReadinessReport.level`'s authority cap; the nine `verify-package.ts` type errors; `test:e2e`
deliberately unwired; `pilot:verify`'s newline insensitivity and `readiness:control`'s currency
insensitivity, both caught by `recon:verify` — *the control checks meaning, the freeze checks bytes.*
