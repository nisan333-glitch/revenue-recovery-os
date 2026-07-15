// Event detail drawer — the workflow surface: assign, act, classify, prove.
import { useState } from "react";
import { OPEN_STATUSES } from "../domain/types";
import type { RecoveryEvent, RecoveryStatus } from "../domain/types";
import { OWNERS, useRecovery } from "../state/RecoveryContext";
import { RECOVERY_REASONS, reasonLabel } from "../domain/reasons";
import { recommend } from "../domain/recommendation";
import { explainConfidence } from "../domain/confidence";
import { formatMoney, fromDecimal } from "../domain/money";
import { effectiveProofs } from "../domain/proof";
import { proofIsAuditable } from "../domain/provenLedger";
import type { TrustClassification } from "../domain/evidence";
import { money, percent } from "../lib/format";
import {
  ConfidenceBadge,
  MoneyDelta,
  Pill,
  StatusBadge,
} from "./ui";
import { dateTime } from "../lib/format";

// Operator identity for governance actions recorded from this drawer (prototype).
const OPERATOR = "you@company";

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
    applyRecommendation,
    updateAmounts,
    updateEvidence,
    baselineOf,
    proofsOf,
  } = useRecovery();
  // Once a governed baseline is locked, the provisional baseline field is frozen too — the
  // beneficiary can no longer appear to "move the baseline" (Trust Invariant #2).
  const governedLocked = !!baselineOf(event.eventId)?.lockedAt;
  // Proof-based status (the truth the CFO view reads) — NOT the Case-level isAuditable heuristic.
  const effectiveProof = effectiveProofs(proofsOf(event.eventId))[0];
  const provenProof = effectiveProof && effectiveProof.status !== "Reversed" ? effectiveProof : undefined;
  const auditableProof = !!provenProof && proofIsAuditable(provenProof);
  const [action, setAction] = useState("");
  const [collected, setCollected] = useState(String(event.collectedAmount));
  const [baseline, setBaseline] = useState(String(event.baselineAmount));
  const [evidence, setEvidence] = useState(event.evidenceNotes);

  const isOpen = OPEN_STATUSES.includes(event.status);
  const rec = recommend(event);
  const recommendationApplied =
    event.recoveryReason === rec.recommendedReason &&
    rec.recommendedActions.every((a) => event.actionsTaken.includes(a));

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

        {/* Proof status banner — driven by the immutable Proof, not the Case-level heuristic */}
        <div
          className={`mb-5 rounded-lg border px-3 py-2 text-sm ${
            auditableProof
              ? "border-proof-600/40 bg-proof-600/10 text-proof-500"
              : provenProof
                ? "border-detect-600/40 bg-detect-600/10 text-detect-500"
                : "border-ink-500/40 bg-ink-800/60 text-slate-400"
          }`}
        >
          {auditableProof
            ? `✓ CFO-auditable: proof ${provenProof!.proofId} counted in Auditable Revenue.`
            : provenProof
              ? "Proven (in Revenue Returned) but below proof-grade — excluded from the CFO auditable total."
              : effectiveProof
                ? "Proof reversed — no longer counted."
                : event.recoveryReason === null
                  ? "Not counted: no recovery reason classified."
                  : event.status === "Recovered"
                    ? "Recovered — approve an immutable proof below to count it."
                    : "Open opportunity — not yet recovered."}
        </div>

        {/* Recommended play (Decision Engine) — forecast, not proof */}
        {isOpen && (
          <div className="mb-5 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-sky-300">
                Recommended play
              </span>
              <span className="text-[10px] text-sky-300/70" title="Decision Engine forecast — not proven recovery">
                forecast · not counted
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-300">{rec.rootCause}</p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Play</div>
                <div className="text-slate-200">{reasonLabel(rec.recommendedReason)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Win probability</div>
                <div className="text-slate-200">{percent(rec.probabilityOfSuccess)} · {rec.effort} effort</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Expected value</div>
                <div className="tabular-nums text-sky-400">{money(rec.expectedValue)}</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {money(rec.expectedImpact)} impact × {percent(rec.probabilityOfSuccess)} = {money(rec.expectedValue)} expected.
              Next steps: {rec.recommendedActions.join("; ")}.
            </div>
            <button
              className="mt-3 w-full rounded-md border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
              onClick={() => applyRecommendation(event.eventId)}
              disabled={recommendationApplied}
            >
              {recommendationApplied ? "✓ Recommendation applied" : "Apply recommendation"}
            </button>
          </div>
        )}

        {/* The equation */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Field label={governedLocked ? "Baseline (locked)" : "Baseline"}>
            <input
              className="num-input disabled:opacity-50"
              value={governedLocked ? String(baselineOf(event.eventId)!.calculatedAmount.minor / 100) : baseline}
              disabled={governedLocked}
              title={governedLocked ? "Governed baseline is locked — revise it in the Prove panel" : undefined}
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
          <p className="mt-1 text-[11px] text-slate-500">
            Notes are operator-entered (beneficiary-controlled). Auditable proof needs an
            independent evidence reference — add one below.
          </p>
        </div>

        {/* Prove — governed baseline, evidence, and the immutable approved proof */}
        <ProofGovernance event={event} />

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

// The "Prove" surface: establish + lock a governed baseline, attach evidence, and approve an
// IMMUTABLE proof through the real trust gate. Money is entered as decimals and converted at this
// single edge via money.fromDecimal — never coerced. Approval is blocked until every invariant
// passes (baseline locked before intervention, exclusion stated, independent evidence for
// auditable, approver distinct from owner).
function ProofGovernance({ event }: { event: RecoveryEvent }) {
  const {
    baselineOf,
    evidenceOf,
    proofsOf,
    establishBaseline,
    lockBaseline,
    reviseBaseline,
    addEvidence,
    approveProof,
    reverseProof,
    approvalBlockers,
  } = useRecovery();

  const currency = event.currency ?? "USD";
  const baseline = baselineOf(event.eventId);
  const evidence = evidenceOf(event.eventId);
  const proofs = proofsOf(event.eventId);

  const [baselineInput, setBaselineInput] = useState("");
  const [evType, setEvType] = useState("invoice_paid");
  const [evClass, setEvClass] = useState<TrustClassification>("independent");
  const [evRecordId, setEvRecordId] = useState("");
  const [collectedInput, setCollectedInput] = useState(String(event.collectedAmount));
  const [excludedInput, setExcludedInput] = useState("0");
  const [exclusion, setExclusion] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function toMinor(s: string): number | null {
    try {
      return fromDecimal(s.trim() === "" ? "0" : s.trim(), currency).minor;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function onEstablish() {
    setErr(null);
    const minor = toMinor(baselineInput);
    if (minor === null) return;
    establishBaseline(event.eventId, {
      amountMinor: minor,
      sourceRefs: [`manual:${event.eventId}`],
      establishedBy: OPERATOR,
    });
    setBaselineInput("");
  }

  function onAddEvidence() {
    setErr(null);
    if (!evRecordId.trim()) {
      setErr("evidence needs a source record id");
      return;
    }
    addEvidence(event.eventId, {
      evidenceType: evType,
      sourceSystem: evClass === "independent" ? "external" : "manual",
      sourceRecordId: evRecordId.trim(),
      observedAt: new Date().toISOString(),
      trustClassification: evClass,
      suppliedBy: evClass === "independent" ? "external" : OPERATOR,
    });
    setEvRecordId("");
  }

  const collectedMinor = (() => {
    try {
      return fromDecimal(collectedInput.trim() === "" ? "0" : collectedInput.trim(), currency).minor;
    } catch {
      return null;
    }
  })();
  const excludedMinor = (() => {
    try {
      return fromDecimal(excludedInput.trim() === "" ? "0" : excludedInput.trim(), currency).minor;
    } catch {
      return null;
    }
  })();

  const approveInput =
    collectedMinor !== null && excludedMinor !== null
      ? {
          collectedMinor,
          excludedMinor,
          exclusionStatement: exclusion,
          attribution: reasonLabel(event.recoveryReason) || "recovery",
        }
      : null;

  const blockers = approveInput ? approvalBlockers(event.eventId, approveInput) : ["enter a valid collected / excluded amount"];

  function onApprove() {
    setErr(null);
    if (!approveInput) {
      setErr("enter a valid collected / excluded amount");
      return;
    }
    const res = approveProof(event.eventId, approveInput);
    if (!res.ok) setErr(res.error);
    else setExclusion("");
  }

  return (
    <div className="mt-5 rounded-lg border border-proof-600/30 bg-proof-600/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-proof-500">
          Prove — governed baseline · evidence · immutable proof
        </span>
      </div>

      {/* Governed baseline */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Governed baseline</div>
        {baseline ? (
          <div className="flex items-center justify-between rounded bg-ink-800/60 px-3 py-2 text-sm">
            <span className="text-slate-300">
              {formatMoney(baseline.calculatedAmount, { exact: true })}{" "}
              <span className="font-mono text-[11px] text-slate-500">{baseline.baselineId}</span>
            </span>
            {baseline.lockedAt ? (
              <span className="text-[11px] text-proof-500">🔒 locked · immutable</span>
            ) : (
              <button
                className="rounded border border-proof-500/50 px-2 py-0.5 text-[11px] text-proof-500 hover:bg-proof-600/10"
                onClick={() => lockBaseline(event.eventId, "locked before intervention")}
              >
                Lock baseline
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              className="num-input flex-1"
              placeholder={`Baseline amount (${currency}), e.g. 6200.00`}
              value={baselineInput}
              onChange={(e) => setBaselineInput(e.target.value)}
            />
            <button
              className="rounded bg-ink-600 px-3 text-sm text-slate-200 hover:bg-ink-500"
              onClick={onEstablish}
            >
              Establish
            </button>
          </div>
        )}
        {baseline?.lockedAt && (
          <button
            className="mt-1 text-[11px] text-slate-500 underline hover:text-slate-300"
            onClick={() => {
              const next = toMinor(baselineInput);
              if (next === null || baselineInput.trim() === "") {
                setErr("enter a corrected baseline amount before revising");
                return;
              }
              reviseBaseline(event.eventId, {
                amountMinor: next,
                sourceRefs: [`manual:${event.eventId}:corrected`],
                establishedBy: OPERATOR,
                reason: "operator correction",
              });
              setBaselineInput("");
            }}
          >
            revise (creates a new linked baseline; original preserved)
          </button>
        )}
      </div>

      {/* Evidence */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Evidence</div>
        <ul className="mb-2 space-y-1">
          {evidence.length === 0 && <li className="text-[11px] text-slate-500">No evidence attached.</li>}
          {evidence.map((ev) => (
            <li key={ev.evidenceId} className="flex items-center justify-between rounded bg-ink-800/60 px-2 py-1 text-[12px]">
              <span className="text-slate-300">
                {ev.evidenceType} · <span className="font-mono text-slate-500">{ev.sourceRecordId}</span>
              </span>
              <span className={ev.trustClassification === "independent" ? "text-proof-500" : "text-slate-500"}>
                {ev.trustClassification === "independent" ? "independent" : "beneficiary-controlled"}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <select className="num-input" value={evType} onChange={(e) => setEvType(e.target.value)}>
            <option value="invoice_paid">invoice_paid</option>
            <option value="order_form_signed">order_form_signed</option>
            <option value="activation_event">activation_event</option>
            <option value="operator_note">operator_note</option>
          </select>
          <select
            className="num-input"
            value={evClass}
            onChange={(e) => setEvClass(e.target.value as TrustClassification)}
          >
            <option value="independent">independent</option>
            <option value="beneficiary_controlled">beneficiary-controlled</option>
          </select>
          <input
            className="num-input flex-1"
            placeholder="source record id (e.g. INV-9001)"
            value={evRecordId}
            onChange={(e) => setEvRecordId(e.target.value)}
          />
          <button className="rounded bg-ink-600 px-3 text-sm text-slate-200 hover:bg-ink-500" onClick={onAddEvidence}>
            Add
          </button>
        </div>
      </div>

      {/* Approved proofs (immutable) */}
      {proofs.length > 0 && (
        <div className="mb-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Approved proofs (immutable)</div>
          <ul className="space-y-1">
            {proofs.map((p) => (
              <li key={p.proofId} className="flex items-center justify-between rounded bg-ink-800/60 px-3 py-2 text-sm">
                <span>
                  <span className="font-mono text-[11px] text-slate-500">{p.proofId}</span>{" "}
                  <span className="tabular-nums text-proof-500">{formatMoney(p.revenueReturned, { exact: true })}</span>{" "}
                  <span className="text-[11px] text-slate-500">
                    {p.status}
                    {proofIsAuditable(p) ? " · auditable" : ""}
                  </span>
                </span>
                {p.status !== "Reversed" && (
                  <button
                    className="rounded border border-red-500/40 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-500/10"
                    onClick={() => reverseProof(p.chainId, "operator reversal (refund/dispute)")}
                  >
                    Reverse
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Approve a new proof */}
      <div className="rounded border border-ink-600/50 bg-ink-800/40 p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">
          Approve proof (Finance approver — distinct from owner)
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label={`Collected (${currency})`}>
            <input
              className="num-input"
              value={collectedInput}
              onChange={(e) => setCollectedInput(e.target.value)}
            />
          </Field>
          <Field label={`Excluded (${currency})`}>
            <input
              className="num-input"
              value={excludedInput}
              onChange={(e) => setExcludedInput(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Exclusion statement (mandatory — zero must be asserted)">
          <input
            className="num-input"
            placeholder="e.g. No excluded recovery — full delta independently evidenced."
            value={exclusion}
            onChange={(e) => setExclusion(e.target.value)}
          />
        </Field>
        {blockers.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {blockers.map((b) => (
              <li key={b} className="text-[11px] text-detect-500">• {b}</li>
            ))}
          </ul>
        )}
        <button
          className="mt-2 w-full rounded-md border border-proof-500/50 bg-proof-600/15 px-3 py-1.5 text-sm font-medium text-proof-500 hover:bg-proof-600/25 disabled:opacity-40"
          onClick={onApprove}
          disabled={blockers.length > 0}
        >
          Approve immutable proof
        </button>
        {err && <div className="mt-2 text-[11px] text-red-400">{err}</div>}
      </div>
    </div>
  );
}
