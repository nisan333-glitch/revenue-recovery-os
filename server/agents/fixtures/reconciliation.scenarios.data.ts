// SYNTHETIC SCENARIO BOOK for the five pre-registered families · every identifier and amount invented.
//
// A SIBLING, NEVER A WIDENING. `reconciliation.synthetic.ts` is asserted by existing tests and stays
// byte-identical; this file adds payers alongside it. The same pattern Detector #2, the expectation
// extract and the obligation_ref variant all used: an additive artefact with its own payers, so no
// existing assertion can move because a new scenario was added.
//
// Each payer below exercises ONE family and nothing else, so a measurement can be attributed. Amounts
// are distinct round numbers per family, which is what makes a lost or merged figure identifiable in a
// result rather than inferable.
//
// NOTHING HERE PREDICTS AN OUTCOME. The pre-registered expectations live in
// `reconciliation.scenarios.expectations.ts` and were hashed and committed before this file was run.
import { BILLING_COLUMNS, EXPECTATION_COLUMNS } from "./reconciliation.synthetic";

export { BILLING_COLUMNS, EXPECTATION_COLUMNS };
export const SCENARIO_CURRENCY = "USD";
export const SCENARIO_LABEL = "SYNTHETIC · SCENARIO DATA · NOT A CUSTOMER";

type Cells = Readonly<Record<string, string>>;

/** One expected obligation. `supersedes`/`amended` are the amendment facts the contract declares. */
export function expRow(o: {
  entitlement: string; start: string; end: string; amount: string; payer: string; line: string;
  supersedes?: string; amended?: string; terminated?: string;
}): Cells {
  return Object.freeze({
    entitlement_ref: o.entitlement, period_start: o.start, period_end: o.end,
    expected_amount: o.amount, currency: SCENARIO_CURRENCY, payer_ref: o.payer,
    terminated_at: o.terminated ?? "", pause_start: "", pause_end: "",
    supersedes_ref: o.supersedes ?? "", amended_at: o.amended ?? "", schedule_line_ref: o.line,
  });
}

/** One billed line. `credit` and a deliberately DANGLING `obligation` are both reachable here. */
export function billRow(o: {
  invoice: string; amount: string; payer: string; obligation: string; start: string; end: string;
  raised: string; credit?: boolean; line?: string;
}): Cells {
  return Object.freeze({
    invoice_ref: o.invoice, invoice_line_ref: o.line ?? "1", invoice_raised_at: o.raised,
    invoice_line_amount: o.amount, currency: SCENARIO_CURRENCY, payer_ref: o.payer,
    obligation_ref: o.obligation, is_credit: o.credit === true ? "true" : "false",
    period_start: o.start, period_end: o.end, legacy_subscription_ref: "", source_system: "SCENARIO-BILLING",
  });
}

export const numbered = (rows: readonly Cells[]) =>
  Object.freeze(rows.map((cells, i) => Object.freeze({ rowNumber: i + 1, cells })));

const JAN = { start: "2026-01-01", end: "2026-01-31" } as const;
const FEB = { start: "2026-02-01", end: "2026-02-28" } as const;
const MAR = { start: "2026-03-01", end: "2026-03-31" } as const;

// ── S-DUP-2 · two DIFFERENT obligations of one payer, in the SAME run ───────────────────────────────
// Shortfalls 400.00 and 500.00. If they are summed the candidate reads 900.00 and no figure says which
// obligation contributed; if one is dropped the candidate reads 400.00 or 500.00 and money is lost. The
// two cases are distinguishable in the result, which is why the amounts differ.
export const DUP2_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-DUP2-A", ...JAN, amount: "1000.00", payer: "PAYER-SC-DUP2", line: "SL-SC-DUP2-A" }),
  expRow({ entitlement: "ENT-SC-DUP2-B", ...JAN, amount: "2000.00", payer: "PAYER-SC-DUP2", line: "SL-SC-DUP2-B" }),
]);
export const DUP2_BILLING = numbered([
  billRow({ invoice: "INV-SC-DUP2-1", amount: "600.00", payer: "PAYER-SC-DUP2", obligation: "SL-SC-DUP2-A", ...JAN, raised: "2026-01-05" }),
  billRow({ invoice: "INV-SC-DUP2-2", amount: "1500.00", payer: "PAYER-SC-DUP2", obligation: "SL-SC-DUP2-B", ...JAN, raised: "2026-01-05" }),
]);

// ── S-DUP-3 · two DIFFERENT obligations of one payer, in DIFFERENT runs ─────────────────────────────
// Run 1 carries obligation A only (short 300.00). Run 2 carries obligation B only (short 700.00). The
// amounts are deliberately unequal and non-additive-looking so that 300, 700 and 1000 are three
// distinguishable verdicts: first-wins, last-wins, or summed.
export const DUP3_RUN1_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-DUP3-A", ...JAN, amount: "1000.00", payer: "PAYER-SC-DUP3", line: "SL-SC-DUP3-A" }),
]);
export const DUP3_RUN1_BILLING = numbered([
  billRow({ invoice: "INV-SC-DUP3-1", amount: "700.00", payer: "PAYER-SC-DUP3", obligation: "SL-SC-DUP3-A", ...JAN, raised: "2026-01-05" }),
]);
export const DUP3_RUN2_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-DUP3-B", ...FEB, amount: "2000.00", payer: "PAYER-SC-DUP3", line: "SL-SC-DUP3-B" }),
]);
export const DUP3_RUN2_BILLING = numbered([
  billRow({ invoice: "INV-SC-DUP3-2", amount: "1300.00", payer: "PAYER-SC-DUP3", obligation: "SL-SC-DUP3-B", ...FEB, raised: "2026-02-05" }),
]);

// ── S-DUP-4 · a later observation CORRECTS an earlier amount, BOTH DIRECTIONS ───────────────────────
// Base: expected 1000.00, billed 400.00 → short 600.00. The upward correction re-states the billed
// figure as 200.00 (short 800.00); the downward one as 800.00 (short 200.00). Direction matters because
// the harm differs: absorbing an upward correction loses money, absorbing a downward one overstates it.
export const DUP4_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-DUP4-A", ...JAN, amount: "1000.00", payer: "PAYER-SC-DUP4", line: "SL-SC-DUP4-A" }),
]);
export const dup4Billing = (billed: string) => numbered([
  billRow({ invoice: "INV-SC-DUP4-1", amount: billed, payer: "PAYER-SC-DUP4", obligation: "SL-SC-DUP4-A", ...JAN, raised: "2026-01-05" }),
]);

// ── S-CHG-1 · the contract changes mid-period ───────────────────────────────────────────────────────
// PAYER-SC-CHG-OK: the February line is AMENDED and names what it supersedes, so exactly one obligation
// is live at 3000.00 and the superseded 2000.00 must not be added to it. Billed 2500.00 → short 500.00
// if supersession is honoured; short 1500.00 (or a refusal) otherwise.
export const CHG_OK_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-CHG-OK", ...FEB, amount: "2000.00", payer: "PAYER-SC-CHG-OK", line: "SL-SC-CHG-OK-V1" }),
  expRow({
    entitlement: "ENT-SC-CHG-OK", ...FEB, amount: "3000.00", payer: "PAYER-SC-CHG-OK",
    line: "SL-SC-CHG-OK-V2", supersedes: "SL-SC-CHG-OK-V1", amended: "2026-02-10",
  }),
]);
export const CHG_OK_BILLING = numbered([
  billRow({ invoice: "INV-SC-CHG-1", amount: "2500.00", payer: "PAYER-SC-CHG-OK", obligation: "SL-SC-CHG-OK-V2", ...FEB, raised: "2026-02-15" }),
]);

// PAYER-SC-CHG-AMB: two live lines in one unit with NO supersession stated. Nothing about their
// co-location establishes that they are distinct additive obligations, so the governed answer is a
// refusal with a null residual — not 4000.00, and not a silently chosen one of the two.
export const CHG_AMB_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-CHG-AMB", ...MAR, amount: "1500.00", payer: "PAYER-SC-CHG-AMB", line: "SL-SC-CHG-AMB-1" }),
  expRow({ entitlement: "ENT-SC-CHG-AMB", ...MAR, amount: "2500.00", payer: "PAYER-SC-CHG-AMB", line: "SL-SC-CHG-AMB-2" }),
]);
export const CHG_AMB_BILLING = numbered([
  billRow({ invoice: "INV-SC-CHG-2", amount: "1000.00", payer: "PAYER-SC-CHG-AMB", obligation: "SL-SC-CHG-AMB-1", ...MAR, raised: "2026-03-05" }),
]);

// ── S-ID-1 · a billed line whose obligation_ref resolves to nothing ─────────────────────────────────
// The reference names SL-SC-ID-GHOST, which no expectation row declares. A dangling reference is a
// per-unit condition: this payer's own real obligation must still be measured, and the dataset must not
// collapse. The real obligation is short 450.00.
export const ID_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-ID-A", ...JAN, amount: "1200.00", payer: "PAYER-SC-ID", line: "SL-SC-ID-A" }),
]);
export const ID_BILLING = numbered([
  billRow({ invoice: "INV-SC-ID-1", amount: "750.00", payer: "PAYER-SC-ID", obligation: "SL-SC-ID-A", ...JAN, raised: "2026-01-05" }),
  billRow({ invoice: "INV-SC-ID-2", amount: "999.00", payer: "PAYER-SC-ID", obligation: "SL-SC-ID-GHOST", ...JAN, raised: "2026-01-06" }),
]);

// ── S-CRD-1 · a credit issued after a billed line ───────────────────────────────────────────────────
// Stage 1: billed in full, 1800.00 against an 1800.00 obligation. Stage 2: a 600.00 CREDIT line. A
// credit is excluded from billed money by the contract, so the question this measures is whether the
// credit re-opens exposure, is ignored, or is netted — and which of those the run actually does.
export const CRD_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-CRD-A", ...JAN, amount: "1800.00", payer: "PAYER-SC-CRD", line: "SL-SC-CRD-A" }),
]);
export const CRD_STAGE1_BILLING = numbered([
  billRow({ invoice: "INV-SC-CRD-1", amount: "1800.00", payer: "PAYER-SC-CRD", obligation: "SL-SC-CRD-A", ...JAN, raised: "2026-01-05" }),
]);
export const CRD_STAGE2_BILLING = numbered([
  billRow({ invoice: "INV-SC-CRD-1", amount: "1800.00", payer: "PAYER-SC-CRD", obligation: "SL-SC-CRD-A", ...JAN, raised: "2026-01-05" }),
  billRow({ invoice: "INV-SC-CRD-2", amount: "600.00", payer: "PAYER-SC-CRD", obligation: "SL-SC-CRD-A", ...JAN, raised: "2026-01-20", credit: true }),
]);

// ── S-PAY-1 · an unrelated payment lands during the period ──────────────────────────────────────────
// PAYER-SC-PAY-ADJ: February is short 800.00 and January carries a 800.00 SURPLUS on the SAME
// entitlement — settlement is possible, so the governed answer is to HOLD pending attribution rather
// than publish a candidate.
export const PAY_ADJ_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-PAY-ADJ", ...JAN, amount: "1000.00", payer: "PAYER-SC-PAY-ADJ", line: "SL-SC-PAY-ADJ-1" }),
  expRow({ entitlement: "ENT-SC-PAY-ADJ", ...FEB, amount: "1000.00", payer: "PAYER-SC-PAY-ADJ", line: "SL-SC-PAY-ADJ-2" }),
]);
export const PAY_ADJ_BILLING = numbered([
  billRow({ invoice: "INV-SC-PAY-1", amount: "1800.00", payer: "PAYER-SC-PAY-ADJ", obligation: "SL-SC-PAY-ADJ-1", ...JAN, raised: "2026-01-05" }),
  billRow({ invoice: "INV-SC-PAY-2", amount: "200.00", payer: "PAYER-SC-PAY-ADJ", obligation: "SL-SC-PAY-ADJ-2", ...FEB, raised: "2026-02-05" }),
]);

// PAYER-SC-PAY-FAR: the same shape with the surplus a YEAR away — outside any governed displacement
// window, and on a different entitlement. Nothing authoritative makes settlement possible, so the
// shortfall must stand as a candidate. Amount similarity alone must not suppress it.
export const PAY_FAR_EXPECTATION = numbered([
  expRow({ entitlement: "ENT-SC-PAY-FAR-1", start: "2025-01-01", end: "2025-01-31", amount: "1000.00", payer: "PAYER-SC-PAY-FAR", line: "SL-SC-PAY-FAR-1" }),
  expRow({ entitlement: "ENT-SC-PAY-FAR-2", ...FEB, amount: "1000.00", payer: "PAYER-SC-PAY-FAR", line: "SL-SC-PAY-FAR-2" }),
]);
export const PAY_FAR_BILLING = numbered([
  billRow({ invoice: "INV-SC-PAY-3", amount: "1800.00", payer: "PAYER-SC-PAY-FAR", obligation: "SL-SC-PAY-FAR-1", start: "2025-01-01", end: "2025-01-31", raised: "2025-01-05" }),
  billRow({ invoice: "INV-SC-PAY-4", amount: "200.00", payer: "PAYER-SC-PAY-FAR", obligation: "SL-SC-PAY-FAR-2", ...FEB, raised: "2026-02-05" }),
]);
