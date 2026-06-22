// Outcomes — the Problem surface (the front of the decision loop).
// One card per business problem: what's at risk, what we forecast we can
// recover, what we've proven, and the recommended play. Forecast (Opportunity)
// and proven (Returned) are shown in separate columns and never summed.
import { useRecovery } from "../state/RecoveryContext";
import { outcomesByLeakage } from "../domain/outcomes";
import { expectedRecoverable } from "../domain/recommendation";
import { portfolioMetrics } from "../domain/metrics";
import { reasonLabel } from "../domain/reasons";
import { money } from "../lib/format";
import { Panel, SectionHeader } from "../components/ui";

export function Outcomes() {
  const { events } = useRecovery();
  const outcomes = outcomesByLeakage(events);
  const m = portfolioMetrics(events);
  const totalRecoverable = expectedRecoverable(events);

  return (
    <div>
      <SectionHeader
        title="Outcomes"
        subtitle="Problems, not events. Forecast (what we can recover) and proof (what we did) are reported in separate columns — never blended."
      />

      {/* The three-layer framing the whole product runs on */}
      <Panel className="mb-4 p-4 text-sm text-slate-400">
        <span className="text-slate-300">Outcome</span> (the problem you buy a fix for)
        {"  ·  "}
        <span className="text-sky-400">Decision loop</span> (diagnose → recommend → act)
        {"  ·  "}
        <span className="text-proof-500">Proof</span> (what you can actually trust)
      </Panel>

      {/* Portfolio chain: Detected → Expected Recoverable → Recovered → Auditable */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <ChainStat label="Detected" value={money(m.detectedOpportunity)} note="open at risk" tone="detect" />
        <ChainStat label="Expected Recoverable" value={money(totalRecoverable)} note="forecast" tone="forecast" />
        <ChainStat label="Recovered" value={money(m.recoveredRevenue)} note="proven" tone="proof" />
        <ChainStat label="CFO-Auditable" value={money(m.auditableRevenue)} note="signed-off" tone="proof" />
      </div>

      <div className="space-y-3">
        {outcomes.map((o) => (
          <Panel key={o.leakageType} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-md">
                <div className="text-base font-semibold text-slate-100">{o.leakageType}</div>
                <p className="mt-0.5 text-sm text-slate-400">{o.rootCause}</p>
                <div className="mt-1.5 text-[11px] text-sky-400">
                  ▸ Recommended play: {reasonLabel(o.recommendedReason)}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 text-right">
                <Metric label="At risk" value={money(o.atRisk)} sub={`${o.openCount} open`} tone="detect" />
                <Metric label="Recoverable" value={money(o.recoverable)} sub="forecast" tone="forecast" />
                <Metric label="Recovered" value={money(o.recovered)} sub={`${o.recoveredCount} proven`} tone="proof" />
                <Metric label="Auditable" value={money(o.auditable)} sub="CFO" tone="proof" />
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-slate-500">
        Recoverable is a forecast (expected value over open events) and is reported on
        the Revenue Opportunity ledger. It is never added to Recovered or Auditable —
        those are realized dollars on the Revenue Returned ledger.
      </p>
    </div>
  );
}

type Tone = "detect" | "forecast" | "proof";

const TONE: Record<Tone, string> = {
  detect: "text-detect-500",
  forecast: "text-sky-400",
  proof: "text-proof-500",
};

function ChainStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: Tone;
}) {
  return (
    <Panel className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1.5 text-xl font-semibold tabular-nums ${TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>
    </Panel>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`tabular-nums ${TONE[tone]}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
