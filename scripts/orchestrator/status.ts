// The owner's read-only status view.
//
// WHAT THIS IS. A pure projection of the orchestrator's state into the four things the owner asked to see:
// what works, what is missing, what is blocked, and what is needed from them. It decides nothing and changes
// nothing.
//
// AN EMPTY LEDGER IS `NOT_ESTABLISHABLE`, NOT HEALTHY. A report that examined no task and said "all good"
// would be worse than no report, because it reads as a check that passed. This is the same rule the absorbed-
// observation diagnostic follows: reporting success having examined nothing is the one outcome that makes a
// tool worse than not existing.
//
// NO CREDENTIAL AND NO REVENUE FIGURE. Lines carry task ids, states, our own reason strings, and spend in
// cents labelled OPERATING_COST. They carry no credential, no provider key material, and no Revenue Returned,
// Auditable, recovered or collected figure — API spend is a cost, not money the product found.
//
// PURE. No clock of its own, no filesystem, no network, no process exit.

import { breakerPhase, type BreakerPolicy } from "./guards.ts";
import { needsAttention } from "./task.ts";
import { spend, type OrchestratorConfig, type OrchestratorState, DEFAULT_CONFIG } from "./orchestrator.ts";

export type Establishment = "ESTABLISHED" | "NOT_ESTABLISHABLE";

export interface StatusReport {
  establishment: Establishment;
  /** Why nothing could be established, when that is the answer. */
  notEstablishableReason: string | null;
  works: readonly string[];
  missing: readonly string[];
  blocked: readonly string[];
  neededFromOwner: readonly string[];
  counts: {
    tasks: number;
    succeeded: number;
    failed: number;
    refused: number;
    queued: number;
    modelCalls: number;
  };
  spend: ReturnType<typeof spend>;
  breaker: { phase: string; consecutiveFailures: number; openedAt: string | null };
}

export interface LivePortStatus {
  available: boolean;
  reason: string | null;
  remedy: string | null;
}

export function buildStatus(
  state: OrchestratorState,
  now: Date,
  livePort: LivePortStatus,
  config: OrchestratorConfig = DEFAULT_CONFIG,
): StatusReport {
  const tasks = Object.values(state.tasks);
  const calls = Object.values(state.calls);
  const counts = {
    tasks: tasks.length,
    succeeded: tasks.filter((t) => t.state === "succeeded").length,
    failed: tasks.filter((t) => t.state === "failed").length,
    refused: tasks.filter((t) => t.state === "refused").length,
    queued: tasks.filter((t) => t.state === "queued" || t.state === "running").length,
    modelCalls: calls.length,
  };

  const works: string[] = [];
  const missing: string[] = [];
  const blocked: string[] = [];
  const neededFromOwner: string[] = [];

  if (counts.succeeded > 0) works.push(`${counts.succeeded} task(s) completed with a recorded model answer`);
  if (calls.some((c) => c.implementation !== "openai-chat-completions")) {
    works.push("the sequence is proven against an injected stub port — a stub run is never a live run");
  }
  if (calls.some((c) => c.implementation === "openai-chat-completions")) {
    works.push("at least one LIVE provider call is recorded");
  }

  if (!livePort.available) {
    missing.push(`the live provider port is unavailable: ${livePort.reason ?? "unknown reason"}`);
    if (livePort.remedy !== null) neededFromOwner.push(livePort.remedy);
  }

  const phase = breakerPhase(state.breaker, now, config.breaker as BreakerPolicy);
  if (phase !== "closed") blocked.push(`the circuit breaker is ${phase} after ${state.breaker.consecutiveFailures} consecutive failure(s)`);

  const report = spend(state, config);
  if (report.remainingCents <= 0) blocked.push(`the API budget is exhausted: cap ${report.capCents}c, settled ${report.settledCents}c`);
  if (report.totalSpendCents === null && report.totalSpendUnestablishedReason !== null) {
    missing.push(report.totalSpendUnestablishedReason);
  }

  for (const t of needsAttention(state.tasks)) {
    blocked.push(`task ${t.id} is ${t.state} after ${t.attempts} attempt(s): ${t.reason ?? "no reason recorded"}`);
  }
  for (const a of state.approvals) {
    neededFromOwner.push(`approve or decline '${a.action}' for task ${a.taskId} — ${a.reason} (raised ${a.raisedAt})`);
  }

  const nothingExamined = counts.tasks === 0 && counts.modelCalls === 0;
  return {
    establishment: nothingExamined ? "NOT_ESTABLISHABLE" : "ESTABLISHED",
    notEstablishableReason: nothingExamined
      ? "no task and no model call were examined; this is NOT a statement that the orchestrator is healthy"
      : null,
    works: Object.freeze(works),
    missing: Object.freeze(missing),
    blocked: Object.freeze(blocked),
    neededFromOwner: Object.freeze(neededFromOwner),
    counts,
    spend: report,
    breaker: { phase, consecutiveFailures: state.breaker.consecutiveFailures, openedAt: state.breaker.openedAt },
  };
}

/** Render the report as plain lines. The CLI prints these; nothing else formats state. */
export function renderStatus(report: StatusReport): string[] {
  const lines: string[] = [];
  lines.push(`establishment: ${report.establishment}`);
  if (report.notEstablishableReason !== null) lines.push(`  reason: ${report.notEstablishableReason}`);
  lines.push(
    `tasks: ${report.counts.tasks} (succeeded ${report.counts.succeeded}, failed ${report.counts.failed}, ` +
      `refused ${report.counts.refused}, queued ${report.counts.queued}) · model calls: ${report.counts.modelCalls}`,
  );
  const s = report.spend;
  lines.push(
    `${s.label}: cap ${s.capCents}c · settled ${s.settledCents}c · reserved ${s.reservedCents}c · remaining ${s.remainingCents}c · ` +
      `total ${s.totalSpendCents === null ? "NOT COMPUTED" : `${s.totalSpendCents}c`}`,
  );
  if (s.totalSpendUnestablishedReason !== null) lines.push(`  ${s.totalSpendUnestablishedReason}`);
  lines.push(`breaker: ${report.breaker.phase} (consecutive failures ${report.breaker.consecutiveFailures})`);
  const section = (title: string, items: readonly string[]): void => {
    lines.push(`${title}:`);
    if (items.length === 0) lines.push("  (none)");
    else for (const i of items) lines.push(`  - ${i}`);
  };
  section("WORKS", report.works);
  section("MISSING", report.missing);
  section("BLOCKED", report.blocked);
  section("NEEDED FROM OWNER", report.neededFromOwner);
  return lines;
}
