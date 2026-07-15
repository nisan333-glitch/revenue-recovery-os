// Pure reporting helpers over an AssessmentResult, used by BOTH the UI and the export so the
// grouping logic lives in one place, outside React components.
import type { AssessmentResult } from "./types";

export interface ExclusionGroup {
  readonly reason: string;
  readonly count: number;
}

/** Group exclusions by reason, most frequent first. Deterministic. */
export function summarizeExclusions(result: AssessmentResult): ExclusionGroup[] {
  const counts = new Map<string, number>();
  for (const e of result.exclusions) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
