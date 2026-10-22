// The two-sided benchmark — INDEPENDENT EMITTERS.
//
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE: Side E and Side O are produced by two separate passes
// over the scenario list, and neither pass can read the other's output. So an expectation survives the
// total absence of any observation — which is the whole architectural point. A generator that built O
// first and then "filled in" E, or that derived one from the other, would make absence unrepresentable
// and the benchmark would silently test something easier than the real problem.
//
// ABSENCE IS ABSENCE. A scenario with `o: []` emits a header and no data rows for that scenario. There
// is no row of zeroes and no row with blank cells, because a blank-celled row is a REJECTED row (the
// billing contract's required fields), and a rejected row is a different fact from an absent invoice.
import type { ExpectationRow, ObservationRow, Scenario } from "./reconciliationScenarios";

export const EXPECTATION_HEADER = [
  "entitlement_ref", "customer_ref", "period_start", "period_end", "expected_amount", "currency",
  "terminated_at", "pause_start", "pause_end", "amended_at", "supersedes_ref", "schedule_line_ref",
] as const;

export const OBSERVATION_HEADER = [
  "invoice_ref", "entitlement_ref", "customer_ref", "period_start", "period_end", "billed_amount",
  "currency", "is_credit",
] as const;

/** Minor units → a plain decimal string. No locale, no separators, no rounding. */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const a = Math.abs(minor);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

function csv(header: readonly string[], rows: readonly string[][]): string {
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function expectationCells(r: ExpectationRow): string[] {
  return [
    r.entitlementRef, r.customerRef, r.periodStart, r.periodEnd,
    // UNKNOWN is an EMPTY CELL, never "0.00". A zero would assert an obligation of nothing.
    r.expectedAmountMinor === null ? "" : minorToDecimal(r.expectedAmountMinor),
    r.currency,
    r.terminatedAt ?? "", r.pauseStart ?? "", r.pauseEnd ?? "",
    r.amendedAt ?? "", r.supersedesRef ?? "", r.scheduleLineRef ?? "",
  ];
}

function observationCells(r: ObservationRow): string[] {
  return [
    r.invoiceRef, r.entitlementRef, r.customerRef, r.periodStart, r.periodEnd,
    minorToDecimal(r.billedAmountMinor), r.currency, r.isCredit ? "true" : "false",
  ];
}

/** PASS ONE. Reads only `scenario.e`. */
export function emitExpectationSide(scenarios: readonly Scenario[]): string {
  return csv(EXPECTATION_HEADER, scenarios.flatMap((s) => s.e.map(expectationCells)));
}

/** PASS TWO. Reads only `scenario.o`. Emits nothing at all for a scenario with no observations. */
export function emitObservationSide(scenarios: readonly Scenario[]): string {
  return csv(OBSERVATION_HEADER, scenarios.flatMap((s) => s.o.map(observationCells)));
}

export interface TwoSidedExtract {
  readonly expectationCsv: string;
  readonly observationCsv: string;
  readonly expectationRowCount: number;
  readonly observationRowCount: number;
}

/**
 * Both sides, each from its own pass. Returned together only for the caller's convenience — they are
 * two files with two provenances, admitted separately, and nothing here joins them.
 */
export function emitTwoSided(scenarios: readonly Scenario[]): TwoSidedExtract {
  const expectationCsv = emitExpectationSide(scenarios);
  const observationCsv = emitObservationSide(scenarios);
  return Object.freeze({
    expectationCsv,
    observationCsv,
    expectationRowCount: scenarios.reduce((n, s) => n + s.e.length, 0),
    observationRowCount: scenarios.reduce((n, s) => n + s.o.length, 0),
  });
}
