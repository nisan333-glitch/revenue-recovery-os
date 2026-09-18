# NH CSV verification — 2026-09-17

Status: bounded CSV parser fix and SYNTHETIC fixture revision verified locally. PostgreSQL integration remains unverified. This is not a production-readiness approval.

Base HEAD: 824381d67f5d2a2804059256c0265182d12f56c4. Branch: codex/agent-worker-lifecycle-v0.1. Changes are uncommitted. No push, merge, branch creation, deployment or agent enablement performed.

## What changed

The parser now rejects text after closing quotes and quotes embedded in unquoted fields before any persistence call. Valid quoted commas, doubled quotes, LF/CRLF separators and embedded newlines remain supported. No admission threshold, proof, ledger, authentication, worker or schema rules changed.

The deterministic SYNTHETIC fixture contains 100 rows: 70 admissible, 15 below the configured threshold, 5 high-value rows without an action, 5 exact/semantic duplicates and 5 independently malformed/incomplete rows. The separate 95-row subset creates 70 pending candidates; replay creates zero additional candidates. The complete mixed file must reject with zero writes. The expected-results JSON contains an individual result, reason and flags for every row, and separate batch expectations.

The test configuration uses an inclusive threshold of 10,000 minor units. It is not an FX conversion or a universal economic policy. USD, EUR, GBP, ILS and JPY boundary behavior is tested at 9,999, 10,000 and 10,001. Supplied composite identities, shared apparent account/resource labels, actual persisted candidate payloads in the in-memory store, SYNTHETIC provenance and unchanged file/buffer bytes are checked.

## Measured verification

| Gate | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| Focused CSV and fixture tests | 33 | 0 | 3 | 0 |
| All server tests: npm run test:ep2 | 111 | 0 | 86 | 0 |
| All client/domain tests: npm run test | 272 | 0 | 1 | 0 |
| Server TypeScript compilation | — | 0 | — | 0 |
| Client TypeScript and production build | — | 0 | — | 0 |
| Explicit type-check of fixture tests and generator | — | 0 | — | 0 |
| Domain purity: 20 core files | — | 0 | — | 0 |
| git diff --check | — | 0 | — | 0 |

Focused tests are included in the server total; do not add them again. Final full-suite totals: 383 passed, zero failed, 87 skipped. All skips require PostgreSQL/DATABASE_URL, unavailable in this environment. Build output is ignored by Git. An npm http-proxy configuration warning did not fail commands.

Before the parser fix, all four new malformed-quoting regression tests failed as intended: ingestion resolved with two created candidates instead of rejecting. The seven other tests in that file were excluded by the focused test-name filter. After the fix, all eleven tests in that file passed. No negative-control mutations of domain or production policy were made.

## Exact changed files relative to the base HEAD

1. README.md
2. scripts/write-synthetic-activation-fixture.ts
3. server/agents/fixtures/activation.synthetic.ts
4. server/agents/fixtures/activation.synthetic.csv
5. server/agents/fixtures/activation.synthetic.expected-results.json
6. server/agents/fixtures/activation.well-formed.synthetic.csv (new)
7. server/agents/secureCsvIngestion.ts
8. server/agents/secureCsvIngestion.test.ts
9. server/agents/activation.synthetic.test.ts (new)
10. server/agents/activation.synthetic.postgres.test.ts (new)
11. docs/CSV_SYNTHETIC_VERIFICATION_2026-09-17.md (this report, new)

## Remaining unknowns and next gate

- Run migrations and all DB-backed tests against a disposable PostgreSQL database. The three new DB tests cover persisted identity removal and replay, zero writes for the malformed batch, and accepted-review enforcement plus exactly-once promotion/authority recording under concurrent retries. None is claimed passed locally.
- The seven-column interface does not evaluate ENTITY_DEFINING_CONTEXT or sufficient=True. This fixture tests supplied identities only and does not prove the upstream discovery requirement. Do not infer entity sufficiency from absence of contradiction.
- Prevalidation guarantees no writes for a malformed input batch; it does not make multiple later database writes atomic against database failures.
- The earlier audit found caller-selected boundary IDs guarded by role without actor-to-boundary membership, and no built-in path populating the client nh_access_token. These require separate decisions and end-to-end verification before a multi-tenant or authenticated pilot is claimed ready.
- Worker entry points still register no detector handlers. Continuous agent execution is not enabled or claimed.
- The existing branch contains eleven earlier commits touching 74 files relative to 030f929, not merely the fixture commit. That earlier scope is separate from this uncommitted patch.
- SYNTHETIC tests do not establish customer behavior, ROI, precision, recall, causality, recovered revenue or production readiness.

Recommended next action: real PostgreSQL verification of this bounded patch, followed by a single supervised authenticated CSV-to-review-to-RecoveryCase flow. Do not expand the product before that gate.

## Exact skipped test inventory

The following titles are extracted from the DB-gated test sources; the per-file counts match the measured runner output.

### server/agents/postgresTaskStore.test.ts (7 skipped)

- deduplicates concurrent enqueue within a boundary but not across boundaries
- scopes claims to one boundary and gives exactly one concurrent worker the task
- renews a live lease and fences every stale-worker transition after reclaim
- dead-letters both explicit failures and crashed final attempts at the ceiling
- rejects malformed or cross-boundary CandidateSignals before changing task state
- rolls back a task transition when its durable audit insert fails
- survives store recreation and protects audit identity and append-only history

### server/auth/authz.test.ts (12 skipped)

- 1 · unauthenticated requests are rejected (401)
- 2 · authenticated but unauthorized requests are rejected (403)
- 3 · an author can perform only permitted author actions
- 4 · an author cannot approve their own case (self-approval denied)
- 5 · an approver cannot verify the same case
- 6 · a verifier cannot author or approve that same case
- 7 · a beneficiary cannot authorize a counted number
- 8 · Steward can flag/halt but cannot count
- 9 · a privileged identity cannot bypass separation of duties
- 10 · every governed action records complete authority provenance
- 11 · authorization is enforced in the service layer, not only the route
- 12 · a legitimate three-party flow (distinct author/approver/verifier) succeeds

### server/audit/auditService.test.ts (16 skipped)

- 1 · a counted proof is fully reconstructable from frozen provenance
- 2 · unverified intervention timing prevents auditable classification (a gap, never a block)
- 3 · governance can flag/halt/exclude but cannot count or approve
- 4 · duplicate recovery counting is rejected
- 5 · historical audit records cannot be updated, deleted, or truncated
- 6 · a linked correction preserves the original audit chain
- 7 · forecast and auditable ledgers cannot blend
- 8 · audit endpoints are read-only (no state mutation)
- 9 · every governed state transition produces an audit event
- 10 · no route or governance service bypasses the kernel/authority gate
- 11 · a governance exclusion removes the amount from the auditable ledger only
- 12 · a complete CFO audit export is generated from persisted data only
- A · unauthenticated audit reads are rejected (401)
- B · a beneficiary (author) is not authorized to read audit provenance (403)
- C · audit authorization is enforced in the service layer (route bypass still fails)
- D · an authorized audit read mutates no state

### server/services/caseHalt.test.ts (10 skipped)

- 1 · Approve on a halted case is rejected and writes no proof row — was 201
- 2 · Author / EstablishBaseline / Intervene / IngestEvidence are all rejected, writing nothing — were 201
- 3 · Revise on a halted case is rejected and adds no revision row — was 201
- 4 · every mutation the guard claims to cover is actually rejected (no uncovered write path)
- 5 · audit and provenance READS stay available on a halted case
- 6 · concurrent Halt vs Approve is deterministic and fail-closed
- 7 · a Halt is never retroactive — a proof approved before it is untouched
- 8 · oversight actions remain available on a halted case
- 9 · a halt is scoped to its own case and never bleeds into another
- 10 · least privilege still answers first — the halt gate does not mask a role denial

### server/services/trustGate.test.ts (19 skipped)

- 1 · C2: approval of a never-authored (unowned) case is rejected, fail-closed — was 201
- 2 · H1: concurrent revision requests cannot fork the proof chain — was 201/201, two v2 rows
- 3 · manual-only evidence at auditable-tier confidence is rejected, not silently allowed
- 5 · C1: client-supplied pinned/frozen fields are rejected before persistence — was silently accepted
- 6 · M1: an invalid recoveryReason or currency is rejected
- 7 · H2: a beneficiary (author) cannot read provenance-bearing proof endpoints — was 200
- 8 · H2: approver/verifier/steward may still read provenance-bearing proof endpoints
- 9 · a nonexistent/foreign baseline id is rejected, never invented
- 10 · a baseline locked after a KNOWN intervention is rejected — known violations block
- 11 · a baseline locked after KNOWN outcome evidence ingestion is rejected
- 12 · the CFO export excludes a gapped (Proven-but-not-Auditable) proof from the auditable ledger
- 13 · evidence role is derived server-side; a non-outcome type is never classified 'outcome'
- 14 · the same outcome source record cannot back two separate recoveries — single-use
- 15 · evidence ingested for a different case is rejected, never silently borrowed
- 16a · outcome evidence currency mismatch is rejected
- 16b · insufficient outcome evidence amount is rejected
- 17 · a favorable client-claimed observedAt cannot rescue a real ordering violation
- 18 · a superseding baseline snapshot never changes an already-approved proof
- 19 · only author/operator may establish baselines, record interventions, or ingest evidence

### server/persistence/proofStore.test.ts (5 skipped)

- persists a proof whose counted number is computed by the kernel, not the store
- writes the proof and its authority record atomically (one transaction)
- rejects direct mutation of a persisted proof (DB-level append-only)
- creates a linked revision on correction and preserves the original
- persists provenance and version fields for auditability

### server/agents/activation.synthetic.postgres.test.ts (3 skipped)

- persists 70 unique synthetic candidates with no raw source identity, including after replay
- persists nothing from the full mixed fixture
- requires an accepted review and promotes duplicate observations exactly once under concurrent retries

### server/http/api.test.ts (8 skipped)

- 1 · a valid request passes through the kernel and persists
- 2 · an invalid request is rejected before persistence
- 3 · a direct counted-number injection is rejected
- 4 · a stored proof is retrievable with complete provenance
- 5 · a correction creates a linked revision
- 6 · historical proof mutation remains rejected (no API path + DB guard)
- 7 · route handlers contain no direct Prisma write path
- 8 · the readiness endpoint accurately reports database availability

### server/audit/governedReads.test.ts (5 skipped)

- 1 · GET /cases/:caseId/baselines returns the full history, including a superseded snapshot
- 2 · GET /cases/:caseId/evidence returns every ingested record for the case
- 3 · role matrix: author/operator denied (no AuditRead), approver/verifier/steward allowed
- 4 · case-scoping: a baseline/evidence record from a different case never leaks in
- 5 · unauthenticated reads are rejected (401)

### server/app.test.ts (1 skipped)

- approves via POST /proofs and returns the kernel-computed number

### src/App.guidedDemo.test.ts (1 skipped)

- switching to the Finance Approver reveals RE-1014's real governed proof (PF-RE-1014)
