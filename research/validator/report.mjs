// NH Validator Stage A — report formatters (machine + human).

export function machineReport(result) {
  return JSON.stringify({
    tool: "nh-research-validator",
    stage: "A (deterministic)",
    note: "Deterministic layer only. NOT the integrated NH multi-agent validation system. Does not replace the human L3/L4 review gate.",
    summary: result.summary,
    events: result.events,
    exit: result.exit,
  }, null, 2);
}

export function humanReport(result) {
  const { summary, events } = result;
  const lines = [];
  lines.push("NH Research Validator — Stage A (deterministic; NOT multi-agent validation)");
  lines.push("=".repeat(72));
  const c = summary.counts;
  lines.push(`objects: mission=${c.mission} claims=${c.claims} evidence=${c.evidence} sources=${c.sources} assumptions=${c.assumptions} unknowns=${c.unknowns} contradictions=${c.contradictions} verdicts=${c.verdicts}`);
  lines.push(`events: ${summary.events_total}  errors(blocking)=${summary.errors}  warnings(review)=${summary.warnings}`);
  lines.push("");
  if (events.length === 0) {
    lines.push("No findings.");
  } else {
    for (const e of events) {
      const tag = e.severity === "ERROR" ? "ERROR " : e.severity === "WARNING" ? "WARN  " : "INFO  ";
      lines.push(`[${tag}] ${e.event_id} ${e.rule_id} (${e.event_type})`);
      lines.push(`         targets: ${e.targets.join(", ")}`);
      lines.push(`         ${e.observation}`);
      lines.push(`         basis: ${e.protocol_ref}`);
    }
  }
  lines.push("");
  if (result.exit === 2) {
    lines.push(`RESULT: VALIDATOR ERROR — exit 2 (internal validator failure or unsupported envelope contract). No research verdict was produced; this is a validator defect, not a research violation.`);
  } else if (summary.blocking) {
    lines.push(`RESULT: BLOCKED — ${summary.errors} blocking error(s). exit 1.`);
  } else {
    lines.push(`RESULT: PASS (deterministic) — ${summary.warnings} advisory warning(s). exit 0.`);
  }
  lines.push("Reminder: passing means structurally/rule consistent, not that any verdict is true.");
  lines.push("L3 needs an independent Critical Reviewer; L4 needs primary access + independent review.");
  return lines.join("\n");
}
