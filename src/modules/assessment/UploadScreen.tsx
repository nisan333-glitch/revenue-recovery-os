import type { DatasetProvenance } from "../../contract/pilotDataContract";
import { PILOT_DATA_CONTRACT_VERSION, INTAKE_LIMITS } from "../../contract/pilotDataContract";
import type { PilotIntakeResult } from "../../data/pilotIntakeClient";
import { ValidationReportPanel } from "./ValidationReportPanel";
import type { DateLocale } from "../../assessment/dateNormalize";
import type { AmountFormat } from "../../assessment/amountNormalize";
import { SectionHeader, Panel, Pill } from "../../components/ui";
import { downloadDataRequestGuide, downloadTemplate } from "./exportSummary";

// The browser-side cap is now the CONTRACT's cap, not a second number that could drift from it.
// A file over this is refused here to save the customer an upload that the server would refuse
// anyway — the server still enforces it independently, because this check is assistance, not
// authority. Neither side truncates.
export const MAX_CSV_BYTES = INTAKE_LIMITS.maxBytes;

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
  /** Tenant boundary for the upload. Named here, AUTHORIZED server-side — never asserted by the file. */
  boundaryId: string;
  setBoundaryId: (v: string) => void;
  datasetId: string;
  setDatasetId: (v: string) => void;
  provenance: DatasetProvenance;
  setProvenance: (p: DatasetProvenance) => void;
  /** Latest validation verdict, if a file has been submitted. */
  validation: PilotIntakeResult | null;
  validationPreliminary: boolean;
  validating: boolean;
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
    // Read locally, then handed to the gate, which previews it and submits it for the server's
    // authoritative verdict. It IS uploaded — the comment that used to say otherwise was true only
    // while validation was purely client-side.
    props.onFile(await f.text());
  }

  return (
    <div>
      <SectionHeader
        title="Revenue Opportunity Assessment"
        subtitle="Size the revenue leaking in your historical data — from one CSV, validated against the pilot data contract."
      />

      <Panel className="mb-4 p-3 text-[12px] text-slate-400">
        <Pill tone="proof">governed</Pill> Your file is checked against the Customer Pilot Data
        Contract <span className="text-slate-300">on the server</span>, which is the authoritative
        validation; the browser previews the same rules first so you are not left waiting on a large
        upload. Rejected rows are reported back to you and{" "}
        <span className="text-slate-300">never stored</span>, and no value is corrected for you. This
        slice reports only <span className="text-slate-300">Observed</span> values — no forecast, no
        proven claims.
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

      <Panel className="mb-4 p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">2 · Pilot and data source</span>
          <Pill tone="proof">contract {PILOT_DATA_CONTRACT_VERSION}</Pill>
        </div>
        <p className="mb-3 text-[11px] text-slate-500">
          The pilot boundary is checked against your authenticated access on the server — naming one
          you are not entitled to is refused, and nothing in the file can change it.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-4">
          <Field label="Pilot boundary" value={props.boundaryId} onChange={props.setBoundaryId} />
          <Field label="Dataset label" value={props.datasetId} onChange={props.setDatasetId} />
        </div>
        <ProvenanceFields provenance={props.provenance} setProvenance={props.setProvenance} />
      </Panel>

      <Panel className="p-5">
        <div className="mb-3 text-sm font-semibold text-slate-200">3 · Upload your CSV</div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onPick} className="text-sm text-slate-300" />
          <button onClick={downloadTemplate}
            className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">
            Download template
          </button>
          <button onClick={downloadDataRequestGuide}
            className="rounded-lg border border-ink-500/50 px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700/50">
            Download data request
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          One row = one expectation cycle (subscription). Required: entity_id, signed_at,
          next_invoice_due_at, next_invoice_amount, currency. Optional: subscription_id, activation_at,
          next_invoice_paid_at, status.
        </p>
        {props.validating && (
          <div className="mt-3 text-[12px] text-slate-400">Validating against the data contract…</div>
        )}
        {props.error && <div className="mt-3 text-[12px] text-red-400">Error: {props.error}</div>}
      </Panel>

      {props.validation && (
        <ValidationReportPanel result={props.validation} preliminary={props.validationPreliminary} />
      )}
    </div>
  );
}

/**
 * Provenance is DECLARED BY THE CUSTOMER and recorded as an assertion. It is collected rather than
 * inferred on purpose: a default would be the system inventing a claim about where data came from,
 * which is precisely the kind of self-certification the trust model forbids.
 */
function ProvenanceFields(props: {
  provenance: DatasetProvenance;
  setProvenance: (p: DatasetProvenance) => void;
}) {
  const p = props.provenance;
  const set = (patch: Partial<DatasetProvenance>) => props.setProvenance({ ...p, ...patch });
  const setSystem = (key: "contract" | "billing" | "product", value: string) =>
    set({ sourceSystems: { ...p.sourceSystems, [key]: value } });

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <Field label="Contract system of record" value={p.sourceSystems.contract} onChange={(v) => setSystem("contract", v)} />
      <Field label="Billing system of record" value={p.sourceSystems.billing} onChange={(v) => setSystem("billing", v)} />
      <Field label="Product/telemetry source" value={p.sourceSystems.product} onChange={(v) => setSystem("product", v)} />
      <Field label="Data owner (role, not a person)" value={p.dataOwnerRole} onChange={(v) => set({ dataOwnerRole: v })} />
      <Field label="Extraction method" value={p.extractionMethod} onChange={(v) => set({ extractionMethod: v })} />
      <Field label="Extracted at (UTC)" value={p.extractedAt} onChange={(v) => set({ extractedAt: v })} />
      <Field label="Coverage start" value={p.coverageStart} onChange={(v) => set({ coverageStart: v })} type="date" />
      <Field label="Coverage end" value={p.coverageEnd} onChange={(v) => set({ coverageEnd: v })} type="date" />
      <label className="flex items-end gap-2 pb-1 text-[12px] text-slate-400">
        <input
          type="checkbox"
          checked={p.assertedIndependentOfBeneficiary}
          onChange={(e) => set({ assertedIndependentOfBeneficiary: e.target.checked })}
        />
        <span>
          Source is outside the beneficiary&rsquo;s control
          <span className="block text-[10px] text-slate-500">Recorded as an assertion — never as verification.</span>
        </span>
      </label>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{props.label}</span>
      <input
        type={props.type ?? "text"}
        className="num-input w-full"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}
