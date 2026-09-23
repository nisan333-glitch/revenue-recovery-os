// Revenue Opportunity Assessment — thin-slice container. Session-only React state (nothing is
// persisted; refreshing clears it). It does NOT use the Recovery/Proof state — it is fully isolated.
import { useState } from "react";
import type { AssessmentResult, ColumnMapping } from "../../assessment/types";
import type { DateLocale } from "../../assessment/dateNormalize";
import type { AmountFormat } from "../../assessment/amountNormalize";
import { runAssessment } from "./runAssessment";
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

type Step = "upload" | "mapping" | "quality" | "readiness" | "observed";

export function Assessment() {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [n, setN] = useState(30);
  const [asOf, setAsOf] = useState("2026-03-01");
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState<DateLocale | "">("");
  const [amountFormat, setAmountFormat] = useState<AmountFormat | "">("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
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

  async function changeN(newN: number): Promise<void> {
    setN(newN);
    if (csvText) await run(csvText, newN, mapping ?? undefined); // reuse the same mapping; failures surface via `error`
  }

  return (
    <div>
      {step === "upload" && (
        <UploadScreen
          n={n}
          setN={setN}
          asOf={asOf}
          setAsOf={setAsOf}
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
          onChangeN={(newN) => void changeN(newN)}
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
        <ObservedResultsScreen result={result} onBack={() => setStep("readiness")} />
      )}
    </div>
  );
}
