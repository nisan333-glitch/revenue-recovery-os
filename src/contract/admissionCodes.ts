// EP-14 · Reason codes for the Pilot Assessment Admission Gate.
//
// Separate catalogue from the data contract's NH-DC-#### on purpose. Those answer "is this file
// valid?"; these answer "is this dataset FIT for a pilot?". Conflating them would let a fitness
// judgement look like a parsing error, and would make a customer think a rejection rate they must
// discuss commercially is something they can fix by re-exporting.
//
// 1xxx — the POLICY is unusable (thresholds absent/invalid). Always NOT_ASSESSABLE.
// 2xxx — the DATASET fails a configured threshold. NOT_ADMISSIBLE.
// 3xxx — the evaluation itself cannot proceed. NOT_ASSESSABLE.
//
// Like the contract's codes, these are permanent: a superseded code is retired, never recycled.

export type AdmissionSeverity = "not_assessable" | "not_admissible";

export interface AdmissionCodeSpec {
  readonly code: string;
  readonly severity: AdmissionSeverity;
  readonly title: string;
  /** What someone must actually do — often a decision to make, not a file to fix. */
  readonly remediation: string;
  readonly since: string;
}

function code(spec: AdmissionCodeSpec): AdmissionCodeSpec {
  return Object.freeze(spec);
}

// ── 1xxx · Policy is unusable ─────────────────────────────────────────────────────────────────────

export const POLICY_CODES = Object.freeze({
  POLICY_MISSING: code({
    code: "NH-AG-1001",
    severity: "not_assessable",
    title: "No pilot admission policy was supplied for this dataset.",
    remediation:
      "Register a versioned admission policy for this pilot before assessing. There is deliberately no default: the fitness bar is a commercial decision, and a system that picks its own would be grading its own homework.",
    since: "1.0.0",
  }),
  THRESHOLD_NOT_CONFIGURED: code({
    code: "NH-AG-1002",
    severity: "not_assessable",
    title: "A required admission threshold is not configured.",
    remediation:
      "Set the named threshold explicitly in the policy. An unset threshold is never treated as 'no limit' — an unanswered question cannot be a passing answer.",
    since: "1.0.0",
  }),
  THRESHOLD_INVALID: code({
    code: "NH-AG-1003",
    severity: "not_assessable",
    title: "A configured admission threshold is outside its valid range.",
    remediation: "Correct the policy. Rates are fractions between 0 and 1; counts and day spans are non-negative integers.",
    since: "1.0.0",
  }),
  POLICY_VERSION_MALFORMED: code({
    code: "NH-AG-1004",
    severity: "not_assessable",
    title: "The admission policy's identity or version is missing or malformed.",
    remediation: "Give the policy a non-empty id and a semantic version, so the decision it produces can be reproduced.",
    since: "1.0.0",
  }),
});

// ── 2xxx · Dataset fails a configured threshold ───────────────────────────────────────────────────

export const DATASET_CODES = Object.freeze({
  SAMPLE_TOO_SMALL: code({
    code: "NH-AG-2001",
    severity: "not_admissible",
    title: "Fewer accepted rows than the policy's minimum sample.",
    remediation: "Widen the export window or correct the rejected rows. A handful of surviving rows cannot characterise a population.",
    since: "1.0.0",
  }),
  TOO_FEW_ENTITIES: code({
    code: "NH-AG-2002",
    severity: "not_admissible",
    title: "Fewer distinct entities than the policy's minimum.",
    remediation:
      "Include more accounts. Many cycles belonging to a few accounts look like a large sample and are not one — the same customer's behaviour repeated is a single observation of a population.",
    since: "1.0.0",
  }),
  REJECTION_RATE_TOO_HIGH: code({
    code: "NH-AG-2003",
    severity: "not_admissible",
    title: "The proportion of rejected rows exceeds the policy's ceiling.",
    remediation:
      "Fix the rejections at source and re-export. What survived may be systematically different from what did not, and nothing downstream can detect that.",
    since: "1.0.0",
  }),
  REJECTION_CONCENTRATED: code({
    code: "NH-AG-2004",
    severity: "not_admissible",
    title: "Rejections are concentrated in a single reason beyond the policy's ceiling.",
    remediation:
      "Investigate that one reason. Rejections concentrated in one cause usually mean a systematic export defect affecting one kind of record — which is exactly the kind of bias a rate alone hides.",
    since: "1.0.0",
  }),
  DUPLICATE_RATE_TOO_HIGH: code({
    code: "NH-AG-2005",
    severity: "not_admissible",
    title: "The proportion of duplicate rows exceeds the policy's ceiling.",
    remediation: "De-duplicate at source. A high duplicate rate means the export's grain is not what it claims to be.",
    since: "1.0.0",
  }),
  COVERAGE_TOO_SHORT: code({
    code: "NH-AG-2006",
    severity: "not_admissible",
    title: "The observed period is shorter than the policy's minimum coverage.",
    remediation: "Extend the export window. A period shorter than one billing cycle cannot show whether an invoice was eventually paid.",
    since: "1.0.0",
  }),
  LIFECYCLE_COVERAGE_MISSING: code({
    code: "NH-AG-2007",
    severity: "not_admissible",
    title: "A lifecycle state the policy requires is absent from the accepted rows.",
    remediation:
      "Include the missing state. Without both stalled and non-deviant cycles there is nothing to compare, and a stalled-only extract cannot support any statement about what normal looks like.",
    since: "1.0.0",
  }),
  ORDERING_QUALITY_TOO_LOW: code({
    code: "NH-AG-2008",
    severity: "not_admissible",
    title: "Too many rows had impossible or unresolvable event ordering.",
    remediation:
      "Fix the timestamps at source. Widespread ordering defects mean the sequence the pilot depends on — signed, then activated, then invoiced — is not reliably recorded.",
    since: "1.0.0",
  }),
  MISSING_RECOMMENDED_COLUMNS: code({
    code: "NH-AG-2009",
    severity: "not_admissible",
    title: "More recommended columns are absent than the policy permits.",
    remediation: "Supply the missing columns. Each absent one removes a distinction the assessment would otherwise be able to make.",
    since: "1.0.0",
  }),
  PROVENANCE_INCOMPLETE: code({
    code: "NH-AG-2010",
    severity: "not_admissible",
    title: "The policy requires a declared source independence assertion, and none was made.",
    remediation:
      "Record the provenance declaration. Note this remains an assertion either way — the gate checks that someone answered, never that the answer is true.",
    since: "1.0.0",
  }),
});

// ── 3xxx · Evaluation cannot proceed ──────────────────────────────────────────────────────────────

export const EVALUATION_CODES = Object.freeze({
  DATASET_NOT_USABLE: code({
    code: "NH-AG-3001",
    severity: "not_assessable",
    title: "The dataset is not technically usable, so pilot fitness cannot be judged.",
    remediation: "Resolve the data-contract findings first. Admission is a question about a dataset that at least parses.",
    since: "1.0.0",
  }),
  COVERAGE_WINDOW_UNAVAILABLE: code({
    code: "NH-AG-3002",
    severity: "not_assessable",
    title: "The observed period could not be computed from the accepted rows.",
    remediation: "Ensure obligation dates are present and valid. Coverage cannot be assumed when it cannot be measured.",
    since: "1.0.0",
  }),
});

export const ALL_ADMISSION_CODES: readonly AdmissionCodeSpec[] = Object.freeze([
  ...Object.values(POLICY_CODES),
  ...Object.values(DATASET_CODES),
  ...Object.values(EVALUATION_CODES),
]);

export function admissionCode(code: string): AdmissionCodeSpec | undefined {
  return ALL_ADMISSION_CODES.find((c) => c.code === code);
}
