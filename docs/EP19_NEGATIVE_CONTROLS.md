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

## What NC-7 showed about the harness itself

Reverting the wiring reproduces the exact pre-EP-19 dead end: the server answers `NOT_ASSESSABLE`,
the gate blocks, and the flow never leaves the upload screen. The journey failed and exited non-zero,
which is correct — but its summary line read `4/4 checks passed`, because a harness timeout is not a
recorded check and the four governance checks before the failure point had genuinely passed.

In a CI log that line would be read as a pass. The harness now distinguishes recorded-check failures
from harness errors and prints `JOURNEY FAILED` explicitly. A negative control that only verified the
exit code would have missed this; the output a human actually reads is part of the guard.

## What is not covered here

* **Database-level guards** (append-only triggers, TRUNCATE protection, the purge-authorisation
  function) were negative-controlled in EP-16, EP-17 and EP-18 — 6 controls each — and are unchanged
  by this branch. They were not re-run.
* **Browser-level coverage of each risk-matrix row** is deliberately out of scope for this branch; the
  matrix is proven at API / worker / PostgreSQL level and the browser proves the journey. Per-case
  browser coverage is the next branch.
