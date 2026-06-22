// Audit Trail — append-only log helpers.
// Every state change appends an immutable entry. This is the seed of a future
// event-sourced model: the audit log IS the proof an action caused an outcome.
import type { AuditEntry, RecoveryEvent } from "./types";

let counter = 0;
function auditId(): string {
  counter += 1;
  return `aud_${Date.now().toString(36)}_${counter}`;
}

export function makeAuditEntry(
  type: AuditEntry["type"],
  actor: string,
  summary: string,
  before?: string,
  after?: string,
): AuditEntry {
  return {
    id: auditId(),
    at: new Date().toISOString(),
    actor,
    type,
    summary,
    before,
    after,
  };
}

/** Append an audit entry immutably and bump updatedAt. */
export function appendAudit(
  event: RecoveryEvent,
  entry: AuditEntry,
): RecoveryEvent {
  return {
    ...event,
    audit: [...event.audit, entry],
    updatedAt: entry.at,
  };
}

/** All audit entries across the portfolio, newest first (for the global log). */
export function globalAuditFeed(
  events: RecoveryEvent[],
): Array<AuditEntry & { eventId: string; customer: string }> {
  const rows = events.flatMap((e) =>
    e.audit.map((a) => ({ ...a, eventId: e.eventId, customer: e.customer })),
  );
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
