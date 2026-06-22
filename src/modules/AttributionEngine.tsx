import { useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import {
  attributeByOwner,
  attributeByReason,
  attributeByStage,
  type AttributionLine,
  BASELINE_METHODOLOGY,
} from "../domain/attribution";
import { money } from "../lib/format";
import { Panel, SectionHeader } from "../components/ui";

type Dimension = "reason" | "owner" | "stage";

export function AttributionEngine() {
  const { events } = useRecovery();
  const [dim, setDim] = useState<Dimension>("reason");

  const lines: AttributionLine[] =
    dim === "reason"
      ? attributeByReason(events)
      : dim === "owner"
        ? attributeByOwner(events)
        : attributeByStage(events);

  const totalReturned = lines.reduce((s, l) => s + l.returned, 0);
  const totalAuditable = lines.reduce((s, l) => s + l.auditableReturned, 0);

  return (
    <div>
      <SectionHeader
        title="Attribution Engine"
        subtitle="How every recovered dollar is credited — transparently enough to defend."
      />

      <Panel className="mb-5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Baseline methodology
        </h3>
        <ul className="space-y-1 text-sm text-slate-400">
          {BASELINE_METHODOLOGY.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-proof-500">›</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mb-4 flex gap-2">
        {(["reason", "owner", "stage"] as Dimension[]).map((d) => (
          <button
            key={d}
            onClick={() => setDim(d)}
            className={`rounded-lg px-3 py-1.5 text-sm capitalize ${
              dim === d
                ? "bg-ink-600/70 text-slate-100"
                : "text-slate-400 hover:bg-ink-700/50"
            }`}
          >
            By {d}
          </button>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-600/50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 capitalize">{dim}</th>
              <th className="px-4 py-3 text-right">Events</th>
              <th className="px-4 py-3 text-right">Baseline</th>
              <th className="px-4 py-3 text-right">Collected</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Auditable</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.groupKey} className="border-b border-ink-700/40">
                <td className="px-4 py-3 text-slate-200">{l.label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">{l.count}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {money(l.baseline)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {money(l.collected)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-proof-500">
                  {money(l.returned)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                  {money(l.auditableReturned)}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No counted recoveries to attribute yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-600/60 font-medium">
              <td className="px-4 py-3 text-slate-300" colSpan={4}>
                Total
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                {money(totalReturned)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                {money(totalAuditable)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Panel>
    </div>
  );
}
