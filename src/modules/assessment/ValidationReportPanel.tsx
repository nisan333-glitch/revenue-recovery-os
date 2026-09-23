// EP-13 · The customer-facing verdict on an uploaded dataset.
//
// WHAT THIS SCREEN OWES THE CUSTOMER: not "invalid file", but which contract version judged it,
// what survived, what did not, and the specific thing to change. A 10,000-row export with one bad
// column should read as one problem with a fix, not ten thousand errors.
//
// It never renders a monetary figure, a recovery claim or a proof. A validated dataset is input to
// an observed assessment — the panel says so explicitly, because a green banner is exactly where a
// reader starts assuming more was proven than was.
import { Panel, Pill } from "../../components/ui";
import { groupRowFindings, type PilotIntakeResult } from "../../data/pilotIntakeClient";

export interface ValidationReportPanelProps {
  result: PilotIntakeResult;
  /** True while the authoritative server verdict is still pending (preflight shown meanwhile). */
  preliminary?: boolean;
}

/** Map contract severity onto the existing Pill vocabulary rather than inventing new tones. */
type PillTone = "proof" | "detect" | "neutral";

function severityTone(severity: string): PillTone {
  // "detect" is the existing attention tone; a rejection is the thing that needs attention.
  return severity === "dataset_rejected" || severity === "row_rejected" ? "detect" : "neutral";
}

export function ValidationReportPanel({ result, preliminary = false }: ValidationReportPanelProps) {
  const groups = groupRowFindings(result.rowFindings);
  const blocked = !result.usableForAssessment;

  return (
    <Panel className="mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-200">Data contract validation</span>
        <Pill tone="proof">contract {result.contractVersion}</Pill>
        {preliminary ? (
          <Pill tone="neutral">preview — not yet confirmed by the server</Pill>
        ) : (
          <Pill tone="proof">server-verified</Pill>
        )}
        {blocked ? <Pill tone="detect">not usable</Pill> : <Pill tone="proof">usable</Pill>}
      </div>

      {preliminary && (
        <p className="mb-3 text-[11px] text-slate-500">
          This is a local preview to save you a round trip. The server’s verdict is the one that counts.
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Counter label="Rows read" value={result.counts.dataRows} />
        <Counter label="Accepted" value={result.counts.acceptedRows} tone="text-emerald-300" />
        <Counter label="Rejected" value={result.counts.rejectedRows} tone={result.counts.rejectedRows > 0 ? "text-red-300" : undefined} />
        <Counter label="Warnings" value={result.counts.warnedRows} tone={result.counts.warnedRows > 0 ? "text-amber-300" : undefined} />
      </div>

      {result.datasetFindings.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Dataset-level</div>
          <ul className="space-y-2">
            {result.datasetFindings.map((f, i) => (
              <li key={`${f.code}-${i}`} className="rounded-lg border border-ink-500/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={severityTone(f.severity)}>{f.code}</Pill>
                  <span className="text-[13px] text-slate-200">{f.title}</span>
                  {f.subject && <span className="text-[11px] text-slate-500">column: {f.subject}</span>}
                </div>
                <div className="mt-1 text-[12px] text-slate-400">{f.remediation}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            Row-level — grouped by problem, not one line per row
          </div>
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.code} className="rounded-lg border border-ink-500/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={severityTone(g.severity)}>{g.code}</Pill>
                  <span className="text-[13px] text-slate-200">{g.title}</span>
                  <span className="text-[11px] text-slate-500">
                    {g.count} row{g.count === 1 ? "" : "s"} · e.g. row {g.exampleRows.join(", ")}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-slate-400">{g.remediation}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-[12px] text-red-300">
          This dataset cannot continue into assessment. Correct the items above and upload again —
          nothing was stored, and no value was altered or filled in for you.
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        A validated dataset is input to an <span className="text-slate-300">observed</span> assessment.
        It is not proven revenue, not a recovery claim, and not proof of anything.
      </p>
    </Panel>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-ink-500/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${tone ?? "text-slate-200"}`}>{value.toLocaleString("en-US")}</div>
    </div>
  );
}
