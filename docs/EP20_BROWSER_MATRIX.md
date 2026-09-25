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
Tenant access, roles, repeats, network failures, concurrent claims, frozen policy, halted case and
retention are covered by the PostgreSQL server suites, **not** by a browser scenario in this change.
Their browser behaviour is still outstanding and must not be described as covered by this matrix.

The existing `e2e/smoke.mjs` remains unwired: its static preview and two row fixture predate the
server admission gate. The browser journey runs through Vite's development server with the explicit
development identities, not a production authentication flow.
