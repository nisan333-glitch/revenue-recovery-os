// SYNTHETIC example dataset for the Customer Pilot Data Contract.
//
// SAFE BY CONSTRUCTION. Every value here is generated from a counter. There is no real customer, no
// real account, no scraped or anonymized production extract, and nothing that could be re-identified
// — because there is nothing behind it to re-identify. Identifiers carry the literal prefix
// "synthetic-" so a value that escapes into a screenshot, a log or a demo is self-evidently fake.
//
// WHAT IT IS FOR. A customer preparing an export needs a known-good file to diff against, and this
// repository needs a fixture that exercises the contract end to end without ever touching customer
// data. Both use the same generator, so the example a customer is shown is the example the tests
// prove correct.
//
// IT IS NOT A BENCHMARK. Counts here say nothing about detector precision, recovery rates, or what
// any real dataset looks like. Reading performance into synthetic data is how a demo becomes a
// claim, so the numbers are deliberately round and obviously invented.
import type { DatasetProvenance } from "./pilotDataContract";
import type { TenantBoundary } from "./validateDataset";

export const SYNTHETIC_DATASET_LABEL = "SYNTHETIC";

export const SYNTHETIC_BOUNDARY: TenantBoundary = Object.freeze({
  boundaryId: "synthetic-boundary-0001",
  datasetId: "synthetic-activation-2026-q1",
});

export const SYNTHETIC_PROVENANCE: DatasetProvenance = Object.freeze({
  sourceSystems: Object.freeze({
    contract: "synthetic-crm",
    billing: "synthetic-billing",
    product: "synthetic-telemetry",
  }),
  dataOwnerRole: "synthetic-revenue-operations",
  extractionMethod: "synthetic deterministic generator (no production system was queried)",
  extractedAt: "2026-03-01T00:00:00.000Z",
  coverageStart: "2026-01-01",
  coverageEnd: "2026-03-31",
  // A synthetic source cannot be independent of anything. Asserting otherwise would model the exact
  // self-certification the trust invariant forbids.
  assertedIndependentOfBeneficiary: false,
});

export interface SyntheticRow {
  readonly entity_id: string;
  readonly subscription_id: string;
  readonly signed_at: string;
  readonly activation_at: string;
  readonly next_invoice_due_at: string;
  readonly next_invoice_amount: string;
  readonly currency: string;
  readonly next_invoice_paid_at: string;
  readonly paid_amount: string;
  readonly refunded: string;
  readonly refunded_at: string;
  readonly cancelled_at: string;
  readonly plan: string;
  readonly segment: string;
}

const COLUMNS: readonly (keyof SyntheticRow)[] = Object.freeze([
  "entity_id",
  "subscription_id",
  "signed_at",
  "activation_at",
  "next_invoice_due_at",
  "next_invoice_amount",
  "currency",
  "next_invoice_paid_at",
  "paid_amount",
  "refunded",
  "refunded_at",
  "cancelled_at",
  "plan",
  "segment",
]);

const PLANS = ["synthetic-starter", "synthetic-growth", "synthetic-scale"] as const;
const SEGMENTS = ["synthetic-smb", "synthetic-mid", "synthetic-ent"] as const;

function pad(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

function day(base: string, offset: number): string {
  const ms = Date.parse(`${base}T00:00:00.000Z`) + offset * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Deterministic rows. The mix is fixed by index so the same `count` always yields the same file:
 *  • every 5th cycle stalls and goes unpaid (the case the pilot is looking for),
 *  • every 7th settles late,
 *  • every 11th is refunded after settling,
 *  • the rest activate and settle on time.
 */
export function syntheticPilotRows(count = 40): readonly SyntheticRow[] {
  const rows: SyntheticRow[] = [];
  for (let i = 1; i <= count; i += 1) {
    const signed = day("2026-01-05", i % 20);
    const due = day(signed, 30);
    const stalled = i % 5 === 0;
    const late = !stalled && i % 7 === 0;
    const refunded = !stalled && !late && i % 11 === 0;
    const amountMajor = 1000 + i * 25;

    rows.push(
      Object.freeze({
        entity_id: `synthetic-account-${pad(i)}`,
        subscription_id: `synthetic-sub-${pad(i)}`,
        signed_at: signed,
        activation_at: stalled ? "" : day(signed, 6),
        next_invoice_due_at: due,
        next_invoice_amount: `${amountMajor}.00`,
        currency: "USD",
        next_invoice_paid_at: stalled ? "" : late ? day(due, 12) : day(due, -2),
        paid_amount: stalled ? "" : `${amountMajor}.00`,
        refunded: refunded ? "true" : "",
        refunded_at: refunded ? day(due, 9) : "",
        cancelled_at: "",
        plan: PLANS[i % PLANS.length]!,
        segment: SEGMENTS[i % SEGMENTS.length]!,
      }),
    );
  }
  return Object.freeze(rows);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly SyntheticRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
  return `${lines.join("\n")}\n`;
}

/** A contract-valid synthetic dataset. Safe to publish, attach to a data request, or screenshot. */
export function syntheticPilotCsv(count = 40): string {
  return toCsv(syntheticPilotRows(count));
}

/**
 * A deliberately INVALID dataset: each row violates exactly one contract rule, and the expected code
 * is declared alongside it. Tests assert the mapping, so a rule that silently stops firing fails the
 * build rather than quietly accepting bad data.
 */
export interface ViolationCase {
  readonly label: string;
  readonly expectedCode: string;
  readonly row: SyntheticRow;
}

export function syntheticViolationCases(): readonly ViolationCase[] {
  const base = syntheticPilotRows(1)[0]!;
  const withRow = (label: string, expectedCode: string, patch: Partial<SyntheticRow>): ViolationCase =>
    Object.freeze({ label, expectedCode, row: Object.freeze({ ...base, ...patch }) });

  return Object.freeze([
    withRow("email in the identifier column", "NH-DC-3002", {
      entity_id: "person@synthetic.example",
      subscription_id: "synthetic-sub-v001",
    }),
    withRow("local timestamp with no UTC offset", "NH-DC-2005", {
      subscription_id: "synthetic-sub-v002",
      signed_at: "2026-01-05 09:30:00",
    }),
    withRow("invoice due before the contract is signed", "NH-DC-2006", {
      subscription_id: "synthetic-sub-v003",
      signed_at: "2026-02-10",
      activation_at: "",
      next_invoice_due_at: "2026-01-10",
    }),
    withRow("negative obligation", "NH-DC-2010", {
      subscription_id: "synthetic-sub-v004",
      next_invoice_amount: "-500.00",
      paid_amount: "",
      next_invoice_paid_at: "",
    }),
    withRow("zero obligation", "NH-DC-2009", {
      subscription_id: "synthetic-sub-v005",
      next_invoice_amount: "0.00",
      paid_amount: "",
      next_invoice_paid_at: "",
    }),
    withRow("settled amount exceeds the obligation", "NH-DC-2013", {
      subscription_id: "synthetic-sub-v006",
      next_invoice_amount: "1000.00",
      paid_amount: "2500.00",
    }),
    withRow("refund state with no effective date", "NH-DC-2014", {
      subscription_id: "synthetic-sub-v007",
      refunded: "true",
      refunded_at: "",
      cancelled_at: "",
      next_invoice_amount: "1000.00",
      paid_amount: "1000.00",
    }),
    withRow("unparseable date", "NH-DC-2003", {
      subscription_id: "synthetic-sub-v008",
      next_invoice_due_at: "not-a-date",
    }),
    withRow("missing required field", "NH-DC-2002", {
      subscription_id: "synthetic-sub-v009",
      currency: "",
    }),
  ]);
}

/** The violation cases rendered as a CSV, for end-to-end row-level reporting tests. */
export function syntheticViolationCsv(): string {
  return toCsv(syntheticViolationCases().map((c) => c.row));
}
