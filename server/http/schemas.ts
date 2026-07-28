// EP-3 · Typed REST contracts (JSON Schema for request validation).
//
// `additionalProperties: false` is deliberate and load-bearing: a request may carry
// collected/baseline amounts but can NEVER supply `revenueReturned` (or any other
// counted number) — an injected field is rejected with 400 before persistence. The
// number is derived only by the domain kernel.

export const approveProofSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: [
      "proofId",
      "recoveryCaseId",
      "approvedAt",
      "currency",
      "collectedMinor",
      "baselineMinor",
      "excludedRecoveryMinor",
      "exclusionStatement",
      "recoveryReason",
      "attribution",
      "evidenceRefs",
      "baselineId",
      "baselineMethodId",
      "baselineVersion",
      "baselineLockPolicy",
      "policyVersion",
      "confidenceMethodologyVersion",
      "proofThresholdUsed",
      "confidenceUsed",
    ],
    properties: {
      proofId: { type: "string", minLength: 1 },
      recoveryCaseId: { type: "string", minLength: 1 },
      approvedAt: { type: "string", minLength: 1 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      collectedMinor: { type: "integer", minimum: 0 },
      baselineMinor: { type: "integer", minimum: 0 },
      excludedRecoveryMinor: { type: "integer", minimum: 0 },
      exclusionStatement: { type: "string", minLength: 1 },
      recoveryReason: { type: "string", minLength: 1 },
      attribution: { type: "string", minLength: 1 },
      evidenceRefs: { type: "array", items: { type: "string" } },
      baselineId: { type: "string", minLength: 1 },
      baselineMethodId: { type: "string", minLength: 1 },
      baselineVersion: { type: "integer", minimum: 1 },
      baselineLockPolicy: { type: "string", minLength: 1 },
      policyVersion: { type: "string", minLength: 1 },
      confidenceMethodologyVersion: { type: "string", minLength: 1 },
      proofThresholdUsed: { type: "number" },
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
    required: ["newProofId", "status", "at"],
    properties: {
      newProofId: { type: "string", minLength: 1 },
      status: { type: "string", enum: ["Reversed", "Superseded", "Corrected"] },
      at: { type: "string", minLength: 1 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      collectedMinor: { type: "integer", minimum: 0 },
      baselineMinor: { type: "integer", minimum: 0 },
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
