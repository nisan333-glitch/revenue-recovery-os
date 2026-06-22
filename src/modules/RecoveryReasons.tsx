import { useRecovery } from "../state/RecoveryContext";
import { RECOVERY_REASONS } from "../domain/reasons";
import { byReason } from "../domain/metrics";
import { isCounted } from "../domain/invariants";
import { money } from "../lib/format";
import { Panel, SectionHeader } from "../components/ui";

export function RecoveryReasons() {
  const { events } = useRecovery();
  const buckets = byReason(events);
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  const unclassified = events.filter(
    (e) => e.recoveryReason === null && e.status === "Recovered",
  );

  return (
    <div>
      <SectionHeader
        title="Recovery Reasons"
        subtitle="The canonical taxonomy. A dollar is only counted when attributed to a reason."
      />

      {unclassified.length > 0 && (
        <Panel className="mb-5 border-detect-600/40 p-4">
          <div className="text-sm font-medium text-detect-500">
            {unclassified.length} recovered event(s) are unclassified and excluded
            from all totals
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {unclassified.map((e) => `${e.customer} (${e.eventId})`).join(", ")} —
            classify a reason to count them.
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {RECOVERY_REASONS.map((r) => {
          const b = byKey.get(r.key);
          const matching = events.filter((e) => e.recoveryReason === r.key);
          const counted = matching.filter(isCounted);
          const avgConf =
            counted.length > 0
              ? Math.round(
                  counted.reduce((s, e) => s + e.confidence, 0) / counted.length,
                )
              : 0;
          return (
            <Panel key={r.key} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-slate-100">{r.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Applies to: {r.appliesTo}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular-nums font-medium text-proof-500">
                    {money(b?.recovered ?? 0)}
                  </div>
                  <div className="text-[11px] text-slate-500">recovered</div>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-400">{r.description}</p>
              <div className="mt-3 flex gap-4 text-[11px] text-slate-500">
                <span>{counted.length} counted</span>
                <span>{matching.length} total events</span>
                <span>avg conf. {avgConf}</span>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
