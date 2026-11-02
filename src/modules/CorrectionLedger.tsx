// THE CORRECTION LEDGER · what happened to a corrected observation, and what is refused.
//
// WHAT THIS SCREEN IS FOR. A pilot reviewer needs to see that NH noticed a second, different statement
// of one obligation's shortfall — and that NH did NOT quietly pick one. Until now the ledger existed
// only as a service: nothing rendered it, so a reviewer had no way to know a correction had been seen.
//
// WHAT IT MUST NEVER DO, and the rules are the screen's structure rather than comments beside it:
//
//   * NEVER show an authoritative amount. The DTO has no corrected / effective / resolved field, so
//     there is nothing to render even by mistake, and the precedence notice is shown verbatim from the
//     server rather than paraphrased here.
//   * NEVER show a monetary zero where a figure is unknowable. `storedMinor` is `null` for an
//     unorderable identity and renders as NOT ESTABLISHABLE — `$0.00` would assert the store holds
//     nothing, which is a different and false claim.
//   * NEVER net an upward magnitude against a downward one. They are two panels, never a difference,
//     because an understatement and an overstatement are two problems and their sum is zero problems.
//   * NEVER imply money moved. Every figure here is OBSERVED exposure under dispute.
//
// AuditRead ONLY. The actor is an approver by construction: the ledger names an amount the governed
// store is not reporting, and the operator who benefits from a larger figure must not be the one
// reading it. An operator identity would get a 403, so the screen states the required role rather than
// letting a reviewer read a permission failure as a broken feature.
import { useCallback, useState } from "react";
import { ApiError } from "../data/apiClient";
import {
  readCandidateCorrections,
  type CorrectionRecordDTO,
  type CorrectionViewDTO,
} from "../data/candidateCorrectionsClient";
import type { DevActor } from "../data/devActor";
import { Panel, Pill, SectionHeader } from "../components/ui";
import { formatMoney, money } from "../domain/money";

/** `AuditRead` is held by approver, verifier and steward — never by author or operator. */
const REVIEWER: DevActor = { actorId: "pilot-approver@company", role: "approver" };

/** One wording per state, in one place. A screen must not author a second vocabulary. */
const STATE_LABEL: Readonly<Record<CorrectionRecordDTO["state"], string>> = Object.freeze({
  SINGLE_OBSERVATION: "One observation",
  REPEATED_IDENTICAL_OBSERVATION: "Replay — identical amount",
  CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED: "Correction observed — precedence undecided",
  ORDER_NOT_ESTABLISHABLE: "Refused — observation order not establishable",
});

const STATE_EXPLANATION: Readonly<Record<CorrectionRecordDTO["state"], string>> = Object.freeze({
  SINGLE_OBSERVATION: "Only one statement of this obligation's shortfall was observed. Nothing to decide.",
  REPEATED_IDENTICAL_OBSERVATION:
    "The same amount was observed more than once. A replay is not a correction, and no figure is in dispute.",
  CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED:
    "More than one DIFFERENT amount was observed for this obligation. Every amount is listed below. " +
    "Which statement is authoritative is NOT decided here, and no approved rule decides it.",
  ORDER_NOT_ESTABLISHABLE:
    "Two or more observations share one append sequence, so which statement came first cannot be " +
    "established. No stored figure, delta or direction is reported — reporting one would depend on an " +
    "order nothing authoritative recorded.",
});

/**
 * EXACT DIGITS, deliberately. `formatMoney` defaults to whole units, which is right for a headline and
 * wrong here: a disputed difference of $0.50 would render as `$1` beside `$0`, misstating the size of
 * the dispute by the only part of it that is in question.
 */
function money0(minor: number, currency: string): string {
  return formatMoney(money(minor, currency), { exact: true });
}

/** Null is NOT ESTABLISHABLE, never `$0.00`. The single place that decision is made. */
function maybeMoney(minor: number | null, currency: string): string {
  return minor === null ? "NOT ESTABLISHABLE" : money0(minor, currency);
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "forbidden") {
    return "This ledger requires the AuditRead capability (approver, verifier or steward). " +
      "An operator cannot read it: the actor who benefits from a larger figure must not be the one " +
      "deciding which statement to use.";
  }
  return error instanceof ApiError ? error.message : "The correction ledger could not be read.";
}

function RecordCard({ record }: { record: CorrectionRecordDTO }) {
  const disputed = record.state === "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED";
  const refused = record.state === "ORDER_NOT_ESTABLISHABLE";
  return (
    <li
      className="rounded-lg border border-ink-600/60 bg-ink-700/40 p-4"
      data-testid="correction-record"
      data-state={record.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={refused ? "neutral" : disputed ? "detect" : "neutral"}>{STATE_LABEL[record.state]}</Pill>
        <Pill tone="neutral">{record.obligationGrained ? "Obligation-level" : "Account-level"}</Pill>
        <span className="font-mono text-xs text-slate-400">{record.identityDigest}</span>
      </div>
      <p className="mt-2 text-sm text-slate-300">{STATE_EXPLANATION[record.state]}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Observations</dt>
          <dd className="text-slate-200">{record.observationCount}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Every amount observed</dt>
          <dd className="text-slate-200" data-testid="observed-amounts">
            {record.observedAmountsMinor.map((m) => money0(m, record.currency)).join(" · ")}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Figure the governed store holds</dt>
          <dd className="text-slate-200" data-testid="stored-figure">
            {maybeMoney(record.storedMinor, record.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Most recent statement</dt>
          <dd className="text-slate-200">{maybeMoney(record.latestObservedMinor, record.currency)}</dd>
        </div>
        {disputed ? (
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt className="text-slate-400">
              Undecided {record.direction === "UPWARD" ? "under-report" : "over-statement"}
            </dt>
            <dd className="text-detect-500" data-testid="undecided-magnitude">
              {maybeMoney(record.undecidedMagnitudeMinor, record.currency)} ({record.direction})
            </dd>
          </div>
        ) : null}
      </dl>
      {/* Said on every card, not only in the header: a reader may be looking at one row in isolation. */}
      <p className="mt-3 text-xs text-slate-500">
        OBSERVED exposure under dispute. Not proven, not recovered, and never summed into Revenue Returned.
      </p>
    </li>
  );
}

export function CorrectionLedger() {
  const [boundaryId, setBoundaryId] = useState("");
  const [view, setView] = useState<CorrectionViewDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = boundaryId.trim();
  const load = useCallback(async () => {
    if (!normalized) return;
    setLoading(true);
    setError(null);
    try {
      setView(await readCandidateCorrections(normalized, REVIEWER));
    } catch (err) {
      setView(null);
      setError(safeMessage(err));
    } finally {
      setLoading(false);
    }
  }, [normalized]);

  const refused = view !== null && view.result.outcome === "REFUSED_ORDER_UNSAFE";

  return (
    <section className="space-y-4" data-testid="correction-ledger">
      <SectionHeader
        title="Correction Ledger"
        subtitle="Corrected observations are detected and reported. Precedence is not decided here."
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[16rem]">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
              Pilot boundary ID
            </span>
            <input
              className="w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100"
              placeholder="Enter the exact customer/pilot boundary"
              aria-label="Pilot boundary ID"
              value={boundaryId}
              onChange={(e) => setBoundaryId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-detect-600/20 px-4 py-2 text-sm font-medium text-detect-500 disabled:opacity-40"
            disabled={loading || normalized === ""}
            onClick={() => void load()}
          >
            {loading ? "Reading…" : "Read ledger"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Requires the AuditRead capability — approver, verifier or steward. An operator is refused by
          design.
        </p>
      </Panel>

      {error !== null ? (
        <Panel>
          <p className="text-sm text-detect-500" data-testid="ledger-error">{error}</p>
        </Panel>
      ) : null}

      {view !== null ? (
        <>
          {/* The server's own wording, rendered verbatim. A screen must not paraphrase a claim boundary. */}
          <Panel>
            <p className="text-sm text-slate-300" data-testid="precedence-notice">{view.precedenceNotice}</p>
          </Panel>

          {refused && view.result.outcome === "REFUSED_ORDER_UNSAFE" ? (
            <Panel>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral">REFUSED — ORDER UNSAFE</Pill>
              </div>
              <p className="mt-2 text-sm text-slate-300" data-testid="refusal-reason">
                {view.result.reason}
              </p>
            </Panel>
          ) : null}

          <Panel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Identities</p>
                <p className="text-lg text-slate-100" data-testid="total-identities">{view.totals.identities}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">With corrections</p>
                <p className="text-lg text-slate-100" data-testid="total-corrections">
                  {view.totals.withCorrections}
                </p>
              </div>
              {/* TWO PANELS, NEVER A DIFFERENCE. There is no net figure and there must not be one. */}
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Undecided under-report</p>
                <p className="text-lg text-detect-500" data-testid="total-upward">
                  {money0(view.totals.upwardUndecidedMinor, "USD")}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Undecided over-statement</p>
                <p className="text-lg text-detect-500" data-testid="total-downward">
                  {money0(view.totals.downwardUndecidedMinor, "USD")}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500" data-testid="no-net-notice">
              These two figures are never netted. An under-report and an over-statement are two separate
              problems; their difference would describe neither.
            </p>
            {view.totals.orderNotEstablishable > 0 ? (
              <p className="mt-2 text-xs text-slate-400" data-testid="order-uncertain-count">
                {view.totals.orderNotEstablishable} identity/identities have no establishable observation
                order and are excluded from both figures above.
              </p>
            ) : null}
          </Panel>

          {view.records.length === 0 ? (
            <Panel>
              <p className="text-sm text-slate-400" data-testid="ledger-empty">
                No observations are recorded for this boundary. This is not a finding that nothing was
                owed.
              </p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              {view.records.map((r) => <RecordCard key={r.identityDigest} record={r} />)}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
