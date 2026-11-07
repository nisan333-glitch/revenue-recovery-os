# `cfoAuditExport` — no proof is not a zero

Issue #18, owner-approved. Baseline `5a44efe`; pre-registration `5860919`, sha256
`9aeffc0a1fb8f3ebca6d9b3e5f730a2bba63eaed75fd183ecb516bc240ce4ae9`, frozen before any implementation.

**The defect.** The surface behind `GET /audit/cases/:caseId/cfo-export` answered for a case id **that
does not exist** with `provenRevenueReturnedMinor: 0`, `auditableRevenueMinor: 0`, `currency: null`,
`excluded: false` and an empty chain. A case with no proof, a case whose proofs were all reversed, and a
case that was never opened read **identically** on the most financially consequential read in the
product. `$0.00 auditable` is not the same claim as *no proof exists*.

---

## 1 · Two measured facts decided the design, and the first rules out the obvious fix

> **D1 · Failing closed would break a live screen, so it is rejected.** `EventDetail.tsx:73` calls
> `governed.loadCaseTrust(event.eventId, …)` with a **seed event id**, and `loadCaseTrust` calls
> `getCfoExport` inside a `Promise.all`. A rejection there fails the whole batch and the screen renders
> *"Failed to load governed case data"* for **every seed event**. That is the same reason
> `caseAuditTrail` is deliberately root-tolerant — and the two share that call site. **The route keeps
> answering 200; what changes is that it stops stating a monetary zero it never computed.**

> **D2 · `auditableRevenueMinor: 0` is load-bearing and CORRECT where proofs exist but are excluded or
> provenance-gapped.** `trustGate.test.ts:250-251` asserts proven `1_060_000` with auditable `0` —
> *"gapped — excluded from the CFO-grade ledger"* — and `auditService.test.ts:162-163` asserts the same
> pair after exclusion. **That zero is a finding**: this proven money is not CFO-grade. A blanket
> nullification would have fixed one meaning by destroying another.

---

## 2 · The fix is one change, and the rest follows from it

**The accumulators start at `null` instead of `0`.** That is the whole repair: starting at zero made
*nothing to sum* and *summed to nothing* produce the same figure, and only the second is a finding — the
same correction `ledgerTotals` needed one layer out.

| situation | proven | auditable | reason |
|---|---|---|---|
| no root, no proof | `null` | `null` | `no_governed_root_and_no_proof` |
| root exists, nothing proven | `null` | `null` | `no_effective_recovery_proof` |
| proofs exist, none auditable | its figure | **`0`** | `null` — **unchanged** |
| proven and auditable | its figure | its figure | `null` |

Added: `monetaryUnavailableReason`, named rather than inferred, and `governedRootExists` — **reported,
not enforced**, which is what lets a reader tell *never opened* from *opened and unproven* without the
route refusing anything.

**The DTO was telling a lie and now does not.** `CfoExportDTO` declared `provenRevenueReturnedMinor:
number`; the moment the server could return `null`, that was false. Both fields are `number | null`,
and a source scan asserts no production reader coalesces either with `?? 0` or `|| 0` — *the defect would
otherwise come back at the last moment, in the place a CFO actually reads.*

---

## 3 · The acceptance bar I set for myself, and what it proved

Pre-registered property **E6**: every existing assertion in `auditService.test.ts`, `trustGate.test.ts`,
`csvProof.postgres.test.ts` and `syntheticPilot` must keep passing **unchanged** — *a fix that needs its
callers' tests rewritten has changed a meaning, not repaired a defect.*

**Measured: 44/44 across those four files, with zero edits to any of them.** That is the evidence this is
a repair.

**One test did change, and it is the one that should have.** `cfoProofReportRead.postgres.test.ts`'s M1
case *pinned the defect as evidence* — it asserted the clean `0 / 0`. With the defect repaired it
correctly failed, so the assertion was **inverted and the history recorded in it**. Keeping the old
assertion would have meant asserting a defect we had just fixed; deleting the test would have thrown away
the record that it caught the fix. The pre-registered finding itself is untouched and still accurate
about the build it was measured on — **what changed is the build.**

**And F2 corrected my own expectation.** I expected an authored case to report
`no_effective_recovery_proof`. It reports `no_governed_root_and_no_proof`, because `POST
/cases/:id/author` writes an authority event and creates **no governed root**. Only once a root exists
does the reason narrow. The test now demonstrates the two reasons separating on the same case id, with
the money still `null` on both sides — which is a better test than the one I set out to write.

---

## 4 · Verification

**Four mutations, all fail:** starting the accumulators at zero again (9 failures), nullifying the
auditable zero (3 — including the two pre-existing files, which is what proves the preserved zero is
genuinely protected), collapsing the two reasons (2), and stating a reason where both figures are
established (2). Each reverted and green again.

1695 + 5 skipped with a database and 1694 + 6 without (116 files), **919 + 6 on ep2 (89 files)**,
195/195 EP-19 journey unchanged, 25/25 ledger journey, six frozen verifiers green, strict build and all
typechecks clean.

## 5 · What it does not do

It does not fail closed on a missing root — proved to break a live screen. It does not change what
counts as auditable, excluded or proven, and it does not touch the proof chain, the exclusion rule or
the provenance-gap rule. **No observed amount became Revenue Returned.**
