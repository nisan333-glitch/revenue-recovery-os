# Obligation Scope — migration plan (DESIGN ONLY)

**Nothing here is implemented.** No migration file, schema change or contract change accompanies this slice.

## Goal
Let a source declare an **obligation-level identifier** so `singleObligation` can become `SUPPORTED` honestly,
without ever inferring it.

## Principles
1. **No inference on backfill.** Existing records stay `REFUSED_UNSUPPORTED`. Historical proofs are never
   rewritten (Trust Invariant 5–6).
2. **Additive expand → migrate → contract.** Nothing existing is renamed or removed.
3. **Declaration, not detection.** An id counts only if the source/customer declares which column is the
   obligation identifier.

## Phases
- **P0 (this slice):** disclosure only.
- **P1 — Expand (assessment input):** optional CSV column `obligation_id`; adapter sets
  `identityBasis=SOURCE_IDENTIFIER` and `obligationLevelIdentifierDeclared=true` only when the column is
  mapped *and* populated for every row. `AssessmentResult` stays unchanged until a versioned result change is
  separately approved (it would alter record hashes).
- **P2 — Expand (case):** optional `obligationId` on outcome evidence (nullable column, new migration, reviewed
  separately). Absent ⇒ unchanged behavior. Candidate: version-bump the proof's frozen provenance only for
  *new* proofs.
- **P3 — Dual-read:** the scope derivation reads declared ids when present; falls back to today's behavior.
- **P4 — Policy decision (needs CFO/steward sign-off):** whether a collision on a declared id should still
  exclude both rows, or surface a resolution workflow.
- **P5 — Contract:** only after demand proof; never remove the disclosure for legacy data.

## Risks
Result-hash drift (guard with golden tests), customers mis-declaring a non-obligation column as an obligation
id (require explicit attestation + audit event), mixed-currency exposure, and treating `SUPPORTED` as proof of
recovery (it is not).

## Open questions
Which customers can supply an obligation-level id? Does a single payment settle several obligations in the
target billing systems? Who attests a declaration?
