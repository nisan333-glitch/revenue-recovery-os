# Mission #004 — Data-Readiness Gap Register (Mission #003)

> Genuine data-readiness gaps found while attempting a faithful, invention-free export of **Mission #003**
> to the frozen schemas. **Every gap below is a statement about Mission #003 only** (see the completion
> report for the explicit separation of demonstrated findings vs broader hypotheses). Severity reflects
> impact on exportability; "Blocks export?" = whether it prevents a claims-preserving `dataset.json` without
> invention.

| ID | Gap | Object.field | Evidence (Mission #003) | Severity | Blocks export? |
|---|---|---|---|---|---|
| **G1** | Claim IDs are report-scoped (`M003-R1-C1`) and do not match the frozen `claim_id` pattern `^M[0-9]{3,}-C[0-9]+$`. | `claim.claim_id` | `CLAIM_VALIDATION_REGISTER.md` (33 IDs) | Medium | Not alone (a generated conforming ID could map back), but contributes |
| **G2** | No per-claim `materiality` exists; Mission #003 assigned materiality only at the mission level (L3). | `claim.materiality` (required) | `MISSION_CHARTER.md` "Materiality level: L3"; register has no per-claim materiality | **High** | **Yes** — required, absent for all 33 |
| **G3** | The L3 conditional trio `reviewer` / `confidence_rationale` / `last_reviewed` is absent per claim. | `claim.{reviewer,confidence_rationale,last_reviewed}` (required at L3) | no per-claim reviewer/date; only mission-level "Founder-as-Critical-Reviewer" | **High** | **Yes** — required-at-L3, absent for all 33 |
| **G4** | Verdict value `Contested` is outside the frozen `current_verdict` enum. | `claim.current_verdict` | R2-C4, R5-C2 = "Contested" | **High** | **Yes** for those 2 |
| **G5** | Verdict is split/ambiguous for one claim. | `claim.current_verdict` | R4-C2 "Supported … ; magnitudes Not Assessable" | Medium | Yes for that 1 (choosing one is judgment) |
| **G6** | `confidence` absent ("—") for three claims. | `claim.confidence` (required) | R4-C4, R5-C5, R6-C4 = "—" | **High** | **Yes** for those 3 |
| **G7** | `confidence` compound/out-of-enum ("Mod-High", "Low–Mod", "Mod (estimated)/Low (realized)"). | `claim.confidence` | ~14 claims (e.g. R1-C5, R2-C1..C3, R3-C1..C4, R4-C3/C5, R5-C3, R6-C1) | Medium | Yes (choosing an endpoint is judgment) |
| **G8** | `claim_type` outside the frozen enum. | `claim.claim_type` | 8 claims: `Market/Benchmark`(R1-C5), `Descriptive`(R2-C3), `Framing (meta)`(R2-C5), `Trend`(R3-C2), `Freshness (meta)`(R3-C5,R6-C5), `Meta/verification`(R5-C6), `Meta/method`(R6-C4) | Medium | Yes for those 8 |
| **G9** | `scope` not recorded as an explicit per-claim field. | `claim.scope` (required) | scope appears in prose only | Medium-High | **Yes** — required, not discretely present |
| **G10** | `overturn_conditions` present for only some claims. | `claim.overturn_conditions` (required) | per-report "Overturn conditions" sections cover some, not all 33 | Medium-High | **Yes** for the uncovered claims |
| **G11** | No structured `evidence` registry (per-item `evidence_id`/`direction`/`verification_status`/`independence_group`). | `evidence.*` | `VALIDATION_EVENT_REGISTER.md` records validator-behaviour events, not `evidence` objects; evidence is prose | **High** | **Yes** — evidence layer not exportable |
| **G12** | No structured `source` registry (per-source `source_type`/`primary_or_secondary`/`independence_group`). | `source.*` | sources in per-report prose/appendix | **High** | **Yes** — source/lineage layer not exportable as objects |
| **G13** | `verdict` / `assumption` / `unknown` / `contradiction` not maintained as schema objects with the required enum-valued fields. | those types | discussed in prose (A0, X1–X3, FN/FP candidates) but not as records | Medium-High | Yes for those layers |

## Net determination (Mission #003 only)
Gaps **G2, G3, G6, G9, G10, G11, G12** are each individually **blocking** for a faithful, invention-free
claims-preserving export. Because they apply to **all** claims (G2, G3) or to the evidence/source layers as a
whole (G11, G12), **no claims-preserving `dataset.json` can be produced from Mission #003 without invention.**
The `mission` object alone is exportable (see field-mapping). Conclusion: **DATASET_NOT_EXPORTABLE** for the
pilot's purpose. This determination is about **Mission #003's committed artifacts**; it is **not** a claim
about any other mission.
