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

// ── EP-19 · Named risk scenarios ──────────────────────────────────────────────────────────────────
//
// One deterministic dataset per risk the pilot has to survive, each with an INDEPENDENTLY STATED
// expectation. `expected` is hand-written from the contract's rules, never read back from what the code
// currently does — a snapshot of present behaviour would pass forever, including after a regression.
// Where a count is deliberately left unstated it is because the rule, not the arithmetic, is the point.
//
// Every value is still generated from a counter and still carries the literal "synthetic-" prefix, so a
// row that escapes into a screenshot or a log is self-evidently fake. NOTHING here supports an
// inference about ROI, precision, recall, causality or recovered revenue: these are shaped to exercise
// rules, and a rule-exercising fixture says nothing about how any real dataset behaves.

/** What a scenario is expected to do, stated in the vocabulary of the contract and the gate. */
export interface ScenarioExpectation {
  /** Rows in the file, excluding the header. */
  readonly dataRows: number;
  /** Rows the contract should accept. */
  readonly acceptedRows: number;
  /** Rows the contract should reject. */
  readonly rejectedRows: number;
  /** Codes that MUST appear among the findings. Not necessarily the complete set. */
  readonly codes: readonly string[];
  /** Whether at least one cycle should survive — `accepted && acceptedRows > 0`. */
  readonly usableForAssessment: boolean;
  /**
   * The fitness outcome under `SCENARIO_POLICY` below. Stated per scenario because a dataset can be
   * perfectly valid and still unfit — the distinction EP-14 exists to make.
   */
  readonly admission: "ADMISSIBLE" | "NOT_ADMISSIBLE" | "NOT_ASSESSABLE";
  /** Why this scenario exists, in one sentence. Read it before changing an expectation. */
  readonly why: string;
}

export interface SyntheticScenario {
  readonly id: string;
  readonly label: string;
  readonly csvText: string;
  readonly expected: ScenarioExpectation;
}

/**
 * The bar the scenario expectations above are stated against.
 *
 * It is a FIXTURE, not a recommendation, and not a default: the system has no default bar anywhere, and
 * this one exists only so the `admission` column above means something specific. Deliberately loose on
 * single-reason share, because most scenarios below concentrate their rejections in one code by design
 * and that is not the property under test in each case.
 */
export const SCENARIO_POLICY = Object.freeze({
  minAcceptedRows: 10,
  minDistinctEntities: 5,
  maxRejectionRate: 0.2,
  maxSingleReasonShare: 1,
  maxDuplicateRate: 0.05,
  minCoverageDays: 10,
  requiredLifecycleStates: Object.freeze(["stalled", "reference"] as const),
  maxOrderingDefectRate: 0.05,
  maxMissingRecommendedColumns: 2,
  requireProvenanceDeclaration: true,
});

/** Renumber a row's identifiers so scenarios can be composed without colliding on cycle identity. */
function renumber(row: SyntheticRow, index: number): SyntheticRow {
  return Object.freeze({
    ...row,
    entity_id: `synthetic-account-${pad(index)}`,
    subscription_id: `synthetic-sub-${pad(index)}`,
  });
}

export function syntheticScenarios(): readonly SyntheticScenario[] {
  const valid = (count: number): readonly SyntheticRow[] => syntheticPilotRows(count);
  const base = syntheticPilotRows(1)[0]!;
  const scenario = (
    id: string,
    label: string,
    rows: readonly SyntheticRow[],
    expected: ScenarioExpectation,
  ): SyntheticScenario => Object.freeze({ id, label, csvText: toCsv(rows), expected });

  // 30 valid rows, then one row carrying exactly one defect. 1/31 ≈ 3.2% rejection — inside the bar.
  const withOneDefect = (
    id: string,
    label: string,
    patch: Partial<SyntheticRow>,
    code: string,
    why: string,
  ): SyntheticScenario =>
    scenario(id, label, [...valid(30), renumber({ ...base, ...patch }, 901)], {
      dataRows: 31,
      acceptedRows: 30,
      rejectedRows: 1,
      codes: [code],
      usableForAssessment: true,
      admission: "ADMISSIBLE",
      why,
    });

  return Object.freeze([
    scenario("valid", "40 contract-valid rows", valid(40), {
      dataRows: 40,
      acceptedRows: 40,
      rejectedRows: 0,
      codes: [],
      usableForAssessment: true,
      admission: "ADMISSIBLE",
      why: "The control. If this is not admissible, no other expectation here means anything.",
    }),

    scenario(
      "all-rejected",
      "every row unparseable — nothing survives",
      Array.from({ length: 12 }, (_, i) =>
        renumber({ ...base, next_invoice_due_at: "not-a-date" }, 100 + i),
      ),
      {
        dataRows: 12,
        acceptedRows: 0,
        rejectedRows: 12,
        codes: ["NH-DC-2003"],
        // accepted (structurally interpretable) but nothing survived, so not usable.
        usableForAssessment: false,
        // NOT_ADMISSIBLE was the first expectation written here, and it was wrong: with no accepted
        // cycle the coverage window cannot be computed at all, so the gate fails closed with "cannot
        // evaluate" rather than "evaluated and failed". That is the more careful of the two answers.
        admission: "NOT_ASSESSABLE",
        why: "A file can be structurally readable and still yield nothing, and an unevaluable dataset is refused as unevaluable, not as failing.",
      },
    ),

    scenario(
      "one-valid-row",
      "one valid row among 30 rejected",
      [
        valid(1)[0]!,
        ...Array.from({ length: 30 }, (_, i) =>
          renumber({ ...base, next_invoice_due_at: "not-a-date" }, 200 + i),
        ),
      ],
      {
        dataRows: 31,
        acceptedRows: 1,
        rejectedRows: 30,
        codes: ["NH-DC-2003"],
        // THE GAP EP-14 CLOSES: technically usable, and obviously unfit for a pilot.
        usableForAssessment: true,
        admission: "NOT_ADMISSIBLE",
        why: "One survivor satisfies `usableForAssessment`; the admission gate is the only thing that refuses it.",
      },
    ),

    scenario(
      "duplicates",
      "the same cycle identity twice",
      // Both rows of each colliding pair are excluded. A single pair measures 2/21 ≈ 9.5%
      // and crosses the 5% bar; three pairs exercise repeated collisions.
      [...valid(20), renumber(valid(20)[3]!, 3), renumber(valid(20)[5]!, 5), renumber(valid(20)[7]!, 7)],
      {
        dataRows: 23,
        // The contract and assessment core both reject all colliding rows; no row wins by file order.
        acceptedRows: 17,
        rejectedRows: 6,
        codes: ["NH-DC-2016"],
        usableForAssessment: true,
        admission: "NOT_ADMISSIBLE",
        why: "All rows claiming a duplicate cycle identity are rejected, regardless of file order.",
      },
    ),

    scenario(
      "narrow-coverage",
      "all obligations inside a single week",
      Array.from({ length: 15 }, (_, i) =>
        renumber(
          {
            ...base,
            signed_at: "2026-01-05",
            activation_at: "",
            next_invoice_due_at: day("2026-02-04", i % 4),
            next_invoice_paid_at: "",
            paid_amount: "",
          },
          300 + i,
        ),
      ),
      {
        dataRows: 15,
        acceptedRows: 15,
        rejectedRows: 0,
        codes: [],
        usableForAssessment: true,
        // Coverage span and the required `reference` lifecycle state both fail: every row stalls.
        admission: "NOT_ADMISSIBLE",
        why: "A valid file can still be too narrow in time, and carry only one lifecycle state.",
      },
    ),

    withOneDefect(
      "timezone-less",
      "a wall-clock timestamp with no UTC offset",
      { signed_at: "2026-01-05 09:30:00" },
      "NH-DC-2005",
      "A local timestamp cannot be placed on a timeline; it is refused rather than assumed to be UTC.",
    ),

    withOneDefect(
      "refund-no-date",
      "a refund state with no effective date",
      { refunded: "true", refunded_at: "", next_invoice_amount: "1000.00", paid_amount: "1000.00" },
      "NH-DC-2014",
      "A reversal with no date cannot be placed before or after the as-of cutoff, so it is refused.",
    ),

    withOneDefect(
      "overpaid",
      "a settled amount larger than the obligation",
      { next_invoice_amount: "1000.00", paid_amount: "2500.00" },
      "NH-DC-2013",
      "Paying more than was owed is a source-data defect, not a negative obligation to net off.",
    ),

    scenario(
      "partial-payments",
      "settled below the obligation, and refunds and cancellations either side of the cutoff",
      [
        ...valid(24),
        // All five are STALLED (no activation), so they land in the cohort the observed summary is
        // computed over — otherwise their payment states would never reach a finding and the
        // point-in-time rules below would be asserted against nothing.
        //
        // Partially paid: must never enter the unpaid headline.
        renumber({ ...base, activation_at: "", next_invoice_amount: "1000.00", paid_amount: "400.00", next_invoice_paid_at: "2026-02-05" }, 401),
        // Refunded BEFORE the cutoff → visible as Refunded at 2026-03-01.
        renumber({ ...base, activation_at: "", next_invoice_amount: "900.00", paid_amount: "900.00", next_invoice_paid_at: "2026-02-03", refunded: "true", refunded_at: "2026-02-20" }, 402),
        // Refunded AFTER the cutoff → the refund must be INVISIBLE at 2026-03-01.
        renumber({ ...base, activation_at: "", next_invoice_amount: "800.00", paid_amount: "800.00", next_invoice_paid_at: "2026-02-03", refunded: "true", refunded_at: "2026-06-20" }, 403),
        // Cancelled before the cutoff → visible as Cancelled.
        renumber({ ...base, activation_at: "", next_invoice_amount: "700.00", paid_amount: "", next_invoice_paid_at: "", cancelled_at: "2026-02-10" }, 404),
        // Cancelled after the cutoff → invisible at 2026-03-01, so the obligation still reads Unpaid.
        renumber({ ...base, activation_at: "", next_invoice_amount: "600.00", paid_amount: "", next_invoice_paid_at: "", cancelled_at: "2026-07-10" }, 405),
      ],
      {
        dataRows: 29,
        acceptedRows: 29,
        rejectedRows: 0,
        codes: [],
        usableForAssessment: true,
        admission: "ADMISSIBLE",
        why: "Point-in-time classification: a reversal after the cutoff must not be visible at that cutoff, and a partial payment is never a full unpaid obligation.",
      },
    ),
  ]);
}

/** One scenario by id. Throws rather than returning undefined: a typo must fail loudly in a test. */
export function syntheticScenario(id: string): SyntheticScenario {
  const found = syntheticScenarios().find((s) => s.id === id);
  if (!found) throw new Error(`no synthetic scenario '${id}' (have: ${syntheticScenarios().map((s) => s.id).join(", ")})`);
  return found;
}
