# Three owner decisions — alternatives and recommended fail-closed defaults

**This is a decision record, not an implementation.** Nothing in it is built, and none of the recommended
options is in force. Issue #18 (2026-11-02) item 2.

Baseline: branch `claude/pilot-reconciler-demo-v1` at `f6f979d`, CI 6/6 green, reconfirmed before writing.

**A note on what "reversible" means here, because it decides how much caution each option needs.** Every
option below can be *tested* reversibly: the synthetic packages are frozen, the databases are disposable,
and a wrong answer in a test costs a re-run. What is **not** reversible is an option that lets a figure
reach a **proof**, because `Proof` is append-only and a counted dollar is frozen forever — and, one step
further out, an option that lets a figure reach a **corrective charge**, which is money leaving a
customer's account. Those two are marked IRREVERSIBLE and are the only reason any of this needs a
decision rather than a commit.

---

## 1 · S-DUP-4 — correction precedence

**The situation.** Two observations of one obligation carry different shortfalls. The governed store keeps
the **first**; the ledger reports every amount and decides nothing. Measured on the synthetic package:
an upward correction leaves **$200 unreported**, a downward one leaves exposure **overstated by $400**.

### Option A — FIRST WINS, correction reported and never applied *(current behaviour, and the recommendation)*

The stored figure stays the first observation's. The ledger names the later statement, its direction and
its magnitude, and no surface asserts an authoritative amount.

| | |
|---|---|
| Amount authority | The first observation. Honest, because it is the only statement that was ever admitted through the gate. |
| Candidate identity | Unchanged. The amount is not in the dedupe key, so a correction stays one identity. |
| PROVEN | **Blocked for any corrected obligation** — a claim whose amount is disputed has no authoritative figure, so `provenEligibility` must refuse it. *This is the one piece of Option A that is NOT yet implemented; see §1d.* |
| Backward compatibility | Total. No stored row changes meaning. |
| Reversibility | Reversible. No proof and no charge can carry a disputed figure. |

### Option B — LAST WINS, superseding the stored figure

The latest observation becomes authoritative; earlier ones are retained as history.

| | |
|---|---|
| Amount authority | The most recent extract. Defensible *if* the customer's later extract is genuinely a correction and not a worse export. Nothing in the data distinguishes those two. |
| Candidate identity | Unchanged, but the candidate's **amount** becomes mutable — and `agent_case_candidates` is append-only by trigger, so this needs a **linked revision row**, not an update. |
| PROVEN | Reachable, and **IRREVERSIBLE**: a proof could freeze a figure that a third extract then contradicts. Rule 9 requires a new linked proof revision, which exists, so it is survivable — but it is the first option where a wrong answer is permanent. |
| Backward compatibility | Breaks the meaning of `storedMinor` on every existing row. |
| Reversibility | **IRREVERSIBLE** at the proof boundary. |

### Option C — HIGHEST WINS

Always take the largest observed shortfall.

| | |
|---|---|
| Amount authority | None. It is a rule that maximises the number, which is the Trust Invariant's standing test answered the wrong way: the beneficiary would prefer exactly this rule. |
| PROVEN | **IRREVERSIBLE and adverse.** Recommend rejecting outright. |

### §1d · Recommendation: Option A, plus one small addition that is NOT yet built

Option A is the current behaviour and needs no code — **except** that `provenEligibility` does **not**
currently consult the correction ledger. So today a corrected obligation can still reach PROVEN on its
first figure, with the dispute reported only on a separate surface. That is a real gap in the
recommendation, not in the alternatives, and the addition is: **a disputed or unorderable correction
makes the claim PROVEN-ineligible**, with its own refusal code beside the existing six.

It is decision-free in direction — it only ever refuses more — but it changes a monetary gate, so it is
**proposed here rather than implemented**, per item 2's instruction.

---

## 2 · S-DUP-2 — multi-obligation grain within one run

**The situation.** Two obligations of one account in **one** reconciliation run are summed into one
`ACCOUNT_AGGREGATE` candidate (`reconciliationObserver.ts:346`). Measured: 40,000 + 50,000 → one
candidate of 90,000. **No money is lost**; per-obligation attribution is. Across **different** runs the
obligation-grained key already separates them (S-DUP-3, fixed).

### Option A — keep the aggregate, PROVEN refused *(current behaviour, and the recommendation)*

| | |
|---|---|
| Amount authority | The sum. Correct as a *sum*, and the response says it is one. |
| Candidate identity | Account-grained, v1 key, unchanged. |
| PROVEN | Already **refused**: `OBLIGATION_COVERAGE_IS_AGGREGATE`. So the aggregate can be reviewed and reported but never proven — which is the honest position for a figure that cannot be attributed. |
| Backward compatibility | Total. |
| Reversibility | Reversible. |

### Option B — emit one candidate per unit, always

| | |
|---|---|
| Amount authority | Per obligation, which is strictly better information. |
| Candidate identity | Obligation-grained v2 for every unit. The mechanism **already exists** and is tested; this is a one-line change at the aggregation site. |
| PROVEN | Each unit becomes individually **provable**. That is the point, and it is why this is not a cosmetic change. |
| Backward compatibility | **This is the cost.** Every read surface says a candidate is an account ("account pseudonym", "account-level", and the identity disclosure beneath them). One account's single exposure figure becomes N rows in the review queue, which changes what an operator sees and what the UI means. The 2026-10-22 slice chose account grain *because* the screens say so. |
| Reversibility | Reversible to test; **IRREVERSIBLE once a per-unit proof exists**, because that proof is frozen under an identity the previous design did not have. |

### Option C — emit both: the aggregate for review, per-unit for proof

| | |
|---|---|
| Amount authority | Per obligation. |
| Candidate identity | Two rows for one exposure — and the sum of the queue would then **double-count**. Would need the aggregate excluded from every total, which is a guarantee this repository has no mechanism for. Recommend rejecting: it creates the exact arithmetic hazard the two-ledger rule exists to prevent. |

### Recommendation: Option A now, Option B as a separate, owner-approved slice

A is already true and already fail-closed. B is the better product and is a **UI and semantics change**,
not a detector change — which is why it should not ride along with a readiness slice.

---

## 3 · S-ID-1 — the unresolved $450

**The situation.** A billing line whose `obligation_ref` resolves to nothing refuses its unit. Because
an `UNDER_BILLED` unit is withheld when **any** unit of the same entitlement was refused
(`reconciliationObserver.ts:288-293`), the payer's **own, establishable** $450 shortfall is suppressed.
Measured by a three-arm control: without the ghost line, 45,000 and one candidate; with it, `refused: 1`
and exposure 0; with the same line made resolvable, `overBilledLiability: 1`. The *reporting* is fixed
(`refusedExposure` names the 120,000 expected and says exposure is `UNDETERMINED`); the *behaviour* is not.

### Option A — keep the refusal, report it *(current behaviour, and the recommendation)*

| | |
|---|---|
| Amount authority | None claimed. The expected figure is reported as expected; the residual is withheld because the residual is what the dangling line puts in doubt. |
| Candidate identity | No candidate, so no identity is asserted. |
| PROVEN | Unreachable, correctly: there is nothing to prove. |
| Backward compatibility | Total. |
| Reversibility | Reversible, and it under-reports. The honest cost: a customer with sloppy references sees less exposure than they have. |

### Option B — narrow the sibling scope to the *period*, not the entitlement

Refuse only the unit the dangling line could actually belong to, releasing sibling periods.

| | |
|---|---|
| Amount authority | Per surviving unit, unchanged in method. |
| Candidate identity | Unchanged. |
| PROVEN | More units become provable. **IRREVERSIBLE** once proven. |
| Backward compatibility | Compatible in shape; **changes measured exposure upward**, which is beneficiary-favourable and therefore needs the same governance as the admission bar. |
| Risk | The reason the scope is the entitlement is that money for one period may legitimately sit in a sibling period's invoice — the taint-scope rule. Narrowing it re-opens exactly that. **Recommend not taking this without the displacement-window evidence.** |

### Option C — require the billing side to carry a resolvable reference, and reject the row otherwise

| | |
|---|---|
| Amount authority | Unaffected. |
| Risk | **Recommend rejecting.** Row rejection lets a beneficiary *shrink* measured exposure by poisoning an optional column — a rule this repository already recorded against. It also contradicts "capability gating per detector, never global dataset rejection". |

### Recommendation: Option A, and treat the $450 as a reported limitation rather than a bug

It is the only option that neither under-claims silently nor opens a beneficiary-favourable lever. The
$450 is visible, named and attributed to its cause; what it is not is *collected*, and no option here
makes it so.

---

## 4 · What this record does not do

It decides nothing. It implements nothing. Every recommendation is the **current** behaviour except the
one addition named in §1d, which is proposed and not built. No schema change, no deploy, no billing
action, and no figure here is recovered revenue.
