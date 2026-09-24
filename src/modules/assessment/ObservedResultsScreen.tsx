import type { AssessmentResult } from "../../assessment/types";
import { formatMoney, money } from "../../domain/money";
import { SectionHeader, Panel, StatCard } from "../../components/ui";
import { downloadSummary } from "./exportSummary";

export interface ObservedResultsScreenProps {
  result: AssessmentResult;
  onBack: () => void;
  /** EP-19 · Hand the dataset to the governed server execution — the only authoritative run. */
  onRunGoverned?: () => void;
  running?: boolean;
}

/**
 * EP-19 · THIS SCREEN IS A LOCAL PREVIEW. Every figure on it was computed in this browser, from the
 * file in memory. It is useful — it says whether the dataset has the shape a pilot needs — and it is
 * NOT an execution: it has no binding, no policy hash, no audit lineage and no server record. A number
 * with none of those is not a result anyone can be held to, so the page says so above the figures
 * rather than below them.
 */
export function ObservedResultsScreen({ result, onBack, onRunGoverned, running = false }: ObservedResultsScreenProps) {
  const o = result.observed;
  const cur = o.currency;
  const zero = money(0, cur);

  return (
    <div>
      <SectionHeader
        title="Local preview — computed in this browser"
        subtitle="Read from the file in memory. Not a governed execution, not Proof, not Revenue Returned. Run the governed execution for a figure with a binding and an audit trail."
        right={
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">← Cohort</button>
            <button onClick={() => downloadSummary(result)} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">Export summary</button>
            {onRunGoverned && (
              <button
                onClick={onRunGoverned}
                disabled={running}
                className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40"
              >
                {running ? "Running…" : "Run governed execution →"}
              </button>
            )}
          </div>
        }
      />

      <Panel className="mb-4 p-3 text-[12px] text-slate-400">
        <span className="rounded bg-ink-600/60 px-1.5 py-0.5 text-[11px] text-slate-300">local preview</span>{" "}
        Every number below was calculated <span className="text-slate-300">in this browser</span> from
        the file you picked. It carries no execution binding, no policy hash and no audit lineage, and it
        is <span className="text-slate-300">not</span> an execution, a Proof, or Revenue Returned. The
        authoritative figure comes from the governed server run.
      </Panel>

      {/* The four money states, permanently separated. */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Observed unpaid" value={formatMoney(o.observedUnpaid)} sub="from your records" tone="neutral" hint="Unpaid value in the stalled cohort, read directly from imported records." />
        <StatCard label="Estimated leakage" value="Not calculated" sub="validation slice" tone="detect" />
        <StatCard label="Forecast opportunity" value="Not calculated" sub="validation slice" tone="detect" />
        <StatCard label="Proven / auditable" value={formatMoney(zero)} sub="n/a in M1" tone="proof" />
      </div>

      <Panel className="mb-5 overflow-hidden">
        <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">
          Observed breakdown ({cur}) — exact
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Gross eligible (due by asOf, not cancelled/refunded)" value={formatMoney(o.grossEligible, { exact: true })} />
            <Row label="Observed unpaid (headline)" value={formatMoney(o.observedUnpaid, { exact: true })} strong />
            <Row label="Partial outstanding" value={formatMoney(o.partialOutstanding, { exact: true })} />
            <Row label="Excluded (cancelled / refunded)" value={formatMoney(o.excludedValue, { exact: true })} />
            <Row label="Unknown / insufficient" value={formatMoney(o.unknownValue, { exact: true })} />
          </tbody>
        </table>
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">Payment states (stalled cohort)</div>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(o.stateCounts).filter(([, n]) => n > 0).map(([state, n]) => (
                <tr key={state} className="border-b border-ink-700/40 last:border-0">
                  <td className="px-4 py-2 text-slate-300">{state}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel className="p-4 text-[12px] text-slate-400">
          <div className="mb-1 text-sm font-semibold text-slate-200">What this is — and is not</div>
          <p className="mb-2">
            <span className="text-slate-300">Observed Unpaid</span> is a fact from your data: invoices in
            the stalled cohort that were due by {result.policy.asOf} and not settled. It does not prove
            the activation stall <em>caused</em> that loss, and it is not recovered revenue.
          </p>
          <p className="text-[11px] text-slate-500">
            assessmentId {result.assessmentId} · N {result.policy.stallThresholdDays}d · {result.fingerprintAlgo} fingerprint · Proven $0.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className="border-b border-ink-700/40 last:border-0">
      <td className={`px-4 py-2 ${strong ? "font-semibold text-slate-200" : "text-slate-400"}`}>{label}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${strong ? "font-semibold text-slate-100" : "text-slate-300"}`}>{value}</td>
    </tr>
  );
}
