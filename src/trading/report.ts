// Research reports only. No broker, execution, recovery-ledger or persistence dependencies.
export type Evidence = "synthetic" | "backtest" | "paper";
export interface DayTrade {
  id: string; symbol: string; quantity: number; entryTime: string; exitTime: string;
  entryPrice: number; exitPrice: number; fees: number; slippage: number; exitReason: string;
}
export interface TradingReport {
  schemaVersion: 1; strategy: "ID-v1"; evidence: Evidence; runId: string;
  generatedAt: string; source: string; currency: "USD"; initialCapital: number; trades: DayTrade[];
}
const labels: Record<Evidence, string> = {
  synthetic: "נתונים סינתטיים — בדיקת תוכנה בלבד",
  backtest: "בדיקה היסטורית — דיווח מיובא, ללא אימות מקור עצמאי",
  paper: "דמו — דיווח מיובא, ללא אימות ביצוע עצמאי",
};
export const evidenceLabel = (e: Evidence) => labels[e];
const nyDay = (v: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(v));
const timestamp = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseTradingReport(raw: string): TradingReport {
  if (new TextEncoder().encode(raw).length > 1_000_000) throw new Error("הדוח גדול מדי. המגבלה היא 1 MB.");
  let r: unknown;
  try { r = JSON.parse(raw); } catch { throw new Error("קובץ JSON אינו תקין."); }
  if (!record(r) || r.schemaVersion !== 1 || r.strategy !== "ID-v1" ||
    !["synthetic", "backtest", "paper"].includes(String(r.evidence)) || r.currency !== "USD" ||
    !text(r.runId) || !text(r.source) || !timestamp(r.generatedAt) ||
    !number(r.initialCapital) || r.initialCapital <= 0 || !Array.isArray(r.trades) || r.trades.length > 5000) {
    throw new Error("חוזה הדוח אינו תקין. נדרש ID-v1, מקור, זמן עם אזור זמן, הון התחלתי ועסקאות ב-USD. דוח מסחר חי אינו נתמך.");
  }
  const seen = new Set<string>();
  const trades = r.trades.map((t: unknown, i: number): DayTrade => {
    if (!record(t) || !text(t.id) || seen.has(t.id) || !text(t.symbol) || !/^[A-Z0-9.^-]{1,15}$/.test(t.symbol) ||
      !number(t.quantity) || t.quantity <= 0 || !number(t.entryPrice) || t.entryPrice <= 0 ||
      !number(t.exitPrice) || t.exitPrice <= 0 || !number(t.fees) || t.fees < 0 ||
      !number(t.slippage) || t.slippage < 0 || !text(t.exitReason) ||
      !timestamp(t.entryTime) || !timestamp(t.exitTime) || Date.parse(t.exitTime) < Date.parse(t.entryTime) ||
      nyDay(t.entryTime) !== nyDay(t.exitTime)) {
      throw new Error(`עסקה ${i + 1} נדחתה. נדרשים מזהה ייחודי, מחירים ועלויות תקינים וסגירה באותו יום בניו יורק.`);
    }
    seen.add(t.id);
    const trade: DayTrade = { id: t.id, symbol: t.symbol, quantity: t.quantity, entryTime: t.entryTime,
      exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees,
      slippage: t.slippage, exitReason: t.exitReason };
    const p = tradePnl(trade);
    if (!Number.isFinite(p.gross) || !Number.isFinite(p.net)) throw new Error("סכומי עסקה חורגים מטווח החישוב.");
    return trade;
  });
  const result: TradingReport = { schemaVersion: 1, strategy: "ID-v1", evidence: r.evidence as Evidence,
    runId: r.runId, generatedAt: r.generatedAt, source: r.source, currency: "USD", initialCapital: r.initialCapital, trades };
  if (Object.values(summarize(result)).some(v => v !== null && !Number.isFinite(v))) throw new Error("סכום הדוח חורג מטווח החישוב.");
  return result;
}
export function tradePnl(t: DayTrade) {
  const gross = t.quantity * (t.exitPrice - t.entryPrice);
  return { gross, net: gross - t.fees - t.slippage };
}
export function summarize(r: TradingReport) {
  const rows = r.trades.map(tradePnl);
  const gross = rows.reduce((s, t) => s + t.gross, 0);
  const fees = r.trades.reduce((s, t) => s + t.fees, 0);
  const slippage = r.trades.reduce((s, t) => s + t.slippage, 0);
  const net = gross - fees - slippage;
  return { count: rows.length, gross, fees, slippage, net,
    winning: rows.filter(t => t.net > 0).length, netOverInitial: net / r.initialCapital,
    worstTrade: rows.length ? Math.min(...rows.map(t => t.net)) : null };
}
export function dailySummary(r: TradingReport) {
  const days = new Map<string, { day: string; count: number; gross: number; costs: number; net: number }>();
  for (const t of r.trades) {
    const day = nyDay(t.entryTime), p = tradePnl(t);
    const d = days.get(day) ?? { day, count: 0, gross: 0, costs: 0, net: 0 };
    d.count++; d.gross += p.gross; d.costs += t.fees + t.slippage; d.net += p.net; days.set(day, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
const csvCell = (value: string | number) => {
  const s = typeof value === "number" ? String(value) : (/^[\s]*[=+@-]/.test(value) ? "'" + value : value);
  return '"' + s.replace(/"/g, '""') + '"';
};
export function tradesCsv(r: TradingReport) {
  const header = ["evidence", "runId", "currency", "id", "symbol", "quantity", "entryTime", "exitTime", "entryPrice", "exitPrice", "grossPnl", "fees", "slippage", "netPnl", "exitReason"];
  return [header, ...r.trades.map(t => [r.evidence, r.runId, r.currency, t.id, t.symbol, t.quantity,
    t.entryTime, t.exitTime, t.entryPrice, t.exitPrice, tradePnl(t).gross, t.fees, t.slippage, tradePnl(t).net, t.exitReason])]
    .map(row => row.map(csvCell).join(",")).join("\r\n");
}
export const sampleReport: TradingReport = {
  schemaVersion: 1, strategy: "ID-v1", evidence: "synthetic", runId: "SYNTHETIC-ui-example",
  generatedAt: "2026-10-25T08:00:00Z", source: "דוגמת ממשק מומצאת. אינה נתוני שוק או תוצאת מנוע.", currency: "USD", initialCapital: 1000,
  trades: [
    { id: "S-1", symbol: "TEST", quantity: 2, entryTime: "2026-10-20T10:00:00-04:00", exitTime: "2026-10-20T11:00:00-04:00", entryPrice: 100, exitPrice: 103, fees: 1, slippage: 0.5, exitReason: "יעד — דוגמה" },
    { id: "S-2", symbol: "TEST", quantity: 1, entryTime: "2026-10-20T12:00:00-04:00", exitTime: "2026-10-20T13:00:00-04:00", entryPrice: 100, exitPrice: 98, fees: 1, slippage: 0.5, exitReason: "סטופ — דוגמה" },
  ],
};
