# Reconciler lane · two proposals awaiting separate approval

**Status: PROPOSAL ONLY. Nothing here is implemented.** No enum value added, no migration written, no contract
bumped, no schema edited. Written on `claude/pilot-reconciler-demo-v1` after the reconciler demo reached the
case (`docs/PILOT_RECONCILER_DEMO_V1.md`). Everything referred to is synthetic.

---

## A · A recovery reason for a billing correction

### The gap, measured
The proof endpoint requires `recoveryReason`, validated against a closed list of seven values
(`server/http/schemas.ts`), mirrored by the `RecoveryReason` union (`src/domain/types.ts`) and the
`RECOVERY_REASONS` table (`src/domain/reasons.ts`). All seven are retention/activation plays. A case opened by
the reconciler (`RevenueUnderBilled`, expected proof event *"corrective invoice raised and collected"*) has no
truthful value. Using `UsageActivation` would write a false reason into an **immutable** proof, so the
reconciler journey (§14) stops at EVIDENCED and asserts the case is not proven.

### Proposed addition
One value: **`BillingCorrection`** — *"A corrective invoice or credit-note reversal was raised by billing and
the shortfall was collected."* `appliesTo: "RevenueUnderBilled"`.

| site | change |
|---|---|
| `src/domain/types.ts` | add `"BillingCorrection"` to the `RecoveryReason` union |
| `src/domain/reasons.ts` | add one `ReasonDef` entry |
| `server/http/schemas.ts` | add to `RECOVERY_REASONS` (the HTTP enum) |
| tests | `reasons` table lists it; proof endpoint accepts it; **an unknown value is still 400** |
| `e2e/journey.mjs` §14 | extend from EVIDENCED to PROVEN with a different approver identity, as §13 does |

### What it does NOT touch
* **No migration.** `Proof.recoveryReason` is a plain `String` column (`prisma/schema.prisma:40`), not a
  database enum. No existing row changes meaning.
* No proof semantics: `Collected − Baseline`, the confidence threshold, separation of duties and the frozen
  proof are untouched. The value is a label on a calculation that does not read it.
* No existing reason is renamed, removed or reinterpreted, and historical proofs read as they did.

### Risks and an open decision
1. **Nothing ties a reason to a recovery type today.** An approver may attach `BillingCorrection` to an
   activation case, or the reverse. That is the existing behaviour for all seven values; adding an
   association check would be a *new* governance rule and is deliberately **not** part of this proposal.
2. `EventDetail` offers `RECOVERY_REASONS` for the seed-backed screen, so the new value becomes selectable
   there too. Harmless, but visible.
3. **Is a label enough?** The honest proof of a corrective invoice is the billing evidence, which the evidence
   path already ingests (`invoice_paid`). The reason is classification, not proof.

**Approval needed from:** the owner of the proof vocabulary. Estimated change: ~15 lines plus tests.

---

## B · Obligation-grained identity — correction first

### A correction to what I said earlier
I described obligation-grained identity as needing "the primary-key migration and an optional contract
field". That is **true of the assessment/activation lane and false of the reconciler lane**, and the demo
document is corrected accordingly.

* The migration plan (`OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md` §5) is blocked by
  `PilotAssessmentEntityAttributionRecord @@id([executionId, sourceRef])`. **The reconciler never writes that
  table.** It submits through `CaseAdmissionService`, whose candidate identity is
  `digest([boundaryId, recoveryType, sourceRef])` with `sourceRef` a free pseudonym string.
* So for the reconciler lane the grain is a **choice of what to pseudonymise**, not a schema question. The
  expectation extract already carries a source-stated, per-obligation reference (`schedule_line_ref`; one row
  is ONE expected obligation, and NH never creates, expands or infers one).

### What I built and why (account grain)
`sourceRef = HMAC(key, payer)`, one candidate per payer, positive units summed. I chose it because every
read surface and the identity disclosure currently say a candidate is an account. It inherits the product's
disclosed merge: a later shortfall for the same payer is absorbed by the first candidate and its money
reaches no figure.

### Proposed obligation grain for the reconciler lane
`sourceRef = HMAC(key, ["reconciliation-obligation", scheduleLineRef])`; one candidate per under-billed
**unit**, whose amount is that unit's residual; **no summing**.

**Preconditions, none of which is code:**
1. **Constitution first** (CLAUDE.md: core-definition changes go through the constitution before code). The
   case disclosure (`deriveCaseIdentityGrain`) states that the key "cannot distinguish obligations (always true
   by rule)". For this lane that sentence would become conditional on the detector. A governed statement of
   *which detectors' references are source-stated obligation identities* is required — a data map keyed by
   `detectorVersion`, not a flag on the candidate (a flag the producer sets is the producer vouching for itself).
2. **A unit is not yet a proven obligation.** `schedule_line_ref` identifies a contract line; a unit
   (entitlement × period) with two live lines is already `REFUSED_AMBIGUOUS_LIVE_LINES` and yields no
   candidate. The proposal keys on the **line**, so a unit with one live line maps to exactly one reference.
   Whether a reschedule, renewal or amendment keeps `schedule_line_ref` stable is **unproven** — the
   governed plan's decision #5 (*"whether a real billing system can emit a stable reference"*) applies
   unchanged, and today it is supported only by synthetic measurement.
3. **Presentation:** queue and case wording currently says "account pseudonym" and "account-level"; it would
   have to be derived from the disclosure rather than hardcoded. Two tests pin today's wording.

**What it would fix:** two obligations of one payer stop collapsing, and each shortfall is separately
reviewable, ownable and provable. **What it would not fix:** an obligation re-observed after a re-key is
still a new reference unless the source keeps the old one; first-observation-wins still applies per
obligation.

### What stays governed separately
The assessment/activation lane still needs everything in `OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md`: the
additive sibling table (§5.2), the forward-only rollback window that closes on first write (§5.3), contract
`2.1.0` as OPTIONAL (§4), consumer-before-producer ordering (§8). That plan is unchanged by this document.

### Suggested order, if approved
1. Constitution amendment: per-detector identity-grain statement (governed data, fail-closed when absent).
2. Disclosure derivation reads it; UI wording derives from it; the two pinning tests change with recomputed
   expectations rather than loosened ones.
3. Reconciler switches `sourceRef` to the obligation reference, behind its own flag, with a test that two
   obligations of one payer yield two candidates and that a unit with ambiguous live lines yields none.
4. Production-store test (Postgres) for the above, then the journey.

**Approval needed from:** the constitution owner (1), then the product owner (3).
