import type { CandidateSignal } from "./types";

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
]);

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
    if (typeof candidate[field] !== "string" || !(candidate[field] as string).trim()) {
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
  if (typeof candidate.currency !== "string" || !/^[A-Z]{3}$/.test(candidate.currency)) {
    throw new Error("CandidateSignal.currency must be a three-letter uppercase currency code");
  }
  if (!Number.isSafeInteger(candidate.amountAtRiskMinor) || (candidate.amountAtRiskMinor as number) < 0) {
    throw new Error("CandidateSignal.amountAtRiskMinor must be a non-negative safe integer");
  }
  if (typeof candidate.actionAvailable !== "boolean") {
    throw new Error("CandidateSignal.actionAvailable must be boolean");
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
