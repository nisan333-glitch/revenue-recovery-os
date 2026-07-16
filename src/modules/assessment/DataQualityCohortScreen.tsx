import { useState } from "react";
import type { AssessmentResult } from "../../assessment/types";
import { summarizeExclusions } from "../../assessment/summarize";
import { SectionHeader, Panel, StatCard } from "../../components/ui";

export interface DataQualityCohortScreenProps {
  result: AssessmentResult;
  n: number;
  error: string | null;
  onChangeN: (n: number) => void;
  onBack: () => void;
  onNext: () => void;
}

export function DataQualityCohortScreen({ result, n, error, onChangeN, onBack, onNext }: DataQualityCohortScreenProps) {
  const [nInput, setNInput] = useState(n);
  const reasons = summarizeExclusions(result);

  return (
    <div>
      <SectionHeader
        title="Data quality & cohort"
        subtitle="What was accepted, what was excluded (and why), and the stalled cohort under your policy."
        right={
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">← Upload</button>
            <button onClick={onNext} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20">Observed result →</button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          Re-run failed: {error} — showing the previous result.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Accepted cycles" value={String(result.acceptedCycleCount)} />
        <StatCard label="Excluded rows" value={String(result.excludedRowCount)} sub="see reasons below" tone="detect" />
        <StatCard label="Stalled (deviation)" value={String(result.stalledCount)} />
        <StatCard label="Undetermined" value={String(result.undeterminedCount)} sub="within window" tone="detect" />
        <StatCard label="Reference" value={String(result.referenceCount)} sub="confirmed non-deviant" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <div className="mb-2 text-sm font-semibold text-slate-200">Cohort policy</div>
          <div className="mb-3 text-[12px] text-slate-400">
            Stall threshold N and as-of date. Changing N produces a <span className="text-slate-300">new assessment result</span> (the prior is never mutated).
          </div>
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">N (days)</span>
              <input type="number" min={0} className="num-input w-28" value={nInput}
                onChange={(e) => setNInput(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </label>
            <button onClick={() => onChangeN(nInput)}
              className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-300 hover:bg-ink-700/50">
              Re-run with N
            </button>
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
            asOf {result.policy.asOf} · currency {result.policy.currency} · policy {result.policy.policyId} v{result.policy.policyVersion} · amount {result.amountFormat} · dates {result.dateLocale} · mapping {result.mappingId}
          </div>
          {Object.keys(result.columnMapping).length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-slate-500">Column mapping (canonical ← your column)</summary>
              <table className="mt-2 w-full text-[12px]">
                <tbody>
                  {Object.entries(result.columnMapping).map(([canonical, source]) => (
                    <tr key={canonical} className="border-b border-ink-700/40 last:border-0">
                      <td className="py-1 text-slate-300">{canonical}</td>
                      <td className="py-1 text-right tabular-nums text-slate-400">{source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">Exclusions — by reason (never silent)</div>
          <table className="w-full text-sm">
            <tbody>
              {reasons.map(({ reason, count }) => (
                <tr key={reason} className="border-b border-ink-700/40 last:border-0">
                  <td className="px-4 py-2 text-slate-300">{reason}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{count}</td>
                </tr>
              ))}
              {reasons.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-slate-500">No rows excluded.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
