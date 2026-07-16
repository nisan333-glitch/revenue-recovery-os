// Generic column-mapping mechanics for the ingestion boundary. DOMAIN-NEUTRAL: it knows nothing
// about SaaS/activation vocabulary. The adapter supplies its canonical fields, synonyms and required
// set (a `MappingSpec`); this module only matches source headers to canonical names and re-keys rows.
//
// The mapping is DATA, not logic: it is stamped into the result so an assessment is reproducible under
// the exact column interpretation used. It is applied BEFORE the adapter, so the adapter and the
// invariants keep speaking canonical names and never change.
import type { ColumnMapping } from "./types";
import type { ParsedCsv, RawRow } from "./parse";
import { shortHash } from "./fingerprint";

export interface MappingSpec {
  /** Every canonical field the adapter can read (required + optional). */
  readonly canonicalFields: readonly string[];
  /** canonical → alternative source header names (case-insensitive). */
  readonly synonyms: Readonly<Record<string, readonly string[]>>;
  /** Canonical fields that MUST be mapped for the assessment to run. */
  readonly requiredFields: readonly string[];
}

export interface DetectedMapping {
  /** canonical → source header (exactly as it appears in the file). */
  readonly mapping: ColumnMapping;
  /** Required canonicals with no source column found — the UI must resolve these before running. */
  readonly unmatchedRequired: string[];
  /** Canonicals matched via a SYNONYM rather than an exact header — a guess worth confirming. */
  readonly synonymMatched: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Auto-detect a canonical→source mapping. For each canonical field, prefer an exact (case-insensitive)
 * header match, else the first matching synonym. Deterministic: the first header of a given normalized
 * name wins, so repeated runs on the same headers produce an identical mapping. A synonym match is a
 * GUESS — reported in `synonymMatched` so the UI can ask an operator to confirm it before running.
 */
export function autoDetectMapping(headers: readonly string[], spec: MappingSpec): DetectedMapping {
  const byNorm = new Map<string, string>(); // normalized header → original header (first occurrence wins)
  for (const h of headers) {
    const n = norm(h);
    if (!byNorm.has(n)) byNorm.set(n, h);
  }
  const mapping: Record<string, string> = {};
  const synonymMatched: string[] = [];
  for (const field of spec.canonicalFields) {
    const exact = byNorm.get(norm(field));
    if (exact !== undefined) {
      mapping[field] = exact;
      continue;
    }
    for (const syn of spec.synonyms[field] ?? []) {
      const hit = byNorm.get(norm(syn));
      if (hit !== undefined) {
        mapping[field] = hit;
        synonymMatched.push(field);
        break;
      }
    }
  }
  const unmatchedRequired = spec.requiredFields.filter((f) => !(f in mapping));
  return { mapping: Object.freeze(mapping), unmatchedRequired, synonymMatched };
}

/**
 * Re-key each row's cells to canonical names, PRESERVING the original keys. For every canonical→source
 * pair, the canonical key is set from the source cell's value; unmapped source columns are kept as-is,
 * so a file that already uses canonical names keeps working. Pure; row identity/malformed preserved.
 */
export function applyMapping(parsed: ParsedCsv, mapping: ColumnMapping): ParsedCsv {
  const canonicalKeys = Object.keys(mapping);
  const headers = [...new Set([...parsed.headers, ...canonicalKeys])];
  const rows: RawRow[] = parsed.rows.map((r) => {
    const cells: Record<string, string> = { ...r.cells };
    for (const [canonical, source] of Object.entries(mapping)) {
      cells[canonical] = r.cells[source] ?? "";
    }
    return { sourceRowId: r.sourceRowId, cells: Object.freeze(cells), malformed: r.malformed };
  });
  return { headers, rows };
}

/** Deterministic, non-secret id for a mapping (stamped into the result for reproducibility). */
export function mappingId(mapping: ColumnMapping): string {
  const canonical = Object.entries(mapping)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
  return "M-" + shortHash(canonical);
}
