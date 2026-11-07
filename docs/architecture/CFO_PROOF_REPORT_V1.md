# CFO Proof report — detected, disputed, evidenced, open

Issue #18, Priority 4. Baseline `fb09308` (CI 6/6, run 42369223768); pre-registration `a2b07c5`,
sha256 `0eb568b9e53532d682c1bd6b90ef9ada7d7073747b4281e8d3d673558fa6fc06`, frozen before any
implementation existed.

**The four questions a CFO is actually asking.** Not *what does the system think it recovered* — that
question invites the answer the constitution forbids. They are: what did you find, what is in dispute,
what of it is **independently evidenced** as collected, and what is still open. This report answers
those four per obligation and refuses to blend them.

---

## 1 · The rules this slice establishes

> **The claimed collected figure is the literal `0`, and the type cannot express anything else.** Same
> treatment `constitutesProof: false as const` gets, for the same reason: the one number that must never
> become quotable as a positive is the one a reader will quote. A build that can genuinely claim
> collected money adds a new type rather than widening this field.

> **And that zero is an ASSERTION, not an absence.** `claimedCollectedIsAsserted: true` sits beside it on
> every row. *"We claim nothing"* is a position NH takes and stands behind; *"nobody computed it"* is a
> gap. Everywhere else in this repository a monetary zero is suspect and `null` means not established —
> here the zero is the honest answer, and the field beside it is what keeps the two readings apart.

> **The open balance is derived, never passed**, so no caller can state a balance its own two figures do
> not support. On this build it equals the whole detected exposure: **every dollar identified is still
> open.** `null` exposure yields `null` balance — a zero would assert the account is settled.

> **The two dispute directions are totalled apart and there is no net figure.** An understatement and an
> overstatement are two problems and their sum is zero problems. Netting a dispute into exposure would be
> the S-DUP-4 precedence decision wearing a different name.

> **A multi-currency boundary is refused, not converted.** NH holds no governed rate, and inventing one
> would make the report's headline a function of a number nobody blessed. Both rows are still *reported*;
> only the sum is refused, with `currency_disagreement` named.

> **An empty boundary is not a finding that nothing is owed.** Zero rows, every total `null` rather than
> `0`, and an explicit notice: *an obligation nobody detected produces no row, and an empty report is the
> same shape whether the book is clean or was never read.*

> **Every verdict is taken from the financial trace and re-decided nowhere.** One case, one
> `readFinancialTrace`, one row. A second derivation of *is this proven* or *what is disputed* would be a
> second thing that can drift from the first.

---

## 2 · Measured, on a four-case book through the real path

| case | coverage | detected | disputed | claimed collected | open | gate |
|---|---|---|---|---|---|---|
| proven | SINGLE_OBLIGATION | $600.00 | — | **$0.00** | $600.00 | ELIGIBLE |
| disputed | SINGLE_OBLIGATION | $400.00 | $200.00 UPWARD | **$0.00** | $400.00 | ELIGIBLE |
| aggregate | ACCOUNT_AGGREGATE | $300.00 | — | **$0.00** | $300.00 | `OBLIGATION_COVERAGE_IS_AGGREGATE` |
| bare | SINGLE_OBLIGATION | $100.00 | — | **$0.00** | $100.00 | ELIGIBLE |
| **totals** | | **$1,400.00** | $200.00 up · none down | **$0.00** | **$1,400.00** | |

The proven case really did reach a frozen proof of $600.00 — and it reduced the open balance by
**nothing at all**, because the proof is internally valid over evidence nobody independent asserted.
Every row carries `REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED`, and the bare case carries
`NO_EVIDENCE` with a null proof figure rather than a zero.

---

## 3 · A finding about the EXISTING CFO export — measured, and deliberately not fixed

Probed before building, with a case id **that does not exist at all**:

```
cfoAuditExport → {"currency":null,"provenRevenueReturnedMinor":0,"auditableRevenueMinor":0,
                  "chainLength":0,"excluded":false}
```

So on the surface behind `GET /audit/cases/:caseId/cfo-export`, **three different situations read as a
clean `0 / 0 / not excluded`**: a case with no proof, a case whose proofs were all reversed, and a case
that was never opened. `$0.00 auditable` is not the same claim as *no proof exists*.

**Nothing there is changed.** It has three production consumers — the UI trust client, the synthetic
pilot harness and the HTTP route — so altering it is a decision with an owner. The new report is an
**additive sibling that fails closed**, exactly as `recoveryCaseRead` is a sibling of the deliberately
root-tolerant `caseAuditTrail`. And *a case that does not exist is not a row*: the report enumerates
governed roots, so a non-existent id cannot appear at all, with zeros or otherwise. The finding is
reproduced by a test in the suite, so it is evidence rather than an anecdote.

---

## 4 · Two defects in my own work, both caught before shipping

**A fabricated field, caught in review of my own draft.** The first `evidenceSourcesFrom` returned
`sourceSystem: evidenceId.startsWith("EV-") ? "recorded" : "recorded"` — a ternary yielding the same
value either way — and `trustClassification: "see the case trace"`. That is a column that looks like data
and is not. Replaced by a projection of the **real** evidence rows, carried once on the trace view so the
two surfaces cannot disagree.

**An authorization test that rode on another layer's gate.** Mutation N7 removed `requireCan(actor,
"AuditRead")` from this module and the suite **still passed 10/10**: the per-case `readFinancialTrace`
carries its own gate and refused the operator downstream, so the report's *own* authorization was never
under test. With no cases there is nothing downstream to refuse — so an unauthorized actor would have
received a clean empty report. The gate is now asserted on an **empty** boundary, which is the only place
the claim *"an unauthorized actor learns nothing, including whether a boundary holds any cases"* is
actually checked.

> **A test that rides on another layer's gate is not a control** — the same family as *a test that cannot
> fail is not a control*, one layer out.

---

## 5 · What is NOT claimed

That any amount was collected — the claimed figure is `0` by construction. That a billing correction was
issued. That any observed amount became Revenue Returned or Auditable Revenue. That an empty or zero
column means no money is outstanding. **Every figure is synthetic**, and the settlement key is generated
per run by the harness, which is why the attestation code is
`INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD` on every row.
