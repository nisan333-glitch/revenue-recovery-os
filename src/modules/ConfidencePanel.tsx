import { useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import {
  PROOF_THRESHOLD,
  MEDIUM_THRESHOLD,
  bandOf,
} from "../domain/confidence";
import { isCounted } from "../domain/invariants";
import { money } from "../lib/format";
import {
  ConfidenceBadge,
  Panel,
  SectionHeader,
  StatCard,
} from "../components/ui";
import { reportableReturned } from "../domain/invariants";
import { EventDetail } from "../components/EventDetail";

export function ConfidencePanel() {
  const { events } = useRecovery();
  const [openId, setOpenId] = useState<string | null>(null);

  const counted = events.filter(isCounted);
  const high = counted.filter((e) => bandOf(e.confidence) === "High");
  const medium = counted.filter((e) => bandOf(e.confidence) === "Medium");
  const low = counted.filter((e) => bandOf(e.confidence) === "Low");

  const sum = (es: typeof counted) =>
    es.reduce((s, e) => s + reportableReturned(e), 0);

  const open = events.find((e) => e.eventId === openId) ?? null;

  return (
    <div>
      <SectionHeader
        title="Confidence Score"
        subtitle="Why a recovery is — or isn't — proof-grade. Low confidence stays visible but separated."
      />

      <div className="mb-5 grid grid-cols-3 gap-4">
        <StatCard
          label={`High (≥ ${PROOF_THRESHOLD}) — proof-grade`}
          value={money(sum(high))}
          sub={`${high.length} events · CFO-auditable`}
          tone="proof"
        />
        <StatCard
          label={`Medium (${MEDIUM_THRESHOLD}–${PROOF_THRESHOLD - 1})`}
          value={money(sum(medium))}
          sub={`${medium.length} events · excluded from CFO`}
          tone="detect"
        />
        <StatCard
          label={`Low (< ${MEDIUM_THRESHOLD})`}
          value={money(sum(low))}
          sub={`${low.length} events · needs evidence`}
        />
      </div>

      <Panel className="mb-5 p-4 text-sm text-slate-400">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          The model is transparent, not a black box
        </h3>
        <p>
          Confidence is the sum of explainable factors: a recovery reason is
          attributed (+30), collection exceeds baseline (+25), evidence is captured
          (+20), actions are documented (up to +15), and an owner is accountable
          (+10). Open the breakdown on any event to see exactly why it scored what
          it did. Only events at or above {PROOF_THRESHOLD} flow into the CFO Proof
          View.
        </p>
      </Panel>

      <Panel className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-600/50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Confidence</th>
              <th className="px-4 py-3">Proof-eligible?</th>
            </tr>
          </thead>
          <tbody>
            {counted
              .slice()
              .sort((a, b) => b.confidence - a.confidence)
              .map((e) => (
                <tr
                  key={e.eventId}
                  onClick={() => setOpenId(e.eventId)}
                  className="cursor-pointer border-b border-ink-700/40 hover:bg-ink-700/30"
                >
                  <td className="px-4 py-3">
                    <span className="text-slate-200">{e.customer}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-500">
                      {e.eventId}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{e.recoveryReason}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                    {money(reportableReturned(e))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ConfidenceBadge value={e.confidence} />
                  </td>
                  <td className="px-4 py-3">
                    {e.confidence >= PROOF_THRESHOLD ? (
                      <span className="text-proof-500">✓ eligible</span>
                    ) : (
                      <span className="text-detect-500">excluded</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>

      {open && <EventDetail event={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
