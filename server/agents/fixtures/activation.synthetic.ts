/** SYNTHETIC test inputs only. Admission is not customer evidence or entity validation. */
import { canBeCase } from "../admission";
import { InMemoryCaseCandidateStore, type CaseCandidateStore } from "../caseAdmission";
import { ingestSecureCsv } from "../secureCsvIngestion";

export const SYNTHETIC_FIELDS = [
  "sourceIdentity", "recoveryType", "observedAt", "amountAtRiskMinor",
  "currency", "actionAvailable", "expectedProofEvent",
] as const;
export type SyntheticRecord = Readonly<Record<typeof SYNTHETIC_FIELDS[number], string>>;
export const SYNTHETIC_POLICY = Object.freeze({ recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 });
export const SYNTHETIC_OPTIONS = Object.freeze({
  boundaryId: "SYNTHETIC-activation-fixture",
  agentId: "SYNTHETIC-csv-fixture",
  detectorVersion: "SYNTHETIC-activation-fixture-v2",
  sourceRefKey: "SYNTHETIC-TEST-ONLY-KEY-DO-NOT-USE-FOR-CUSTOMERS",
  policies: new Map([[SYNTHETIC_POLICY.recoveryType, SYNTHETIC_POLICY]]),
  now: () => new Date("2026-04-01T12:00:00.000Z"),
});

export type SyntheticClassification = "admissible" | "below_threshold" | "no_action" | "duplicate" | "malformed";
export interface SyntheticExpectedRow {
  readonly rowNumber: number;
  readonly csvLine: number;
  readonly classification: SyntheticClassification;
  readonly reason: string;
  readonly becomesCandidate: boolean;
  readonly rejected: boolean;
  readonly deduplicated: boolean;
  readonly duplicateOfRow: number | null;
}

export function syntheticRecords(): readonly SyntheticRecord[] {
  const currencies = ["USD", "EUR", "GBP", "ILS", "JPY"];
  const amounts = [10_000, 10_001, 50_000, 750_000, 25_000, 1_000_000, 10_002];
  const records: SyntheticRecord[] = Array.from({ length: 70 }, (_, index) => ({
    sourceIdentity: `synthetic-account-${String(index + 1).padStart(4, "0")}`,
    recoveryType: "ActivationMissed",
    observedAt: `2026-01-${String(index % 28 + 1).padStart(2, "0")}T12:00:00.000Z`,
    amountAtRiskMinor: String(amounts[index % amounts.length]),
    currency: currencies[index % currencies.length]!,
    actionAvailable: "true",
    expectedProofEvent: 'SYNTHETIC activation completed, resource "synthetic-shared-resource"',
  }));
  // Same apparent account and event/resource labels, different supplied source namespaces.
  // These are explicit fictional composite identities, not inferred entity sufficiency.
  records[68] = { ...records[68]!, sourceIdentity: "synthetic-system-a|synthetic-account-0069" };
  records[69] = { ...records[69]!, sourceIdentity: "synthetic-system-b|synthetic-account-0069" };
  const belowThreshold = [9_999, 0, 1, 9_998, 100, 999, 2_500, 5_000, 7_500, 9_900, 9_950, 9_990, 9_995, 9_996, 9_997];
  for (let index = 0; index < 20; index += 1) {
    records.push({
      ...records[index]!,
      sourceIdentity: `synthetic-account-${String(71 + index).padStart(4, "0")}`,
      observedAt: `2026-02-${String(index + 1).padStart(2, "0")}T09:30:00.000Z`,
      amountAtRiskMinor: String(index < 15 ? belowThreshold[index] : [1_000_000, 5_000_000, 10_000, 10_001, 20_000][index - 15]),
      actionAvailable: index < 15 ? "true" : "false",
    });
  }
  records.push(
    { ...records[0]! },
    { ...records[1]! },
    { ...records[2]!, observedAt: "2026-03-01T14:00:00.000Z", amountAtRiskMinor: "50007" },
    { ...records[3]!, sourceIdentity: `  ${records[3]!.sourceIdentity}  ` },
    { ...records[68]!, expectedProofEvent: "SYNTHETIC activation completed, alternate fictional observation" },
  );
  const invalidFields: Partial<Record<typeof SYNTHETIC_FIELDS[number], string>>[] = [
    { amountAtRiskMinor: "10000.5" },
    { observedAt: "2026-02-30T12:00:00.000Z" },
    { sourceIdentity: "" },
    { currency: "ZZZ" },
    { expectedProofEvent: "" },
  ];
  invalidFields.forEach((invalid, index) => records.push({
    ...records[0]!, sourceIdentity: `synthetic-account-${String(96 + index).padStart(4, "0")}`, ...invalid,
  }));
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

export function syntheticCsv(records: readonly SyntheticRecord[] = syntheticRecords()): string {
  const quote = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `${[
    SYNTHETIC_FIELDS.join(","),
    ...records.map((record) => SYNTHETIC_FIELDS.map((field) => quote(record[field])).join(",")),
  ].join("\n")}\n`;
}

/** Regeneration runs existing ingestion/admission code; tests compare against the saved snapshot. */
export async function measureSyntheticRows(): Promise<readonly SyntheticExpectedRow[]> {
  const underlying = new InMemoryCaseCandidateStore();
  const firstRows = new Map<string, number>();
  const measured: SyntheticExpectedRow[] = [];
  for (const [index, record] of syntheticRecords().entries()) {
    const rowNumber = index + 1;
    let duplicateOfRow: number | null = null;
    const store: CaseCandidateStore = {
      async createIfAbsent(candidate) {
        const result = await underlying.createIfAbsent(candidate);
        if (result.created) firstRows.set(candidate.candidateId, rowNumber);
        else duplicateOfRow = firstRows.get(result.candidate.candidateId)!;
        return result;
      },
    };
    let classification: SyntheticClassification;
    let reason: string;
    try {
      const result = await ingestSecureCsv(syntheticCsv([record]), store, SYNTHETIC_OPTIONS);
      if (result.created === 1) {
        classification = "admissible";
        reason = "existing admission policy accepted; new pending_review Candidate";
      } else if (result.admitted === 1) {
        classification = "duplicate";
        reason = `existing composite candidate identity matches row ${duplicateOfRow}`;
      } else {
        // Use the existing policy gate for reasons rather than implementing another threshold gate.
        const decision = canBeCase({
          signalId: "SYNTHETIC-reason-check", boundaryId: SYNTHETIC_OPTIONS.boundaryId,
          sourceRef: "SYNTHETIC-reason-check", sourcePayloadHash: "0".repeat(64),
          detectorVersion: SYNTHETIC_OPTIONS.detectorVersion,
          recoveryType: record.recoveryType, observedAt: record.observedAt,
          amountAtRiskMinor: Number(record.amountAtRiskMinor), currency: record.currency,
          actionAvailable: record.actionAvailable === "true", expectedProofEvent: record.expectedProofEvent,
        }, SYNTHETIC_POLICY);
        if (decision.admitted) throw new Error("SYNTHETIC fixture policy and ingestion disagree");
        reason = decision.reason;
        classification = record.actionAvailable === "false" ? "no_action" : "below_threshold";
      }
    } catch (error) {
      if (!(error instanceof Error) || index < 95) throw error;
      classification = "malformed";
      reason = error.message;
    }
    measured.push(Object.freeze({
      rowNumber, csvLine: rowNumber + 1, classification, reason,
      becomesCandidate: classification === "admissible",
      rejected: ["below_threshold", "no_action", "malformed"].includes(classification),
      deduplicated: classification === "duplicate", duplicateOfRow,
    }));
  }
  return Object.freeze(measured);
}

export async function syntheticExpectedResults() {
  const rows = await measureSyntheticRows();
  for (const [classification, count] of Object.entries({ admissible: 70, below_threshold: 15, no_action: 5, duplicate: 5, malformed: 5 })) {
    if (rows.filter((row) => row.classification === classification).length !== count) {
      throw new Error(`SYNTHETIC fixture conflicts with the existing rules: ${classification}`);
    }
  }
  const wellFormed = await ingestSecureCsv(syntheticCsv(syntheticRecords().slice(0, 95)), new InMemoryCaseCandidateStore(), SYNTHETIC_OPTIONS);
  let fullBatchReason: string | null = null;
  let fullBatchWrites = 0;
  try {
    await ingestSecureCsv(syntheticCsv(), {
      async createIfAbsent(candidate) { fullBatchWrites += 1; return { candidate, created: true }; },
    }, SYNTHETIC_OPTIONS);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    fullBatchReason = error.message;
  }
  if (!fullBatchReason || fullBatchWrites !== 0) throw new Error("SYNTHETIC mixed batch did not fail closed before persistence");
  return {
    label: "SYNTHETIC", syntheticOnly: true, containsRealCustomerData: false,
    fixture: "activation.synthetic.csv", wellFormedFixture: "activation.well-formed.synthetic.csv",
    policy: SYNTHETIC_POLICY,
    policyScope: "Explicit test configuration, not a universal or FX-adjusted business threshold",
    rowNumbering: "rowNumber counts data rows; csvLine includes the header",
    evaluationMode: "Each row imported separately, in order, with one initially empty candidate store. Error row numbers refer to that one-row CSV.",
    identityScope: "Supplied fictional composite source identity plus boundaryId and recoveryType. Shared event/resource labels are not identity keys. ENTITY_DEFINING_CONTEXT and sufficient=True belong upstream and are not evaluated or claimed by this CSV pipeline.",
    claimLimits: "SYNTHETIC behavior tests only. No ROI, precision, recall, causality, recovered revenue, customer behavior or production readiness claims.",
    rows,
    batches: {
      fullFixture: { rejected: true, reason: fullBatchReason, candidatesCreated: fullBatchWrites },
      wellFormedFixture: wellFormed,
    },
  };
}
