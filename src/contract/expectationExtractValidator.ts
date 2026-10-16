// THE PURE EXPECTATION-EXTRACT VALIDATOR.
//
// Pure in the strong sense: no I/O, no persistence, no network — and NO CLOCK. Every temporal check is
// relative to the governed terms the caller supplies, never to `Date.now()`, because a validator that
// consults the wall clock gives a different verdict tomorrow for the same bytes, and rule 5 of the
// Trust Invariant requires a historical judgement to stay reproducible forever.
//
// WHAT IT REFUSES AND WHAT IT MERELY REPORTS. Three severities, and the middle distinction is the
// whole design:
//   • an EXTRACT-level fault makes the file unusable;
//   • a ROW-level fault QUARANTINES that row — it enters no detector, no union and no recall
//     denominator, and the rest of the extract is unaffected;
//   • a closed CAPABILITY rejects NOTHING. The extract is valid and still measures every dollar the
//     remaining capabilities can reach.
//
// Making a missing optional fact into a dataset rejection would be the easy mistake and it would
// discard real money. Capability gating per detector, never global rejection.
//
// WHAT IT NEVER DOES: repair, default, coerce, reorder or silently drop. An invalid cell is reported
// with a code, and a blank `expected_amount` is an UNKNOWN that stays unknown.
import { normalizeDate, type DateLocale } from "../assessment/dateNormalize";
import { normalizeAmount, type AmountFormat } from "../assessment/amountNormalize";
import { isSupportedCurrency, minorUnitDigits } from "../domain/money";
import { sha256Hex } from "../assessment/fingerprint";
import {
  EXPECTATION_CAPABILITIES, EXPECTATION_EXTRACT_COLUMNS, EXPECTATION_EXTRACT_REF,
  EXPECTATION_EXTRACT_SCHEME, EXPECTATION_REQUIRED_COLUMNS, EXPECTATION_VALIDATION_METHOD_VERSION,
  type ExpectationCapability,
} from "./expectationExtract";
import {
  CAPABILITY_CODES, EXTRACT_CODES, ROW_CODES, UNIT_CAPABILITY_CODES,
} from "./expectationExtractCodes";

/**
 * Governed reading terms. Every one of these decides what the bytes MEAN, so each is supplied by the
 * caller from a governed record and none is inferred from the data — the same rule the analysis-terms
 * governance mechanism enforces for the assessment side.
 */
export interface ExpectationExtractTerms {
  /** The one currency this analysis counts. A row in another currency is EXCLUDED, never converted. */
  readonly currency: string;
  /** Required to read ambiguous numeric dates. Absent ⇒ such dates are refused, never guessed. */
  readonly dateLocale?: DateLocale;
  /** Required to read grouped decimals. Absent ⇒ the default plain-decimal reading. */
  readonly amountFormat?: AmountFormat;
}

/** A row exactly as the source emitted it: cells as text, nothing parsed, nothing trimmed away. */
export interface RawExpectationRow {
  /** 1-based position in the file, used only to report WHICH row — never to choose between rows. */
  readonly rowNumber: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface ExpectationRowRejection {
  readonly rowNumber: number;
  readonly code: string;
  readonly field: string | null;
  readonly detail: string;
}

/**
 * Whether THIS UNIT can be quantified in money. Per-unit rather than per-extract, because an extract
 * may price nine obligations authoritatively and be unable to price the tenth, and a single
 * extract-level flag would have to lie in one direction or the other: claim the whole file is
 * unpriceable, or claim the tenth unit has a figure.
 */
export type UnitMonetaryQuantification = "AVAILABLE" | "UNAVAILABLE_NO_AUTHORITATIVE_AMOUNT";

/**
 * An accepted obligation, normalised. Money is INTEGER MINOR UNITS; `expectedAmountMinor` is `null`
 * when the source declared the amount unknown, and `null` here never means zero.
 */
export interface AcceptedExpectation {
  readonly rowNumber: number;
  readonly entitlementRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly expectedAmountMinor: number | null;
  readonly currency: string;
  readonly payerRef: string | null;
  readonly terminatedAt: string | null;
  readonly pauseStart: string | null;
  readonly pauseEnd: string | null;
  readonly amendedAt: string | null;
  readonly supersedesRef: string | null;
  readonly scheduleLineRef: string | null;
  /** True when another accepted row supersedes this one. A superseded line is NOT a second obligation. */
  readonly superseded: boolean;
  /**
   * SCHEMA PRESENCE AND ROW-LEVEL AVAILABILITY ARE DIFFERENT FACTS, and this field is the second one.
   *
   * `expected_amount` is a required COLUMN — an extract that omits it is unusable. It is NOT a
   * required VALUE: a genuine obligation may exist while its monetary value is not authoritatively
   * priceable, and the expectation does not stop existing because the price is unknown. So a blank
   * cell preserves the row, its non-monetary facts stay in force, and THIS unit's monetary
   * quantification fails closed.
   *
   * What that forecloses, per unit and not per extract: any capability needing an exact figure.
   * Downstream, monetary reconciliation for the unit is NO_RESIDUAL_UNPRICED — never $0.00, which
   * would assert the obligation was checked and found satisfied.
   */
  readonly monetaryQuantification: UnitMonetaryQuantification;
  /** The NH-EX-3006 code when this unit cannot be quantified. An UNKNOWN, never a rejection. */
  readonly monetaryQuantificationCode: string | null;
}

export interface CapabilityDeclaration {
  readonly capability: ExpectationCapability;
  readonly available: boolean;
  /** The NH-EX-3xxx code when closed. An UNKNOWN, never a rejection. */
  readonly unavailableCode: string | null;
}

export interface ExpectationExtractValidation {
  readonly scheme: typeof EXPECTATION_EXTRACT_SCHEME;
  readonly contractRef: typeof EXPECTATION_EXTRACT_REF;
  readonly methodVersion: typeof EXPECTATION_VALIDATION_METHOD_VERSION;
  readonly currency: string;
  /** False when an extract-level fault makes the file unreadable; accepted rows are then empty. */
  readonly usable: boolean;
  readonly extractFaults: readonly { readonly code: string; readonly detail: string }[];
  readonly accepted: readonly AcceptedExpectation[];
  readonly rejections: readonly ExpectationRowRejection[];
  readonly capabilities: readonly CapabilityDeclaration[];
  /** Accepted rows whose amount the source declared UNKNOWN. A COUNT beside the money, never money. */
  readonly unknownAmountCount: number;
  /**
   * The roll-up, and it is allowed to say PARTIAL rather than being forced to lie in one direction.
   * An extract that prices nine obligations and cannot price the tenth is neither quantifiable nor
   * unquantifiable, and collapsing that to a single flag would either discard nine real figures or
   * claim a tenth that does not exist.
   */
  readonly monetaryQuantification: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  /** Exactly which units fail closed, so a caller never has to infer it from a count. */
  readonly unquantifiableUnitRows: readonly number[];
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

const blank = (v: string | undefined): boolean => (v ?? "").trim() === "";
const cell = (row: RawExpectationRow, name: string): string => (row.cells[name] ?? "").trim();

/** Day-granularity comparison on canonical ISO dates, which compare correctly as strings. */
const onOrBefore = (a: string, b: string): boolean => a <= b;

export function validateExpectationExtract(
  header: readonly string[],
  rows: readonly RawExpectationRow[],
  terms: ExpectationExtractTerms,
): ExpectationExtractValidation {
  const extractFaults: { code: string; detail: string }[] = [];

  // ── EXTRACT level ───────────────────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) {
      extractFaults.push({ code: EXTRACT_CODES.DUPLICATE_COLUMN.code, detail: `column "${h}" appears more than once` });
    }
    seen.add(h);
    if (!EXPECTATION_EXTRACT_COLUMNS.includes(h)) {
      extractFaults.push({ code: EXTRACT_CODES.UNDECLARED_COLUMN.code, detail: `column "${h}" is not declared by ${EXPECTATION_EXTRACT_REF}` });
    }
  }
  for (const required of EXPECTATION_REQUIRED_COLUMNS) {
    if (!seen.has(required)) {
      extractFaults.push({ code: EXTRACT_CODES.MISSING_REQUIRED_COLUMN.code, detail: `required column "${required}" is absent` });
    }
  }
  if (rows.length === 0) {
    extractFaults.push({ code: EXTRACT_CODES.EMPTY_EXTRACT.code, detail: "no rows" });
  }

  // An unusable extract yields NO accepted rows and NO capabilities. It deliberately does not fall
  // back to "whatever parsed" — a partial read of a file whose shape is wrong is a guess about which
  // part was meant.
  if (extractFaults.length > 0) {
    return freezeResult({
      currency: terms.currency, usable: false, extractFaults, accepted: [], rejections: [],
      capabilities: EXPECTATION_CAPABILITIES.map((c) => ({
        capability: c.capability, available: false, unavailableCode: c.unavailableCode.code,
      })),
      unknownAmountCount: 0,
      monetaryQuantification: "UNAVAILABLE",
      unquantifiableUnitRows: [],
    });
  }

  // ── ROW level ───────────────────────────────────────────────────────────────────────────────────
  const rejections: ExpectationRowRejection[] = [];
  const reject = (rowNumber: number, code: string, field: string | null, detail: string): void => {
    rejections.push(Object.freeze({ rowNumber, code, field, detail }));
  };

  type Draft = Omit<AcceptedExpectation, "superseded" | "monetaryQuantification" | "monetaryQuantificationCode">;
  const drafts: Draft[] = [];

  for (const row of rows) {
    let failed = false;
    const fail = (code: string, field: string | null, detail: string): void => {
      reject(row.rowNumber, code, field, detail);
      failed = true;
    };

    // Required presence. `expected_amount` is EXEMPT: a blank there is a declared UNKNOWN, and
    // conflating it with a missing value is exactly the defect this contract exists to avoid.
    for (const name of EXPECTATION_REQUIRED_COLUMNS) {
      if (name === "expected_amount") continue;
      if (blank(row.cells[name])) fail(ROW_CODES.MISSING_REQUIRED_VALUE.code, name, "blank");
    }

    const date = (name: string): string | null => {
      const raw = cell(row, name);
      if (raw === "") return null;
      const r = normalizeDate(raw, terms.dateLocale ? { locale: terms.dateLocale } : {});
      if (r.ok) return r.iso;
      fail(
        r.reason === "ambiguous_date" ? ROW_CODES.AMBIGUOUS_DATE.code : ROW_CODES.MALFORMED_DATE.code,
        name, r.detail,
      );
      return null;
    };

    const periodStart = date("period_start");
    const periodEnd = date("period_end");
    const terminatedAt = date("terminated_at");
    const pauseStart = date("pause_start");
    const pauseEnd = date("pause_end");
    const amendedAt = date("amended_at");

    if (periodStart !== null && periodEnd !== null && !onOrBefore(periodStart, periodEnd)) {
      fail(ROW_CODES.PERIOD_END_BEFORE_START.code, "period_end", `${periodEnd} precedes ${periodStart}`);
    }

    // Currency before amount: the minor-unit exponent depends on it, so an unsupported code makes the
    // amount unreadable rather than merely unconverted.
    const currency = cell(row, "currency").toUpperCase();
    if (currency !== "" && !isSupportedCurrency(currency)) {
      fail(ROW_CODES.UNSUPPORTED_CURRENCY.code, "currency", currency);
    } else if (currency !== "" && currency !== terms.currency.toUpperCase()) {
      fail(ROW_CODES.CURRENCY_NOT_GOVERNED.code, "currency", `${currency} is not the governed ${terms.currency}`);
    }

    // AMOUNT. Blank ⇒ UNKNOWN (null). Unparseable ⇒ REJECTED, deliberately NOT treated as unknown:
    // "the source could not state it" and "the source stated something unreadable" are different
    // facts, and collapsing them would let a malformed cell quietly become an UNKNOWN.
    let expectedAmountMinor: number | null = null;
    const rawAmount = cell(row, "expected_amount");
    if (rawAmount !== "") {
      const parsed = normalizeAmount(rawAmount, terms.amountFormat ? { format: terms.amountFormat } : {});
      if (!parsed.ok) {
        fail(ROW_CODES.MALFORMED_AMOUNT.code, "expected_amount", parsed.reason);
      } else {
        const digits = isSupportedCurrency(currency) ? minorUnitDigits(currency) : 2;
        const minor = toMinor(parsed.decimal, digits);
        if (minor === null) {
          fail(ROW_CODES.MALFORMED_AMOUNT.code, "expected_amount", `more precision than ${currency} supports`);
        } else if (minor === 0) {
          // EXPLICIT ZERO is not a blank. Writing 0 asserts that nothing is owed — a claim that
          // satisfies itself against any billing whatsoever — where a blank asserts only that the
          // source cannot price it. Separate code, separate remediation.
          fail(ROW_CODES.EXPLICIT_ZERO_AMOUNT.code, "expected_amount", parsed.decimal);
        } else if (minor < 0) {
          // NEGATIVE is a credit, which belongs to the observation side. A different source error
          // from an explicit zero, so a different code: one is a modelling mistake, the other is a
          // row in the wrong file.
          fail(ROW_CODES.NEGATIVE_AMOUNT.code, "expected_amount", parsed.decimal);
        } else {
          expectedAmountMinor = minor;
        }
      }
    }

    // LIFECYCLE consistency. A pause must be bounded at both ends; an unbounded one would void every
    // later period, so it is refused rather than closed with a date NH chose.
    const hasPauseStart = cell(row, "pause_start") !== "";
    const hasPauseEnd = cell(row, "pause_end") !== "";
    if (hasPauseStart !== hasPauseEnd) {
      fail(ROW_CODES.PAUSE_BOUNDS_INCOMPLETE.code, hasPauseStart ? "pause_end" : "pause_start", "one bound without the other");
    }
    if (pauseStart !== null && pauseEnd !== null && !onOrBefore(pauseStart, pauseEnd)) {
      fail(ROW_CODES.PAUSE_END_BEFORE_START.code, "pause_end", `${pauseEnd} precedes ${pauseStart}`);
    }

    const supersedesRef = cell(row, "supersedes_ref") || null;
    const scheduleLineRef = cell(row, "schedule_line_ref") || null;
    if (supersedesRef !== null && cell(row, "amended_at") === "") {
      fail(ROW_CODES.AMENDMENT_WITHOUT_DATE.code, "amended_at", "supersession with no effective date");
    }
    if (supersedesRef !== null && scheduleLineRef !== null && supersedesRef === scheduleLineRef) {
      fail(ROW_CODES.SUPERSEDES_SELF.code, "supersedes_ref", supersedesRef);
    }

    if (failed) continue;
    drafts.push({
      rowNumber: row.rowNumber,
      entitlementRef: cell(row, "entitlement_ref"),
      periodStart: periodStart!,
      periodEnd: periodEnd!,
      expectedAmountMinor,
      currency,
      payerRef: cell(row, "payer_ref") || null,
      terminatedAt, pauseStart, pauseEnd, amendedAt, supersedesRef, scheduleLineRef,
    });
  }

  // ── CROSS-ROW: identity and cardinality ─────────────────────────────────────────────────────────
  //
  // Duplicate schedule-line identity. ALL rows sharing it are quarantined — not the later one, not the
  // defective one, and no survivor is chosen by file position. Reordering the file must not change the
  // accepted population: the pilot-dataset collision rule, which exists because file order is the
  // author's lever.
  const byLine = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.scheduleLineRef === null) continue;
    const list = byLine.get(d.scheduleLineRef) ?? [];
    list.push(d);
    byLine.set(d.scheduleLineRef, list);
  }
  const quarantined = new Set<number>();
  for (const [ref, list] of byLine) {
    if (list.length > 1) {
      for (const d of list) {
        reject(d.rowNumber, ROW_CODES.DUPLICATE_SCHEDULE_LINE.code, "schedule_line_ref", `${list.length} rows share "${ref}"`);
        quarantined.add(d.rowNumber);
      }
    }
  }

  // Contradictory termination: one entitlement ends once.
  const terminationByEntitlement = new Map<string, Set<string>>();
  for (const d of drafts) {
    if (d.terminatedAt === null) continue;
    const set = terminationByEntitlement.get(d.entitlementRef) ?? new Set<string>();
    set.add(d.terminatedAt);
    terminationByEntitlement.set(d.entitlementRef, set);
  }
  for (const d of drafts) {
    const set = terminationByEntitlement.get(d.entitlementRef);
    if (set && set.size > 1) {
      reject(d.rowNumber, ROW_CODES.CONTRADICTORY_TERMINATION.code, "terminated_at",
        `entitlement "${d.entitlementRef}" carries ${set.size} termination dates`);
      quarantined.add(d.rowNumber);
    }
  }

  // Supersession must resolve WITHIN the extract, and the lineage must be an ordering.
  const liveRefs = new Set(drafts.filter((d) => !quarantined.has(d.rowNumber) && d.scheduleLineRef !== null)
    .map((d) => d.scheduleLineRef!));
  const parentOf = new Map<string, string>();
  for (const d of drafts) {
    if (quarantined.has(d.rowNumber) || d.supersedesRef === null) continue;
    if (!liveRefs.has(d.supersedesRef)) {
      reject(d.rowNumber, ROW_CODES.SUPERSEDES_UNRESOLVED.code, "supersedes_ref", `"${d.supersedesRef}" is not a schedule line in this extract`);
      quarantined.add(d.rowNumber);
      continue;
    }
    if (d.scheduleLineRef !== null) parentOf.set(d.scheduleLineRef, d.supersedesRef);
  }
  for (const d of drafts) {
    if (quarantined.has(d.rowNumber) || d.scheduleLineRef === null) continue;
    const walked = new Set<string>([d.scheduleLineRef]);
    let at = parentOf.get(d.scheduleLineRef);
    while (at !== undefined) {
      if (walked.has(at)) {
        reject(d.rowNumber, ROW_CODES.SUPERSESSION_CYCLE.code, "supersedes_ref", `lineage starting at [${d.scheduleLineRef}] returns to [${at}]`);
        quarantined.add(d.rowNumber);
        break;
      }
      walked.add(at);
      at = parentOf.get(at);
    }
  }

  const supersededRefs = new Set<string>();
  for (const d of drafts) {
    if (!quarantined.has(d.rowNumber) && d.supersedesRef !== null) supersededRefs.add(d.supersedesRef);
  }

  // Two UNSUPERSEDED lines claiming one (entitlement, period). Summing them would state an amount
  // neither line asserts; choosing one would be NH picking the customer's number for them. Both are
  // quarantined — this is the case that manufactures money when the supersession link is missing.
  const byUnit = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (quarantined.has(d.rowNumber)) continue;
    if (d.scheduleLineRef !== null && supersededRefs.has(d.scheduleLineRef)) continue; // retired by an amendment
    const k = `${d.entitlementRef}|${d.periodStart}|${d.periodEnd}`;
    const list = byUnit.get(k) ?? [];
    list.push(d);
    byUnit.set(k, list);
  }
  for (const [k, list] of byUnit) {
    if (list.length > 1) {
      for (const d of list) {
        reject(d.rowNumber, ROW_CODES.AMBIGUOUS_LIVE_LINES.code, null, `${list.length} unsuperseded lines claim "${k}"`);
        quarantined.add(d.rowNumber);
      }
    }
  }

  const accepted: AcceptedExpectation[] = drafts
    .filter((d) => !quarantined.has(d.rowNumber))
    .map((d) => Object.freeze({
      ...d,
      superseded: d.scheduleLineRef !== null && supersededRefs.has(d.scheduleLineRef),
      monetaryQuantification: (d.expectedAmountMinor === null
        ? "UNAVAILABLE_NO_AUTHORITATIVE_AMOUNT"
        : "AVAILABLE") as UnitMonetaryQuantification,
      monetaryQuantificationCode: d.expectedAmountMinor === null
        ? UNIT_CAPABILITY_CODES.MONETARY_QUANTIFICATION_UNAVAILABLE.code
        : null,
    }));

  // ── CAPABILITIES · fail-closed, each on its own basis ───────────────────────────────────────────
  const capabilities = EXPECTATION_CAPABILITIES.map((spec): CapabilityDeclaration => {
    const declared = spec.fields.every((f) => seen.has(f));
    const populated = declared && accepted.length > 0
      && spec.fields.every((f) => accepted.every((a) => valueOf(a, f) !== null));
    const available = spec.basis === "column_declared" ? declared : populated;
    return Object.freeze({
      capability: spec.capability,
      available,
      unavailableCode: available ? null : spec.unavailableCode.code,
    });
  });

  // A superseded line is not an obligation, so it is neither priced nor unpriced for this purpose.
  const live = accepted.filter((a) => !a.superseded);
  const unquantifiable = live.filter((a) => a.monetaryQuantification !== "AVAILABLE");
  return freezeResult({
    currency: terms.currency, usable: true, extractFaults, accepted, rejections, capabilities,
    unknownAmountCount: unquantifiable.length,
    monetaryQuantification: live.length === 0 || unquantifiable.length === live.length
      ? "UNAVAILABLE"
      : unquantifiable.length === 0 ? "AVAILABLE" : "PARTIAL",
    unquantifiableUnitRows: Object.freeze(unquantifiable.map((a) => a.rowNumber)),
  });
}

/** Field access for the capability check, by declared column name. */
function valueOf(a: AcceptedExpectation, fieldName: string): string | null {
  switch (fieldName) {
    case "payer_ref": return a.payerRef;
    case "terminated_at": return a.terminatedAt;
    case "pause_start": return a.pauseStart;
    case "pause_end": return a.pauseEnd;
    case "supersedes_ref": return a.supersedesRef;
    case "amended_at": return a.amendedAt;
    case "schedule_line_ref": return a.scheduleLineRef;
    default: return null;
  }
}

/**
 * Decimal string → integer minor units, EXACTLY. `null` when the value carries more precision than
 * the currency supports, because rounding a cent is how a reconciliation acquires a residual nobody
 * can explain.
 */
function toMinor(decimal: string, digits: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) return null;
  const frac = m[3] ?? "";
  if (frac.length > digits) return null;
  const padded = frac.padEnd(digits, "0");
  const whole = `${m[2]}${padded}`;
  const n = Number(whole);
  if (!Number.isSafeInteger(n)) return null;
  return m[1] === "-" ? -n : n;
}

function freezeResult(parts: {
  currency: string;
  usable: boolean;
  extractFaults: readonly { readonly code: string; readonly detail: string }[];
  accepted: readonly AcceptedExpectation[];
  rejections: readonly ExpectationRowRejection[];
  capabilities: readonly CapabilityDeclaration[];
  unknownAmountCount: number;
  monetaryQuantification: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unquantifiableUnitRows: readonly number[];
}): ExpectationExtractValidation {
  return Object.freeze({
    scheme: EXPECTATION_EXTRACT_SCHEME,
    contractRef: EXPECTATION_EXTRACT_REF,
    methodVersion: EXPECTATION_VALIDATION_METHOD_VERSION,
    currency: parts.currency,
    usable: parts.usable,
    extractFaults: Object.freeze(parts.extractFaults.map((f) => Object.freeze(f))),
    accepted: Object.freeze([...parts.accepted]),
    rejections: Object.freeze([...parts.rejections]),
    capabilities: Object.freeze([...parts.capabilities]),
    unknownAmountCount: parts.unknownAmountCount,
    monetaryQuantification: parts.monetaryQuantification,
    unquantifiableUnitRows: Object.freeze([...parts.unquantifiableUnitRows]),
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      constitutesProof: false as const,
      constitutesRevenue: false as const,
    }),
  });
}

/**
 * `sha256:<hex>` over the scheme, the method version, the governed terms, the header, every raw cell
 * and the whole verdict — so a validation is independently re-derivable from the bytes that produced
 * it, rather than merely asserted. The terms are included because they decide what the bytes MEAN:
 * the same file under a different governed currency is a different verdict, and a witness that hid
 * that would be a hash of the data pretending to be a hash of the judgement.
 */
export async function expectationValidationWitness(
  header: readonly string[],
  rows: readonly RawExpectationRow[],
  terms: ExpectationExtractTerms,
  result: ExpectationExtractValidation,
): Promise<string> {
  const canonical = JSON.stringify({
    scheme: EXPECTATION_EXTRACT_SCHEME,
    contractRef: EXPECTATION_EXTRACT_REF,
    methodVersion: EXPECTATION_VALIDATION_METHOD_VERSION,
    terms: {
      currency: terms.currency,
      dateLocale: terms.dateLocale ?? null,
      amountFormat: terms.amountFormat ?? null,
    },
    header: [...header],
    rows: rows.map((r) => [r.rowNumber, EXPECTATION_EXTRACT_COLUMNS.map((c) => r.cells[c] ?? null)]),
    verdict: {
      usable: result.usable,
      extractFaults: result.extractFaults.map((f) => [f.code, f.detail]),
      accepted: result.accepted.map((a) => [
        a.rowNumber, a.entitlementRef, a.periodStart, a.periodEnd, a.expectedAmountMinor, a.currency,
        a.payerRef, a.terminatedAt, a.pauseStart, a.pauseEnd, a.amendedAt, a.supersedesRef,
        a.scheduleLineRef, a.superseded, a.monetaryQuantification, a.monetaryQuantificationCode,
      ]),
      rejections: result.rejections.map((r) => [r.rowNumber, r.code, r.field]),
      capabilities: result.capabilities.map((c) => [c.capability, c.available, c.unavailableCode]),
      unknownAmountCount: result.unknownAmountCount,
      monetaryQuantification: result.monetaryQuantification,
      unquantifiableUnitRows: [...result.unquantifiableUnitRows],
    },
  });
  return `sha256:${await sha256Hex(canonical)}`;
}

/** Codes a caller may surface for a closed capability, without reaching into the catalogue. */
export const CAPABILITY_UNAVAILABLE_CODES: readonly string[] = Object.freeze(
  Object.values(CAPABILITY_CODES).map((c) => c.code),
);
