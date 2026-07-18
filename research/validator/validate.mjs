// NH Validator Stage A — orchestrator. Pure: input dataset object -> result.
// Read-only; never writes research records (no auto-correction).
//
// Pipeline (F-1/F-2 hardened):
//   1. envelope validation (from dataset.schema.json)  -> invalid => exit 1, stop
//   2. schema-conformance gate (ruleSchema, fail-closed) -> invalid => exit 1, stop
//   3. semantic rules (only on structurally-safe input)  -> errors => exit 1 else 0
//   any unexpected internal exception                     -> exit 2 (VALIDATOR_INTERNAL_ERROR)
//   (JSON parse/load failure is handled in cli.mjs/load.mjs -> exit 2)
import { normalise, loadSchemas } from "./load.mjs";
import { runSchemaRules, runSemanticRules } from "./rules.mjs";
import { loadEnvelopeSchema, checkEnvelopeContract, validateEnvelope } from "./envelope.mjs";
import { resetEventSeq, SEVERITY, EVENT_TYPE, err } from "./events.mjs";

export function validateDataset(dataset, opts = {}) {
  const {
    schemas = loadSchemas(),
    envelopeSchema = loadEnvelopeSchema(),
    runSchema = runSchemaRules,
    runSemantic = runSemanticRules,
  } = opts;

  resetEventSeq();
  try {
    // Fail closed if our own envelope contract uses an unmapped construct (=> exit 2).
    const contractProblems = checkEnvelopeContract(envelopeSchema);
    if (contractProblems.length > 0) return buildResult(contractProblems, dataset, 2);

    // 1. Envelope validation. No coercion; unknown/misspelled/non-array => blocking.
    const envErrors = validateEnvelope(dataset, envelopeSchema);
    if (envErrors.length > 0) return buildResult(envErrors, dataset, 1);

    // Envelope is valid => arrays are arrays, mission is an object. Safe to normalise.
    const norm = normalise(dataset);

    // 2. Schema-conformance gate. If any schema error, stop before semantic rules
    //    so they only ever receive schema-valid input.
    const schemaEvents = runSchema(norm, schemas);
    if (schemaEvents.some((e) => e.severity === SEVERITY.ERROR)) {
      return buildResult(schemaEvents, dataset, 1);
    }

    // 3. Semantic rules.
    const events = [...schemaEvents, ...runSemantic(norm)];
    const hasError = events.some((e) => e.severity === SEVERITY.ERROR);
    return buildResult(events, dataset, hasError ? 1 : 0);
  } catch (e) {
    // Unexpected internal defect: fail closed, exit 2, do NOT misclassify as a
    // research violation.
    const ev = err({
      rule_id: "R-VALIDATOR",
      event_type: EVENT_TYPE.VALIDATOR_INTERNAL_ERROR,
      targets: ["validator"],
      observation: `internal validator exception (fail-closed): ${e && e.message ? e.message : String(e)}`,
      protocol_ref: "validator robustness (F-2)",
    });
    return buildResult([ev], dataset, 2);
  }
}

function len(v) { return Array.isArray(v) ? v.length : 0; }

function buildResult(events, dataset, exit) {
  const d = dataset && typeof dataset === "object" && !Array.isArray(dataset) ? dataset : {};
  const errors = events.filter((e) => e.severity === SEVERITY.ERROR);
  const warnings = events.filter((e) => e.severity === SEVERITY.WARNING);
  const byRule = {};
  for (const e of events) byRule[e.rule_id] = (byRule[e.rule_id] || 0) + 1;
  const summary = {
    counts: {
      mission: d.mission && typeof d.mission === "object" && !Array.isArray(d.mission) ? 1 : 0,
      claims: len(d.claims), evidence: len(d.evidence), sources: len(d.sources),
      assumptions: len(d.assumptions), unknowns: len(d.unknowns),
      contradictions: len(d.contradictions), verdicts: len(d.verdicts),
    },
    events_total: events.length,
    errors: errors.length,
    warnings: warnings.length,
    by_rule: byRule,
    blocking: errors.length > 0,
  };
  return { events, summary, exit };
}
