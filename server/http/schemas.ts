// EP-3/EP-8.1 · Typed REST contracts (JSON Schema for request validation).
//
// `additionalProperties: false` is deliberate and load-bearing: a request may carry
// collected/baseline-reference fields but can NEVER supply a counted number, a policy/
// threshold/methodology field, a baseline amount, or a server-owned timestamp — those are
// rejected with 400 before persistence (EP-8.1 C1/baseline hardening). The values that
// determine whether revenue becomes Auditable are pinned server-side from CURRENT_POLICY
// and the locked BaselineSnapshot the case references, never accepted from the client.

const RECOVERY_REASONS = [
  "OnboardingReboot",
  "MilestoneNudge",
  "EnablementSession",
  "CSMOutreach",
  "ExecBusinessReview",
  "RenewalOutreach",
  "UsageActivation",
] as const;

const SUPPORTED_CURRENCY_CODES = ["USD", "EUR", "GBP", "ILS", "JPY"] as const;

export const approveProofSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: [
      "proofId",
      "recoveryCaseId",
      "currency",
      "collectedMinor",
      "excludedRecoveryMinor",
      "exclusionStatement",
      "recoveryReason",
      "attribution",
      "evidenceIds",
      "baselineId",
      "confidenceUsed",
    ],
    properties: {
      proofId: { type: "string", minLength: 1 },
      recoveryCaseId: { type: "string", minLength: 1 },
      currency: { type: "string", enum: SUPPORTED_CURRENCY_CODES },
      collectedMinor: { type: "integer", minimum: 0 },
      excludedRecoveryMinor: { type: "integer", minimum: 0 },
      exclusionStatement: { type: "string", minLength: 1 },
      recoveryReason: { type: "string", enum: RECOVERY_REASONS },
      attribution: { type: "string", minLength: 1 },
      evidenceIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      // References a previously established+locked BaselineSnapshot; the baseline AMOUNT,
      // method, and version are read from that snapshot, never from this body.
      baselineId: { type: "string", minLength: 1 },
      confidenceUsed: { type: "number" },
    },
  },
} as const;

export const reviseProofSchema = {
  params: {
    type: "object",
    required: ["proofId"],
    properties: { proofId: { type: "string", minLength: 1 } },
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["newProofId", "status"],
    properties: {
      newProofId: { type: "string", minLength: 1 },
      status: { type: "string", enum: ["Reversed", "Superseded", "Corrected"] },
      currency: { type: "string", enum: SUPPORTED_CURRENCY_CODES },
      collectedMinor: { type: "integer", minimum: 0 },
      attribution: { type: "string", minLength: 1 },
    },
  },
} as const;

export const proofIdParamsSchema = {
  params: {
    type: "object",
    required: ["proofId"],
    properties: { proofId: { type: "string", minLength: 1 } },
  },
} as const;

export const caseParamsSchema = {
  params: {
    type: "object",
    required: ["caseId"],
    properties: { caseId: { type: "string", minLength: 1 } },
  },
} as const;

/** EP-8.1 · Establish + lock a baseline snapshot. `lockedAt` is never a client field —
 * it is always the DB server clock, stamped at insert time. */
export const establishBaselineSchema = {
  params: {
    type: "object",
    required: ["caseId"],
    properties: { caseId: { type: "string", minLength: 1 } },
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["baselineId", "calculatedMinor", "currency", "method", "methodVersion", "sourceRefs", "effectiveAt"],
    properties: {
      baselineId: { type: "string", minLength: 1 },
      calculatedMinor: { type: "integer", minimum: 0 },
      currency: { type: "string", enum: SUPPORTED_CURRENCY_CODES },
      method: { type: "string", minLength: 1 },
      methodVersion: { type: "integer", minimum: 1 },
      sourceRefs: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      effectiveAt: { type: "string", minLength: 1 },
      supersedes: { type: "string", minLength: 1 },
    },
  },
} as const;

/** EP-8.1 · Pre-proof evidence ingestion. `evidenceRole`/`trustClassification` are NEVER
 * accepted here — they are derived server-side (server/domain/evidenceRole.ts,
 * src/domain/evidence.ts makeEvidence) and there is deliberately no schema field for them. */
export const ingestEvidenceSchema = {
  params: {
    type: "object",
    required: ["caseId"],
    properties: { caseId: { type: "string", minLength: 1 } },
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["evidenceId", "sourceSystem", "sourceRecordId", "evidenceType", "observedAt"],
    properties: {
      evidenceId: { type: "string", minLength: 1 },
      sourceSystem: { type: "string", minLength: 1 },
      sourceRecordId: { type: "string", minLength: 1 },
      evidenceType: { type: "string", minLength: 1 },
      observedAt: { type: "string", minLength: 1 },
      amountMinor: { type: "integer", minimum: 0 },
      currency: { type: "string", enum: SUPPORTED_CURRENCY_CODES },
      note: { type: "string" },
    },
  },
} as const;
