# Proof-bypass closure — Option 1, the fail-closed correction across the application

**Date:** 2026-11-10 · **Owner-approved (Option 1)** · **Local development, tests and local commits only**
**Local commits:** `3994d7e`, `4c901c3` (+ this record)
**Status:** built and verified on isolated synthetic databases. **No push, no deploy, no production
migration, no customer data.** No observed amount became Revenue Returned.

---

## 1 · What was wrong, measured

The D3 correction-channel gate the owner approved on 2026-11-10 protected the governed HTTP route and
nothing else.

| Fact | Evidence |
|---|---|
| `correctionMapping` + `mappingBlocksApproval` had **one** production consumer | `server/services/proofService.ts:31` |
| `reasonScopeViolation` had **one** production consumer | the same file, line 26 |
| The pure domain could not consult either gate | `grep -n recoveryType src/domain/{types,approval,invariants}.ts` → **zero** matches |
| `RevenueUnderBilled` was not a `LeakageType` at all | it existed only as a server-side string and as `BillingCorrection`'s declared scope |
| The running app minted proofs through the ungated kernel | `src/state/RecoveryContext.tsx:613` calls `approveProofForCase` directly, not `/proofs` |
| 7 of 7 seed proofs used channel-less mechanisms | **$83,400.00 proven, $79,800.00 auditable, $0.00 that would survive D3** |
| The Guided Demo screen carried no DEMO banner | `src/App.tsx` and `src/components/EventDetail.tsx` use `useRecovery()` and rendered zero `<DemoDataBanner`; the labelling guard scanned `src/modules/` only |

So the same claim got two answers depending on which door it came through, and the demo's front door
stated *"RE-1014's proven Revenue Returned $10,600"* unqualified while the governed route a few files
away refused exactly that claim.

**Correction to the first report of this.** It said *"the demo and CFO screens"* present these as
proven. That is right for `src/App.tsx` and **wrong for `CFOProofView`**, which does render the banner
and does deny proven Revenue Returned (`CFOProofView.tsx:110`). It was overstated by one screen.

## 2 · The rules this establishes

> **A gate that protects one door protects nothing.** A proof-minting path is any path that can freeze
> a `Proof`, and the question "which paths are those" is answered by the compiler, not by a reading.
> `recoveryType` is **required** on `CaseApprovalContext` rather than optional, because an optional
> field lets an existing caller keep its old behaviour by saying nothing — which is how the bypass
> arose. `tsc` then named exactly four sites, two of them tests.

> **One implementation, not two agreeing implementations.** A finite agreement is necessary evidence of
> equivalence and never a proof of it — the rule this repository established when a behaviour
> fingerprint was wrongly treated as establishing that two calculation methods were the same method.
> So `evidenceRole` **moved** into `src/domain/` and `server/domain/evidenceRole.ts` became a pure
> re-export, and the equivalence test asserts **identity**: the server's `deriveEvidenceRole` must be
> the same function object. A second test reads that file's source and fails if it ever *declares*
> anything, because identity holds only while it stays a re-export.

> **A derived vocabulary cannot disagree with itself.** `DECLARED_CORRECTION_TYPES` was a hand-written
> list whose own comment said it *"mirrors"* the ingestion allowlist. A mirror is two declarations that
> can drift; it is now derived from the allowlist, which is strictly stronger than a test comparing
> them.

> **`null` is NOT zero, and the type system is where that is enforced.**
> `provenRevenueReturned(): number | null` — `null` means NO PROOF CAN EXIST. A rendered `$0.00`
> asserts something false and specific: that a proof was looked for, found, and summed to nothing.

> **Refused money is REPORTED, not dropped.** The dishonest form of this correction is one where
> $83,400 disappears from every screen. It is reported as `proofRefusedCollected`, apart from both
> ledgers, and the figure is **COLLECTED** rather than `collected − baseline`, because the delta in the
> same units reads as Revenue Returned whatever it is labelled.

> **An idempotence guard keyed on the END STATE cannot work when the end state is a REFUSAL.** A
> refusal writes nothing, so the guard finds nothing and re-runs the writes.

## 3 · What was built

**One shared gate.** `src/domain/evidenceRole.ts` (moved), `server/domain/evidenceRole.ts` (re-export
only), `DECLARED_CORRECTION_TYPES` derived, `reasonHasDeclaredChannel`/`channelAbsenceReason` added as
a second *question* over one policy. `check-domain-purity.mjs` now forbids a `server/` import so the
dependency cannot invert back.

**The domain model, through the sanctioned extension path.** `RevenueUnderBilled` added to
`LeakageType` with a `PLAYBOOK` entry whose `expectedProofEvent` names an **accounting** event rather
than a behavioural one — which is the whole reason it is the only provable family.

**The bypass closed.** `validateApproval` now runs the scope gate and then the channel gate, from the
same two functions the server imports. `executedCorrectionOf` derives the correction from the evidence
list via `deriveEvidenceRole` — never supplied — and picks the earliest by `observedAt` with
`evidenceId` as a total tie-break, because a correction chosen by iteration order would make the
verdict a function of how the caller built the list.

**The ledger predicates.** `isCounted` and `isAuditable` gained the gate, so every total and bucket in
`metrics.ts` moved at one point rather than at a dozen call sites where the thirteenth would be missed.

**The seed, refused by the gate rather than by a list.** `buildOne` calls `validateApproval` and builds
a proof only when it returns no violations, so declaring a channel for one of the seven starts
producing its proof with no edit. **Not one field moved on any of the seven** — no reason, leakage
type, amount, date, confidence or evidence record.

**RE-1015, added beside them.** $18,000.00 contracted, $12,500.00 invoiced, corrective invoice CN-9120
raised for $5,500.00 and settled in full on INV-9121. The uplift **equals** the corrective charge, so
the attribution is an accounting identity a CFO re-derives from two documents rather than a judgement
about why a customer behaved differently.

**Presentation.** `ProvenRevenueFigure` / `ProofRefusedNotice`, the banner on `src/App.tsx`, the
labelling guard widened to walk all of `src/` with the embedded-only exemption **proved** against every
consumer, and a guard that no screen formats a proven figure itself.

**Stale storage, twice.** The keys moved to `.v2`; and — the load-bearing half — every proof read from
or written to storage is filtered through the channel gate, so a hand-edited or pre-correction store
cannot put an unattestable proof on a screen. Dropped on **read**, so the stored bytes are not
destroyed.

## 4 · The figures that moved, and the one that did not

| Figure | Before | After |
|---|---:|---:|
| Proven Revenue Returned (seed) | $83,400.00 | **$5,500.00** |
| CFO-auditable (seed) | $79,800.00 | **$5,500.00** |
| Proofs built by the seed | 7 | **1** |
| Collected with proof refused | not reported | **$106,500.00 over 7 cases** |
| Reconciliation gross recovered | $87,700.00 | $93,200.00 (+ RE-1015) |
| `ProofRefused` bucket | did not exist | **$83,400.00 over 7** |
| Recovery rate | 0.875 (7/8) | **0.889 (8/9)** |

**The waterfall still accounts for every gross dollar**, which is the property that makes the
correction honest: $93,200 = $5,500 counted + $4,300 unclassified + $83,400 proof-refused.

## 5 · Two defects in my own change, caught by running things

**Gating `recoveryRate` on provability was wrong.** It put the seed portfolio at **0.5 instead of
0.875** — saying *seven recoveries failed* when the cash arrived in every one. *Cannot be proven* and
*did not recover* are different facts, and a rate whose name is `recoveryRate` is about the second. Split
into `isClassifiedRecovery` (operational) and `isCounted` (monetary). Found by reading the recomputed
figures, not by a test.

**The guided-demo idempotence guard broke on its own second run.** Keyed on the proof, which a refusal
never creates — so it re-ran the writes and the append-only evidence table answered 409. Writes are now
guarded by the ingested evidence and the approval attempt is **unguarded**, because a refused approval
writes nothing and re-establishing the 403 every run beats inheriting it. Proved by three consecutive
runs against one database.

**And the sixteenth instance of the oldest lesson here.** My own `$0.00` guard banned the token and
tripped on the screen's own sentence explaining why the figure is absent. It now matches a **rendered
value** — an element's text content — and asserts the pattern fires on a real zero before trusting it
not to fire on the page. A guard must read the construct it is asking about.

**Two pre-existing defects the gate found.** `src/domain/billingCorrection.test.ts`'s fixture paired
`RenewalAtRisk` with `BillingCorrection` — incoherent since the reason was added on 2026-10-23, and
nothing in the frontend refused it. And the CI #335 failure's real cause: my sandbox held `PF-RE-1014`
approved **2026-11-08 under `UsageActivation`**, two days before the gate, so the old guard found it,
skipped the seed and the 403 never fired locally.

## 5b · The EP-2 failure in CI #336, and the two sleeping assertions it woke

CI #336 ran on the pushed commit. **Five of six jobs were green and the step that broke #335 passed**
(130/131) — the correction holds. `test:ep2` then failed on **one** test that is not part of this slice:

```
FAIL  server/services/candidateCorrectionsRead.postgres.test.ts > the read persists nothing
AssertionError: expected 29 to be 28
 ❯ …:429  expect(await prisma.proof.count()).toBe(proofs);
```

**Both halves of that test were asleep, and each was asleep in a different way.**

| half | what it did | why it proved nothing |
|---|---|---|
| line 429, proofs | `prisma.proof.count()` with **no filter** | its premise is *nothing anywhere writes a Proof while I read twice*, false under vitest's default parallel file execution against one database |
| line 428, candidates | `count({ boundaryId })` — correctly scoped | **the count is 0**: `recordObservation` writes `agent_tasks` and `agent_task_events`, and the read DERIVES candidates from that log, so it compared 0 with 0 |

The second was found by the **non-vacuity guard added while fixing the first**, on its first run. A test
whose scoped half is empty and whose global half is racy would have passed a read that wrote anything.

> **A count over an empty scope and a count over an uncontrolled scope fail in opposite directions, and
> both read as green.** Scope the assertion to a population the test actually created, and prove that
> population is non-empty in the same assertion.

**The replacement is two claims where there was one sloppy one**, and together they are stronger than the
global count ever was:

- **Behavioural, scoped, race-free** — tasks, events, candidates for this boundary, cases for this file's
  boundary prefix, and proofs for those cases. Non-vacuity is asserted on the populated tables.
- **Structural, global, race-free** — `candidateCorrectionsRead.ts` contains no Prisma write and no raw
  execute at all, which covers every table and every boundary. A count proves the net did not move; this
  proves there is nothing that could move it.

A third claim is deliberately **not** made: that no other process wrote a proof during the reads. That is
not a property of this endpoint and is not checkable from inside a parallel suite — pretending to check it
is what produced a test that failed for a reason unrelated to its subject.

**The guard had to read the construct, not the word.** A naive `/\.update\(/` scan matches
`createHash(...).update(identity)` — a crypto digest, not a database write — so the pattern is anchored on
Prisma delegates and raw execution, comments are stripped first, and the test asserts the pattern fires on
a real write and does **not** fire on the digest the module genuinely contains.

**Mutation proof:** making the read insert one `agent_task_events` row fails **both** halves — the
behavioural one at `expected 10 to be 8`, the structural one by name. The pre-fix version would have
caught neither, because its scoped half was empty and its global half was measuring other files.

## 6 · What this does NOT do

- **The seven mechanisms are still unprovable, and that is not a defect being deferred.** Declaring a
  correction channel for one of them means naming a source that can attest it, which is a governance
  decision with an owner. Nothing here takes it.
- **`unprovenRevenue` is now $0.00 and the `LowConfidence` bucket is empty.** The seed can no longer
  demonstrate *counted but not proof-grade*, because the only attestable mechanism carries an
  accounting identity rather than a score. **Reported, not papered over, and deliberately not fixed by
  inventing a low-confidence billing case** — a corrective charge the billing system attests does not
  plausibly carry a confidence of 58, and incoherent synthetic data is worse than a missing bucket.
- **Every figure is synthetic.** The seed is demonstration data; RE-1015 is invented. The product's
  detection reach is unchanged by this slice.
