# CI Verifier Coverage · V1

**Status:** built · four verifiers inside the gate · frozen inputs tracked
**Date:** 2026-10-15
**Preserves:** contract **2.0.0** · expectation extract **1.1.0** · billing extract **1.0.0** ·
`exv-2026.1` · `bxv-2026.1` · `rdy-2026.2` · `pav-2026.2` · `OBLIGATION_IDENTITY_FIELDS = []` · every
frozen artefact byte-identical · no version constant moved

---

## 1 · The gap

CI ran `check:purity`, `test`, `build`, `typecheck:scripts`, `test:ep2`, `test:journey` and
`verify:registers`. It did **not** run `pilot:verify` (242 checks), `readiness:control` (25),
`recon:verify` or `recon:ref:verify` — so four verifiers guarding a customer-facing package and two
frozen benchmark packages executed only when someone remembered to type them. *A test CI never runs is
not a guard*, which this repository had by then paid for twice.

## 2 · The blocker that had to be cleared first

`.gitignore` excluded `e2e/fixtures/` wholesale, and both frozen packages had **zero tracked files**.
Three of the four verifiers read `e2e/fixtures/reconciliation-{synthetic,obligation-ref}`, and
`freeze.mjs` reads them with **no existence guard** — so on a clean CI checkout they throw `ENOENT` and
every run would be red for a reason unrelated to the freeze. `pilot:verify` reads only
`docs/pilot-intake/` and was unaffected.

> **An uncommitted freeze is not a freeze.** The archived bytes are the evidence; a lock that names
> hashes of files nobody kept is a receipt for a lost artefact.

This is the loss already on record: the V1 scorer's bytes *"had never been committed"*, so the artefact
had to be **reconstructed** from recorded patches — and *"that it needed reconstructing is the
compounding half of the disclosure."* Committing the inputs is what lets CI verify the **archived**
bytes rather than bytes it generated for itself a moment earlier.

**Nothing was regenerated.** All eight lock-covered artefacts hash to their tracked locks — expectation
`31992d23`, V3 observation `0ef21e40`, variant observation `76465e96`, ground-truth `0f5558e4`,
planted-register `111db9d1` — and both locks hash to their own `compositeSha256`, so neither was edited.
Verified before staging and again after.

## 3 · Inputs are evidence; outputs are not

| tracked (10 files, 416 KB) | still ignored |
|---|---|
| `expectation.csv`, `observation.csv`, `ground-truth.csv`, `planted-register.json`, `FROZEN.json` × 2 | `results.json` (~500 KB each), `scoreboard*.json`, `report*.txt`, every `baseline.*` |

Run outputs are rewritten by every `recon:run`/`recon:score` and are not evidence of the experiment's
inputs; tracking them would make every run dirty the tree. **A figure quoted while deciding this was
wrong and is corrected here:** the directories total ~1.8 MB, but ~1.5 MB of that is output. The inputs
are 416 KB.

**The original rule's caveat is answered rather than ignored.** It said a CSV of row-shaped data in the
repository *"is exactly the thing that later gets mistaken for a real extract"* — true, and why the
exception is narrow and documented in place. Every identifier is `syn-`/`SYN-` prefixed; there are no
emails, no person-like names and no phone numbers; the directory names say synthetic; each `FROZEN.json`
records the generator hash and the seed. The journey fixture stays ignored: it is regenerated on every
run and carries no freeze at all.

**The PII check's first form was itself the defect this repository keeps meeting.** It reported 1260
"phone numbers" in the V3 expectation — all of them **ISO dates**, because `2026-02-01` is ten characters
of digits and hyphens. The same instrument defect is already recorded against the package verifier. It
was corrected to exclude valid dates and amounts *before* its output was believed; after correction the
count is zero, and the only cells not matching a `syn-`/date/amount/currency/boolean shape are the two
synthetic tier labels `L1` and `L2`.

## 4 · The job

A fifth job, `frozen-verifiers`, matching the house one-concern-per-job pattern so each verifier's
failure is a distinct **job-level** signal rather than ambiguous with a build or unit-test failure.

**No services are declared, and that is a property rather than an omission.** All four were inspected
before wiring: none touches a database, the network or HTTP; none reads a clock or an RNG. So there is
nothing to isolate and nothing to make a run non-deterministic, and the job needs only Checkout, Node and
`npm ci`.

**It deliberately does not regenerate the packages first.** A gate that rebuilds its own subject cannot
detect the one thing it exists to detect — the self-healing freeze record is already on record as a
defect. It verifies the archived bytes.

## 5 · Fail-closed, proved by induction

Not inferred from exit codes — induced, four times, each reverted with `git checkout --`, and all four
confirmed passing again afterwards:

| verifier | induced defect | result |
|---|---|---|
| `pilot:verify` | rename a column in `expectation_template.csv` | `PACKAGE VERIFICATION FAILED`, exit 1, named check |
| `readiness:control` | drop `entitlement_id` from the V3 expectation header | `READINESS CONTROL FAILED`, exit 1, two named checks |
| `recon:verify` | append a byte to V3 `ground-truth.csv` | `changed since the freeze — the SOURCE PACKAGE moved`, exit 1 |
| `recon:ref:verify` | append a byte to the variant `observation.csv` | `changed since the freeze — the VARIANT PACKAGE moved`, exit 1 |

No `continue-on-error` and no `|| true` anywhere in the workflow, asserted structurally. The wiring is
itself asserted — all four commands present in `ci.yml`, and the frozen inputs present on disk — because
a workflow is configuration and configuration is silently outgrown.

### Two insensitivities found while proving it

Reported rather than quietly left, because they bound what the green job means:

* **`pilot:verify` does not fail on a trailing newline appended to `README.md`.** Its drift checks read
  named content, not whole-file bytes.
* **`readiness:control` does not fail when every currency in the V3 expectation is flipped to EUR.** Its
  25 checks assert levels, ceilings, authority and blocked codes — not fixture bytes.

Neither is a wiring defect: `recon:verify` *is* the byte-level guard on those fixtures and catches both.
But the control is weaker on its own than its name suggests, which is worth knowing before anyone leans
on it alone. **The division of labour is the point: the control checks meaning, the freeze checks bytes.**

## 6 · Reported, not actioned

**`verify:evidence` is a fifth verifier still outside CI** — same family, same former fixture
dependency, and the one that guards the frozen *evidence ledger*. It becomes wireable now that the
inputs are tracked, and it is the **recommended next action**. It raises one question this slice
deliberately did not answer: it covers ten artefacts including the `baseline.*` recordings, which this
slice classified as run outputs and left untracked — so wiring it needs a decision about whether a
recorded historical **measurement** is evidence to preserve or output to regenerate. That is a governed
call, not an engineering one.

Carried forward unchanged: the `emit-package.ts` hardcoded `NH-EX-1002`/`NH-BX-1002`; the dead `asOf`
fixture; the `ownedBy` catalogue asymmetry; `NH-*-1004` unreachable via the CLI;
`ReadinessReport.level`'s authority cap; the nine verifier type errors; `test:e2e` deliberately unwired.

## 7 · What this does not establish

Nothing about money, authority, provenance or proof. No version constant moved, no contract moved, no
customer-facing artefact moved, and **no observed amount became Revenue Returned.** The gate's reach is
wider and still not total: `verify:evidence` remains outside it. And committing the inputs means a
careless `recon:generate` on a modified generator now dirties the tree instead of passing unnoticed — a
better failure, not no failure.
