// NH Validator Stage A — orchestrator. Pure: input dataset object -> result.
// Read-only; never writes research records (no auto-correction).
import { normalise, loadSchemas } from "./load.mjs";
import { runAllRules } from "./rules.mjs";
import { resetEventSeq, SEVERITY } from "./events.mjs";

// validateDataset(datasetObject) -> { events, summary, exit }
export function validateDataset(dataset, schemas = loadSchemas()) {
  resetEventSeq();
  const norm = normalise(dataset);
  const events = runAllRules(norm, schemas);

  const errors = events.filter((e) => e.severity === SEVERITY.ERROR);
  const warnings = events.filter((e) => e.severity === SEVERITY.WARNING);
  const byRule = {};
  for (const e of events) byRule[e.rule_id] = (byRule[e.rule_id] || 0) + 1;

  const summary = {
    counts: {
      mission: norm.mission ? 1 : 0,
      claims: norm.claims.length,
      evidence: norm.evidence.length,
      sources: norm.sources.length,
      assumptions: norm.assumptions.length,
      unknowns: norm.unknowns.length,
      contradictions: norm.contradictions.length,
      verdicts: norm.verdicts.length,
    },
    events_total: events.length,
    errors: errors.length,
    warnings: warnings.length,
    by_rule: byRule,
    blocking: errors.length > 0,
  };
  const exit = errors.length > 0 ? 1 : 0;
  return { events, summary, exit };
}
