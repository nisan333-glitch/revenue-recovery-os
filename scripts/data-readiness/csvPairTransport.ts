/**
 * Strict local CSV transport. No schema inference, repair, monetary calculations,
 * persistence or network calls. Governed validators decide semantic validity.
 */
export interface CsvTransport {
  readonly header: readonly string[];
  readonly rows: readonly { readonly rowNumber: number; readonly cells: Readonly<Record<string, string>> }[];
}

export class CsvTransportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CsvTransportError";
  }
}

/** RFC-4180 quotes, embedded newlines, LF/CRLF. Reject malformed or ambiguous transport. */
export function parseStrictCsv(input: string, maxRows = 250_000): CsvTransport {
  if (input.includes("\0")) throw new CsvTransportError("CSV_NUL_BYTE");
  // A MIS-ENCODED FILE IS REFUSED, NOT TRANSLITERATED. `readFileSync(path, "utf8")` does not throw on
  // invalid UTF-8: Node substitutes U+FFFD, so a cp1252 or latin-1 export — ordinary from a European ERP
  // — arrives with its identifiers quietly rewritten. That matters more here than anywhere else, because
  // an identifier is a JOIN KEY: a silently altered one is NH authoring the identity it is supposed to be
  // reading, and it would either refuse a valid row for the wrong reason or match the wrong obligation.
  // The byte sequence EF BF BD is a legitimate U+FFFD and is indistinguishable from a decode failure, so
  // this refuses both. Fail closed and ask for UTF-8.
  if (input.includes("\uFFFD")) throw new CsvTransportError("CSV_NOT_UTF8");
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let started = false;

  const finishField = () => {
    fields.push(field);
    field = "";
    closedQuote = false;
    started = false;
  };
  const finishRecord = () => {
    finishField();
    if (fields.length === 1 && fields[0] === "") throw new CsvTransportError("CSV_EMPTY_RECORD");
    records.push(fields);
    if (records.length > maxRows + 1) throw new CsvTransportError("CSV_ROW_LIMIT");
    fields = [];
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else { field += c; }
      continue;
    }
    if (closedQuote && c !== "," && c !== "\r" && c !== "\n") {
      throw new CsvTransportError("CSV_TRAILING_AFTER_QUOTE");
    }
    if (c === ",") { finishField(); continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      finishRecord();
      continue;
    }
    if (c === '"') {
      if (started || field !== "") throw new CsvTransportError("CSV_UNEXPECTED_QUOTE");
      quoted = true;
      started = true;
      continue;
    }
    field += c;
    started = true;
  }
  if (quoted) throw new CsvTransportError("CSV_UNCLOSED_QUOTE");
  if (field !== "" || fields.length > 0 || closedQuote || started) finishRecord();
  if (records.length === 0) throw new CsvTransportError("CSV_NO_HEADER");

  const header = records[0]!;
  if (header.some((x) => x === "")) throw new CsvTransportError("CSV_EMPTY_HEADER");
  if (new Set(header).size !== header.length) throw new CsvTransportError("CSV_DUPLICATE_HEADER");
  const rows = records.slice(1).map((record, index) => {
    if (record.length !== header.length) throw new CsvTransportError("CSV_RAGGED_RECORD");
    return {
      rowNumber: index + 2, // CSV record ordinal (header is 1)
      cells: Object.fromEntries(header.map((key, i) => [key, record[i]!])),
    };
  });
  return { header, rows };
}
