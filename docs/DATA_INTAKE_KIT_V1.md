# Data Intake Kit v1

## Decision served

Move from a synthetic demonstration to a controlled customer pilot without treating uploaded data,
observed unpaid value or operator declarations as proof of recovered revenue.

## Product path

`Upload → Column mapping → Data quality → Pilot readiness → Observed result`

The readiness gate records three data checks and seven customer/operator confirmations. A green gate
means **ready for pilot design** only. It does not mean ready to book Revenue Returned or Auditable
Revenue.

## Included artifacts

1. CSV template for the Activation Recovery assessment.
2. Downloadable data-request guide covering required fields, source ownership and pre-pilot decisions.
3. Guided mapping for real customer column names.
4. Deterministic data-quality and cohort assessment.
5. Pilot-readiness gate with explicit missing confirmations.
6. Exportable JSON intake manifest carrying the assessment fingerprint, policy, counts, declarations,
   readiness result and claim boundary.

## Readiness statuses

| Status | Meaning |
|---|---|
| `BLOCKED` | No usable cycles or no observable stalled cohort under the stamped policy. |
| `CONDITIONAL` | Observed analysis may continue, but pilot-design confirmations remain open. |
| `READY FOR PILOT DESIGN` | Data gates and all intake declarations are complete. Source verification and proof are still required. |

## Non-negotiable claim boundary

The kit may report observed unpaid value from customer records. It never claims causality, real Revenue
Returned or Auditable Revenue. CSV provenance and source independence remain self-declared until the
data is ingested and verified server-side from governed systems of record.

## Verification

```bash
npm run test
npm run build
```
