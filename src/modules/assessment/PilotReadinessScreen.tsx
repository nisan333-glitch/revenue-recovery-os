import { useMemo } from "react";
import type { AssessmentResult } from "../../assessment/types";
import {
  DECLARATION_LABELS,
  assessPilotReadiness,
  type PilotDeclarations,
} from "../../assessment/intakeKit";
import { Panel, Pill, SectionHeader } from "../../components/ui";
import { downloadIntakeManifest } from "./exportSummary";

export interface PilotReadinessScreenProps {
  result: AssessmentResult;
  declarations: PilotDeclarations;
  onChangeDeclarations: (next: PilotDeclarations) => void;
  onBack: () => void;
  onNext: () => void;
}

const STATUS_COPY = {
  blocked: { label: "BLOCKED", tone: "detect" as const, detail: "The imported data cannot support pilot design yet." },
  conditional: { label: "CONDITIONAL", tone: "detect" as const, detail: "Observed analysis can continue; controlled pilot design still has open confirmations." },
  ready_for_pilot_design: { label: "READY FOR PILOT DESIGN", tone: "proof" as const, detail: "Required intake declarations are complete. This is not proof of recovery." },
};

export function PilotReadinessScreen({
  result,
  declarations,
  onChangeDeclarations,
  onBack,
  onNext,
}: PilotReadinessScreenProps) {
  const readiness = useMemo(() => assessPilotReadiness(result, declarations), [result, declarations]);
  const statusCopy = STATUS_COPY[readiness.status];

  function toggle(key: keyof PilotDeclarations): void {
    onChangeDeclarations({ ...declarations, [key]: !declarations[key] });
  }

  return (
    <div>
      <SectionHeader
        title="Pilot readiness gate"
        subtitle="Confirm the information needed to move from observed leakage to a controlled, auditable pilot."
        right={
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">← Cohort</button>
            <button onClick={onNext} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20">Observed result →</button>
          </div>
        }
      />

      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Pill tone={statusCopy.tone}>{statusCopy.label}</Pill>
            <p className="mt-2 text-sm text-slate-300">{statusCopy.detail}</p>
          </div>
          <button
            onClick={() => downloadIntakeManifest(result, declarations)}
            className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50"
          >
            Export intake manifest
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600/50 px-4 py-3 text-sm font-semibold text-slate-200">Data gates</div>
          <div className="divide-y divide-ink-700/40">
            {readiness.gates.slice(0, 3).map((gate) => (
              <div key={gate.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-200">{gate.label}</span>
                  <Pill tone={gate.status === "pass" ? "proof" : "detect"}>{gate.status.replace("_", " ")}</Pill>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{gate.detail}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">
            Pilot confirmations · {readiness.confirmedCount}/{readiness.requiredConfirmationCount}
          </div>
          <div className="space-y-3">
            {(Object.keys(DECLARATION_LABELS) as (keyof PilotDeclarations)[]).map((key) => (
              <label key={key} className="flex cursor-pointer items-start gap-2 text-[12px] text-slate-300">
                <input type="checkbox" checked={declarations[key]} onChange={() => toggle(key)} className="mt-0.5" />
                <span>{DECLARATION_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 p-4 text-[12px] text-slate-400">
        <div className="mb-1 text-sm font-semibold text-slate-200">Claim boundary</div>
        {readiness.limitations.map((limitation) => <p key={limitation}>• {limitation}</p>)}
      </Panel>
    </div>
  );
}
