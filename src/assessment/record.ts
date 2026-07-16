// Tamper-Evident Assessment Record — INFRASTRUCTURE ONLY (Trust / Explainability / Reproducibility /
// future Proof Engine). It computes a deterministic, canonical serialization of an AssessmentResult and
// a SHA-256 content hash over it, so anyone can recompute the hash and detect any change to the record.
// Records can be CHAINED (each carries the prior record's hash), giving an append-only, tamper-evident
// history primitive the Proof Engine will build on.
//
// Deliberately NOT here: no business capability, no money/Proof calculation, no Recovery workflow, no
// customer-facing surface. This module neither reads nor writes the UI, the export, or `assessCsv`. It
// is a pure, reusable foundation: given a result, produce/verify a record. It does not mutate results
// and never becomes a "proven" number — a content hash attests integrity, not recovery.
import type { AssessmentResult } from "./types";
import { sha256Hex } from "./fingerprint";

export const ASSESSMENT_RECORD_VERSION = "assessment-record-2026.1";

export interface TamperEvidentRecord {
  readonly recordVersion: string;
  readonly algo: "SHA-256";
  /** The assessment this record attests (for reference; also present inside `canonical`). */
  readonly assessmentId: string;
  /** The prior record's hash, or null for a genesis record. Part of the hashed preimage (chain). */
  readonly previousHash: string | null;
  /** Deterministic serialization of the full result — the exact bytes the hash is taken over. */
  readonly canonical: string;
  /** SHA-256 over `${recordVersion}|${previousHash ?? "genesis"}|${canonical}` (lowercase hex). */
  readonly recordHash: string;
}

/**
 * Deterministic JSON with recursively sorted object keys, so logically-equal results always serialize
 * to identical bytes (Money `{minor,currency}`, `stateCounts`, arrays, etc. included). This is the
 * stable preimage the content hash is taken over.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",") + "}";
}

/** The canonical bytes for an assessment — a stable serialization of the entire result. */
export function canonicalizeAssessment(result: AssessmentResult): string {
  return stableStringify(result);
}

function preimage(recordVersion: string, previousHash: string | null, canonical: string): string {
  return `${recordVersion}|${previousHash ?? "genesis"}|${canonical}`;
}

/** Build a tamper-evident record for a result, optionally chained onto a prior record's hash. */
export async function buildAssessmentRecord(
  result: AssessmentResult,
  opts: { previousHash?: string | null } = {},
): Promise<TamperEvidentRecord> {
  const previousHash = opts.previousHash ?? null;
  const canonical = canonicalizeAssessment(result);
  const recordHash = await sha256Hex(preimage(ASSESSMENT_RECORD_VERSION, previousHash, canonical));
  return Object.freeze({
    recordVersion: ASSESSMENT_RECORD_VERSION,
    algo: "SHA-256" as const,
    assessmentId: result.assessmentId,
    previousHash,
    canonical,
    recordHash,
  });
}

/** Recompute the hash from the record's own contents and compare — true iff the record is intact. */
export async function verifyAssessmentRecord(record: TamperEvidentRecord): Promise<boolean> {
  const recomputed = await sha256Hex(preimage(record.recordVersion, record.previousHash, record.canonical));
  return recomputed === record.recordHash;
}

/** Chain a result onto an existing record (its `recordHash` becomes the new record's `previousHash`). */
export async function linkAssessmentRecord(
  prior: TamperEvidentRecord,
  result: AssessmentResult,
): Promise<TamperEvidentRecord> {
  return buildAssessmentRecord(result, { previousHash: prior.recordHash });
}

/**
 * Verify a chain end-to-end: every record intact AND every link's `previousHash` equal to the prior
 * record's `recordHash`. Detects tampering with any record OR reordering/removal of links.
 */
export async function verifyAssessmentChain(chain: readonly TamperEvidentRecord[]): Promise<boolean> {
  let prev: string | null = null;
  for (const record of chain) {
    if (record.previousHash !== prev) return false;
    if (!(await verifyAssessmentRecord(record))) return false;
    prev = record.recordHash;
  }
  return true;
}
