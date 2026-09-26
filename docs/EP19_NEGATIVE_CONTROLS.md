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
| NC-16 | The UI reads the lifecycle as an **`AuditRead`** holder (`PilotPolicyGovernance.tsx`) | `refresh()` reads as `proposer` (operator) instead of `STEWARD` | **6** in the journey, incl. all three new audit-trail checks | caught |
| NC-17 | The UI activates as a **steward** (`ActivatePilotPolicy`) | `move()` sends the transition as `proposer` | **5** in the journey — `an activated bar may judge a dataset` first | caught |
| NC-18 | The UI submits intake as a **`SubmitPilotDataset`** holder (`Assessment.tsx`) | `runGovernedExecution` schedules as `STEWARD` | **6** in the journey — completion, then `count=0` executions | caught |
| NC-19 | The audit panel itself — proof that the **old** assertion was vacuous | `{false && currentGovernance && …}` on the panel's render guard | the 3 new checks (the old one still **passed**) | caught |
| NC-20 | The halt's own safety property — `haltIf(true, …)` forced on the **green** path | proves a halt with nothing failed is itself recorded as a failure | 1 — `the harness halted with no recorded failure to justify it` | caught |
| NC-21 | Freezing is a **steward** act (`PilotPolicyGovernance.tsx`) | `move()` sends only `FROZEN` as `proposer` | **2** + a deliberate halt — the bar stays ACTIVE, no `FROZEN` event | caught |
| NC-22 | The intake gate on a non-ACTIVE bar (`pilotIntakeService.ts`) | `if (false && !mayEvaluate(governance.state))` | **2** — the frozen dataset is admitted and leaves Upload | caught |
| NC-23 | The refusal names **which** state stopped it (`PolicyStatePill`) | every lifecycle state labelled `active` | **1** — only the state-naming check | caught |
| NC-24 | The application duplicate lookup (`pilotIntakeService.ts`) | `if (false && prior !== null)` | **2** — the 409 becomes the generic uniqueness message, `NH-DC-4003` gone | caught |
| NC-25 | The 409 reaching the operator (`apiClient.ts`) | `"conflict"` removed from `SAFE_TO_SHOW_VERBATIM` | **1** — only the screen check; the server still refuses correctly | caught |
| NC-26 | The repeat actually being a repeat (`journey.mjs`) | `REPEAT_CSV_PATH = FROZEN_CSV_PATH` | **4** — incl. a **second execution**: `before=1 after=2` | caught |
| NC-27 | The database constraint behind test 5c | `ALTER TABLE pilot_dataset_submissions DROP CONSTRAINT …_pkey` on a scratch database | 1 — the same-key INSERT *succeeds*: "promise resolved instead of rejecting" | caught |
| NC-28 | Classifying the insert's conflict (`recordDuplicateAware`) | re-throw the `P2002` instead of translating it | **2** — tests 5 *and* 5d, both with the generic uniqueness message | caught |

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
  Browser coverage of repeats, concurrent claims, halted case and retention remains
  outstanding; frozen policy and repeats are each covered in part (NC-21 → NC-26, above). A transport failure on upload IS covered (NC-15). Role **wiring** is covered by
  NC-16 → NC-18; **tenant isolation is not, and cannot be on this path** — see below.

## NC-16 → NC-19 · role wiring, and the vacuous assertion they replaced

Authorization itself was already well covered off-browser (~40 forbidden/403 assertions across 15 server
test files, plus service-level tests built on scoped actors). What was **not** covered is the class of
defect this branch keeps finding: *a rule may exist and be correct while the UI is not wired to it.*

The assertion that claimed to cover it was:

```js
const governanceText = await page.locator("main").innerText();
check("the lifecycle names the proposer and the activator separately",
  governanceText.includes(proposerName) && governanceText.includes(stewardName));
```

Both identity strings are rendered by the **Propose** and **Activate** buttons, which are inside `main`.
NC-19 proves the consequence rather than arguing it: with the entire audit panel suppressed, that check
still **passed** and the journey still reported `JOURNEY PASSED`. It could not have failed for any
governance reason.

It is now three checks scoped to the audit panel — which the screen renders only from a successful
lifecycle read, and that read requires `AuditRead` — ending in the sentence the server's own
`proposedBy`/`activatedBy` comparison produces, which no button label can satisfy.

NC-16 → NC-18 then rewire each of the three acts to an identity that does **not** hold the permission,
so the refusal observed in the browser is a genuine server 403 on the governed path. They are
distinguishable, which is the point: NC-16 removes the panel entirely (the read is refused), while NC-17
leaves the panel loading and shows `PROPOSED unassigned-operator@company (operator)` with **no
`ACTIVATED` event at all** — the activation never happened. NC-18 leaves governance intact and kills the
execution, with the API reporting `count=0` executions for the boundary.

Two waits had to stop throwing for these controls to mean anything. A bare `waitFor` aborts the harness,
so the run ended with `2/2 recorded checks passed` and a bare `Timeout` — the failure was real but
attributable to nothing. Each now degrades and is followed by a named check that samples the DOM, so a
refused act is reported as *that* check failing. The same pass removed a `check("an admitted dataset
leaves the upload screen", true)` — a literal `true`, recorded as a PASS for a condition never sampled.

### NC-17 terminates instead of timing out

NC-17 originally recorded its five intended failures and then died on
`locator.click: Timeout 30000ms exceeded` — a real failure, attributed to nothing. The cause is
structural, not flaky: with the bar stuck in DRAFT the server answers `NOT_ASSESSABLE`, the gate blocks,
and `Pilot readiness →` is never rendered, so the first action of the next section can only spend its
timeout. The *evidence* was never in doubt; the way the run ended was uninformative.

`haltIf` now ends the run at that junction with the reason printed, both where it happens and in the
summary. It is a termination, not a rescue:

* it is **not** a catch — it swallows no error and suppresses no failure;
* it passes nothing. Unreached checks are reported as unreached, never as passes;
* it **cannot fire on a healthy journey**, because it refuses to halt unless a check has already been
  recorded as failed. **NC-20 proves that is not merely asserted:** forcing `haltIf(true, …)` on the
  green path records `the harness halted with no recorded failure to justify it` and the run reports
  `JOURNEY FAILED`. A halt can never silently truncate a passing run.

NC-17 after the change: the same five failures, `HALTED` with its reason, `JOURNEY FAILED (5
problem(s))`, exit 1, no bare timeout — and the attribution is unchanged, since the audit panel still
prints `PROPOSED unassigned-operator@company (operator)` with no `ACTIVATED` event at all.

**Not controlled, because it cannot be:** refusal of an unauthorized user *inside* the UI. No
role-forbidden act is reachable from the screens — governance hard-codes the steward for
activate/freeze/retire and the operator for propose; assessment hard-codes the operator — so observing
an in-UI refusal would require an act-as affordance, which this slice deliberately does not add.

## NC-21 → NC-23 · a frozen bar, and the frozen rule the browser cannot reach

The server enforces the frozen state in **two independent places**, and only one is reachable from
this UI:

| Where | Refusal | Browser-reachable |
|---|---|---|
| Intake (`pilotIntakeService.ts`, `!mayEvaluate(governance.state)`) | the `whyCannotEvaluate` sentence | **yes** |
| Schedule, re-checked *now* (`pilotAssessmentService.ts`) | `NH-AX-1007 policy_not_active` | **no** |

`App.tsx` renders screens conditionally, so navigating to the governance screen **unmounts
`Assessment`** and discards the admitted dataset. To freeze you must leave; on return the same file is
refused *earlier*, at intake. A browser test aimed at the schedule-time rule would therefore observe
the intake refusal and credit it to the wrong rule — so it is not attempted. That rule keeps its
service-level coverage (`pilotPolicyGovernance.test.ts`, "a RETIRED or FROZEN policy judges nothing").

The three controls are deliberately **distinguishable**, because a control that fails the same way as
its neighbour proves only that something broke:

* **NC-21** — freezing sent as the operator: the bar stays ACTIVE, so the state check and the audit
  check fail and the run halts before the intake step (which would otherwise wait 30s for a panel that
  cannot appear, since an admitted dataset leaves Upload).
* **NC-22** — the intake gate removed: the frozen dataset is **admitted**, failing both the refusal and
  the state-naming check. Note what does **not** fail: `the server reported the frozen state for that
  refusal` still passes, because the server still *reports* `FROZEN` — it has merely stopped acting on
  it. That is precisely why the refusal is asserted separately from the state.
* **NC-23** — only the state label broken: the refusal stands, and just the state-naming check fails.
  The difference between "governance stopped it" and "the operator can see what stopped it".

**A second fixture is used — and the reason EP-23 gave for it was wrong.** EP-23 stated that the
frozen-intake check *could not* reuse `journey.synthetic.csv`, because `deriveIdempotencyKey` keys a
submission by boundary and bytes. It does not: the key also includes `boundary.datasetId`, the free-text
dataset label (`validateDataset.ts:538-542`), and the frozen section supplies a fresh label — so the same
bytes would have been a different identity and would have been accepted. **The fixture was never forced
by that rule.** It stays because distinct bytes leave no reading under which the frozen section could be
observing a duplicate refusal instead of a governance one. Retracted here rather than quietly reworded;
EP-24 §"the label is part of the identity" is where the real derivation is measured.

**Resuming is asserted as a state round-trip only.** `policyGovernanceState` takes the **latest**
activation — `ACTIVATED` *or* `UNFROZEN` — as `activatedAt`, so after a resume the anti-tuning rule
(`activatedAt > firstSeenAt`) correctly refuses any dataset first seen before it. "It judges again" is
**false** for every dataset this run has already submitted, and no check claims otherwise: that is a
pre-registration rule, not a frozen-policy one.

## NC-24 → NC-26 · repeating the same upload, and the label nobody had measured

### The invariant, as the code actually has it

```
datasetFingerprint = sha256(csvText)                                  validateDataset.ts:229
idempotencyKey     = sha256(…, boundaryId, datasetId, datasetFingerprint)         :538-542
prior              = findSubmission(key, boundaryId)                pilotIntakeService.ts:256
prior !== null     -> ConflictError("NH-DC-4003: … already submitted on <date>")  -> 409
```

**Refuse, not reuse** — no prior report comes back. And the identity has **three** inputs, not two:
`datasetId` is the free-text "Dataset label" the uploader types (`UploadScreen.tsx:158`).

**This was discovered by the test failing, not by reading carefully enough.** The first run of the
section used a fresh label for the repeat and the server answered **200** — a new identity, not a
duplicate. Two consequences, both recorded rather than tidied away:

1. the browser section now reuses the label verbatim, so it tests the contract that exists;
2. **the same bytes re-submitted under a different label are accepted**, create a second submission, and
   — followed through — a second execution. The label is supplied by the party who benefits from the
   number. Whether that is acceptable is a constitution question, not a test fix, and it is reported as
   an open question rather than patched here. Checks 6a and 6b **measure** both movable inputs
   (label, boundary) instead of describing them.

### Two layers, and they are distinguishable

`idempotency_key` is the **primary key** of `pilot_dataset_submissions`, so a second row cannot exist
even with the application lookup gone. NC-24 proves this empirically: with `findSubmission`'s refusal
disabled the repeat was **still refused 409** — but carrying the generic *"duplicate: a uniqueness
constraint was violated"* message instead of `NH-DC-4003`. **What remained enforcing the refusal was the
primary key**, and that is exactly why the browser pins the **contract's code and mechanism** rather than
"a 409": a check satisfied by any 409 would have stayed green through NC-24 and credited the contract
with a refusal the database made.

`pilotIntake.test.ts` **5c** pins that second layer by **exercising the consequence, not reading the
schema**: after a successful submission it writes a second row directly under the same key, bypassing
every application check, and asserts the write is rejected (`P2002`) with the row count still 1. It then
writes the identical row under a *different* key and asserts that one is accepted — so the rejection
cannot be mistaken for "this table refuses writes". **NC-27** confirms the test is pinned to the real
constraint rather than to metadata: with `pilot_dataset_submissions_pkey` dropped on a scratch database,
the same-key insert *succeeds* and 5c fails with "promise resolved instead of rejecting".

The browser cannot see submission rows at all, so without 5c the duplicate proof would rest on one layer
while the documentation claimed two.

### Why the consequence check is evidence rather than corroboration

An upload alone never creates an execution — only *Run governed execution* does — so comparing execution
counts across a refused upload would be true whatever happened. So where the guard has failed and the
repeat is admitted, the section **follows it through to the governed run**. NC-26 is what proves that
works: `before=1 after=2 followedThrough=true`. A second governed work item really did appear.

### Signatures

What makes these attributable is the **named check and the causal mechanism**, not the arithmetic — equal
counts would be fine if the mechanisms were still distinct:

* **NC-24** — the response check and the screen check. Mechanism: the application lookup is gone, the
  primary key refuses instead, and the contract's code vanishes from a refusal that still happens.
* **NC-25** — the screen check alone. Mechanism: the server refuses correctly and `apiClient` replaces
  its sentence with the generic one, so the operator is told something else.
* **NC-26** — byte identity, the response, the screen, and the second execution. Mechanism: it is not a
  repeat at all, so nothing refuses it and the governed run produces a second work item.

### What this does not claim

Duplicate **submission** is not duplicate **rows inside a CSV**, not in-dataset **cycle collision**
(NC-8/NC-9), not **concurrency**, not **anti-tuning**. Five separate rules. These are **sequential**
repeats and say nothing whatever about concurrent ones.

## NC-28 · the intake TOCTOU, and a defect reproduced deterministically

Duplicate detection used to be a `findSubmission` check *before* the write — a check-then-act with no
transaction and no lock. Two concurrent identical submissions could both read "no prior" and both
attempt the insert. The primary key meant exactly one row survived, so **the outcome was never at
risk**; what the loser received was a bare `P2002` that the error handler mapped to
*"duplicate: a uniqueness constraint was violated"* rather than the contract's own `NH-DC-4003`.
A client routing on that code saw nothing it could use.

**Reproduced deterministically on the unmodified implementation** — not "N attempts and hope", which
the NC-14b measurement already showed is worth nothing here. Test **5d** holds a real **uncommitted
INSERT** open as the concurrent winner: the service's `findSubmission` runs on the default client,
outside that transaction, so it cannot see the row and misses *every* time. The service's insert then
blocks on the primary key, and the test waits until **PostgreSQL itself reports a backend waiting on a
lock** (`pg_stat_activity.wait_event_type = 'Lock'`) before releasing the winner. The interleaving is
observed, not assumed. Pre-fix result:

```
× 5d · a concurrent loser receives the duplicate CONTRACT code, not a bare uniqueness error
  → expected 'duplicate: a uniqueness constraint wa…' to contain 'NH-DC-4003'
```

with the one-row and `409` assertions passing — exactly the documented shape of the defect.

### The mechanism chosen, and the two rejected

**Chosen: the insert is the arbiter.** The pre-check is gone; `recordDuplicateAware` catches the
`P2002`, re-reads the winning row for its `submittedAt`, and raises the same `ConflictError` a
sequential repeat raises. The sequential and concurrent cases now travel **one** code path, which is
why NC-28 — re-throwing instead of translating — fails **both** test 5 and test 5d with the identical
generic message. There is no second path that could drift.

**Rejected: a transaction or an advisory lock.** `caseGuard.ts` takes a per-case advisory lock because
Halt-versus-mutation is a real write skew across two tables — there is no single row for the writers to
collide on, so the conflict has to be manufactured. Here the primary key *is* the invariant: the
writers already collide on one row and the database already serialises them. A lock would buy no
guarantee and would serialise every submission for a boundary behind one another.

**Rejected: `upsert` / `ON CONFLICT DO NOTHING`.** That absorbs the conflict, and absorbing it is
precisely what must not happen — the caller has to learn that this dataset was already submitted, and
when.

Matching on `P2002` alone is precise rather than broad: the call writes to one table, and that table has
exactly one uniqueness arbiter — its primary key — which test **5c** asserts by exercising it. Anything
else is re-thrown untouched.

**Database consequence, stated plainly:** a sequential duplicate now performs a *failed* INSERT where it
previously performed a SELECT. No row is written, the append-only triggers are untouched, and one dead
tuple per refused duplicate is the whole cost. Nothing about the one-row invariant changed — it was
always the primary key doing that work (NC-24).

**Scope:** this is the concurrency defect only. It makes **no** change to the identity derivation, no
contract version bump, and no migration. The open question about `datasetId` in the identity is
untouched and still open.

## Tenant isolation is not browser-provable on this path

`requireBoundaryAccess` is real and is negative-controlled at service level with scoped actors
(`boundaryIds: ["tenant-1"]` → `ForbiddenError`). It cannot be proven through the browser, because
`actorFromRequest` returns `boundaryIds: Object.freeze(["*"])` for **every** dev-header request:

```ts
// server/auth/actorContext.ts
return { actorId, role, boundaryIds: Object.freeze(["*"]) };
```

The wildcard satisfies the guard unconditionally, so a browser test for cross-tenant refusal would pass
with `requireBoundaryAccess` **deleted** — exactly the vacuity NC-19 was written to expose. Enforcement
on the path that matters is the OIDC resolver (`verifiedIdentity.ts`, `parseBoundaryClaim` over
`nh_boundaries`), which needs an HTTPS issuer and a JWKS endpoint. End-to-end proof waits for that; it is
not being claimed in the meantime, and the dev identity switch is **not** evidence of authentication.
