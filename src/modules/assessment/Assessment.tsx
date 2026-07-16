// Revenue Opportunity Assessment — thin-slice container. Session-only React state (nothing is
// persisted; refreshing clears it). It does NOT use the Recovery/Proof state — it is fully isolated.
import { useState } from "react";
import type { AssessmentResult, ColumnMapping } from "../../assessment/types";
import type { DateLocale } from "../../assessment/dateNormalize";
import { runAssessment } from "./runAssessment";
import { planColumnMapping, type MappingPlan } from "../../assessment/assess";
import { UploadScreen } from "./UploadScreen";
import { ColumnMappingScreen } from "./ColumnMappingScreen";
import { DataQualityCohortScreen } from "./DataQualityCohortScreen";
import { ObservedResultsScreen } from "./ObservedResultsScreen";

type Step = "upload" | "mapping" | "quality" | "observed";

export function Assessment() {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [n, setN] = useState(30);
  const [asOf, setAsOf] = useState("2026-03-01");
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState<DateLocale | "">("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pendingCsv, setPendingCsv] = useState<string | null>(null);
  const [plan, setPlan] = useState<MappingPlan | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");

  async function run(text: string, useN: number, useMapping: ColumnMapping | undefined): Promise<void> {
    setError(null);
    const outcome = await runAssessment(text, { n: useN, asOf, currency, locale: locale || undefined, mapping: useMapping });
    if (outcome.ok) {
      setCsvText(text);
      setMapping(useMapping ?? null);
      setResult(outcome.result);
      setStep("quality");
    } else {
      // Keep the prior result visible but surface the error (never a silent stale re-run).
      setError(outcome.error);
    }
  }

  // On file pick: auto-detect the column mapping. If every required column matched, run straight
  // through; otherwise route to the guided mapping step so the operator can resolve the gaps.
  function onFile(text: string): void {
    setError(null);
    let p: MappingPlan;
    try {
      p = planColumnMapping(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!p.needsReview) {
      void run(text, n, p.mapping);
    } else {
      setPendingCsv(text);
      setPlan(p);
      setStep("mapping");
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
          error={error}
          onFile={onFile}
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
          onNext={() => setStep("observed")}
        />
      )}
      {step === "observed" && result && (
        <ObservedResultsScreen result={result} onBack={() => setStep("quality")} />
      )}
    </div>
  );
}
