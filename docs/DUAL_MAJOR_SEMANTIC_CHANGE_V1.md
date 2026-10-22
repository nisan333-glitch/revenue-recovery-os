# A semantics-changing major, and the D1/D2 separation

**STATUS: DECISION RECORD. Decided 2026-10-02. ZERO implementation.**

Nothing in this document changes behaviour. No contract version is bumped, no field is added, no rule is
changed, `MAJOR_ROW_SEMANTICS` is untouched, and the candidate path stays closed. It records seven human
decisions and the evidence behind them, and it names what remains open so the next slice cannot quietly
assume an answer.

This record **revises the scope** of [`CONTRACT_DUAL_MAJOR_V1.md`](CONTRACT_DUAL_MAJOR_V1.md) §7-§8, which
is deliberately **not edited** here. That document decided how to honour §10 for a major that preserves row
semantics. It did not decide — and its reasoning does not reach — the case where a major genuinely changes
them. Reconciling the two documents is a DEFERRED item, listed below.

## BASELINE

| Item | Value |
|---|---|
| Branch | `claude/pilot-journey-v1` |
| HEAD at decision time | `625c51c746ddf7ff9ef96dd57b54fbb1a0056643` |
| Effective tree | identical to `a800241` (both `84b5be5f`) |
| `PILOT_DATA_CONTRACT_VERSION` | `2.0.0` |
| `MAJOR_ROW_SEMANTICS` | `{1: [], 2: [1]}` |
| `OBLIGATION_IDENTITY_FIELDS` | `[]` |
| `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` | `true` |
| Candidate staging | closed |
| Candidate emission | closed |

## PROBLEM

Two defects in cycle-identity derivation were proven by executable probe, and the attempt to address them
exposed a compatibility question the repository had answered only for an easier case.

**D1.** A supplied `cycle_id` is unreachable whenever a `subscription_id` column exists, even blank.

**D2.** When `subscription_id` is populated it *is* the cycle key, so two invoices of one subscription
collide and `dedupeCollisions` excludes **both** — the measured figure reads **zero** for exactly the
multi-invoice customers who matter most.

Fixing D2 changes what a declared field means. That makes it the first genuine row-semantics change this
product would ship, and it collides with a published customer promise:

> *"Two majors are supported concurrently for at least one full pilot cycle before removal."*

`MAJOR_ROW_SEMANTICS` admits a previous major **only when its row semantics are identical**. After D2 that
declaration could not truthfully include major 2. So the mechanism built to honour the promise cannot honour
it for the one change that most needs it.

## EVIDENCE

All read-only, from the tree at `625c51c`.

**D1 — the implementation contradicts the published field description.**

`pilotDataContract.ts:152` declares `cycle_id` as *"Alternative cycle-level join key when `subscription_id`
is not the billing grain."* The adapter (`adapters/saasActivation.ts:222`) reads:

```ts
const explicitCycle = (c["subscription_id"] ?? c["cycle_id"] ?? "").trim();
```

`??` is nullish coalescing, and `columnMap.ts:76` sets `cells[canonical] = r.cells[source] ?? ""`. A
present-but-blank `subscription_id` column therefore yields `""`, which is **not nullish**, so `cycle_id` is
never reached. The key falls through to the derived composite `entity|signed|due`, discarding a supplied
`cycle_id` entirely.

**D2 — the assumption is declared, not accidental.** `pilotDataContract.ts:143` describes `subscription_id`
as *"Stable **cycle-level** join key."* `types.ts:7-9` states the grain is the ExpectationCycle and that
*"an account may hold many cycles, so entity uniqueness is never assumed"* — entity uniqueness is explicitly
disclaimed; **subscription uniqueness is not.** Changing that is a field-meaning change.

**The both-rows exclusion is constitutional, not incidental.** The 2026-09-25 decision in
[`CLAUDE.md`](../CLAUDE.md) requires that *"all rows sharing a derived cycle identity are excluded from the
accepted population, regardless of order… No surviving row may be chosen by file position."* So "admit one
of them" is not available as a fix.

**A semantics-changing major re-keys every identity.** `canonicalBinding`
(`assessmentExecution.ts:142-163`) contains `binding.contractVersion` **and** `binding.admissionDecisionId`;
`canonicalDecision` (`:62-73`) contains `ref.contractVersion` **and** the major-scoped `ref.idempotencyKey`.
A MAJOR bump therefore produces a new `pds_`, a new `PAD-`, and a new `PAX-` through three independent
routes. Historical executions cannot collide with new ones.

**Replay never re-parses.** `CONTRACT_DUAL_MAJOR_V1.md` §3: *"the worker replays the stored,
de-identified, hash-checked cycles and never re-parses the CSV. The interpretation is applied once, at
schedule time, and frozen."* This bounds where version dispatch would be needed.

**Today's promise is genuinely kept.** `MAJOR_ROW_SEMANTICS[2] = [1]` is a truthful declaration, so two
majors are concurrently supported right now.

**Three facts that bound the customer impact of a 3.0.0 cutover.**
1. A 2.x export is byte-identical and still parseable under 3.0.0. D2 adds, removes and renames nothing —
   only the declared version string would have to change, not the customer's pipeline.
<!-- SUPERSEDED 2026-10-04 (S5) for the assessment client only: it sends no `declaredVersion`, and the
     scheduling body has no such field. Left as written, because it is the evidence this decision rested
     on. The intake client is unchanged. See REFERENCE_FIRST_SCHEDULING_V1.md. -->
2. Both clients hardcode `declaredVersion: PILOT_DATA_CONTRACT_VERSION` (`pilotIntakeClient.ts:104,135`,
   `pilotAssessmentClient.ts:154`), so a customer using the product's own path never declares an older
   major. The promise is reachable only by a direct-API caller.
3. `declaredVersion` is already persisted (`schema.prisma:263`), so per-decision auditability of the
   interpretation version already has a home.

These narrow the impact. They do **not** license weakening the promise, which is Decision 1.

## DECISIONS

### DECIDED 1 · The published dual-major promise stands, unamended

NH will **not** weaken a published customer promise because a future major changes row semantics. The §10
sentence remains authoritative. A semantics-changing 3.0.0 must therefore support **2.x and 3.x
concurrently** for the deprecation window.

`MAJOR_ROW_SEMANTICS` is sufficient **only** when row semantics are identical. It is **not sufficient by
itself** for a semantics-changing major.

**Recorded explicitly, as a correction to the prior interpretation:** reading the window as *"until we say
otherwise, in code you can check"* (`CONTRACT_DUAL_MAJOR_V1.md` §8) does **not**, by itself, satisfy a
**minimum-duration** promise. A withdrawable declaration with no floor permits withdrawal *immediately* —
which is the one outcome "at least one full pilot cycle" forbids. The declaration mechanism remains correct
as an *auditable statement of compatibility*; it is not a substitute for a duration.

### DECIDED 2 · Version-dispatched interpretation is the selected direction

For a semantics-changing major, the previous major's interpretation is **preserved and dispatched at
validation / scheduling time**.

It is **not** any of: rewriting historical executions · reinterpreting historical 2.x executions under 3.x
semantics · mutating proof · replaying historical CSV under new semantics. The worker continues to replay
stored frozen cycles and never re-parses.

**A future implementation must separate two things the code currently conflates:**

* **declared / interpretation contract version** — the semantics a submission is read under;
* **current build / implemented contract version** — what this binary ships.

Today `report.contractVersion` is the *implemented* version (`validateDataset.ts:503`) and flows straight
into `ExecutionBinding.contractVersion`. Under dispatch, a 2.x-interpreted run would therefore record and
bind `"3.0.0"` while being read as 2.x — a mislabelling hazard that must be designed out. **No schema is
designed in this slice.**

### DECIDED 3 · D1 is a contract-implementation defect, classified separately from D2

**Classification: the implementation does not fully realize declared contract semantics.** The contract
already states `cycle_id` is the alternative cycle-level join key; the code makes it unreachable. Fixing it
*restores* declared behaviour rather than changing it.

**Not fixed here.** And its release treatment is **OPEN**, deliberately left unclassified: the existing
compatibility rules do **not** determine it without ambiguity. Both readings are defensible and the choice
is a human's:

* **Letter of `COMPATIBILITY_POLICY`:** possibly MAJOR. Fixing D1 changes the accepted population — two rows
  sharing a `cycle_id` but differing in `(entity, signed, due)` are accepted today via the composite and
  would collide afterwards. *"Tighten a validation rule so a previously valid dataset is now rejected"* is a
  major-class change.
* **Spirit:** a defect fix. A file relying on `cycle_id` being *ignored* was never validly relying on
  declared behaviour, and no field description changes.

Because the rules are genuinely ambiguous here, **the version treatment must be decided explicitly before
implementation.** This record does not decide it.

### DECIDED 4 · D2 remains OPEN pending real customer evidence

`subscription_id` is declared a *"Stable cycle-level join key."* Changing it from cycle-grained identity to
subscription-grained context changes a field's meaning and is a genuine breaking semantic change.

**No replacement cycle identity is authorized.** Specifically **not** chosen: `cycle_id` precedence ·
composite identity · `obligation_ref` · source-native record identity · due-date / window identity · any
NH-derived fingerprint.

The synthetic fixtures cannot decide it. `scripts/synthetic-validation-2026-09-27/generate.mjs:151,176,201,225`
emits `subscription_id: synthetic-sub-${id}` with `id` varying **per row** — semantically an invoice id — and
its header (`:56`) includes a `cycle_id` column that D1 guarantees is never read. The frozen validation
cycles therefore never exercised D2, and would score every candidate option identically.

### DECIDED 5 · The candidate path is not authorized by anything here

Preserved unchanged: `OBLIGATION_IDENTITY_FIELDS = []` · candidate occurrence identity unresolved · staging
gate closed · emission gate closed · Case creation unreachable through this path.

**Dependency statement only:** the account-grained candidate dedupe defect — one candidate per
`(boundary × recoveryType × account)` permanently, which cannot satisfy `RECOVERY_CASE.md`'s *one Case per
(account × leak instance)* — is a **separate architecture workstream**. It has **no dependency** on Lane-1
assessment correctness: the governed finding runs through `observedSummary` (`assess.ts:72`) and never
through `attributeByEntity`, whose only production call site is the gated-off staging path.

### DECIDED 6 · Historical immutability, and what it does not forbid

Historical 2.x executions remain immutable. Accepting a **new** 2.x submission during the deprecation window
under preserved 2.x interpretation is **not** historical mutation.

A future dual-major implementation must guarantee:

* 2.x submission → 2.x interpretation;
* 3.x submission → 3.x interpretation;
* no execution is silently reinterpreted;
* the interpretation version is auditable per decision;
* existing historical execution records remain untouched.

### DECIDED 7 · The deprecation window is a named OPEN item

*"One full pilot cycle"* has no definition anywhere — no duration, no start event, no end event. **No
duration is invented here.** It is a commercial and governance definition, required **before 2.x may be
retired after 3.x activation.**

**Until that definition exists, no implementation may silently interpret the window as immediate
withdrawal.** That is the floor Decision 1 establishes.

## D1 / D2 SEPARATION

They were previously treated as one semantic decision. They are not, and the difference is load-bearing.

| | **D1** | **D2** |
|---|---|---|
| Nature | implementation does not realize declared semantics | declared semantics are themselves in question |
| Contract text affected | none — `cycle_id`'s description already says this | `subscription_id` is declared *"cycle-level"* |
| Fix direction | restore the declared fallback | redefine a field's grain |
| Needs real customer data? | **No** | **Yes** |
| Forces the dual-major question? | No | **Yes** — it is the first genuine row-semantics change |
| Version treatment | **OPEN** — ambiguous under existing rules (Decision 3) | **MAJOR**, by the policy's own wording |
| Blocked on | an explicit version-treatment decision | real evidence, then a semantic choice |

## DUAL-MAJOR ARCHITECTURE DIRECTION

Direction only. Not a design, and not authorized to build.

* Interpretation is **dispatched at validation / scheduling time**, where the cycle derivation happens. The
  worker is out of scope because it never re-parses.
* Declared/interpretation version must be **separable from** the implemented build version, including
  wherever it reaches an execution binding.
* `MAJOR_ROW_SEMANTICS` keeps its role as the **auditable compatibility declaration**. It is necessary and
  not sufficient; a duration floor (Decision 7) and a preserved interpretation (Decision 2) are the missing
  parts.
* **Explicitly undecided:** how the previous interpretation is preserved (parallel module, parameterised
  derivation, or otherwise), what the binding records, how dispatch is selected, and the migration shape.

One known consequence to design against, not solve here: the existing `MAJOR_ROW_SEMANTICS` entry means
*"nothing to interpret differently"*, which is exactly what makes it checkable. Any finer declaration —
*"identical except for cycle-key derivation"* — weakens that property and must earn its way past it.

## TRUST-INVARIANT RECONCILIATION

| Case | Verdict |
|---|---|
| Mutating an existing historical 2.x execution | **FORBIDDEN** — rules 5 and 6 |
| Reinterpreting a historical 2.x execution under 3.x semantics | **FORBIDDEN** — rule 6, *"must never rewrite historical proof"* |
| Accepting a **new** 2.x submission in its window, interpreting it as 2.x, creating a separate version-bound execution | **NOT FORBIDDEN.** Rule 6 constrains rewriting history; it says nothing about executing a still-supported older contract |

An earlier analysis claimed version dispatch would enable what rule 6 forbids. **That claim was wrong for
the third case and is withdrawn.** What argues against dispatch is maintainability and auditability
(`CONTRACT_DUAL_MAJOR_V1.md` §7, option A) — and that reasoning was explicitly conditioned on *"where no
semantic difference exists"*, a condition D2 removes. Both of verdict C's rejections were scoped to a
semantics-preserving major and neither transfers.

Rules 2, 5 and 9 are unaffected: analysis terms remain governed and pre-registered, historical records stay
append-only and self-consistent (`pilotAssessmentService.ts:313-315` re-derives each stored decision from its
own fields), and a second reading is a new linked record rather than an overwrite.

## REAL-DATA GATES

D2's semantic choice is blocked on at least one real customer export. The minimum questions:

1. Does a real export contain `cycle_id`?
2. What does `subscription_id` actually identify in that source system?
3. Can multiple invoices for one subscription occur in the same extract?
4. Is there a source-native invoice / obligation identifier?
5. What is the actual row grain?

**What real data does NOT gate:** Decision 1, Decision 2's direction, Decision 7's definition, or D1's
existence. Those are decidable from repository semantics, and three of them are decided above.

**What real data alone cannot settle** — recorded so it is not expected to: stability of any reference across
correction or reschedule is not decidable from extracts at all, because the discriminating observation is
identical for *stable reference* and *reused reference*. That needs independent source evidence, which is a
DEFERRED workstream.

## CANDIDATE-PATH NON-AUTHORIZATION

Nothing here authorizes candidate staging, candidate emission, Case creation through that path, or any change
to the candidate dedupe key, the candidate schema, or the staging and emission gates. All four locks remain:
boundary enrolment (default off), `leakInstanceIdentityStatus()` fail-closed, the
`attributions.length > 0` write guard, and the emitter's independent check.

## OPEN ITEMS

| Item | Status |
|---|---|
| D1's release/version treatment | **OPEN** — ambiguous under existing rules; must be explicit before implementation |
| D2's replacement cycle semantics | **OPEN** — blocked on real data |
| Definition of "one full pilot cycle" | **OPEN** — commercial/governance, required before 2.x retirement |
| Dual-major dispatch design and schema | **OPEN** — direction decided, design not started |
| How declared/interpretation version reaches a binding | **OPEN** |
| Reconciling this record with `CONTRACT_DUAL_MAJOR_V1.md` §7-§8 | **OPEN** — that file is not edited in this slice |

## DEFERRED — DO NOT FIX IN ANY SLICE THAT TOUCHES THE ABOVE

`SAAS_ADAPTER_VERSION` / `PARSER_VERSION` absent from `canonicalBinding` · `proseClaims.test.ts`
capability-claim coverage gap · candidate occurrence identity P1-P5 · candidate dedupe correction and
versioning · obligation attestation · D2's semantic choice · the final 3.0.0 schema · real-data acquisition.

## IMPLEMENTATION PRECONDITIONS

Nothing may be implemented until the precondition for that specific item is met.

| To implement | Preconditions |
|---|---|
| D1 fix | its version treatment decided explicitly (Decision 3); a falsifier that a blank `subscription_id` with a supplied `cycle_id` uses the `cycle_id` |
| D2 fix / 3.0.0 | at least one real export answering the five questions · a semantic choice made on that evidence · Decision 7's duration defined · the dual-major design complete |
| Version dispatch | Decision 7's duration · the declared-vs-implemented separation designed · a guarantee that no historical record is reinterpreted |
| Anything on the candidate path | candidate occurrence identity and P5 correction semantics resolved — neither of which this record addresses |

## STOP CONDITIONS

Stop and report rather than proceed if any of these would become true:

* a contract version is bumped, or `MAJOR_ROW_SEMANTICS` is edited, by a slice not explicitly authorized to;
* `MAJOR_ROW_SEMANTICS[3]` would list major 2 while D2's semantics differ — that would be a false
  declaration, and the mechanism exists to make the claim auditable;
* `OBLIGATION_IDENTITY_FIELDS` becomes non-empty, or `leakInstanceIdentityStatus()` reports establishable;
* any of the four candidate locks is weakened;
* the deprecation window is interpreted as immediate withdrawal without Decision 7's definition;
* a D1 or D2 fix is implemented without its preconditions above;
* `pds_1bc639b3…`, `PAX-8ad0089a…`, the EP-31d golden vectors, or either `nhev_…` record changes.

## WHAT THIS RECORD IS NOT

It is not a plan, not an authorization to implement, and not a contract change. It decides a **direction**
for dual-major support, **separates** two defects that were wrongly bundled, and **names** what is still
unknown. No observed amount anywhere in this document is Revenue Returned or Auditable Revenue.
