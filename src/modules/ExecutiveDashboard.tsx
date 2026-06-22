import { useRecovery } from "../state/RecoveryContext";
import {
  portfolioMetrics,
  byStage,
  byReason,
  recoveredTrend,
} from "../domain/metrics";
import { expectedRecoverable } from "../domain/recommendation";
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
  const recoverable = expectedRecoverable(events);
  const stages = byStage(events);
  const reasons = byReason(events).filter((r) => r.key !== "Unclassified");
  const trend = recoveredTrend(events);
  const maxStage = Math.max(1, ...stages.map((s) => s.count));
  const maxReason = Math.max(1, ...reasons.map((r) => r.recovered));

  return (
    <div>
      <SectionHeader
        title="Executive Dashboard"
        subtitle="Detected opportunity and proven recovery are reported separately — never blended."
      />

      {/* The chain: forecast flows left→right but never merges into proof. */}
      <div className="mb-4 flex flex-wrap items-stretch gap-2">
        <ChainCell label="Detected" value={money(m.detectedOpportunity)} note="open at risk" tone="detect" />
        <Arrow />
        <ChainCell label="Expected Recoverable" value={money(recoverable)} note="forecast · not proven" tone="forecast" />
        <Arrow />
        <ChainCell label="Recovered" value={money(m.recoveredRevenue)} note="proven" tone="proof" />
        <Arrow />
        <ChainCell label="CFO-Auditable" value={money(m.auditableRevenue)} note="signed-off" tone="proof" />
      </div>
      <p className="mb-5 text-[11px] text-slate-500">
        <span className="text-slate-300">Outcome</span> (what you buy) ·{" "}
        <span className="text-sky-400">Decision loop</span> (diagnose → recommend → act) ·{" "}
        <span className="text-proof-500">Proof</span> (what you trust). The two amber/blue
        buckets are forecast; the two green buckets are realized — they are never summed together.
      </p>

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

const CHAIN_TONE = {
  detect: "text-detect-500",
  forecast: "text-sky-400",
  proof: "text-proof-500",
} as const;

function ChainCell({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: keyof typeof CHAIN_TONE;
}) {
  return (
    <div className="min-w-[9rem] flex-1 rounded-lg border border-ink-500/40 bg-ink-800/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${CHAIN_TONE[tone]}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{note}</div>
    </div>
  );
}

function Arrow() {
  return <div className="flex items-center text-slate-600">→</div>;
}
