import { useMemo, useState } from "react";
import { Panel, SectionHeader, StatCard } from "../components/ui";
import {
  advanceSyntheticScenario,
  initialSyntheticPilot,
  nextSyntheticAction,
  syntheticAuditTrail,
  syntheticAuditableRevenueMinor,
  syntheticPilotTotals,
  syntheticRevenueReturnedMinor,
  type SyntheticScenarioId,
  type SyntheticScenarioState,
} from "../pilot/syntheticPilotV2";

const STAGE_LABEL: Record<SyntheticScenarioState["stage"], string> = {
  candidate_review: "Pending review",
  case_open: "Recovery Case open",
  action_recorded: "Action recorded",
  evidence_received: "Evidence received",
  proof_approved: "Proof approved",
  rejected: "Rejected safely",
  proof_blocked: "Proof blocked",
};

const money = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

export function SyntheticPilotV2() {
  const [states, setStates] = useState(initialSyntheticPilot);
  const [selectedId, setSelectedId] = useState<SyntheticScenarioId>("successful_recovery");
  const selected = states.find((state) => state.definition.id === selectedId)!;
  const totals = useMemo(() => syntheticPilotTotals(states), [states]);
  const audit = syntheticAuditTrail(selected);
  const nextAction = nextSyntheticAction(selected);

  const advance = () => setStates((current) => current.map((state) =>
    state.definition.id === selectedId ? advanceSyntheticScenario(state) : state,
  ));
  const reset = () => setStates(initialSyntheticPilot());

  const exportCfo = () => {
    const report = {
      schemaVersion: "nh-synthetic-pilot-v2",
      syntheticOnly: true,
      claimsRealRevenue: false,
      scenarioId: selected.definition.id,
      opportunityMinor: selected.definition.opportunityMinor,
      revenueReturnedMinor: syntheticRevenueReturnedMinor(selected),
      auditableRevenueMinor: syntheticAuditableRevenueMinor(selected),
      audit,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nh-synthetic-${selected.definition.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <SectionHeader
        title="Synthetic Pilot v2"
        subtitle="Run three governed outcomes end to end. Technical verification only — no customer data and no claim of real recovered revenue."
        right={
          <button type="button" onClick={reset} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">
            Reset scenarios
          </button>
        }
      />

      <div role="note" className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        <strong>SYNTHETIC ONLY.</strong> Opportunity is a forecast. Revenue Returned remains zero until a governed proof is approved.
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Revenue Opportunity" value={money(totals.opportunityMinor)} sub="forecast across 3 fictional cases" tone="detect" />
        <StatCard label="Revenue Returned" value={money(totals.revenueReturnedMinor)} sub="approved synthetic proof only" tone="proof" />
        <StatCard label="Auditable Revenue" value={money(totals.auditableRevenueMinor)} sub="verified independent evidence" tone="proof" />
        <StatCard label="Stopped safely" value={String(totals.stoppedCount)} sub="rejected or blocked" />
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {states.map((state) => {
          const active = state.definition.id === selectedId;
          const stopped = state.stage === "rejected" || state.stage === "proof_blocked";
          return (
            <button
              type="button"
              key={state.definition.id}
              onClick={() => setSelectedId(state.definition.id)}
              className={`rounded-xl border p-4 text-left transition ${active ? "border-proof-500/60 bg-proof-500/10" : "border-ink-500/40 bg-ink-800/60 hover:bg-ink-700/40"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-100">{state.definition.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{state.definition.account}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${stopped ? "border-red-500/40 text-red-300" : state.stage === "proof_approved" ? "border-proof-500/50 text-proof-500" : "border-detect-500/40 text-detect-500"}`}>
                  {STAGE_LABEL[state.stage]}
                </span>
              </div>
              <div className="mt-4 text-sm text-detect-500">{money(state.definition.opportunityMinor)} opportunity</div>
              <div className="mt-1 text-xs text-slate-500">Expected control: {state.definition.expectedDecision}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Selected scenario</div>
              <h3 className="mt-1 text-lg font-semibold text-slate-100">{selected.definition.label}</h3>
              <p className="mt-1 text-sm text-slate-400">{selected.definition.account}</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Current state</div>
              <div className="mt-1 text-sm font-medium text-slate-200">{STAGE_LABEL[selected.stage]}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Opportunity · forecast" value={money(selected.definition.opportunityMinor)} tone="detect" />
            <Metric label="Baseline" value={money(selected.definition.baselineMinor)} />
            <Metric label={selected.definition.evidenceTrust === "beneficiary_controlled" ? "Claimed collection · unverified" : "Observed collection"} value={money(selected.definition.observedCollectionMinor)} />
            <Metric label="Revenue Returned · proven" value={money(syntheticRevenueReturnedMinor(selected))} tone="proof" />
          </div>

          <div className="mt-5 rounded-lg border border-ink-600/50 bg-ink-900/40 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Control decision</div>
            <p className="mt-2 text-sm text-slate-300">{decisionCopy(selected)}</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {nextAction && (
              <button type="button" onClick={advance} className="rounded-lg border border-proof-500/50 bg-proof-500/10 px-4 py-2 text-sm font-medium text-proof-500 hover:bg-proof-500/20">
                {nextAction} →
              </button>
            )}
            <button
              type="button"
              onClick={exportCfo}
              disabled={selected.stage !== "proof_approved"}
              className="rounded-lg border border-ink-500/50 px-4 py-2 text-sm text-slate-300 enabled:hover:bg-ink-700/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export CFO proof JSON
            </button>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-5 py-4">
            <h3 className="font-semibold text-slate-100">Scenario Audit Trail</h3>
            <p className="mt-1 text-xs text-slate-500">Append-only decision sequence for this synthetic run.</p>
          </div>
          <ol className="divide-y divide-ink-700/50">
            {audit.map((entry) => (
              <li key={entry.sequence} className="flex gap-3 px-5 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-600/60 text-[11px] text-slate-300">{entry.sequence}</span>
                <div>
                  <div className="text-sm text-slate-200">{entry.action}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{entry.actor} · {entry.result}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "detect" | "proof" | "neutral" }) {
  const color = tone === "proof" ? "text-proof-500" : tone === "detect" ? "text-detect-500" : "text-slate-200";
  return (
    <div className="rounded-lg border border-ink-600/50 bg-ink-900/30 p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 font-medium tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function decisionCopy(state: SyntheticScenarioState): string {
  if (state.stage === "rejected") return "Human review rejected the signal. No Recovery Case, action or revenue claim was created.";
  if (state.stage === "proof_blocked") return "The outcome amount came from a beneficiary-controlled source. The proof gate blocked it; no revenue was counted.";
  if (state.stage === "proof_approved") return "Independent signed evidence supports the full collected amount. Revenue Returned equals collection less the locked baseline.";
  if (state.stage === "candidate_review") return "The agent created a candidate only. A human must decide whether it may become a governed Recovery Case.";
  if (state.stage === "case_open") return "The accepted candidate is now a governed Recovery Case. Opportunity remains forecast and no revenue is counted.";
  if (state.stage === "action_recorded") return "The recovery action is recorded. The system is waiting for outcome evidence before considering proof.";
  return state.definition.evidenceTrust === "verified_independent"
    ? "Evidence is independently signed. Finance approval is still required before any revenue is counted."
    : "Evidence authenticity is not verified. The next proof-gate decision must block the revenue claim.";
}
