import { useMemo, useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import { globalAuditFeed } from "../domain/audit";
import { dateTime } from "../lib/format";
import { Panel, SectionHeader } from "../components/ui";

const TYPE_LABEL: Record<string, string> = {
  created: "Created",
  assigned: "Assigned",
  status_changed: "Status",
  action_added: "Action",
  reason_set: "Reason",
  amounts_updated: "Amounts",
  evidence_updated: "Evidence",
};

export function AuditTrail() {
  const { events } = useRecovery();
  const [query, setQuery] = useState("");

  const feed = useMemo(() => {
    const all = globalAuditFeed(events);
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (r) =>
        r.customer.toLowerCase().includes(q) ||
        r.eventId.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q),
    );
  }, [events, query]);

  return (
    <div>
      <SectionHeader
        title="Audit Trail"
        subtitle="Append-only log of every change. This is the chain of evidence behind each recovered dollar."
        right={
          <input
            className="num-input w-56"
            placeholder="Filter audit log…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      />

      <Panel className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-600/50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {feed.map((r) => (
              <tr key={r.id} className="border-b border-ink-700/40">
                <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-slate-500">
                  {dateTime(r.at)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-slate-300">{r.customer}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">
                    {r.eventId}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-ink-600/60 px-1.5 py-0.5 text-[11px] text-slate-300">
                    {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-400">{r.actor}</td>
                <td className="px-4 py-2.5 text-slate-300">
                  {r.summary}
                  {r.before !== undefined && r.after !== undefined && (
                    <span className="ml-2 text-[11px] text-slate-500">
                      ({r.before} → {r.after})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="mt-3 text-[11px] text-slate-500">
        {feed.length} entries · entries are immutable and ordered newest first.
      </p>
    </div>
  );
}
