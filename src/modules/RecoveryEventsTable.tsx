import { useMemo, useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import type { RecoveryEvent, RecoveryStatus } from "../domain/types";
import { reasonLabel } from "../domain/reasons";
import { money } from "../lib/format";
import {
  ConfidenceBadge,
  MoneyDelta,
  Panel,
  SectionHeader,
  StatusBadge,
} from "../components/ui";
import { EventDetail } from "../components/EventDetail";

type SortKey = "riskAmount" | "revenueReturned" | "confidence" | "customer";

const STATUS_FILTERS: (RecoveryStatus | "All")[] = [
  "All",
  "Detected",
  "Queued",
  "Assigned",
  "InProgress",
  "Recovered",
  "Failed",
  "Dismissed",
];

export function RecoveryEventsTable() {
  const { events } = useRecovery();
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecoveryStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("riskAmount");

  const rows = useMemo(() => {
    let r = events.slice();
    if (statusFilter !== "All") r = r.filter((e) => e.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(
        (e) =>
          e.customer.toLowerCase().includes(q) ||
          e.eventId.toLowerCase().includes(q),
      );
    }
    r.sort((a, b) => {
      if (sort === "customer") return a.customer.localeCompare(b.customer);
      return (b[sort] as number) - (a[sort] as number);
    });
    return r;
  }, [events, statusFilter, query, sort]);

  const open = events.find((e) => e.eventId === openId) ?? null;

  return (
    <div>
      <SectionHeader
        title="Recovery Events"
        subtitle="Every recovery event with its full record. Click a row to open the workflow."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="num-input w-56"
          placeholder="Search customer or ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="num-input w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RecoveryStatus | "All")}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="num-input w-44"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="riskAmount">Sort: Risk amount</option>
          <option value="revenueReturned">Sort: Revenue returned</option>
          <option value="confidence">Sort: Confidence</option>
          <option value="customer">Sort: Customer</option>
        </select>
        <span className="ml-auto text-sm text-slate-500">{rows.length} events</span>
      </div>

      <Panel className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-600/50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Stage / Leakage</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Risk</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e: RecoveryEvent) => (
              <tr
                key={e.eventId}
                onClick={() => setOpenId(e.eventId)}
                className="cursor-pointer border-b border-ink-700/40 hover:bg-ink-700/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-200">{e.customer}</div>
                  <div className="font-mono text-[11px] text-slate-500">{e.eventId}</div>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  <div>{e.funnelStage}</div>
                  <div className="text-[11px] text-slate-500">{e.leakageType}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {e.recoveryReason === null ? (
                    <span className="text-red-400">unclassified</span>
                  ) : (
                    reasonLabel(e.recoveryReason)
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">{e.owner ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-detect-500">
                  {money(e.riskAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {e.revenueReturned !== 0 ? (
                    <MoneyDelta value={e.revenueReturned} />
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <ConfidenceBadge value={e.confidence} />
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
