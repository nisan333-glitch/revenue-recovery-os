// Re-assess a dataset already assessed — under a newly governed calculation method, WITHOUT re-upload.
//
// WHAT AN OPERATOR CAN DO HERE, and nothing more: cite an execution they are entitled to read, choose
// a definition SOMEONE ELSE approved, state why, and submit. They cannot set a cut-off, a threshold, a
// currency or a method, and there is no file picker on this screen at all — the input the earlier
// finding was computed from is reused, and the server verifies it against its own recorded hash before
// anything runs. A missing or unverifiable one is refused and the remedy is to re-submit the dataset.
//
// WHAT IT NEVER CLAIMS. A revision does not supersede the earlier answer and does not replace it. Both
// executions exist, both findings exist, each at its own identifier, and the screen shows them side by
// side rather than swapping one for the other. Both are Revenue Opportunity — a pilot observation —
// and neither is proof of recovered revenue. That sentence sits above the figures, not below them.
//
// WHY THE ELIGIBILITY LIST IS NOT A GATE. `reassessment.ts` classifies each definition from values the
// SERVER supplied, so the screen can say in advance which ones would be refused and why. The server
// still decides: a refusal that arrives anyway is rendered with its own NH-AX-#### code, its detail and
// its remedy. The local predicate exists so choosing is not guesswork, not so the browser can judge.
import { useEffect, useRef, useState } from "react";
import { Panel, Pill } from "../../components/ui";
import { formatMoney } from "../../domain/money";
import { operatorActorFor } from "../../data/devActor";
import {
  listGovernedAnalysisTerms,
  type GovernedAnalysisTermsRow,
} from "../../data/pilotAnalysisTermsClient";
import {
  readPilotAssessment,
  reassessPilotAssessment,
  truncateRef,
  type AssessmentExecutionView,
  type ReassessAssessmentResult,
} from "../../data/pilotAssessmentClient";
import { pollUntilSettled, timeoutMessage } from "./executionPolling";
import { AssessmentExecutionPanel, ExecutionStatePill } from "./AssessmentExecutionPanel";
import {
  freezeAttempt,
  submitGate,
  termsOptionsForRevision,
  uncertainResponseGuidance,
  type ReassessAttempt,
  type TermsOption,
} from "./reassessment";

/**
 * The data functions, injectable so the screen is renderable without a network.
 *
 * Not a seam for business logic — every one of these returns a SERVER answer unchanged. The tests
 * substitute them to assert what the screen does with each shape of answer, which is the only thing
 * this component decides.
 */
export interface ReassessmentDeps {
  readonly read: typeof readPilotAssessment;
  readonly listTerms: typeof listGovernedAnalysisTerms;
  readonly reassess: typeof reassessPilotAssessment;
}

const DEFAULT_DEPS: ReassessmentDeps = {
  read: readPilotAssessment,
  listTerms: listGovernedAnalysisTerms,
  reassess: reassessPilotAssessment,
};

export interface ReassessmentScreenProps {
  readonly deps?: Partial<ReassessmentDeps>;
  /** Pre-filled for the tests and for a deep link; an operator normally types them. */
  readonly initialBoundaryId?: string;
  readonly initialExecutionId?: string;
}

/** Everything one submission produced, kept together so a half-rendered answer is impossible. */
interface Outcome {
  readonly result: ReassessAssessmentResult;
  /** The revision, once it settled. Null while it is still queued or running. */
  readonly revision: AssessmentExecutionView | null;
  /** A timeout or a transport failure. Never a result. */
  readonly problem: string | null;
  /** True only for a transport failure, where a verbatim retry is the correct next step. */
  readonly retryable: boolean;
}

export function ReassessmentScreen({
  deps,
  initialBoundaryId = "",
  initialExecutionId = "",
}: ReassessmentScreenProps) {
  const { read, listTerms, reassess } = { ...DEFAULT_DEPS, ...deps };

  const [boundaryId, setBoundaryId] = useState(initialBoundaryId);
  const [executionId, setExecutionId] = useState(initialExecutionId);
  const [previous, setPrevious] = useState<AssessmentExecutionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [terms, setTerms] = useState<readonly GovernedAnalysisTermsRow[]>([]);
  const [selectedTermsRef, setSelectedTermsRef] = useState("");
  const [reason, setReason] = useState("");
  const [inFlight, setInFlight] = useState(false);
  // A SYNCHRONOUS LATCH, and not a duplicate of `inFlight`.
  //
  // FOUND BY A TEST, which is the only reason it is here: three clicks dispatched before React
  // re-renders all passed `submitGate`, because `setInFlight(true)` does not take effect until the
  // next render — so the disabled attribute had not been applied yet and the handler ran three times,
  // sending three requests. A disabled button is a DISPLAY of the rule, never the rule itself.
  //
  // `submitGate` keeps its job: it decides what the button looks like and supplies the sentence that
  // says why it is shut. These refs decide whether the handler proceeds, at the instant it is entered.
  const inFlightRef = useRef(false);
  const settledRef = useRef(false);
  // The body as first sent. Replayed verbatim on retry — see `freezeAttempt`.
  const [attempt, setAttempt] = useState<ReassessAttempt | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const actor = operatorActorFor(null);

  async function load(): Promise<void> {
    setLoadError(null);
    setPrevious(null);
    setTerms([]);
    setOutcome(null);
    setAttempt(null);
    setSelectedTermsRef("");
    setLoading(true);
    try {
      const view = await read(boundaryId.trim(), executionId.trim(), actor);
      setPrevious(view);
      const listed = await listTerms(boundaryId.trim(), actor);
      setTerms(listed.terms);
    } catch (e) {
      // Includes not-found and a refused read. Never a partially populated screen: an operator who
      // cannot see the execution must not be offered definitions to re-assess it under.
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialBoundaryId.trim() !== "" && initialExecutionId.trim() !== "") void load();
    // Mount only. Re-reading on every keystroke would spend a governed read per character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options: readonly TermsOption[] = previous ? termsOptionsForRevision(terms, previous.binding) : [];
  const selected = options.find((o) => o.row.termsRef === selectedTermsRef && o.ineligible === null)?.row ?? null;
  const gate = submitGate({
    selectedTermsRef,
    reason,
    inFlight,
    settledExecutionId: outcome?.result.executionId ?? null,
  });

  /**
   * Submit, or re-submit the SAME body after a transport failure.
   *
   * Idempotent by construction: the revision's identity is derived from its binding, so a repeat is
   * answered with the execution the lost request created rather than creating a second one. That is
   * what makes the retry button safe, and the guidance text says so rather than implying a gamble.
   */
  async function submit(): Promise<void> {
    if (previous === null) return;
    const body = attempt ?? (selected === null ? null : freezeAttempt({
      existing: null,
      boundaryId: boundaryId.trim(),
      executionId: executionId.trim(),
      selected,
      reason,
    }));
    if (body === null) return;
    if (inFlightRef.current || settledRef.current) return;
    inFlightRef.current = true;
    setAttempt(body);
    setInFlight(true);
    try {
      const result = await reassess(body, actor);
      if (!result.reassessed || result.executionId === null) {
        // A REFUSAL IS AN ANSWER. It is not retryable and it is not an error: the server named a
        // condition, and repeating the request cannot change it.
        settledRef.current = true;
        setOutcome({ result, revision: null, problem: null, retryable: false });
        return;
      }
      const id = result.executionId;
      const settled = await pollUntilSettled(() => read(body.boundaryId, id, actor));
      if (settled.kind === "settled") {
        settledRef.current = true;
        setOutcome({ result, revision: settled.view, problem: null, retryable: false });
      } else if (settled.kind === "timeout") {
        // The revision EXISTS; only the waiting stopped. Retrying the submission is still safe and
        // still resolves to this same execution, so it stays offered.
        setOutcome({ result, revision: null, problem: timeoutMessage(settled), retryable: true });
      } else {
        setOutcome({ result, revision: null, problem: settled.message, retryable: true });
      }
    } catch (e) {
      // THE UNCERTAIN CASE. The request may or may not have reached the server, and nothing on this
      // screen can tell. What it can say is that a verbatim repeat is safe.
      setOutcome({
        result: {
          reassessed: false, created: false, executionId: null,
          revisesExecutionId: executionId.trim(), boundaryId: boundaryId.trim(),
          state: null, binding: null, delta: null, refusal: null, refusalDetail: null,
          claimBoundary: {
            observationOnly: true, constitutesProof: false,
            constitutesRevenue: false, createsRecoveryCase: false,
          },
        },
        revision: null,
        problem: uncertainResponseGuidance(e instanceof Error ? e.message : String(e)),
        retryable: true,
      });
    } finally {
      // Released whatever happened. A retryable outcome leaves `settledRef` false, so the retry below
      // is permitted; a refusal or a settled revision has already set it, so nothing else can submit.
      inFlightRef.current = false;
      setInFlight(false);
    }
  }

  return (
    <div>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Re-assess a retained dataset</h2>
        <p className="mt-1 text-[13px] text-slate-400">
          Score an already-admitted dataset again under a newly approved calculation method, with no
          file re-supplied. The earlier result is kept: a re-assessment creates a <strong>new, linked</strong>{" "}
          execution and leaves the previous one exactly as it was.
        </p>
        <p
          aria-label="Claim boundary"
          className="mt-3 rounded-lg border border-ink-600/50 bg-ink-800/40 px-4 py-3 text-[13px] text-slate-300"
        >
          How to read everything on this screen: both results are a <strong>pilot assessment</strong> — a
          Revenue Opportunity observation of what the data showed. Neither is proof of recovered revenue,
          neither is Revenue Returned, and a re-assessment does not make the earlier figure wrong or the
          newer one proven. No recovery case is created here.
        </p>
      </header>

      {/* ── Which execution ───────────────────────────────────────────────────────────────────────── */}
      <Panel className="mb-4 p-5">
        <div className="mb-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
              Re-assessment tenant
            </span>
            <input
              className="num-input w-full"
              value={boundaryId}
              onChange={(e) => setBoundaryId(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
              Execution to re-assess
            </span>
            <input
              className="num-input w-full"
              value={executionId}
              onChange={(e) => setExecutionId(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || boundaryId.trim() === "" || executionId.trim() === ""}
          className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-200 hover:bg-ink-700/50 disabled:opacity-40"
        >
          {loading ? "Reading…" : "Load this execution"}
        </button>
        {loadError && (
          <p aria-label="Execution read error" className="mt-3 text-[13px] text-detect-500">
            {loadError}
          </p>
        )}
      </Panel>

      {previous && (
        <>
          {/* ── The result being revised ──────────────────────────────────────────────────────────── */}
          <section aria-label="Previous result" className="mb-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">The result being re-assessed</span>
              <ExecutionStatePill state={previous.state} />
              <Pill tone="neutral">
                method {previous.binding.assessmentPolicy.calculationMethodVersion}
              </Pill>
              <Pill tone="neutral">
                terms {previous.binding.assessmentPolicy.policyId}@{previous.binding.assessmentPolicy.policyVersion}
              </Pill>
            </div>
            <p className="mb-2 text-[12px] text-slate-500">
              This execution and its finding are never written to. Whatever happens below, they stay
              readable at their own identifiers, under the method they were computed with.
            </p>
            <AssessmentExecutionPanel execution={previous} />
          </section>

          {/* ── The definitions this boundary may cite ────────────────────────────────────────────── */}
          <Panel className="mb-4 p-5">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
              Governed definitions — approved by someone other than whoever benefits from the figure
            </div>
            <p className="mb-3 text-[12px] text-slate-400">
              A re-assessment may change <strong>only how</strong> the data is read. A definition that moves
              the cut-off, the stall threshold or the currency changes <strong>what</strong> is measured, and the
              admission decision does not cover that reading — those are listed, and listed as refusable,
              rather than hidden.
            </p>
            {options.length === 0 && (
              <p className="text-[13px] text-slate-400">
                This tenant holds no governed definitions. One must be proposed and activated — by two
                different identities — before anything can be re-assessed.
              </p>
            )}
            <ul aria-label="Governed definitions for re-assessment" className="space-y-2">
              {options.map((option) => {
                const row = option.row;
                const eligible = option.ineligible === null;
                return (
                  <li
                    key={row.termsRef}
                    className={`rounded-lg border px-3 py-2 ${
                      eligible ? "border-ink-500/50" : "border-ink-600/40 opacity-70"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="revision-terms"
                        className="mt-1"
                        value={row.termsRef}
                        checked={selectedTermsRef === row.termsRef}
                        disabled={!eligible || attempt !== null}
                        onChange={() => setSelectedTermsRef(row.termsRef)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] text-slate-200">{row.termsRef}</span>
                          <Pill tone={eligible ? "proof" : "neutral"}>{row.state ?? "unapproved"}</Pill>
                          <Pill tone="neutral">method {row.calculationMethodVersion}</Pill>
                        </span>
                        <span className="mt-1 block text-[12px] text-slate-400">
                          as of {row.asOf} · stall {row.stallThresholdDays} days · {row.currency}
                        </span>
                        {option.ineligible && (
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-amber-200">
                            <Pill tone="detect">{option.ineligible.code}</Pill>
                            {option.ineligible.detail}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* ── Why ──────────────────────────────────────────────────────────────────────────────── */}
          <Panel className="mb-4 p-5">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                Reason for this re-assessment
              </span>
              <textarea
                className="num-input w-full"
                rows={2}
                value={attempt ? attempt.reason : reason}
                readOnly={attempt !== null}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="mt-1 text-[12px] text-slate-500">
              Required, and stored on the revision. It is the one part of the record no computation can
              produce — the difference between the two figures is derived, but why anyone asked for the
              second one is not.
            </p>
            {attempt !== null && (
              <p className="mt-2 text-[12px] text-slate-400">
                Locked for this attempt. The server identifies a re-assessment by what it measures, so a
                retry with different wording would be answered with the execution already recorded — and
                this screen would then show a sentence the record does not hold.{" "}
                <button
                  type="button"
                  onClick={() => {
                    settledRef.current = false;
                    setAttempt(null);
                    setOutcome(null);
                  }}
                  className="underline hover:text-slate-200"
                >
                  Start over
                </button>{" "}
                to change it.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!gate.ok}
                className="rounded-lg bg-proof-600/20 px-4 py-2 text-sm font-medium text-proof-500 hover:bg-proof-600/30 disabled:opacity-40"
              >
                {inFlight ? "Submitting…" : "Re-assess under this definition"}
              </button>
              {!gate.ok && (
                <span aria-label="Submit blocked reason" className="text-[12px] text-slate-500">
                  {gate.reason}
                </span>
              )}
            </div>
          </Panel>
        </>
      )}

      {/* ── The answer ───────────────────────────────────────────────────────────────────────────── */}
      {outcome && (
        <ReassessmentOutcome
          outcome={outcome}
          previous={previous}
          onRetry={outcome.retryable ? () => void submit() : undefined}
          retrying={inFlight}
        />
      )}
    </div>
  );
}

function ReassessmentOutcome({
  outcome,
  previous,
  onRetry,
  retrying,
}: {
  outcome: Outcome;
  previous: AssessmentExecutionView | null;
  onRetry?: () => void;
  retrying: boolean;
}) {
  const { result, revision, problem } = outcome;

  // A REFUSAL, stated in full. The code, what it means, what the server saw, and what to do instead —
  // because "re-assessment refused" with no remedy sends an operator back to re-uploading a file they
  // never needed to re-upload.
  if (result.refusal) {
    return (
      // Wrapped in a labelled section rather than labelling the Panel: `Panel` accepts only children
      // and a className, so an aria-label handed to it is silently dropped — which is how this region
      // came to be unfindable while looking, in the source, as though it had a name.
      <section aria-label="Re-assessment refusal">
        <Panel className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pill tone="detect">{result.refusal.code}</Pill>
          <span className="text-sm text-slate-200">{result.refusal.title}</span>
        </div>
        {result.refusalDetail && <p className="text-[13px] text-slate-300">{result.refusalDetail}</p>}
        <p className="mt-2 text-[12px] text-slate-400">{result.refusal.remediation}</p>
          <p className="mt-3 text-[12px] text-slate-500">
            Nothing was created and nothing was changed. The earlier result is untouched and still
            readable at its own identifier.
          </p>
        </Panel>
      </section>
    );
  }

  if (problem !== null) {
    return (
      <section aria-label="Re-assessment problem">
        <Panel className="p-5">
        <div className="text-sm text-detect-500">No result is shown, because none was confirmed.</div>
        <p className="mt-1 text-[13px] text-slate-300">{problem}</p>
        {result.executionId && (
          <p className="mt-2 text-[12px] text-slate-400">
            The revision was created as{" "}
            <span className="font-mono">{truncateRef(result.executionId.replace(/^PAX-/, ""))}</span> and
            may still be running. This screen stopped waiting; it cancelled nothing.
          </p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-3 rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-200 hover:bg-ink-700/50 disabled:opacity-40"
          >
            {retrying ? "Retrying…" : "Retry the same request"}
          </button>
        )}
        </Panel>
      </section>
    );
  }

  return (
    <section aria-label="Revision result">
      <Panel className="mb-4 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">The revision</span>
          {/* Named, because `AssessmentExecutionPanel` below renders its own state pill: an unscoped
              search for the completion sentence resolves two elements, and a harness that swallowed
              the resulting strict-mode error read a finished revision as one that never finished. */}
          <span aria-label="Revision state">
            <ExecutionStatePill state={revision?.state ?? result.state} />
          </span>
          {result.created ? (
            <Pill tone="proof">created</Pill>
          ) : (
            <Pill tone="neutral">already existed — nothing new was written</Pill>
          )}
          <Pill tone="neutral">observation only — not proof, not revenue</Pill>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
          <Field
            label="New execution"
            value={result.executionId ? truncateRef(result.executionId.replace(/^PAX-/, "")) : "—"}
          />
          <Field label="Revises" value={truncateRef(result.revisesExecutionId.replace(/^PAX-/, ""))} />
        </dl>

        {/* WHAT CHANGED, derived from the two bindings rather than narrated. */}
        <div aria-label="Revision delta" className="mt-4">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            What changed — derived from the two bindings, field by field
          </div>
          <ul className="space-y-1">
            {(revision?.revises?.delta ?? result.delta)?.changed.map((c) => (
              <li key={c.field} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-slate-400">{c.field}</span>
                <span className="font-mono text-slate-500">{c.before}</span>
                <span className="text-slate-500">→</span>
                <span className="font-mono text-slate-200">{c.after}</span>
              </li>
            ))}
          </ul>
          {((revision?.revises?.delta ?? result.delta)?.unexpectedChanges.length ?? 0) > 0 && (
            <p className="mt-2 text-[12px] text-detect-500">
              This revision reports changes it should not be able to make. Do not act on either figure
              until it has been investigated.
            </p>
          )}
          {revision?.revises && (
            <p className="mt-2 text-[12px] text-slate-400">
              Stated reason: {revision.revises.reason}
            </p>
          )}
        </div>
      </Panel>

      {revision && <AssessmentExecutionPanel execution={revision} />}

      {/* BOTH, side by side. The claim that makes this a revision rather than a replacement, shown
          rather than asserted — and reported from the server's own `previousFindingExists`. */}
      {revision?.finding && previous?.finding && (
        <section aria-label="Both results">
        <Panel className="mt-4 p-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
            Both observations — the earlier one is preserved, not replaced
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Observation
              title={`Earlier · ${previous.binding.assessmentPolicy.calculationMethodVersion}`}
              finding={previous.finding.finding}
            />
            <Observation
              title={`Revision · ${revision.binding.assessmentPolicy.calculationMethodVersion}`}
              finding={revision.finding.finding}
            />
          </div>
          <p className="mt-3 text-[12px] text-slate-500">
            {revision.revises?.previousFindingExists
              ? "The earlier finding is still stored and still reproducible from its own records."
              : "The earlier finding could not be confirmed as still stored — investigate before acting on either figure."}{" "}
            Neither figure is proof of recovered revenue; both are pilot observations of what the data
            showed, under the method each names.
          </p>
        </Panel>
        </section>
      )}
    </section>
  );
}

function Observation({
  title,
  finding,
}: {
  title: string;
  finding: NonNullable<AssessmentExecutionView["finding"]>["finding"];
}) {
  return (
    <div className="rounded-lg border border-ink-500/40 px-3 py-2">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{title}</div>
      <div className="font-mono text-[11px] text-slate-500">{finding.assessmentId}</div>
      <dl className="mt-2 space-y-1 text-[12px]">
        <Line label="Cycles assessed" value={String(finding.acceptedCycleCount)} />
        <Line label="Stalled" value={String(finding.stalledCount)} />
        <Line
          label="Observed unpaid"
          value={formatMoney({ minor: finding.observedUnpaidMinor, currency: finding.currency }, { exact: true })}
        />
      </dl>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-500/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-mono text-[12px] text-slate-200">{value}</dd>
    </div>
  );
}
