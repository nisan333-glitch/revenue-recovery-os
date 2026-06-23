// Recovery Loop — the product's front door, built to pass the 15-second test for a
// CRO/CFO/CEO. It answers five questions in order, before any workflow:
//   Money At Risk · Recovery Opportunity · Actions Taken · Revenue Returned ·
//   Auditable Revenue.
// Forecast (at risk, opportunity) and proven (returned, auditable) stay visually
// separate and are never summed. The function screens (Queue, CFO Proof, Audit) are
// deep-dives behind it.
import { useRecovery } from "../state/RecoveryContext";
import { recoveryLoop } from "../domain/loop";
import { reasonLabel } from "../domain/reasons";
import { money, percent } from "../lib/format";
import { StatCard, Panel, SectionHeader, Pill } from "../components/ui";

/** Targets the loop can drill into. A subset of App's ModuleKey. */
type LoopTarget = "queue" | "cfo" | "audit";

export function RecoveryLoop({ onOpen }: { onOpen: (key: LoopTarget) => void }) {
  const { events } = useRecovery();
  const loop = recoveryLoop(events);

  return (
    <div>
      <SectionHeader
        title="Recovery Loop"
        subtitle="Revenue lost between signature and activation — found, acted on, returned, and proven."
      />

      {/* A money screen, not a dashboard. Four money numbers in two columns: open
          exposure (forecast) vs proven results (realized cash). Amber vs green is
          the forecast/proven Constitution shown visually; the two columns are
          different time windows, so "returned > at-risk" explains itself. */}
      <div className="mb-3 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-detect-600/30 bg-ink-800/40 p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-detect-500">
            Open Exposure{" "}
            <span className="font-normal text-slate-500">— forecast · open now</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Money At Risk"
              value={money(loop.moneyAtRisk)}
              sub={`${loop.openCount} open · signed, not activated`}
              tone="detect"
              hint="Open dollars still at risk right now (Revenue Opportunity ledger — forecast, not money)."
            />
            <StatCard
              label="Recovery Opportunity"
              value={money(loop.recoverableForecast)}
              sub="forecast we can recover"
              tone="detect"
              hint="Σ expected value over open accounts. Forecast — never counted as recovered cash."
            />
          </div>
        </div>
        <div className="rounded-xl border border-proof-600/30 bg-ink-800/40 p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-proof-500">
            Proven Results{" "}
            <span className="font-normal text-slate-500">— realized cash · to date</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Revenue Returned"
              value={money(loop.returned)}
              sub="cash recovered above baseline"
              tone="proof"
              hint="Realized cash, Collected − Baseline (Revenue Returned ledger — proven)."
            />
            <StatCard
              label="Auditable Revenue"
              value={money(loop.auditable)}
              sub="CFO-signed · click for the cases"
              tone="proof"
              hint="The CFO-grade subset of Returned (proof-grade confidence + reason + positive uplift)."
              onClick={() => onOpen("cfo")}
            />
          </div>
        </div>
      </div>

      {/* The activity behind the money — supporting detail, deliberately quiet. */}
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
        <span><span className="font-semibold text-slate-300">{loop.actionTakenCount}</span> Actions Taken</span>
        <span><span className="font-semibold text-slate-300">{loop.provenCount}</span> Recoveries Proven</span>
        <span><span className="font-semibold text-slate-300">{loop.auditableCount}</span> Auditable Recoveries</span>
        <span><span className="font-semibold text-slate-300">{percent(loop.recoveryRate)}</span> Recovery Rate</span>
      </div>

      {/* The spoken story — read this aloud. */}
      <p className="mb-1 text-sm text-slate-300">
        We have <span className="font-semibold text-detect-500">{money(loop.moneyAtRisk)}</span>{" "}
        at risk and forecast{" "}
        <span className="font-semibold text-detect-500">{money(loop.recoverableForecast)}</span>{" "}
        recoverable. To date we have returned{" "}
        <span className="font-semibold text-proof-500">{money(loop.returned)}</span> — a{" "}
        <span className="font-semibold text-proof-500">{percent(loop.recoveryRate)}</span> recovery
        rate — and <span className="font-semibold text-proof-500">{money(loop.auditable)}</span> of
        it is backed by evidence a CFO can sign.
      </p>
      <p className="mb-8 text-[11px] text-slate-500">
        Open Exposure is the current open book (forecast); Proven Results are realized
        to date. Different time windows — reported separately, never summed.
      </p>

      {/* The money story as a connected loop — the drill-down. */}
      <Panel className="p-6">
        <div className="mb-4 text-xs uppercase tracking-wider text-slate-500">
          The money story — Opportunity → Recovery → Proof
        </div>

        <Rung
          phase="Identify"
          tone="forecast"
          label="Money At Risk"
          value={money(loop.moneyAtRisk)}
          note={
            loop.recommendedPlay
              ? `${loop.openCount} open · signed but not activated · suggested play: ${reasonLabel(loop.recommendedPlay)}`
              : `${loop.openCount} open · signed but not activated`
          }
        />
        <Arrow caption="Forecast recoverable" />

        <Rung
          phase="Identify"
          tone="forecast"
          label="Recovery Opportunity"
          value={money(loop.recoverableForecast)}
          note="what we forecast we can recover — Opportunity ledger"
        />
        <Arrow caption="We act" />

        <Rung
          phase="Act"
          tone="neutral"
          label="Actions Taken"
          value={`${loop.actionTakenCount} accounts`}
          note="email · call · milestone · workflow — each action logged & auditable"
          onClick={() => onOpen("audit")}
          cta="See the actions in the audit trail →"
        />
        <Arrow caption="Proven" />

        <Rung
          phase="Prove"
          tone="proof"
          label="Revenue Returned"
          value={money(loop.returned)}
          note="proven cash — Collected − Baseline"
          onClick={() => onOpen("cfo")}
          cta="Open the CFO Proof View →"
        />
        <Arrow caption="Audited" />

        <Rung
          phase="Prove"
          tone="proof"
          label="Auditable Revenue"
          value={money(loop.auditable)}
          note="proof-grade subset, CFO signed off"
          onClick={() => onOpen("cfo")}
          cta="See the auditable cases →"
        />
      </Panel>

      <p className="mt-6 text-[11px] text-slate-500">
        <span className="text-detect-500">Money At Risk</span> and{" "}
        <span className="text-detect-500">Recovery Opportunity</span> are forecast
        (Revenue Opportunity ledger) and are never counted as money.{" "}
        <span className="text-proof-500">Revenue Returned</span> is realized cash
        (Revenue Returned ledger). The two are reported separately and never summed —
        that separation is what makes the recovered number auditable.{" "}
        <span className="text-slate-400">Actions Taken</span> reports only logged,
        auditable actions; we never claim a problem was “fixed” until execution is
        modeled and proven. We display only what is objectively observable.
      </p>
    </div>
  );
}

type Tone = "forecast" | "proof" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  forecast: "text-detect-500",
  proof: "text-proof-500",
  neutral: "text-slate-100",
};

const PHASE_TONE: Record<string, string> = {
  Identify: "bg-detect-600/15 text-detect-500",
  Act: "bg-ink-600/60 text-slate-300",
  Prove: "bg-proof-600/15 text-proof-500",
};

function Rung({
  phase,
  label,
  value,
  note,
  tone,
  onClick,
  cta,
}: {
  phase: "Identify" | "Act" | "Prove";
  label: string;
  value: string;
  note: string;
  tone: Tone;
  onClick?: () => void;
  cta?: string;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-ink-500/40 bg-ink-800/40 p-4 ${
        clickable ? "cursor-pointer transition hover:border-ink-400/60 hover:bg-ink-700/40" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${PHASE_TONE[phase]}`}
          >
            {phase}
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`text-xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
              {value}
            </div>
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>{note}</div>
          {cta && <div className="mt-1 text-sky-400">{cta}</div>}
        </div>
      </div>
    </div>
  );
}

function Arrow({ caption }: { caption: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-4 text-slate-600">
      <span className="text-base leading-none">↓</span>
      <Pill>{caption}</Pill>
    </div>
  );
}
