// Obligation Scope notice — the ONE shared rendering of the obligation-scope disclosure, used by both
// Assessment screens. Presentational only (UI Boundary Rule): every fact and every sentence comes from
// the pure derivation in src/domain/obligationScope.ts. React never decides what is "supported".
//
// Fail closed: if a screen is handed no scope, it still renders the refusal notice rather than
// silently showing nothing — a view that did not compute its scope must not read as "no ambiguity".
import { formatMoney } from "../domain/money";
import {
  unavailableObligationScope,
  type ObligationScope,
  type ScopeSurface,
} from "../domain/obligationScope";
import { Panel, Pill } from "./ui";

export function ObligationScopeNotice({
  scope,
  surface = "ASSESSMENT",
  className = "",
}: {
  scope?: ObligationScope;
  surface?: ScopeSurface;
  className?: string;
}) {
  const s = scope ?? unavailableObligationScope(surface);
  const a = s.recordedAbsorption;
  const supported = s.singleObligation === "SUPPORTED";
  return (
    <Panel className={`p-4 ${className}`}>
      <section aria-label="Obligation scope" data-obligation-scope={s.singleObligation}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">Obligation scope</span>
          <Pill tone={supported ? "proof" : "detect"}>
            {supported ? "single obligation: supported" : "single obligation: not established"}
          </Pill>
        </div>
        <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] md:grid-cols-3">
          <div>
            <dt className="text-slate-500">Identity grain</dt>
            <dd className="text-slate-300">{s.identity.grain}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ambiguity (we cannot tell)</dt>
            <dd className="text-slate-300">{s.ambiguity.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Recorded absorption (we collapsed)</dt>
            <dd className="text-slate-300">
              {a.status === "RECORDED"
                ? `${a.unitCount} record(s) · candidate exposure ≤ ${
                    a.candidateExposureUpperBound
                      ? formatMoney(a.candidateExposureUpperBound, { exact: true })
                      : "not quantifiable"
                  }`
                : "none"}
            </dd>
          </div>
        </dl>
        <ul className="space-y-1 text-[12px] text-slate-400">
          {s.disclosure.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}
