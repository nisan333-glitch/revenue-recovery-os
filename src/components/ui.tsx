// Shared, dependency-light UI primitives.
import type { ReactNode } from "react";
import type { RecoveryStatus } from "../domain/types";
import { bandOf, type ConfidenceBand } from "../domain/confidence";
import { money } from "../lib/format";

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "proof" | "detect" | "neutral";
  hint?: string;
}) {
  const ring =
    tone === "proof"
      ? "border-proof-600/40"
      : tone === "detect"
        ? "border-detect-600/40"
        : "border-ink-500/40";
  const accent =
    tone === "proof"
      ? "text-proof-500"
      : tone === "detect"
        ? "text-detect-500"
        : "text-slate-100";
  return (
    <div className={`rounded-xl border ${ring} bg-ink-800/60 p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {label}
        </span>
        {hint && (
          <span className="text-[10px] text-slate-500" title={hint}>
            ⓘ
          </span>
        )}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${accent}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<RecoveryStatus, string> = {
  Detected: "bg-detect-600/20 text-detect-500 border-detect-600/40",
  Queued: "bg-slate-600/20 text-slate-300 border-slate-500/40",
  Assigned: "bg-blue-600/20 text-blue-300 border-blue-500/40",
  InProgress: "bg-indigo-600/20 text-indigo-300 border-indigo-500/40",
  Recovered: "bg-proof-600/20 text-proof-500 border-proof-600/40",
  Failed: "bg-red-600/20 text-red-300 border-red-500/40",
  Dismissed: "bg-slate-700/30 text-slate-500 border-slate-600/40",
};

export function StatusBadge({ status }: { status: RecoveryStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

const BAND_STYLES: Record<ConfidenceBand, string> = {
  High: "bg-proof-600/20 text-proof-500 border-proof-600/40",
  Medium: "bg-detect-600/20 text-detect-500 border-detect-600/40",
  Low: "bg-red-600/20 text-red-300 border-red-500/40",
};

export function ConfidenceBadge({ value }: { value: number }) {
  const band = bandOf(value);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_STYLES[band]}`}
      title={`${band} confidence`}
    >
      <span className="tabular-nums">{value}</span>
      <span className="opacity-70">{band}</span>
    </span>
  );
}

export function MoneyDelta({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={`tabular-nums font-medium ${positive ? "text-proof-500" : "text-red-400"}`}
    >
      {positive ? "+" : "−"}
      {money(Math.abs(value))}
    </span>
  );
}

export function Bar({
  value,
  max,
  tone = "proof",
}: {
  value: number;
  max: number;
  tone?: "proof" | "detect" | "neutral";
}) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const color =
    tone === "proof"
      ? "bg-proof-500"
      : tone === "detect"
        ? "bg-detect-500"
        : "bg-slate-400";
  return (
    <div className="h-2 w-full rounded-full bg-ink-600/60">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Sparkline({ data, width = 160, height = 40 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <div className="text-xs text-slate-500">—</div>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-proof-500"
      />
    </svg>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-500/40 bg-ink-800/60 ${className}`}>
      {children}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "proof" | "detect" | "neutral" }) {
  const styles =
    tone === "proof"
      ? "bg-proof-600/15 text-proof-500"
      : tone === "detect"
        ? "bg-detect-600/15 text-detect-500"
        : "bg-ink-600/60 text-slate-300";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${styles}`}>{children}</span>;
}
