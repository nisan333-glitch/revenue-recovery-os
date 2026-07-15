// Revenue Opportunity Assessment — thin-slice container. Session-only React state (nothing is
// persisted; refreshing clears it). It does NOT use the Recovery/Proof state — it is fully isolated.
import { useState } from "react";
import type { AssessmentResult } from "../../assessment/types";
import { assessCsv } from "../../assessment/assess";
import { makePolicy } from "../../assessment/policy";
import type { DateLocale } from "../../assessment/dateNormalize";
import { UploadScreen } from "./UploadScreen";
import { DataQualityCohortScreen } from "./DataQualityCohortScreen";
import { ObservedResultsScreen } from "./ObservedResultsScreen";

type Step = "upload" | "quality" | "observed";

export function Assessment() {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [n, setN] = useState(30);
  const [asOf, setAsOf] = useState("2026-03-01");
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState<DateLocale | "">("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("upload");

  async function run(text: string, useN = n): Promise<void> {
    setError(null);
    try {
      const policy = makePolicy({ stallThresholdDays: useN, asOf, currency });
      const r = await assessCsv(text, policy, { createdAt: new Date().toISOString(), locale: locale || undefined });
      setCsvText(text);
      setResult(r);
      setStep("quality");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeN(newN: number): Promise<void> {
    setN(newN);
    if (csvText) await run(csvText, newN); // run() surfaces any failure via `error`, shown on the cohort screen
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
          onFile={(text) => void run(text)}
          onReject={(msg) => setError(msg)}
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
