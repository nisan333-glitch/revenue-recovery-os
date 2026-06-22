// Event detail drawer — the workflow surface: assign, act, classify, prove.
import { useState } from "react";
import type { RecoveryEvent, RecoveryStatus } from "../domain/types";
import { OWNERS, useRecovery } from "../state/RecoveryContext";
import { RECOVERY_REASONS } from "../domain/reasons";
import { isAuditable, isCounted } from "../domain/invariants";
import { explainConfidence } from "../domain/confidence";
import { money } from "../lib/format";
import {
  ConfidenceBadge,
  MoneyDelta,
  Pill,
  StatusBadge,
} from "./ui";
import { dateTime } from "../lib/format";

const STATUS_FLOW: RecoveryStatus[] = [
  "Detected",
  "Queued",
  "Assigned",
  "InProgress",
  "Recovered",
  "Failed",
  "Dismissed",
];

export function EventDetail({
  event,
  onClose,
}: {
  event: RecoveryEvent;
  onClose: () => void;
}) {
  const {
    assignOwner,
    advanceStatus,
    addAction,
    setReason,
    updateAmounts,
    updateEvidence,
  } = useRecovery();
  const [action, setAction] = useState("");
  const [collected, setCollected] = useState(String(event.collectedAmount));
  const [baseline, setBaseline] = useState(String(event.baselineAmount));
  const [evidence, setEvidence] = useState(event.evidenceNotes);

  const counted = isCounted(event);
  const auditable = isAuditable(event);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-ink-500/50 bg-ink-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="font-mono text-xs text-slate-500">{event.eventId}</div>
            <h3 className="text-xl font-semibold text-slate-100">{event.customer}</h3>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={event.status} />
              <ConfidenceBadge value={event.confidence} />
              <Pill>{event.funnelStage}</Pill>
              <Pill tone="detect">{event.leakageType}</Pill>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            ✕
          </button>
        </div>

        {/* Proof status banner */}
        <div
          className={`mb-5 rounded-lg border px-3 py-2 text-sm ${
            auditable
              ? "border-proof-600/40 bg-proof-600/10 text-proof-500"
              : counted
                ? "border-detect-600/40 bg-detect-600/10 text-detect-500"
                : "border-ink-500/40 bg-ink-800/60 text-slate-400"
          }`}
        >
          {auditable
            ? "✓ CFO-auditable: counted in proven recovered revenue."
            : counted
              ? "Counted, but below proof-grade confidence — excluded from CFO total."
              : event.recoveryReason === null
                ? "Not counted: no recovery reason classified."
                : "Open opportunity — not yet recovered."}
        </div>

        {/* The equation */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Field label="Baseline">
            <input
              className="num-input"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              onBlur={() => updateAmounts(event.eventId, { baselineAmount: Number(baseline) || 0 })}
            />
          </Field>
          <Field label="Collected">
            <input
              className="num-input"
              value={collected}
              onChange={(e) => setCollected(e.target.value)}
              onBlur={() => updateAmounts(event.eventId, { collectedAmount: Number(collected) || 0 })}
            />
          </Field>
          <Field label="Revenue Returned">
            <div className="pt-2">
              <MoneyDelta value={event.revenueReturned} />
            </div>
          </Field>
        </div>
        <p className="mb-5 text-[11px] text-slate-500">
          Revenue Returned is always computed as Collected − Baseline. Detected risk
          on this event: {money(event.riskAmount)}.
        </p>

        {/* Owner + status */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Field label="Owner">
            <select
              className="num-input"
              value={event.owner ?? ""}
              onChange={(e) => assignOwner(event.eventId, e.target.value)}
            >
              <option value="" disabled>
                Assign owner…
              </option>
              {OWNERS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="num-input"
              value={event.status}
              onChange={(e) => advanceStatus(event.eventId, e.target.value as RecoveryStatus)}
            >
              {STATUS_FLOW.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Recovery reason */}
        <Field label="Recovery Reason (required to count)">
          <select
            className="num-input"
            value={event.recoveryReason ?? ""}
            onChange={(e) =>
              setReason(event.eventId, (e.target.value || null) as RecoveryEvent["recoveryReason"])
            }
          >
            <option value="">— unclassified —</option>
            {RECOVERY_REASONS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Actions */}
        <div className="mt-5">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Actions taken
          </div>
          <ul className="mb-2 space-y-1">
            {event.actionsTaken.length === 0 && (
              <li className="text-sm text-slate-500">No actions recorded.</li>
            )}
            {event.actionsTaken.map((a, i) => (
              <li key={i} className="rounded bg-ink-800/60 px-2 py-1 text-sm text-slate-300">
                • {a}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              className="num-input flex-1"
              placeholder="Record an action…"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && action.trim()) {
                  addAction(event.eventId, action.trim());
                  setAction("");
                }
              }}
            />
            <button
              className="rounded bg-ink-600 px-3 text-sm text-slate-200 hover:bg-ink-500"
              onClick={() => {
                if (action.trim()) {
                  addAction(event.eventId, action.trim());
                  setAction("");
                }
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Evidence */}
        <div className="mt-5">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Evidence notes
          </div>
          <textarea
            className="num-input h-20 w-full resize-none"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            onBlur={() => updateEvidence(event.eventId, evidence)}
          />
        </div>

        {/* Confidence breakdown */}
        <div className="mt-5">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Confidence breakdown ({event.confidence}/100)
          </div>
          <div className="space-y-1">
            {explainConfidence(event).map((f) => (
              <div key={f.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{f.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">{f.detail}</span>
                  <span className={`tabular-nums ${f.delta > 0 ? "text-proof-500" : "text-slate-600"}`}>
                    +{f.delta}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Audit trail */}
        <div className="mt-5">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Audit trail (append-only)
          </div>
          <ol className="space-y-1">
            {event.audit.map((a) => (
              <li key={a.id} className="flex gap-2 text-sm">
                <span className="w-28 shrink-0 text-[11px] text-slate-500">
                  {dateTime(a.at)}
                </span>
                <span className="text-slate-300">{a.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
