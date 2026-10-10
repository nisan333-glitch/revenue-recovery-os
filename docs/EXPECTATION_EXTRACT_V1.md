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

## 4 · Schema presence is NOT row-level availability (v1.1.0)

This is the distinction that carries the most risk, and it is now pinned in both directions.

**Schema presence** of `expected_amount` and **row-level availability** of an authoritative amount are
different facts. The *column* is required — an extract omitting it is unusable. The *value* is not,
because a genuine obligation may exist while its price cannot be authoritatively stated, and **an
expectation does not stop existing because nobody can price it**. Requiring the value would reproduce,
in the artefact built to fix it, the exact defect that makes a missing invoice unrepresentable in 2.0.0.

**Four states, four outcomes, no two of which may ever collapse:**

| Cell | Outcome | Why it is its own case |
|---|---|---|
| **blank** | **UNKNOWN.** Row **preserved**, every non-monetary fact in force, this unit's monetary quantification fails closed | the source cannot price it; the obligation is still real |
| **malformed** | REJECTED `NH-EX-2005` | *"could not state it"* and *"stated something unreadable"* are different facts; folding them would let a malformed cell escape its rejection |
| **explicit zero** | REJECTED `NH-EX-2018` | writing `0` **asserts nothing is owed** — a claim that satisfies itself against any billing at all |
| **negative** | REJECTED `NH-EX-2019` | a credit, which belongs to the observation side: a row in the wrong file, not a modelling mistake |

Never coerced to zero, never estimated, never averaged from prior invoices, never taken from a plan
price, never prorated by NH.

### Per-unit monetary quantification

`monetaryQuantification` is declared **per unit**, not per extract, with `NH-EX-3006`. An extract may
price nine obligations and be unable to price the tenth, and a single extract-level flag would have to
lie in one direction or the other — claim the whole file is unpriceable, or claim the tenth unit has a
figure. The roll-up is therefore allowed to say **`PARTIAL`**, and `unquantifiableUnitRows` names
exactly which units fail closed so no caller has to infer it from a count.

Downstream, monetary reconciliation for such a unit is `NO_RESIDUAL_UNPRICED` — **never $0.00**, which
would assert the obligation was checked and found satisfied.

Two consequences worth stating because they are easy to get wrong:

* **An unpriced unit still participates in identity and cardinality checks.** Being unpriceable is not
  a free pass: a blank-amount row is a real obligation and collides like one. Exempting it would let a
  beneficiary dodge duplicate detection by blanking a price.
* **A superseded line is neither priced nor unpriced** — it is not an obligation, so its blank must not
  drag the roll-up to `PARTIAL` and understate what NH can quantify.

### `NH-EX-2006` is retired, not narrowed

It meant *"zero or negative"*, conflating two different source errors behind one remediation.
**Nothing ever cited it** — no production consumer, nothing persisted, no customer received it — so
narrowing it in place would have been harmless *in fact*. It is retired anyway, recorded in
`RETIRED_CODES`, because the rule in the catalogue header is stated without an exception and a rule
that bends when breaking it is convenient is not a rule. The cost of honouring it is one unused integer.

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

Twenty-two mutations, each biting for its primary reason, each restored byte-identically with a green
rerun: blank amount → zero · unparseable → UNKNOWN · capability → rejection · capability fails **open** ·
duplicate keeps the first row (position as a lever) · ambiguous live lines summed · non-governed currency
accepted · reversed period reordered · dangling supersession ignored · a clock enters the validator · a
`recommended` tier reappears · a `cadence` column is declared · two capabilities collapsed into one code ·
a production module imports the artefact.

And eight for the v1.1.0 distinction specifically: the required column read as a required **value** · a
blank folded into **malformed** · zero and negative **re-conflated** · an unpriced unit **claiming**
quantification · the roll-up collapsing `PARTIAL` into `AVAILABLE` · an unpriced row **exempted** from
collision detection · the **retired** code resurrected · a superseded blank dragging the roll-up.

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
