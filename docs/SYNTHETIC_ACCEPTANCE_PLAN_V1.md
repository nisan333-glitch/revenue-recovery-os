# Synthetic acceptance · the blind, production-path validation plan

**Date:** 2026-11-27 · **Commit:** `33ef7d8` · **Status:** a plan. **Nothing in it has been run as an
acceptance run**, and the thresholds below are **proposed**, awaiting the owner.

The subject is the **production** lane — `POST /pilot/pairs` → worker →
`reconciliationObserver.ts` → candidates → review → promotion → baseline → intervention → signed
evidence → `POST /proofs` — never `src/benchmark/`, which has no production callers.

---

## 1 · Why it is blind, and what "blind" is allowed to mean

The ground truth is `e2e/fixtures/reconciliation-obligation-ref/ground-truth.csv`, **frozen on
2026-11-24 under a tracked lock**, three days before any of this work. It states, per mechanism, the
authoritative exposure, whether NH should detect it, whether NH must refuse it, whether the money is
UNKNOWN, and whether attribution is possible.

**The blindness is in the order, not in ignorance.** The truth is readable — it is in the repository —
so the control that matters is that **it was written before the result was known** and that **it may
not move**. Both verifiers (`recon:verify`, `recon:ref:verify`) must pass before and after every run,
and the run is invalid if either fails.

> **The ruler is part of the experiment.** Scenarios, amounts, identities, mechanisms, expected
> outcomes, denominators **and the scorer** are frozen before the acceptance run. If the package
> exposes a defect in NH, fix NH and re-run against the SAME package. A ground-truth change is a
> governed revision with its own evidence and a new freeze — **never a silent edit, and never one that
> improves a result.**

Two things must additionally be frozen that are not frozen today, and this is a gap in the plan rather
than a claim about it: **`scripts/pilot-synthetic-company/` is not covered by either lock**, and the
baseline fraction the harness uses (10%) is a harness constant rather than a governed method. Both must
enter a lock before the run counts as acceptance.

---

## 2 · Proposed thresholds, with their denominators named

A threshold without a denominator is unauditable. Each row names the exact numerator and denominator
the current instruments produce.

| # | criterion | proposed | numerator / denominator | measured today |
|---|---|---|---|---|
| T1 | **monetary precision** | **≥ 95%** | `(detected − fabricated) / detected`, fabricated = Σ positive `(detected − authoritative)` per mechanism | **100.00%** |
| T2 | **monetary recall** | **≥ 90%** | `TP / planted on mechanisms the truth says to detect` | **85.70%** — *fails* |
| T2b | recall, reported beside it | — | `TP / planted total, every priced row` | 66.16% |
| T3 | **proof-eligibility coverage** | **≥ 90%** | `exposure on SINGLE_OBLIGATION cases / detected exposure` | **4.01%** — *fails badly* |
| T4 | **zero duplicate settlement** | 0 | count of arrivals consumed by more than one proof | 0 (no settlement cited; see §4) |
| T5 | **zero unsupported PROVEN claims** | 0 | proofs whose collected figure exceeds its signed outcome records | **0** |
| T6 | **all mandatory adversarial controls pass** | 7 / 7 | each refused **by its own mechanism**, not by an earlier one | **7 / 7** |
| T7 | **full financial reconciliation** | $0.00 unaccounted | planted − Σbuckets, and detected − Σattributed | **$0.00 / $0.00** |

**Three of the seven pass today, one is untestable as configured, and three fail.** T3 is the
migration's target. T2's gap is $9,483.70 across five mechanisms the detector does not reach
(M08 wrong entitlement, M09 wrong payer, M18 unsupported relationship, M20 multiple mechanisms, M10
billed-after-cancellation at $0) — those are **detection reach**, a different question from grain, and
T2 cannot be met by the migration alone.

---

## 3 · A threshold I decline to propose as stated

The mandate lists *"proof eligibility coverage ≥90% of correctly identified, evidence-supported
exposure"*. **"Evidence-supported" cannot be measured on synthetic data without circularity**: the
evidence is signed by a key this harness generates, so every detected dollar is trivially
"evidence-supported" and the criterion would be satisfied by construction. T3 is therefore written
against **detected exposure**, which the product produces and the harness does not choose. The
stricter reading becomes measurable only when a key NH does not hold signs the evidence — and that
needs a real counterparty, which is a `REAL_CUSTOMER_PROVEN` question and not a synthetic one.

---

## 4 · T4 is not measurable in the current configuration, and that is reported rather than scored

Duplicate settlement is governed by `settlement_consumptions` and the digest under
`NH_SETTLEMENT_DIGEST_KEY`. The acceptance run as built **cites no external settlement**, so the
ledger is never written and "zero duplicate settlement" is true the way an unopened book has no
errors. Reporting that as a pass would be the `coverage.event` mistake: **declaring a control green
from a layer that never exercised it.**

To make T4 real the run must cite a settlement, which requires `NH_EXTERNAL_SETTLEMENT_ENABLED`, a
settlement source key, `NH_SETTLEMENT_DIGEST_KEY`, **and three migrations that are deliberately not
in `prisma/migrations/`**. Until then T4 reads **NOT EXERCISED**, never 0.

---

## 5 · The run, in order

1. `recon:verify` and `recon:ref:verify` — both must pass, **before**.
2. A fresh database, `prisma migrate deploy`, Tier A configuration only.
3. `pilot:company` — the full loop, every promoted case driven to the gate, including the ones the
   gate will refuse.
4. `pilot:company:reconcile` — the full ledger reconciliation and the named denominators.
5. `pilot:company:score` — the per-mechanism verdicts against the frozen truth.
6. `recon:verify` and `recon:ref:verify` again — both must pass, **after**, proving the run was
   read-only over the package.
7. Record every figure with the commit SHA it was produced at.

**Pass requires every mandatory criterion.** A run that meets T1 and T5 and fails T3 is **not** a
pass, and the status it earns is `SYNTHETIC_PARTIALLY_VALIDATED` — which is what today's run earns.

---

## 6 · What this can never establish

No customer, no real invoice, no real settlement, no bank, no verified institution. The signing key
is the harness's own, so "independent" means *signed by a key in NH's registry* and says nothing
about who holds it. **`SYNTHETIC_VALIDATED` and `REAL_CUSTOMER_PROVEN` are different states and the
first is not a step towards claiming the second** — it is only evidence that the machinery works
before a real counterparty is asked to use it.

**Fixtures and thresholds may not be altered to manufacture success.** If a threshold turns out to be
the wrong question — as T3's "evidence-supported" phrasing and T4's unexercised control both did —
the honest move is to say so and report the criterion as unmet or unmeasurable, which is what this
document does.
