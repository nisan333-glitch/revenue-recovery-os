// EP-26 · Analysis-terms governance — the cut-off and the stall definition, decided by two identities.
//
// A SEPARATE PANEL from the admission bar, for the same reason they are separate tables: they answer
// different questions, and one screen that treated them as one object would let a governance act on the
// fitness bar read as an act on the definition of "stalled".
//
// WHY THIS SCREEN HAD TO EXIST AT ALL. Before EP-26 the cut-off and the threshold were two boxes on the
// upload form, typed by the party who benefits from the figure. Removing those boxes without adding this
// panel would have left the product unusable — so this is not an accessory to the guard, it is the other
// half of it: the only way a definition comes into being, under two identities, with a stated reason.
//
// Nothing here computes anything. It states a definition and reports what the server decided about it.
import { useRef, useState } from "react";
import { Panel, Pill } from "../../components/ui";
import type { PolicyState } from "../../contract/policyLifecycle";
import { MAX_STALL_THRESHOLD_DAYS } from "../../contract/analysisTerms";
import {
  proposeAnalysisTerms,
  readAnalysisTermsGovernance,
  transitionAnalysisTerms,
  type AnalysisTermsGovernanceView,
} from "../../data/pilotAnalysisTermsClient";
import { mayApplyRead, selectedPolicyKey, forSelection, nextGovernanceAction } from "../../data/pilotPolicyClient";
import { STEWARD, operatorActorFor } from "../../data/devActor";

/** ACTIVE measures; everything else does not. Mirrors the server, never widens it. */
function measuresTone(state: PolicyState | null): "proof" | "detect" | "neutral" {
  if (state === "ACTIVE") return "proof";
  if (state === "FROZEN" || state === "RETIRED") return "detect";
  return "neutral";
}

/**
 * NOTHING IS SEEDED. The old upload form opened with N = 30 and a fixed as-of date, which is a
 * definition nobody decided — and an anchored default is the path of least resistance for the exact
 * judgement that must be made deliberately. Blank is not zero, and an incomplete definition cannot be
 * proposed at all.
 */
export function AnalysisTermsGovernance() {
  const [boundaryId, setBoundaryId] = useState("");
  const [termsId, setTermsId] = useState("");
  const [termsVersion, setTermsVersion] = useState("1.0.0");
  const [asOf, setAsOf] = useState("");
  const [stallThresholdDays, setStallThresholdDays] = useState("");
  const [rationale, setRationale] = useState("");
  const [governance, setGovernance] = useState<AnalysisTermsGovernanceView | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not state: `refresh()` must know AFTER its await whether the selection has moved.
  const selectedKeyRef = useRef(selectedPolicyKey(boundaryId, termsId, termsVersion));

  const proposer = operatorActorFor(null);
  const identified = Boolean(boundaryId.trim() && termsId.trim() && termsVersion.trim());
  const currentKey = selectedPolicyKey(boundaryId, termsId, termsVersion);
  // A verdict is shown only beside the identity it was read for — the EP-20 defect, not repeated here.
  const currentGovernance = forSelection(governance, loadedKey, currentKey);
  const state = currentGovernance?.state ?? null;

  const days = Number(stallThresholdDays);
  const defects: string[] = [];
  if (asOf.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(asOf.trim())) defects.push("asOf: must be a date");
  if (stallThresholdDays.trim() !== "" && (!Number.isInteger(days) || days < 0)) {
    defects.push("stallThresholdDays: must be a whole number of days, 0 or more");
  }
  if (stallThresholdDays.trim() !== "" && days > MAX_STALL_THRESHOLD_DAYS) {
    defects.push(`stallThresholdDays: must be at most ${MAX_STALL_THRESHOLD_DAYS}`);
  }
  const complete =
    identified && asOf.trim() !== "" && stallThresholdDays.trim() !== "" && rationale.trim() !== "";
  const mayPropose = complete && defects.length === 0 && !busy;

  function invalidateSelection(nextBoundary: string, nextId: string, nextVersion: string): void {
    selectedKeyRef.current = selectedPolicyKey(nextBoundary, nextId, nextVersion);
    setGovernance(null);
    setLoadedKey(null);
  }

  async function refresh(): Promise<void> {
    if (!identified) return;
    const requested = currentKey;
    setError(null);
    try {
      // Read as the STEWARD: the governance read requires `AuditRead`, which the customer-side operator
      // does not hold. Reading it as the proposer would 403, and hiding that would hide a real boundary.
      const view = await readAnalysisTermsGovernance(
        { boundaryId: boundaryId.trim(), termsId: termsId.trim(), termsVersion: termsVersion.trim() },
        STEWARD,
      );
      if (!mayApplyRead(requested, selectedKeyRef.current)) return;
      setGovernance(view);
      setLoadedKey(requested);
    } catch (e) {
      if (!mayApplyRead(requested, selectedKeyRef.current)) return;
      setGovernance(null);
      setLoadedKey(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function act(run: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const propose = () =>
    act(async () => {
      if (!mayPropose) throw new Error("State a cut-off, a stall threshold and a reason before proposing.");
      await proposeAnalysisTerms(
        {
          boundaryId: boundaryId.trim(),
          terms: {
            termsId: termsId.trim(),
            termsVersion: termsVersion.trim(),
            asOf: asOf.trim(),
            stallThresholdDays: days,
          },
          rationale: rationale.trim(),
        },
        proposer,
      );
    });

  const move = (transition: "ACTIVATED" | "FROZEN" | "UNFROZEN" | "RETIRED") =>
    act(async () => {
      await transitionAnalysisTerms(
        transition,
        {
          boundaryId: boundaryId.trim(),
          termsId: termsId.trim(),
          termsVersion: termsVersion.trim(),
          rationale: rationale.trim(),
        },
        STEWARD,
      );
    });

  return (
    <div>
      <Panel className="mb-4 p-5">
        <div className="mb-1 text-sm font-semibold text-slate-200">Analysis terms — what the assessment measures</div>
        <div className="mb-3 text-[12px] text-slate-400">
          The as-of cut-off decides what information exists; the stall threshold decides what{" "}
          <span className="text-slate-300">stalled</span> means. Together they are the definition a figure
          is measured under, so they are proposed by one identity and activated by another — never typed
          into the upload that benefits from the result. Changing either is a new version.
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Analysis-terms tenant</span>
            <input className="num-input w-full" value={boundaryId} onChange={(e) => {
              invalidateSelection(e.target.value, termsId, termsVersion);
              setBoundaryId(e.target.value);
            }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Terms id</span>
            <input className="num-input w-full" value={termsId} onChange={(e) => {
              invalidateSelection(boundaryId, e.target.value, termsVersion);
              setTermsId(e.target.value);
            }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Terms version</span>
            <input className="num-input w-full" value={termsVersion} onChange={(e) => {
              invalidateSelection(boundaryId, termsId, e.target.value);
              setTermsVersion(e.target.value);
            }} />
          </label>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Analysis as-of date</span>
            <input type="date" className="num-input w-full" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Stall threshold N (days)</span>
            <input type="number" min={0} className="num-input w-full" value={stallThresholdDays}
              onChange={(e) => setStallThresholdDays(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Reason for this terms act</span>
            <input className="num-input w-full" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
        </div>

        {defects.length > 0 && (
          <div aria-label="Analysis terms errors" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-200">
            {defects.map((d) => <div key={d}>{d}</div>)}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button disabled={!mayPropose} onClick={() => void propose()}
            className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">
            Propose terms as {proposer.actorId}
          </button>
          <button disabled={!identified || busy} onClick={() => void move("ACTIVATED")}
            className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">
            Activate terms as {STEWARD.actorId}
          </button>
          <button disabled={!identified || busy} onClick={() => void move("FROZEN")}
            className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">
            Freeze terms
          </button>
          <button disabled={!identified || busy} onClick={() => void move("UNFROZEN")}
            className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">
            Resume terms
          </button>
          <button disabled={!identified || busy} onClick={() => void refresh()}
            className="rounded-lg border border-ink-500/50 px-3 py-2 text-sm text-slate-300 disabled:opacity-40">
            Read terms lifecycle
          </button>
        </div>

        {error && <div role="alert" className="mb-3 text-[12px] text-amber-200">{error}</div>}

        {/* Labelled for the same reason the admission bar's row is: two governed objects, one screen,
            the same state vocabulary. Every assertion about either must name which one it means. */}
        <div aria-label="Analysis terms state" className="flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
          <Pill tone={measuresTone(state)}>{state ?? "not proposed"}</Pill>
          <span>{state === "ACTIVE" ? "measures a dataset" : "measures nothing"}</span>
          <span className="text-slate-500">{nextGovernanceAction(state)}</span>
        </div>

        {currentGovernance && (
          <div className="mt-3 text-[12px] text-slate-400">
            <div>
              asOf <span className="text-slate-200">{currentGovernance.asOf}</span> · N{" "}
              <span className="text-slate-200">{currentGovernance.stallThresholdDays}</span> days · terms{" "}
              <span className="text-slate-200">{currentGovernance.termsRef}</span>
            </div>
            <div className="mt-1 break-all">witness {currentGovernance.termsHash}</div>
            <div className="mt-2" aria-label="Analysis terms lifecycle">
              {/* Rendered from the SERVER's own proposedBy/activatedBy comparison, never from the
                  buttons above — a button label proves nothing about who acted. */}
              {currentGovernance.proposedBy && currentGovernance.activatedBy
                ? currentGovernance.proposedBy === currentGovernance.activatedBy
                  ? `Proposed and activated by ${currentGovernance.proposedBy} — the same identity, which the server should not have allowed.`
                  : `Proposed by ${currentGovernance.proposedBy}, activated by ${currentGovernance.activatedBy} — two different identities, which is the point.`
                : currentGovernance.proposedBy
                  ? `Proposed by ${currentGovernance.proposedBy}; not yet activated.`
                  : "No proposal recorded."}
            </div>
            <ul className="mt-2 space-y-1">
              {currentGovernance.events.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {e.at} · {e.transition} · {e.actorId} ({e.actorRole}) · {e.rationale}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
