# Obligation Scope — what a counted unit is, and what it is not

**Status:** implemented as a disclosure layer (`obligation-scope-2026.1`). Additive; changes no number.

## The gap (documented before the fix)

The system counts and dedupes **records**, not **obligations**.

- **Assessment:** an `ExpectationCycle` is keyed by `cycleId` — the source `subscription_id`/`cycle_id` if
  present, otherwise a *derived* composite `entity|signed|due`. `dedupeCollisions` rejects **every** row that
  shares a `cycleId` (`duplicate_cycle_id`) and drops their amounts from all totals. Two genuinely separate
  charges that share a derived key are therefore merged into one identity and both excluded — silently with
  respect to *how much money* that could be.
- **Recovery Case:** the Case is "one atomic governed claim", enforced by the unique index
  `Proof_one_chain_root_per_case`. That is a counting rule. Several outcome-evidence records can be counted
  under one Case. Nothing says the Case is one obligation.

Comments and UI copy that said "one invoice" / "atomic" read as a statement about obligations. They are
corrected to "unit of record" / "governed counting unit".

## Definitions

| Term | Meaning |
|---|---|
| **Identity grain** | `SOURCE_IDENTIFIER` (id came from the source), `DERIVED_COMPOSITE` (we synthesized it), `MIXED`, `NOT_ESTABLISHED` (none examined, or basis unrecorded → fail closed). |
| **Ambiguity** | We *cannot tell* whether a record is one obligation. Present unless an obligation-level identifier is declared, sourced, and collision-free. |
| **Recorded absorption** | Units that *were* collapsed under one identity key (a recorded fact, not an inference). |
| **Candidate exposure upper bound** | Sum of absorbed units' amounts, only if every amount is known and one currency; otherwise `null` (not quantifiable). It is **not** a loss, **not** recovered value, and **not** classified as duplicate or separate. |
| **Absorption disposition** | `EXCLUDED_FROM_TOTALS` (assessment) or `COUNTED_UNDER_ONE_CLAIM` (case). |
| **singleObligation** | `SUPPORTED` only with a declared obligation-level source identifier and no collision. Otherwise `REFUSED_UNSUPPORTED`. |

Ambiguity ≠ absorption: a derived identity with no collision is ambiguous but has *no recorded absorption*
(exposure 0, not null) — and the disclosure says that does **not** establish nothing was merged.

## Surfaces

- Pure derivation: `src/domain/obligationScope.ts` (imports only `./money`).
- Assessment: `src/assessment/obligationScope.ts`, `assessCsvWithScope` (wraps unchanged `assessCsv`; the
  `AssessmentResult`, its id, fingerprint and record hash are byte-identical — golden test).
- UI: shared `ObligationScopeNotice` in both assessment screens and the exported summary.
- Governed API: additive `obligationScope` on `GET /audit/cases/:id` and `/cfo-export`
  (`server/domain/caseObligationScope.ts`). No ledger figure, authority outcome or dedupe rule changes.
- Structural refusal: `assertSingleObligation` throws `UnsupportedSingleObligationAssertion`; the API has no
  field to assert it (`additionalProperties:false` → 400).

## Worked example (two obligations, one derived identity)

Entity E1 has two charges, $10,000.00 and $4,000.00, same signed/due dates, no source id.
Both rows are excluded as `duplicate_cycle_id`; Observed Unpaid from them is **$0**. Scope: recorded
absorption, 1 group, 2 units, candidate exposure **upper bound $14,000.00**, unclassified. This is *not* a
claim that $14,000 was lost or can be recovered — only the size of what the identity merge could be hiding.

## Limits

- Customer exposure in production data is **UNKNOWN** (no production data was examined).
- `CFOProofView` / `EventDetail` do not yet render the scope; the API carries it.
- A Case with one evidence record is still `REFUSED_UNSUPPORTED`: one payment may settle several obligations.
