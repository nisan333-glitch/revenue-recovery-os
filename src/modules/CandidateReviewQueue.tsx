import { useCallback, useMemo, useState } from "react";
import { ApiError } from "../data/apiClient";
import {
  listCandidateQueue,
  promoteCandidate,
  reviewCandidate,
  type CandidateQueueItemDTO,
  type RecoveryCaseDTO,
} from "../data/candidateReviewClient";
import type { DevActor } from "../data/devActor";
import { Panel, Pill, SectionHeader } from "../components/ui";
import { formatMoney, money } from "../domain/money";

const OPERATOR: DevActor = { actorId: "pilot-operator@company", role: "operator" };

type ActionState =
  | { kind: "idle" }
  | { kind: "working"; candidateId: string }
  | { kind: "success"; message: string; recoveryCase?: RecoveryCaseDTO }
  | { kind: "error"; message: string };

function safeMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The candidate operation failed. Please try again.";
}

export function CandidateReviewQueue() {
  const [boundaryId, setBoundaryId] = useState("");
  const [items, setItems] = useState<CandidateQueueItemDTO[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loadedBoundary, setLoadedBoundary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  const normalizedBoundary = boundaryId.trim();
  const opportunityByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const currency = item.signal.currency;
      totals.set(currency, (totals.get(currency) ?? 0) + item.signal.amountAtRiskMinor);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const load = useCallback(async () => {
    if (!normalizedBoundary) return;
    setLoading(true);
    setAction({ kind: "idle" });
    try {
      const next = await listCandidateQueue(normalizedBoundary, OPERATOR);
      setItems(next);
      setLoadedBoundary(normalizedBoundary);
    } catch (error) {
      setItems([]);
      setLoadedBoundary(null);
      setAction({ kind: "error", message: safeMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [normalizedBoundary]);

  async function decide(item: CandidateQueueItemDTO, decision: "accepted" | "rejected"): Promise<void> {
    const reason = (reasons[item.candidateId] ?? "").trim();
    if (!reason) {
      setAction({ kind: "error", message: "A review reason is required. The decision is immutable." });
      return;
    }
    setAction({ kind: "working", candidateId: item.candidateId });
    try {
      await reviewCandidate(item.candidateId, OPERATOR, {
        boundaryId: item.boundaryId,
        decision,
        reason,
      });
      const next = await listCandidateQueue(item.boundaryId, OPERATOR);
      setItems(next);
      setAction({
        kind: "success",
        message: decision === "accepted"
          ? "Candidate accepted. Promotion still requires a separate operator action."
          : "Candidate rejected. No Recovery Case was created.",
      });
    } catch (error) {
      setAction({ kind: "error", message: safeMessage(error) });
    }
  }

  async function promote(item: CandidateQueueItemDTO): Promise<void> {
    setAction({ kind: "working", candidateId: item.candidateId });
    try {
      const result = await promoteCandidate(item.candidateId, OPERATOR, item.boundaryId);
      const next = await listCandidateQueue(item.boundaryId, OPERATOR);
      setItems(next);
      setAction({
        kind: "success",
        message: result.created
          ? `Recovery Case ${result.recoveryCase.recoveryCaseId} created.`
          : `Recovery Case ${result.recoveryCase.recoveryCaseId} already existed; no duplicate was created.`,
        recoveryCase: result.recoveryCase,
      });
    } catch (error) {
      setAction({ kind: "error", message: safeMessage(error) });
    }
  }

  return (
    <div>
      <SectionHeader
        title="Candidate Review"
        subtitle="Human control between detector output and an authoritative Recovery Case. No candidate is promoted automatically."
      />

      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-72 flex-1">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Pilot boundary ID</span>
            <input
              value={boundaryId}
              onChange={(event) => setBoundaryId(event.target.value)}
              placeholder="Enter the exact customer/pilot boundary"
              className="num-input w-full"
            />
          </label>
          <button
            onClick={() => void load()}
            disabled={!normalizedBoundary || loading}
            className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-2 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40"
          >
            {loading ? "Loading…" : "Load candidates"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Boundary isolation is enforced by the server. The operator must enter the exact boundary; the UI never guesses it.
        </p>
      </Panel>

      {action.kind === "error" && (
        <div role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {action.message}
        </div>
      )}
      {action.kind === "success" && (
        <div role="status" className="mb-4 rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-3 text-sm text-proof-500">
          {action.message}
        </div>
      )}

      {loadedBoundary && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] text-slate-500">
            Loaded boundary: <span className="font-mono text-slate-300">{loadedBoundary}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Panel className="p-4"><div className="text-xs uppercase text-slate-500">Pending review / promotion</div><div className="mt-2 text-2xl font-semibold text-slate-100">{items.length}</div></Panel>
            <Panel className="p-4">
              <div className="text-xs uppercase text-slate-500">Opportunity only</div>
              <div className="mt-2 space-y-1 text-xl font-semibold text-detect-500">
                {opportunityByCurrency.length === 0
                  ? "—"
                  : opportunityByCurrency.map(([currency, total]) => (
                      <div key={currency}>{formatMoney(money(total, currency))}</div>
                    ))}
              </div>
              {opportunityByCurrency.length > 1 && <div className="mt-1 text-[10px] text-slate-500">currencies never aggregated</div>}
            </Panel>
            <Panel className="p-4"><div className="text-xs uppercase text-slate-500">Revenue Returned</div><div className="mt-2 text-2xl font-semibold text-proof-500">$0.00</div><div className="mt-1 text-xs text-slate-500">review never counts money</div></Panel>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const working = action.kind === "working" && action.candidateId === item.candidateId;
          const accepted = item.review?.decision === "accepted";
          return (
            <Panel key={item.candidateId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-100">{item.signal.recoveryType}</span>
                    <Pill tone={accepted ? "proof" : "detect"}>{accepted ? "accepted · awaiting promotion" : "pending review"}</Pill>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {item.candidateId} · detector {item.signal.detectorVersion} · observed {item.signal.observedAt}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-detect-500">
                    {formatMoney(money(item.signal.amountAtRiskMinor, item.signal.currency))}
                  </div>
                  <div className="text-[10px] uppercase text-slate-500">Revenue Opportunity · not proven</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 text-[12px] text-slate-400 md:grid-cols-3">
                <div><span className="text-slate-500">Source ref</span><br />{item.signal.sourceRef}</div>
                <div><span className="text-slate-500">Expected proof event</span><br />{item.signal.expectedProofEvent}</div>
                <div><span className="text-slate-500">Action available</span><br />{item.signal.actionAvailable ? "Yes" : "No"}</div>
              </div>

              {!accepted ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    value={reasons[item.candidateId] ?? ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [item.candidateId]: event.target.value }))}
                    placeholder="Required immutable review reason"
                    className="num-input min-w-72 flex-1"
                  />
                  <button disabled={working} onClick={() => void decide(item, "rejected")} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 disabled:opacity-40">Reject</button>
                  <button disabled={working} onClick={() => void decide(item, "accepted")} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-2 text-sm text-proof-500 disabled:opacity-40">Accept for case creation</button>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-slate-400">Review is immutable. Promotion creates the authoritative Recovery Case root.</p>
                  <button disabled={working} onClick={() => void promote(item)} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-2 text-sm text-proof-500 disabled:opacity-40">Create Recovery Case</button>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      {loadedBoundary && items.length === 0 && (
        <Panel className="p-8 text-center text-sm text-slate-500">No pending candidates or accepted candidates awaiting promotion in this boundary.</Panel>
      )}
    </div>
  );
}
