// CFO Proof View — the number a CFO signs. It reads ONLY from immutable approved Proof snapshots
// (via effectiveProofs + proofIsAuditable), never recomputed from mutable Cases. Each line is a
// frozen proof: baseline/collected/returned as-approved, with the confidence and threshold that
// were stamped at approval.
import { useMemo, useState } from "react";
import { useRecovery } from "../state/RecoveryContext";
import { effectiveProofs, type Proof } from "../domain/proof";
import { proofIsAuditable, provenLedger } from "../domain/provenLedger";
import { formatMoney, money } from "../domain/money";
import { reasonLabel } from "../domain/reasons";
import { BASELINE_METHODOLOGY } from "../domain/attribution";
import { dateShort } from "../lib/format";
import { Panel, SectionHeader, StatCard } from "../components/ui";
import { EventDetail } from "../components/EventDetail";

const CURRENCY = "USD";

export function CFOProofView() {
  const { events, proofs } = useRecovery();
  const [openId, setOpenId] = useState<string | null>(null);

  // Auditable = effective (chain-folded, non-reversed) proofs that clear their STAMPED threshold.
  const ledgerRows = useMemo(
    () =>
      effectiveProofs(proofs)
        .filter(proofIsAuditable)
        .sort((a, b) => b.revenueReturned.minor - a.revenueReturned.minor),
    [proofs],
  );
  const totals = useMemo(() => provenLedger(proofs, CURRENCY), [proofs]);

  const customerOf = (caseId: string) =>
    events.find((e) => e.eventId === caseId)?.customer ?? caseId;

  const totalBaseline = ledgerRows.reduce((s, p) => s + p.baselineAmount.minor, 0);
  const totalCollected = ledgerRows.reduce((s, p) => s + p.collectedAmount.minor, 0);

  const open = events.find((e) => e.eventId === openId) ?? null;

  function exportCsv() {
    const header = [
      "proofId",
      "recoveryCaseId",
      "customer",
      "recoveryReason",
      "baselineMinor",
      "collectedMinor",
      "revenueReturnedMinor",
      "currency",
      "confidenceUsed",
      "proofThresholdUsed",
      "policyVersion",
      "approvedAt",
      "approvedBy",
    ];
    const lines = ledgerRows.map((p: Proof) =>
      [
        p.proofId,
        p.recoveryCaseId,
        customerOf(p.recoveryCaseId),
        p.recoveryReason,
        p.baselineAmount.minor,
        p.collectedAmount.minor,
        p.revenueReturned.minor,
        p.currency,
        p.confidenceUsed,
        p.proofThresholdUsed,
        p.policyVersion,
        p.approvedAt,
        p.approvedBy,
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
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
        subtitle="Only auditable recovered revenue, read from immutable approved proofs. Every line survives a skeptical review."
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
        <StatCard label="Baseline (counterfactual)" value={formatMoney(money(totalBaseline, CURRENCY))} />
        <StatCard label="Collected" value={formatMoney(money(totalCollected, CURRENCY))} />
        <StatCard
          label="Auditable Revenue"
          value={formatMoney(totals.auditableRevenue)}
          sub="Collected − Baseline, proven"
          tone="proof"
        />
        <StatCard
          label="Proof-grade Events"
          value={String(totals.auditableCount)}
          sub="all auditable"
          tone="proof"
        />
      </div>

      <Panel className="mb-5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">How this number is derived</h3>
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
              <th className="px-4 py-3">Proof / Customer</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Approved</th>
              <th className="px-4 py-3 text-right">Baseline</th>
              <th className="px-4 py-3 text-right">Collected</th>
              <th className="px-4 py-3 text-right">Returned</th>
              <th className="px-4 py-3 text-right">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((p) => (
              <tr
                key={p.proofId}
                onClick={() => setOpenId(p.recoveryCaseId)}
                className="cursor-pointer border-b border-ink-700/40 hover:bg-ink-700/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-200">{customerOf(p.recoveryCaseId)}</div>
                  <div className="font-mono text-[11px] text-slate-500">{p.proofId}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{reasonLabel(p.recoveryReason)}</td>
                <td className="px-4 py-3 text-slate-400">{dateShort(p.approvedAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {formatMoney(p.baselineAmount, { exact: true })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatMoney(p.collectedAmount, { exact: true })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-proof-500">
                  {formatMoney(p.revenueReturned, { exact: true })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">{p.confidenceUsed}</td>
              </tr>
            ))}
            {ledgerRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No proof-grade recovered revenue yet. Approve a proof on a recovered case.
                </td>
              </tr>
            )}
          </tbody>
          {ledgerRows.length > 0 && (
            <tfoot>
              <tr className="border-t border-ink-600/60 font-medium">
                <td className="px-4 py-3 text-slate-300" colSpan={3}>
                  Auditable total
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {formatMoney(money(totalBaseline, CURRENCY), { exact: true })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {formatMoney(money(totalCollected, CURRENCY), { exact: true })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-proof-500">
                  {formatMoney(totals.auditableRevenue, { exact: true })}
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
