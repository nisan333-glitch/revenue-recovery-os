import type { DateLocale } from "../../assessment/dateNormalize";
import type { AmountFormat } from "../../assessment/amountNormalize";
import { SectionHeader, Panel, Pill } from "../../components/ui";
import { downloadTemplate } from "./exportSummary";

// v1 CSV size cap. Rationale: parsing + SHA-256 run synchronously on the main thread (no workers/
// streaming in this slice). 10 MB (~50k–100k rows) is generous for a historical export while keeping
// the UI responsive and bounding memory; larger files are rejected with a clear message.
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

export interface UploadScreenProps {
  n: number;
  setN: (n: number) => void;
  asOf: string;
  setAsOf: (d: string) => void;
  currency: string;
  setCurrency: (c: string) => void;
  locale: DateLocale | "";
  setLocale: (l: DateLocale | "") => void;
  amountFormat: AmountFormat | "";
  setAmountFormat: (f: AmountFormat | "") => void;
  error: string | null;
  onFile: (csvText: string) => void;
  onReject: (message: string) => void;
}

export function UploadScreen(props: UploadScreenProps) {
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) {
      props.onReject(
        `File too large: ${(f.size / 1048576).toFixed(1)} MB. The v1 limit is ${MAX_CSV_BYTES / 1048576} MB — split the file or reduce the date range.`,
      );
      e.target.value = ""; // allow re-selecting the same (or another) file
      return;
    }
    props.onFile(await f.text()); // client-side read; the file is never uploaded
  }

  return (
    <div>
      <SectionHeader
        title="Revenue Opportunity Assessment"
        subtitle="Size the revenue leaking in your historical data — from one CSV, entirely in your browser."
      />

      <Panel className="mb-4 p-3 text-[12px] text-slate-400">
        <Pill tone="proof">private</Pill> Runs entirely in your browser. Your file is read locally and
        <span className="text-slate-300"> never uploaded</span>. This slice reports only{" "}
        <span className="text-slate-300">Observed</span> values — no forecast, no proven claims.
      </Panel>

      <Panel className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">1 · Assessment policy</div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Stall threshold N (days)</span>
            <input type="number" min={0} className="num-input w-full" value={props.n}
              onChange={(e) => props.setN(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Analysis as-of date</span>
            <input type="date" className="num-input w-full" value={props.asOf} onChange={(e) => props.setAsOf(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Currency</span>
            <input className="num-input w-full" value={props.currency}
              onChange={(e) => props.setCurrency(e.target.value.toUpperCase())} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Ambiguous date locale</span>
            <select className="num-input w-full" value={props.locale} onChange={(e) => props.setLocale(e.target.value as DateLocale | "")}>
              <option value="">auto (reject ambiguous)</option>
              <option value="MDY">MDY (US)</option>
              <option value="DMY">DMY</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Amount format</span>
            <select className="num-input w-full" value={props.amountFormat} onChange={(e) => props.setAmountFormat(e.target.value as AmountFormat | "")}>
              <option value="">auto (reject ambiguous)</option>
              <option value="US">US (1,234.56)</option>
              <option value="EU">EU (1.234,56)</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">2 · Upload your CSV</div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onPick} className="text-sm text-slate-300" />
          <button onClick={downloadTemplate}
            className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">
            Download template
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          One row = one expectation cycle (subscription). Required: entity_id, signed_at,
          next_invoice_due_at, next_invoice_amount, currency. Optional: subscription_id, activation_at,
          next_invoice_paid_at, status.
        </p>
        {props.error && <div className="mt-3 text-[12px] text-red-400">Error: {props.error}</div>}
      </Panel>
    </div>
  );
}
