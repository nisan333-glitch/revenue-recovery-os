import { useState } from "react";
import { dailySummary, evidenceLabel, parseTradingReport, sampleReport, summarize, tradePnl, tradesCsv, type TradingReport } from "../trading/report";

const skills = [
  ["scanner", "סריקת מועמדות", "מימוש חלופי במחקר"], ["news", "חדשות ואירועים", "טרם חובר"],
  ["entry", "תזמון כניסה", "מימוש חלופי במחקר"], ["exit", "סטופ, יעד וסיום יום", "מימוש חלופי במחקר"],
  ["timemachine", "10,000 מסלולים מדומים", "מימוש חלופי במחקר"], ["risk", "מגבלות חשיפה והפסד", "מימוש חלקי במחקר"],
  ["budget", "גודל פוזיציה", "נדרשת מגבלת הפסד אישית"], ["broker", "חיבור לברוקר", "טרם חובר"],
  ["alerts", "התראות ותקלות", "טרם חובר"], ["analyst", "דוחות חברות", "מידע משלים, טרם חובר"],
  ["pelosi", "דיווחים ציבוריים", "מידע משלים, טרם חובר"],
] as const;
const button = "rounded-lg border border-ink-500/60 px-3 py-2 text-sm text-slate-200 hover:bg-ink-700";
const card = "rounded-xl border border-ink-500/40 bg-ink-800/60 p-4";
const fmt = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const when = (s: string) => new Date(s).toLocaleString("he-IL", { timeZone: "America/New_York" });
function download(content: string, suffix: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = `reveniq-day-trading.${suffix}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DayTradingCenter() {
  const [report, setReport] = useState<TradingReport | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"report" | "skills" | "readiness">("report");
  const [loading, setLoading] = useState(false);
  const totals = report ? summarize(report) : null;
  return <section dir="rtl" aria-label="מרכז מסחר יומי" className="space-y-5">
    <header className="space-y-3">
      <p className="text-xs uppercase tracking-widest text-proof-500">REVENIQ · Day Trading Research</p>
      <h1 className="text-2xl font-semibold text-slate-100">מרכז מסחר יומי</h1>
      <p className="text-sm text-slate-400">מחקר, יומן ודוחות לעסקאות שנסגרו באותו יום בניו יורק. אין חיבור לביצוע פקודות.</p>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200" role="status">
        שלב הכנה · ברוקר לא מחובר · רווחיות לא הוכחה
      </div>
      <nav aria-label="אזורי המסחר" className="flex flex-wrap gap-2">
        {([["report", "דוחות ויומן"], ["skills", "11 הסקילים"], ["readiness", "מוכנות למסחר"]] as const).map(([key, label]) =>
          <button className={button + (tab === key ? " bg-ink-600" : "")} aria-pressed={tab === key} key={key} onClick={() => setTab(key)}>{label}</button>)}
      </nav>
    </header>
    {tab === "report" && <>
      <div className={card + " space-y-3"}>
        <h2 className="font-semibold text-slate-100">יבוא דוח מחקר</h2>
        <p className="text-sm text-slate-400">קובץ JSON עד 1 MB, גרסה 1, אסטרטגיית ID-v1 ובמטבע USD. הקובץ נקרא בדפדפן בלבד ואינו נשמר לאחר יציאה מהאזור. מטא־נתוני מקור הם הצהרת המעלה ואינם אימות ביצוע.</p>
        <label className="block text-sm text-slate-200">בחירת דוח
          <input type="file" accept=".json,application/json" disabled={loading} className="mt-2 block w-full text-sm" onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
            setReport(null); setError(""); setLoading(true);
            try { if (file.size > 1_000_000) throw new Error("הדוח גדול מדי. המגבלה היא 1 MB."); setReport(parseTradingReport(await file.text())); }
            catch (err) { setError(err instanceof Error ? err.message : "היבוא נכשל."); }
            finally { setLoading(false); }
          }} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button disabled={loading} className={button} onClick={() => { setReport(parseTradingReport(JSON.stringify(sampleReport))); setError(""); }}>הצג דוגמה סינתטית</button>
          <button className={button} onClick={() => download(JSON.stringify(sampleReport, null, 2), "sample.json", "application/json")}>הורד דוגמת חוזה</button>
          {report && <button className={button} onClick={() => { setReport(null); setError(""); }}>נקה דוח</button>}
        </div>
        {loading && <p role="status">קורא ובודק את הדוח...</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
      </div>
      {!report && <p className="text-slate-400">טרם נטען דוח. ביצועים, עסקאות ורווחים אינם זמינים.</p>}
      {report && totals && <>
        <div className={card + " space-y-2 text-sm text-slate-300"}>
          <h2 className="font-semibold text-amber-200">{evidenceLabel(report.evidence)}</h2>
          <p>הרצה: <bdi>{report.runId}</bdi> · אסטרטגיה: ID-v1 · נוצר: {when(report.generatedAt)} (ניו יורק)</p>
          <p>מקור מוצהר: {report.source}</p>
          <p>הנתונים אינם רווח מאומת בחשבון ברוקר. הדוח כולל עסקאות קנייה סגורות בלבד; אין בו יתרה זמינה, חשיפה פתוחה או מס מחושב.</p>
          <div className="flex gap-2">
            <button className={button} onClick={() => download(tradesCsv(report), "csv", "text/csv;charset=utf-8")}>יצוא יומן CSV</button>
            <button className={button} onClick={() => download(JSON.stringify({ ...report, summary: totals, daily: dailySummary(report) }, null, 2), "json", "application/json")}>יצוא דוח מלא JSON</button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[["עסקאות סגורות", String(totals.count)], ["רווח / הפסד ברוטו", fmt(totals.gross)], ["עמלות והחלקה", fmt(totals.fees + totals.slippage)], ["רווח / הפסד נטו לפני מס", fmt(totals.net)]].map(([label, value]) =>
            <div key={label} className={card}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-xl text-slate-100" dir="ltr">{value}</p></div>)}
        </div>
        <p className="text-sm text-slate-400">נטו ביחס להון התחלתי מוצהר ({fmt(report.initialCapital)}): {(totals.netOverInitial * 100).toFixed(2)}%. זו תשואת עסקאות סגורות בלבד. אין חישוב תשואה מותאמת תזרימים או ירידה תוך־יומית מהשיא.</p>
        <div className={card + " overflow-x-auto"}>
          <h2 className="mb-3 font-semibold text-slate-100">סיכום לפי יום בניו יורק</h2>
          <table className="w-full text-right text-sm text-slate-300"><thead><tr>{["יום", "עסקאות", "ברוטו", "עלויות", "נטו לפני מס"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
            <tbody>{dailySummary(report).map(d => <tr className="border-t border-ink-600" key={d.day}><td className="p-2">{d.day}</td><td>{d.count}</td><td>{fmt(d.gross)}</td><td>{fmt(d.costs)}</td><td>{fmt(d.net)}</td></tr>)}</tbody></table>
        </div>
        <div className={card + " overflow-x-auto"}>
          <h2 className="mb-3 font-semibold text-slate-100">יומן עסקאות · זמנים בניו יורק</h2>
          <table className="w-full text-right text-sm text-slate-300"><thead><tr>{["מזהה / סימול", "כניסה", "יציאה", "כמות", "מחירי כניסה / יציאה", "עמלות", "החלקה", "נטו", "סיבת יציאה"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
            <tbody>{report.trades.map(t => <tr className="border-t border-ink-600" key={t.id}><td className="p-2"><bdi>{t.id} / {t.symbol}</bdi></td><td>{when(t.entryTime)}</td><td>{when(t.exitTime)}</td><td>{t.quantity}</td><td>{fmt(t.entryPrice)} / {fmt(t.exitPrice)}</td><td>{fmt(t.fees)}</td><td>{fmt(t.slippage)}</td><td>{fmt(tradePnl(t).net)}</td><td>{t.exitReason}</td></tr>)}</tbody></table>
        </div>
      </>}
    </>}
    {tab === "skills" && <div className={card + " overflow-x-auto"}>
      <h2 className="mb-2 font-semibold text-slate-100">מפת 11 הסקילים</h2>
      <p className="mb-4 text-sm text-slate-400">סטטוס מחקר מדווח מ-Claude. הסקילים המקוריים טרם הותקנו או הורצו. אין כאן סטטוס ניטור חי; יבוא דוח אינו מפעיל סקיל.</p>
      <table className="w-full text-right text-sm text-slate-300"><thead><tr><th>סקיל</th><th>תפקיד</th><th>מצב</th></tr></thead><tbody>{skills.map(([name, job, status]) => <tr key={name} className="border-t border-ink-600"><td className="p-3" dir="ltr">trader-{name}</td><td>{job}</td><td>{status}</td></tr>)}</tbody></table>
    </div>}
    {tab === "readiness" && <div className={card + " space-y-3 text-sm text-slate-300"}>
      <h2 className="text-lg font-semibold text-slate-100">מה נדרש לפני מעבר לכסף אמיתי</h2>
      <ul className="list-inside list-disc space-y-3">
        <li>נתוני שוק אמיתיים עם מקור, חותמת זמן ובדיקת איכות — טרם אומתו.</li>
        <li>בדיקה היסטורית אחרי עלויות, השוואה בלי שער הסימולציות ובדיקה קדימה בדמו — טרם הושלמו.</li>
        <li>הון פנוי ומגבלת הפסד אישית, יומית ולעסקה — טרם הוגדרו.</li>
        <li>אימות סטופ, סגירה לפני סוף יום, מילוי חלקי, נתק וכפל הוראות אצל הברוקר — טרם בוצע.</li>
        <li>התראות, תיעוד אישורים, התאמה מול הברוקר ותהליך הפקדה ומשיכה — טרם חוברו.</li>
      </ul>
      <p className="text-amber-200">מעבר כל בדיקות התוכנה או הרצת 10,000 סימולציות אינם הוכחת רווחיות. סטופ אינו מבטיח מחיר ביצוע.</p>
    </div>}
  </section>;
}
