import { useRecovery } from "../state/RecoveryContext";
import { reconcile } from "../domain/reconciliation";
import { money } from "../lib/format";
import { Bar, Panel, SectionHeader } from "../components/ui";

export function Reconciliation() {
  const { events } = useRecovery();
  const r = reconcile(events);

  // The waterfall, top to bottom. Each step states what was removed and why.
  const steps = [
    {
      label: "Detected Opportunity",
      amount: r.detectedOpportunity,
      tone: "detect" as const,
      note: "Open events at risk — potential, not revenue. Shown for context.",
      muted: true,
    },
    {
      label: "Gross Recovered",
      amount: r.grossRecovered,
      tone: "neutral" as const,
      note: "All dollars collected above baseline on recovered events.",
    },
    {
      label: "− Unclassified",
      amount: -bucket(r, "Unclassified"),
      tone: "exclude" as const,
      note: "No recovery reason → cannot be attributed → not counted.",
    },
    {
      label: "Counted Recovered Revenue",
      amount: r.countedRecovered,
      tone: "neutral" as const,
      note: "What the product reports as recovered. Includes low confidence.",
    },
    {
      label: "− Missing Proof / Double Claim / Low Confidence",
      amount: -(r.countedRecovered - r.auditableRevenue),
      tone: "exclude" as const,
      note: "Counted, but not yet defensible to a CFO.",
    },
    {
      label: "CFO Auditable Revenue",
      amount: r.auditableRevenue,
      tone: "proof" as const,
      note: "Every dollar survives an audit. This is the number a CFO signs.",
      strong: true,
    },
  ];

  const max = Math.max(r.grossRecovered, r.detectedOpportunity);

  return (
    <div>
      <SectionHeader
        title="Recovery Reconciliation"
        subtitle="From gross recovered down to CFO-auditable — every excluded dollar explained. We do not count money we cannot explain."
      />

      {/* The waterfall */}
      <Panel className="mb-5 p-5">
        <div className="space-y-3">
          {steps.map((s) => (
            <div key={s.label}>
              <div className="mb-1 flex items-baseline justify-between">
                <span
                  className={`text-sm ${
                    s.strong
                      ? "font-semibold text-proof-500"
                      : s.muted
                        ? "text-detect-500"
                        : s.tone === "exclude"
                          ? "text-red-400"
                          : "text-slate-200"
                  }`}
                >
                  {s.label}
                </span>
                <span
                  className={`tabular-nums ${
                    s.strong
                      ? "text-lg font-semibold text-proof-500"
                      : s.tone === "exclude"
                        ? "text-red-400"
                        : s.muted
                          ? "text-detect-500"
                          : "text-slate-200"
                  }`}
                >
                  {s.amount < 0 ? "−" : ""}
                  {money(Math.abs(s.amount))}
                </span>
              </div>
              <Bar
                value={Math.abs(s.amount)}
                max={max}
                tone={
                  s.tone === "proof"
                    ? "proof"
                    : s.tone === "detect"
                      ? "detect"
                      : "neutral"
                }
              />
              <div className="mt-1 text-[11px] text-slate-500">{s.note}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* The CFO summary table the way a CFO reads it */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">
            Reconciliation summary
          </div>
          <table className="w-full text-sm">
            <tbody>
              <Row label="Detected Opportunity" amount={r.detectedOpportunity} tone="detect" />
              <Row label="Recovered Revenue" amount={r.countedRecovered} />
              <Row label="CFO Auditable Revenue" amount={r.auditableRevenue} tone="proof" strong />
              <Row label="Excluded Revenue" amount={r.excludedTotal} tone="exclude" />
              <tr className="border-t border-ink-600/60">
                <td className="px-4 py-3 text-slate-400">Recovered → Auditable gap</td>
                <td className="px-4 py-3 text-right tabular-nums text-detect-500">
                  {money(r.recoveredToAuditableGap)}
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">
            Excluded revenue — by reason
          </div>
          <table className="w-full text-sm">
            <tbody>
              {r.buckets.map((b) => (
                <tr key={b.reason} className="border-b border-ink-700/40 last:border-0">
                  <td className="px-4 py-3 text-slate-300">{b.label}</td>
                  <td className="px-4 py-3 text-center text-[11px] text-slate-500">
                    {b.count} event{b.count === 1 ? "" : "s"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      b.amount > 0 ? "text-red-400" : "text-slate-600"
                    }`}
                  >
                    {money(b.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-ink-600/60 font-medium">
                <td className="px-4 py-3 text-slate-300" colSpan={2}>
                  Total excluded
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-red-400">
                  {money(r.excludedTotal)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-3 text-[11px] text-slate-500">
            Buckets are disjoint — each excluded event is assigned exactly one
            reason, so they always sum to the gap. Double Claim and Missing Proof
            are wired for when those signals exist.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function bucket(
  r: ReturnType<typeof reconcile>,
  reason: string,
): number {
  return r.buckets.find((b) => b.reason === reason)?.amount ?? 0;
}

function Row({
  label,
  amount,
  tone = "neutral",
  strong = false,
}: {
  label: string;
  amount: number;
  tone?: "proof" | "detect" | "exclude" | "neutral";
  strong?: boolean;
}) {
  const color =
    tone === "proof"
      ? "text-proof-500"
      : tone === "detect"
        ? "text-detect-500"
        : tone === "exclude"
          ? "text-red-400"
          : "text-slate-200";
  return (
    <tr className="border-b border-ink-700/40">
      <td className={`px-4 py-3 ${strong ? "font-semibold " : ""}${color}`}>{label}</td>
      <td className={`px-4 py-3 text-right tabular-nums ${strong ? "font-semibold " : ""}${color}`}>
        {money(amount)}
      </td>
    </tr>
  );
}
