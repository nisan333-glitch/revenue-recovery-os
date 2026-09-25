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
import type { AdmissionDecision } from "../../contract/admissionGate";
import type { PolicyState } from "../../contract/policyLifecycle";

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
  const usable = result.usableForAssessment;
  const admissible = result.admission?.admissibleForPilotAssessment === true;
  // EP-14 · Two different answers, shown as two different answers. A dataset can be technically
  // usable and still unfit for a pilot, and collapsing that into one badge is exactly how one
  // surviving row gets treated as a dataset.
  const blocked = !usable || !admissible;

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
        {usable ? <Pill tone="proof">technically usable</Pill> : <Pill tone="detect">not usable</Pill>}
        {preliminary ? (
          <Pill tone="neutral">pilot admission not evaluated</Pill>
        ) : admissible ? (
          <Pill tone="proof">pilot-admissible</Pill>
        ) : (
          <Pill tone="detect">not pilot-admissible</Pill>
        )}
      </div>

      {preliminary && (
        <p className="mb-3 text-[11px] text-slate-500">
          This is a local preview to save you a round trip. No admission policy was read here and
          no policy fitness verdict was made. The server’s verdict is the one that counts.
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

      {!preliminary && result.admission && (
        <AdmissionSection
          admission={result.admission}
          policyState={result.admissionPolicyState ?? null}
          policyHash={result.admissionPolicyHash ?? null}
          governanceRefusal={result.admissionGovernanceRefusal ?? null}
        />
      )}

      {blocked && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-[12px] text-red-300">
          This dataset cannot continue into pilot assessment.{" "}
          {preliminary
            ? "The local contract preflight found no usable cycles. Correct the items above and upload again."
            : usable
            ? "It parses and produced valid rows, but it does not meet the pilot's configured fitness policy."
            : "Correct the items above and upload again."}{" "}
          Nothing was stored, and no value was altered or filled in for you.
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        A validated dataset is input to an <span className="text-slate-300">observed</span> assessment.
        It is not proven revenue, not a recovery claim, and not proof of anything.
      </p>
    </Panel>
  );
}

/**
 * Pilot fitness, shown as its own verdict with the measure AND the threshold for every check. A bar
 * someone can see is a bar they can argue with; a bare "rejected" is one they can only accept.
 */
function AdmissionSection({
  admission,
  policyState,
  policyHash,
  governanceRefusal,
}: {
  admission: AdmissionDecision;
  policyState: PolicyState | null;
  policyHash: string | null;
  governanceRefusal: string | null;
}) {
  const outcomeTone = admission.outcome === "ADMISSIBLE" ? "proof" : "detect";
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="mt-5 border-t border-ink-500/40 pt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-200">Pilot admission</span>
        <Pill tone={outcomeTone}>{admission.outcome.replace(/_/g, " ").toLowerCase()}</Pill>
        {admission.policyRef ? (
          <Pill tone="neutral">policy {admission.policyRef}</Pill>
        ) : (
          <Pill tone="detect">no policy configured</Pill>
        )}
        {policyState !== null && <PolicyStatePill state={policyState} />}
      </div>

      {governanceRefusal !== null && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-300">
          <span className="font-semibold">Governance:</span> {governanceRefusal}.
          <span className="mt-1 block text-[11px] text-slate-400">
            Proposing a bar and putting it in force are separate acts by separate people. A policy
            judges nothing until pilot governance activates it, and it may not be activated after the
            dataset it would judge has already been seen.
          </span>
        </div>
      )}

      {policyHash !== null && (
        <p className="mb-3 text-[11px] text-slate-500">
          Judged under policy hash <span className="font-mono text-slate-400">{policyHash.slice(0, 23)}…</span> —
          recorded with this decision, so retiring or superseding the policy can never change what it was
          measured against.
        </p>
      )}

      {admission.outcome === "NOT_ASSESSABLE" && (
        <p className="mb-3 text-[12px] text-slate-400">
          Fitness could not be judged. A missing or incomplete policy is never treated as “no limit” —
          the thresholds are a decision for whoever runs the pilot, and nothing here will pick one.
        </p>
      )}

      {admission.checks.length > 0 && (
        <ul className="mb-3 grid gap-1 md:grid-cols-2">
          {admission.checks.map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-2 rounded border border-ink-500/40 px-2 py-1 text-[12px]">
              <span className={c.passed ? "text-slate-400" : "text-red-300"}>{c.label}</span>
              <span className="whitespace-nowrap text-slate-500">
                {fmt(c.observed)} {c.direction === "at_least" ? "≥" : "≤"} {fmt(c.threshold)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {admission.reasons.length > 0 && (
        <ul className="space-y-2">
          {admission.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} className="rounded-lg border border-ink-500/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="detect">{r.code}</Pill>
                <span className="text-[13px] text-slate-200">{r.title}</span>
              </div>
              <div className="mt-1 text-[12px] text-slate-400">{r.remediation}</div>
            </li>
          ))}
        </ul>
      )}

      {admission.rejectionDistribution.length > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          Excluded rows remain visible here on purpose: {admission.counts.rejectedRows} of{" "}
          {admission.counts.dataRows} rows were rejected, the largest single cause accounting for{" "}
          {(admission.rates.largestSingleReasonShare * 100).toFixed(0)}% of them. What was excluded
          shapes what the remaining rows can represent.
        </p>
      )}
    </div>
  );
}

/**
 * The four lifecycle states, shown as four distinguishable things. Only ACTIVE may judge a dataset;
 * the other three each mean "not in force" for a different reason, and collapsing them into one
 * "invalid" badge would hide whether the fix is to wait for approval, ask governance to resume, or
 * propose a new version entirely.
 */
function PolicyStatePill({ state }: { state: PolicyState }) {
  const label: Record<PolicyState, string> = {
    DRAFT: "proposed — awaiting governance",
    ACTIVE: "active",
    FROZEN: "frozen by governance",
    RETIRED: "retired",
  };
  return <Pill tone={state === "ACTIVE" ? "proof" : "detect"}>{label[state]}</Pill>;
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-ink-500/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${tone ?? "text-slate-200"}`}>{value.toLocaleString("en-US")}</div>
    </div>
  );
}
