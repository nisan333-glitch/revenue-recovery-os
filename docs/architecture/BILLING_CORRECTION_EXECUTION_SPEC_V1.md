# BillingCorrection execution — specification for approval

**Status: SPECIFICATION ONLY. Nothing is implemented and nothing may be until this is approved.**
Issue #18 item 2 asks for a tested stage "controlled BillingCorrection request". That stage **cannot be
tested, because it does not exist as a concept** — the finding below — so it is specified instead.

---

## 1 · What BillingCorrection is today, measured

`BillingCorrection` is a **`RecoveryReason`**: a value in the closed vocabulary at
`src/domain/types.ts:41`, declared at `src/domain/reasons.ts:59`, and scoped at `reasons.ts:90` to the
recovery type `RevenueUnderBilled`. It is a **label a proof carries about why money came back**.

There is **no request, no approval, no execution and no status** for it. The only `CorrectionStatus` in
the repository is `src/contract/expectationExtractCorrections.ts`, which is a *contract* concept about
corrections to an expectation extract — a different thing that must not be mistaken for this one.

So the current journey (`e2e/journey.mjs` §13, 195/195) proves: a case reaches PROVEN **with
BillingCorrection as its stated reason**, substantiated by independently signed settlement evidence. It
does **not** prove that NH requested, authorised or performed a billing correction, and it has never
claimed to.

---

## 2 · The rule the mechanism must satisfy

> **Issuing a corrective charge is an action on the customer's money, so NH may propose it, record it and
> verify its outcome — and may never be the party that both decides it and evidences it.**

Three consequences, each of which the design below is built from rather than annotated with:

1. **The amount must not come from the request.** It is the figure the governed store holds for an
   obligation — and where the correction ledger reports `CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED` or
   `ORDER_NOT_ESTABLISHABLE`, there **is** no authoritative figure and the proposal must be refused.
   This is the hard dependency on the unapproved S-DUP-4 precedence rule.
2. **NH does not call a billing system.** Execution is performed by the customer's billing system; NH
   records a *request* and later *observes* the result in the next billing extract. Anything else makes
   NH the issuer of a charge.
3. **The evidence of settlement stays independent.** A correction NH requested may not be evidenced by a
   record NH wrote; the existing source-attestation path (Ed25519 over a payload signed by a key the
   source holds and the submitter does not) is the only acceptable channel.

---

## 3 · Proposed lifecycle

Five states, append-only, each transition recorded in the authority ledger:

| State | Who | Gate |
|---|---|---|
| `PROPOSED` | operator | obligation identity established; an authoritative amount exists; no open proposal for that obligation |
| `AUTHORISED` | approver, never the proposer | separation of duties, as `Approve` already enforces |
| `REQUESTED` | operator | records that the request left NH; carries no claim that anything was charged |
| `OBSERVED_SETTLED` \| `OBSERVED_UNSETTLED` | — | derived from the **next billing extract**, never asserted |
| `WITHDRAWN` | approver or steward | a linked new record, never an overwrite |

**No state asserts money moved.** `OBSERVED_SETTLED` is an observation about an extract and feeds the
existing proof path as evidence; it is not itself a proof, and `Collected − Baseline` continues to be
computed only from locked baseline plus independent evidence.

## 4 · What must be decided before any implementation

1. **S-DUP-4 precedence** — blocking. Without it, `PROPOSED` has no amount it may legitimately carry.
2. Whether a correction is **per obligation only**. Recommended yes: an account-grained proposal would
   be a charge against a claim the record cannot attribute, and `ACCOUNT_AGGREGATE` must refuse.
3. Whether `WITHDRAWN` after `REQUESTED` needs a **credit-note observation**, since a request that left
   NH may already have been acted on.
4. Whether this needs a **schema change**. A first cut can live in the existing append-only event tables;
   a durable per-obligation proposal record would need a migration, which is Gate C and unapproved.

## 5 · Recommendation

**Do not implement yet.** Items 1 and 2 of §4 are business rules, and building the lifecycle before they
are settled would bake a precedence choice into a monetary action — the exact thing Issue #18 item 4
forbids. The cheapest honest next step is the precedence decision; the mechanism follows it in a slice of
its own.
