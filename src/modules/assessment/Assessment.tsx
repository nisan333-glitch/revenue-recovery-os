// Revenue Opportunity Assessment — thin-slice container. Session-only React state (nothing is
// persisted; refreshing clears it). It does NOT use the Recovery/Proof state — it is fully isolated.
import { useEffect, useState } from "react";
import type { AssessmentResult, ColumnMapping } from "../../assessment/types";
import type { DateLocale } from "../../assessment/dateNormalize";
import type { AmountFormat } from "../../assessment/amountNormalize";
import { runAssessment } from "./runAssessment";
import {
  listGovernedAnalysisTerms,
  type GovernedAnalysisTermsRow,
} from "../../data/pilotAnalysisTermsClient";
import { planColumnMapping, type MappingPlan } from "../../assessment/assess";
import { UploadScreen } from "./UploadScreen";
import { ColumnMappingScreen } from "./ColumnMappingScreen";
import { DataQualityCohortScreen } from "./DataQualityCohortScreen";
import { ObservedResultsScreen } from "./ObservedResultsScreen";
import { PilotReadinessScreen } from "./PilotReadinessScreen";
import { EMPTY_PILOT_DECLARATIONS, type PilotDeclarations } from "../../assessment/intakeKit";
import type { DatasetProvenance } from "../../contract/pilotDataContract";
import type { PilotIntakeResult } from "../../data/pilotIntakeClient";
import { gateUpload } from "./intakeGate";
import { operatorActorFor } from "../../data/devActor";
import {
  readPilotAssessment,
  schedulePilotAssessment,
  type AssessmentExecutionView,
} from "../../data/pilotAssessmentClient";
import { pollUntilSettled, timeoutMessage } from "./executionPolling";
import { AssessmentExecutionPanel } from "./AssessmentExecutionPanel";

/**
 * Empty, not pre-filled. Provenance is a customer ASSERTION about where the data came from; a
 * default would be the system inventing that claim on their behalf. The contract rejects an
 * incomplete declaration (NH-DC-1008), which is the correct outcome for "nobody said".
 */
const EMPTY_PROVENANCE: DatasetProvenance = {
  sourceSystems: { contract: "", billing: "", product: "" },
  dataOwnerRole: "",
  extractionMethod: "",
  extractedAt: "",
  coverageStart: "",
  coverageEnd: "",
  assertedIndependentOfBeneficiary: false,
};

// EP-19 · "observed" is the browser's LOCAL PREVIEW of the dataset. "execution" is the governed server
// run, and it is the only step that shows an authoritative figure.
type Step = "upload" | "mapping" | "quality" | "readiness" | "observed" | "execution";

export function Assessment() {
  const [csvText, setCsvText] = useState<string | null>(null);
  // EP-26 · N and the cut-off are no longer state this screen owns. They are read from the GOVERNED
  // analysis-terms version the operator cites, so the values below are derived, never typed. The
  // defaults that used to live here — N = 30, asOf = 2026-03-01 — were a definition nobody decided.
  const [governedTerms, setGovernedTerms] = useState<readonly GovernedAnalysisTermsRow[]>([]);
  const [analysisTermsRef, setAnalysisTermsRef] = useState("");
  const [termsError, setTermsError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState<DateLocale | "">("");
  const [amountFormat, setAmountFormat] = useState<AmountFormat | "">("");
  // EP-26 · Kept as a write-only record of which mapping produced the current preview. Its one
  // reader was the removed "re-run with N" path; the mapping a governed execution used comes from
  // the server's binding, not from here.
  const [, setMapping] = useState<ColumnMapping | null>(null);
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [plan, setPlan] = useState<MappingPlan | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [declarations, setDeclarations] = useState<PilotDeclarations>(EMPTY_PILOT_DECLARATIONS);
  const [boundaryId, setBoundaryId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [provenance, setProvenance] = useState<DatasetProvenance>(EMPTY_PROVENANCE);
  const [validation, setValidation] = useState<PilotIntakeResult | null>(null);
  const [validationPreliminary, setValidationPreliminary] = useState(false);
  const [validating, setValidating] = useState(false);
  // EP-19 · Which activated bar this dataset is to be judged against. Absent is NOT "skip the check":
  // the server returns NOT_ASSESSABLE, and the gate blocks. There is no configuration in which a
  // dataset is admitted without an explicit, governance-activated policy.
  const [admissionPolicyId, setAdmissionPolicyId] = useState("");
  const [admissionPolicyVersion, setAdmissionPolicyVersion] = useState("1.0.0");
  const [execution, setExecution] = useState<AssessmentExecutionView | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const selectedTerms = governedTerms.find((t) => t.termsRef === analysisTermsRef) ?? null;
  // Fail-closed for the LOCAL PREVIEW too: with no governed definition selected there is no cut-off to
  // preview against, so the preview uses values that cannot be mistaken for a reading — and the server
  // refuses the submission regardless.
  const n = selectedTerms?.stallThresholdDays ?? 0;
  const asOf = selectedTerms?.asOf ?? "";

  // The MENU of definitions governance has approved for this boundary. Reading it is not choosing:
  // every row was activated by someone else, and a row that is not ACTIVE arrives marked as such.
  useEffect(() => {
    const boundary = boundaryId.trim();
    if (!boundary) {
      setGovernedTerms([]);
      setAnalysisTermsRef("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listGovernedAnalysisTerms(boundary, operatorActorFor(null));
        if (cancelled) return;
        setTermsError(null);
        setGovernedTerms(list.terms);
        // Never auto-select: a pre-filled definition is a definition chosen by the code, and the
        // operator must be seen to cite one. An empty list leaves the selection empty and blocks.
        setAnalysisTermsRef((current) => (list.terms.some((t) => t.termsRef === current) ? current : ""));
      } catch (e) {
        if (cancelled) return;
        setGovernedTerms([]);
        setAnalysisTermsRef("");
        setTermsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boundaryId]);

  async function run(text: string, useN: number, useMapping: ColumnMapping | undefined): Promise<void> {
    setError(null);
    const outcome = await runAssessment(text, {
      n: useN,
      asOf,
      currency,
      locale: locale || undefined,
      amountFormat: amountFormat || undefined,
      mapping: useMapping,
    });
    if (outcome.ok) {
      setCsvText(text);
      setMapping(useMapping ?? null);
      setResult(outcome.result);
      // Intake declarations belong to one exact assessment. A new file, mapping or policy result
      // must be confirmed again; carrying old confirmations forward would create false readiness.
      setDeclarations(EMPTY_PILOT_DECLARATIONS);
      setStep("quality");
    } else {
      // Keep the prior result visible but surface the error (never a silent stale re-run).
      setError(outcome.error);
    }
  }

  /**
   * Hand the admitted dataset to the governed server execution, then wait for the server's own answer.
   *
   * This is the only path to an authoritative figure. The browser's `runAssessment` result stays
   * visible as a labelled local preview because it is genuinely useful for judging dataset shape — but
   * it is not an execution, it carries no binding, no policy hash and no audit lineage, and nothing on
   * this screen presents it as a result.
   *
   * A refusal is displayed with its NH-AX-#### code, not swallowed. A timeout is displayed as a
   * timeout — never as a result — because the alternative is a screen that shows a number the server
   * did not produce.
   */
  async function runGovernedExecution(text: string): Promise<void> {
    setExecutionError(null);
    setExecution(null);
    setScheduling(true);
    setStep("execution");
    try {
      const actor = operatorActorFor(null);
      const scheduled = await schedulePilotAssessment(
        {
          boundaryId,
          datasetId,
          csvText: text,
          provenance,
          currency,
          locale: locale || undefined,
          amountFormat: amountFormat || undefined,
          analysisTermsId: selectedTerms?.termsId,
          analysisTermsVersion: selectedTerms?.termsVersion,
        },
        actor,
      );
      if (!scheduled.scheduled || !scheduled.executionId) {
        const code = scheduled.refusal ? `${scheduled.refusal.code} — ${scheduled.refusal.title}` : "refused";
        setExecutionError(
          `${code}${scheduled.refusalDetail ? ` (${scheduled.refusalDetail})` : ""}` +
            (scheduled.refusal ? ` ${scheduled.refusal.remediation}` : ""),
        );
        return;
      }
      const executionId = scheduled.executionId;
      const outcome = await pollUntilSettled(() => readPilotAssessment(boundaryId, executionId, actor));
      if (outcome.kind === "settled") setExecution(outcome.view);
      else if (outcome.kind === "timeout") setExecutionError(timeoutMessage(outcome));
      else setExecutionError(outcome.message);
    } catch (e) {
      // Includes an unreachable server. There is deliberately no fallback to the local preview: a run
      // that could not be validated server-side is an error, never a pass.
      setExecutionError(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduling(false);
    }
  }

  /**
   * On file pick: the dataset must clear the SERVER's contract validation before anything else
   * happens. Column mapping, assessment and every later step are downstream of that verdict — a
   * dataset the server refuses never reaches them, which is requirement 12 in one place rather
   * than a check repeated at each screen.
   */
  async function onFile(text: string): Promise<void> {
    setError(null);
    setValidation(null);
    setValidating(true);
    try {
      const outcome = await gateUpload(
        {
          boundaryId,
          datasetId,
          csvText: text,
          provenance,
          stallThresholdDays: n,
          asOf,
          currency,
          locale: locale || undefined,
          amountFormat: amountFormat || undefined,
          // EP-26 · Which governed definition the SERVER reads under. The two values above never leave
          // the browser: they drive the local preview only, and they came from this same definition.
          analysisTermsId: selectedTerms?.termsId,
          analysisTermsVersion: selectedTerms?.termsVersion,
          // Without this the server has no bar to judge against, returns NOT_ASSESSABLE, and the gate
          // blocks. Before EP-19 the UI never sent it, so the flow could not leave this screen at all.
          admissionPolicyId: admissionPolicyId.trim() || undefined,
          admissionPolicyVersion: admissionPolicyVersion.trim() || undefined,
        },
        operatorActorFor(null),
      );

      if (outcome.kind === "error") {
        setError(outcome.message);
        return;
      }
      setValidation(outcome.result);
      setValidationPreliminary(outcome.kind === "blocked" && outcome.preliminary);
      if (outcome.kind === "blocked") return; // findings are shown; no progression

      // Validated and usable: continue into mapping/assessment exactly as before.
      let p: MappingPlan;
      try {
        p = planColumnMapping(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!p.needsReview) {
        await run(text, n, p.mapping);
      } else {
        setPendingCsv(text);
        setPlan(p);
        setStep("mapping");
      }
    } finally {
      setValidating(false);
    }
  }

  function confirmMapping(choices: Record<string, string>): void {
    if (!pendingCsv || !plan) return;
    void run(pendingCsv, n, { ...plan.mapping, ...choices });
  }

  return (
    <div>
      {step === "upload" && (
        <UploadScreen
          n={n}
          governedTerms={governedTerms}
          analysisTermsRef={analysisTermsRef}
          setAnalysisTermsRef={setAnalysisTermsRef}
          termsError={termsError}
          asOf={asOf}
          currency={currency}
          setCurrency={setCurrency}
          locale={locale}
          setLocale={setLocale}
          amountFormat={amountFormat}
          setAmountFormat={setAmountFormat}
          error={error}
          onFile={(text) => void onFile(text)}
          boundaryId={boundaryId}
          setBoundaryId={setBoundaryId}
          datasetId={datasetId}
          setDatasetId={setDatasetId}
          provenance={provenance}
          setProvenance={setProvenance}
          validation={validation}
          validationPreliminary={validationPreliminary}
          validating={validating}
          onReject={(msg) => setError(msg)}
          admissionPolicyId={admissionPolicyId}
          setAdmissionPolicyId={setAdmissionPolicyId}
          admissionPolicyVersion={admissionPolicyVersion}
          setAdmissionPolicyVersion={setAdmissionPolicyVersion}
        />
      )}
      {step === "mapping" && plan && (
        <ColumnMappingScreen
          headers={plan.headers}
          detected={plan.mapping}
          requiredFields={plan.requiredFields}
          unmatchedRequired={plan.unmatchedRequired}
          error={error}
          onConfirm={confirmMapping}
          onBack={() => setStep("upload")}
        />
      )}
      {step === "quality" && result && (
        <DataQualityCohortScreen
          result={result}
          n={n}
          error={error}
          onBack={() => setStep("upload")}
          onNext={() => setStep("readiness")}
        />
      )}
      {step === "readiness" && result && (
        <PilotReadinessScreen
          result={result}
          declarations={declarations}
          onChangeDeclarations={setDeclarations}
          onBack={() => setStep("quality")}
          onNext={() => setStep("observed")}
        />
      )}
      {step === "observed" && result && (
        <ObservedResultsScreen
          result={result}
          onBack={() => setStep("readiness")}
          onRunGoverned={csvText ? () => void runGovernedExecution(csvText) : undefined}
          running={scheduling}
        />
      )}
      {step === "execution" && (
        <ExecutionStep
          execution={execution}
          error={executionError}
          running={scheduling}
          onBack={() => setStep("observed")}
        />
      )}
    </div>
  );
}

/**
 * The governed result, or an honest account of why there is none.
 *
 * Three states and no fourth: running, refused/failed-to-settle, or a finding. There is deliberately
 * no branch that falls back to the browser preview — the whole point of this step is that what it shows
 * came from the server.
 */
function ExecutionStep({
  execution,
  error,
  running,
  onBack,
}: {
  execution: AssessmentExecutionView | null;
  error: string | null;
  running: boolean;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-100">Governed assessment execution</div>
          <div className="text-[12px] text-slate-500">
            Scheduled on the server, run by a leased worker, bound to the admission decision that
            admitted this dataset. This is the authoritative figure — and it is still an observation,
            never Proof or Revenue Returned.
          </div>
        </div>
        <button
          onClick={onBack}
          className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50"
        >
          ← Local preview
        </button>
      </div>

      {running && !execution && !error && (
        <div className="rounded-xl border border-ink-500/40 bg-ink-800/60 p-5 text-sm text-slate-300">
          Waiting for a worker to claim and finish the execution…
          <div className="mt-1 text-[12px] text-slate-500">
            Nothing is shown until the server records a result. If this screen stops waiting it will say
            so — it will not show a figure the server did not produce.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-detect-600/40 bg-ink-800/60 p-5">
          <div className="text-sm text-detect-500">The execution did not produce a result.</div>
          <p className="mt-1 text-[13px] text-slate-300">{error}</p>
          <p className="mt-2 text-[12px] text-slate-500">
            No figure is shown, because none was produced. The local preview on the previous screen is
            still a preview and is not a substitute for this.
          </p>
        </div>
      )}

      {execution && <AssessmentExecutionPanel execution={execution} />}
    </div>
  );
}
