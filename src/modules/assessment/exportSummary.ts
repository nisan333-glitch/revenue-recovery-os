// Local, methodology-first export for a Design Partner review. `buildSummary` is PURE (unit-tested);
// the download helpers are browser-only (Blob + object URL) and perform NO network I/O.
import type { AssessmentResult } from "../../assessment/types";
import { summarizeExclusions } from "../../assessment/summarize";
import { formatMoney } from "../../domain/money";

/** A minimal CSV template a Design Partner can populate (one row = one expectation cycle). */
export const CSV_TEMPLATE =
  "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at,next_invoice_paid_at,next_invoice_amount,currency,status\n" +
  "ACME-001,SUB-1001,2026-01-05,,2026-02-05,,12000.00,USD,\n" +
  "ACME-002,SUB-1002,2026-01-06,2026-01-12,2026-02-06,2026-02-01,8000.00,USD,";

/** PURE: a deterministic, human-readable methodology + result summary. No browser APIs. */
export function buildSummary(result: AssessmentResult): string {
  const p = result.policy;
  const o = result.observed;
  const exclusions = summarizeExclusions(result)
    .map(({ reason, count }) => `  - ${reason}: ${count}`)
    .join("\n");
  const states = Object.entries(o.stateCounts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `  - ${s}: ${n}`)
    .join("\n");
  const mapping = Object.entries(result.columnMapping)
    .map(([canonical, source]) => `  - ${canonical} ← ${source}`)
    .join("\n");

  return [
    "# Revenue Opportunity Assessment — Methodology & Result",
    "",
    "## Four money states (never blended)",
    `- OBSERVED: Unpaid value in the stalled cohort = ${formatMoney(o.observedUnpaid, { exact: true })}`,
    "- ESTIMATED (Revenue Leakage): Not calculated in this validation slice.",
    "- FORECAST (Opportunity): Not calculated in this validation slice.",
    "- PROVEN (Revenue Returned / Auditable): $0 — not applicable in M1.",
    "",
    "## Assessment Policy (stamped — reproducible)",
    `- assessmentId: ${result.assessmentId}`,
    `- createdAt: ${result.createdAt}`,
    `- source fingerprint: ${result.fingerprintAlgo}:${result.sourceFingerprint}`,
    `- adapter: ${result.adapterId} v${result.adapterVersion} · parser ${result.parserVersion}`,
    `- column mapping: ${result.mappingId}`,
    mapping || "  - (canonical headers used as-is)",
    `- policy: ${p.policyId} v${p.policyVersion} · calc ${p.calculationMethodVersion}`,
    `- grain: ${p.grain}`,
    `- stall threshold N: ${p.stallThresholdDays} days`,
    `- analysis asOf: ${p.asOf}`,
    `- currency: ${p.currency}`,
    `- amount format: ${result.amountFormat} · date locale: ${result.dateLocale}`,
    `- activation: ${p.activationDefinition}`,
    `- payment: ${p.paymentDefinition}`,
    "",
    "## Cohort",
    `- accepted cycles: ${result.acceptedCycleCount}`,
    `- stalled (deviation): ${result.stalledCount}`,
    `- undetermined (within window, not yet due): ${result.undeterminedCount}`,
    `- reference (confirmed non-deviant): ${result.referenceCount}`,
    "",
    "## Observed breakdown (exact minor units)",
    `- gross eligible: ${formatMoney(o.grossEligible, { exact: true })}`,
    `- observed unpaid: ${formatMoney(o.observedUnpaid, { exact: true })}`,
    `- partial outstanding: ${formatMoney(o.partialOutstanding, { exact: true })}`,
    `- excluded (cancelled/refunded): ${formatMoney(o.excludedValue, { exact: true })}`,
    `- unknown: ${formatMoney(o.unknownValue, { exact: true })}`,
    "  payment states:",
    states || "  - (none)",
    "",
    "## Data quality — exclusions (never silent)",
    `- excluded rows: ${result.excludedRowCount}`,
    exclusions || "  - (none)",
    "",
    "> Observed Unpaid is read directly from the customer's records. It is NOT proven recovery and " +
      "NOT a forecast. It cannot establish that the activation stall CAUSED the unpaid value.",
  ].join("\n");
}

// --- Browser-only local download helpers (no network) --------------------------------------------
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSummary(result: AssessmentResult): void {
  downloadText(`assessment-${result.assessmentId}.md`, buildSummary(result));
}

export function downloadTemplate(): void {
  downloadText("assessment-template.csv", CSV_TEMPLATE);
}
