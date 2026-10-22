// SYNTHETIC RECONCILIATION DEMO BOOK · every identifier, payer and amount here is invented.
//
// Nothing in this file describes a real customer, contract or invoice. Reference namespaces carry the
// word DEMO on purpose so that a screen showing one can never be mistaken for real data, and the amounts
// are round numbers no real book would carry.
//
// WHAT THE BOOK IS FOR. One expected-obligations extract and one billed-lines extract, shaped exactly as
// the governed validators require, that exercise the reconciler's distinct outcomes in a single run:
//
//   DEMO-A  three monthly obligations; the third is billed SHORT          → UNDER_BILLED, unpaired  → candidate
//   DEMO-B  two obligations; the second was NEVER invoiced               → UNDER_BILLED, unpaired  → candidate
//   DEMO-C  one obligation billed exactly                                → MONETARILY_BALANCED (not "no leakage")
//   DEMO-D  one obligation billed ABOVE what is owed                     → OVER_BILLED liability   → no candidate, never netted
//   DEMO-E  an obligation the contract system cannot price (blank)       → UNKNOWN, counted        → no candidate, not $0.00
//   DEMO-G  a shortfall whose money may sit in the next period's surplus → UNDER_BILLED, PAIRED     → held, no candidate
//
// The expected plan is asserted by `reconciliationObserver.test.ts`. If the reconciler changes its mind
// about any of these units the test fails, rather than the demo quietly showing a different story.

export const SYNTHETIC_LABEL = "SYNTHETIC · DEMO DATA · NOT A CUSTOMER";

export const EXPECTATION_COLUMNS: readonly string[] = Object.freeze([
  "entitlement_ref", "period_start", "period_end", "expected_amount", "currency", "payer_ref",
  "terminated_at", "pause_start", "pause_end", "supersedes_ref", "amended_at", "schedule_line_ref",
]);

export const BILLING_COLUMNS: readonly string[] = Object.freeze([
  "invoice_ref", "invoice_line_ref", "invoice_raised_at", "invoice_line_amount", "currency", "payer_ref",
  "obligation_ref", "is_credit", "period_start", "period_end", "legacy_subscription_ref", "source_system",
]);

type Cells = Readonly<Record<string, string>>;

function exp(
  entitlement: string, start: string, end: string, amount: string, payer: string, line: string,
): Cells {
  return Object.freeze({
    entitlement_ref: entitlement, period_start: start, period_end: end, expected_amount: amount,
    currency: "USD", payer_ref: payer, terminated_at: "", pause_start: "", pause_end: "",
    supersedes_ref: "", amended_at: "", schedule_line_ref: line,
  });
}

function bill(
  invoice: string, amount: string, payer: string, obligation: string, start: string, end: string,
  raised: string,
): Cells {
  return Object.freeze({
    invoice_ref: invoice, invoice_line_ref: "1", invoice_raised_at: raised, invoice_line_amount: amount,
    currency: "USD", payer_ref: payer, obligation_ref: obligation, is_credit: "false",
    period_start: start, period_end: end, legacy_subscription_ref: "", source_system: "DEMO-BILLING",
  });
}

const numbered = (rows: readonly Cells[]) =>
  Object.freeze(rows.map((cells, i) => Object.freeze({ rowNumber: i + 1, cells })));

export const DEMO_EXPECTATION_ROWS = numbered([
  exp("ENT-DEMO-A", "2026-01-01", "2026-01-31", "2400.00", "PAYER-DEMO-1", "SL-DEMO-A1"),
  exp("ENT-DEMO-A", "2026-02-01", "2026-02-28", "2400.00", "PAYER-DEMO-1", "SL-DEMO-A2"),
  exp("ENT-DEMO-A", "2026-03-01", "2026-03-31", "2400.00", "PAYER-DEMO-1", "SL-DEMO-A3"),
  exp("ENT-DEMO-B", "2026-01-01", "2026-01-31", "1500.00", "PAYER-DEMO-2", "SL-DEMO-B1"),
  exp("ENT-DEMO-B", "2026-02-01", "2026-02-28", "1500.00", "PAYER-DEMO-2", "SL-DEMO-B2"),
  exp("ENT-DEMO-C", "2026-01-01", "2026-01-31", "900.00", "PAYER-DEMO-3", "SL-DEMO-C1"),
  exp("ENT-DEMO-D", "2026-01-01", "2026-01-31", "2000.00", "PAYER-DEMO-4", "SL-DEMO-D1"),
  exp("ENT-DEMO-E", "2026-01-01", "2026-01-31", "", "PAYER-DEMO-5", "SL-DEMO-E1"),
  exp("ENT-DEMO-G", "2026-01-01", "2026-01-31", "1000.00", "PAYER-DEMO-6", "SL-DEMO-G1"),
  exp("ENT-DEMO-G", "2026-02-01", "2026-02-28", "1000.00", "PAYER-DEMO-6", "SL-DEMO-G2"),
]);

export const DEMO_BILLING_ROWS = numbered([
  bill("INV-DEMO-0001", "2400.00", "PAYER-DEMO-1", "SL-DEMO-A1", "2026-01-01", "2026-01-31", "2026-01-05"),
  bill("INV-DEMO-0002", "2400.00", "PAYER-DEMO-1", "SL-DEMO-A2", "2026-02-01", "2026-02-28", "2026-02-05"),
  // Billed SHORT: 1800.00 against 2400.00 owed.
  bill("INV-DEMO-0003", "1800.00", "PAYER-DEMO-1", "SL-DEMO-A3", "2026-03-01", "2026-03-31", "2026-03-05"),
  bill("INV-DEMO-0004", "1500.00", "PAYER-DEMO-2", "SL-DEMO-B1", "2026-01-01", "2026-01-31", "2026-01-06"),
  // DEMO-B February: no line at all. An absent invoice has no row, and that absence is the finding.
  bill("INV-DEMO-0005", "900.00", "PAYER-DEMO-3", "SL-DEMO-C1", "2026-01-01", "2026-01-31", "2026-01-07"),
  // Billed ABOVE what is owed: 2400.00 against 2000.00.
  bill("INV-DEMO-0006", "2400.00", "PAYER-DEMO-4", "SL-DEMO-D1", "2026-01-01", "2026-01-31", "2026-01-08"),
  // Billed against an obligation whose price the contract system could not state.
  bill("INV-DEMO-0007", "1100.00", "PAYER-DEMO-5", "SL-DEMO-E1", "2026-01-01", "2026-01-31", "2026-01-09"),
  // DEMO-G January was not billed in January. February carries TWO 1000.00 lines, both citing the
  // FEBRUARY obligation, so February is over-billed by exactly the January shortfall. NH cannot tell
  // whether that is a double-bill of February or January paid late under the wrong period.
  bill("INV-DEMO-0008", "1000.00", "PAYER-DEMO-6", "SL-DEMO-G2", "2026-02-01", "2026-02-28", "2026-02-10"),
  bill("INV-DEMO-0009", "1000.00", "PAYER-DEMO-6", "SL-DEMO-G2", "2026-02-01", "2026-02-28", "2026-02-11"),
]);

export const DEMO_CURRENCY = "USD";
