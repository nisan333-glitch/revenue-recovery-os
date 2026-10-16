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
    dependencies: {
      amountMinor: ["currency"],
      currency: ["amountMinor"],
    },
    properties: {
      sourceAttestation: {
        type: "object", additionalProperties: false, required: ["keyId", "issuedAt", "signature"],
        properties: {
          keyId: { type: "string", minLength: 1, maxLength: 256 },
          issuedAt: { type: "string", minLength: 1, maxLength: 32 },
          signature: { type: "string", minLength: 88, maxLength: 88 },
        },
      },
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

export const candidateQueueSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId"],
    properties: { boundaryId: { type: "string", minLength: 1, maxLength: 256 } },
  },
} as const;

export const candidateReviewSchema = {
  params: {
    type: "object",
    required: ["candidateId"],
    properties: { candidateId: { type: "string", minLength: 1, maxLength: 256 } },
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "decision", "reason"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      decision: { type: "string", enum: ["accepted", "rejected"] },
      reason: { type: "string", minLength: 1, maxLength: 2000 },
    },
  },
} as const;

export const candidatePromotionSchema = {
  params: {
    type: "object",
    required: ["candidateId"],
    properties: { candidateId: { type: "string", minLength: 1, maxLength: 256 } },
  },
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId"],
    properties: { boundaryId: { type: "string", minLength: 1, maxLength: 256 } },
  },
} as const;

/**
 * EP-13 · Customer pilot dataset submission.
 *
 * `additionalProperties: false` at every level is the point, not boilerplate: it is what makes a
 * payload-supplied tenant (`tenantId`, `boundary`, `actorId`, …) a 400 instead of a field someone
 * later decides to honour. The ONLY tenancy input is `boundaryId`, and the service treats that as an
 * authorization request checked against the authenticated context — never as an assertion.
 *
 * `csvText.maxLength` is a TRANSPORT guard sized above the contract's own limit, so a file between
 * the two is refused by the contract with its deterministic code (NH-DC-1011) rather than by a bare
 * schema error. Neither path ever truncates.
 */
export const pilotDatasetSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "datasetId", "declaredVersion", "csvText", "provenance"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      datasetId: { type: "string", minLength: 1, maxLength: 256 },
      declaredVersion: { type: "string", minLength: 1, maxLength: 32 },
      csvText: { type: "string", minLength: 1, maxLength: 20_971_520 },
      locale: { type: "string", enum: ["MDY", "DMY"] },
      amountFormat: { type: "string", enum: ["US", "EU"] },
      admissionPolicyId: { type: "string", minLength: 1, maxLength: 256 },
      admissionPolicyVersion: { type: "string", minLength: 1, maxLength: 32 },
      // EP-26b · WHICH GOVERNED ASSESSMENT POLICY defines this reading — and nothing else. The `policy`
      // object is GONE from the request, not merely narrowed: the cut-off, the stall threshold and the
      // currency are all registered, so there is no wire format in which a requester can state any part
      // of what the assessment measures. `additionalProperties: false` on the body then makes sending
      // one a 400. The service refuses an absent reference too — this is the outer of two fail-closed
      // gates, never the only one.
      analysisTermsId: { type: "string", minLength: 1, maxLength: 256 },
      analysisTermsVersion: { type: "string", minLength: 1, maxLength: 32 },
      provenance: {
        type: "object",
        additionalProperties: false,
        required: [
          "sourceSystems",
          "dataOwnerRole",
          "extractionMethod",
          "extractedAt",
          "coverageStart",
          "coverageEnd",
          "assertedIndependentOfBeneficiary",
        ],
        properties: {
          sourceSystems: {
            type: "object",
            additionalProperties: false,
            required: ["contract", "billing", "product"],
            properties: {
              contract: { type: "string", minLength: 1, maxLength: 256 },
              billing: { type: "string", minLength: 1, maxLength: 256 },
              product: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
          dataOwnerRole: { type: "string", minLength: 1, maxLength: 256 },
          extractionMethod: { type: "string", minLength: 1, maxLength: 1024 },
          extractedAt: { type: "string", minLength: 1, maxLength: 64 },
          coverageStart: { type: "string", minLength: 1, maxLength: 32 },
          coverageEnd: { type: "string", minLength: 1, maxLength: 32 },
          assertedIndependentOfBeneficiary: { type: "boolean" },
        },
      },
    },
  },
} as const;

/**
 * EP-16 · Schedule a governed assessment execution over an already-admitted dataset.
 *
 * Note what this body CANNOT carry, and why each absence matters:
 *   • no tenant field other than `boundaryId`, which is an authorization request the service
 *     refuses unless the authenticated context already grants it;
 *   • no admission policy id or version — the bar is read from the decision that admitted the
 *     dataset, so a caller cannot ask to be executed under a different bar than the one that
 *     judged them;
 *   • no thresholds, no admission outcome, no finding — an execution reports what it computed, and
 *     nothing a caller asserts about the result is accepted as input.
 * `additionalProperties: false` with `removeAdditional: false` means an injected field is a 400,
 * never a silently stripped one.
 */
export const schedulePilotAssessmentSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "datasetId", "csvText", "provenance"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      datasetId: { type: "string", minLength: 1, maxLength: 256 },
      // S5 · `declaredVersion` IS GONE FROM THIS BODY, not merely ignored. There is no wire format in
      // which a scheduling request can state a contract version: the authoritative declaration is the
      // one recorded ON the admission, and `additionalProperties: false` under `removeAdditional: false`
      // (app.ts) makes sending one a 400 rather than a silent strip — the same treatment EP-26b gave the
      // `policy` object. It stays REQUIRED on `/pilot/datasets`, where it is the customer's own
      // declaration about their export and is persisted as made.
      //
      // Nothing replaces it. The scheduling body states no version, no threshold, no cut-off, no
      // currency, no bar and no outcome — only WHICH admitted dataset, and which decision admitted it.
      // S4 · REFERENCE-FIRST. The admission decision this execution binds to, as the intake returned
      // it. A reference, not a capability: the service looks it up boundary-scoped, so one minted for
      // another tenant reads as absent. Optional on the wire because every admission recorded before
      // the interpretation snapshot existed can only be reached by the legacy discovery path.
      admissionDecisionId: { type: "string", minLength: 1, maxLength: 256 },
      csvText: { type: "string", minLength: 1, maxLength: 20_971_520 },
      locale: { type: "string", enum: ["MDY", "DMY"] },
      amountFormat: { type: "string", enum: ["US", "EU"] },
      recoveryCaseId: { type: "string", minLength: 1, maxLength: 256 },
      // EP-26b · WHICH GOVERNED ASSESSMENT POLICY defines this reading — and nothing else. The `policy`
      // object is GONE from the request, not merely narrowed: the cut-off, the stall threshold and the
      // currency are all registered, so there is no wire format in which a requester can state any part
      // of what the assessment measures. `additionalProperties: false` on the body then makes sending
      // one a 400. The service refuses an absent reference too — this is the outer of two fail-closed
      // gates, never the only one.
      analysisTermsId: { type: "string", minLength: 1, maxLength: 256 },
      analysisTermsVersion: { type: "string", minLength: 1, maxLength: 32 },
      provenance: {
        type: "object",
        additionalProperties: false,
        required: [
          "sourceSystems",
          "dataOwnerRole",
          "extractionMethod",
          "extractedAt",
          "coverageStart",
          "coverageEnd",
          "assertedIndependentOfBeneficiary",
        ],
        properties: {
          sourceSystems: {
            type: "object",
            additionalProperties: false,
            required: ["contract", "billing", "product"],
            properties: {
              contract: { type: "string", minLength: 1, maxLength: 256 },
              billing: { type: "string", minLength: 1, maxLength: 256 },
              product: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
          dataOwnerRole: { type: "string", minLength: 1, maxLength: 256 },
          extractionMethod: { type: "string", minLength: 1, maxLength: 1024 },
          extractedAt: { type: "string", minLength: 1, maxLength: 64 },
          coverageStart: { type: "string", minLength: 1, maxLength: 32 },
          coverageEnd: { type: "string", minLength: 1, maxLength: 32 },
          assertedIndependentOfBeneficiary: { type: "boolean" },
        },
      },
    },
  },
} as const;

/** EP-16 · Read one execution. Boundary is required and is re-authorized in the service. */
export const pilotAssessmentReadSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["executionId"],
    properties: { executionId: { type: "string", pattern: "^PAX-[a-f0-9]{32}$" } },
  },
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId"],
    properties: { boundaryId: { type: "string", minLength: 1, maxLength: 256 } },
  },
} as const;

/** EP-16 · List executions for one boundary — the UI's status board. */
export const pilotAssessmentListSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
} as const;

/**
 * EP-14 · Register a versioned pilot admission policy.
 *
 * Every threshold is `required` here as well as in the domain. A schema that let one be omitted
 * would push the "unset means no limit" decision one layer down, where it is harder to see.
 */
//
// FINDING 3 · `calculationMethodVersion` IS GONE FROM THIS BODY. Its own documented meaning is "which
// evaluator computed the rates", so it is a statement about the SERVER's implementation and was never
// the operator's to make. An audit proved the consequence: an arbitrary label passed validation with
// zero defects, changed `admissionPolicyHash`, and therefore changed the `PAD-` frozen into the
// decision — while the evaluator that actually ran was untouched and recorded separately. That is the
// proof capturing a CLAIMED calculation, which Trust Invariant rule 4 forbids.
//
// The server now stamps `ADMISSION_EVALUATOR_VERSION` instead. Same treatment, same stated reason, as
// `analysisTermsSchema` below.
export const admissionPolicySchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "policy", "rationale"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      // Required, not optional: a threshold with no stated reasoning cannot be reviewed, and
      // governance is asked to put it in force on the strength of that reasoning.
      rationale: { type: "string", minLength: 1, maxLength: 2000 },
      policy: {
        type: "object",
        additionalProperties: false,
        required: [
          "policyId",
          "policyVersion",
          "minAcceptedRows",
          "minDistinctEntities",
          "maxRejectionRate",
          "maxSingleReasonShare",
          "maxDuplicateRate",
          "minCoverageDays",
          "requiredLifecycleStates",
          "maxOrderingDefectRate",
          "maxMissingRecommendedColumns",
          "requireProvenanceDeclaration",
        ],
        properties: {
          policyId: { type: "string", minLength: 1, maxLength: 256 },
          policyVersion: { type: "string", minLength: 1, maxLength: 32 },
          minAcceptedRows: { type: "integer", minimum: 0, maximum: 1000000 },
          minDistinctEntities: { type: "integer", minimum: 0, maximum: 1000000 },
          maxRejectionRate: { type: "number", minimum: 0, maximum: 1 },
          maxSingleReasonShare: { type: "number", minimum: 0, maximum: 1 },
          maxDuplicateRate: { type: "number", minimum: 0, maximum: 1 },
          minCoverageDays: { type: "integer", minimum: 0, maximum: 36500 },
          requiredLifecycleStates: {
            type: "array",
            maxItems: 3,
            items: { type: "string", enum: ["stalled", "reference", "undetermined"] },
          },
          maxOrderingDefectRate: { type: "number", minimum: 0, maximum: 1 },
          maxMissingRecommendedColumns: { type: "integer", minimum: 0, maximum: 64 },
          requireProvenanceDeclaration: { type: "boolean" },
        },
      },
    },
  },
} as const;

/** EP-15 · Move an admission policy version through its lifecycle. Governance only. */
export const policyTransitionSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "policyId", "policyVersion", "rationale"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      policyId: { type: "string", minLength: 1, maxLength: 256 },
      policyVersion: { type: "string", minLength: 1, maxLength: 32 },
      rationale: { type: "string", minLength: 1, maxLength: 2000 },
    },
  },
} as const;

/**
 * EP-26 · Propose an analysis-terms version.
 *
 * `rationale` is required for the same reason it is on an admission policy: governance is asked to put
 * a definition in force on the strength of its stated reasoning, and a cut-off with no reason given
 * cannot be reviewed. There is no `calculationMethodVersion` here — it is a build constant, not an
 * operator choice, so letting a request state it would invite a definition blessed for an
 * implementation that never ran it.
 */
export const analysisTermsSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "terms", "rationale"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      // Not merely non-empty: `minLength` alone accepts "   ", which is not a stated reason. The DB
      // CHECK would refuse it either way — this refuses it at the edge, with a 400 instead of a 500.
      rationale: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
      terms: {
        type: "object",
        additionalProperties: false,
        required: ["termsId", "termsVersion", "asOf", "stallThresholdDays", "currency"],
        properties: {
          termsId: { type: "string", minLength: 1, maxLength: 256 },
          termsVersion: { type: "string", minLength: 1, maxLength: 32 },
          asOf: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          stallThresholdDays: { type: "integer", minimum: 0, maximum: 3650 },
          // Shape only. WHICH codes are supported is a domain decision, and the constructor answers it.
          currency: { type: "string", minLength: 3, maxLength: 3 },
        },
      },
    },
  },
} as const;

/**
 * Re-assess an already-admitted dataset under a new calculation method, with NO file re-supplied.
 *
 * Note what is absent: no `csvText`. That is the whole point — the retained, hash-verified input is
 * reused, so the customer is not asked to produce the file again. And no thresholds, no cut-off, no
 * currency: the request names WHICH governed definition blesses the new method and nothing about what is
 * measured. A definition that changes the cut-off, the threshold or the currency is refused
 * (NH-AX-1016), because that is a different reading of the data and the admission was for the old one.
 *
 * `reason` is required, and required to be non-blank at the transport as well as in the service and the
 * database: a revision nobody can explain is indistinguishable from a quiet re-grade.
 */
export const reassessPilotAssessmentSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "executionId", "analysisTermsId", "analysisTermsVersion", "reason"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      executionId: { type: "string", minLength: 1, maxLength: 256 },
      analysisTermsId: { type: "string", minLength: 1, maxLength: 256 },
      analysisTermsVersion: { type: "string", minLength: 1, maxLength: 32 },
      reason: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
    },
  },
} as const;

/** EP-26 · Activate, freeze, resume or retire one analysis-terms version. */
export const analysisTermsTransitionSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "termsId", "termsVersion", "rationale"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      termsId: { type: "string", minLength: 1, maxLength: 256 },
      termsVersion: { type: "string", minLength: 1, maxLength: 32 },
      rationale: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
    },
  },
} as const;

/** EP-26 · Governed read of one analysis-terms version's lifecycle. */
export const analysisTermsGovernanceQuerySchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "termsId", "termsVersion"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      termsId: { type: "string", minLength: 1, maxLength: 256 },
      termsVersion: { type: "string", minLength: 1, maxLength: 32 },
    },
  },
} as const;

/** EP-26 · The definitions a boundary may cite, with their values and their lifecycle state. */
export const analysisTermsListQuerySchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId"],
    properties: { boundaryId: { type: "string", minLength: 1, maxLength: 256 } },
  },
} as const;

/** EP-15 · Governed read of a policy's lifecycle. */
export const policyGovernanceQuerySchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["boundaryId", "policyId", "policyVersion"],
    properties: {
      boundaryId: { type: "string", minLength: 1, maxLength: 256 },
      policyId: { type: "string", minLength: 1, maxLength: 256 },
      policyVersion: { type: "string", minLength: 1, maxLength: 32 },
    },
  },
} as const;
