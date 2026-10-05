// ADVERSARIAL tests for the pure validator. Each one is a convenient distortion the validator must
// refuse, or a fact its absence must NOT be allowed to invent. None is illustrative.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTATION_EXTRACT_COLUMNS, EXPECTATION_EXTRACT_SCHEME,
} from "./expectationExtract";
import {
  expectationValidationWitness, validateExpectationExtract,
  type ExpectationExtractTerms, type RawExpectationRow,
} from "./expectationExtractValidator";

const FULL = [...EXPECTATION_EXTRACT_COLUMNS];
const TERMS: ExpectationExtractTerms = { currency: "USD" };

/** One row, every declared cell blank unless stated. */
let seq = 0;
const row = (over: Record<string, string>): RawExpectationRow => {
  seq += 1;
  const cells: Record<string, string> = {};
  for (const c of FULL) cells[c] = "";
  cells.entitlement_ref = "ent-1";
  cells.period_start = "2026-03-01";
  cells.period_end = "2026-03-31";
  cells.expected_amount = "100.00";
  cells.currency = "USD";
  return { rowNumber: seq, cells: Object.freeze({ ...cells, ...over }) };
};
const run = (rows: readonly RawExpectationRow[], header: readonly string[] = FULL, terms = TERMS) =>
  validateExpectationExtract(header, rows, terms);
const codes = (r: ReturnType<typeof run>) => r.rejections.map((x) => x.code);
const cap = (r: ReturnType<typeof run>, name: string) =>
  r.capabilities.find((c) => c.capability === name)!;

describe("validator · UNKNOWN is never zero", () => {
  it("a BLANK expected_amount is a declared UNKNOWN, accepted with a null amount", () => {
    // The defect this contract exists to avoid. A blank read as 0 would make an unpriced obligation
    // look satisfied, which is the UNKNOWN-becomes-zero error one level upstream of the reconciler.
    const r = run([row({ expected_amount: "" })]);
    expect(r.usable).toBe(true);
    expect(codes(r)).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.expectedAmountMinor).toBeNull();
    expect(r.accepted[0]!.expectedAmountMinor).not.toBe(0);
    expect(r.unknownAmountCount).toBe(1);
  });

  it("an UNPARSEABLE amount is REJECTED, not quietly demoted to UNKNOWN", () => {
    // "the source could not state it" and "the source stated something unreadable" are different
    // facts. Collapsing them would let a malformed cell become an unknown and escape its rejection.
    const r = run([row({ expected_amount: "about a hundred" })]);
    expect(codes(r)).toEqual(["NH-EX-2005"]);
    expect(r.accepted).toHaveLength(0);
    expect(r.unknownAmountCount).toBe(0);
  });

  it("zero and negative expectations are refused, never treated as unknown or as a credit", () => {
    expect(codes(run([row({ expected_amount: "0.00" })]))).toEqual(["NH-EX-2006"]);
    expect(codes(run([row({ expected_amount: "-100.00" })]))).toEqual(["NH-EX-2006"]);
  });

  it("refuses more precision than the currency supports rather than rounding a cent", () => {
    expect(codes(run([row({ expected_amount: "100.005" })]))).toEqual(["NH-EX-2005"]);
  });
});

describe("validator · a missing capability fact rejects NOTHING", () => {
  it("omitting every conditional column closes capabilities and accepts the row", () => {
    const header = ["entitlement_ref", "period_start", "period_end", "expected_amount", "currency"];
    const r = run([row({})], header);
    expect(r.usable).toBe(true);
    expect(r.rejections).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    // ...and every capability is closed, each with its own code.
    expect(r.capabilities.filter((c) => c.available)).toEqual([]);
    expect(r.capabilities.map((c) => c.unavailableCode).sort())
      .toEqual(["NH-EX-3001", "NH-EX-3002", "NH-EX-3003", "NH-EX-3004", "NH-EX-3005"]);
  });

  it("a missing schedule_line_ref closes ONLY the event gate — money is untouched", () => {
    // Capability gating per detector, never global dataset rejection. The monetary surface still
    // measures every dollar it can reach.
    const r = run([row({ payer_ref: "payer-1", schedule_line_ref: "" })]);
    expect(r.rejections).toEqual([]);
    expect(r.accepted[0]!.expectedAmountMinor).toBe(10_000);
    expect(cap(r, "EXPECTATION_EVENT_IDENTITY_AVAILABLE").available).toBe(false);
    expect(cap(r, "EXPECTATION_EVENT_IDENTITY_AVAILABLE").unavailableCode).toBe("NH-EX-3005");
    expect(cap(r, "PAYER_RELATION_AVAILABLE").available).toBe(true);
  });

  it("event identity needs it on EVERY row — one blank closes the gate for the extract", () => {
    const r = run([row({ schedule_line_ref: "sl-1" }), row({ entitlement_ref: "ent-2", schedule_line_ref: "" })]);
    expect(r.accepted).toHaveLength(2);
    expect(cap(r, "EXPECTATION_EVENT_IDENTITY_AVAILABLE").available).toBe(false);
  });

  it("a DECLARED lifecycle column is the capability, because a blank there is itself a fact", () => {
    // Declaring `terminated_at` is the source saying "I report terminations", so an empty cell means
    // "not terminated". That is why this gate is column-level while identity is value-level.
    const r = run([row({})]);
    expect(r.accepted[0]!.terminatedAt).toBeNull();
    expect(cap(r, "LIFECYCLE_TERMINATION_AVAILABLE").available).toBe(true);
    expect(cap(r, "LIFECYCLE_PAUSE_AVAILABLE").available).toBe(true);
  });
});

describe("validator · nothing is inferred", () => {
  it("never infers a period from a neighbouring row", () => {
    // Two rows a month apart establish no cadence and license no third row. The accepted population
    // is exactly what the source enumerated.
    const r = run([row({ period_start: "2026-03-01", period_end: "2026-03-31" }),
      row({ period_start: "2026-04-01", period_end: "2026-04-30" })]);
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted.map((a) => a.periodStart)).toEqual(["2026-03-01", "2026-04-01"]);
  });

  it("refuses an ambiguous numeric date rather than picking a locale", () => {
    expect(codes(run([row({ period_start: "03/04/2026" })]))).toEqual(["NH-EX-2003"]);
    // ...and accepts it under a GOVERNED locale, which is a supplied fact rather than a guess. The
    // period_end moves with it: this check first failed because the default end (2026-03-31) then
    // PRECEDED the parsed start, and the validator was right to refuse the reversed pair.
    const r = run([row({ period_start: "03/04/2026", period_end: "2026-04-30" })], FULL,
      { currency: "USD", dateLocale: "DMY" });
    expect(r.rejections).toEqual([]);
    expect(r.accepted[0]!.periodStart).toBe("2026-04-03");
  });

  it("never converts a currency and never silently drops the row", () => {
    const r = run([row({ currency: "EUR" })]);
    expect(codes(r)).toEqual(["NH-EX-2008"]); // named exclusion, not a quiet omission
    expect(r.accepted).toHaveLength(0);
    expect(codes(run([row({ currency: "XYZ" })]))).toEqual(["NH-EX-2007"]);
  });

  it("never reorders a reversed period or a reversed pause", () => {
    expect(codes(run([row({ period_start: "2026-03-31", period_end: "2026-03-01" })]))).toEqual(["NH-EX-2004"]);
    expect(codes(run([row({ pause_start: "2026-03-20", pause_end: "2026-03-10" })]))).toEqual(["NH-EX-2010"]);
  });

  it("refuses a half-bounded pause rather than closing it with a date of its own", () => {
    expect(codes(run([row({ pause_start: "2026-03-10" })]))).toEqual(["NH-EX-2009"]);
    expect(codes(run([row({ pause_end: "2026-03-20" })]))).toEqual(["NH-EX-2009"]);
  });
});

describe("validator · lifecycle and amendment consistency", () => {
  it("a termination does NOT void a period that precedes it", () => {
    // The dated fact is checked against the period it is claimed to govern. A termination in May says
    // nothing about March, and reading it as voiding March would hide real money.
    const r = run([row({ period_start: "2026-03-01", period_end: "2026-03-31", terminated_at: "2026-05-01" })]);
    expect(r.rejections).toEqual([]);
    expect(r.accepted[0]!.terminatedAt).toBe("2026-05-01");
    expect(r.accepted[0]!.expectedAmountMinor).toBe(10_000); // still owed, and still priced
  });

  it("refuses two different termination dates for one entitlement", () => {
    const r = run([
      row({ entitlement_ref: "ent-9", period_start: "2026-03-01", period_end: "2026-03-31", terminated_at: "2026-04-01", schedule_line_ref: "sl-a" }),
      row({ entitlement_ref: "ent-9", period_start: "2026-04-01", period_end: "2026-04-30", terminated_at: "2026-05-01", schedule_line_ref: "sl-b" }),
    ]);
    expect(codes(r)).toEqual(["NH-EX-2017", "NH-EX-2017"]); // BOTH, not the earlier or the later
    expect(r.accepted).toHaveLength(0);
  });

  it("refuses a supersession with no effective date, and one that points at itself", () => {
    expect(codes(run([row({ schedule_line_ref: "sl-1", supersedes_ref: "sl-0" })]))).toContain("NH-EX-2011");
    expect(codes(run([row({ schedule_line_ref: "sl-1", supersedes_ref: "sl-1", amended_at: "2026-02-01" })])))
      .toContain("NH-EX-2012");
  });

  it("refuses a supersession pointing outside the extract rather than ignoring it", () => {
    // Ignoring a dangling reference would silently promote the amendment to an unamended obligation.
    const r = run([row({ schedule_line_ref: "sl-new", supersedes_ref: "sl-absent", amended_at: "2026-02-01" })]);
    expect(codes(r)).toEqual(["NH-EX-2013"]);
  });

  it("refuses a supersession CYCLE rather than walking into it", () => {
    const r = run([
      row({ entitlement_ref: "ent-c", schedule_line_ref: "sl-x", supersedes_ref: "sl-y", amended_at: "2026-02-01" }),
      row({ entitlement_ref: "ent-c", schedule_line_ref: "sl-y", supersedes_ref: "sl-x", amended_at: "2026-02-02" }),
    ]);
    expect(codes(r)).toEqual(["NH-EX-2014", "NH-EX-2014"]);
  });

  it("accepts a well-formed amendment and marks the superseded line, which is not a second obligation", () => {
    const r = run([
      row({ entitlement_ref: "ent-15", expected_amount: "100.00", schedule_line_ref: "sl-old" }),
      row({ entitlement_ref: "ent-15", expected_amount: "60.00", schedule_line_ref: "sl-new", supersedes_ref: "sl-old", amended_at: "2026-02-20" }),
    ]);
    expect(r.rejections).toEqual([]);
    expect(r.accepted.find((a) => a.scheduleLineRef === "sl-old")!.superseded).toBe(true);
    expect(r.accepted.find((a) => a.scheduleLineRef === "sl-new")!.superseded).toBe(false);
  });

  it("refuses TWO UNSUPERSEDED lines for one unit — the case that manufactures money", () => {
    // The same two amounts with the supersession link REMOVED. Summing them would state $160, which
    // neither line asserts; choosing one would be NH picking the customer's number for them.
    const r = run([
      row({ entitlement_ref: "ent-15x", expected_amount: "100.00", schedule_line_ref: "sl-a" }),
      row({ entitlement_ref: "ent-15x", expected_amount: "60.00", schedule_line_ref: "sl-b" }),
    ]);
    expect(codes(r)).toEqual(["NH-EX-2016", "NH-EX-2016"]);
    expect(r.accepted).toHaveLength(0);
  });
});

describe("validator · identity and cardinality", () => {
  it("quarantines ALL rows sharing a schedule-line identity, with no survivor chosen by position", () => {
    const forward = run([row({ schedule_line_ref: "sl-dup" }), row({ entitlement_ref: "ent-2", schedule_line_ref: "sl-dup" })]);
    expect(codes(forward)).toEqual(["NH-EX-2015", "NH-EX-2015"]);
    expect(forward.accepted).toHaveLength(0);
  });

  it("is order-independent — reordering the file cannot change the accepted population", () => {
    // The pilot-dataset collision rule, on the expectation side. File order is the author's lever.
    const a = row({ entitlement_ref: "ent-A", schedule_line_ref: "sl-1" });
    const b = row({ entitlement_ref: "ent-B", schedule_line_ref: "sl-1" });
    const c = row({ entitlement_ref: "ent-C", schedule_line_ref: "sl-2" });
    const fwd = run([a, b, c]);
    const rev = run([c, b, a]);
    expect(fwd.accepted.map((x) => x.entitlementRef)).toEqual(["ent-C"]);
    expect(rev.accepted.map((x) => x.entitlementRef)).toEqual(["ent-C"]);
    expect(fwd.rejections.length).toBe(rev.rejections.length);
  });
});

describe("validator · extract-level faults", () => {
  it("refuses an undeclared column rather than ignoring it", () => {
    const r = run([row({})], [...FULL, "cadence"]);
    expect(r.usable).toBe(false);
    expect(r.extractFaults.map((f) => f.code)).toEqual(["NH-EX-1003"]);
    expect(r.accepted).toEqual([]);
  });

  it("refuses a missing required column, and an empty extract is not a clean zero", () => {
    expect(run([row({})], FULL.filter((c) => c !== "currency")).extractFaults.map((f) => f.code))
      .toEqual(["NH-EX-1002"]);
    const empty = run([]);
    expect(empty.usable).toBe(false);
    expect(empty.extractFaults.map((f) => f.code)).toEqual(["NH-EX-1001"]);
    expect(empty.accepted).toEqual([]);
  });

  it("refuses a duplicated column, because which one wins would be decided by position", () => {
    expect(run([row({})], [...FULL, "currency"]).extractFaults.map((f) => f.code)).toContain("NH-EX-1004");
  });

  it("closes every capability on an unusable extract — never reports one as available", () => {
    const r = run([], FULL);
    expect(r.capabilities.every((c) => !c.available && c.unavailableCode !== null)).toBe(true);
  });
});

describe("validator · purity", () => {
  it("is deterministic — same bytes, identical verdict and identical witness", async () => {
    const rows = [row({ payer_ref: "p-1", schedule_line_ref: "sl-1" }), row({ entitlement_ref: "ent-2", expected_amount: "" })];
    const a = run(rows), b = run(rows);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(await expectationValidationWitness(FULL, rows, TERMS, a))
      .toBe(await expectationValidationWitness(FULL, rows, TERMS, b));
  });

  it("the witness moves when the GOVERNED TERMS move, even on identical bytes", async () => {
    // The terms decide what the bytes mean: the same file under another governed currency is another
    // verdict. A witness that hid that would be a hash of the data pretending to be one of the
    // judgement.
    const rows = [row({})];
    const usd = run(rows, FULL, { currency: "USD" });
    const eur = run(rows, FULL, { currency: "EUR" });
    expect(usd.accepted).toHaveLength(1);
    expect(eur.accepted).toHaveLength(0); // excluded by name, under NH-EX-2008
    expect(await expectationValidationWitness(FULL, rows, { currency: "USD" }, usd))
      .not.toBe(await expectationValidationWitness(FULL, rows, { currency: "EUR" }, eur));
  });

  it("consults NO CLOCK — a verdict cannot change tomorrow for the same bytes", () => {
    // Checked on CODE with comments stripped, because the paragraph above legitimately names the
    // thing being forbidden.
    const src = readFileSync(resolve(__dirname, "expectationExtractValidator.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/Date\.now|new Date\(\)/);
  });

  it("has no side effects to have: the result and its rows are frozen", () => {
    const r = run([row({})]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.accepted)).toBe(true);
    expect(Object.isFrozen(r.accepted[0])).toBe(true);
    expect(r.scheme).toBe(EXPECTATION_EXTRACT_SCHEME);
  });
});
