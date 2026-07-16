import { describe, it, expect } from "vitest";
import { normalizeDate, epochDay, addDays, isAfter } from "./dateNormalize";

describe("normalizeDate — loud about ambiguity, timezone-agnostic", () => {
  it("accepts ISO (with or without time) at day granularity", () => {
    expect(normalizeDate("2026-01-02")).toEqual({ ok: true, iso: "2026-01-02" });
    expect(normalizeDate("2026-01-02T10:30:00Z")).toEqual({ ok: true, iso: "2026-01-02" });
    expect(normalizeDate("2026/03/09")).toEqual({ ok: true, iso: "2026-03-09" });
  });

  it("rejects ambiguous numeric dates when both parts ≤ 12 and no locale", () => {
    const r = normalizeDate("01/02/2026");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous_date");
  });

  it("applies an explicit locale to ambiguous dates", () => {
    expect(normalizeDate("01/02/2026", { locale: "MDY" })).toEqual({ ok: true, iso: "2026-01-02" });
    expect(normalizeDate("01/02/2026", { locale: "DMY" })).toEqual({ ok: true, iso: "2026-02-01" });
  });

  it("self-disambiguates when one part exceeds 12", () => {
    expect(normalizeDate("13/02/2026")).toEqual({ ok: true, iso: "2026-02-13" }); // DMY forced
    expect(normalizeDate("02/13/2026")).toEqual({ ok: true, iso: "2026-02-13" }); // MDY forced
  });

  it("accepts month-name forms", () => {
    expect(normalizeDate("2 Jan 2026")).toEqual({ ok: true, iso: "2026-01-02" });
    expect(normalizeDate("Jan 2, 2026")).toEqual({ ok: true, iso: "2026-01-02" });
  });

  it("rejects malformed and impossible dates", () => {
    expect(normalizeDate("2026-13-01").ok).toBe(false);
    expect(normalizeDate("2026-02-30").ok).toBe(false);
    expect(normalizeDate("hello").ok).toBe(false);
    expect(normalizeDate("").ok).toBe(false);
  });

  it("epochDay / addDays / isAfter are exact and timezone-agnostic", () => {
    expect(addDays("2026-01-01", 30)).toBe("2026-01-31");
    expect(epochDay("2026-01-31") - epochDay("2026-01-01")).toBe(30);
    expect(isAfter("2026-01-02", "2026-01-01")).toBe(true);
    expect(isAfter("2026-01-01", "2026-01-01")).toBe(false);
  });
});
