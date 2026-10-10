# Local Pair Readiness · V1

**Status:** built · validation only · no production consumer · no customer data
**Date:** 2026-10-10
**Preserves:** contract 2.0.0 · expectation extract 1.1.0 · billing extract 1.0.0 ·
`DATA_READINESS_SCHEME = nh-customer-data-readiness-v2` · `DATA_READINESS_METHOD_VERSION = rdy-2026.2` ·
`ATTESTATION_METHOD_VERSION = pav-2026.2` · `OBLIGATION_IDENTITY_FIELDS = []` · every frozen package

---

## 1 · The question

Readiness V1 could judge two *validations*. It could not read two *files*. The customer package
(`docs/pilot-intake/`) asks a finance owner for two CSV exports, and until this slice nothing in the
repository could take those two files and say whether they are readable — so the first real export would
have been inspected by hand, which is the one method whose result nobody can reproduce.

This slice answers: **can NH read and validate a real, independently sourced pair of CSV exports
locally, before any pilot customer exists?** Yes, at `L2` on the committed examples, `SOURCE_NATIVE` and
PROVISIONAL throughout.

It computes no money, persists nothing, opens no connection, creates no Recovery Case, exposes no API and
no screen, and **turns no observed amount into Revenue Returned.**

## 2 · What was built

| file | what it is |
|---|---|
| `scripts/data-readiness/csvPairTransport.ts` | a strict RFC-4180 reader. No inference, no sniffing, no repair. |
| `scripts/data-readiness/assessPairCore.ts` | the pure core: two CSV strings + one governed term → a `ReadinessReport`. |
| `scripts/data-readiness/assessPairCli.ts` | the thin edge: argv, `readFileSync`, stdout. Nothing else. |
| `npm run -s readiness:pair` | `--expectation <path> --billing <path> --currency <ISO>` |

Run on the two committed synthetic examples: `L2_MONETARY_RECONCILIATION_POSSIBLE`, 7 accepted rows each
side, `authority.reached = SOURCE_NATIVE`, `provisional = true`, `attestation = null`, blocked
capabilities `NH-EX-3006`, `NH-BX-3005`, `NH-EX-2016`, exit 0.

## 3 · The rules this slice establishes

> **A mis-encoded export is REFUSED, never transliterated.** `readFileSync(path, "utf8")` does not throw
> on invalid UTF-8 — Node substitutes `U+FFFD` — so a cp1252 export from a European ERP would arrive with
> its identifiers quietly rewritten. An identifier is a **join key**, so a silently altered one is NH
> authoring the identity it is supposed to be reading. `CSV_NOT_UTF8`, and the test proves Node did not
> throw before asserting that NH does.

> **A command whose claims cannot be imported cannot be falsified.** As supplied, the whole path was
> top-level statements: argv, the filesystem and stdout executed on import. Its interesting claims — that
> it prints no row, no identifier, no amount and no path — were therefore unreachable by any test. Logic
> moved behind an exported function and the entry point kept the I/O, which is what makes the redaction
> property checkable rather than promised.

> **Fail closed, and say whose fault it is.** A transport or argument refusal is about the INPUT and
> carries its own code; anything else is an NH defect and prints `NH_INTERNAL_ERROR`. Reporting our own
> bug as unreadable input is the `NH-AX-1009` mistake — blaming the data for a claim we made.

> **A test CI never runs is not a guard, and neither is a type nobody checks.** Nothing under `scripts/`
> was covered by any tsconfig: the root project includes only `src`, the server project only `server`, and
> vite-node and vitest transpile with esbuild, which does not check types. These test files were collected
> by neither suite. Both gaps are closed for this directory, and **the closing is itself asserted** —
> project include, npm script, CI step and vitest include — because configuration can be silently outgrown
> by a new file.

## 4 · What the new coverage found immediately

**`scripts/data-readiness/control.ts` passed a governed term that does not exist.** It called
`validateExpectationExtract(..., { currency: "USD", asOf: "2026-06-30" })`, and
`ExpectationExtractTerms` declares only `currency`, `dateLocale` and `amountFormat`. The property was
inert — nothing reads it, and the control still passes 25/25 without it — but it read as a governed
**cut-off** being handed to a validator whose stated property is that it *consults no clock*. An excess
property that looks like a governed term is worse than a missing one, because a reviewer believes it.
Removed, and pinned.

## 5 · The eleventh instance

The expectation-extract importer guard failed on the new test file. Its comment said *"COMMENTS AND
STRING LITERALS STRIPPED"*; the code stripped only comments and then matched the bare token in whatever
remained. `assessPairCore.test.ts` names the validator inside a `resolve(...)` path — it reads the
validator's **source** to check which reading terms it declares, and imports nothing from it — so a
citation read as a dependency.

> **A structural guard must read code, and specifically the construct it is actually asking about.**
> A term is not a claim, a prose mention is not an import, and **a string literal is not a dependency.**

Corrected to the import-specifier form the historical-record guard had already settled on, and the
importer list is **unchanged at nine** under the stricter reading, which evidences that every listed
entry is a real importer. The falsifier pins **both directions** on a committed pair: the core imports
and is listed, its test only mentions and is not. The negative half is the one that was broken.

## 6 · Reported, not patched

**a · `wouldBeLiftedBy` names only channels that do not exist.** At `SOURCE_NATIVE` — the rung a real
local run reaches — the field lists the four unimplemented channels and omits `DATA_OWNER_ATTESTATION`,
the one that *is* implemented and the only next step available to an operator reading the report today.
The cause is `lifted = PROVENANCE_CHANNELS.filter((c) => !c.implemented)`, right when nothing was
implemented and wrong the moment something was. It is the `coverage.event` shape again: a field answering
from a subset of the facts the answer needs. Not patched because `wouldBeLiftedBy` is a reported field of
the readiness contract and the authority ladder is explicitly preserved in this slice.

**b · the report drops extract-level fault codes.** A readable CSV with the wrong columns comes back
`usable: false` and `L0_NOT_READABLE` carrying **no code saying why**, although the validator computed
them — `extractFaults` is not surfaced. For a tool whose point is to name the missing fact and its owner,
that is a real hole; closing it is a `ReadinessReport` shape change with a method-version question.

**c · nine type errors remain in `scripts/pilot-intake/verify-package.ts`** (unused bindings, unchecked
regex-group indexing). Widening the typecheck project to all of `scripts/` would mean editing the package
verifier from inside a slice that does not own it.

**d · `--currency` is the only reading term, and that is a design rather than a blocker.** An earlier form
of this record called a European export a blocker. It is not: `PILOT_DATA_REQUEST_V1` asks for timestamps
as `YYYY-MM-DD` and amounts "raw, as recorded", and `PRE_SUBMISSION_CHECKLIST` names *dates reformatted to
local order* and *amounts given thousands separators* as spreadsheet damage to check for. A non-ISO file
is non-conforming and is refused with a named code the customer was told about in advance. Two further
facts hold the omission in place: `ExpectationExtractTerms` carries optional `dateLocale`/`amountFormat`
while `BillingExtractTerms` carries **neither**, so such a flag would read one half of a pair and be
refused on the other — and it would locally accept a file the package tells the customer to re-export.

## 7 · What this does NOT establish

It does not establish provenance, completeness, or that any identifier is the source system's own value.
Authority is `SOURCE_NATIVE` with no attestation and `SOURCE_ATTESTED` at best with one; **nothing
reaches `AUTHORITY_VERIFIED`**, every level stays PROVISIONAL, and that is unchanged by this slice. It
finds no leakage and reports no money — asserted on the emitted JSON string, not on the object, because
serialisation is the form an operator actually pastes into a ticket.
