# The first real money proof · what is closed, what blocks, and the shortest path

**Date:** 2026-11-25 · **Commit:** `ac041ef` · **Branch:** `claude/pilot-reconciler-demo-v1`
**Status:** every figure in this document is **synthetic**. **No observed amount became Revenue
Returned**, and nothing here changes that.

This is not a roadmap. It records what was **executed** against this commit, which previous claims the
execution **corrected**, and what remains — with the party who owns each remaining item. Where a claim
is historical rather than re-measured, it says so.

---

## 1 · The baseline was verified, not accepted

The two figures carried forward from earlier sessions were re-run on this commit today rather than
quoted:

| claim | how it was checked | result |
|---|---|---|
| **50/50 synthetic checks** | `npm run test:journey` on a freshly migrated isolated database | **confirmed** — `Synthetic Demo Console · operator journey (journey section 14) · 50/50 checks passed` |
| **$500 synthetic recovery** | the same run | **confirmed** — `the scenario's arithmetic: $600.00 collected − $100.00 baseline = $500.00 returned`, reason `BillingCorrection`, labelled SYNTHETIC |
| the whole arc | the same run | **200/200 recorded checks passed**, `JOURNEY PASSED` |

**The $500 is a real execution of the real path and it is not production-shaped.** The journey boots the
API with `NODE_ENV` unset, so identity is `dev-headers`, the transport guard does not apply and the
database TLS guard does not apply. It proves the **gates**; it does not prove a production deployment.
Those are two different claims and §3 below keeps them apart.

**CI artefact 14882669841** is `synthetic-demo-evidence-ac041ef1a60dbd886d3e5e84448551683bb7d271.zip`,
confirmed through the Actions API as belonging to run #354 at **exactly this commit**. Its bytes were
**not** downloaded: the artifact blob host is outside this session's egress policy. That is stated as a
limit rather than worked around, because the same evidence was reproduced locally at the same SHA and
widening the network for a file already reproduced would be access taken for no need.

---

## 2 · One recovery reason can reach a proof, and it is not a preference

`src/domain/correctionMapping.ts:61` declares eight recovery reasons. **Seven carry
`permitted: []`** — no source-attested correction channel exists for them — and all three mapping
refusals block approval, on both the governed HTTP route and the pure approval path. So:

> **`BillingCorrection` over `RevenueUnderBilled` is the only route to PROVEN that exists.** It is not
> the fastest of several; the other seven are refused `CORRECTION_CHANNEL_NOT_DECLARED` by
> construction.

`RevenueUnderBilled` is a `LeakageType` (`src/domain/types.ts:33`) added through the sanctioned
extension path, and `src/domain/reasons.ts:90` scopes `BillingCorrection` to it alone. The owner's
instinct was right, and the reason it is right is stronger than a comparison: there is nothing to
compare it with.

### What the gate actually requires, read from the code that enforces it

| leg | requirement | where |
|---|---|---|
| A | the case's identity covers **exactly one** reconciliation unit; facts complete and consistent; no absorbed observation; the at-risk figure agrees with the coverage | `src/domain/provenEligibility.ts` |
| — | author ≠ approver, and the baseline was locked before any outcome existed | `enforceSeparation`, `baselineTemporallyValid` |
| G2 | outcome evidence, **source-verified and not beneficiary-controlled**, at least one independent, totalling **at least** the amount claimed collected — at **every** confidence tier | `proofService.ts:331`, `src/domain/outcomeEvidence.ts` |
| G1 | a **correction-role** evidence record, source-verified, ingested **strictly before** the earliest outcome record | `proofService.ts:382`, `src/domain/executedCorrection.ts` |
| map | the correction's type must be one the claimed reason's channel permits | `correctionMapping` |

`trustClassification: "independent"` is assigned **only** where an Ed25519 signature verified against a
key in `NH_EVIDENCE_SOURCE_KEYS`. So the external dependency is exact and small: **the customer's
billing system must sign two statements** — that the corrective charge was raised, and that the money
was collected — under a key whose public half NH holds. That is `docs/X1_SIGNATURE_SPECIFICATION_V1.md`,
and nothing in it is negotiable by a request parameter.

---

## 3 · There are two proof paths, and choosing between them is the whole decision

| | **Path 1 · billing-attested** | **Path 2 · bank-attested settlement** |
|---|---|---|
| what signs the money | the customer's **billing system of record** (S2) | a **bank or PSP**, cited as an external settlement arrival |
| configuration | Tiers A + B + C | **plus** Tier D (3 variables, §4) |
| schema | **none** — every table exists in `prisma/migrations/` | **three unapplied migrations** in `scripts/migration-design/` |
| counterparties | the customer's billing/ERP owner | **plus** the bank's technical owner, **plus** an institution admission ceremony (K5, six out-of-band citations) |
| blocked by | nothing outside the customer's own export and signer | **B1** — billing and the bank must quote the *same payer identifier*, likelihood of failure recorded as **high**; **B2** — no provenance channel reaching `AUTHORITY_VERIFIED` is implemented |
| honest verdict ceiling | `SOURCE_ATTESTED` · **PROVISIONAL** | would eventually justify `AUTHORITY_VERIFIED`, and does not today |
| already executed end to end | **yes** — the $500 arc | yes against isolated databases only |

**Primary: Path 1.** It is the only path whose every remaining prerequisite is held by one party we can
actually ask, and it is the path the executed arc already traverses. Its result is a genuine,
auditable sentence — *this amount was under-billed, a corrective charge was raised, this amount was
collected, and the system of record signed both statements* — and its honest label is
**`BEHAVIOUR_CONFIRMED · PROVISIONAL`**, never `VERIFIED`.

**What Path 1 does not establish, said plainly:** the customer's billing system is not economically
independent of the customer. A verified signature establishes that a key in NH's registry signed the
payload and **nothing about who holds that key** — `SourceReceipt` and `SourceTrustKey` carry no
holder, no provenance channel and no issuing system. Independence of the *party* is Path 2's job.

**Fallback, and it costs nothing.** The fallback is not a different mechanism — there is no second
mechanism. It is a **second obligation from the same pair of files**: the executed arc produces
**three** under-billed candidates ($600.00, $1,000.00, $1,500.00) and promotes **one**. If the chosen
case cannot complete — the corrective charge is disputed, or the money is not collected in the pilot
window — the next candidate is already in the queue with zero additional integration, zero additional
configuration and zero additional customer effort. A pilot that depends on one obligation succeeding is
a pilot with no fallback at all.

---

## 4 · The configuration chain, measured by booting it

`docs/PILOT_BLOCKER_MAP_V1.md` C1 lists eighteen variables. That list was assembled by **reading**, and
this repository has already recorded what that produces — the count went 3 → 5 → 18 by exactly that
route, and *a list assembled by reading the code path you expected is a list of the variables you
expected.* So `scripts/pilot-config/verify-config-chain.mjs` does not read. It starts the real process
entrypoint once per case, with one variable removed or corrupted, and records what happened.

**It measures two postures, because the pilot has to pick one and they do not require the same things:**
`PRIVATE` (the supervised `dev-headers` + `NH_PRIVATE_PILOT=true` shape `transportGuard.ts` admits
without TLS termination) and `OIDC` (the full public shape).

**Two instruments, because one was not enough and the first run proved it.**
`scripts/pilot-config/verify-config-chain.mjs` boots the entrypoint — the right instrument for a
variable read at startup. `scripts/pilot-config/resolve-point-of-use.ts` calls the production resolver
the deployment depends on — the right instrument for a variable read at the point of use.

```
$ node scripts/pilot-config/verify-config-chain.mjs
OUTCOMES · LISTENING=2 · NO_OBSERVED_EFFECT=23 · STARTUP_REFUSED=31 · NOT_IN_THIS_SHAPE=10
```

### 4.1 · What refuses at startup · 31 of 64 cases, both postures

Every Tier A variable but one refuses, and the messages are the product's own:

| variable | mutation | observed |
|---|---|---|
| `NH_AGENTS_ENABLED` | `yes` | `must be exactly 'true' or 'false'` |
| `NH_AGENT_BOUNDARIES` | drop | `is required when agents are enabled` |
| `NH_RECONCILIATION_OBSERVER_ENABLED` | drop | `agents are enabled but no production agent handlers are registered` |
| `NH_RECONCILIATION_OBSERVER_ENABLED` | `1` | `must be true or false` |
| `NH_RECONCILER_PSEUDONYM_KEY` | drop / 9 chars | `must be at least 32 characters` |
| `NH_AGENT_ADMISSION_POLICIES` | drop | `…no candidate admission policies are configured for the candidate-publishing agents (reconciliation-observation-v1)` |
| `NH_AGENT_ADMISSION_POLICIES` | `RevenueUnderBilled` | `must use RecoveryType:threshold entries` |
| `DATABASE_URL` | drop | `is required in production` |
| `NH_AUTH_MODE` | `bogus` | `must be 'oidc' or 'dev-headers'` |
| `NH_TLS_TERMINATION` | `direct` | `must be 'proxy' or 'none'` |
| `NH_TLS_TERMINATION` | drop *(OIDC)* | `production requires TLS termination: set NH_TLS_TERMINATION=proxy` |
| `NH_PRIVATE_PILOT` | drop *(PRIVATE)* | `dev-header identity is forbidden in production` |
| `NH_OIDC_ISSUER` · `NH_OIDC_AUDIENCE` · `NH_OIDC_JWKS_URI` | drop *(OIDC)* | `is required for OIDC authentication` |

**The plan said seven negative controls. There are thirty-one, across the two postures, and the extra
twenty-four are not padding** — each is a distinct value a real operator could type. The seven were a
subset chosen by reading; these were found by running.

### 4.2 · The nineteenth requirement is not a variable at all

`DATABASE_URL`'s **value** must itself require verified TLS. Measured in both directions:

| posture | `DATABASE_URL` | observed |
|---|---|---|
| OIDC | plain, loopback host | **refused** — `production PostgreSQL transport must require verified TLS` |
| OIDC | plain, `db.example.com` | **refused** — same |
| PRIVATE | plain, loopback host | **accepted** — listened, `/health` 200 |
| PRIVATE | plain, `db.example.com` | **refused** — same message |

So `NH_PRIVATE_PILOT=true` relaxes **two** guards, not one: HTTP TLS termination *and* database TLS —
and the second **only** for a private or loopback database host (`databaseConfig.ts:55`,
`plainAllowed = isPrivatePilot(env) && isPrivateDatabaseHost(url.hostname)`). That conjunction is
correct and it is the thing to check before anyone calls the private pilot "the easy mode": it is not a
blanket exemption, and a publicly routable database is refused in both postures.

> **A required configuration fact can be a property of a value rather than the presence of a variable,
> and no variable COUNT can express it.** The first run of this harness used one `DATABASE_URL` for
> both postures and the entire OIDC shape failed its control for this reason.

### 4.3 · The one Tier A variable that fails SILENTLY

| variable | mutation | observed |
|---|---|---|
| `NH_AGENTS_ENABLED` | **drop** | listened, `/health` 200 — **no startup refusal in either posture** |

Four of the five Tier A variables refuse at startup. The **master switch** does not: drop it and the
service comes up healthy with the entire detection runtime absent. A deployment that forgets the one
variable that turns detection on gets a green service that finds nothing, and nothing says so.
Reported, not patched — defaulting it to `true` would turn detection on in every environment that
merely has a database.

### 4.4 · Tiers C and D are invisible until the first proof attempt

Neither the evidence trust registry nor any settlement variable produces a startup refusal in either
posture. They are **fail-closed at the point of use**, which is right, and measured there:

| tier | variable | mutation | observed at the point of use |
|---|---|---|---|
| C | `NH_EVIDENCE_SOURCE_KEYS` | `[]` | **resolves with 0 keys** · no attestation can verify · evidence stays `beneficiary_controlled` · **G1 and G2 both refuse** |
| C | `NH_EVIDENCE_SOURCE_KEYS` | drop | throws `Unexpected end of JSON input` — fail-closed, and the **diagnostic names nothing**; compare Tier D's, which explains itself. Reported, not patched |
| D | `NH_SETTLEMENT_DIGEST_KEY` | drop / `short` | `must be a deployment secret of at least 32 characters; an unkeyed settlement digest confirms guessed payment references and is refused` |

> **The deployment-order consequence, which is the operational point:** a pilot can be fully
> configured, fully green and fully up with **no evidence key at all**, and discover it at the moment
> the first real proof is attempted. So registering the key is not a step to do "when we get to the
> proof" — it is a step whose omission the whole stack cannot report until then.

### 4.5 · The eight OIDC variables are six

Measured through `readPublicAuthConfig` — the function `GET /auth/config` calls:

| variable | dropped |
|---|---|
| `NH_OIDC_ISSUER` · `AUDIENCE` · `JWKS_URI` | refuse **at startup** |
| `NH_OIDC_CLIENT_ID` · `AUTHORIZATION_ENDPOINT` · `TOKEN_ENDPOINT` | start, then `NOT CONFIGURED · missing=[…]` — browser sign-in unavailable |
| `NH_OIDC_TOKEN_USE` · `NH_OIDC_SCOPES` | **`configured: true`** — both carry defaults (`access_token`, `openid`) and are **not required** |

`docs/PILOT_BLOCKER_MAP_V1.md` C1 says all eight are "each named individually in `missing`". **Six
are.** The last two are named only when set to an *invalid* value, which is a different claim.

### 4.6 · So the count is posture-dependent, and "18" merged two answers

| | Tier A | Tier B | Tier C | **required total** | Tier D (Path 2) |
|---|---|---|---|---|---|
| **PRIVATE** (`dev-headers` + `NH_PRIVATE_PILOT`) | 5 | 4 — `DATABASE_URL`, `NODE_ENV`, `NH_AUTH_MODE`, `NH_PRIVATE_PILOT` | 1 | **10** | +3 |
| **OIDC** (full public) | 5 | 10 — the above minus `NH_PRIVATE_PILOT`, plus `NH_TLS_TERMINATION` and the six real `NH_OIDC_*` | 1 | **16** | +3 |

Plus, in both, the **value** requirement on `DATABASE_URL` (§4.2), which is not a variable.

**"Eighteen" was not wrong so much as answering a question that has no single answer**, because it
merged the two postures and counted eight OIDC variables where six are required. The lesson is the one
already on record, one turn further out: *a list assembled by reading is a list of what you expected* —
and a **count** assembled without naming the posture is a count of a configuration nobody will deploy.

### 4.7 · A defect in my own instrument, and it is the recurring family

The first OIDC run reported five `NH_OIDC_*` drops as `NO_OBSERVED_EFFECT` with `/auth/config`
"identical to the control". It was identical. The control's own body — printed only after the first run,
rather than trusted — read:

```
/auth/config {"error":"forbidden","message":"HTTPS is required."}
```

`NH_TLS_TERMINATION=proxy` makes the app refuse every plain-HTTP request, so the probe never reached
`readPublicAuthConfig` and was comparing two identical 403s.

> **A probe the subject refuses is not a measurement.** Same family as *a guard that cannot fire is no
> guard* and *a test that cannot fail is not a control* — and it was found only because the control's
> own output was printed instead of assumed. The fix was not to weaken the posture to let the probe in;
> it was a second instrument that calls the resolver directly.

A second, smaller one: the first form of the diagnostic picker matched `/throw|must|error/i` and
returned the literal source text `throw new Error(` — *the place the throw is written, not what it
says*. Two rows read that way, and one of them was the OIDC control, so the single case the whole shape
depended on reported nothing at all.


---

## 5 · The financial proof protocol · seven states, and the seventh does not exist

The seven states the mandate requires kept apart, each mapped to what actually represents it:

| # | state | representation | kept apart by |
|---|---|---|---|
| 1 | **potential revenue** | Revenue **Opportunity** ledger — forecast, never counted as money | `src/domain/outcomes.ts:18` |
| 2 | **identified recoverable revenue** | `ObservedExposure`, a **branded** type the compiler refuses to interchange | `src/domain/caseLifecycle.ts:47` |
| 3 | **approved correction** | the review acceptance and the `Intervene` authority event — *a fix is not a recovery* | the append-only authority ledger |
| 4 | **invoiced amount** | the **S1** attestation: the billing system's own statement that the corrective charge was raised | `evidenceRole: "correction"`, G1 |
| 5 | **actual collected money** | the **S2** attestation, and the claim may not exceed what the signed records total | G2 · `OUTCOME_EVIDENCE_INSUFFICIENT` |
| 6 | **net attributable recovery** | `ProvenRevenueReturned` = `Collected − Baseline`; **Auditable** is its confidence-gated subset | `caseLifecycle.ts:50`, `invariants.ts` |
| 7 | **REVENIQ commercial revenue** | **nothing. It exists nowhere in the codebase.** | — |

**State 7's absence is correct and must stay deliberate.** A search of `src/` and `server/` for any
success fee, commission, platform fee or customer-facing price returns nothing. That is the right
architecture — a product that could derive its own fee from a proof would have an interest in the
number — so the rule is: **REVENIQ's commercial revenue is a term of a commercial contract and is never
computed from, stored beside, or displayed with a proof.** It is the seventh state precisely so that
nobody later adds it as a column on the sixth.

**And the three sentences the mandate asks for are already enforced rather than promised:**

* *A signed document alone is not proof of money.* The arc reaches `EVIDENCED` with one signed
  correction and **zero** outcome records, and Revenue Returned reads **NOT COMPUTED** — never `$0.00`.
* *A corrected invoice alone is not proof of collection.* That is G1 versus G2: they are two separate
  refusals with two separate codes, and G1 passing leaves G2 to refuse.
* *A synthetic transaction is never real revenue.* Every figure here is synthetic and the journey says
  so on the screen before it says anything else.

---

## 6 · Is there a real authorized business case?

**No. `CUSTOMER_REQUIRED`.**

No customer, contact, counterparty, DPA or financial record is named anywhere in this repository, and
none was invented for this document. `docs/PILOT_OUTREACH_DRAFT_V1.md` is **unsent and has no
recipient**. The customer-facing package in `docs/pilot-intake/` is generated from the governed field
specifications and is ready to be handed over; nothing has been handed to anyone.

This is the one blocker no amount of engineering closes, and it was not possible to close it here: §7
of the mandate forbids customer communication without the owner's approval, and inventing a
counterparty would be the exact failure the whole trust architecture exists to prevent.

---

## 7 · What remains, with the owner of each

| # | remaining item | owner | why it cannot be closed here |
|---|---|---|---|
| 1 | **A real customer** with an under-billed obligation, the two exports, and permission | **the owner** | no contact exists; outreach is unsent and unapproved |
| 2 | **The billing system signs S1 and S2** under a registered key | the customer's billing/ERP technical owner | the key's private half must never reach NH |
| 3 | **`NH_EVIDENCE_SOURCE_KEYS` holds that key's public half** | the owner | registering a real key is a production configuration change |
| 4 | **Tier A + B configuration applied to a real environment** | the owner | §7 forbids production configuration changes |
| 5 | **A second governance identity at NH** | the owner | author ≠ approver is structural; one person cannot run this pilot |
| 6 | Path 2 only · the three migrations, the digest key, B1's shared payer identifier, B2/K5 | the owner, the bank, the customer's finance owner | `docs/PILOT_PRODUCTION_REQUIREMENTS_V1.md` §1–§2 |

**Nothing in rows 1–6 is code.** That is the finding of this document, and it is the same finding the
blocker map reached from the other direction: *development complete is not the same claim as running.*

---

## 8 · The fourteen named properties, each against something that ran

Executed today on this commit, on freshly migrated isolated databases. Where a property rests on the
server suite rather than on a run of mine, the row says so — **a green CI job at this SHA is evidence
about this SHA and is not a run I performed**, and conflating the two is how a report stops being
checkable.

| # | property | evidence | source |
|---|---|---|---|
| 1 | **authentication** | `unauthenticated whoami is 401`; `forged x-actor-* headers are 401 under OIDC`; `forged approver headers without a token are 401, not 403 and not data`; full S256 PKCE with state and nonce, one token request, no client secret; replayed callback refused **before** any token request | `test:auth-journey` · **37/37** |
| 2 | **authorization** | `an OPERATOR is refused 403 — the beneficiary does not read the ledger`; `an AUTHOR is refused 403`; `an operator token is refused 403 on an oversight (AuditRead) surface`; `a valid operator token plus x-actor-role: steward is still an operator` | `test:auth-journey`, `test:ledger-journey` · **25/25** |
| 3 | **tenant isolation** | `token with a wildcard boundary` → the session is **not accepted**, the app never renders and no token is stored; a blank boundary cannot be read | `test:auth-journey` |
| — | *boundary data scoping* beyond admission | `requireBoundaryAccess` on every governed route | **server suite, CI #354 at `ac041ef` — not re-run by me today** |
| 4 | **evidence authenticity** | `evidence whose amount was altered after it was signed is refused at ingestion` → 403 `source attestation is invalid or expired` | `test:journey` · **200/200** |
| 5 | **financial source verification** | the settlement is **one signed, independent** outcome record, `sourceVerification.method = ed25519-v1`, for exactly the identified exposure | `test:journey` |
| 6 | **duplicate prevention** | `the synthetic billing source attests the correction at most once`; `the synthetic payer settles a case at most once` → **409**; promoting a second candidate creates nothing | `test:journey` |
| 7 | **idempotency** | the same 409s on replay, and the pair-intake fingerprint `PAIR-<sha256>` makes a re-submitted identical pair the same task | `test:journey`, `pilotPairIntake.postgres.test.ts` (CI #354) |
| 8 | **baseline subtraction** | `$600.00 collected − $100.00 baseline = $500.00 returned`, and the frozen proof records `{"r":"BillingCorrection","c":60000,"b":10000}` | `test:journey` |
| 9 | **settlement attribution** | G1 · `the signed correction was recorded BEFORE the signed collection` — `fix=…:56.041Z money=…:57.647Z` | `test:journey` |
| 10 | **correction ledger integrity** | upward and downward are **two figures and never a difference**; `-$200.00` appears nowhere; a tied identity renders `Refused — observation order not establishable` and is excluded from both figures | `test:ledger-journey` |
| 11 | **audit trail** | the case's governed record agrees with the frozen proof and keeps exposure and proven as `{"p":50000,"e":60000}`; the independent Recovery Case screen reads the same case | `test:journey` |
| 12 | **rollback / failure recovery** | after **every** refusal `the case still holds NO proven figure` and the screen `still reads NOT COMPUTED, not PROVEN, not $0.00`; the governance-sequence rollback script states its own cost | `test:journey`, `scripts/migration-design/` |
| 13 | **K5 institution admission** | **NOT satisfied, and not satisfiable here.** Six of its eight conditions need evidence from outside this system, and no provenance channel reaching `AUTHORITY_VERIFIED` is implemented | `docs/K5_INSTITUTION_ADMISSION_V1.md` |
| 14 | **independent financial evidence verification** | **partially satisfied.** A signature verifies; `SourceReceipt` and `SourceTrustKey` carry **no holder, no provenance channel and no issuing system**, so an NH-generated key and a customer's key are indistinguishable once verification succeeds. Independence of the **party** is Path 2 | `src/domain/financialTrace.ts`, measured not asserted |

**Over-claim refusal, which is worth its own line because it is the control a CFO will ask about
first:** `claiming more collected than the signed evidence substantiates is refused` → 403
`OUTCOME_EVIDENCE_INSUFFICIENT: outcome evidence totals 60000…`. The claim cannot exceed the signatures.

**Executed today:** 200/200 journey · 25/25 ledger journey · 37/37 auth journey · 64 configuration
cases across two postures · 16 point-of-use resolutions. **Nothing was weakened to obtain any of it**,
and the two defects found were both in my own instruments (§4.7).

---

## 9 · The two new tools, and why they are not in CI

```bash
npm run pilot:config       # 64 boots of the real entrypoint, two postures, one variable moved per case
npm run pilot:config:use   # 16 point-of-use resolutions through the production resolvers
```

Both are **read-only, local and synthetic**: generated keys discarded with the process, an isolated
database whose name must carry `test`/`synthetic`/`pilot`, a loopback port, and a refusal if the
database name does not qualify. `pilot:config` passes a **clean environment** rather than
`...process.env`, because inheriting the shell would let a variable the harness believes it removed
arrive anyway and the run would report a refusal it never tested.

**They are deliberately NOT added to the CI workflow**, and the reason is stated rather than left to be
discovered: `pilot:config` spawns sixty-four servers and takes minutes, and this repository has already
recorded the opposite error — four verifiers sat outside the gate for weeks and *a test CI never runs
is not a guard*. So the honest position is both facts at once: **these two are hand-run instruments,
their results are recorded here with the commit they were run against, and nothing re-checks them
automatically.** The typecheck is closed, though — `scripts/pilot-config/**/*.ts` is now in
`tsconfig.scripts.json`, because *a type nobody checks is not a guard* either, and a new scripts
directory is exactly where that gap opens.
