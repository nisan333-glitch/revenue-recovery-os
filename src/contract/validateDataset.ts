// Deterministic validation of a customer pilot dataset against the Customer Pilot Data Contract.
//
// This is the executable half of the contract. It answers one question — "may this dataset enter a
// pilot, and if not, exactly which rows and why" — and it answers the same way every time for the
// same input. There is no clock inside it, no randomness, and no network: the caller supplies the
// policy (which carries `asOf`), so two runs a week apart on the same file produce identical output.
//
// IT NEVER REPAIRS. Not one branch below rewrites, defaults, coerces, rounds or drops a customer
// value. Every failure becomes a coded finding that names the row, the field and the remedy. That
// restraint is the point: the moment ingestion "helpfully" fixes data, the dataset a pilot measured
// stops being the dataset the customer can reproduce, and every number downstream becomes an
// assertion rather than a fact.
//
// LAYERING. The adapter (src/assessment/adapters/saasActivation.ts) remains the authority on whether
// a row becomes an ExpectationCycle; this module CALLS it and translates its exclusions into coded
// findings. The additional rules here — tenant binding, undeclared columns, PII shapes, ambiguous
// local timestamps, coverage containment, content duplicates — are strictly ADDITIVE. Nothing the
// adapter rejects is accepted here.
import type { AssessmentPolicy } from "../assessment/policy";
import type { ColumnMapping, ExpectationCycle } from "../assessment/types";
import { parseCsv, type RawRow } from "../assessment/parse";
import { autoDetectMapping, applyMapping, mappingId } from "../assessment/columnMap";
import { SAAS_MAPPING_SPEC, toCycle, type AdapterOptions } from "../assessment/adapters/saasActivation";
import { sha256Hex } from "../assessment/fingerprint";
import { epochDay } from "../assessment/dateNormalize";
import {
  INTAKE_LIMITS,
  PILOT_DATA_CONTRACT_FIELDS,
  PILOT_DATA_CONTRACT_REF,
  PILOT_DATA_CONTRACT_VERSION,
  contractField,
  fieldsByRequirement,
  isProhibitedFieldName,
  isSupportedContractVersion,
  looksLikePii,
  parseContractVersion,
  type DatasetProvenance,
} from "./pilotDataContract";
import {
  DATASET_CODES,
  IDENTITY_CODES,
  PII_CODES,
  ROW_CODES,
  VERSION_CODES,
  EXCLUSION_REASON_CODES,
  type RejectionCodeSpec,
  type RejectionSeverity,
} from "./rejectionCodes";

// ── 2 · Stable identifiers and tenant boundaries ──────────────────────────────────────────────────

/**
 * The tenant a dataset belongs to.
 *
 * `boundaryId` is supplied OUT-OF-BAND, never read from the file. This is deliberate: a column in an
 * uploaded CSV is attacker-controlled input, so a dataset that could name its own tenant could be
 * made to land in someone else's. The caller holds the authenticated boundary; the file only
 * carries data.
 */
export interface TenantBoundary {
  readonly boundaryId: string;
  /** Customer-facing label for this specific extract (e.g. "activation-2026-Q1"). */
  readonly datasetId: string;
}

const ID_DERIVATION = "nh-pilot-id-v1";

/**
 * Derive a tenant-scoped pseudonymous identifier.
 *
 * PSEUDONYMOUS, NOT ANONYMOUS — and the difference matters legally, so it is stated rather than
 * implied: anyone holding the original identifier can recompute this value and re-identify the
 * subject. It exists so raw customer identifiers need not be copied into reports, queues and
 * exports, and so the same account cannot be correlated across two tenants (the boundary is inside
 * the hash). It is not a substitute for deleting data you should not hold.
 */
export async function tenantScopedIdentifier(boundaryId: string, value: string): Promise<string> {
  const digest = await sha256Hex(`${ID_DERIVATION}\u0000${boundaryId}\u0000${value}`);
  return `pid_${digest.slice(0, 32)}`;
}

// ── Findings ──────────────────────────────────────────────────────────────────────────────────────

/** A problem with the dataset as a whole. Any of these means nothing is assessed. */
export interface DatasetFinding {
  readonly code: string;
  readonly severity: RejectionSeverity;
  readonly title: string;
  readonly remediation: string;
  /** The column or metadata field at fault, when one can be named. */
  readonly subject: string | null;
  readonly detail: string;
}

/** A problem with one row, addressable by the customer in their own export. */
export interface RowFinding {
  /** Provenance id from the parser (e.g. "row-2"). */
  readonly sourceRowId: string;
  /** 1-based DATA row number, header excluded — what a spreadsheet user counts. */
  readonly rowNumber: number;
  /** Canonical field at fault, or null when the whole row is at fault. */
  readonly field: string | null;
  readonly code: string;
  readonly severity: RejectionSeverity;
  readonly title: string;
  readonly remediation: string;
  readonly detail: string;
}

export interface ContractValidationReport {
  readonly contractRef: string;
  readonly contractVersion: string;
  readonly declaredVersion: string;
  readonly boundaryId: string;
  readonly datasetId: string;
  /**
   * The file is structurally interpretable: no `dataset_rejected` finding. Warnings do not fail it,
   * and individually rejected rows do not either.
   *
   * `accepted` ALONE IS NEVER A GREEN LIGHT — a dataset whose every row was rejected is still
   * "accepted" in this sense. Callers gate on `usableForAssessment`.
   */
  readonly accepted: boolean;
  /** `accepted` AND at least one row survived. This is the flag a caller should branch on. */
  readonly usableForAssessment: boolean;
  readonly datasetFindings: readonly DatasetFinding[];
  readonly rowFindings: readonly RowFinding[];
  readonly counts: {
    readonly dataRows: number;
    readonly acceptedRows: number;
    readonly rejectedRows: number;
    readonly warnedRows: number;
  };
  /** SHA-256 of the exact uploaded text. Proves two runs saw the same bytes. */
  readonly datasetFingerprint: string;
  /** Deterministic key for duplicate-submission suppression. See `idempotency` below. */
  readonly idempotencyKey: string;
  readonly columnMapping: ColumnMapping;
  readonly mappingId: string;
  readonly provenance: DatasetProvenance;
  /** Cycles that passed every contract rule AND the adapter. Input to assessment — never money. */
  readonly acceptedCycles: readonly ExpectationCycle[];
  readonly claimBoundary: {
    readonly observedInputOnly: true;
    readonly provenanceIsCustomerAsserted: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

export interface DatasetSubmission {
  /** Contract version the customer's export targets. */
  readonly declaredVersion: string;
  readonly boundary: TenantBoundary;
  /** The boundary this upload is being ingested into, when it must be cross-checked. */
  readonly ingestionBoundaryId?: string;
  readonly provenance: DatasetProvenance;
  readonly csvText: string;
  /** Stamped policy — carries currency, asOf and the stall threshold. Never derived here. */
  readonly policy: AssessmentPolicy;
  readonly adapterOptions?: AdapterOptions;
}

function datasetFinding(spec: RejectionCodeSpec, subject: string | null, detail: string): DatasetFinding {
  return Object.freeze({
    code: spec.code,
    severity: spec.severity,
    title: spec.title,
    remediation: spec.remediation,
    subject,
    detail,
  });
}

function rowFinding(
  spec: RejectionCodeSpec,
  row: { sourceRowId: string; rowNumber: number },
  field: string | null,
  detail: string,
): RowFinding {
  return Object.freeze({
    sourceRowId: row.sourceRowId,
    rowNumber: row.rowNumber,
    field,
    code: spec.code,
    severity: spec.severity,
    title: spec.title,
    remediation: spec.remediation,
    detail,
  });
}

const DATE_FIELDS = PILOT_DATA_CONTRACT_FIELDS.filter((f) => f.kind === "date").map((f) => f.name);
const IDENTIFIER_FIELDS = PILOT_DATA_CONTRACT_FIELDS.filter((f) => f.kind === "identifier").map((f) => f.name);
const RECOMMENDED_FIELDS = fieldsByRequirement("recommended");

/**
 * Per-row "recommended" warnings are limited to the stable cycle key on purpose. An empty
 * `refunded_at` on an invoice that was never refunded, or an empty `next_invoice_paid_at` on one
 * that was never paid, is not a data gap — it IS the observation, and warning about it would bury
 * the real warnings under one per ordinary row. Missing CAPABILITY (the column absent from the whole
 * export) is reported once, at dataset level, instead.
 */
const CYCLE_KEY_FIELDS = ["subscription_id", "cycle_id"] as const;

/** A time-of-day with no UTC offset. Not a point in time — see TIME_RULES. */
const LOCAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  try {
    epochDay(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate one dataset. Returns a report; throws only on programmer error, never on bad customer
 * data — bad customer data is the expected case and is reported, not raised.
 */
export async function validatePilotDataset(submission: DatasetSubmission): Promise<ContractValidationReport> {
  const datasetFindings: DatasetFinding[] = [];
  const rowFindings: RowFinding[] = [];
  const { boundary, provenance, policy } = submission;

  const datasetFingerprint = await sha256Hex(submission.csvText);
  const idempotencyKey = await deriveIdempotencyKey(boundary, datasetFingerprint);

  // ── Version: refuse anything this build cannot faithfully interpret ─────────────────────────────
  if (parseContractVersion(submission.declaredVersion) === null) {
    datasetFindings.push(
      datasetFinding(VERSION_CODES.MALFORMED_CONTRACT_VERSION, "declaredVersion", submission.declaredVersion),
    );
  } else if (!isSupportedContractVersion(submission.declaredVersion)) {
    datasetFindings.push(
      datasetFinding(
        VERSION_CODES.UNSUPPORTED_CONTRACT_VERSION,
        "declaredVersion",
        `declared ${submission.declaredVersion}; this build implements ${PILOT_DATA_CONTRACT_VERSION}`,
      ),
    );
  }

  // ── Tenant binding ─────────────────────────────────────────────────────────────────────────────
  if (!boundary.boundaryId.trim() || !boundary.datasetId.trim()) {
    datasetFindings.push(datasetFinding(DATASET_CODES.MISSING_TENANT_BINDING, "boundary", "boundaryId and datasetId are both required"));
  } else if (submission.ingestionBoundaryId !== undefined && submission.ingestionBoundaryId !== boundary.boundaryId) {
    datasetFindings.push(
      datasetFinding(IDENTITY_CODES.TENANT_BOUNDARY_CONFLICT, "boundary", "declared boundary does not match the ingestion boundary"),
    );
  }

  // ── Provenance ─────────────────────────────────────────────────────────────────────────────────
  datasetFindings.push(...validateProvenance(provenance));

  // ── Safe limits ────────────────────────────────────────────────────────────────────────────────
  // Checked BEFORE parsing: an oversized file must not be tokenized just to be refused, and it is
  // refused WHOLE. Truncating would report success for a dataset that silently lost its tail.
  const byteLength = new TextEncoder().encode(submission.csvText).length;
  if (byteLength > INTAKE_LIMITS.maxBytes) {
    datasetFindings.push(
      datasetFinding(DATASET_CODES.DATASET_TOO_LARGE, null, `${byteLength} bytes exceeds the ${INTAKE_LIMITS.maxBytes}-byte limit`),
    );
    return frozenReport(submission, datasetFindings, [], [], detectedNothing(), datasetFingerprint, idempotencyKey, 0);
  }

  // ── Parse + header rules ───────────────────────────────────────────────────────────────────────
  const parsed = parseCsv(submission.csvText);
  if (parsed.rows.length > INTAKE_LIMITS.maxDataRows) {
    datasetFindings.push(
      datasetFinding(DATASET_CODES.TOO_MANY_ROWS, null, `${parsed.rows.length} rows exceeds the ${INTAKE_LIMITS.maxDataRows}-row limit`),
    );
    return frozenReport(submission, datasetFindings, [], [], detectedNothing(), datasetFingerprint, idempotencyKey, parsed.rows.length);
  }
  if (parsed.headers.length > INTAKE_LIMITS.maxColumns) {
    datasetFindings.push(
      datasetFinding(DATASET_CODES.TOO_MANY_COLUMNS, null, `${parsed.headers.length} columns exceeds the ${INTAKE_LIMITS.maxColumns}-column limit`),
    );
    return frozenReport(submission, datasetFindings, [], [], detectedNothing(), datasetFingerprint, idempotencyKey, parsed.rows.length);
  }
  if (parsed.rows.length === 0) {
    datasetFindings.push(datasetFinding(DATASET_CODES.EMPTY_DATASET, null, "no data rows were found after the header"));
  }

  const seenHeader = new Set<string>();
  for (const header of parsed.headers) {
    const trimmed = header.trim();
    if (trimmed === "") {
      datasetFindings.push(datasetFinding(DATASET_CODES.BLANK_COLUMN_NAME, null, "a column has an empty name"));
      continue;
    }
    if (seenHeader.has(trimmed.toLowerCase())) {
      datasetFindings.push(datasetFinding(DATASET_CODES.DUPLICATE_COLUMN, trimmed, "column appears more than once"));
    }
    seenHeader.add(trimmed.toLowerCase());
    if (isProhibitedFieldName(trimmed)) {
      datasetFindings.push(
        datasetFinding(PII_CODES.PROHIBITED_COLUMN, trimmed, "column name indicates personal data and must not be exported"),
      );
    }
  }

  const detected = autoDetectMapping(parsed.headers, SAAS_MAPPING_SPEC);
  for (const missing of detected.unmatchedRequired) {
    datasetFindings.push(datasetFinding(DATASET_CODES.MISSING_REQUIRED_COLUMN, missing, `no source column maps to '${missing}'`));
  }

  // Data minimization: every column must be a declared field or map to one. Rejected, not ignored.
  const mappedSources = new Set(Object.values(detected.mapping).map((h) => h.trim().toLowerCase()));
  for (const header of parsed.headers) {
    const trimmed = header.trim();
    if (trimmed === "" || isProhibitedFieldName(trimmed)) continue;
    if (mappedSources.has(trimmed.toLowerCase())) continue;
    if (contractField(trimmed) !== undefined) continue;
    datasetFindings.push(
      datasetFinding(DATASET_CODES.UNDECLARED_COLUMN, trimmed, "column is not declared by the contract and is not mapped to a declared field"),
    );
  }

  // Capability gaps: a recommended column absent from the entire export. Reported once.
  for (const field of RECOMMENDED_FIELDS) {
    if (!(field in detected.mapping)) {
      datasetFindings.push(
        datasetFinding(DATASET_CODES.MISSING_RECOMMENDED_COLUMN, field, `recommended column '${field}' is not present in the export`),
      );
    }
  }

  const coverage = coverageWindow(provenance);

  // ── Rows ───────────────────────────────────────────────────────────────────────────────────────
  const mapped = applyMapping(parsed, detected.mapping);
  const acceptedCycles: ExpectationCycle[] = [];
  const cycleCandidates: { cycle: ExpectationCycle; at: { sourceRowId: string; rowNumber: number }; rejectedForAnyReason: boolean }[] = [];
  const contentSeen = new Map<string, number>();
  const currencies = new Set<string>();
  const rejectedRowIds = new Set<string>();
  const warnedRowIds = new Set<string>();

  for (let i = 0; i < mapped.rows.length; i += 1) {
    const raw = mapped.rows[i]!;
    const at = { sourceRowId: raw.sourceRowId, rowNumber: i + 1 };
    const cell = (field: string): string => (raw.cells[field] ?? "").trim();

    const rowCurrency = cell("currency").toUpperCase();
    if (rowCurrency !== "") currencies.add(rowCurrency);

    let rejectedForAnyReason = false;
    const reject = (finding: RowFinding) => {
      rowFindings.push(finding);
      rejectedRowIds.add(raw.sourceRowId);
      rejectedForAnyReason = true;
    };

    // PII hiding in an identifier column.
    for (const field of IDENTIFIER_FIELDS) {
      const shape = looksLikePii(cell(field));
      if (shape !== null) {
        reject(rowFinding(PII_CODES.PII_SHAPED_IDENTIFIER, at, field, `value looks like a(n) ${shape}`));
      }
    }

    // A wall-clock time with no offset is not an instant. Never assumed to be UTC or local.
    for (const field of DATE_FIELDS) {
      const value = cell(field);
      if (value !== "" && LOCAL_TIMESTAMP.test(value)) {
        reject(rowFinding(ROW_CODES.LOCAL_TIMESTAMP_WITHOUT_OFFSET, at, field, value));
      }
    }

    // Exact-duplicate rows would count the same exposure twice.
    const contentKey = JSON.stringify(
      PILOT_DATA_CONTRACT_FIELDS.map((f) => cell(f.name)),
    );
    const firstSeen = contentSeen.get(contentKey);
    if (firstSeen !== undefined) {
      reject(rowFinding(IDENTITY_CODES.DUPLICATE_SOURCE_ROW, at, null, `identical to data row ${firstSeen}`));
    } else {
      contentSeen.set(contentKey, at.rowNumber);
    }

    // A dataset must not contain rows it declares itself not to cover.
    if (coverage !== null) {
      const due = cell("next_invoice_due_at");
      if (isIsoDay(due)) {
        const day = epochDay(due);
        if (day < coverage.start || day > coverage.end) {
          reject(
            rowFinding(
              ROW_CODES.ROW_OUTSIDE_COVERAGE_WINDOW,
              at,
              "next_invoice_due_at",
              `${due} is outside declared coverage ${provenance.coverageStart}..${provenance.coverageEnd}`,
            ),
          );
        }
      }
    }

    // The adapter decides cycle-worthiness. Its exclusions are translated, never overridden.
    const outcome = toCycle(raw as RawRow, policy, submission.adapterOptions ?? {});
    if (outcome.kind === "excluded") {
      const spec = EXCLUSION_REASON_CODES[outcome.exclusion.reason];
      reject(rowFinding(spec, at, fieldFromDetail(outcome.exclusion.detail), outcome.exclusion.detail));
      continue;
    }

    // Warnings: usable, but weaker — recorded so the weakness travels with the dataset.
    if (CYCLE_KEY_FIELDS.every((f) => cell(f) === "")) {
      rowFindings.push(
        rowFinding(ROW_CODES.MISSING_STABLE_CYCLE_KEY, at, "subscription_id", "cycle identity derived from entity and dates"),
      );
      warnedRowIds.add(raw.sourceRowId);
    }
    if (outcome.cycle.attributes["paid_timing"] === "unknown_from_bool") {
      rowFindings.push(
        rowFinding(ROW_CODES.UNTIMED_PAYMENT_FLAG, at, "next_invoice_paid", "payment asserted without a settlement date"),
      );
      warnedRowIds.add(raw.sourceRowId);
    }

    // Every row that yields a cycle participates, including rows rejected for another defect.
    // Otherwise the file author could corrupt the unwanted rival to select a winner.
    cycleCandidates.push({ cycle: outcome.cycle, at, rejectedForAnyReason });
  }

  const cycleGroups = new Map<string, typeof cycleCandidates>();
  for (const candidate of cycleCandidates) {
    const group = cycleGroups.get(candidate.cycle.cycleId) ?? [];
    group.push(candidate);
    cycleGroups.set(candidate.cycle.cycleId, group);
  }
  for (const group of cycleGroups.values()) {
    if (group.length === 1) {
      if (!group[0]!.rejectedForAnyReason) acceptedCycles.push(group[0]!.cycle);
    } else {
      const rowNumbers = group.map(c => c.at.rowNumber).sort((a, b) => a - b).join(", ");
      for (const candidate of group) {
        rowFindings.push(rowFinding(ROW_CODES.DUPLICATE_CYCLE_ID, candidate.at, "subscription_id", `cycle id shared by data rows ${rowNumbers}`));
        rejectedRowIds.add(candidate.at.sourceRowId);
      }
    }
  }

  if (currencies.size > 1) {
    datasetFindings.push(
      datasetFinding(DATASET_CODES.MULTIPLE_CURRENCIES, "currency", `found ${[...currencies].sort().join(", ")}`),
    );
  }

  return frozenReport(
    submission,
    datasetFindings,
    rowFindings,
    acceptedCycles,
    detected,
    datasetFingerprint,
    idempotencyKey,
    mapped.rows.length,
    rejectedRowIds.size,
    warnedRowIds.size,
  );
}

function detectedNothing(): { mapping: ColumnMapping } {
  return { mapping: Object.freeze({}) };
}

/**
 * Report builder shared by the limit short-circuits and the main path, so an early return can never
 * drift from the normal shape (e.g. claim `usableForAssessment` while carrying a fatal finding).
 */
function frozenReport(
  submission: DatasetSubmission,
  datasetFindings: readonly DatasetFinding[],
  rowFindings: readonly RowFinding[],
  acceptedCycles: readonly ExpectationCycle[],
  detected: { mapping: ColumnMapping },
  datasetFingerprint: string,
  idempotencyKey: string,
  dataRows: number,
  rejectedRows = 0,
  warnedRows = 0,
): ContractValidationReport {
  const accepted = !datasetFindings.some((f) => f.severity === "dataset_rejected");
  const usableForAssessment = accepted && acceptedCycles.length > 0;
  return Object.freeze({
    contractRef: PILOT_DATA_CONTRACT_REF,
    contractVersion: PILOT_DATA_CONTRACT_VERSION,
    declaredVersion: submission.declaredVersion,
    boundaryId: submission.boundary.boundaryId,
    datasetId: submission.boundary.datasetId,
    accepted,
    usableForAssessment,
    datasetFindings: Object.freeze([...datasetFindings]),
    rowFindings: Object.freeze([...rowFindings]),
    counts: Object.freeze({
      dataRows,
      acceptedRows: accepted ? acceptedCycles.length : 0,
      rejectedRows,
      warnedRows,
    }),
    datasetFingerprint,
    idempotencyKey,
    columnMapping: detected.mapping,
    mappingId: mappingId(detected.mapping),
    provenance: Object.freeze({
      ...submission.provenance,
      sourceSystems: Object.freeze({ ...submission.provenance.sourceSystems }),
    }),
    acceptedCycles: Object.freeze(accepted ? [...acceptedCycles] : []),
    claimBoundary: Object.freeze({
      observedInputOnly: true,
      provenanceIsCustomerAsserted: true,
      constitutesProof: false,
      constitutesRevenue: false,
    }),
  });
}

// ── 9 · Duplicate and idempotency handling ────────────────────────────────────────────────────────

const IDEMPOTENCY_DERIVATION = "nh-pilot-dataset-v1";

/**
 * Deterministic submission key: contract + tenant + dataset label + exact file bytes.
 *
 * Re-uploading the identical extract under the same tenant yields the identical key, so an ingestion
 * pipeline can recognise and drop the repeat instead of double-counting it. Change one byte of the
 * file and the key changes — which is the desired behaviour, because a changed file is a different
 * dataset and deserves a fresh decision rather than inheriting the previous one's verdict.
 *
 * The boundary is inside the key, so two tenants uploading byte-identical files never collide.
 */
export async function deriveIdempotencyKey(boundary: TenantBoundary, datasetFingerprint: string): Promise<string> {
  const digest = await sha256Hex(
    [IDEMPOTENCY_DERIVATION, PILOT_DATA_CONTRACT_REF, boundary.boundaryId, boundary.datasetId, datasetFingerprint].join("\u0000"),
  );
  return `pds_${digest}`;
}

/** Is this submission a byte-identical repeat of one already seen for the same tenant? */
export function isDuplicateSubmission(key: string, seen: ReadonlySet<string>): boolean {
  return seen.has(key);
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

function validateProvenance(p: DatasetProvenance): DatasetFinding[] {
  const out: DatasetFinding[] = [];
  const missing: string[] = [];
  if (!p.sourceSystems?.contract?.trim()) missing.push("sourceSystems.contract");
  if (!p.sourceSystems?.billing?.trim()) missing.push("sourceSystems.billing");
  if (!p.sourceSystems?.product?.trim()) missing.push("sourceSystems.product");
  if (!p.dataOwnerRole?.trim()) missing.push("dataOwnerRole");
  if (!p.extractionMethod?.trim()) missing.push("extractionMethod");
  if (!p.extractedAt?.trim()) missing.push("extractedAt");
  if (typeof p.assertedIndependentOfBeneficiary !== "boolean") missing.push("assertedIndependentOfBeneficiary");
  if (missing.length > 0) {
    out.push(datasetFinding(DATASET_CODES.MISSING_PROVENANCE, null, `missing: ${missing.sort().join(", ")}`));
  }
  if (coverageWindow(p) === null) {
    out.push(
      datasetFinding(
        DATASET_CODES.COVERAGE_WINDOW_INVALID,
        "coverage",
        `coverageStart=${p.coverageStart ?? ""} coverageEnd=${p.coverageEnd ?? ""}`,
      ),
    );
  }
  return out;
}

function coverageWindow(p: DatasetProvenance): { start: number; end: number } | null {
  if (!isIsoDay(p.coverageStart ?? "") || !isIsoDay(p.coverageEnd ?? "")) return null;
  const start = epochDay(p.coverageStart);
  const end = epochDay(p.coverageEnd);
  return start <= end ? { start, end } : null;
}

/**
 * Best-effort field attribution for an adapter exclusion. The adapter's `detail` is human text
 * ("signed_at: 13/13/2026"); when it names a known field we surface it as structured data. When it
 * does not, the field stays null rather than being guessed — a wrong field attribution would send a
 * customer to edit the wrong column.
 */
function fieldFromDetail(detail: string): string | null {
  const head = detail.split(":")[0]?.trim() ?? "";
  if (contractField(head) !== undefined) return head;
  const bare = detail.trim();
  return contractField(bare) !== undefined ? bare : null;
}
