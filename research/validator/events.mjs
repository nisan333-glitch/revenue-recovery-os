// NH Validator Stage A — Validation Event model (deterministic).
// Severity: ERROR (blocking) | WARNING (advisory / REVIEW_REQUIRED) | INFO.
// blocking === (severity === "ERROR"). No auto-correction: events are reports only.

export const SEVERITY = { ERROR: "ERROR", WARNING: "WARNING", INFO: "INFO" };

// Controlled event types (map to rule ids in rules.mjs / README).
export const EVENT_TYPE = {
  SCHEMA_INVALID: "SCHEMA_INVALID",
  SCHEMA_VALIDATOR_UNSUPPORTED_KEYWORD: "SCHEMA_VALIDATOR_UNSUPPORTED_KEYWORD",
  ID_DUPLICATE: "ID_DUPLICATE",
  XREF_BROKEN: "XREF_BROKEN",
  EVIDENCE_DIRECTION_MISMATCH: "EVIDENCE_DIRECTION_MISMATCH",
  VERDICT_UNSUPPORTED_BY_EVIDENCE: "VERDICT_UNSUPPORTED_BY_EVIDENCE",
  VERDICT_EXCEEDS_EVIDENCE: "VERDICT_EXCEEDS_EVIDENCE",
  CONTRADICTION_MATERIAL_UNRESOLVED: "CONTRADICTION_MATERIAL_UNRESOLVED",
  ASSUMPTION_FATAL_OPEN: "ASSUMPTION_FATAL_OPEN",
  UNKNOWN_BLOCKS_CLOSURE: "UNKNOWN_BLOCKS_CLOSURE",
  // advisory
  LINEAGE_POSSIBLE_FALSE_INDEPENDENCE: "LINEAGE_POSSIBLE_FALSE_INDEPENDENCE",
  VERDICT_STRENGTH_UNKNOWN: "VERDICT_STRENGTH_UNKNOWN",
  CONTRADICTION_OPEN_REVIEW: "CONTRADICTION_OPEN_REVIEW",
  CONFIDENCE_POSSIBLE_INFLATION: "CONFIDENCE_POSSIBLE_INFLATION",
  REVENUE_PROVEN_REVIEW_REQUIRED: "REVENUE_PROVEN_REVIEW_REQUIRED",
  SOURCE_ORPHAN: "SOURCE_ORPHAN",
};

let _seq = 0;
export function resetEventSeq() { _seq = 0; }

export function makeEvent({ rule_id, event_type, severity, targets = [], observation, protocol_ref }) {
  _seq += 1;
  return {
    event_id: `VE-${String(_seq).padStart(4, "0")}`,
    rule_id,
    event_type,
    severity,
    blocking: severity === SEVERITY.ERROR,
    targets,
    observation,
    protocol_ref: protocol_ref || null,
  };
}

export const err = (o) => makeEvent({ ...o, severity: SEVERITY.ERROR });
export const warn = (o) => makeEvent({ ...o, severity: SEVERITY.WARNING });
