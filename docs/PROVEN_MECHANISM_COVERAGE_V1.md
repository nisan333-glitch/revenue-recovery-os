# PROVEN coverage across the eight correction mechanisms — inventory V1

**Date:** 2026-11-09 · **Measured on:** `6523998` (post-audit) · **Local only; nothing pushed or deployed.**
**Evidence:** `server/services/provenMechanismCoverage.postgres.test.ts` (8 tests, real path, real database)

---

## 1. The determination

> **`BillingCorrection` is the only mechanism whose recovery can be proven, and the reason is structural
> rather than a matter of implementation effort.** It is the only one where the executed correction and
> the collected money are linked by an **accounting identity on the same obligation**: the billing system
> raised a corrective charge for X, and X was collected. Both halves have declared, source-attested
> evidence types.
>
> The other seven apply to lifecycle and engagement leakage. Their correction is a **human action** — an
> outreach, a session, a nudge, a flag switched on — and **no source system attests any of them**. The
> link between the action and a later payment is a **behavioural hypothesis**, not a chain on one
> obligation. Closing that link is **causation**, which `causationEstablished = false` withholds by
> construction.

So the seven are not merely unimplemented. **They are unprovable under the current trust model**, and no
evidence contract that could be added would change that without a separately validated causal standard.
Adding `crm: onboarding_restarted` as a correction type would establish that a reboot *happened*; it
would establish nothing about the money arriving *because of it*.

## 2. The inventory

Both axes are read from their declarations, not invented: `RECOVERY_REASONS` (`src/domain/reasons.ts`),
`OUTCOME_EVIDENCE_TYPES` and `CORRECTION_EVIDENCE_TYPES` (`server/domain/evidenceRole.ts`).

### 2a · `BillingCorrection` — PROVEN **can** be granted

| Requirement | What the repository actually requires |
|---|---|
| **Original failure evidence** | A detector candidate stating `obligationCoverage.kind = SINGLE_OBLIGATION` with `obligationRef`, `expectedMinor`, `billedMinor` and a `residualMinor` that equals `expected − billed`. An inconsistent triple is `OBLIGATION_FACTS_INCONSISTENT`; a missing fact is `OBLIGATION_FACTS_INCOMPLETE`. |
| **Executed correction evidence** | A source-attested `correction`-role record: `(billing, corrective_invoice_issued)` or `(billing, billing_corrected)`. Role is derived server-side from `(sourceSystem, evidenceType)` and signed by the source. Absent → **403 `NO_EXECUTED_CORRECTION_RECORD`** (G1). A **credit note is deliberately excluded** — it corrects billing in the opposite direction. |
| **Collection evidence** | A source-attested `outcome`-role record: `(billing, invoice_paid)` or `(billing, payment_received)`, with an amount at least the claimed `collectedMinor`. Insufficient → **403 `OUTCOME_EVIDENCE_INSUFFICIENT`** (G2), universal across tiers. |
| **Identity & attribution** | Obligation-grained candidate key (`CANDIDATE_DEDUPE_SCHEME_V2`); `sourceCandidateId` UNIQUE on the case; absorption judged at the signal's own grain. **Attribution staging is still account-grained** — see §4. |
| **Contradiction / refusal rules** | Aggregate coverage → `OBLIGATION_COVERAGE_IS_AGGREGATE`; absorbed second observation → `ABSORBED_OBSERVATION_RECORDED`; unanswerable absorption → `ABSORPTION_NOT_CHECKED` (never "none"); at-risk contradicting coverage → `AT_RISK_CONTRADICTS_COVERAGE`; ambiguous billing → `BILLED_AMOUNT_AMBIGUOUS`; wrong case type → enforced scope refusal; author ≠ approver enforced; one proof chain per claim (409). |
| **PROVEN?** | **YES.** Verified on the real path: 201, `revenueReturned = 60_000` minor. |

### 2b · The seven lifecycle mechanisms — PROVEN **cannot** be granted

`OnboardingReboot`, `MilestoneNudge`, `EnablementSession`, `CSMOutreach`, `ExecBusinessReview`,
`RenewalOutreach`, `UsageActivation`.

| Requirement | Status |
|---|---|
| **Original failure evidence** | **Partially available.** Lifecycle leakage types exist and are detectable in principle, but the governed single-obligation coverage contract is built around an *amount discrepancy* (`expected − billed`). A stalled onboarding has no billed-versus-expected residual, so the one coverage shape the gate accepts does not describe it. |
| **Executed correction evidence** | **DOES NOT EXIST.** `CORRECTION_EVIDENCE_TYPES` declares `billing` only. No CRM, product-telemetry or task-system pair is declared, so every such record derives the `supporting` role and cannot satisfy G1. |
| **Collection evidence** | **Available but unattributable.** `invoice_paid` / `payment_received` exist, but nothing ties the payment to the action. |
| **Identity & attribution** | The obligation machinery applies, but an engagement action is not *about* one obligation, so obligation-grained identity does not describe the subject either. |
| **Contradiction / refusal rules** | `CORRECTION_CHANNEL_NOT_DECLARED` is **computed** for all seven, with a `why` string recording that the channel does not exist and that declaring one is a governance decision. |
| **PROVEN?** | **NO — and must not be granted.** Not from missing code: from missing attestable facts plus a withheld causal standard. |

## 3. The live gap, measured and pinned

**An unsupported mechanism can reach PROVEN today.** Measured through the real path, not argued:

```
POST /proofs  recoveryReason = "UsageActivation"   on a RevenueUnderBilled case
              executed correction = corrective_invoice_issued
→ 201 ACCEPTED · revenueReturned 60_000 minor
```

**Both gates let it through, for two separate reasons:**

1. `CORRECTION_CHANNEL_NOT_DECLARED` is computed but **not in `BLOCKING_MAPPING_CODES`**, so it is reported rather than enforced.
2. `ENFORCED_REASON_SCOPE` holds **one** entry (`BillingCorrection`), and `reasonScopeViolation` returns `null` for any unlisted reason — by its own stated contract, *"not an enforced reason: historical behaviour, unchanged."* So `UsageActivation` may attach to a case of **any** type.

A corrective-invoice record attests that billing re-billed. It attests **nothing** about an activation,
and a proof is immutable, so the disagreement could never be corrected afterwards — only superseded.

**The gap is now asserted by a test that will FAIL the day it is closed**, so whoever closes it must
update this record in the same change. A gap described in prose gets forgotten; a gap that is asserted
cannot be. Two controls keep that honest: an undeclared reason is refused **400**, and the one enforced
scope does fire.

### 3a · The cost of closing it — measured, and smaller than it first looked

Adding `CORRECTION_CHANNEL_NOT_DECLARED` to `BLOCKING_MAPPING_CODES` gives **41 failed / 918 passed**
across 10 files — re-measured on this tree, not quoted from an earlier report. **The whole breakage traces to one line:**

```ts
// server/test/fixtures.ts:274
recoveryReason: input.recoveryReason ?? "UsageActivation",
```

A shared proof-approval fixture defaults to an arbitrary non-billing reason. Those 41 tests are about the
proof kernel, the audit service, the authority ledger and the halt gate — **none of them is asserting
that `UsageActivation` is provable.** The arbitrary default is precisely what kept this gap invisible.

**But one caller is not a fixture, and it is why this is the owner's decision.**
`server/agents/syntheticPilot.ts:318` uses `UsageActivation`, and its case is genuinely
`ActivationMissed` — for which `UsageActivation` is the *correct* reason by the declared scope. So the
synthetic pilot is a real `ActivationMissed` → `UsageActivation` flow that currently reaches PROVEN.
Enforcing the rule would correctly refuse it, and the demonstrable end-to-end PROVEN journey would then
exist **only** for billing cases.

> **That is a visible product consequence, which is exactly why enforcing it here would be taking a
> governance decision by implementation.** The engineering change is small; the product change is not.

## 4. What is blocked independently of all this

**Attribution staging remains account-grained.** `PilotAssessmentEntityAttributionRecord` is
`@@id([executionId, sourceRef])`, verified against the live database:
`PRIMARY KEY (execution_id, source_ref)`. Two obligations of one account cannot both be staged, whatever
the contract declares. The detector → candidate → case → proof path **is** obligation-grained end to end
(demonstrated: two obligations of one account minting $600.00 and $1,000.00 separately); the
assessment → attribution path is not. **Two entry paths, one still blocked by a primary key.**

## 5. Decisions this puts to the owner

1. **Make `CORRECTION_CHANNEL_NOT_DECLARED` blocking?** Closes the §3 gap. Requires changing one fixture
   default, and **removes the synthetic pilot's PROVEN demonstration** unless its scenario moves to a
   billing case. *Recommended, with the pilot scenario changed in the same slice.*
2. **Add the seven reasons to `ENFORCED_REASON_SCOPE`?** A second, independent guard that would stop a
   non-billing reason attaching to a billing case even if (1) is deferred, and it enforces the scopes
   `appliesTo` already declares rather than making a new declaration.

   **I first wrote that this was "cheaper and narrower" than (1). That was an assertion, I measured it,
   and it is WRONG.** Enforcing all eight scopes gives **51 failed / 916 passed across 11 files** —
   *more* than (1)'s 41 across 10, because it additionally breaks fixtures using `MilestoneNudge` and
   `RenewalOutreach` on non-matching case types. The correction is recorded rather than quietly edited,
   because a decision record that carries an unmeasured cost estimate is worse than one that carries
   none. *Still recommended on correctness grounds — but it is the more expensive option, not the
   cheaper one.*

   **The experiment also validated the pin.** Under option 2 the §3 GAP test FAILED, exactly as its
   comment says it must the day the gap closes. That is the pin working as a control rather than as
   decoration — a test that could not fail would have proved nothing about the gap it describes.
3. **Declare a correction channel for any of the seven?** Requires naming an attesting source **and** a
   validated causal standard. §1 argues the second cannot be satisfied today. *Not recommended.*
4. **Execute Option B** (§4) to unblock obligation-grained attribution.

**Nothing in this inventory was implemented as a mechanism, and `causationEstablished = false` is
untouched.** No observed amount became Revenue Returned.
