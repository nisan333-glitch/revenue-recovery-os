# EP-19 · Negative controls

A test that passes proves nothing on its own: it might be asserting something the code cannot violate,
or nothing at all. So for each protection this epic added, the guard was **removed** and the suite
re-run, to see whether anything actually noticed. A guard whose removal breaks no test is not
protected — it is merely present.

Every file was restored and checksummed afterwards (`md5sum -c`), so nothing here leaked into the
branch. All controls were run against a real PostgreSQL 16 database.

| # | Guard removed | How | Tests that failed | Verdict |
|---|---|---|---|---|
| NC-1 | Intake persists **only** a usable dataset (`pilotIntakeService.ts`) | forced the `!usableForAssessment` branch off | 1 — matrix scenario `all-rejected` | caught |
| NC-2 | `failed` is **not** a settled state (`executionPolling.ts`) | added `\|\| view.state === "failed"` to the settle test | 1 — "does NOT settle on failed" | caught |
| NC-3 | No offline fallback in the data layer (`apiClient.ts`) | served a `localStorage` cache on transport failure | **7** — every network-failure test | caught |
| NC-4 | The browser figure is labelled a preview (`ObservedResultsScreen.tsx`) | retitled it "Observed result" | 1 — "computed in this browser… not an execution, Proof or Revenue Returned" | caught |
| NC-5 | Undeclared handler ⇒ candidate-capable (`server/agents/types.ts`) | flipped `!== false` to `=== true` (fail-open) | **8+** across the agent-runtime suites | caught |
| NC-6 | Corrected customer-facing privacy claims (`DP_EXECUTION_PACKAGE.md`) | restored the "entirely in your browser" pitch | 1 — the retracted-claim guard | caught |
| NC-7 | The EP-19 UI wiring (`Assessment.tsx`) | stopped sending `admissionPolicyId` to the gate | the **browser journey**, at the upload screen | caught |
| NC-8 | Defective rows participate in their own collision (`validateDataset.ts`) | re-exempted them: `if (!rejectedForAnyReason)` on the candidate push | 2 — `corrupting a rival row…` and `identical rows are both excluded` | caught |
| NC-9 | The collision rule entirely | reinstated "first wins" (`firstWins` map + `continue`) | **5** across `pilotDataContract.test.ts` and `syntheticScenarios.test.ts` | caught |
| NC-10 | The **pure rule** keying a verdict to its identity (`forSelection`) | made it return `held` regardless of the keys | 3 in `policySelection.test.ts` | caught |
| NC-11 | The **component's use** of that rule (`PilotPolicyGovernance.tsx`) | rendered `governance`/`policyHash` directly, `forSelection` intact | the journey's 2 identity-change checks | caught |
| NC-12 | The report panel's displayed counts and codes (`ValidationReportPanel.tsx`) | showed `dataRows` in the `Accepted` counter and dropped the row-level code pill | **12** across the browser matrix, on both the admitted and refused paths | caught |

## What NC-7 showed about the harness itself

Reverting the wiring reproduces the exact pre-EP-19 dead end: the server answers `NOT_ASSESSABLE`,
the gate blocks, and the flow never leaves the upload screen. The journey failed and exited non-zero,
which is correct — but its summary line read `4/4 checks passed`, because a harness timeout is not a
recorded check and the four governance checks before the failure point had genuinely passed.

In a CI log that line would be read as a pass. The harness now distinguishes recorded-check failures
from harness errors and prints `JOURNEY FAILED` explicitly. A negative control that only verified the
exit code would have missed this; the output a human actually reads is part of the guard.

## What NC-8 and NC-9 are for (the collision rule)

NC-9 is the one that proves the original defect is closed rather than merely re-described. It reinstates
"first wins" and five tests go red, including the order-invariance assertion — reverse the file, get a
different accepted population. That assertion is the load-bearing one: the counts alone would still pass
under either rule for some datasets.

NC-8 covers the *second* lever, which the first version of this fix left open. Excluding every colliding
row removes file **order** as a way to choose which row counts; it does not, by itself, remove the
ability to choose by making the unwanted row invalid — unless a defective row still participates in the
collision it caused. Re-exempting defective rows turns the corrupt-rival test red, which is exactly the
behaviour a beneficiary could have used.

## A defect the browser journey caught and the unit test could not

The Propose button is meant to be disabled while a stated policy is invalid. The unit test asserts
`/disabled=""[^>]*>Propose as/` against the server-rendered screen and **passed even with the guard
missing** — because on an empty form the button is already disabled by `!identified`. It could not tell
"disabled because nothing is identified yet" from "disabled because this policy is invalid".

`npm run test:journey` caught it, because it fills the form completely first and only then makes one
threshold invalid. The lesson is not that the unit test was wrong but that it was asserting a state the
page reaches for several different reasons; a check on a fully-populated form was needed to isolate the
one that mattered.

## Why the governance-selection rule needed TWO controls

There are two guards, not one: the pure rule, and the component actually routing through it. A single
control cannot prove both, and the first draft of this pair got it wrong — removing the component's gate
leaves `forSelection` untouched, so its unit tests keep passing and that control says nothing about them.

Run separately, the asymmetry is the whole point:

| | `policySelection.test.ts` | the browser journey |
|---|---|---|
| **NC-10** — `forSelection` ignores the keys | **3 fail** | fails too (the component calls it) |
| **NC-11** — component bypasses the gate | **all 10 pass** | **2 fail** |

NC-11 passing every unit test while the browser check goes red is what proves the two layers test
different things: the rule can be perfectly correct and simply not wired up. Incidentally, TypeScript
caught part of NC-11 on its own — bypassing the gate left `loadedPolicyKey` unread, which
`noUnusedLocals` rejects. That is a third, free guard, but it only fires for this particular shape of
mistake and is not a substitute for either control.

## NC-12 found a false pass in the assertion it was testing

String-matching browser assertions are the kind that quietly pass against whatever happens to be on
screen, which is why this control was worth running rather than assuming.

The first version compared counts with `endsWith(String(expected))`. Under the sabotage, `one-valid-row`
stayed **green**: the panel showed 31 accepted where 1 was expected, and `"ACCEPTED 31".endsWith("1")` is
true. The check had been passing for a reason unrelated to the number being right.

Replaced with an exact numeric comparison of the counter's last token. Re-running the control then
produced **12** failures instead of 11 — the extra one being `one-valid-row`'s counts, which is the
evidence the gap is closed.

## NC-13 · Local preflight must not claim a policy verdict

The browser's preliminary report has no admission policy: `preflightAsResult` evaluates it with a
null policy. The previous screen nevertheless displayed "no policy configured" and "not
pilot-admissible", which could misrepresent a configured active policy as absent. The preliminary
screen now describes a contract preflight and says admission was not evaluated. It leaves the policy
verdict to the server result.

**Two controls, because a wholesale revert is the easy case.** The regression that actually happens is a
half-fix: someone corrects the wording and leaves the admission section in place, believing they are
done. The test has to disagree with that too, so it is controlled separately.

| Control | Guard broken | Must fail |
|---|---|---|
| NC-13a | the component wholesale — restore the previous preliminary rendering | `ValidationReportPanel.test.ts`, on the missing explanation |
| NC-13b | **half-fixed** — keep the new prose and pill, but still render `AdmissionSection` when preliminary | `ValidationReportPanel.test.ts`, on `no policy configured` |
| NC-14a | The migration — recreate `recovery_cases_candidate_boundary_unique` | the `leaves exactly one uniqueness arbiter` test | caught |
| NC-14b | The same, with the schema test filtered out so it cannot mask the result | the concurrency test — **it did not fail**; see below | **not caught** |
| NC-15 | Clearing the previous verdict on a new upload — removed `setValidation(null)` from `onFile` | the journey's stale-verdict check: the server-verified panel survives a failed upload | caught |

Each file restored byte-identically and checked with `md5sum -c`, as every other control here does. The
browser journey checks the same wording end to end and needs a PostgreSQL-backed run.

**Before/after evidence.** The defect was demonstrated at `cc9029e` before being fixed: rendering the
preliminary panel for `all-rejected` there produced both `no policy configured` and
`not pilot-admissible`. Without that step the fix would only be asserted.

## NC-14 · the measurement that says what the concurrency test is actually worth

`ON CONFLICT` suppresses conflicts only on the arbiter index it names, so a second unique index over the
same column can raise a duplicate-key error on a valid replay. The fix drops the redundant composite.

The added test came as **one** test with the schema assertion first, which breaks its own control:
restoring the constraint aborts on the schema line before the concurrency half runs, so the control
would look like it worked while proving nothing. Split into two, each controlled separately.

**NC-14a** fires deterministically: recreate the constraint and the schema test goes red.

**NC-14b is the honest part.** With the constraint restored and the schema test filtered out, the
concurrency test was run **10 times — 4 candidates × 3 concurrent promotions each, 120 concurrent
promotions in total — and it never failed. 0 of 10.**

So, stated plainly: **the concurrency test does not catch this defect.** The guard that does is the
schema assertion. In CI the race surfaced exactly once across many runs, which matches: it is rare, not
impossible, and a test that cannot be made to fail on demand is not the thing protecting us here.

The concurrency test is kept, because it proves something else that is real and worth pinning — across
12 concurrent promotions exactly one `created` is returned, one `recoveryCaseId` exists per candidate,
and exactly one `PromoteCandidate` authority event is written. That is the store's idempotent replay
path, and it holds whether or not the race fires. It is simply not evidence about the arbiter.

## NC-15 · a failed upload must not leave the last verdict on screen

The data layer already refuses to invent a result when the server is unreachable — `networkFailure.test.ts`,
controlled by NC-3. What that cannot see is the screen. The journey reaches the transport-failure step
holding a **server-verified** report from the last admitted scenario, so if a failed upload does not clear
it, the operator sees an error *and* an apparently valid report for a file that was never accepted.

Removing `setValidation(null)` from `onFile` turns the check red, so the assertion pins that clearing and
not something else. The precondition — that the verdict is on screen *before* the failure — is asserted
rather than assumed, because `count === 0` would otherwise pass trivially if the matrix were reordered so
the last scenario was a refused one.

## What is not covered here

* **Database-level guards** (append-only triggers, TRUNCATE protection, the purge-authorisation
  function) were negative-controlled in EP-16, EP-17 and EP-18 — 6 controls each — and are unchanged
  by this branch. They were not re-run.
* **The nine CSV scenarios** are exercised in the browser matrix in `EP20_BROWSER_MATRIX.md`.
  Browser coverage of tenant access, roles, repeats, concurrent claims, frozen policy, halted case
  and retention remains outstanding. A transport failure on upload IS covered (NC-15).
