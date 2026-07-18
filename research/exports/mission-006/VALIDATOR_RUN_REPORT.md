# Mission #006 — Stage A Run Report (human-readable)

> Committed validator `research/validator/cli.mjs` (Stage A, **unchanged**). Machine output:
> `VALIDATOR_RUN_REPORT.json` (final run). Structurally different topic from Mission #005.

## Command
```
node research/validator/cli.mjs research/exports/mission-006/dataset.json --json
```

## Run #1 (initial — PRESERVED)
- **Exit 1 · 1 blocking error · 0 warnings.**
- Event: `SCHEMA_INVALID` on source `S003` — `methodology_disclosed: "n/a"` not in enum `[yes, no, partial]`.
- **Classification: native-authoring error** (a typo in an authored enum value). **Not** a validator defect,
  research-record issue, schema/data-contract gap, or false positive — Stage A correctly rejected an
  out-of-enum value it was designed to reject. This is a positive demonstration that Stage A catches native-
  authoring mistakes on a new, structurally different dataset.

## Correction(s)
1. **Error fix:** `S003.methodology_disclosed` `"n/a"` → `"no"` (the critique source discloses no
   methodology). *(only demonstrated-error correction, within Mission #006 files.)*
2. **Authoring completion (not a "make-it-pass" edit):** added claim `M006-C7` (an **Unsupported** claim on
   energy/carbon) and its verdict, to complete the intended generalization coverage (exercise the
   `Unsupported` verdict). This was part of authoring, disclosed for transparency.

## Run #2 (final)
- **Exit 0 · 0 blocking errors · 0 advisory warnings · 0 events.**
- Objects: mission 1 · claims 7 · evidence 9 · sources 3 · assumptions 1 · unknowns 1 · contradictions 1 ·
  verdicts 7.

## Event classification (final run)
No events → nothing to classify. (Run #1's single event is classified above as a native-authoring error,
corrected.)

## What the final PASS means / does not mean
- **Means:** the natively-authored `dataset.json` is **structurally and rule-consistent** with the frozen
  schemas + deterministically-enforceable NH-ROP rules — on a **structurally different** problem.
- **Does NOT mean:** the four-day-week findings are semantically **true**; nor that NH-ROP, Tier 1, or the
  integrated system is validated.
