# Correction ledger — governed read surface (Issue #18, items 1 and 2)

**Owner of this file and of `candidateCorrections*`: Claude.** ChatGPT owns the financial-path and
PROVEN-condition tests. No schema change, no production deploy, no real billing action.

---

## 1 · Review of `adb6a24`, `c3b11b0`, `488c294`

Branch synced by fast-forward from `2a6d6d0` to `488c294` before any edit.

**`adb6a24` is correct and found a real defect in my code.** `observationsFromRows` did
`Number(row.event_sequence)`. A `bigint` beyond `Number.MAX_SAFE_INTEGER` rounds silently, which can
reverse or tie distinct observations and therefore report a false monetary direction. The added guard
refuses an unrepresentable order instead. `c3b11b0` pins it, including the exact boundary value.
`488c294` asserts the controls that matter at the report boundary — distinct obligations kept apart,
opposing corrections not netted, a replay not read as a correction, account and obligation grain
separated — and it is accurate.

### Finding F1 · the derivation accepts raw customer values

`observationsFromRows` validates that `sourceRef` and `obligationRef` are **strings**, nothing more.
Measured: a crafted task result with `sourceRef: "ENT-REAL-CUSTOMER-7781"` and
`obligationRef: "ACME Corp invoice 9912"` passes straight through into the report.
`assertCandidateSignal` refuses both at ingress, so **no detector can produce them** — but a read surface
must not rely on an upstream guard to decide what it emits. Closed by §2.

### Finding F2 · a tie in the append sequence decided a monetary direction by array position

**This is a defect in my own file, and the guard those commits added does not cover it** because each
tied value is individually safe. One task result may carry several signals and they all inherit that
event's sequence, so two observations of ONE identity can tie. Measured, before the fix:

| input order | reported |
|---|---|
| `[60000, 80000]` | `UPWARD`, stored 60000 |
| `[80000, 60000]` | **`DOWNWARD`**, stored 80000 |

Same facts, opposite monetary conclusion. That is the pairing-order rule this repository already
records — *a conclusion that depends on an order nothing authoritative established* — in a new place.
My own module comment asserted *"ties are impossible: the column is NOT NULL with a sequence default, so
two rows cannot share a value."* True of two **events**; false of two **signals**.

**Fixed as a refusal, not a choice.** `ORDER_NOT_ESTABLISHABLE` reports every amount observed and
`null` for the stored figure, the latest figure, the delta, the direction and the magnitude — null rather
than zero, because zero would assert there was no correction when the truth is that we cannot tell which
statement came first. Such an identity is counted on its own and enters **neither** monetary sum. A tie
between **equal** amounts stays `REPEATED_IDENTICAL_OBSERVATION`: equal amounts need no order to be
understood, so the tie must not escalate. The regression is pinned by asserting the report is
**byte-identical** under a reversed input.

### Fixture notes, not defects

`488c294` builds signals with `recoveryType: "SYNTHETIC_SHORTFALL"` and bare `"OBL-A"` references.
Neither shape can exist in production — the admission policy has no such type and
`assertCandidateSignal` refuses a non-pseudonym reference. Harmless for the grouping being tested, and
recorded so a later reader does not take those shapes as representative.

---

## 2 · The governed read surface

`server/services/candidateCorrectionsRead.ts` · `GET /candidate-corrections?boundaryId=…`

Before this, `candidateCorrections.ts` had **no consumer at all** — the defect this repository recorded
against `obligation_ref`: a value nothing reads collects no evidence and invites prose that overstates
what happens to it.

| Control | How |
|---|---|
| **Who may read** | `AuditRead` — approver, verifier, steward. **Not author, not operator**: the ledger names an amount the governed store is not reporting, and the actor who benefits from a larger figure must not be the one reading it and deciding which statement to push. |
| **Order of checks** | Authorization **before** existence, so an unauthorized actor cannot learn which boundaries hold corrections by watching a 404 become a 403 — the ordering `GET /recovery-cases/:caseId` settled. |
| **Boundary isolation** | `requireBoundaryAccess`, and the SQL is **scoped to the boundary**; unscoped it is a forensic scan, and a governed read must not return another boundary's history by omission. A blank boundary is refused, never read as "all". |
| **Redaction** | No `sourceRef`, no `obligationRef`, no `identity` — the fields do not exist on the response. What is emitted is `identityDigest`, a 24-hex **length-framed** digest, so grouping still works and no customer value can leave even if one reached the table by another route. |
| **No authoritative figure** | No corrected / effective / resolved amount, no net. Asserted on the response keys **and** structurally against the module source. `claimBoundary.precedenceApproved` is `false` and `precedenceNotice` says so in words. |
| **Unsafe order** | A refusal named `REFUSED_ORDER_UNSAFE` with no figures — not a 500. Reporting our own 500 for a property of the stored data is the `NH-AX-1009` mistake. The caught error's message is deliberately **not** echoed, since it could carry a value from the row. |
| **Side effects** | None. Asserted by counting candidates and proofs before and after two reads. |

**The redaction test is the F1 attack**, run end to end: a crafted row carrying both raw values, then an
assertion that the correction **is still reported** (redaction must not cost the finding) and that
neither value, nor the substring `ACME`, appears anywhere in the response.

`agent_task_events` turned out to be append-only by trigger as well, which is why the unsafe-sequence
fixture writes its out-of-range sequence **at insert** rather than patching one afterwards — another
control confirmed by being refused.

---

## 3 · What is proved, and what is not

**Proved:** the ledger is readable only by non-beneficiary roles, within one boundary, without emitting
any identifier, without naming an authoritative amount, with an unsafe order refused by name, and
writing nothing.

**Not proved and not claimed:** that any billing was corrected, that any case was approved, that any
money was collected, or that a correction has an authoritative figure. **S-DUP-4 precedence remains
unapproved** and nothing here decides it. No queue status, green CI, candidate row or read-only report
is evidence of recovery.

**Still blocked, unchanged:** S-DUP-2 same-run aggregation and S-ID-1 refusal scope are owner decisions
from Issue #17; the BillingCorrection execution mechanism does not exist and is specified in
[`BILLING_CORRECTION_EXECUTION_SPEC_V1.md`](BILLING_CORRECTION_EXECUTION_SPEC_V1.md) for approval; no UI
renders the correction ledger or a PROVEN refusal.
