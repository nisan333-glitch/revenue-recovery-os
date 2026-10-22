# Pilot acceptance audit V1 — what is operational, what is simulated, what is not wired

**Audited revision:** `c49ec7c` (`origin/claude/pilot-journey-v1`). **Method:** read the CI workflow, the browser
journey harness (`e2e/journey.mjs`), the import graph and the constitution; compare against the six stages of the
pilot flow. **Scope:** synthetic fixtures only. No customer data was requested, read or fabricated, and **no observed
amount in this document is Revenue Returned.**

## 0 · Evidence levels (read this before the table)

| Level | Meaning |
|---|---|
| **CI-EXECUTED** | Executed by GitHub CI on the audited revision, both events green (push run `39810405390`, pull_request run `39810412758`; five jobs each: invariants + strict build, frozen verifiers, Postgres-backed suites, browser journey, Docker smoke). I did **not** execute these myself: the authoring sandbox cannot install npm packages (registry blocked by network policy), so no official test, build or journey run was possible locally. |
| **STATIC** | Established by reading code or by `grep` over the import graph. Not executed. |
| **NOT WIRED** | Code exists but nothing on a production path calls it. |

## 1 · The six stages

| # | Stage | Verdict | Evidence |
|---|---|---|---|
| 1 | Intake and readiness | **PARTLY OPERATIONAL.** Intake + admission bar + governed analysis terms run browser → API → Postgres → worker. *Readiness of a two-file customer pair* is a local CLI only (`readiness:pair`, `pilot:emit`, `pilot:verify`): no API, no screen, nothing persisted. | CI-EXECUTED (journey §1–§11b); STATIC (readiness importers are `scripts/` only) |
| 2 | Independent expected obligations vs billed lines | **UPDATE (reconciler demo branch): a production-path adapter now exists** (`server/agents/reconciliationObserver.ts`, opt-in) but its input is still an **injected synthetic book** — see `docs/PILOT_RECONCILER_DEMO_V1.md`. *Audit finding as written, true at `af4395f`:* **NOT WIRED to the product.** The reconciliation core and both extract validators have **zero importers under `server/`**; the non-test importers are `src/contract/*` (validators/readiness), `src/benchmark/*` and `scripts/*`. Every recall/precision figure for it is a synthetic benchmark about a benchmark module. | STATIC (`grep` of the import graph) |
| 3 | Candidate | **OPERATIONAL, from a different source than stage 2.** The candidate comes from the activation detector working on an observation that the harness **injects** (`seed-journey-activation-task.ts`): NH has no screen that creates a detector task, deliberately. The at-risk amount on this path is a request **input**, not derived from any customer file. | CI-EXECUTED (journey §13) |
| 4 | Governed case | **OPERATIONAL.** Accept ≠ promote; promotion creates the authoritative root; the candidate leaves the queue and the API refuses a second case. | CI-EXECUTED (journey §13a–§13c) |
| 5 | Operator action | **PARTLY OPERATIONAL.** Review, accept and promote are real screens. Author / baseline / intervene / evidence are performed **through the governed API** by the harness; the case screen *reads* the derived stage (INTERVENED, EVIDENCED, PROVEN). There is no operator form for those steps. | CI-EXECUTED (journey §13e) |
| 6 | Proof and audit | **OPERATIONAL.** Evidence needs an Ed25519 source attestation (ephemeral per-run key, private half never reaches the API); an approver who is not the author freezes the proof; PROVEN is derived, not stored; the beneficiary's own identity is refused the provenance read (403); an id with no root is 404. | CI-EXECUTED (journey §13e–§13g) |

## 2 · Exposure versus money

* **Separation holds in code and on the screen.** `ObservedExposure` and `ProvenRevenueReturned` are branded types;
  the journey asserts the case screen shows the identified amount beside the proven amount as two numbers, with
  Revenue Returned *NOT COMPUTED* until a proof exists. A fix is not a recovery; evidence is not money. (CI-EXECUTED.)
* **What "proven" is on this path:** `Collected − Baseline` from signed evidence and a locked baseline. It is **not**
  computed from the at-risk figure, so the obligation-merge defect below is an exposure-accuracy defect and cannot
  make a proven figure wrong. (STATIC; stated by the constitution.)
* **Everything is synthetic.** A passing journey demonstrates that the *mechanism* is wired and fails closed. It does
  not demonstrate that the product finds or recovers money in a customer's book.

## 3 · What is simulated, so nobody mistakes it for a capability

1. All data, every figure, and the evidence-signing key.
2. **Authentication:** `NH_AUTH_MODE: dev-headers` — identity is asserted by request headers. Not real authentication.
3. The detector observation (injected) and its at-risk amount (a request input).
4. `CFOProofView` renders seed-backed rows (labelled DEMO · SYNTHETIC DATA); the governed case view is the real one.
5. Docker smoke checks `/health`, that the SPA root is served, that an unauthenticated `/api/*` call is a 401 and that unknown API/asset paths are JSON 404s; it does not walk the product.
6. The reconciliation benchmark (stage 2) — synthetic, and a different lane from the product.

## 4 · Obligation identity

* Candidate identity is `digest([boundaryId, recoveryType, sourceRef])` and `sourceRef` is **account-grained**. Two
  obligations of one customer are one candidate and one case. `ON CONFLICT (dedupe_key) DO NOTHING` keeps the **first**
  observation's amount; a later one's money reaches no candidate, case or figure.
* The merge is **not fixed here and cannot be without a migration**: the attribution table's primary key is
  `(executionId, sourceRef)`, so it cannot hold obligation-grained rows whatever the contract declares. Schema and
  contract migrations are outside this audit's authority; the plan is
  `docs/architecture/OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md`.
* The read-time disclosure (`caseIdentityGrain`) already refuses to let a case be read as a per-obligation claim and
  fails closed when the field is absent.
* **Defect found and fixed by this audit.** Both headlines said a case *may* represent several obligations and never
  said what the displayed **amount** includes. A reader could take the figure to include an absorbed observation.
  It does not. Both headlines now say the amount is the first observation's, that an absorbed observation is not added
  to it, and (when absorption is recorded) that the exposure may be **understated** as well as combined. Wording only:
  no identity, key, amount, contract or schema moved. Pinned by a unit test and by an assertion in the existing
  production-path test `server/services/caseGrainSafety.test.ts`.
* **Finding, not fixed:** `refusesObligationLevelGuarantee` has **no production caller** — it is a tested primitive
  waiting for a consumer, and it is correct that nothing consumes it, because no current action needs an
  obligation-level guarantee. The refusal that is actually in force is the disclosure. Wiring the predicate to a
  caller that does not exist would be building a gate with nothing behind it.

## 5 · Reproduce

* **CI (authoritative):** the `EP-19 Browser journey` job runs `npm run test:journey` against Chromium, a Fastify API,
  the worker and an ephemeral Postgres 16.
* **Locally (needs registry access):** `npm ci`, a Postgres 16 with `DATABASE_URL` set, `npx prisma migrate deploy`,
  then `npm run test:journey`; or `docker compose up --build -d --wait` for SPA + API + Postgres on
  `127.0.0.1:4000` (private pilot, dev-header auth, detector disabled by default).
* No public URL exists and none was created: public deployment is out of scope.

## 6 · Remaining work to a real pilot (ordered by dependency, not by size)

1. **Real authentication.** Dev-headers cannot front a customer.
2. **A governed entry for the observation.** Today the finding is injected; a real pilot needs a governed ingestion that
   does not let the beneficiary author the finding.
3. **Obligation-grained identity** (table first, then the optional contract field, then consumer-before-producer) —
   the only route to a case that is one obligation. Needs governance approvals; out of scope here.
4. **Wire stage 2 or stop calling it a capability.** Reconciliation has no production caller. It needs its own
   consumer shipped with it (the `obligation_ref` revert rule), and it depends on item 3.
5. **Operator surfaces for author / baseline / intervene / evidence.** Presently API-only.
6. **A verified-authority channel** for customer exports (nothing reaches `AUTHORITY_VERIFIED`).
