// Event detail drawer — the workflow surface: assign, act, classify, prove.
import { useEffect, useState } from "react";
import { OPEN_STATUSES } from "../domain/types";
import type { RecoveryEvent, RecoveryStatus } from "../domain/types";
import { OWNERS, useRecovery, type CaseTrustState } from "../state/RecoveryContext";
import { RECOVERY_REASONS, reasonLabel } from "../domain/reasons";
import { recommend } from "../domain/recommendation";
import { explainConfidence } from "../domain/confidence";
import { formatMoney, fromDecimal } from "../domain/money";
import type { BaselineSnapshotDTO, EvidenceRecordDTO } from "../data/governedTrustClient";
import { operatorActorFor, APPROVER, type DevActor } from "../data/devActor";
import { money, percent } from "../lib/format";
import {
  ConfidenceBadge,
  MoneyDelta,
  Pill,
  StatusBadge,
} from "./ui";
import { dateTime } from "../lib/format";

// Evidence sources the operator can attach. Independence is DERIVED SERVER-SIDE from the source
// (sourceSystem/evidenceType) — never chosen or supplied here. This map only picks which raw,
// falsifiable facts get sent; it carries no trust classification of its own.
const EVIDENCE_SOURCES = {
  billing_invoice: { label: "Billing — invoice paid (simulated)", sourceSystem: "billing", evidenceType: "invoice_paid" },
  product_event: { label: "Product — activation event (simulated)", sourceSystem: "product", evidenceType: "activation_event" },
  crm_order: { label: "CRM — signed order (simulated)", sourceSystem: "crm", evidenceType: "order_form_signed" },
  operator_note: { label: "Operator note (beneficiary-controlled)", sourceSystem: "manual", evidenceType: "operator_note" },
} as const;
type EvidenceSourceKey = keyof typeof EVIDENCE_SOURCES;

const STATUS_FLOW: RecoveryStatus[] = [
  "Detected",
  "Queued",
  "Assigned",
  "InProgress",
  "Recovered",
  "Failed",
  "Dismissed",
];

/** Purely a UX gate (avoids firing a request known to 403) — never the real security boundary,
 * which is enforced server-side regardless of what this returns. */
function canRead(actor: DevActor): boolean {
  return actor.role === "approver" || actor.role === "verifier" || actor.role === "steward";
}

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
    governed,
  } = useRecovery();

  // Explicit, visible, dev-only "acting as" identity — drives every governed call below. Never
  // silently switched: a write always uses the currently-selected actor, and a governed read is
  // only attempted when that SAME actor could plausibly hold AuditRead.
  const [actingAs, setActingAs] = useState<DevActor>(() => operatorActorFor(event.owner ?? null));
  const readAllowed = canRead(actingAs);

  useEffect(() => {
    if (readAllowed) governed.loadCaseTrust(event.eventId, actingAs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.eventId, actingAs.actorId, actingAs.role, readAllowed]);

  const trustState: CaseTrustState | undefined = governed.caseTrust[event.eventId];
  const baselines = readAllowed ? (trustState?.baselines ?? []) : [];
  const latestBaseline = baselines[baselines.length - 1];
  // A governed baseline is "locked" the moment it exists (establish + lock is one atomic step) —
  // but that fact is only KNOWABLE when the current actor can read it back.
  const governedLocked = readAllowed && !!latestBaseline;

  // Proof status — read ONLY from the server's own audit reconstruction (`auditable`,
  // `provenanceGaps`), never from a client-side trust computation.
  const proofRows = readAllowed ? (trustState?.auditTrail?.proofs ?? []) : [];
  const provenProof = proofRows.reduce<(typeof proofRows)[number] | undefined>(
    (latest, p) => (p.status !== "Reversed" && (!latest || p.proofVersion > latest.proofVersion) ? p : latest),
    undefined,
  );
  const auditableProof = provenProof?.auditable ?? false;

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

        {/* Acting-as selector — dev-only, visible, drives every governed call in this drawer,
            including the proof status banner right below. */}
        <div className="mb-3 flex items-center justify-between rounded bg-ink-800/40 px-3 py-2 text-[11px]">
          <span className="text-slate-400">Acting as (dev-only — not real auth):</span>
          <select
            className="num-input"
            value={actingAs.role === "approver" ? "approver" : "operator"}
            onChange={(e) =>
              setActingAs(e.target.value === "approver" ? APPROVER : operatorActorFor(event.owner ?? null))
            }
          >
            <option value="operator">Operator ({event.owner ?? "unassigned"})</option>
            <option value="approver">Finance Approver ({APPROVER.actorId})</option>
          </select>
        </div>

        {/* Proof status banner — driven by the server's own audit reconstruction */}
        <div
          className={`mb-5 rounded-lg border px-3 py-2 text-sm ${
            auditableProof
              ? "border-proof-600/40 bg-proof-600/10 text-proof-500"
              : provenProof
                ? "border-detect-600/40 bg-detect-600/10 text-detect-500"
                : "border-ink-500/40 bg-ink-800/60 text-slate-400"
          }`}
        >
          {!readAllowed
            ? "🔒 Not authorized to view governed proof status as Operator — switch to Finance Approver above."
            : auditableProof
              ? `✓ CFO-auditable: proof ${provenProof!.proofId} counted in Auditable Revenue.`
              : provenProof
                ? provenProof.provenanceGaps.length > 0
                  ? `Proven (in Revenue Returned) but not Auditable — gap: ${provenProof.provenanceGaps.join(", ")}.`
                  : "Proven (in Revenue Returned) but below proof-grade — excluded from the CFO auditable total."
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
          <Field label={governedLocked ? "Baseline (governed — authoritative)" : "Baseline (provisional)"}>
            {governedLocked ? (
              <div className="num-input flex items-center justify-between">
                <span>{formatMoney({ minor: latestBaseline!.calculatedMinor, currency: latestBaseline!.currency }, { exact: true })}</span>
                <span className="text-[10px] text-proof-500">🔒 governed</span>
              </div>
            ) : (
              <input
                className="num-input"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                onBlur={() => updateAmounts(event.eventId, { baselineAmount: Number(baseline) || 0 })}
              />
            )}
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
            <div className="mt-2 rounded border border-dashed border-slate-600/50 px-2 py-1.5">
              <MoneyDelta value={event.revenueReturned} />
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                operational estimate — not proven
              </div>
            </div>
          </Field>
        </div>
        <p className="mb-5 text-[11px] text-slate-500">
          The estimate above is Collected − Baseline on the provisional Case record — it is NOT
          the proven number. The real Revenue Returned/Auditable figures come only from the
          governed proof in the Prove panel below and the CFO Proof View. Detected risk on this
          event: {money(event.riskAmount)}.
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

        {/* Evidence notes — LOCAL/provisional only, never governed evidence */}
        <div className="mt-5">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
            Provisional note (not governed evidence)
          </div>
          <textarea
            className="num-input h-20 w-full resize-none"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            onBlur={() => updateEvidence(event.eventId, evidence)}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            A free-text, operator-entered note — provisional, never governed evidence. Auditable
            proof needs a governed, independent evidence reference — ingest one in the Prove panel
            below.
          </p>
        </div>

        {/* Prove — governed baseline, evidence, and the immutable approved proof (real backend) */}
        <ProofGovernance event={event} actingAs={actingAs} readAllowed={readAllowed} trustState={trustState} />

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
            Local activity log (provisional — see the Prove panel for the governed authority trail)
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

// The "Prove" surface: establish + lock a governed baseline, ingest evidence, and approve an
// IMMUTABLE proof through the REAL governed backend — never a local domain-kernel call. Every
// call uses `actingAs` exactly as selected above; a read is only attempted `if (readAllowed)`.
// Money is entered as decimals and converted at this single edge via money.fromDecimal.
function ProofGovernance({
  event,
  actingAs,
  readAllowed,
  trustState,
}: {
  event: RecoveryEvent;
  actingAs: DevActor;
  readAllowed: boolean;
  trustState: CaseTrustState | undefined;
}) {
  const { governed } = useRecovery();
  const caseId = event.eventId;

  const currency = event.currency ?? "USD";
  const baselines = readAllowed ? (trustState?.baselines ?? []) : [];
  const latestBaseline = baselines[baselines.length - 1];
  const evidenceList = readAllowed ? (trustState?.evidence ?? []) : [];
  const proofs = readAllowed ? (trustState?.auditTrail?.proofs ?? []) : [];

  const [baselineInput, setBaselineInput] = useState("");
  const [evSource, setEvSource] = useState<EvidenceSourceKey>("billing_invoice");
  const [evRecordId, setEvRecordId] = useState("");
  const [evAmount, setEvAmount] = useState("");
  const [collectedInput, setCollectedInput] = useState(String(event.collectedAmount));
  const [excludedInput, setExcludedInput] = useState("0");
  const [exclusion, setExclusion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // EP-9 review fix: a write-confirmation is NEVER the same thing as a governed read-back — kept
  // as separate, clearly-labeled, single (non-accumulating) state, distinct from the governed
  // lists above. An Operator without AuditRead must never gain read visibility indirectly
  // through this — it shows only the ONE record the server just returned for THIS write.
  const [lastBaselineWrite, setLastBaselineWrite] = useState<BaselineSnapshotDTO | null>(null);
  const [lastEvidenceWrite, setLastEvidenceWrite] = useState<EvidenceRecordDTO | null>(null);

  function toMinor(s: string): number | null {
    try {
      return fromDecimal(s.trim() === "" ? "0" : s.trim(), currency).minor;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function onAuthor() {
    setErr(null);
    setBusy(true);
    const res = await governed.authorCase(caseId, actingAs);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else if (readAllowed) await governed.loadCaseTrust(caseId, actingAs);
  }

  // Baseline revision (`supersedes`) is deliberately NOT exposed in this slice — the backend
  // does not yet validate that a supplied `supersedes` id exists, belongs to this case, or
  // avoids forking baseline lineage. Only a first-time "Establish + lock" is offered; once a
  // baseline is visible, no further establish/revise action is available here.
  async function onEstablish() {
    setErr(null);
    const minor = toMinor(baselineInput);
    if (minor === null) return;
    setBusy(true);
    const res = await governed.establishBaseline(caseId, actingAs, {
      calculatedMinor: minor,
      currency,
      method: "matched_historical_cohort",
      methodVersion: 1,
      sourceRefs: [`manual:${caseId}`],
      effectiveAt: new Date().toISOString(),
    });
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else {
      setBaselineInput("");
      // The 201 response IS the created snapshot — shown as a one-off confirmation of this
      // write, never as if it were a governed list read.
      setLastBaselineWrite(res.baseline);
    }
  }

  async function onIntervene() {
    setErr(null);
    setBusy(true);
    const res = await governed.recordIntervention(caseId, actingAs);
    setBusy(false);
    if (!res.ok) setErr(res.error);
  }

  async function onAddEvidence() {
    setErr(null);
    if (!evRecordId.trim()) {
      setErr("evidence needs a source record id");
      return;
    }
    const src = EVIDENCE_SOURCES[evSource];
    let amountMinor: number | undefined;
    if (evAmount.trim()) {
      const parsed = toMinor(evAmount);
      if (parsed === null) return;
      amountMinor = parsed;
    }
    setBusy(true);
    const res = await governed.ingestEvidence(caseId, actingAs, {
      sourceSystem: src.sourceSystem,
      sourceRecordId: evRecordId.trim(),
      evidenceType: src.evidenceType,
      observedAt: new Date().toISOString(),
      amountMinor,
      currency: amountMinor !== undefined ? currency : undefined,
    });
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else {
      setEvRecordId("");
      // Same rule as baseline establish: the 201 response IS the created record — a one-off
      // write confirmation, never displayed as if it were a governed list read.
      setLastEvidenceWrite(res.evidence);
    }
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

  const canApprove =
    readAllowed &&
    !!latestBaseline &&
    evidenceList.length > 0 &&
    collectedMinor !== null &&
    excludedMinor !== null &&
    exclusion.trim() !== "" &&
    !!event.recoveryReason;

  // proofId is an opaque, client-generated CORRELATION id only — never trust-bearing. The server
  // remains fully authoritative over uniqueness/collisions (DB-level unique constraints); no
  // conflict is assumed impossible here, and a 409 is handled exactly like any other ApiError.
  async function onApprove() {
    setErr(null);
    if (!canApprove || collectedMinor === null || excludedMinor === null || !latestBaseline) {
      setErr("enter a valid collected/excluded amount, exclusion statement, and recovery reason");
      return;
    }
    const proofId = `PF-${caseId}-${Date.now().toString(36)}`;
    setBusy(true);
    const res = await governed.approveProof(caseId, actingAs, proofId, {
      currency,
      collectedMinor,
      excludedRecoveryMinor: excludedMinor,
      exclusionStatement: exclusion,
      recoveryReason: event.recoveryReason ?? "",
      attribution: reasonLabel(event.recoveryReason) || "recovery",
      evidenceIds: evidenceList.map((e) => e.evidenceId),
      baselineId: latestBaseline.baselineId,
      confidenceUsed: event.confidence,
    });
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else {
      setExclusion("");
      // Legitimate exception to "write ≠ read-back": `approver` holds BOTH `Approve` and
      // `AuditRead` server-side, so refetching through the real governed read here is an
      // authorized read by the same actor who just wrote — not an indirect grant of visibility
      // to someone who lacks AuditRead (unlike the baseline/evidence writes above, which an
      // Operator — who never has AuditRead — can also perform).
      if (readAllowed) await governed.loadCaseTrust(caseId, actingAs);
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-proof-600/30 bg-proof-600/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-proof-500">
          Prove — governed baseline · evidence · immutable proof (real backend)
        </span>
      </div>

      {err && (
        <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          {err}
        </div>
      )}

      {!readAllowed && (
        <div className="mb-4 rounded border border-ink-600/50 bg-ink-800/40 p-3 text-[12px] text-slate-400">
          🔒 Not authorized to view governed baseline history, evidence, or proof status as
          Operator — switch to Finance Approver above to view them. You can still establish a
          baseline, record an intervention, or ingest evidence below as Operator.
        </div>
      )}

      {baselines.length === 0 && (
        <div className="mb-4">
          <button
            className="rounded bg-ink-600 px-3 py-1 text-sm text-slate-200 hover:bg-ink-500 disabled:opacity-50"
            onClick={onAuthor}
            disabled={busy}
          >
            Author this case ({event.owner ?? "unassigned"})
          </button>
        </div>
      )}

      {/* Governed baseline */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Governed baseline</div>
        {readAllowed && baselines.length > 0 && (
          <ul className="mb-2 space-y-1">
            {baselines.map((b) => (
              <li key={b.baselineId} className="flex items-center justify-between rounded bg-ink-800/60 px-3 py-2 text-sm">
                <span className="text-slate-300">
                  {formatMoney({ minor: b.calculatedMinor, currency: b.currency }, { exact: true })}{" "}
                  <span className="font-mono text-[11px] text-slate-500">{b.baselineId}</span>
                  {b.supersedes && (
                    <span className="ml-2 text-[10px] text-slate-500">supersedes {b.supersedes}</span>
                  )}
                </span>
                <span className="text-[11px] text-proof-500">🔒 locked · immutable</span>
              </li>
            ))}
          </ul>
        )}
        {(!readAllowed || baselines.length === 0) && (
          <div className="flex gap-2">
            <input
              className="num-input flex-1"
              placeholder={`Baseline amount (${currency}), e.g. 6200.00`}
              value={baselineInput}
              onChange={(e) => setBaselineInput(e.target.value)}
            />
            <button
              className="rounded bg-ink-600 px-3 text-sm text-slate-200 hover:bg-ink-500 disabled:opacity-50"
              onClick={onEstablish}
              disabled={busy}
            >
              Establish + lock
            </button>
          </div>
        )}
        {lastBaselineWrite && (
          <div className="mb-2 rounded border border-dashed border-proof-500/40 bg-proof-600/[0.06] px-3 py-2 text-[12px] text-proof-300">
            ✓ Submitted — server recorded {formatMoney({ minor: lastBaselineWrite.calculatedMinor, currency: lastBaselineWrite.currency }, { exact: true })}{" "}
            (<span className="font-mono">{lastBaselineWrite.baselineId}</span>). This is a direct
            confirmation of your submission, not a governed read.
          </div>
        )}
      </div>

      {/* Intervention */}
      <div className="mb-4 flex items-center justify-between rounded bg-ink-800/60 px-3 py-2">
        <span className="text-[12px] text-slate-300">
          Intervention (fix) timing: {readAllowed ? "recorded via the button below" : "status unavailable as Operator"}
        </span>
        <button
          className="rounded border border-proof-500/50 px-2 py-0.5 text-[11px] text-proof-500 hover:bg-proof-600/10 disabled:opacity-50"
          onClick={onIntervene}
          disabled={busy}
        >
          Record intervention
        </button>
      </div>

      {/* Evidence */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Evidence</div>
        {!readAllowed && (
          <div className="mb-2 text-[11px] text-slate-500">
            🔒 Not authorized to view governed evidence as Operator.
          </div>
        )}
        {readAllowed && (
          <ul className="mb-2 space-y-1">
            {evidenceList.length === 0 && <li className="text-[11px] text-slate-500">No evidence ingested.</li>}
            {evidenceList.map((ev) => (
              <li key={ev.evidenceId} className="flex items-center justify-between rounded bg-ink-800/60 px-2 py-1 text-[12px]">
                <span className="text-slate-300">
                  {ev.evidenceType} · <span className="font-mono text-slate-500">{ev.sourceRecordId}</span>
                </span>
                <span className={ev.trustClassification === "independent" ? "text-proof-500" : "text-slate-500"}>
                  {ev.trustClassification === "independent" ? "independent" : "beneficiary-controlled"} ·{" "}
                  {ev.evidenceRole} · {dateTime(ev.ingestedAt)} · {ev.ingestedBy}
                </span>
              </li>
            ))}
          </ul>
        )}
        {lastEvidenceWrite && (
          <div className="mb-2 rounded border border-dashed border-proof-500/40 bg-proof-600/[0.06] px-3 py-2 text-[12px] text-proof-300">
            ✓ Submitted — server recorded {lastEvidenceWrite.evidenceType} ·{" "}
            <span className="font-mono">{lastEvidenceWrite.sourceRecordId}</span>, classified{" "}
            {lastEvidenceWrite.trustClassification}/{lastEvidenceWrite.evidenceRole} (server-derived).
            This is a direct confirmation of your submission, not a governed read.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <select
            className="num-input"
            value={evSource}
            onChange={(e) => setEvSource(e.target.value as EvidenceSourceKey)}
          >
            {(Object.keys(EVIDENCE_SOURCES) as EvidenceSourceKey[]).map((k) => (
              <option key={k} value={k}>
                {EVIDENCE_SOURCES[k].label}
              </option>
            ))}
          </select>
          <input
            className="num-input flex-1"
            placeholder="source record id (e.g. INV-9001)"
            value={evRecordId}
            onChange={(e) => setEvRecordId(e.target.value)}
          />
          <input
            className="num-input w-32"
            placeholder={`amount (${currency})`}
            value={evAmount}
            onChange={(e) => setEvAmount(e.target.value)}
          />
          <button
            className="rounded bg-ink-600 px-3 text-sm text-slate-200 hover:bg-ink-500 disabled:opacity-50"
            onClick={onAddEvidence}
            disabled={busy}
          >
            Ingest
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Role and independence are derived by the server, never chosen here. <strong>Not
          externally verified:</strong> the source system, record id, amount, and time above are
          the caller&rsquo;s claim, not yet confirmed against the real external billing/product
          system (a named EP-11 boundary).
        </p>
      </div>

      {/* Approved proofs — status/auditable/gaps read verbatim from the governed audit trail */}
      {readAllowed && proofs.length > 0 && (
        <div className="mb-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Approved proofs (immutable)</div>
          <ul className="space-y-1">
            {proofs.map((p) => (
              <li key={p.proofId} className="rounded bg-ink-800/60 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="font-mono text-[11px] text-slate-500">{p.proofId}</span>{" "}
                    <span className="tabular-nums text-proof-500">
                      {formatMoney({ minor: p.amounts.storedRevenueReturnedMinor, currency }, { exact: true })}
                    </span>{" "}
                    <span className="text-[11px] text-slate-500">
                      {p.status}
                      {p.auditable ? " · auditable" : ""}
                    </span>
                  </span>
                </div>
                {p.provenanceGaps.length > 0 && (
                  <div className="mt-1 text-[11px] text-detect-500">
                    gaps: {p.provenanceGaps.join(", ")}
                  </div>
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
        {actingAs.role !== "approver" && (
          <p className="mb-2 text-[11px] text-amber-300">
            Switch to Finance Approver above to approve — the server requires the `approver` role.
          </p>
        )}
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
        <button
          className="mt-2 w-full rounded-md border border-proof-500/50 bg-proof-600/15 px-3 py-1.5 text-sm font-medium text-proof-500 hover:bg-proof-600/25 disabled:opacity-40"
          onClick={onApprove}
          disabled={busy || !canApprove || actingAs.role !== "approver"}
        >
          {busy ? "Submitting…" : "Approve immutable proof"}
        </button>
      </div>
    </div>
  );
}
