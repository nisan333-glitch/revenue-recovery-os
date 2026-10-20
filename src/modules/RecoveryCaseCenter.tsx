// The authoritative Recovery Case, on a screen, read from the governed API.
//
// WHY IT EXISTS. A promoted `RecoveryCaseRecord` was invisible in the product. The governed lifecycle —
// author, baseline, intervention, evidence, proof — lives in Postgres behind the HTTP surface, and the
// screen that shows a CFO a Revenue Returned figure (`CFOProofView`) renders `useRecovery()`, the
// seed-backed React context. So the only case a user could see was a hand-authored demo row. This screen
// reads the API and nothing else: there is no `useRecovery()` import in this file, and a test asserts it.
//
// THE RULE IT HAS TO KEEP, on this screen as on every other: an identified gap is not returned money.
// The at-risk figure and the proven figure are rendered in separate panels, with separate labels, and
// they come from separately branded types in the domain so they cannot be interchanged by a typo. When
// no effective proof exists the proven panel says NOT COMPUTED and names the reason — it never renders
// `$0.00`, which would assert that a proof was found and established nothing.
//
// BOTH FIGURES RENDER EXACT. `formatMoney` rounds to whole units by default, which is right for a
// portfolio headline and wrong here: a proven dollar a CFO signs must not acquire a rounding error on
// its way to a screen, and an exposure rendered to the cent is what makes the two numbers comparable.
//
// IT IS READ-ONLY. Every governed write already has its surface; adding them here would duplicate the
// authority logic in a second place. This screen reads.
import { useCallback, useState } from "react";
import { ApiError } from "../data/apiClient";
import { getRecoveryCase, type RecoveryCaseViewDTO } from "../data/governedTrustClient";
import type { DevActor } from "../data/devActor";
import { APPROVER, STEWARD } from "../data/devActor";
import { Panel, Pill, SectionHeader } from "../components/ui";
import { formatMoney, money } from "../domain/money";
import { CASE_PROGRESS_ORDER } from "../domain/caseLifecycle";

const VERIFIER: DevActor = { actorId: "val@company", role: "verifier" };

/**
 * Only oversight roles are offered, because only they hold `AuditRead`.
 *
 * This is not a UI convenience: the case's own operator is a BENEFICIARY of a larger recovery number,
 * and EP-8.1 H2 already decided that a beneficiary may not read frozen proof provenance. Offering an
 * operator here would produce a 403 and teach the reader that the screen is broken rather than that the
 * separation is deliberate, so the refusal is explained in the panel instead.
 */
const READERS: readonly { readonly label: string; readonly actor: DevActor }[] = Object.freeze([
  { label: "Finance (approver)", actor: APPROVER },
  { label: "Verifier", actor: VERIFIER },
  { label: "Governance (steward)", actor: STEWARD },
]);

const UNAVAILABLE_REASON: Readonly<Record<string, string>> = Object.freeze({
  no_effective_recovery_proof:
    "No effective proof exists for this case. Nothing has been proven returned — which is not the same as a proof having found nothing.",
  proof_currency_disagreement:
    "An effective proof is recorded in a currency other than the case's own. The ledger is refused rather than summed into a figure no proof asserts.",
});

/**
 * `read` is injected with the real client as its default, so a test can assert what the screen DOES with
 * one shape of governed answer without reaching the network. The default is the production path, so the
 * injection cannot drift into a second implementation.
 */
export interface RecoveryCaseCenterProps {
  readonly read?: (caseId: string, actor: DevActor) => Promise<RecoveryCaseViewDTO>;
}

export function RecoveryCaseCenter({ read = getRecoveryCase }: RecoveryCaseCenterProps) {
  const [caseId, setCaseId] = useState("");
  const [readerIndex, setReaderIndex] = useState(0);
  const [view, setView] = useState<RecoveryCaseViewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = caseId.trim();
  const reader = READERS[readerIndex] ?? READERS[0]!;

  const load = useCallback(async () => {
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      setView(await read(trimmed, reader.actor));
    } catch (err) {
      setView(null);
      setError(
        err instanceof ApiError
          ? err.message
          : "The Recovery Case could not be read. Nothing is shown rather than a substitute.",
      );
    } finally {
      setLoading(false);
    }
  }, [trimmed, reader, read]);

  return (
    <div data-testid="recovery-case-center">
      <SectionHeader
        title="Recovery Case"
        subtitle="The authoritative case created by promoting a reviewed detector finding — read from the governed record, never from seed data."
      />

      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-72 flex-1">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Recovery Case ID</span>
            <input
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
              placeholder="RC-…"
              aria-label="Recovery Case ID"
              className="num-input w-full"
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Reading as</span>
            <select
              value={readerIndex}
              onChange={(event) => setReaderIndex(Number(event.target.value))}
              aria-label="Reading as"
              className="num-input"
            >
              {READERS.map((entry, index) => (
                <option key={entry.label} value={index}>{entry.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void load()}
            disabled={!trimmed || loading}
            className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-4 py-2 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40"
          >
            {loading ? "Reading…" : "Read case"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Only oversight roles are offered. The operator who opened a case is a beneficiary of a larger recovery
          number and may not read its proof provenance — the server enforces this, and the screen does not offer a
          way to try.
        </p>
      </Panel>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {view && (
        <div data-testid="recovery-case-body">
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel className="p-4" >
              <div className="text-xs uppercase text-slate-500">Identified exposure</div>
              <div data-testid="case-exposure" className="mt-2 text-2xl font-semibold text-detect-500">
                {formatMoney(money(view.lifecycle.exposure.minor, view.lifecycle.exposure.currency), { exact: true })}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{view.exposureLabel}</div>
            </Panel>

            <Panel className="p-4">
              <div className="text-xs uppercase text-slate-500">Revenue Returned · proven</div>
              {view.provenRevenueReturnedMinor === null ? (
                <>
                  <div data-testid="case-revenue-returned" className="mt-2 text-2xl font-semibold text-slate-500">
                    NOT COMPUTED
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {UNAVAILABLE_REASON[view.provenLedgerUnavailableReason ?? ""] ?? "The proven ledger is unavailable."}
                  </div>
                </>
              ) : (
                <>
                  <div data-testid="case-revenue-returned" className="mt-2 text-2xl font-semibold text-proof-500">
                    {formatMoney(money(view.provenRevenueReturnedMinor, view.root.currency), { exact: true })}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Collected − baseline, frozen by {view.provenFromProofIds.length === 1 ? "proof" : "proofs"}{" "}
                    <span className="font-mono">{view.provenFromProofIds.join(", ")}</span>.
                  </div>
                </>
              )}
            </Panel>
          </div>

          <Panel className="mb-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase text-slate-500">Progress</span>
              {CASE_PROGRESS_ORDER.map((stage) => {
                const reached =
                  CASE_PROGRESS_ORDER.indexOf(stage) <= CASE_PROGRESS_ORDER.indexOf(view.lifecycle.progress);
                return (
                  <span
                    key={stage}
                    data-testid={`stage-${stage}`}
                    data-reached={reached ? "yes" : "no"}
                    className={
                      reached
                        ? "rounded-full border border-proof-600/40 bg-proof-600/10 px-2 py-0.5 text-[11px] text-proof-500"
                        : "rounded-full border border-ink-500/50 px-2 py-0.5 text-[11px] text-slate-600"
                    }
                  >
                    {stage}
                  </span>
                );
              })}
              {view.lifecycle.governance.map((marker) => (
                <Pill key={marker} tone="detect">{marker}</Pill>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 text-[12px] text-slate-400 md:grid-cols-3">
              <div><span className="text-slate-500">Case</span><br /><span data-testid="case-id" className="font-mono">{view.root.recoveryCaseId}</span></div>
              <div><span className="text-slate-500">From candidate</span><br /><span className="font-mono">{view.root.sourceCandidateId}</span></div>
              <div><span className="text-slate-500">Detector</span><br />{view.root.detectorVersion}</div>
              <div><span className="text-slate-500">Opened by</span><br />{view.root.openedByActorId} ({view.root.openedByRole})</div>
              <div><span className="text-slate-500">Responsible</span><br />{view.lifecycle.responsible ? `${view.lifecycle.responsible.actorId} (${view.lifecycle.responsible.role})` : "— not yet authored"}</div>
              <div><span className="text-slate-500">Boundary</span><br /><span className="font-mono">{view.root.boundaryId}</span></div>
            </div>
          </Panel>

          <Panel className="mb-4 p-4">
            <div className="mb-2 text-xs uppercase text-slate-500">Authority trail</div>
            {view.lifecycle.trail.length === 0 ? (
              <div className="text-sm text-slate-500">No authority events recorded.</div>
            ) : (
              <ul className="space-y-1 text-[12px] text-slate-400">
                {view.lifecycle.trail.map((entry, index) => (
                  <li key={`${entry.action}-${entry.at}-${index}`} data-testid="trail-entry">
                    <span className="font-mono text-slate-300">{entry.action}</span> · {entry.actorId} ({entry.role}) · {entry.at}
                  </li>
                ))}
              </ul>
            )}
            {!view.lifecycle.trailOrderCertain && (
              <p className="mt-2 text-[11px] text-amber-300">
                Two or more authority events share a timestamp, so the ORDER shown here is not established by the
                record. The stage above is derived from which events exist, not from their order, so it is
                unaffected. The ambiguity is stated rather than resolved.
              </p>
            )}
            {view.unknownAuthorityActions.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                Actions this build does not recognise, shown unchanged: {view.unknownAuthorityActions.join(", ")}.
              </p>
            )}
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 text-xs uppercase text-slate-500">
              Evidence · {view.evidence.length} record{view.evidence.length === 1 ? "" : "s"} · {view.baselineCount} baseline{view.baselineCount === 1 ? "" : "s"}
            </div>
            {view.evidence.length === 0 ? (
              <div className="text-sm text-slate-500">No evidence ingested. A case with no evidence can hold no proof.</div>
            ) : (
              <ul className="space-y-1 text-[12px] text-slate-400">
                {view.evidence.map((item) => (
                  <li key={item.evidenceId} data-testid="evidence-entry">
                    <span className="font-mono text-slate-300">{item.evidenceId}</span> · {item.evidenceRole} ·{" "}
                    {item.trustClassification}
                    {item.beneficiaryControl ? " · beneficiary-controlled" : ""}
                    {item.sourceVerification ? " · source-verified" : " · unverified source"}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
