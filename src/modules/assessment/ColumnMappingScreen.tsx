// Guided column mapping — shown when auto-detection could not match every REQUIRED column exactly, or
// matched one only by a synonym guess (real Stripe/Chargebee/NetSuite/Salesforce exports rarely use
// our canonical names). The operator confirms/corrects the source column for each required field; the
// completed mapping is stamped into the result for reproducibility. Client-side; nothing is uploaded.
import { useState } from "react";
import type { ColumnMapping } from "../../assessment/types";
import { SectionHeader, Panel } from "../../components/ui";

export interface ColumnMappingScreenProps {
  headers: string[]; // the file's own source headers
  detected: ColumnMapping; // canonical → source already auto-detected (a starting guess)
  requiredFields: string[]; // all required canonicals — each must resolve to a source column
  unmatchedRequired: string[]; // required canonicals with no guess (highlighted as needing a choice)
  error: string | null;
  onConfirm: (choices: Record<string, string>) => void;
  onBack: () => void;
}

const REQUIRED_LABEL: Record<string, string> = {
  entity_id: "Account / customer id",
  signed_at: "Signed date",
  next_invoice_due_at: "Next invoice due date",
  next_invoice_amount: "Next invoice amount",
  currency: "Currency",
};

export function ColumnMappingScreen({
  headers,
  detected,
  requiredFields,
  unmatchedRequired,
  error,
  onConfirm,
  onBack,
}: ColumnMappingScreenProps) {
  // Pre-fill each required field with its auto-detected source (may be a guess the operator can change).
  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of requiredFields) init[f] = detected[f] ?? "";
    return init;
  });
  const allChosen = requiredFields.every((f) => (choices[f] ?? "") !== "");

  return (
    <div>
      <SectionHeader
        title="Confirm your columns"
        subtitle="Point each required field at the right column from your file. We pre-filled our best guesses — please check them. Nothing is uploaded."
        right={
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">← Upload</button>
            <button
              onClick={() => onConfirm(choices)}
              disabled={!allChosen}
              className="rounded-lg border border-proof-600/40 bg-proof-600/10 px-3 py-1.5 text-sm text-proof-500 hover:bg-proof-600/20 disabled:opacity-40"
            >
              Run assessment →
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <Panel className="p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">Required columns</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {requiredFields.map((field) => {
            const needsChoice = unmatchedRequired.includes(field);
            return (
              <label key={field} className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                  {REQUIRED_LABEL[field] ?? field} <span className="text-slate-600">({field})</span>
                  {needsChoice && <span className="ml-1 text-red-400">— not found, choose one</span>}
                </span>
                <select
                  className="num-input w-full"
                  value={choices[field] ?? ""}
                  onChange={(e) => setChoices((c) => ({ ...c, [field]: e.target.value }))}
                >
                  <option value="">— choose a column —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          The exact mapping is recorded with the result, so the assessment is reproducible under the
          column interpretation you confirm here.
        </p>
      </Panel>
    </div>
  );
}
