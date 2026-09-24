// EP-16 · What happened to a governed assessment run.
//
// WHAT THIS SCREEN OWES THE READER. Not a spinner and a number, but: which state the run is in, what
// it is bound to, and — when it stopped — the specific reason with its code and remedy. Five states
// are shown as five distinct things, because "blocked by a frozen policy" and "failed and will be
// retried" call for completely different responses and collapsing them into "error" hides which.
//
// THERE IS NO RAW PII HERE, and not because this file filters it. The execution's stored input was
// de-identified before it was ever written, the agent's payload is a single execution id, and the
// finding is an aggregate. This panel could not show a customer identifier if it tried — which is a
// stronger guarantee than a component that remembers to redact.
//
// THE OBSERVATION IS NOT MONEY RETURNED. It is Revenue Opportunity: a forecast-side reading of what
// the dataset showed. The banner says so, in the place a reader's eye lands before the figure,
// because a large number on a clean screen is exactly where someone starts assuming it was proven.
import { Panel, Pill } from "../../components/ui";
import { formatMoney } from "../../domain/money";
import {
  EXECUTION_STATE_LABELS,
  truncateRef,
  type AssessmentExecutionView,
} from "../../data/pilotAssessmentClient";
import type { ExecutionState } from "../../contract/assessmentExecution";

export interface AssessmentExecutionPanelProps {
  execution: AssessmentExecutionView;
}

type PillTone = "proof" | "detect" | "neutral";

/**
 * State → tone. `completed` is the only "proof" tone, and it is used for "this finished", never for
 * "this is proven" — nothing on this screen is proof.
 */
function stateTone(state: ExecutionState | null): PillTone {
  switch (state) {
    case "completed":
      return "proof";
    case "blocked":
    case "failed":
      return "detect";
    default:
      return "neutral";
  }
}

export function ExecutionStatePill({ state }: { state: ExecutionState | null }) {
  if (state === null) return <Pill tone="neutral">no state recorded</Pill>;
  return <Pill tone={stateTone(state)}>{EXECUTION_STATE_LABELS[state]}</Pill>;
}

export function AssessmentExecutionPanel({ execution }: AssessmentExecutionPanelProps) {
  const { binding, finding, state } = execution;
  const stopped = state === "blocked" || state === "failed";

  return (
    <Panel className="mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-200">Assessment execution</span>
        <ExecutionStatePill state={state} />
        <Pill tone="neutral">contract {binding.contractVersion}</Pill>
        <Pill tone="neutral">observation only — not proof, not revenue</Pill>
      </div>

      {stopped && execution.code && (
        <div className="mb-4 rounded-lg border border-detect-600/40 bg-ink-800/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="detect">{execution.code}</Pill>
            <span className="text-[13px] text-slate-200">
              {state === "blocked"
                ? "This run was refused by a check, not by a bug."
                : "This run errored and will be retried automatically."}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-slate-400">
            {state === "blocked"
              ? "A blocked run is final: retrying cannot change the answer. Resolve the named condition, then schedule a new run."
              : "No action is needed yet. If it keeps failing it will stop retrying and stay visible here."}
          </p>
        </div>
      )}

      {/* What the run is bound to. Every one of these was fixed before the result was known. */}
      <div className="mb-4">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
          Bound to — fixed before the result was known
        </div>
        <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
          <Bound label="Execution" value={truncateRef(execution.executionId.replace(/^PAX-/, ""))} />
          <Bound label="Dataset fingerprint" value={truncateRef(binding.datasetFingerprint)} />
          <Bound label="Admission decision" value={truncateRef(binding.admissionDecisionId.replace(/^PAD-/, ""))} />
          <Bound label="Admission policy" value={`${binding.admissionPolicyId}@${binding.admissionPolicyVersion}`} />
          <Bound label="Policy hash" value={truncateRef(binding.admissionPolicyHash)} />
          <Bound label="Input hash" value={truncateRef(execution.inputHash)} />
          <Bound label="As of" value={binding.assessmentPolicy.asOf} />
          <Bound label="Stall threshold" value={`${binding.assessmentPolicy.stallThresholdDays} days`} />
          {binding.recoveryCaseId && <Bound label="Linked case" value={binding.recoveryCaseId} />}
        </dl>
      </div>

      {finding && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            Observation — Revenue Opportunity, never money returned
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Counter label="Cycles assessed" value={String(finding.finding.acceptedCycleCount)} />
            <Counter label="Stalled" value={String(finding.finding.stalledCount)} tone="text-amber-300" />
            <Counter label="Within window" value={String(finding.finding.undeterminedCount)} />
            <Counter label="Reference" value={String(finding.finding.referenceCount)} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Counter
              label="Observed unpaid"
              value={formatMoney({ minor: finding.finding.observedUnpaidMinor, currency: finding.finding.currency }, { exact: true })}
              tone="text-amber-300"
            />
            <Counter
              label="Gross eligible"
              value={formatMoney({ minor: finding.finding.grossEligibleMinor, currency: finding.finding.currency }, { exact: true })}
            />
            <Counter
              label="Excluded value"
              value={formatMoney({ minor: finding.finding.excludedValueMinor, currency: finding.finding.currency }, { exact: true })}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            These figures are what the admitted dataset showed under the bound policy. They are a
            forecast-side observation: no dollar here has been recovered, proven, or counted, and this
            run created no recovery case.
          </p>
          {finding.finding.exclusionCodes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">Exclusions during assessment:</span>
              {finding.finding.exclusionCodes.map((e) => (
                <Pill key={e.code} tone="neutral">
                  {e.code} × {e.count}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The lineage. Append-only: what is shown is every event, in the order it happened. */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
          Lineage — append-only, nothing here is editable
        </div>
        <ol className="space-y-1">
          {execution.events.map((event, i) => (
            <li key={`${event.at}-${i}`} className="flex flex-wrap items-center gap-2 text-[12px]">
              <Pill tone={event.code ? "detect" : "neutral"}>{event.transition}</Pill>
              <span className="text-slate-400">{new Date(event.at).toISOString()}</span>
              {event.code && <span className="text-detect-500">{event.code}</span>}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

function Bound({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-500/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-mono text-[12px] text-slate-200">{value}</dd>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-ink-500/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-[15px] font-semibold ${tone ?? "text-slate-100"}`}>{value}</div>
    </div>
  );
}
