// Minimal, dependency-free CSV parser. Handles quoted fields, escaped quotes (""), and CRLF/LF.
// It does NOT interpret meaning — it only tokenizes rows and maps them to header-keyed cells. A row
// whose column count does not match the header is flagged `malformed` for the adapter to exclude
// (never silently dropped). Row identity is preserved as `sourceRowId` for provenance.

export const PARSER_VERSION = "csv-2026.1";

export interface RawRow {
  readonly sourceRowId: string; // e.g. "row-2" (1-based data row, header excluded)
  readonly cells: Readonly<Record<string, string>>;
  readonly malformed: boolean; // column count != header count
}

export interface ParsedCsv {
  readonly headers: string[];
  readonly rows: RawRow[];
}

function tokenizeLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// Split into logical CSV records, honoring quoted newlines.
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let cur = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if (c === "\n" && !inQuotes) {
      records.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) records.push(cur);
  return records;
}

export function parseCsv(text: string): ParsedCsv {
  // Strip a leading UTF-8 BOM (﻿). Excel / Google Sheets "Save as CSV UTF-8" prepend one, which
  // would otherwise corrupt the first header cell and silently exclude every row.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = splitRecords(clean).filter((r, idx) => !(idx > 0 && r.trim() === ""));
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = tokenizeLine(records[0]!).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.trim() === "") continue;
    const values = tokenizeLine(records[i]!);
    const malformed = values.length !== headers.length;
    const cells: Record<string, string> = {};
    headers.forEach((h, j) => {
      cells[h] = (values[j] ?? "").trim();
    });
    rows.push({ sourceRowId: `row-${i}`, cells: Object.freeze(cells), malformed });
  }
  return { headers, rows };
}
