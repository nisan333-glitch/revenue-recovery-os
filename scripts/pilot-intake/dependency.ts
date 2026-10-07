// WHAT A FIELD IS ACTUALLY WORTH, MEASURED.
//
// The semantic audit found the package telling a customer that `obligation_ref` is "mandatory in
// practice" for the cross-system join while listing `schedule_line_ref` — the thing it resolves against —
// as merely "optional", with no statement that the join is unreachable without it. Both sentences came
// from the same specs, and both were true at their own layer: the tier is a statement about what the
// VALIDATOR rejects, and the capability is a statement about what the EVALUATOR can then do. Rendering
// the first and calling it the answer is how a minimal ask stops being sufficient for what it promises.
//
// So the dependency is no longer described. It is PROBED: for each capability-gating field, run a minimal
// valid pair of extracts through the real validators and the real readiness evaluator, once whole and
// once with that field removed, and record the readiness level each time. The document then states a
// measured consequence rather than an authored one, and the verifier re-derives it — so the claim cannot
// drift from the behaviour of the code that will judge the customer's file.
import { EXPECTATION_EXTRACT_COLUMNS } from "../../src/contract/expectationExtract";
import { validateExpectationExtract, type RawExpectationRow } from "../../src/contract/expectationExtractValidator";
import { BILLING_EXTRACT_COLUMNS } from "../../src/contract/billingExtract";
import { validateBillingExtract, type RawBillingRow } from "../../src/contract/billingExtractValidator";
import { evaluateDataReadiness, type ReadinessLevel } from "../../src/contract/dataReadiness";

/** The smallest pair that reaches the highest level this package can demonstrate. */
const EXPECTATION_CELLS: Readonly<Record<string, string>> = Object.freeze({
  entitlement_ref: "ENT-PROBE", period_start: "2026-03-01", period_end: "2026-03-31",
  expected_amount: "100.00", currency: "USD", payer_ref: "PAYER-PROBE",
  terminated_at: "", pause_start: "", pause_end: "", supersedes_ref: "", amended_at: "",
  schedule_line_ref: "SL-PROBE",
});

const BILLING_CELLS: Readonly<Record<string, string>> = Object.freeze({
  invoice_ref: "INV-PROBE", invoice_line_ref: "1", invoice_raised_at: "2026-03-05",
  invoice_line_amount: "100.00", currency: "USD", payer_ref: "PAYER-PROBE",
  obligation_ref: "SL-PROBE", is_credit: "false",
  period_start: "2026-03-01", period_end: "2026-03-31",
  legacy_subscription_ref: "", source_system: "BILL-PROBE",
});

export type Side = "expectation" | "billing";

export interface FieldDependency {
  readonly field: string;
  readonly side: Side;
  /** The level reached with the whole pair. */
  readonly levelWith: ReadinessLevel;
  /** The level reached with this field's COLUMN removed entirely. */
  readonly levelWithoutColumn: ReadinessLevel;
  /** The level reached with the column present and every cell BLANK. */
  readonly levelWithBlankCells: ReadinessLevel;
  /** True when removing it costs a readiness level — i.e. mandatory in practice, whatever its tier. */
  readonly costsALevel: boolean;
  /** True when a blank cell costs a level even though the column is declared. */
  readonly blankCostsALevel: boolean;
}

function levelFor(
  eCols: readonly string[], eCells: Readonly<Record<string, string>>,
  sCols: readonly string[], sCells: Readonly<Record<string, string>>,
): ReadinessLevel {
  const pick = (cols: readonly string[], cells: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(cells).filter(([k]) => cols.includes(k)));
  const ev = validateExpectationExtract(
    eCols, [{ rowNumber: 1, cells: pick(eCols, eCells) }] as RawExpectationRow[], { currency: "USD" },
  );
  const sv = validateBillingExtract(
    sCols, [{ rowNumber: 1, cells: pick(sCols, sCells) }] as RawBillingRow[], { currency: "USD" },
  );
  return evaluateDataReadiness(ev, sv).level;
}

/** The baseline, so a probe result can be read against it. */
export const BASELINE_LEVEL: ReadinessLevel = levelFor(
  EXPECTATION_EXTRACT_COLUMNS, EXPECTATION_CELLS, BILLING_EXTRACT_COLUMNS, BILLING_CELLS,
);

export function probe(field: string, side: Side): FieldDependency {
  const eCols = side === "expectation" ? EXPECTATION_EXTRACT_COLUMNS.filter((c) => c !== field) : EXPECTATION_EXTRACT_COLUMNS;
  const sCols = side === "billing" ? BILLING_EXTRACT_COLUMNS.filter((c) => c !== field) : BILLING_EXTRACT_COLUMNS;
  const levelWithoutColumn = levelFor(eCols, EXPECTATION_CELLS, sCols, BILLING_CELLS);

  const blanked = (cells: Readonly<Record<string, string>>) => Object.freeze({ ...cells, [field]: "" });
  const levelWithBlankCells = levelFor(
    EXPECTATION_EXTRACT_COLUMNS, side === "expectation" ? blanked(EXPECTATION_CELLS) : EXPECTATION_CELLS,
    BILLING_EXTRACT_COLUMNS, side === "billing" ? blanked(BILLING_CELLS) : BILLING_CELLS,
  );

  return Object.freeze({
    field, side,
    levelWith: BASELINE_LEVEL,
    levelWithoutColumn,
    levelWithBlankCells,
    costsALevel: levelWithoutColumn !== BASELINE_LEVEL,
    blankCostsALevel: levelWithBlankCells !== BASELINE_LEVEL,
  });
}

/** Every field, probed. Order follows the governed column lists. */
export const DEPENDENCIES: readonly FieldDependency[] = Object.freeze([
  ...EXPECTATION_EXTRACT_COLUMNS.map((f) => probe(f, "expectation")),
  ...BILLING_EXTRACT_COLUMNS.map((f) => probe(f, "billing")),
]);

export const dependencyFor = (field: string, side: Side): FieldDependency =>
  DEPENDENCIES.find((d) => d.field === field && d.side === side)!;
