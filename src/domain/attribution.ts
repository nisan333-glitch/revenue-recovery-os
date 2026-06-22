// Attribution Engine — how recovered dollars are credited, transparently.
// The baseline methodology is stated in plain language so a skeptical CFO can
// follow exactly how "Revenue Returned" was derived for every line.
import type { RecoveryEvent } from "./types";
import { reasonLabel } from "./reasons";
import { reportableReturned, isAuditable, isCounted } from "./invariants";

export const BASELINE_METHODOLOGY = [
  "Baseline = the amount we would have collected WITHOUT intervention " +
    "(the counterfactual), estimated conservatively per leakage type.",
  "Collected = the amount actually collected after the recovery action.",
  "Revenue Returned = Collected − Baseline. It is always derived, never entered.",
  "Only events with a recovery reason are attributed; unclassified events are excluded.",
  "Only proof-grade confidence (≥ threshold) flows into the CFO auditable total.",
];

export interface AttributionLine {
  groupKey: string;
  label: string;
  count: number;
  baseline: number;
  collected: number;
  returned: number;
  auditableReturned: number;
}

type Grouper = (e: RecoveryEvent) => string;

function attributeBy(
  events: RecoveryEvent[],
  grouper: Grouper,
  labeler: (key: string) => string,
): AttributionLine[] {
  const map = new Map<string, RecoveryEvent[]>();
  for (const e of events.filter(isCounted)) {
    const key = grouper(e);
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  const lines: AttributionLine[] = [...map.entries()].map(([key, es]) => ({
    groupKey: key,
    label: labeler(key),
    count: es.length,
    baseline: es.reduce((s, e) => s + e.baselineAmount, 0),
    collected: es.reduce((s, e) => s + e.collectedAmount, 0),
    returned: es.reduce((s, e) => s + reportableReturned(e), 0),
    auditableReturned: es
      .filter(isAuditable)
      .reduce((s, e) => s + reportableReturned(e), 0),
  }));
  return lines.sort((a, b) => b.returned - a.returned);
}

export function attributeByReason(events: RecoveryEvent[]): AttributionLine[] {
  return attributeBy(
    events,
    (e) => e.recoveryReason ?? "Unclassified",
    (k) => reasonLabel(k === "Unclassified" ? null : (k as never)),
  );
}

export function attributeByOwner(events: RecoveryEvent[]): AttributionLine[] {
  return attributeBy(
    events,
    (e) => e.owner ?? "Unassigned",
    (k) => k,
  );
}

export function attributeByStage(events: RecoveryEvent[]): AttributionLine[] {
  return attributeBy(
    events,
    (e) => e.funnelStage,
    (k) => k,
  );
}
