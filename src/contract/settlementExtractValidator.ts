// THE SETTLEMENT EXTRACT VALIDATOR — pure, clockless, and it computes no money.
//
// It answers one question per row — can this settlement be trusted as stated? — and one question per
// capability — did the source supply the fact this capability needs? It never reconciles, never
// compares against an expectation, never totals a residual and never derives an obligation reference.
//
// NO CLOCK. Asserted on source by its own test, as the expectation validator already is: a validator
// that reads the wall clock would give two different answers for the same bytes, which breaks the
// promise that historical proof stays reproducible.
//
// THE ASYMMETRY WITH THE EXPECTATION SIDE, stated once because it looks like an inconsistency and is
// not: `expected_amount` may be a declared UNKNOWN that PRESERVES its row, while `settled_amount` may
// not. What was OWED can genuinely be unknown — a usage line the contract system cannot price. What was
// BILLED cannot be: a billing system that cannot value its own line cannot evidence it, and treating a
// blank as UNKNOWN here would let an unvalued line sit in the accepted population contributing nothing
// while implying it had been checked.
import {
  SETTLEMENT_CAPABILITIES, SETTLEMENT_EXTRACT_COLUMNS, SETTLEMENT_EXTRACT_REF,
  SETTLEMENT_EXTRACT_SCHEME, SETTLEMENT_REQUIRED_COLUMNS, SETTLEMENT_VALIDATION_METHOD_VERSION,
  type SettlementCapability,
} from "./settlementExtract";
import {
  SETTLEMENT_EXTRACT_CODES, SETTLEMENT_ROW_CODES,
} from "./settlementExtractCodes";

/** The caller's declared reading. It states how to PARSE, never what to trust. */
export interface SettlementExtractTerms {
  /** Expected ISO currency for the analysis. A row in another currency is reported, never converted. */
  readonly currency: string;
}

export interface RawSettlementRow {
  /** 1-based position in the file, for reporting only. It decides nothing. */
  readonly rowNumber: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface SettlementRowRejection {
  readonly rowNumber: number;
  readonly code: string;
  readonly field: string | null;
  readonly detail: string;
}

export interface AcceptedSettlement {
  readonly rowNumber: number;
  readonly invoiceRef: string;
  readonly invoiceLineRef: string;
  readonly settledAt: string;
  readonly settledAmountMinor: number;
  readonly currency: string;
  readonly payerRef: string;
  /** null means NOT STATED. Never a derived value, and never a placeholder. */
  readonly obligationRef: string | null;
  /** A credit is not a billing event. False when the column is absent — the declared meaning of blank. */
  readonly isCredit: boolean;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly legacySubscriptionRef: string | null;
  readonly sourceSystem: string | null;
  /** True when this row's currency differs from the governed one. Reported, never converted. */
  readonly currencyMismatch: boolean;
}

export interface SettlementCapabilityDeclaration {
  readonly capability: SettlementCapability;
  readonly available: boolean;
  /** The NH-SX-3xxx code when closed. An UNKNOWN, never a rejection. */
  readonly unavailableCode: string | null;
  /** How many accepted rows carry the fact, where the basis is per-row. null when column-declared. */
  readonly populatedRows: number | null;
  readonly acceptedRows: number | null;
}

export interface SettlementExtractValidation {
  readonly scheme: typeof SETTLEMENT_EXTRACT_SCHEME;
  readonly contractRef: typeof SETTLEMENT_EXTRACT_REF;
  readonly methodVersion: typeof SETTLEMENT_VALIDATION_METHOD_VERSION;
  readonly currency: string;
  /** False when an extract-level fault makes the file unreadable; accepted rows are then empty. */
  readonly usable: boolean;
  readonly extractFaults: readonly { readonly code: string; readonly detail: string }[];
  readonly accepted: readonly AcceptedSettlement[];
  readonly rejections: readonly SettlementRowRejection[];
  readonly capabilities: readonly SettlementCapabilityDeclaration[];
  /** Accepted rows in a currency other than the governed one. A COUNT, never a conversion. */
  readonly currencyMismatchCount: number;
  /** Accepted rows the source marked as credits. Counted apart, never netted into billed money. */
  readonly creditRowCount: number;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

const blank = (v: string | undefined): boolean => (v ?? "").trim() === "";
const cell = (row: RawSettlementRow, name: string): string => (row.cells[name] ?? "").trim();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Minor units, or null when unparseable. Never rounded, never normalised, never guessed. */
function toMinor(text: string): number | null {
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const n = Number(`${m[2]}${(m[3] ?? "").padEnd(2, "0")}`);
  if (!Number.isSafeInteger(n)) return null;
  return m[1] === "-" ? -n : n;
}

/**
 * Validate a settlement extract.
 *
 * `declaredColumns` is the file's header as it actually arrived — passed in rather than inferred from
 * the rows, because a schema inferred from a sample of its own rows is how a column gets silently
 * dropped. That is the transport defect the V3 benchmark revision exists to correct, and the same rule
 * applies on the way in.
 */
export function validateSettlementExtract(
  declaredColumns: readonly string[],
  rows: readonly RawSettlementRow[],
  terms: SettlementExtractTerms,
): SettlementExtractValidation {
  const currency = terms.currency.trim().toUpperCase();
  const extractFaults: { code: string; detail: string }[] = [];

  // ── extract-level faults ────────────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  for (const c of declaredColumns) {
    if (seen.has(c)) {
      extractFaults.push({ code: SETTLEMENT_EXTRACT_CODES.DUPLICATE_COLUMN.code, detail: `column "${c}" appears more than once` });
    }
    seen.add(c);
    if (!SETTLEMENT_EXTRACT_COLUMNS.includes(c)) {
      extractFaults.push({ code: SETTLEMENT_EXTRACT_CODES.UNDECLARED_COLUMN.code, detail: `column "${c}" is not declared by ${SETTLEMENT_EXTRACT_REF}` });
    }
  }
  for (const need of SETTLEMENT_REQUIRED_COLUMNS) {
    if (!seen.has(need)) {
      extractFaults.push({ code: SETTLEMENT_EXTRACT_CODES.MISSING_REQUIRED_COLUMN.code, detail: `required column "${need}" is absent` });
    }
  }
  if (rows.length === 0) {
    extractFaults.push({ code: SETTLEMENT_EXTRACT_CODES.EMPTY_EXTRACT.code, detail: "the extract contains no rows" });
  }

  if (extractFaults.length > 0) {
    // An unusable extract declares every capability CLOSED rather than silent. "We could not read the
    // file" must never arrive as "the capability is available", which is the capability-reporting rule.
    return Object.freeze({
      scheme: SETTLEMENT_EXTRACT_SCHEME,
      contractRef: SETTLEMENT_EXTRACT_REF,
      methodVersion: SETTLEMENT_VALIDATION_METHOD_VERSION,
      currency,
      usable: false,
      extractFaults: Object.freeze(extractFaults.map((f) => Object.freeze(f))),
      accepted: Object.freeze([]),
      rejections: Object.freeze([]),
      capabilities: Object.freeze(SETTLEMENT_CAPABILITIES.map((c) => Object.freeze({
        capability: c.capability, available: false, unavailableCode: c.unavailableCode.code,
        populatedRows: null, acceptedRows: null,
      }))),
      currencyMismatchCount: 0,
      creditRowCount: 0,
      claimBoundary: Object.freeze({ observationOnly: true as const, constitutesProof: false as const, constitutesRevenue: false as const }),
    });
  }

  // ── row-level validation ────────────────────────────────────────────────────────────────────────
  const rejections: SettlementRowRejection[] = [];
  const reject = (rowNumber: number, code: string, field: string | null, detail: string) =>
    rejections.push(Object.freeze({ rowNumber, code, field, detail }));

  const hasCredit = seen.has("is_credit");
  const hasPeriod = seen.has("period_start") && seen.has("period_end");

  /**
   * SETTLEMENT-LINE IDENTITY COLLISIONS, resolved the way the pilot-dataset collision rule requires:
   * ALL rows sharing an identity are excluded, regardless of order or identical content. Accepting the
   * first would let the file author choose which survives by reordering, and that choice can change the
   * measured amount. Computed BEFORE acceptance so no surviving row can be chosen by file position.
   */
  const identityCount = new Map<string, number>();
  for (const row of rows) {
    const key = `${cell(row, "invoice_ref")}\u0000${cell(row, "invoice_line_ref")}`;
    identityCount.set(key, (identityCount.get(key) ?? 0) + 1);
  }

  const accepted: AcceptedSettlement[] = [];
  for (const row of rows) {
    let bad = false;
    const fail = (code: string, field: string | null, detail: string) => { reject(row.rowNumber, code, field, detail); bad = true; };

    for (const need of SETTLEMENT_REQUIRED_COLUMNS) {
      if (blank(cell(row, need))) fail(SETTLEMENT_ROW_CODES.MISSING_REQUIRED_VALUE.code, need, `"${need}" is blank`);
    }
    if (bad) continue;

    const invoiceRef = cell(row, "invoice_ref");
    const invoiceLineRef = cell(row, "invoice_line_ref");
    const settledAt = cell(row, "settled_at");
    const rowCurrency = cell(row, "currency").toUpperCase();

    if (!ISO_DATE.test(settledAt)) fail(SETTLEMENT_ROW_CODES.MALFORMED_DATE.code, "settled_at", `"${settledAt}" is not YYYY-MM-DD`);
    if (!ISO_CURRENCY.test(rowCurrency)) fail(SETTLEMENT_ROW_CODES.CURRENCY_NOT_ISO.code, "currency", `"${rowCurrency}" is not a three-letter ISO code`);

    const minor = toMinor(cell(row, "settled_amount"));
    if (minor === null) fail(SETTLEMENT_ROW_CODES.MALFORMED_AMOUNT.code, "settled_amount", `"${cell(row, "settled_amount")}" is not a decimal with at most two fractional digits`);

    const isCredit = hasCredit && ["true", "yes", "1"].includes(cell(row, "is_credit").toLowerCase());
    if (minor !== null && minor < 0 && !isCredit) {
      fail(SETTLEMENT_ROW_CODES.NEGATIVE_AMOUNT_NOT_MARKED_CREDIT.code, "settled_amount",
        "a negative amount is a credit and must be marked as one, or it would be netted into billed money");
    }

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    if (hasPeriod) {
      const ps = cell(row, "period_start");
      const pe = cell(row, "period_end");
      if (!blank(ps) && !ISO_DATE.test(ps)) fail(SETTLEMENT_ROW_CODES.MALFORMED_DATE.code, "period_start", `"${ps}" is not YYYY-MM-DD`);
      if (!blank(pe) && !ISO_DATE.test(pe)) fail(SETTLEMENT_ROW_CODES.MALFORMED_DATE.code, "period_end", `"${pe}" is not YYYY-MM-DD`);
      if (!blank(ps) && !blank(pe) && ISO_DATE.test(ps) && ISO_DATE.test(pe) && pe < ps) {
        fail(SETTLEMENT_ROW_CODES.PERIOD_END_BEFORE_START.code, "period_end", `${pe} precedes ${ps}`);
      }
      periodStart = blank(ps) ? null : ps;
      periodEnd = blank(pe) ? null : pe;
    }

    const key = `${invoiceRef}\u0000${invoiceLineRef}`;
    if ((identityCount.get(key) ?? 0) > 1) {
      fail(SETTLEMENT_ROW_CODES.DUPLICATE_SETTLEMENT_LINE_IDENTITY.code, "invoice_line_ref",
        `(${invoiceRef}, ${invoiceLineRef}) appears on ${identityCount.get(key)} rows; ALL are excluded so no surviving row is chosen by file position`);
    }

    if (bad) continue;

    const obligationRef = seen.has("obligation_ref") && !blank(cell(row, "obligation_ref"))
      ? cell(row, "obligation_ref") : null;

    accepted.push(Object.freeze({
      rowNumber: row.rowNumber,
      invoiceRef, invoiceLineRef, settledAt,
      settledAmountMinor: minor!,
      currency: rowCurrency,
      payerRef: cell(row, "payer_ref"),
      obligationRef,
      isCredit,
      periodStart, periodEnd,
      legacySubscriptionRef: seen.has("legacy_subscription_ref") && !blank(cell(row, "legacy_subscription_ref")) ? cell(row, "legacy_subscription_ref") : null,
      sourceSystem: seen.has("source_system") && !blank(cell(row, "source_system")) ? cell(row, "source_system") : null,
      currencyMismatch: rowCurrency !== currency,
    }));
  }

  // ── capabilities · FAIL-CLOSED, and never from a subset of the facts they need ──────────────────
  const capabilities = SETTLEMENT_CAPABILITIES.map((spec) => {
    const columnsPresent = spec.fields.length > 0 && spec.fields.every((f) => seen.has(f));
    if (spec.basis === "column_declared") {
      return Object.freeze({
        capability: spec.capability,
        available: columnsPresent,
        unavailableCode: columnsPresent ? null : spec.unavailableCode.code,
        populatedRows: null, acceptedRows: null,
      });
    }
    // populated_on_every_row · a blank carries no information here, so a PARTIAL column is not the
    // capability. Reported with its counts so a customer can see how far off they are.
    if (spec.fields.length === 0) {
      // Declared with no field on this extract — the fact is not billing's to state. Always closed.
      return Object.freeze({
        capability: spec.capability, available: false, unavailableCode: spec.unavailableCode.code,
        populatedRows: null, acceptedRows: null,
      });
    }
    const populated = accepted.filter((a) => spec.fields.every((f) => {
      if (f === "obligation_ref") return a.obligationRef !== null;
      return true;
    })).length;
    const available = columnsPresent && accepted.length > 0 && populated === accepted.length;
    return Object.freeze({
      capability: spec.capability,
      available,
      unavailableCode: available ? null : spec.unavailableCode.code,
      populatedRows: populated,
      acceptedRows: accepted.length,
    });
  });

  return Object.freeze({
    scheme: SETTLEMENT_EXTRACT_SCHEME,
    contractRef: SETTLEMENT_EXTRACT_REF,
    methodVersion: SETTLEMENT_VALIDATION_METHOD_VERSION,
    currency,
    usable: true,
    extractFaults: Object.freeze([]),
    accepted: Object.freeze(accepted),
    rejections: Object.freeze(rejections),
    capabilities: Object.freeze(capabilities),
    currencyMismatchCount: accepted.filter((a) => a.currencyMismatch).length,
    creditRowCount: accepted.filter((a) => a.isCredit).length,
    claimBoundary: Object.freeze({ observationOnly: true as const, constitutesProof: false as const, constitutesRevenue: false as const }),
  });
}
