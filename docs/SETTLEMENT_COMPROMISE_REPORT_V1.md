# G6 · The compromise report — what did this key touch?

**Status:** built 2026-11-16, local only. No push in this slice beyond what the owner has already
authorised; no production migration; no customer data; no change to the PROVEN gate; **no observed
amount became Revenue Returned.**

---

## 1 · The question, and why the ledger could not answer it

G1 gave a key a governed life and `compromiseAssessment(events, issuedAt)` — *is a proof resting on
this attestation inside an exposure window?* G5 gave the ledger a `key_id` column whose own comment
said it was there *"so a later compromise can find every arrival that rests on it."*

Put together they still could not answer the operator's actual question — **we have just revoked this
key; what did it touch?** — because placing an arrival inside or outside a window needs the instant
the attestation was **signed**, and no column in `settlement_consumptions` held it. The row carried
`consumed_at`, which is when *NH recorded* the arrival.

That gap was not visible from either side alone. It is the shape this repository keeps meeting: a
field is stored with a stated purpose, and nothing ever exercises the purpose, so the gap between the
comment and the schema survives review.

### `consumed_at` is not a substitute, and the reason is not safety

An arrival is consumed at or after it is signed, so substituting `consumed_at` can only ever move an
arrival **into** a window and never out of one. It errs conservatively. It is still refused:

> **A conservative wrong answer is still a wrong answer, and it reads as measured.** *When did we
> record this* is a fact about NH; an exposure window is about when an institution's key was in the
> wrong hands. Those are different propositions and the second one is the question being asked.

---

## 2 · The governing rules

> **THE FOUR OUTCOMES STAY DISTINGUISHABLE.** *No compromise has been declared*, *checked and outside
> the window*, *inside the window*, and *the signing instant was never recorded* are four different
> positions. Collapsing any pair hides the only half of the answer that says what to do next — the
> same reason `RETIRED` and `REVOKED_COMPROMISED` never became one `INACTIVE`, and the same reason
> `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart.

> **AN UNPLACEABLE ARRIVAL IS COUNTED, NEVER ZEROED AND NEVER READ AS UNAFFECTED.** "Not computed is
> not zero", applied to a row. Treating a row we cannot place as outside the window is the flattering
> direction, and it is exactly the default `compromiseAssessment` already refuses for an unknown
> exposure start.

> **AN UNREVOKED KEY IS NOT A CLEAN BILL.** `NOT_APPLICABLE` means *no window exists, so nothing was
> asked*. The report says so in words, because "0 flagged" beside "0 examined" invites the opposite
> reading.

> **AN UNREACHABLE LEDGER YIELDS `null`, NEVER AN EMPTY REPORT.** A report with zero arrivals asserts
> the ledger was read and held nothing. `null` asserts it was not read. Conflating them is success
> reported having examined nothing — the one outcome the `exposure:absorbed` precedent calls worse
> than the tool not existing.

> **THE REPORT RECOMPUTES NO PROOF AND CARRIES NO MONEY.** What it produces is a **trust status
> beside** the frozen record, which is the per-row remedy the constitution already names (rule 5:
> historical proof is immutable and reproducible forever; rule 6: learning changes future decisions
> only). The consumptions table holds no amount, so the absence of money is **structural** rather than
> promised — and asserted by a test that walks the whole returned object.

---

## 3 · What was built

| Layer | File | What it does |
|---|---|---|
| Pure | `src/contract/settlementCompromiseReport.ts` | `settlementCompromiseDeclaration(events)` and `settlementCompromiseReport(keyId, events, arrivals)`. Imports only G1. No store, no clock, no route. |
| Schema | `scripts/migration-design/settlement-ledger-up.sql` | `attestation_issued_at TIMESTAMP(3) NOT NULL`, no default. |
| Store | `server/persistence/settlementLedgerStore.ts` | `claim()` records the signing instant; `consumptionsForKey()` returns `readonly ArrivalRestingOnKey[]`; `ledgerArrivalReader()` translates an absent table into a typed state. |
| Service | `server/services/settlementCompromiseRead.ts` | Three gates in order, witness status reported rather than enforced, declaration lifted out of the report. |
| Route | `GET /settlement-keys/:keyId/compromise-report` | `AuditRead`, params only, no body and no query. |

`consumptionsForKey` is typed as returning the **contract's own** `ArrivalRestingOnKey`, so the
compiler enforces the join rather than a comment claiming it.

---

## 4 · Two decisions worth the argument

### 4a · The schema was AMENDED, not ALTERed — and the premise is proved, not asserted

Adding a column to an already-pushed migration script is normally the wrong move. It was taken here
because **at the time of the change the table existed in no durable database**, and that is checked
three independent ways:

1. nothing in `prisma/migrations/` creates it;
2. this script's only consumer is a disposable per-test database that recreates it from these bytes
   on every run;
3. `PostgresSettlementLedger.claim()` has **no caller outside its own test file** (grep over import
   specifiers and call sites).

So an ALTER would have described a migration that never happens while leaving the one real artefact —
the CREATE — permanently incomplete. The same line the billing-extract rename drew: *a frozen record
of DATA is evidence; a schema design nobody has applied is **machinery***. **The moment any durable
database holds this table, that licence ends and the correct form is an ALTER.** The premise is
recorded inside the SQL file, not only here.

`NOT NULL` with no default follows from the same fact, and it is `seq`'s own stated ground in the same
file: *there are no pre-existing rows whose value would have to be fabricated by a backfill*. A
default would stamp an invented signing instant onto every row that lacked one — the `BIGSERIAL` trap
the execution-event log already met.

**And the nullable branch is built and tested anyway.** A `NOT NULL` column protects rows *this build*
writes; it says nothing about a row an older server, a restored dump or a future nullable migration
hands back. Reading that silence as "nothing to warn about" is how a deploy skew deletes a warning —
the finding the obligation-merge slice recorded. So the store's `?? null` is exercised by **dropping
the constraint in a disposable database and inserting a NULL row**, which is the same method the
`seq` backfill was verified by: *simulating the upgrade is the only honest test of the legacy path*.
Without it the branch would be unreachable and no mutation could falsify it.

### 4b · The read does NOT require the witness to match

`resolveForUse` refuses a key whose stored values no longer hash to their stored witness, correctly,
because such a row **must judge nothing**. This read does not judge — it enumerates what a key
already signed. Refusing here would blind an investigator to the exposure of the very key they have
just found tampered with, at the moment the question matters most.

So the row is resolved without that gate and `recordIntegrity` reports `WITNESS_VERIFIED` or
`WITNESS_MISMATCH` **beside** the answer. A test asserts the two reads differ in exactly that field
and that the report itself is **identical**, because the arrivals live in a different, independently
append-only table that a key-record failure says nothing about.

`resolveForGovernance` was exported for this rather than aliased: *a second name for one function is
a second thing that can drift from it.*

---

## 5 · The gates, and why their order is asserted

1. **`AuditRead` first, before the register is touched.** A test counts register reads and requires
   **0** on an unauthorized call: if the register were consulted first, the difference between a 404
   and a 403 would answer *does this key exist* for someone entitled to neither answer.
2. **404 on an unknown key.**
3. **Boundary access against the KEY'S OWN boundary**, which no request parameter can name.

The beneficiary consequence is stated rather than hidden, exactly as on the Recovery Case read: an
`author`/`operator` does not hold `AuditRead`, so the party whose claim an arrival substantiates
cannot pull this report for themselves. Widening that is a governance decision with an owner.

---

## 6 · The route is live against a database that has no ledger — on purpose

The consumptions table is deliberately **not** in `prisma/migrations/`, because a file there is
applied by every deploy and committing it **would be** the production schema change. So a healthy
deployment holds the key register and no ledger at all.

A route that answered that state with a 500 naming a Postgres relation would be a crash where the
honest answer is *we could not look*. A route that answered it with an empty report would be worse.
So `ArrivalEnumeration` puts the absence **in the type**:

```ts
type ArrivalEnumeration =
  | { available: true;  arrivals: readonly ArrivalRestingOnKey[] }
  | { available: false; reason: "ledger_not_provisioned"; detail: string };
```

and `ledgerArrivalReader` **classifies on failure, never before it**: the happy path is one query;
only when it fails does the adapter ask the catalogue whether the table exists. Probing first would
be a read-then-check whose answer could be stale; assuming "not provisioned" from any failure would
swallow a genuine outage as a tidy state. **A failure with the table present is re-thrown unchanged.**

Exercised end to end through the real app in `settlementKeyRoutes.postgres.test.ts`: first against the
register-only database (**200, `report: null`, `arrivalsUnavailable.reason`, declaration intact**),
then again after the ledger SQL is applied to that same database (**2 arrivals, 1 unaffected, 1
flagged, coverage COMPLETE**). The second test is last in the file on purpose, because it provisions
the shared database and anything after it would no longer be exercising the register-only state.

---

## 7 · Mutation proofs — 16/16 caught

| # | Mutation | Caught by |
|---|---|---|
| 1 | a missing signing instant reads as `UNAFFECTED` | pure + service |
| 2 | `consumedAt` substituted for a missing signing instant | pure + service |
| 3 | coverage always `COMPLETE` once a window exists | pure + service + routes |
| 4 | an unrevoked key reported as "no compromise was found" | pure + routes |
| 5 | findings re-sorted by timestamp | pure |
| 6 | the zero-arrival sentence dropped | pure |
| 7 | a monetary field added to the report | pure |
| 8 | service uses `resolveForUse` (refuses the incident read) | service |
| 9 | register consulted before `AuditRead` | service |
| 10 | boundary check removed | service |
| 11 | an unreachable ledger becomes a zero-arrival report | service + routes |
| 12 | any failure classified as "not provisioned" | ledger (Postgres) |
| 13 | store fills a missing instant from `consumedAt` | ledger (Postgres) |
| 14 | store reads `consumed_at` as the signing instant | ledger (Postgres) |
| 15 | the column drops `NOT NULL` | ledger (Postgres) |
| 16 | an unparseable instant stops failing closed | pure |

All four source files are byte-identical afterwards.

### The harness defect, found in my own instrument

The first pass reported **M5, M6, M7 and M16 as SURVIVED**. They had not survived: the runner invoked
them under `vitest.ep2.config.ts`, whose include is `server/**/*.test.ts`, so the pure test file was
**never collected** and the run printed *"No test files found"*. A grep for `failed` found none and
the harness called that a survivor.

> **A mutation run that collects no test is not a surviving mutation, it is a broken measurement** —
> and the two look identical in a one-line summary. The re-run adds an explicit `No test files`
> branch and a **control (M0) that asserts the unmutated file is collected and passes**, before any
> result from that runner is believed.

Sixteenth-and-counting instance of the same family: *a test that cannot fail is not a control*, this
time applied to the thing measuring the tests.

---

## 8 · Regression

Run locally, each on a freshly migrated isolated database:

| Suite | Result |
|---|---|
| `npm run test` (with DB) | **2027 passed, 5 skipped (2032)**, 134 files |
| `npm run test` (no DB) | 2023 passed, 9 skipped (2032) |
| `npm run test:ep2` | **1242 passed, 6 skipped (1248)**, 103 files |
| `npm run test:journey` | **200/200** |
| `npm run pilot:verify` | 242/242 |
| `npm run readiness:control` | 25/25 |
| `recon:verify`, `recon:ref:verify`, `verify:evidence`, `verify:registers` | all exit 0 |
| `tsc` server + root + scripts, `check:purity` (32 core files), `npm run build` | clean |

New tests: 18 pure, 14 service, 8 Postgres store/reader, 5 route — **45**.

Two apparent failures during the run were **my harness, not the product**, and both are the recorded
lesson rather than new ones: a root-suite failure in `App.guidedDemo.test.ts` because I pointed
`DATABASE_URL` at the dirty `postgres` admin database (*a test that has only run against a dirty
database is not a guard against a clean one* — here the guard worked and I had made the mess), and
two ep2 failures where the safety check refused my database name `nh_g6_ep2` for not containing
`test`, `synthetic` or `pilot` as a distinct token. Both cleared on correctly provisioned databases.

---

## 9 · Reported, not fixed

**No server test is typechecked by anything, and this slice demonstrated it live.** Making
`attestationIssuedAt` required broke **six** record literals in
`settlementLedger.postgres.test.ts` — every one of which `tsc` would have named instantly. It did not,
because `tsconfig.server.json` excludes `server/**/*.test.ts`, so the errors surfaced as six runtime
`PrismaClientKnownRequestError`s instead. This is the exact finding the obligation-merge slice
recorded (*a type nobody checks is not a guard*), and it is still a module-setting decision with an
owner: including the test files yields ~35 pre-existing errors across 19 files, mostly `import.meta`
under CommonJS.

---

## 10 · What this does NOT do

* **`claim()` still has no production caller.** The ledger records a signing instant that nothing in
  production writes yet, because nothing in production claims an arrival yet. G6 makes the question
  **answerable**; it does not make it **asked**.
* **No production migration.** The table and its new column live in `scripts/migration-design/`.
  Applying them is the owner's decision.
* **The PROVEN gate is untouched.** A flagged arrival raises a question about evidence. It reverses no
  proof, recomputes nothing, and reduces no Revenue Returned figure by one cent. That sentence is on
  the payload, not only in this document.
* **No institution is verified — not one.** The four ceremony booleans remain attestations by our own
  operator, and `AUTHORITY_VERIFIED` remains unreachable. A compromise report over keys whose
  institutional identity was never independently established is a report about our own records.
* Everything measured here is synthetic, and **no observed amount became Revenue Returned.**
