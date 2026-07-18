# Mission #005 — Stage A Run Report (human-readable)

> Committed validator: `research/validator/cli.mjs` (Stage A, deterministic). Machine output:
> `VALIDATOR_RUN_REPORT.json`. **This is the first Stage A run against a real, natively-authored NH mission.**

## Command
```
node research/validator/cli.mjs research/exports/mission-005/dataset.json --json
```

## Result — initial run (preserved; no rerun)
- **Exit code: 0** (clean / no advisory warnings).
- Objects validated: mission 1 · claims 7 · evidence 7 · sources 3 · assumptions 1 · unknowns 1 ·
  contradictions 1 · verdicts 7.
- **events_total: 0 · errors (blocking): 0 · warnings (advisory): 0.**
- `by_rule`: {} (no rule fired).

## Event classification
No events were produced, so there is nothing to classify as research-record issue / native-authoring error /
schema-data-contract gap / validator false-positive / false-negative / implementation defect.

## Corrections and reruns
**None.** The dataset passed deterministic validation on the **first** run; no dataset edit and no rerun were
performed (nothing was changed to "make it pass").

## What a PASS here means (and does not)
- **Means:** the natively-authored `dataset.json` is **structurally and rule-consistent** with the frozen
  schemas and the deterministically-enforceable NH-ROP rules (schema conformance, ID/xref integrity, verdict
  ≤ evidence, lineage, revenue-ladder, unknown/assumption gates).
- **Does NOT mean:** that the dark-mode findings are **semantically correct/true**, nor that NH-ROP, Tier 1,
  or the integrated system is validated. A well-formed but wrong verdict would also pass.
