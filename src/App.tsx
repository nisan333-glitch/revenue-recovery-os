import { useState } from "react";
import { useRecovery } from "./state/RecoveryContext";
import { portfolioMetrics } from "./domain/metrics";
import { money } from "./lib/format";
import { ExecutiveDashboard } from "./modules/ExecutiveDashboard";
import { RecoveryEventsTable } from "./modules/RecoveryEventsTable";
import { RecoveryQueue } from "./modules/RecoveryQueue";
import { CFOProofView } from "./modules/CFOProofView";
import { AttributionEngine } from "./modules/AttributionEngine";
import { AuditTrail } from "./modules/AuditTrail";
import { RecoveryReasons } from "./modules/RecoveryReasons";
import { ConfidencePanel } from "./modules/ConfidencePanel";

type ModuleKey =
  | "dashboard"
  | "queue"
  | "events"
  | "cfo"
  | "attribution"
  | "reasons"
  | "confidence"
  | "audit";

const NAV: { key: ModuleKey; label: string; group: string }[] = [
  { key: "dashboard", label: "Executive Dashboard", group: "Prove" },
  { key: "cfo", label: "CFO Proof View", group: "Prove" },
  { key: "attribution", label: "Attribution Engine", group: "Prove" },
  { key: "queue", label: "Recovery Queue", group: "Operate" },
  { key: "events", label: "Recovery Events", group: "Operate" },
  { key: "reasons", label: "Recovery Reasons", group: "Operate" },
  { key: "confidence", label: "Confidence Score", group: "Trust" },
  { key: "audit", label: "Audit Trail", group: "Trust" },
];

export function App() {
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const { events, resetData } = useRecovery();
  const m = portfolioMetrics(events);

  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-ink-600/50 bg-ink-800/40">
        <div className="border-b border-ink-600/50 px-5 py-4">
          <div className="text-sm font-semibold tracking-tight text-slate-100">
            Revenue Recovery <span className="text-proof-500">OS</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Identify · Assign · Fix · Prove
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
                {g}
              </div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <button
                  key={n.key}
                  onClick={() => setActive(n.key)}
                  className={`mb-0.5 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    active === n.key
                      ? "bg-ink-600/70 text-slate-100"
                      : "text-slate-400 hover:bg-ink-700/50 hover:text-slate-200"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-600/50 px-5 py-3 text-[11px] text-slate-500">
          <div className="flex justify-between">
            <span>Auditable recovered</span>
            <span className="font-medium text-proof-500">
              {money(m.auditableRevenue)}
            </span>
          </div>
          <button
            onClick={resetData}
            className="mt-3 w-full rounded border border-ink-500/50 px-2 py-1 text-[11px] text-slate-400 hover:bg-ink-700/50"
          >
            Reset demo data
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          {active === "dashboard" && <ExecutiveDashboard onOpenCfo={() => setActive("cfo")} />}
          {active === "queue" && <RecoveryQueue />}
          {active === "events" && <RecoveryEventsTable />}
          {active === "cfo" && <CFOProofView />}
          {active === "attribution" && <AttributionEngine />}
          {active === "reasons" && <RecoveryReasons />}
          {active === "confidence" && <ConfidencePanel />}
          {active === "audit" && <AuditTrail />}
        </div>
      </main>
    </div>
  );
}
