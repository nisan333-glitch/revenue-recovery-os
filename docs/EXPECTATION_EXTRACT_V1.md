# The Expectation Extract · contract and pure validator (v1)

**Status:** declared and validated. **Nothing consumes it in production.** No intake, no detector, no
persistence, no UI, no migration, no contract 2.0.0 bump.

## 1 · Why a second artefact, and why not a 2.0.0 field

The reconciliation core can compare expected money against billed money and refuse where the evidence
cannot carry an answer. It had no **source**: its `ExpectationRow` was a benchmark type.

Contract 2.0.0 cannot supply one, and the reason is structural rather than a matter of naming.
`next_invoice_due_at` and `next_invoice_amount` are **required**, so a subscription that was billed
nothing either has **no row** (invisible) or **a row with blanks** (rejected `missing_required_field` —
and rejected rows are quarantined, never counted). A missing invoice is therefore unrepresentable in
the contract's *shape*, which is why no field added there could close it.

So this is an **additive, separately governed sibling** — its own id, version, scheme and method
version — exactly as `exposureFinding.ts` is a sibling of `AssessmentFinding`. The single-dataset path
is untouched and no 2.0.0 consumer changes.

```
EXPECTATION_EXTRACT_ID                = "nh.expectation-extract"
EXPECTATION_EXTRACT_VERSION           = "1.0.0"      // its own line, NOT 2.0.0
EXPECTATION_EXTRACT_SCHEME            = "nh-expectation-extract-v1"
EXPECTATION_VALIDATION_METHOD_VERSION = "exv-2026.1" // independent of ASSESSMENT_CALC_VERSION
```

**The expectation must originate elsewhere.** Asking the billing system what billing should have done
cannot detect billing's own omission: the failure that erased the invoice may have erased the schedule
with it.

## 2 · The row grain

> **One row is ONE EXPECTED BILLING OBLIGATION: one entitlement, one governed period, one expected
> amount. The source enumerates the rows. NH never creates, expands, prorates or infers one.**

That is what makes absence a **positive result** rather than a lookup that found nothing: a detector
iterates the expectation side, so a row with no matching observation is a finding about an obligation
someone asserted.

**Grain is a source assertion and no field can promote it.** There is no row-grain flag, because a flag
would hand grain authority to the party who benefits from the number. An aggregate row stays
structurally invisible — a stated limitation, not a solved problem.

## 3 · Five required facts; everything else is a named capability

Only `entitlement_ref`, `period_start`, `period_end`, the `expected_amount` **column** and `currency`
are REQUIRED — the facts without which no reconciliation unit exists at all. **There are three tiers
and no `recommended`:** in 2.0.0 that tier feeds `missingRecommendedColumns` against a governed
threshold of zero, so a "recommended" addition would refuse extracts that previously passed. The tier
is absent rather than merely unused, so the trap cannot be re-entered.

| Capability | Basis | Fields | Closed ⇒ |
|---|---|---|---|
`PAYER_RELATION_AVAILABLE` | populated on every row | `payer_ref` | `NH-EX-3001` · sibling attribution lost; positives stay **unpaired**, the conservative direction |
`LIFECYCLE_TERMINATION_AVAILABLE` | column declared | `terminated_at` | `NH-EX-3002` · false-positive control ($100.00 in the benchmark) |
`LIFECYCLE_PAUSE_AVAILABLE` | column declared | `pause_start`, `pause_end` | `NH-EX-3003` · same, $100.00 |
`AMENDMENT_LINEAGE_AVAILABLE` | column declared | `supersedes_ref`, `amended_at` | `NH-EX-3004` · same, $100.00 |
`EXPECTATION_EVENT_IDENTITY_AVAILABLE` | populated on every row | `schedule_line_ref` | `NH-EX-3005` · event + correlation closed; **monetary untouched** |

**Capability gating per detector, never global dataset rejection.** A closed capability is an UNKNOWN
and rejects nothing, because refusing a file over a fact some other detector never needed would
discard money NH can still measure.

**The two bases are a real distinction.** Declaring `terminated_at` is the source saying *"I report
terminations"*, so an empty cell means *not terminated* — a fact. For an identity or a relation a blank
carries no information, so the value must be present on every row.

## 4 · `expected_amount` inverts 2.0.0's mistake

The **column** is required; a **blank cell is a declared UNKNOWN**. Counted, never valued, never
averaged from prior invoices, never taken from a plan price, never prorated by NH. Making the value
required here would reproduce, in the artefact built to fix it, the exact defect that makes a missing
invoice unrepresentable in 2.0.0.

And the two are kept apart: an **unparseable** amount is `NH-EX-2005`, not an UNKNOWN. *"The source
could not state it"* and *"the source stated something unreadable"* are different facts, and collapsing
them would let a malformed cell escape its rejection.

## 5 · Stopped rather than invented

Each was considered and refused on evidence. Recorded in `STOPPED_FIELDS` as a value, so the next
person to want one finds a binding reason rather than a gap.

| Candidate | Why |
|---|---|
`cadence` / `billing_frequency` | A finite history is not an obligation. Worse, a cadence NH could **expand into rows** would make **NH the author of the expectation** — the beneficiary problem one level up |
`status` (`active`/`churned`) | A state label is a free-text lever held by the beneficiary where a **dated** fact is checkable. The observation side stopped on exactly this |
estimation / proration basis | An estimate is a number NH authored. Belongs to Revenue Opportunity, never the OBSERVED surface |
`invoice_ref` / allocation | Observation-side facts; carrying them here defeats the point of a second source |
`obligation_ref` as a cross-system join key | The two sides identify at different grains, and a migration re-keys the whole book, so the entire expected book would read as missing. `schedule_line_ref` is scoped **within** the extract and is not that key. The grain question stays open |
any composite / NH-derived identity | Breaks on re-key and migration — the two events most likely to produce a six-figure false finding |
a row-grain flag | Hands grain authority to the beneficiary |

## 6 · The validator

`validateExpectationExtract(header, rows, terms)` — pure: no I/O, no persistence, **and no clock**.
Every temporal check is relative to supplied governed terms, because a validator that consults the wall
clock gives a different verdict tomorrow for the same bytes, and rule 5 requires a historical judgement
to stay reproducible. Enforced by a structural guard on the source, not by a promise.

Three severities, and the middle one is the design: **extract unusable** (`1xxx`) · **row quarantined**
(`2xxx`, enters no detector, no union, no recall denominator) · **capability unavailable** (`3xxx`, an
UNKNOWN that rejects nothing). Separate `NH-EX-####` catalogue, because folding these into `NH-DC` would
make a customer read a missing capability as a parse error they could fix by re-exporting.

Checks: **temporal** (parse, locale-governed ambiguity, period order) · **currency** (supported, and
equal to the governed currency — excluded by name under `NH-EX-2008`, never converted) ·
**lifecycle consistency** (bounded pauses, one termination per entitlement, amendment dated) ·
**identity/cardinality** (all rows sharing a `schedule_line_ref` quarantined with **no survivor chosen
by file position**, supersession resolvable and acyclic, two unsuperseded lines for one unit refused) ·
**capability declaration** (five gates, each fail-closed).

`expectationValidationWitness` digests scheme, version, **the governed terms**, the header, every raw
cell and the whole verdict. The terms are in the preimage because they decide what the bytes *mean*: the
same file under another governed currency is another verdict, and a witness that hid that would be a
hash of the data pretending to be a hash of the judgement.

## 7 · The two cases this already answers that the benchmark priced at $100 each

* **Two unsuperseded lines for one unit** (`NH-EX-2016`). Summing them states an amount neither line
  asserts; choosing one would be NH picking the customer's number. Both quarantined. This is R15x.
* **A termination does not void a period that precedes it.** The dated fact is checked against the
  period it is claimed to govern, so reading a May termination as voiding March — which would hide real
  money — cannot happen.

## 8 · Falsifiers

Thirteen mutations, each biting for its primary reason, each restored byte-identically with a green
rerun: blank amount → zero · unparseable → UNKNOWN · capability → rejection · capability fails **open** ·
duplicate keeps the first row (position as a lever) · ambiguous live lines summed · non-governed currency
accepted · reversed period reordered · dangling supersession ignored · a clock enters the validator · a
`recommended` tier reappears · a `cadence` column is declared · two capabilities collapsed into one code.

## 8b · One finding about an existing guard, recorded because it generalises

The contract's layering guard (`pilotDataContract.test.ts`) scans each file for `from "…"` and checks the
specifier. It failed on this validator — not because of an import, but because a rejection message
contained the words `from "` inside a template string. **The guard matches prose, not only code.**

The message was reworded rather than the guard relaxed, because an existing guard is not a thing to
loosen in a slice whose job is to preserve behaviour. But the weakness is real and this is the *third*
time the pattern has appeared: the emitter's independence guard matched a JSDoc comment, the
double-counting guard needed comments stripped, and now a layering guard matched a string literal. The
general rule: **a structural guard that reads a file must strip comments and string literals first, or it
is measuring documentation.** Hardening it belongs to a slice that owns that file.

## 9 · Boundary

`EXPECTATION_EXTRACT_CLAIM_BOUNDARY` states it in the payload: observation only, no proof, no revenue,
no Recovery Case, no candidate. `OBLIGATION_IDENTITY_FIELDS` stays `[]` — `schedule_line_ref` is
per-obligation identity *within this extract* and is deliberately **not** candidate identity, so
declaring it must not look like closing that gap.

**No production module imports either file.** That is by design for this slice and is asserted, not
assumed: the consumers shipped here are the capability gate and the tests. The next slice that wires it
must ship its consumer with it — the rule the `obligation_ref` revert established.
