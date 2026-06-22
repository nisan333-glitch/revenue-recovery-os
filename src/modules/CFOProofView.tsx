import { useMemo, useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import { isAuditable } from "../domain/invariants";
import { reasonLabel } from "../domain/reasons";
import { BASELINE_METHODOLOGY } from "../domain/attribution";
import { money, moneyExact, dateShort } from "../lib/format";
import { Panel, SectionHeader, StatCard } from "../components/ui";
import { EventDetail } from "../components/EventDetail";

export function CFOProofView() {
  const { events } = useRecovery();
  const [openId, setOpenId] = useState<string | null>(null);

  const ledger = useMemo(
    () =>
      events
        .filter(isAuditable)
        .sort((a, b) => b.revenueReturned - a.revenueReturned),
    [events],
  );

  const totalBaseline = ledger.reduce((s, e) => s + e.baselineAmount, 0);
  const totalCollected = ledger.reduce((s, e) => s + e.collectedAmount, 0);
  const totalReturned = ledger.reduce((s, e) => s + e.revenueReturned, 0);

  const open = events.find((e) => e.eventId === openId) ?? null;

  function exportCsv() {
    const header = [
      "eventId",
      "customer",
      "funnelStage",
      "leakageType",
      "recoveryReason",
      "owner",
      "baselineAmount",
      "collectedAmount",
      "revenueReturned",
      "confidence",
      "recoveredAt",
      "evidenceNotes",
    ];
    const lines = ledger.map((e) =>
      [
        e.eventId,
        e.customer,
        e.funnelStage,
        e.leakageType,
        e.recoveryReason ?? "",
        e.owner ?? "",
        e.baselineAmount,
        e.collectedAmount,
        e.revenueReturned,
        e.confidence,
        e.updatedAt,
        `"${e.evidenceNotes.replace(/"/g, '""')}"`,
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cfo-proof-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <SectionHeader
        title="CFO Proof View"
        subtitle="Only auditable recovered revenue. Every line survives a skeptical review."
        right={
          <button
            onClick={exportCsv}
            className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50"
          >
            Export CSV
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Baseline (counterfactual)" value={money(totalBaseline)} />
        <StatCard label="Collected" value={money(totalCollected)} />
        <StatCard
          label="Revenue Returned"
          value={money(totalReturned)}
          sub="Collected − Baseline"
          tone="proof"
        />
        <StatCard
          label="Proof-grade Events"
          value={String(ledger.length)}
          sub="all auditable"
          tone="proof"
        />
      </div>

      <Panel className="mb-5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          How this number is derived
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

      <Panel className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-600/50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Event / Customer</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Recovered</th>
              <th className="px-4 py-3 text-right">Baseline</th>
              <th className="px-4 py-3 text-right">Collected</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr
                key={e.eventId}
                onClick={() => setOpenId(e.eventId)}
                className="cursor-pointer border-b border-ink-700/40 hover:bg-ink-700/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-200">{e.customer}</div>
                  <div className="font-mono text-[11px] text-slate-500">{e.eventId}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{reasonLabel(e.recoveryReason)}</td>
                <td className="px-4 py-3 text-slate-400">{dateShort(e.updatedAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {moneyExact(e.baselineAmount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {moneyExact(e.collectedAmount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-proof-500">
                  {moneyExact(e.revenueReturned)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {e.confidence}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No proof-grade recovered revenue yet.
                </td>
              </tr>
            )}
          </tbody>
          {ledger.length > 0 && (
            <tfoot>
              <tr className="border-t border-ink-600/60 font-medium">
                <td className="px-4 py-3 text-slate-300" colSpan={3}>
                  Auditable total
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {moneyExact(totalBaseline)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {moneyExact(totalCollected)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                  {moneyExact(totalReturned)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </Panel>

      {open && <EventDetail event={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
