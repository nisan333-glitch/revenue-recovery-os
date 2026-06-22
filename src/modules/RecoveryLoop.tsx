// Recovery Loop — the product's front door. Read outside-in, the way a CFO/CRO
// thinks: Opportunity → Recovery → Proof. It answers three questions before it
// shows any workflow: how much money was found, how much came back, how do we
// know. The function screens (Queue, CFO Proof, Audit) are deep-dives behind it.
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
        subtitle="Revenue lost between signature and activation — found, recovered, and proven."
      />

      {/* The three questions an exec actually asks — answered first, before any
          workflow. Forecast (found) and proven (returned) are different colors
          and are never added together. */}
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="How much money was found?"
          value={money(loop.opportunity)}
          sub={`${loop.identifiedCount} accounts identified · Opportunity (forecast)`}
          tone="detect"
          hint="Revenue Opportunity ledger — total at-risk we identified. A forecast, never counted as recovered money."
        />
        <StatCard
          label="How much was recovered?"
          value={money(loop.returned)}
          sub={`${loop.provenCount} accounts recovered · ${percent(loop.recoveryRate)} recovery rate`}
          tone="proof"
        />
        <StatCard
          label="How was it proven?"
          value={money(loop.auditable)}
          sub="CFO-auditable · proof-grade"
          tone="proof"
          hint="Revenue Returned = Collected − Baseline. Auditable is the CFO-grade subset (proof-grade confidence + reason + positive uplift)."
        />
      </div>

      {/* The story, top-down: Opportunity → Detected → Play → Applied → Returned
          → Auditable. The Identify/Fix/Prove spine is the caption, not the head. */}
      <Panel className="p-6">
        <div className="mb-4 text-xs uppercase tracking-wider text-slate-500">
          The loop, on this portfolio
        </div>

        <Rung
          phase="Identify"
          tone="forecast"
          label="Opportunity"
          value={money(loop.opportunity)}
          note="revenue we found at risk — signed but not yet safe"
        />
        <Arrow caption={`Detected · ${loop.openCount} still open`} />

        <Rung
          phase="Identify"
          tone="forecast"
          label="Detected"
          value={`${loop.identifiedCount} accounts`}
          note={
            loop.recommendedPlay
              ? `signed but not activated · suggested play: ${reasonLabel(loop.recommendedPlay)}`
              : "signed but not activated"
          }
        />
        <Arrow caption="Action taken" />

        <Rung
          phase="Act"
          tone="neutral"
          label="Action Taken"
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
          label="CFO-Auditable"
          value={money(loop.auditable)}
          note="proof-grade subset, signed off"
          onClick={() => onOpen("audit")}
          cta="See the audit trail →"
        />
      </Panel>

      <p className="mt-6 text-[11px] text-slate-500">
        <span className="text-detect-500">Opportunity</span> is a forecast (Revenue
        Opportunity ledger) and is never counted as money.{" "}
        <span className="text-proof-500">Revenue Returned</span> is realized cash
        (Revenue Returned ledger). The two are reported separately and never summed —
        that separation is what makes the recovered number auditable.{" "}
        <span className="text-slate-400">Action Taken</span> reports only logged,
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
