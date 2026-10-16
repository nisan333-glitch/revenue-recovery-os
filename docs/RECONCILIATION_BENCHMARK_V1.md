# The two-sided reconciliation benchmark (v1)

**Status: built 2026-10-05. Test and benchmark infrastructure ONLY.** No reconciliation core, no Missing
Invoice detector, no contract change, no new production field, no schema change. Contract remains
**2.0.0**. `OBLIGATION_IDENTITY_FIELDS` remains empty. **Nothing in this slice reads a new contract
field, and nothing detects anything.**

The benchmark exists **before** the thing it will measure, deliberately: the concealment cases are the
specification, and a reconciler built first would be measured against the cases it happened to handle.

---

## 1 · What was built

| File | What it is |
|---|---|
| `src/benchmark/reconciliationScenarios.ts` | 30 scenarios with **hand-authored** ground truth. **Imports nothing at all.** |
| `src/benchmark/reconciliationEmit.ts` | Two **independent** emitter passes — Side E and Side O |
| `src/benchmark/reconciliationScoreboard.ts` | The money-first scoreboard, plus the permanent do-nothing reconciler |
| `…Scenarios.test.ts` · `…Emit.test.ts` · `…Scoreboard.test.ts` | 33 tests: self-consistency, independence, the mandatory control, seven falsifiers |

## 2 · The structural guarantees, and how each is enforced

**Ground truth cannot come to agree with a detector.** `reconciliationScenarios.ts` contains **no import
statement of any kind** — not even `import type`, because a type is a coupling to something that can move.
Asserted by reading the module's own source and matching `/^\s*import\s/m` and `/\brequire\s*\(/` to
nothing. Every figure is authored from the business reading, and each scenario carries
`whyThisIsTheTruth` — a sentence a reviewer can disagree with, so the numbers are arguable rather than
opaque.

**Absence is represented by absence.** A missing invoice is `o: []` — the observation side emits a header
and **no data row**. Not a row of zeroes, and not a row with blank cells, because a blank-celled row is a
*rejected* row under the billing contract's required fields, and a rejected row is a different fact from an
absent invoice. Asserted directly: for `R01-missing-billing`, the observation CSV equals the header alone
while the expectation CSV carries its row.

**The two sides are independent.** Blanking every observation leaves the expectation output
**byte-identical**, and vice versa. That is the property the whole architecture rests on — an expectation
survives the total absence of billing. A source-level guard additionally asserts neither emitter function
mentions the other's field.

**UNKNOWN is an empty cell, never `0.00`.** A zero would assert an obligation of nothing.

## 3 · The authored totals

Pinned so a silently changed or dropped scenario fails rather than quietly moving a headline:

```
scenarios                 30
expectation rows          45
observation rows          31
ground-truth positive     302 001 minor   ($3,020.01)
ground-truth negative      82 000 minor   ($820.00)
incremental union money   272 001 minor   ($2,720.01)
unknown expectations            2
blind-by-construction      10 000 minor   ($100.00), 1 scenario
disabled twins                  9
```

All twenty approved adversarial classes are present, plus an odd-cent case and a credit-note case.

## 4 · The twin rule

Nine scenarios appear **twice** — once with the enabling lifecycle fact present, once absent:
wrong-entitlement pairing · payer hierarchy · timing grace window · consolidated-invoice allocation ·
pause · dated cancellation · amendment supersession · re-key mapping · migration.

**Why:** the `$0` false-positive target holds *only* under those representation requirements. A benchmark
containing only the enabled twins would prove the design works where it is easy — the selection-bias
failure recorded in [`S1_OBLIGATION_IDENTITY_AUDIT_V1.md`](S1_OBLIGATION_IDENTITY_AUDIT_V1.md) §5. The
disabled twins are the proof that each lifecycle fact is a **requirement**, not a nicety.

## 5 · Two authoring errors the invariants caught

Both are recorded because the invariants existing is the point, and because the second changed a rule.

**5.1 · Ground truth is reality, never the data's appearance.** For the disabled twins `R13x` (pause) and
`R14x` (cancellation) the first draft set `expectedMoneyMinor` to $100 — what a *naive reader of the data*
computes, since the pause is not represented. But nothing was owed: the period *was* paused; the data
simply cannot say so. The central invariant failed, and the fix was to author **0**, because the naive
$100 is the **false positive the twin exists to measure**. Writing it as truth would have encoded the
detector's mistake as the standard it is judged against.

**5.2 · Where no residual exists, no residual may be asserted.** The central invariant —
`positive − negative === expected − observed` — failed on `R20`, an unpriceable expectation that *was*
billed $75. Truth: expected contributes nothing (unpriceable), observed is $75, and **neither** a positive
nor a negative figure is defined, because the comparison is impossible. Forcing the arithmetic to balance
would have been exactly the "unknown treated as zero" error the benchmark forbids. So the invariant is now
**scoped** to units where every expectation is priced, and unpriced units have their own invariant:
positive, negative and union money are all **0**, while observed money is still recorded — so the unit is
visibly *excluded* from the comparison rather than silently reading as balanced.

## 6 · The mandatory control — scoring a reconciler that finds nothing

```
detected positive money   $0.00
true-positive money       $0.00
false-positive money      $0.00
known ground truth        $3,020.01
FALSE-NEGATIVE MONEY      $3,020.01      ← all of it
MONETARY RECALL           0
MONETARY PRECISION        null           ← NOT 1.00
event recall / precision  null           ← gated, not scored as zero
gated scenarios           30
```

**The trap this control catches:** precision is `truePositive / detectedPositive` = 0 / 0. Returning `1`
would state that a detector which found nothing was never wrong — the single most flattering lie a
scoreboard can tell. It returns `null`: **no precision**, not perfect precision. Likewise a gated
capability reports `null` rather than `0`, because "we did not look" is not "we looked and found none".

**And a *perfect* reconciler still scores below 100% recall** — the duplicate-masking scenario is a real
false negative at any grain, so the best achievable recall is `(302 001 − 10 000) / 302 001`, with the
shortfall equal to `A_BLIND_BY_CONSTRUCTION` exactly. The denominator is not trimmed to flatter the
capability; the named line explains the gap instead.

## 7 · Seven falsifiers, all biting

Each applies a plausible, convenient distortion to the **readings** — never to the ground truth — and
asserts the scoreboard refuses to flatter it. No source mutation, so nothing needed reverting.

| # | Distortion | Refused because |
|---|---|---|
| F1 | report UNKNOWN as zero | the unknown **count** is read from the truth; no reading can erase it |
| F2 | net negatives against positives | separate columns; the false negative stays the full positive truth |
| F3 | claim the blind scenario was refused | a detector cannot shrink its own denominator |
| F4 | conflate positive exposure with union money | union is summed from the truth and cannot be moved |
| F5 | move exposure from a scenario that has it to one that does not | true positive is computed **per scenario**, so this scores one false positive **and** one false negative, never a wash |
| F6 | report a scenario that does not exist | scoring iterates the scenarios, never the readings |
| F7 | omit a reading entirely | a missing reading is a **false negative**, not an absent scenario |

**F4's first form was wrong and the scoreboard was right.** I asserted that reporting $100 on the
wrong-entitlement scenario should score a false positive. It should not: the truth genuinely holds $100 of
positive exposure there, because one entitlement really was unbilled. The property that matters is the
other one — that same scenario contributes **zero union money**, because the company was paid in full and
the dollar sits against the wrong entitlement. The falsifier was rewritten to test that the two figures can
disagree and that no reading can close the gap.

## 8 · What this does NOT do

It detects nothing. It reads no new contract field. It touches no production path — D1, D2, admission,
scheduling, the worker, every identity and every hash are untouched. It licenses **no** coverage, recall or
precision claim about real data: these are synthetic scenarios with authored truth, and the only
reconciler scored so far is one that deliberately does nothing.

## 9 · Next

The reconciliation core is **not authorised**. When it is, it is scored against this benchmark unchanged —
and the scoreboard has already demonstrated it can report total failure honestly, which is the only
evidence that its success figures will mean anything.
