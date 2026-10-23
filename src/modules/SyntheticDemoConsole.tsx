// SYNTHETIC DEMO CONSOLE · one guided screen that drives Identify → Fix → Prove through the REAL API.
//
// WHAT IT IS NOT. It is not a simulation. Every button below calls a governed server route — the same
// routes the rest of the product uses — and every rule (role, separation of duties, baseline ordering,
// signed-evidence gate, closed reason vocabulary) is enforced by the SERVER. This file decides what to
// SHOW and in which order to OFFER the steps; it decides nothing about what is allowed or what a number is.
//
// WHAT IS SYNTHETIC, said where it is read. The book is a labelled fixture; the payer is simulated; the
// "payment" is a signed record from a synthetic billing source whose amount the server fixes (the
// operator cannot type it); no customer, no payment rail and no real money is involved. The banner below
// is not decoration: the first thing a reader sees must be that none of this is real revenue.
//
// TWO LEDGERS, NEVER BLENDED, on this screen as everywhere. "Revenue Opportunity" (what the reconciler
// IDENTIFIED) and "Revenue Returned" (what a frozen proof says came BACK) are separate panels with
// separate labels. Returned reads NOT COMPUTED until a proof exists — never $0.00, which would assert a
// proof was found and established nothing.
//
// WHO ACTS. The OPERATOR (beneficiary side) reviews, opens, owns, baselines, intervenes and triggers the
// simulated payer. A DIFFERENT identity — the Finance APPROVER — freezes the proof. The server refuses
// the operator if they try; this screen does not offer them the button.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../data/apiClient";
import {
  listCandidateQueue,
  promoteCandidate,
  reviewCandidate,
  type CandidateQueueItemDTO,
} from "../data/candidateReviewClient";
import {
  approveProof,
  authorCase,
  establishBaseline,
  getRecoveryCase,
  listBaselines,
  listEvidence,
  recordIntervention,
  type ProofDTO,
  type RecoveryCaseViewDTO,
} from "../data/governedTrustClient";
import {
  getSyntheticDemoStatus,
  launchSyntheticDemo,
  settleSyntheticCase,
  type SyntheticDemoStatusDTO,
} from "../data/syntheticDemoClient";
import { APPROVER, type DevActor } from "../data/devActor";
import { Panel, Pill, SectionHeader } from "../components/ui";
import { formatMoney, money } from "../domain/money";
import { CASE_PROGRESS_ORDER } from "../domain/caseLifecycle";

const OPERATOR: DevActor = { actorId: "pilot-operator@company", role: "operator" };

/** The closed-vocabulary value that truthfully names "a corrective invoice was raised and collected". */
const REASON = "BillingCorrection";
const DEFAULT_REVIEW_REASON = "Confirmed against the synthetic contract schedule";
const DEFAULT_BASELINE = "100.00";
const BASELINE_METHOD = "matched_historical_cohort";

function parseMinor(text: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function safeMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The operation failed. Nothing was recorded.";
}

const exact = (minor: number, currency: string) => formatMoney(money(minor, currency), { exact: true });

export function SyntheticDemoConsole() {
  const [status, setStatus] = useState<SyntheticDemoStatusDTO | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateQueueItemDTO[]>([]);
  const [launched, setLaunched] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [caseId, setCaseId] = useState<string | null>(null);
  const [view, setView] = useState<RecoveryCaseViewDTO | null>(null);
  const [baselineText, setBaselineText] = useState(DEFAULT_BASELINE);
  const [proof, setProof] = useState<ProofDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    getSyntheticDemoStatus(OPERATOR)
      .then((s) => { if (live) setStatus(s); })
      .catch((e) => { if (live) setStatusError(safeMessage(e)); });
    return () => { live = false; if (poll.current !== null) window.clearTimeout(poll.current); };
  }, []);

  const boundaryId = status?.enabled ? status.boundaryId : "";

  const refreshCase = useCallback(async (id: string) => {
    // Read as Finance: the operator is a beneficiary and may not read proof provenance (server-enforced).
    setView(await getRecoveryCase(id, APPROVER));
  }, []);

  const refreshCandidates = useCallback(async (): Promise<CandidateQueueItemDTO[]> => {
    if (!boundaryId) return [];
    const next = await listCandidateQueue(boundaryId, OPERATOR);
    setCandidates(next);
    return next;
  }, [boundaryId]);

  // The reconciler runs in the worker, asynchronously. Poll the REAL queue until it has something; never
  // fabricate a candidate while waiting.
  const waitForCandidates = useCallback((attempt = 0) => {
    setWaiting(true);
    refreshCandidates()
      .then((items) => {
        if (items.length > 0 || attempt >= 40) { setWaiting(false); return; }
        poll.current = window.setTimeout(() => waitForCandidates(attempt + 1), 750);
      })
      .catch((e) => { setWaiting(false); setError(safeMessage(e)); });
  }, [refreshCandidates]);

  async function act(label: string, work: () => Promise<string | void>): Promise<void> {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      if (message) setNotice(message);
      if (caseId) await refreshCase(caseId);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function launch(): Promise<void> {
    return act("launch", async () => {
      const result = await launchSyntheticDemo(OPERATOR);
      setLaunched(true);
      waitForCandidates();
      return result.alreadyLaunched
        ? "The synthetic book was already launched on this boundary; showing its candidates."
        : "Synthetic book queued. The reconciler is comparing the contract schedule with what was billed.";
    });
  }

  function accept(item: CandidateQueueItemDTO): Promise<void> {
    const reason = (reasons[item.candidateId] ?? DEFAULT_REVIEW_REASON).trim();
    return act(`accept:${item.candidateId}`, async () => {
      await reviewCandidate(item.candidateId, OPERATOR, { boundaryId: item.boundaryId, decision: "accepted", reason });
      await refreshCandidates();
      return "Candidate accepted. Opening a Recovery Case is a separate action.";
    });
  }

  function open(item: CandidateQueueItemDTO): Promise<void> {
    return act(`open:${item.candidateId}`, async () => {
      const result = await promoteCandidate(item.candidateId, OPERATOR, item.boundaryId);
      setCaseId(result.recoveryCase.recoveryCaseId);
      await refreshCase(result.recoveryCase.recoveryCaseId);
      await refreshCandidates();
      return `Recovery Case ${result.recoveryCase.recoveryCaseId} opened. It identifies exposure; nothing has been returned.`;
    });
  }

  const progress = view?.lifecycle.progress ?? null;
  const reached = (stage: (typeof CASE_PROGRESS_ORDER)[number]) =>
    progress !== null && CASE_PROGRESS_ORDER.indexOf(stage) <= CASE_PROGRESS_ORDER.indexOf(progress);
  const currency = view?.root.currency ?? (status?.enabled ? status.currency : "USD");
  const baselineMinor = parseMinor(baselineText);
  const exposure = view?.lifecycle.exposure.minor ?? 0;
  const baselineProblem =
    baselineMinor === null ? "Enter an amount like 100.00."
      : baselineMinor >= exposure ? "A baseline at or above the exposure leaves no room for any recovery."
        : null;

  const authorStep = () => act("author", async () => { await authorCase(caseId!, OPERATOR); return "Case owner recorded."; });
  const baselineStep = () => act("baseline", async () => {
    await establishBaseline(caseId!, OPERATOR, {
      baselineId: `BL-SYNTHETIC-${caseId!.slice(3, 11)}`,
      calculatedMinor: baselineMinor!,
      currency,
      method: BASELINE_METHOD,
      methodVersion: 1,
      sourceRefs: ["synthetic-demo-baseline"],
      effectiveAt: new Date().toISOString(),
    });
    return "Baseline established and locked before any outcome exists.";
  });
  const interveneStep = () => act("intervene", async () => { await recordIntervention(caseId!, OPERATOR); return "Corrective action recorded."; });
  const settleStep = () => act("settle", async () => {
    await settleSyntheticCase(caseId!, OPERATOR);
    return "SYNTHETIC payer settled the corrected invoice. A signed outcome record was ingested. Nothing is proven yet.";
  });
  const approveStep = () => act("approve", async () => {
    // The collected figure is READ from the signed outcome evidence, not typed: the approver claims no more
    // than the source attested, and the server re-checks that anyway.
    const evidence = (await listEvidence(caseId!, APPROVER)).filter((e) => e.evidenceRole === "outcome");
    const collected = evidence.reduce((sum, e) => sum + (e.amountMinor ?? 0), 0);
    const baselineList = await listBaselines(caseId!, APPROVER);
    const latest = baselineList[baselineList.length - 1];
    if (evidence.length === 0 || collected <= 0 || !latest) {
      throw new ApiError("conflict", "No signed outcome evidence or locked baseline to approve against.");
    }
    const approved = await approveProof(APPROVER, {
      proofId: `PF-SYNTHETIC-${caseId!.slice(3, 11)}`,
      recoveryCaseId: caseId!,
      currency,
      collectedMinor: collected,
      excludedRecoveryMinor: 0,
      exclusionStatement: "No exclusions asserted (SYNTHETIC demonstration).",
      recoveryReason: REASON,
      attribution: "Corrective invoice raised and collected (SYNTHETIC demonstration).",
      evidenceIds: evidence.map((e) => e.evidenceId),
      baselineId: latest.baselineId,
      confidenceUsed: 95,
    });
    setProof(approved);
    return "Proof frozen by the Finance approver. This is SYNTHETIC — not real revenue.";
  });

  if (statusError) {
    return <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{statusError}</div>;
  }

  return (
    <div data-testid="synthetic-demo-console">
      <SectionHeader
        title="Synthetic Demo · Identify → Fix → Prove"
        subtitle="One workflow, one case: a shortfall is identified, a corrective action is taken, and money returned is proven — all through the real governed API."
      />

      <div data-testid="synthetic-banner" role="note" className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        <strong>SYNTHETIC DEMONSTRATION.</strong> The contract and billing rows are a labelled fixture, the payer is simulated, and
        the "payment" is a signed record from a synthetic billing source whose amount the server fixes. No customer data, no
        payment rail, no real money. Nothing on this screen is real revenue.
      </div>

      {status && !status.enabled && (
        <Panel className="p-6 text-sm text-slate-400" >
          <div data-testid="demo-disabled">
            The synthetic demo is <strong>not enabled</strong> on this server. It is a private demonstration harness, off by default
            (<span className="font-mono">NH_SYNTHETIC_DEMO_ENABLED</span>). See docs/PILOT_RECONCILER_DEMO_V1.md.
          </div>
        </Panel>
      )}

      {status?.enabled && (
        <>
          {error && <div role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
          {notice && <div role="status" className="mb-4 rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-3 text-sm text-proof-500">{notice}</div>}

          {/* THE TWO LEDGERS — always side by side, never one number. */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel className="p-4">
              <div className="text-xs uppercase text-slate-500">Revenue Opportunity · identified · SYNTHETIC · not money returned</div>
              <div data-testid="demo-exposure" className="mt-2 text-2xl font-semibold text-detect-500">
                {view
                  ? exact(view.lifecycle.exposure.minor, view.lifecycle.exposure.currency)
                  : candidates.length > 0
                    ? exact(candidates.reduce((s, c) => s + c.signal.amountAtRiskMinor, 0), currency)
                    : "—"}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {view ? "This case's identified exposure." : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} awaiting review (total).`}{" "}
                A forecast: it is never counted as recovered.
              </div>
            </Panel>
            <Panel className="p-4">
              <div className="text-xs uppercase text-slate-500">Revenue Returned · proven · SYNTHETIC</div>
              {view && view.provenRevenueReturnedMinor !== null ? (
                <>
                  <div data-testid="demo-returned" className="mt-2 text-2xl font-semibold text-proof-500">
                    {exact(view.provenRevenueReturnedMinor, view.root.currency)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Collected − baseline, frozen by proof <span className="font-mono">{view.provenFromProofIds.join(", ")}</span>.
                  </div>
                </>
              ) : (
                <>
                  <div data-testid="demo-returned" className="mt-2 text-2xl font-semibold text-slate-500">NOT COMPUTED</div>
                  <div className="mt-1 text-[11px] text-slate-500">No proof exists. That is not the same as a proof that found nothing.</div>
                </>
              )}
            </Panel>
          </div>

          {/* 1 · IDENTIFY */}
          <Panel className="mb-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-100">1 · Identify <Pill tone="detect">SYNTHETIC book</Pill></div>
                <div className="mt-1 text-[12px] text-slate-500">
                  Boundary <span className="font-mono text-slate-300">{status.boundaryId}</span> · {status.label}
                </div>
              </div>
              <button
                onClick={() => void launch()}
                disabled={busy !== null || waiting}
                className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-2 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40"
              >
                {busy === "launch" ? "Launching…" : "Launch synthetic reconciliation"}
              </button>
            </div>
            {waiting && <p className="mt-2 text-[12px] text-slate-500">Waiting for the reconciler to compare the two systems…</p>}
            {launched && !waiting && candidates.length === 0 && !caseId && (
              <p className="mt-2 text-[12px] text-slate-500">No candidates in the review queue for this boundary.</p>
            )}
            <div className="mt-3 space-y-3">
              {candidates.map((item) => {
                const accepted = item.review?.decision === "accepted";
                return (
                  <div key={item.candidateId} data-testid="demo-candidate" className="rounded-lg border border-ink-500/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[12px] text-slate-400">
                        <span className="font-mono text-slate-300">{item.candidateId}</span> · {item.signal.recoveryType}
                        <div className="text-[10px] break-all text-slate-600">payer pseudonym {item.signal.sourceRef}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-detect-500">{exact(item.signal.amountAtRiskMinor, item.signal.currency)}</div>
                        <div className="text-[10px] uppercase text-slate-500">Revenue Opportunity · not proven</div>
                      </div>
                    </div>
                    {!caseId && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {!accepted ? (
                          <>
                            <input
                              aria-label="Review reason"
                              value={reasons[item.candidateId] ?? DEFAULT_REVIEW_REASON}
                              onChange={(e) => setReasons((cur) => ({ ...cur, [item.candidateId]: e.target.value }))}
                              className="num-input min-w-72 flex-1"
                            />
                            <button disabled={busy !== null} onClick={() => void accept(item)} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-2 text-sm text-proof-500 disabled:opacity-40">
                              Accept candidate
                            </button>
                          </>
                        ) : (
                          <button disabled={busy !== null} onClick={() => void open(item)} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-2 text-sm text-proof-500 disabled:opacity-40">
                            Open Recovery Case
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* 2 · FIX */}
          {caseId && view && (
            <Panel className="mb-4 p-4">
              <div className="text-sm font-medium text-slate-100">2 · Fix <span className="ml-2 font-mono text-[11px] text-slate-500" data-testid="demo-case-id">{caseId}</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {CASE_PROGRESS_ORDER.map((stage) => (
                  <span key={stage} data-testid={`demo-stage-${stage}`} data-reached={reached(stage) ? "yes" : "no"}
                    className={reached(stage) ? "rounded-full border border-proof-600/40 bg-proof-600/10 px-2 py-0.5 text-[11px] text-proof-500" : "rounded-full border border-ink-500/50 px-2 py-0.5 text-[11px] text-slate-600"}>
                    {stage}
                  </span>
                ))}
              </div>
              <ol className="mt-3 space-y-3 text-[13px] text-slate-300">
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>Record the case owner (the beneficiary side)</span>
                  <button disabled={busy !== null || progress !== "OPENED"} onClick={() => void authorStep()} className="rounded-lg border border-proof-600/40 px-3 py-1.5 text-sm text-proof-500 disabled:opacity-30">Record case owner</button>
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Lock a baseline <span className="text-slate-500">(what would have been collected anyway) — locked BEFORE any outcome</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input aria-label="Baseline amount" value={baselineText} onChange={(e) => setBaselineText(e.target.value)} className="num-input w-28" />
                    <button disabled={busy !== null || progress !== "OWNED" || baselineProblem !== null} onClick={() => void baselineStep()} className="rounded-lg border border-proof-600/40 px-3 py-1.5 text-sm text-proof-500 disabled:opacity-30">Lock baseline</button>
                  </span>
                </li>
                {progress === "OWNED" && baselineProblem && <li className="text-[11px] text-amber-300">{baselineProblem}</li>}
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>Record the corrective action (the fix — a corrected invoice is raised)</span>
                  <button disabled={busy !== null || progress !== "BASELINED"} onClick={() => void interveneStep()} className="rounded-lg border border-proof-600/40 px-3 py-1.5 text-sm text-proof-500 disabled:opacity-30">Record corrective action</button>
                </li>
              </ol>
            </Panel>
          )}

          {/* 3 · PROVE */}
          {caseId && view && (
            <Panel className="mb-4 p-4">
              <div className="text-sm font-medium text-slate-100">3 · Prove</div>
              <ol className="mt-3 space-y-3 text-[13px] text-slate-300">
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    SYNTHETIC payer settles the corrected invoice <span className="text-slate-500">— a signed outcome record; the server fixes the amount, you cannot type it</span>
                  </span>
                  <button disabled={busy !== null || progress !== "INTERVENED"} onClick={() => void settleStep()} className="rounded-lg border border-detect-600/40 px-3 py-1.5 text-sm text-detect-500 disabled:opacity-30">Simulate synthetic payment</button>
                </li>
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Finance approver freezes the proof as <span className="font-mono">{REASON}</span>{" "}
                    <span className="text-slate-500">— a different identity ({APPROVER.actorId}); the operator cannot approve their own recovery</span>
                  </span>
                  <button disabled={busy !== null || progress !== "EVIDENCED"} onClick={() => void approveStep()} className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 disabled:opacity-30">Approve proof as Finance</button>
                </li>
              </ol>
              {proof && (
                <div data-testid="demo-proof" className="mt-4 rounded-lg border border-proof-600/40 bg-proof-600/5 p-3 text-[12px] text-slate-300">
                  <div className="font-medium text-proof-500">Proof {proof.proofId} · {proof.recoveryReason} · SYNTHETIC</div>
                  <div className="mt-1">
                    Collected {exact(proof.collectedAmount.minor, proof.currency)} − baseline {exact(proof.baselineAmount.minor, proof.currency)} ={" "}
                    <strong>{exact(proof.revenueReturned.minor, proof.currency)}</strong> returned
                  </div>
                  <div className="mt-1 text-slate-500">
                    Identified exposure was {exact(view.lifecycle.exposure.minor, view.lifecycle.exposure.currency)}; the proven return is a different, smaller number.
                  </div>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
