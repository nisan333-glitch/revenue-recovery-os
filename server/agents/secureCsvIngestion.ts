import { createHash, createHmac } from "node:crypto";
import { CaseAdmissionService, type CaseCandidateStore } from "./caseAdmission";
import { assertCandidateSignal, type RecoveryTypeAdmissionPolicy } from "./admission";
import type { CandidateSignal } from "./types";

export const SECURE_CSV_LIMITS = Object.freeze({ maxBytes: 5_000_000, maxRows: 10_000, maxColumns: 20 });
const FIELDS = [
  "sourceIdentity", "recoveryType", "observedAt", "amountAtRiskMinor",
  "currency", "actionAvailable", "expectedProofEvent",
] as const;
type Field = typeof FIELDS[number];

export interface SecureCsvIngestionOptions {
  readonly boundaryId: string;
  readonly agentId: string;
  readonly detectorVersion: string;
  readonly sourceRefKey: string;
  readonly policies: ReadonlyMap<string, RecoveryTypeAdmissionPolicy>;
  readonly headerMap?: Partial<Record<Field, string>>;
  readonly confirmMappedHeaders?: boolean;
  readonly now?: () => Date;
}

export interface SecureCsvIngestionResult {
  readonly rowsRead: number;
  readonly admitted: number;
  readonly created: number;
  readonly filtered: number;
  readonly rawCsvPersisted: false;
}

export async function ingestSecureCsv(
  raw: string | Buffer,
  store: CaseCandidateStore,
  options: SecureCsvIngestionOptions,
): Promise<SecureCsvIngestionResult> {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  if (bytes.length === 0 || bytes.length > SECURE_CSV_LIMITS.maxBytes) throw new Error("CSV size is outside the secure ingestion limit");
  if (bytes.includes(0)) throw new Error("CSV contains a NUL byte");
  if (!options.boundaryId.trim() || !options.agentId.trim() || !options.detectorVersion.trim()) throw new Error("boundary, agent and detector identity are required");
  if (Buffer.byteLength(options.sourceRefKey, "utf8") < 32) throw new Error("source reference HMAC key must be at least 32 bytes");
  const records = parseCsv(bytes.toString("utf8"));
  if (records.length < 2) throw new Error("CSV must contain a header and at least one data row");
  if (records.length - 1 > SECURE_CSV_LIMITS.maxRows) throw new Error("CSV row count exceeds the secure ingestion limit");
  const headers = records[0]!;
  if (headers.length > SECURE_CSV_LIMITS.maxColumns || new Set(headers).size !== headers.length || headers.some((h) => !h.trim())) {
    throw new Error("CSV headers are invalid or duplicated");
  }
  const headerMap = resolveHeaderMap(headers, options);
  const indexes = new Map(FIELDS.map((field) => [field, headers.indexOf(headerMap[field])]));
  const admission = new CaseAdmissionService(store, options.now ?? (() => new Date()));
  const prepared: { signal: CandidateSignal; policy: RecoveryTypeAdmissionPolicy }[] = [];

  // Parse and validate the complete file before the first persistence call. A
  // malformed trailing row must never leave a partially ingested batch.
  for (let rowNumber = 1; rowNumber < records.length; rowNumber += 1) {
    const row = records[rowNumber]!;
    if (row.length !== headers.length) throw new Error(`CSV row ${rowNumber + 1} has the wrong number of columns`);
    const value = (field: Field) => row[indexes.get(field)!]!.trim();
    const recoveryType = value("recoveryType");
    const policy = options.policies.get(recoveryType);
    if (!policy) throw new Error(`no admission policy exists for recovery type '${recoveryType}'`);
    const amountText = value("amountAtRiskMinor");
    if (!/^\d+$/.test(amountText)) throw new Error(`CSV row ${rowNumber + 1} amountAtRiskMinor is invalid`);
    const amountAtRiskMinor = Number(amountText);
    const actionText = value("actionAvailable");
    if (actionText !== "true" && actionText !== "false") throw new Error(`CSV row ${rowNumber + 1} actionAvailable must be true or false`);
    const identity = value("sourceIdentity");
    if (!identity) throw new Error(`CSV row ${rowNumber + 1} sourceIdentity is required`);
    const sourceRef = `hmac-sha256:${createHmac("sha256", options.sourceRefKey).update(`${options.boundaryId}\0${identity}`).digest("hex")}`;
    const canonical = JSON.stringify(Object.fromEntries(FIELDS.map((field) => [field, value(field)])));
    const digest = createHash("sha256").update(canonical).digest("hex");
    const signal: CandidateSignal = {
      signalId: `CSV-${digest.slice(0, 32)}`, boundaryId: options.boundaryId, recoveryType, sourceRef,
      sourcePayloadHash: digest, detectorVersion: options.detectorVersion, observedAt: value("observedAt"),
      amountAtRiskMinor, currency: value("currency"), actionAvailable: actionText === "true",
      expectedProofEvent: value("expectedProofEvent"),
    };
    assertCandidateSignal(signal);
    prepared.push({ signal, policy });
  }

  let admitted = 0;
  let created = 0;
  for (const { signal, policy } of prepared) {
    const result = await admission.submit(options.agentId, signal, policy);
    if (result.admitted) {
      admitted += 1;
      if (result.created) created += 1;
    }
  }
  return Object.freeze({ rowsRead: records.length - 1, admitted, created, filtered: records.length - 1 - admitted, rawCsvPersisted: false });
}

function resolveHeaderMap(headers: readonly string[], options: SecureCsvIngestionOptions): Record<Field, string> {
  const supplied = options.headerMap ?? {};
  const unknown = Object.keys(supplied).filter((key) => !FIELDS.includes(key as Field));
  if (unknown.length > 0) throw new Error(`CSV header mapping contains unknown fields: ${unknown.sort().join(", ")}`);
  if (Object.keys(supplied).length > 0 && options.confirmMappedHeaders !== true) {
    throw new Error("mapped CSV headers require explicit confirmation");
  }
  const map = Object.fromEntries(FIELDS.map((field) => [field, supplied[field] ?? field])) as Record<Field, string>;
  if (new Set(Object.values(map)).size !== FIELDS.length) throw new Error("CSV header mapping cannot reuse a source column");
  for (const [field, header] of Object.entries(map)) {
    if (!headers.includes(header)) throw new Error(`CSV is missing required field '${field}'`);
  }
  return map;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === ",") {
      row.push(field); field = ""; closedQuote = false;
    } else if (char === "\n" || (char === "\r" && text[i + 1] === "\n")) {
      if (char === "\r") i += 1;
      row.push(field); rows.push(row); row = []; field = ""; closedQuote = false;
    } else if (closedQuote) {
      throw new Error("CSV has unexpected text after a closing quote");
    } else if (char === '"') {
      if (field !== "") throw new Error("CSV has a quote inside an unquoted field");
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (field !== "" || row.length > 0 || closedQuote) { row.push(field); rows.push(row); }
  return rows.filter((values, index) => index === 0 || values.some((value) => value !== ""));
}
