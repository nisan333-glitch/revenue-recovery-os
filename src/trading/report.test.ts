import { describe, expect, it } from "vitest";
import { dailySummary, parseTradingReport, sampleReport, summarize, tradesCsv } from "./report";
const data = () => structuredClone(sampleReport);
describe("day-trading report boundary", () => {
  it("reconciles gross, costs, journal and daily net, rather than summing simulated profits as recovery", () => {
    const r = parseTradingReport(JSON.stringify(data()));
    expect(summarize(r)).toMatchObject({ gross: 4, fees: 2, slippage: 1, net: 1, worstTrade: -3.5, winning: 1 });
    expect(dailySummary(r)).toEqual([{ day: "2026-10-20", count: 2, gross: 4, costs: 3, net: 1 }]);
  });
  it("rejects overnight trades using New York dates even when UTC date is identical", () => {
    const r = data(); r.trades[0]!.entryTime = "2026-10-20T02:00:00Z"; r.trades[0]!.exitTime = "2026-10-20T15:00:00Z";
    expect(() => parseTradingReport(JSON.stringify(r))).toThrow("עסקה 1");
  });
  it("accepts a New York session spanning UTC midnight", () => {
    const r = data(); r.trades[0]!.entryTime = "2026-10-20T23:00:00Z"; r.trades[0]!.exitTime = "2026-10-21T01:00:00Z";
    expect(parseTradingReport(JSON.stringify(r)).trades).toHaveLength(2);
  });
  it.each(["live", "recovered", "verified"]) ("refuses unsupported evidence %s", evidence => {
    expect(() => parseTradingReport(JSON.stringify({ ...data(), evidence }))).toThrow();
  });
  it("rejects duplicates instead of double-counting a trade", () => {
    const r = data(); r.trades.push({ ...r.trades[0]! }); expect(() => parseTradingReport(JSON.stringify(r))).toThrow();
  });
  it.each([-1, null, "1"]) ("refuses invalid costs %s", fees => {
    const r = data(); (r.trades[0] as unknown as Record<string, unknown>).fees = fees;
    expect(() => parseTradingReport(JSON.stringify(r))).toThrow();
  });
  it("refuses ambiguous times, reversed fills, missing provenance and swing reports", () => {
    const r = data(); r.trades[0]!.entryTime = "2026-10-20T10:00:00";
    expect(() => parseTradingReport(JSON.stringify(r))).toThrow();
    const s = data(); s.trades[0]!.exitTime = "2026-10-20T09:00:00-04:00";
    expect(() => parseTradingReport(JSON.stringify(s))).toThrow();
    expect(() => parseTradingReport(JSON.stringify({ ...data(), source: "" }))).toThrow();
    expect(() => parseTradingReport(JSON.stringify({ ...data(), strategy: "RSI2" }))).toThrow();
  });
  it("fails closed on arithmetic overflow", () => {
    const r = data(); r.trades[0]!.quantity = Number.MAX_VALUE;
    expect(() => parseTradingReport(JSON.stringify(r))).toThrow();
    expect(() => parseTradingReport(JSON.stringify({ ...data(), initialCapital: Number.MIN_VALUE }))).toThrow();
  });
  it("keeps empty valid reports distinct from the absent-report state", () => {
    const r = parseTradingReport(JSON.stringify({ ...data(), trades: [] }));
    expect(summarize(r).count).toBe(0); expect(summarize(r).worstTrade).toBeNull();
  });
  it("exports provenance and prevents spreadsheet formula execution in free text", () => {
    const r = data(); r.trades[0]!.exitReason = '=HYPERLINK("unsafe")';
    const csv = tradesCsv(parseTradingReport(JSON.stringify(r)));
    expect(csv).toContain("synthetic"); expect(csv).toContain("netPnl");
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"-3.5"');
  });
});
