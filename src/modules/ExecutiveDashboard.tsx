import { useRecovery } from "../state/RecoveryContext";
import {
  portfolioMetrics,
  byStage,
  byReason,
  recoveredTrend,
} from "../domain/metrics";
import { money, percent } from "../lib/format";
import { reasonLabel } from "../domain/reasons";
import {
  Bar,
  Panel,
  SectionHeader,
  Sparkline,
  StatCard,
} from "../components/ui";

export function ExecutiveDashboard({ onOpenCfo }: { onOpenCfo: () => void }) {
  const { events } = useRecovery();
  const m = portfolioMetrics(events);
  const stages = byStage(events);
  const reasons = byReason(events).filter((r) => r.key !== "Unclassified");
  const trend = recoveredTrend(events);
  const maxStage = Math.max(1, ...stages.map((s) => s.count));
  const maxReason = Math.max(1, ...reasons.map((r) => r.recovered));

  return (
    <div>
      <SectionHeader
        title="Executive Dashboard"
        subtitle="Revenue lost between signature and activation — found, recovered, and proven. Detected opportunity and proven recovery never blend."
      />

      {/* The two numbers that must never mix */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <div className="text-xs uppercase tracking-wide text-detect-500">
            Detected Opportunity
          </div>
          <div className="mt-2 text-3xl font-semibold tabular-nums text-detect-500">
            {money(m.detectedOpportunity)}
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {m.detectedCount} open events at risk. This is potential, not proof.
          </div>
        </Panel>
        <Panel className="p-5">
          <div className="text-xs uppercase tracking-wide text-proof-500">
            Proven Recovered Revenue
          </div>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-3xl font-semibold tabular-nums text-proof-500">
              {money(m.recoveredRevenue)}
            </span>
            <span className="pb-1 text-slate-500">
              <Sparkline data={trend} />
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {m.recoveredCount} counted recoveries · Revenue Returned = Collected − Baseline
          </div>
        </Panel>
      </div>

      {/* Money recovered metric + proof split */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Money Recovered"
          value={money(m.recoveredRevenue)}
          sub="all counted recoveries"
          tone="proof"
        />
        <StatCard
          label="CFO-Auditable"
          value={money(m.auditableRevenue)}
          sub={`${m.auditableCount} proof-grade events`}
          tone="proof"
          hint="Recovered + reason + proof-grade confidence + real uplift"
        />
        <StatCard
          label="Unproven (low conf.)"
          value={money(m.unprovenRevenue)}
          sub={`${m.unprovenCount} below threshold`}
          tone="detect"
        />
        <StatCard
          label="Recovery Rate"
          value={percent(m.recoveryRate)}
          sub="recovered / (recovered + failed)"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* By stage */}
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">
            Events by Funnel Stage
          </h3>
          <div className="space-y-3">
            {stages.map((s) => (
              <div key={s.key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-300">{s.key}</span>
                  <span className="text-slate-400">
                    {s.count} · {money(s.recovered)} recovered
                  </span>
                </div>
                <Bar value={s.count} max={maxStage} tone="neutral" />
              </div>
            ))}
          </div>
        </Panel>

        {/* By reason */}
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">
            Recovered Revenue by Reason
          </h3>
          <div className="space-y-3">
            {reasons.map((r) => (
              <div key={r.key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-300">{reasonLabel(r.key as never)}</span>
                  <span className="text-proof-500">{money(r.recovered)}</span>
                </div>
                <Bar value={r.recovered} max={maxReason} tone="proof" />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-6">
        <button
          onClick={onOpenCfo}
          className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-2 text-sm font-medium text-proof-500 hover:bg-proof-600/20"
        >
          Open CFO Proof View →
        </button>
      </div>
    </div>
  );
}
