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

## What is not covered here

* **Database-level guards** (append-only triggers, TRUNCATE protection, the purge-authorisation
  function) were negative-controlled in EP-16, EP-17 and EP-18 — 6 controls each — and are unchanged
  by this branch. They were not re-run.
* **Browser-level coverage of each risk-matrix row** is deliberately out of scope for this branch; the
  matrix is proven at API / worker / PostgreSQL level and the browser proves the journey. Per-case
  browser coverage is the next branch.
