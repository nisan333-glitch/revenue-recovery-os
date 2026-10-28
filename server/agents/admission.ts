import type { CandidateSignal } from "./types";
import { isSupportedCurrency } from "../../src/domain/money";

const MAX_IDENTITY_LENGTH = 256;
const MAX_SOURCE_REF_LENGTH = 2048;
export const MAX_SIGNALS_PER_TASK = 1_000;
export const MAX_SIGNAL_BATCH_BYTES = 1_048_576;

const CANDIDATE_SIGNAL_KEYS = new Set<keyof CandidateSignal>([
  "signalId",
  "boundaryId",
  "recoveryType",
  "sourceRef",
  "sourcePayloadHash",
  "detectorVersion",
  "observedAt",
  "amountAtRiskMinor",
  "currency",
  "actionAvailable",
  "expectedProofEvent",
  "obligationCoverage",
]);

/** Keys permitted inside `obligationCoverage`, per variant. An extra key is a hard error, not a strip. */
const COVERAGE_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  SINGLE_OBLIGATION: ["kind", "obligationRef", "expectedMinor", "billedMinor", "residualMinor", "currency"],
  ACCOUNT_AGGREGATE: ["kind", "unitCount"],
});

export interface RecoveryTypeAdmissionPolicy {
  readonly recoveryType: string;
  readonly economicThresholdMinor: number;
}

export type AdmissionDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string };

/**
 * Runtime boundary validation. TypeScript types are not a security boundary:
 * handlers can deserialize or cast arbitrary objects. Reject unknown fields so
 * agents cannot smuggle proof, collected revenue or governed-action claims into
 * the candidate channel.
 */
export function assertCandidateSignal(value: unknown): asserts value is CandidateSignal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent output must be a CandidateSignal object");
  }

  const candidate = value as Record<string, unknown>;
  const unknownKeys = Object.keys(candidate).filter(
    (key) => !CANDIDATE_SIGNAL_KEYS.has(key as keyof CandidateSignal),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`CandidateSignal contains forbidden fields: ${unknownKeys.sort().join(", ")}`);
  }

  const nonEmptyStrings = [
    "signalId",
    "boundaryId",
    "recoveryType",
    "sourceRef",
    "detectorVersion",
    "expectedProofEvent",
  ] as const;
  for (const field of nonEmptyStrings) {
    const value = candidate[field];
    const maxLength = field === "sourceRef" ? MAX_SOURCE_REF_LENGTH : MAX_IDENTITY_LENGTH;
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maxLength) {
      throw new Error(`CandidateSignal.${field} must be a non-empty string`);
    }
  }
  if (typeof candidate.sourcePayloadHash !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sourcePayloadHash)) {
    throw new Error("CandidateSignal.sourcePayloadHash must be a lowercase SHA-256 digest");
  }
  if (
    typeof candidate.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate.observedAt) ||
    !Number.isFinite(Date.parse(candidate.observedAt)) ||
    new Date(candidate.observedAt).toISOString() !== candidate.observedAt
  ) {
    throw new Error("CandidateSignal.observedAt must be a valid ISO timestamp");
  }
  if (typeof candidate.currency !== "string" || !isSupportedCurrency(candidate.currency)) {
    throw new Error("CandidateSignal.currency must be a supported currency code");
  }
  if (!Number.isSafeInteger(candidate.amountAtRiskMinor) || (candidate.amountAtRiskMinor as number) < 0) {
    throw new Error("CandidateSignal.amountAtRiskMinor must be a non-negative safe integer");
  }
  if (typeof candidate.actionAvailable !== "boolean") {
    throw new Error("CandidateSignal.actionAvailable must be boolean");
  }

  // OBLIGATION COVERAGE. Absent is permitted and means "not stated", which `provenEligibility` refuses.
  // Present is validated STRICTLY, because this is the field a monetary gate reads: a malformed one must
  // never arrive at that gate looking like a well-formed single-obligation claim.
  if (candidate.obligationCoverage !== undefined) {
    const c = candidate.obligationCoverage;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new Error("CandidateSignal.obligationCoverage must be an object when present");
    }
    const cov = c as Record<string, unknown>;
    const permitted = typeof cov.kind === "string" ? COVERAGE_KEYS[cov.kind] : undefined;
    if (!permitted) {
      throw new Error("CandidateSignal.obligationCoverage.kind must be SINGLE_OBLIGATION or ACCOUNT_AGGREGATE");
    }
    const extra = Object.keys(cov).filter((k) => !permitted.includes(k));
    if (extra.length > 0) {
      throw new Error(`CandidateSignal.obligationCoverage contains forbidden fields: ${extra.sort().join(", ")}`);
    }
    const missing = permitted.filter((k) => !(k in cov));
    if (missing.length > 0) {
      throw new Error(`CandidateSignal.obligationCoverage is missing: ${missing.sort().join(", ")}`);
    }
    if (cov.kind === "SINGLE_OBLIGATION") {
      if (typeof cov.obligationRef !== "string" || !/^hmac-sha256:[a-f0-9]{64}$/.test(cov.obligationRef)) {
        throw new Error("obligationCoverage.obligationRef must be an hmac-sha256 pseudonym, never a raw identifier");
      }
      if (typeof cov.currency !== "string" || !isSupportedCurrency(cov.currency)) {
        throw new Error("obligationCoverage.currency must be a supported currency code");
      }
      for (const field of ["expectedMinor", "billedMinor", "residualMinor"] as const) {
        if (!Number.isSafeInteger(cov[field])) {
          throw new Error(`obligationCoverage.${field} must be a safe integer in minor units`);
        }
      }
      // DERIVED HERE TOO, at the boundary. The monetary gate re-derives it as well; two independent
      // checks of one arithmetic fact is the cheapest insurance against a stamped figure nobody can trace.
      if ((cov.residualMinor as number) !== (cov.expectedMinor as number) - (cov.billedMinor as number)) {
        throw new Error("obligationCoverage.residualMinor must equal expectedMinor - billedMinor");
      }
    } else if (!Number.isSafeInteger(cov.unitCount) || (cov.unitCount as number) < 1) {
      throw new Error("obligationCoverage.unitCount must be a positive safe integer");
    }
  }
}

export function assertCandidateSignalBatch(
  value: unknown,
  boundaryId?: string,
): asserts value is readonly CandidateSignal[] {
  if (!Array.isArray(value)) {
    throw new Error("agent output must be an array of CandidateSignals");
  }
  if (value.length > MAX_SIGNALS_PER_TASK) {
    throw new Error(`agent output must contain at most ${MAX_SIGNALS_PER_TASK} CandidateSignals`);
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SIGNAL_BATCH_BYTES) {
    throw new Error("agent output exceeds the CandidateSignal batch size limit");
  }
  for (const signal of value) {
    assertCandidateSignal(signal);
    if (boundaryId !== undefined && signal.boundaryId !== boundaryId) {
      throw new Error("CandidateSignal boundary does not match the task boundary");
    }
  }
}

/**
 * Universal Case admission gate: material amount + plausible action + future proof event.
 * This function does not create a Case. It only decides whether a detector signal is
 * eligible to cross into the governed Case-creation boundary.
 */
export function canBeCase(
  signal: CandidateSignal,
  policy: RecoveryTypeAdmissionPolicy,
): AdmissionDecision {
  if (!signal.signalId.trim() || !signal.sourceRef.trim()) {
    return { admitted: false, reason: "stable signal identity and source reference are required" };
  }
  if (!signal.boundaryId.trim()) {
    return { admitted: false, reason: "tenant or workspace boundary is required" };
  }
  if (signal.recoveryType !== policy.recoveryType) {
    return { admitted: false, reason: "signal recovery type does not match the admission policy" };
  }
  if (!Number.isSafeInteger(signal.amountAtRiskMinor) || signal.amountAtRiskMinor < policy.economicThresholdMinor) {
    return { admitted: false, reason: "material revenue at risk is below the governed threshold" };
  }
  if (!signal.actionAvailable) {
    return { admitted: false, reason: "no plausible recovery action is available" };
  }
  if (!signal.expectedProofEvent.trim()) {
    return { admitted: false, reason: "no future proof event is defined" };
  }
  return { admitted: true };
}
