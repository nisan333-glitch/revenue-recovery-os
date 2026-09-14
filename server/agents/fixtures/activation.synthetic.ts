/** Deterministic, clearly synthetic fixture. It is never production input. */
export type SyntheticClassification = "admissible" | "below_threshold" | "no_action" | "duplicate" | "malformed";

export interface SyntheticExpectedRow {
  readonly rowNumber: number;
  readonly classification: SyntheticClassification;
  readonly reason: string;
  readonly becomesCandidate: boolean;
  readonly rejected: boolean;
  readonly deduplicated: boolean;
}

const HEADER = "sourceIdentity,recoveryType,observedAt,amountAtRiskMinor,currency,actionAvailable,expectedProofEvent";

export function syntheticRows(): readonly SyntheticExpectedRow[] {
  return Object.freeze(Array.from({ length: 100 }, (_, index) => {
    const rowNumber = index + 1;
    if (rowNumber <= 70) return row(rowNumber, "admissible", "meets threshold and has an action", true, false, false);
    if (rowNumber <= 85) return row(rowNumber, "below_threshold", "amount is below the admission threshold", false, true, false);
    if (rowNumber <= 90) return row(rowNumber, "no_action", "actionAvailable is false", false, true, false);
    if (rowNumber <= 95) return row(rowNumber, "duplicate", "same composite candidate identity as an admissible row", false, false, true);
    return row(rowNumber, "malformed", "malformed or incomplete CSV fields fail closed", false, true, false);
  }));
}

export function syntheticCsv(): string {
  const lines = [HEADER];
  for (let i = 1; i <= 100; i += 1) {
    const source = `synthetic-account-${String(i <= 70 ? i : i - 70).padStart(4, "0")}`;
    if (i <= 70) {
      const currency = ["USD", "EUR", "GBP", "ILS"][i % 4];
      lines.push(`${source},ActivationMissed,2026-01-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z,${10001 + i},${currency},true,"Activation completed, cohort ${i}"`);
    } else if (i <= 85) {
      lines.push(`${source},ActivationMissed,2026-02-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z,${9999 - (i - 71)},USD,true,Activation completed`);
    } else if (i <= 90) {
      lines.push(`${source},ActivationMissed,2026-03-${String(i - 85).padStart(2, "0")}T12:00:00.000Z,20000,EUR,false,Activation completed`);
    } else if (i <= 95) {
      const duplicateOf = i - 90;
      lines.push(`synthetic-account-${String(duplicateOf).padStart(4, "0")},ActivationMissed,2026-01-${String((duplicateOf % 28) + 1).padStart(2, "0")}T12:00:00.000Z,${10001 + duplicateOf},${["USD", "EUR", "GBP", "ILS"][duplicateOf % 4]},true,"Activation completed, cohort ${duplicateOf}"`);
    } else {
      lines.push(`${source},ActivationMissed,not-a-timestamp,,USD,true,Activation completed`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function row(rowNumber: number, classification: SyntheticClassification, reason: string, becomesCandidate: boolean, rejected: boolean, deduplicated: boolean): SyntheticExpectedRow {
  return Object.freeze({ rowNumber, classification, reason, becomesCandidate, rejected, deduplicated });
}
