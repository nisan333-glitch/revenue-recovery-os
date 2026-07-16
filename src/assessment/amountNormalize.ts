// Amount normalization — turns a FORMATTED money string from a real export into a plain decimal
// string, or fails LOUDLY. It mirrors dateNormalize: self-disambiguating cases are resolved, genuine
// grouping/decimal ambiguity requires an explicit format, and nothing is ever silently guessed.
//
// It deliberately does NOT build Money. The single, strict decimal->minor boundary stays `fromDecimal`
// (src/domain/money.ts), which still enforces the currency's minor-unit precision (no rounding). This
// module only produces the plain `[-]d+(.d+)?` string that `fromDecimal` accepts.
//
// Handled: currency symbols, ISO code suffix/prefix, thousands/decimal separators, whitespace grouping
// (ASCII space + NBSP / narrow NBSP / thin space, all matched by \s), a leading "+", and accounting
// parentheses = negative.

export type AmountFormat = "US" | "EU"; // US: 1,234.56 · EU: 1.234,56

export type AmountResult =
  | { ok: true; decimal: string }
  | { ok: false; reason: "invalid_amount" | "ambiguous_amount"; detail: string };

const CURRENCY_SYMBOLS = /[$€£₪¥]/g; // $ € £ ₪ ¥

function fail(reason: "invalid_amount" | "ambiguous_amount", detail: string): AmountResult {
  return { ok: false, reason, detail };
}

export function normalizeAmount(input: string, opts: { format?: AmountFormat } = {}): AmountResult {
  const original = input ?? "";
  let s = original.trim();
  if (s === "") return fail("invalid_amount", "empty");

  // Accounting negative: matched parentheses around the whole value.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Strip currency symbols, an ISO code prefix/suffix, and a leading sign.
  s = s.replace(CURRENCY_SYMBOLS, "");
  s = s.replace(/^[A-Za-z]{3}\s*/, "").replace(/\s*[A-Za-z]{3}$/, ""); // e.g. "USD 1,200" / "1,200 USD"
  s = s.trim();
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/\s/g, ""); // remaining whitespace (incl. NBSP/thin) is only ever grouping — safe to drop
  if (s === "") return fail("invalid_amount", original);

  // Only digits and at most the two separators may remain.
  if (!/^[0-9.,]+$/.test(s)) return fail("invalid_amount", original);

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let intPart: string;
  let fracPart = "";

  if (hasComma && hasDot) {
    // The LAST-occurring separator is the decimal point; the other is grouping.
    const decSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const groupSep = decSep === "," ? "." : ",";
    const parts = s.split(decSep);
    if (parts.length !== 2) return fail("invalid_amount", original);
    intPart = parts[0]!.split(groupSep).join("");
    fracPart = parts[1]!;
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const groups = s.split(sep);
    const trailing = groups[groups.length - 1]!;
    if (groups.length > 2) {
      // Multiple same separators ⇒ grouping only (e.g. "1.200.000"); no decimals.
      intPart = groups.join("");
    } else if (trailing.length === 3) {
      // Single separator with a 3-digit tail: "1,200" / "1.200" — grouping or decimal? Ambiguous.
      if (!opts.format) return fail("ambiguous_amount", original);
      const sepIsDecimal = (opts.format === "US" && sep === ".") || (opts.format === "EU" && sep === ",");
      if (sepIsDecimal) {
        intPart = groups[0]!;
        fracPart = trailing;
      } else {
        intPart = groups.join("");
      }
    } else {
      // Single separator, non-3-digit tail ⇒ it is the decimal separator.
      intPart = groups[0]!;
      fracPart = trailing;
    }
  } else {
    intPart = s;
  }

  if (!/^\d+$/.test(intPart) || (fracPart !== "" && !/^\d+$/.test(fracPart))) {
    return fail("invalid_amount", original);
  }
  const decimal = (negative ? "-" : "") + intPart + (fracPart !== "" ? `.${fracPart}` : "");
  return { ok: true, decimal };
}
