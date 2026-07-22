import { useState } from "react";
import { useRecovery } from "./state/RecoveryContext";
import { portfolioMetrics } from "./domain/metrics";
import { money } from "./lib/format";
import { RecoveryLoop } from "./modules/RecoveryLoop";
import { ExecutiveDashboard } from "./modules/ExecutiveDashboard";
import { RecoveryEventsTable } from "./modules/RecoveryEventsTable";
import { RecoveryQueue } from "./modules/RecoveryQueue";
import { CFOProofView } from "./modules/CFOProofView";
import { EventDetail } from "./components/EventDetail";
import { Reconciliation } from "./modules/Reconciliation";
import { AttributionEngine } from "./modules/AttributionEngine";
import { AuditTrail } from "./modules/AuditTrail";
import { RecoveryReasons } from "./modules/RecoveryReasons";
import { ConfidencePanel } from "./modules/ConfidencePanel";
import { Assessment } from "./modules/assessment/Assessment";
import { AssessmentErrorBoundary } from "./modules/assessment/ErrorBoundary";

// The single case used by the Guided Demo navigation mode. Only an identifier — no business values here.
const DEMO_CASE_ID = "RE-1014";

type ModuleKey =
  | "demo"
  | "loop"
  | "dashboard"
  | "queue"
  | "events"
  | "cfo"
  | "reconciliation"
  | "attribution"
  | "reasons"
  | "confidence"
  | "audit"
  | "assessment";

const NAV: { key: ModuleKey; label: string; group: string }[] = [
  { key: "demo", label: `Guided Demo — ${DEMO_CASE_ID}`, group: "Demo" },
  { key: "loop", label: "Recovery Loop", group: "Recover" },
  { key: "dashboard", label: "Executive Dashboard", group: "Prove" },
  { key: "cfo", label: "CFO Proof View", group: "Prove" },
  { key: "reconciliation", label: "Reconciliation", group: "Prove" },
  { key: "attribution", label: "Attribution Engine", group: "Prove" },
  { key: "queue", label: "Recovery Queue", group: "Operate" },
  { key: "events", label: "Recovery Events", group: "Operate" },
  { key: "reasons", label: "Recovery Reasons", group: "Operate" },
  { key: "confidence", label: "Confidence Score", group: "Trust" },
  { key: "audit", label: "Audit Trail", group: "Trust" },
  { key: "assessment", label: "Revenue Opportunity Assessment", group: "Assess" },
];

// `initialModule` is a small, optional, additive testability seam (defaults to "loop"); omitting it
// leaves normal startup and navigation behaviour unchanged. It is not a routing framework.
export function App({ initialModule = "loop" }: { initialModule?: ModuleKey }) {
  const [active, setActive] = useState<ModuleKey>(initialModule);
  // Continuity hint: set only when the CFO view is opened from the Guided Demo handoff, so its proof
  // row can be marked. Cleared on any direct navigation. Purely presentational — no business logic.
  const [focusCaseId, setFocusCaseId] = useState<string | undefined>(undefined);
  const { events, resetData } = useRecovery();
  const m = portfolioMetrics(events);

  // Select the demonstration case from the existing events collection (never fabricated).
  const demoEvent = events.find((e) => e.eventId === DEMO_CASE_ID);

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
                  onClick={() => {
                    setFocusCaseId(undefined);
                    setActive(n.key);
                  }}
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
          {active === "demo" &&
            (demoEvent ? (
              <section>
                <header>
                  <h2 className="text-lg font-semibold text-slate-100">
                    Guided Demo — one recovered case, end to end
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Follow {demoEvent.eventId} through the whole loop: find the leak, fix it, and prove
                    exactly how much came back.
                  </p>
                  <p className="mt-4 rounded-lg border border-ink-600/50 bg-ink-800/40 px-4 py-3 text-sm text-slate-300">
                    How to read this: the recommended play is a <strong>forecast — not proven revenue</strong>.
                    The proven, CFO-auditable <strong>Revenue Returned</strong> is shown separately below and
                    in the CFO Proof View; the two ledgers are never combined into one &ldquo;recovered&rdquo;
                    number.
                  </p>
                </header>

                {/* Reuse the existing single-case story surface — all amounts/status/owner/approver come
                    from domain/context data, computed by EventDetail (nothing duplicated or hardcoded). */}
                <div className="mt-6">
                  <EventDetail event={demoEvent} onClose={() => setActive("loop")} />
                </div>

                <div className="mt-6">
                  <p className="mb-2 text-sm text-slate-400">
                    {demoEvent.eventId}&rsquo;s proven <strong className="text-slate-200">Revenue Returned</strong>
                    {" "}
                    <span className="tabular-nums text-proof-500">{money(demoEvent.revenueReturned)}</span> is
                    marked for you on its exact proof line in the CFO Proof View.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusCaseId(demoEvent.eventId);
                      setActive("cfo");
                    }}
                    className="rounded-lg border border-proof-500/50 bg-proof-500/10 px-4 py-2 text-sm font-medium text-proof-500 hover:bg-proof-500/20"
                  >
                    Continue to CFO Proof View →
                  </button>
                </div>
              </section>
            ) : (
              <section>
                <h2 className="text-lg font-semibold text-slate-100">Guided Demo — {DEMO_CASE_ID}</h2>
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                >
                  The demonstration case <strong>{DEMO_CASE_ID}</strong> is not available in the current data
                  set. Nothing is shown here — no substitute or sample figures are invented.
                </p>
              </section>
            ))}
          {active === "loop" && <RecoveryLoop onOpen={setActive} />}
          {active === "dashboard" && <ExecutiveDashboard onOpenCfo={() => setActive("cfo")} />}
          {active === "queue" && <RecoveryQueue />}
          {active === "events" && <RecoveryEventsTable />}
          {active === "cfo" && <CFOProofView focusCaseId={focusCaseId} />}
          {active === "reconciliation" && <Reconciliation />}
          {active === "attribution" && <AttributionEngine />}
          {active === "reasons" && <RecoveryReasons />}
          {active === "confidence" && <ConfidencePanel />}
          {active === "audit" && <AuditTrail />}
          {active === "assessment" && (
            <AssessmentErrorBoundary>
              <Assessment />
            </AssessmentErrorBoundary>
          )}
        </div>
      </main>
    </div>
  );
}
