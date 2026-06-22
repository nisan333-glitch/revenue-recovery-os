import { useMemo, useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import { OPEN_STATUSES } from "../domain/types";
import { money } from "../lib/format";
import {
  ConfidenceBadge,
  Panel,
  Pill,
  SectionHeader,
  StatusBadge,
} from "../components/ui";
import { EventDetail } from "../components/EventDetail";

// Priority = dollars at risk weighted by a floor of confidence so we don't
// ignore high-value events that simply haven't been worked yet.
function priority(riskAmount: number, confidence: number): number {
  return riskAmount * (0.3 + (confidence / 100) * 0.7);
}

export function RecoveryQueue() {
  const { events } = useRecovery();
  const [openId, setOpenId] = useState<string | null>(null);

  const queue = useMemo(
    () =>
      events
        .filter((e) => OPEN_STATUSES.includes(e.status))
        .sort(
          (a, b) =>
            priority(b.riskAmount, b.confidence) -
            priority(a.riskAmount, a.confidence),
        ),
    [events],
  );

  const totalAtRisk = queue.reduce((s, e) => s + e.riskAmount, 0);
  const unassigned = queue.filter((e) => e.owner === null).length;
  const open = events.find((e) => e.eventId === openId) ?? null;

  return (
    <div>
      <SectionHeader
        title="Recovery Queue"
        subtitle="Open opportunities, prioritized by dollars at risk × confidence. This is the fix workflow."
        right={
          <div className="text-right">
            <div className="text-sm text-slate-400">
              {money(totalAtRisk)} at risk
            </div>
            <div className="text-[11px] text-detect-500">
              {unassigned} unassigned
            </div>
          </div>
        }
      />

      <div className="space-y-2">
        {queue.length === 0 && (
          <Panel className="p-6 text-center text-slate-500">
            Queue is clear — no open recovery opportunities.
          </Panel>
        )}
        {queue.map((e, i) => (
          <Panel
            key={e.eventId}
            className="flex cursor-pointer items-center gap-4 p-4 hover:bg-ink-700/30"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-600/60 text-xs text-slate-400"
              title="Queue position"
            >
              {i + 1}
            </div>
            <button
              className="flex flex-1 items-center gap-4 text-left"
              onClick={() => setOpenId(e.eventId)}
            >
              <div className="flex-1">
                <div className="font-medium text-slate-200">{e.customer}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-mono">{e.eventId}</span>
                  <Pill>{e.funnelStage}</Pill>
                  <Pill tone="detect">{e.leakageType}</Pill>
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums text-detect-500">{money(e.riskAmount)}</div>
                <div className="text-[11px] text-slate-500">at risk</div>
              </div>
              <div className="w-28 text-right">
                <div className="text-sm text-slate-400">{e.owner ?? "Unassigned"}</div>
              </div>
              <StatusBadge status={e.status} />
              <ConfidenceBadge value={e.confidence} />
            </button>
          </Panel>
        ))}
      </div>

      {open && <EventDetail event={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
