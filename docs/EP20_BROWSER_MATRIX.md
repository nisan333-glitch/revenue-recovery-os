# Browser coverage for synthetic pilot scenarios

`npm run test:journey` first completes the governed browser journey against an activated admission
policy, real API, worker and PostgreSQL. It then reloads the assessment screen once per synthetic
CSV scenario from `syntheticScenarios()`. The fixture writer exports the same bytes and expectations
used by the contract and server matrix; no customer data or claim about real recovery is involved.

For each scenario the browser checks whether it progresses or remains on Upload, that the report is
marked **server-verified** or **local preflight** as appropriate, and that the **visible** accepted and
rejected counts and finding codes match the fixture. Usable but unfit data must receive the server's
admission verdict; unusable data must remain labelled preliminary. The established happy path still
checks that the displayed finding came from the server execution.

Three details are worth knowing before changing any of it:

* **An admitted dataset is re-inspected by going back to Upload.** Progressing moves the flow to the
  cohort step, which unmounts the report panel — so when `Pilot readiness →` appears the counts are no
  longer on screen. `validation` survives the step change (it is cleared only by the next upload), so
  clicking `← Upload` re-renders the panel with the server result. That is deterministic; asserting
  against the panel before it unmounts would be a race.
* **Counts are compared exactly, not with `endsWith`.** A counter showing 31 where 1 is expected ends
  with "1". The negative control below caught precisely that false pass.
* **On the preliminary path there is no policy fitness verdict.** The local preflight evaluates
  admission with *no policy*, so its internal value is "not assessable" for every unusable dataset
  whatever its real fitness would be. The screen instead says `pilot admission not evaluated` and
  that no policy was read during preview. It does not claim that no active policy is configured.

This covers the nine CSV scenarios: valid, all rejected, one valid row, duplicate collisions,
narrow coverage, local timestamp, undated refund, overpayment and point in time partial payments.
Concurrent claims, halted case and retention are covered by the PostgreSQL server suites, **not** by a
browser scenario in this change. Their browser behaviour is still outstanding and must not be described
as covered by this matrix. Frozen policy and repeats are each covered in part — see below for which part.

## Roles — the wiring is covered, the refusal is not

Authorization is enforced server-side by `requireCan` over a five-role least-privilege matrix with no
superuser, and it is well covered off-browser. What the browser adds is the thing a server test cannot
see: **that the UI actually routes each act through the identity that holds the permission.** Three
checks do that, all scoped to the governance screen's audit panel — which renders only from a
successful lifecycle read, and that read requires `AuditRead`, which the operator does not hold:

* the audit trail **loaded at all** (the precondition — without it the next two could pass on an empty
  screen);
* the trail records both `PROPOSED` and `ACTIVATED`, each beside its own actor id;
* the sentence the server's `proposedBy`/`activatedBy` comparison produces reads *"two different
  identities, which is the point."*, and *"the same identity, which the server should not have
  allowed."* is **absent**.

The last one is the strongest evidence available here: it is computed from the governance payload as the
server recorded it, so no button label can satisfy it. That matters because the assertion it replaced
was satisfied by button labels — see `EP19_NEGATIVE_CONTROLS.md` → NC-19, where suppressing the whole
audit panel left the old check green.

NC-16 → NC-18 rewire the lifecycle read, the activation and the intake submission to identities lacking
`AuditRead`, `ActivatePilotPolicy` and `SubmitPilotDataset` respectively; each makes the journey fail on
named checks. **Not proven:** an unauthorized user being refused *in the UI*. No role-forbidden act is
reachable from the screens, so observing that would need an act-as affordance this change does not add.

## Repeats — recognition and surfacing proven, the second row not observable

The identity a repeat collides with is derived from **three** inputs, not two:

```
idempotencyKey = sha256(…, boundaryId, datasetId, sha256(csvText))    validateDataset.ts:538-542
```

`datasetId` is the free-text **Dataset label** the uploader types (`UploadScreen.tsx:158`). The browser
section measures all three rather than describing them: the repeat reuses the boundary, the label **and**
the bytes, and two discriminators then show that changing either movable input produces a *different*
identity that is accepted.

**Proven in the browser**, each with a server-backed precondition:

* the first upload succeeded and the server issued an idempotency identity for it (its own receipt, not
  a key the harness derived);
* the bytes being re-sent are **byte-identical** — sha256 compared and printed, so a fixture change
  cannot silently downgrade this into "uploading a similar CSV";
* the repeat is refused **409** naming **`NH-DC-4003`**, asserted from the *response*. That code is
  emitted by duplicate detection and nothing else, which rules out frozen policy, anti-tuning, a contract
  rejection and an authorization refusal in one assertion;
* the **screen** shows the server's own sentence — `conflict` is in `apiClient`'s
  `SAFE_TO_SHOW_VERBATIM`, so the server's words are what the operator reads — with no next step offered
  and **no stale `server-verified` verdict** left beside the refusal;
* **no second governed work item.** Where the repeat is (wrongly) admitted the section follows it
  through to the governed run, because an upload alone never creates an execution and a bare count
  comparison would otherwise be true whatever happened.

**Not observable from the browser:** that no second submission **row** was written. No route exposes
submissions — the pilot routes are POST `/pilot/datasets`, the admission-policy and governance routes,
and GET/POST `/pilot/assessments` — and adding one would be a product affordance, not a test. That half
rests on `idempotency_key` being the table's **primary key**, asserted from the live schema by
`pilotIntake.test.ts` **5c**, alongside test 5's "exactly one row".

**An open question this slice surfaced and did not resolve.** The label is part of the identity and is
supplied by the uploader, so byte-identical data re-submitted under a new label is accepted and can be
assessed again. The rejection code's own wording — *"a byte-identical re-upload is recognised and
refused so the same exposure is not assessed twice"* — reads as though boundary and bytes should be
enough. Whether the derivation should include an operator-supplied field is a constitution question and
is raised as one, not patched inside a test.

**Boundaries:** duplicate submission is a different rule from duplicate rows inside a CSV, from
in-dataset cycle collision, from concurrency and from anti-tuning. These repeats are **sequential** and
prove nothing about concurrent ones.

## Frozen policy — the intake refusal is proven, the schedule-time re-check is not

A freeze must not be decorative, and the server makes sure of it in **two independent places**. Only
one of them can be reached from this UI, and the difference matters enough to state plainly:

* **Intake** (`pilotIntakeService.ts`) refuses admission while the bar is not ACTIVE. **Proven in the
  browser:** a steward freezes the bar this journey has been judging against, then a fresh synthetic
  dataset is uploaded and the screen shows the server's own sentence — *the policy is frozen by pilot
  governance and may not judge new datasets* — beside the state `frozen by governance`, marked
  `server-verified`, with no next step offered. The server's payload is checked too
  (`admissionPolicyState === "FROZEN"`), so the screen's wording and the server's answer must agree.
* **Schedule** (`pilotAssessmentService.ts`, `NH-AX-1007`) re-checks governance *now*, on a dataset
  admitted while the bar was still ACTIVE. **Not provable here.** `App.tsx` renders screens
  conditionally, so going to the governance screen to freeze **unmounts `Assessment`** and discards the
  admitted dataset; on return the same file is refused earlier, at intake. A test aimed at the
  schedule-time rule would observe the intake refusal and credit it to the wrong rule. It keeps its
  service-level coverage instead.

The freeze itself is read out of the **server's append-only audit trail**, not off the buttons — the
`FROZEN` transition attributed to the steward who made it — exactly as the two governance halves are.

**Resuming is asserted as a state round-trip only:** back to `ACTIVE`, `may judge a dataset` restored,
`UNFROZEN` recorded beside the earlier `FROZEN`. It is deliberately **not** claimed that a previously
submitted dataset would now be judged: a resume re-blesses the bar, so `activatedAt` moves and the
anti-tuning rule correctly refuses anything first seen before it. The button says *Resume*; the
transition the server records is `UNFROZEN`; both are asserted, separately.

## Tenant access — not provable in this browser path

The guard exists (`requireBoundaryAccess`) and is negative-controlled at service level with scoped
actors. It cannot be proven here: `actorFromRequest` gives every dev-header request
`boundaryIds: ["*"]`, and the wildcard satisfies the guard unconditionally — a cross-tenant browser test
would pass with the guard deleted. Proof end to end requires the OIDC resolver and a real boundary
claim. Tenant access therefore stays open on Risk #3, with that reason attached rather than as a bare
TODO, and the dev identity switch is not treated as evidence of authentication.

**A transport failure on upload is covered here too.** The intake request is aborted mid-submission and
the screen must show an error, offer no next step, and — the part worth having — **clear the previous
dataset's verdict**. The journey reaches that point holding a `server-verified` report from the last
admitted scenario, so without clearing an operator would see an error beside an apparently valid report
for a file that was never accepted. The check asserts that verdict is present *before* the failure, so
`count === 0` afterwards cannot pass vacuously if the scenario order ever changes.

The existing `e2e/smoke.mjs` remains unwired: its static preview and two row fixture predate the
server admission gate. The browser journey runs through Vite's development server with the explicit
development identities, not a production authentication flow.
