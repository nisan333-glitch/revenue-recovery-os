// Money — exact integer minor units (e.g. cents). Trust Invariant #L2 + clarification #3:
// domain money is NEVER a float. Every value and every arithmetic result is validated as a
// safe integer; currency mismatches, fractional minor units and unsafe arithmetic throw
// rather than silently coerce, round or truncate. The abstraction is intentionally small so
// it can be swapped for bigint / a decimal type later WITHOUT changing any business rule.

export interface Money {
  /** Amount in the currency's minor unit (cents). Always a safe integer. */
  readonly minor: number;
  /** ISO 4217 code, e.g. "USD". Explicit — never assumed. */
  readonly currency: string;
}

function assertSafeMinor(minor: number, ctx: string): void {
  if (typeof minor !== "number" || Number.isNaN(minor)) {
    throw new Error(`Money: ${ctx} is not a number (${minor})`);
  }
  if (!Number.isInteger(minor)) {
    throw new Error(`Money: fractional minor units are prohibited (${ctx}=${minor})`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Money: unsafe integer / overflow (${ctx}=${minor})`);
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Money: currency mismatch (${a.currency} vs ${b.currency})`);
  }
}

/** Construct money from minor units. Throws on any non-safe-integer input. */
export function money(minor: number, currency: string): Money {
  assertSafeMinor(minor, "minor");
  if (!currency || typeof currency !== "string") {
    throw new Error(`Money: currency is required (got ${JSON.stringify(currency)})`);
  }
  return Object.freeze({ minor, currency });
}

export function zeroMoney(currency: string): Money {
  return money(0, currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const sum = a.minor + b.minor;
  assertSafeMinor(sum, "sum"); // catches overflow before it becomes silent
  return money(sum, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const diff = a.minor - b.minor;
  assertSafeMinor(diff, "difference");
  return money(diff, a.currency);
}

/** Reporting clamp: never let a negative recovery inflate/deflate a total. Exact, no rounding. */
export function clampNonNegative(m: Money): Money {
  return m.minor < 0 ? zeroMoney(m.currency) : m;
}

export function isNegative(m: Money): boolean {
  return m.minor < 0;
}

export function isPositive(m: Money): boolean {
  return m.minor > 0;
}

/** Signed comparison; throws on currency mismatch (never compares across currencies). */
export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1;
}

export function eqMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

/**
 * DISPLAY ONLY. Rounding/formatting happens here and nowhere else — domain values above
 * stay exact. `exact` shows minor-unit precision; otherwise whole units.
 */
export function formatMoney(m: Money, opts: { exact?: boolean } = {}): string {
  const digits = minorUnitDigits(m.currency); // currency-aware, consistent with fromDecimal
  const major = m.minor / 10 ** digits;
  return major.toLocaleString("en-US", {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: opts.exact ? digits : 0,
    maximumFractionDigits: opts.exact ? digits : 0,
  });
}

// ISO 4217 minor-unit exponents for the currencies the prototype handles. Unknown currencies
// default to 2 (the common case) rather than silently guessing an exotic precision.
const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  USD: 2,
  EUR: 2,
  GBP: 2,
  ILS: 2,
  JPY: 0,
});

/** How many fractional digits `currency` supports (its minor-unit exponent). */
export function minorUnitDigits(currency: string): number {
  const d = MINOR_UNIT_DIGITS[currency];
  return d === undefined ? 2 : d;
}

// Normalize a decimal *input representation* to a plain decimal string, or throw. A JS number is
// accepted for convenience but is treated as inherently lossy: anything that stringifies to
// exponential notation (very large/small) or is non-finite is rejected as ambiguous rather than
// coerced. Strings are the preferred, unambiguous form.
function decimalStringOf(value: number | string): string {
  if (typeof value === "string") return value.trim();
  if (!Number.isFinite(value)) {
    throw new Error(`Money.fromDecimal: non-finite input (${value})`);
  }
  const s = String(value);
  if (/[eE]/.test(s)) {
    throw new Error(`Money.fromDecimal: ambiguous exponential input (${s}); pass a plain decimal string`);
  }
  return s;
}

/**
 * THE SINGLE, EXPLICIT boundary from a provisional decimal input to domain Money (transition
 * rule #2). There is deliberately NO other float→minor path in the system. It:
 *   • accepts a decimal input representation (string preferred; number tolerated but re-checked),
 *   • rejects anything that is not a plain signed decimal (ambiguous precision fails closed),
 *   • rejects MORE fractional digits than the currency's minor unit supports (no silent rounding),
 *   • builds minor units by exact string composition — never `value * 100` float arithmetic,
 *   • validates the result is a safe integer (via `money`), and
 *   • is covered by tests (see money.fromDecimal.test.ts).
 * The conversion boundary is intentionally loud: callers convert once, at the UI/input edge, and
 * everything downstream is exact integer Money.
 */
export function fromDecimal(value: number | string, currency: string): Money {
  if (!currency || typeof currency !== "string") {
    throw new Error(`Money.fromDecimal: currency is required (got ${JSON.stringify(currency)})`);
  }
  const digits = minorUnitDigits(currency);
  const s = decimalStringOf(value);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    throw new Error(`Money.fromDecimal: not a plain decimal amount (${JSON.stringify(value)})`);
  }
  const negative = m[1] === "-";
  const intPart = m[2] as string;
  const fracPart = m[3] ?? "";
  if (fracPart.length > digits) {
    throw new Error(
      `Money.fromDecimal: ${fracPart.length} fractional digit(s) exceed ${currency} minor-unit precision (${digits}) — refusing to round ${JSON.stringify(value)}`,
    );
  }
  const paddedFrac = fracPart.padEnd(digits, "0");
  const minorMagnitude = Number(`${intPart}${paddedFrac}`);
  const minor = negative ? -minorMagnitude : minorMagnitude;
  // money() re-asserts safe-integer; -0 collapses to 0 through the arithmetic above.
  return money(minor, currency);
}
