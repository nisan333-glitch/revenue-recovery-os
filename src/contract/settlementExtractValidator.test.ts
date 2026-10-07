// FALSIFIERS FOR THE SETTLEMENT EXTRACT VALIDATOR.
//
// The two things that must hold in both directions: a MISSING REQUIRED fact makes the file or the row
// unusable, and a MISSING CONDITIONAL fact closes exactly one named capability and rejects NOTHING.
// Collapsing either into the other is the failure this contract is shaped to prevent — refusing a file
// over a fact some detector did not need discards money NH can still measure, while accepting a file
// whose money cannot be read manufactures a clean zero.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SETTLEMENT_CAPABILITIES, SETTLEMENT_EXTRACT_COLUMNS, SETTLEMENT_EXTRACT_FIELDS,
  SETTLEMENT_EXTRACT_REF, SETTLEMENT_EXTRACT_VERSION, SETTLEMENT_REQUIRED_COLUMNS,
  SETTLEMENT_STOPPED_FIELDS,
} from "./settlementExtract";
import { ALL_SETTLEMENT_CODES, RETIRED_SETTLEMENT_CODES } from "./settlementExtractCodes";
import { validateSettlementExtract, type RawSettlementRow } from "./settlementExtractValidator";

const TERMS = Object.freeze({ currency: "USD" });

const FULL = Object.freeze([...SETTLEMENT_EXTRACT_COLUMNS]);
const REQUIRED_ONLY = Object.freeze([...SETTLEMENT_REQUIRED_COLUMNS]);

let seq = 0;
const row = (over: Record<string, string> = {}): RawSettlementRow => {
  seq += 1;
  return {
    rowNumber: seq,
    cells: {
      invoice_ref: `inv-${seq}`, invoice_line_ref: "L1", settled_at: "2026-03-05",
      settled_amount: "100.00", currency: "USD", payer_ref: "payer-1",
      obligation_ref: `ob-${seq}`, is_credit: "false",
      period_start: "2026-03-01", period_end: "2026-03-31",
      legacy_subscription_ref: "", source_system: "billing-v1",
      ...over,
    },
  };
};

const cap = (cols: readonly string[], rows: readonly RawSettlementRow[], name: string) =>
  validateSettlementExtract(cols, rows, TERMS).capabilities.find((c) => c.capability === name)!;

describe("settlement extract · identity and the pattern it inherits", () => {
  it("carries its OWN id, version, scheme and method version — borrowing none", () => {
    expect(SETTLEMENT_EXTRACT_REF).toBe("nh.settlement-extract@1.0.0");
    expect(SETTLEMENT_EXTRACT_VERSION).toBe("1.0.0");
    const v = validateSettlementExtract(FULL, [row()], TERMS);
    expect(v.scheme).toBe("nh-settlement-extract-v1");
    expect(v.methodVersion).toBe("sxv-2026.1");
    for (const foreign of ["nh-expectation-extract-v1", "exv-2026.1", "assess-2026.1-thin",
      "nh-expectation-reconciliation-v1", "recon-2026.1", "oblig-2026.1"]) {
      expect(v.scheme).not.toBe(foreign);
      expect(v.methodVersion).not.toBe(foreign);
    }
  });

  it("declares NO `recommended` tier — the trap is absent, not merely unused", () => {
    for (const f of SETTLEMENT_EXTRACT_FIELDS) {
      expect(["required", "conditional", "optional"]).toContain(f.tier);
    }
    expect(JSON.stringify(SETTLEMENT_EXTRACT_FIELDS)).not.toContain("recommended");
  });

  it("every code is unique and nothing is recycled from a retired code", () => {
    const codes = ALL_SETTLEMENT_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const retired of RETIRED_SETTLEMENT_CODES) expect(codes).not.toContain(retired);
    for (const c of ALL_SETTLEMENT_CODES) expect(c.code).toMatch(/^NH-SX-[123]\d{3}$/);
  });

  it("every code names WHICH SYSTEM owns the remedy", () => {
    for (const c of ALL_SETTLEMENT_CODES) {
      expect(["billing_or_erp", "contract_or_clm", "either"]).toContain(c.ownedBy);
      expect(c.remediation.length).toBeGreaterThan(40);
    }
  });

  it("consults NO clock — checked on source, because a clock makes one file give two answers", () => {
    const src = readFileSync(resolve(__dirname, "settlementExtractValidator.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const forbidden of ["Date.now", "new Date", "performance.now"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("required facts · the file or the row is unusable", () => {
  it("a missing required COLUMN is an extract fault, and every capability reads CLOSED", () => {
    const v = validateSettlementExtract(FULL.filter((c) => c !== "settled_amount"), [row()], TERMS);
    expect(v.usable).toBe(false);
    expect(v.extractFaults.map((f) => f.code)).toContain("NH-SX-1002");
    expect(v.accepted).toHaveLength(0);
    // "we could not read the file" must never arrive as "the capability is available".
    for (const c of v.capabilities) expect(c.available).toBe(false);
  });

  it("an UNDECLARED column is refused rather than ignored", () => {
    const v = validateSettlementExtract([...FULL, "mystery_column"], [row()], TERMS);
    expect(v.usable).toBe(false);
    expect(v.extractFaults.map((f) => f.code)).toContain("NH-SX-1003");
  });

  it("a DUPLICATE column is refused — which one wins would be decided by file position", () => {
    const v = validateSettlementExtract([...FULL, "currency"], [row()], TERMS);
    expect(v.extractFaults.map((f) => f.code)).toContain("NH-SX-1004");
  });

  it("an EMPTY extract is refused and never read as 'nothing was billed'", () => {
    const v = validateSettlementExtract(FULL, [], TERMS);
    expect(v.usable).toBe(false);
    expect(v.extractFaults.map((f) => f.code)).toContain("NH-SX-1001");
  });

  it("a blank required VALUE quarantines its row and leaves the others accepted", () => {
    const v = validateSettlementExtract(FULL, [row(), row({ payer_ref: "" })], TERMS);
    expect(v.usable).toBe(true);
    expect(v.accepted).toHaveLength(1);
    expect(v.rejections.map((r) => r.code)).toEqual(["NH-SX-2001"]);
  });

  it("there is NO declared UNKNOWN amount on this side — the asymmetry is deliberate", () => {
    // What was OWED may be unknown; what was BILLED cannot be.
    const v = validateSettlementExtract(FULL, [row({ settled_amount: "" })], TERMS);
    expect(v.accepted).toHaveLength(0);
    expect(v.rejections[0]!.code).toBe("NH-SX-2001");
  });

  it("a malformed amount, date or currency quarantines the row rather than being normalised", () => {
    const v = validateSettlementExtract(FULL, [
      row({ settled_amount: "1,000.00" }), row({ settled_at: "05/03/2026" }), row({ currency: "dollars" }),
    ], TERMS);
    expect(v.accepted).toHaveLength(0);
    expect(new Set(v.rejections.map((r) => r.code))).toEqual(new Set(["NH-SX-2003", "NH-SX-2002", "NH-SX-2007"]));
  });

  it("a NEGATIVE amount not marked as a credit is refused, because it would net into billed money", () => {
    const v = validateSettlementExtract(FULL, [row({ settled_amount: "-50.00", is_credit: "false" })], TERMS);
    expect(v.rejections[0]!.code).toBe("NH-SX-2004");
    // ...and the same row marked as a credit is accepted and counted APART from billed money.
    const ok = validateSettlementExtract(FULL, [row({ settled_amount: "-50.00", is_credit: "true" })], TERMS);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.accepted[0]!.isCredit).toBe(true);
    expect(ok.creditRowCount).toBe(1);
  });

  it("ALL rows sharing a settlement-line identity are excluded, in either order", () => {
    const a = row({ invoice_ref: "inv-X", invoice_line_ref: "L1" });
    const b = row({ invoice_ref: "inv-X", invoice_line_ref: "L1", settled_amount: "999.00" });
    const forward = validateSettlementExtract(FULL, [a, b], TERMS);
    const reversed = validateSettlementExtract(FULL, [b, a], TERMS);
    expect(forward.accepted).toHaveLength(0);
    expect(reversed.accepted).toHaveLength(0);
    expect(forward.rejections).toHaveLength(2);
    expect(forward.rejections.map((r) => r.code)).toEqual(["NH-SX-2006", "NH-SX-2006"]);
    // No surviving row may be chosen by file position — the accepted population is order-invariant.
    expect(forward.accepted).toEqual(reversed.accepted);
  });

  it("a reversed settled period is refused rather than reordered", () => {
    const v = validateSettlementExtract(FULL, [row({ period_start: "2026-03-31", period_end: "2026-03-01" })], TERMS);
    expect(v.rejections[0]!.code).toBe("NH-SX-2005");
  });
});

describe("conditional facts · a capability closes and NOTHING is rejected", () => {
  it("no obligation_ref column ⇒ the link closes, every row still accepted", () => {
    const cols = FULL.filter((c) => c !== "obligation_ref");
    const v = validateSettlementExtract(cols, [row(), row()], TERMS);
    expect(v.usable).toBe(true);
    expect(v.accepted).toHaveLength(2);
    expect(v.rejections).toHaveLength(0);
    const link = v.capabilities.find((c) => c.capability === "SETTLEMENT_OBLIGATION_LINK_AVAILABLE")!;
    expect(link.available).toBe(false);
    expect(link.unavailableCode).toBe("NH-SX-3001");
  });

  it("a PARTIALLY populated obligation_ref is NOT the capability — a blank carries no information", () => {
    const link = cap(FULL, [row(), row({ obligation_ref: "" })], "SETTLEMENT_OBLIGATION_LINK_AVAILABLE");
    expect(link.available).toBe(false);
    expect(link.populatedRows).toBe(1);
    expect(link.acceptedRows).toBe(2);
  });

  it("fully populated ⇒ AVAILABLE, and the counts say so", () => {
    const link = cap(FULL, [row(), row()], "SETTLEMENT_OBLIGATION_LINK_AVAILABLE");
    expect(link.available).toBe(true);
    expect(link.unavailableCode).toBeNull();
    expect(link.populatedRows).toBe(link.acceptedRows);
  });

  it("no is_credit column ⇒ credit distinction closes, and no row becomes a credit by default", () => {
    const cols = FULL.filter((c) => c !== "is_credit");
    const v = validateSettlementExtract(cols, [row()], TERMS);
    expect(v.accepted[0]!.isCredit).toBe(false);
    expect(v.creditRowCount).toBe(0);
    expect(v.capabilities.find((c) => c.capability === "CREDIT_DISTINCTION_AVAILABLE")!.unavailableCode).toBe("NH-SX-3002");
  });

  it("no period columns ⇒ the settled period closes, and the rows keep every other fact", () => {
    const cols = FULL.filter((c) => c !== "period_start" && c !== "period_end");
    const v = validateSettlementExtract(cols, [row()], TERMS);
    expect(v.accepted).toHaveLength(1);
    expect(v.accepted[0]!.periodStart).toBeNull();
    expect(v.accepted[0]!.settledAmountMinor).toBe(10_000);
    expect(v.capabilities.find((c) => c.capability === "SETTLEMENT_PERIOD_AVAILABLE")!.unavailableCode).toBe("NH-SX-3003");
  });

  it("a REQUIRED-ONLY file is fully usable with four capabilities closed and zero rejections", () => {
    const v = validateSettlementExtract(REQUIRED_ONLY, [
      { rowNumber: 1, cells: { invoice_ref: "i1", invoice_line_ref: "L1", settled_at: "2026-03-05", settled_amount: "10.00", currency: "USD", payer_ref: "p1" } },
    ], TERMS);
    expect(v.usable).toBe(true);
    expect(v.accepted).toHaveLength(1);
    expect(v.rejections).toHaveLength(0);
    // ALL FIVE close, and naming them is more useful than counting them: a count that drifts by one
    // when a capability is added would pass while meaning something else.
    expect(v.capabilities.filter((c) => !c.available).map((c) => c.capability).sort()).toEqual([
      "CREDIT_DISTINCTION_AVAILABLE", "EXPECTED_SETTLEMENT_COUNT_AVAILABLE",
      "MIGRATION_LINEAGE_AVAILABLE", "SETTLEMENT_OBLIGATION_LINK_AVAILABLE",
      "SETTLEMENT_PERIOD_AVAILABLE",
    ]);
  });

  it("EXPECTED_SETTLEMENT_COUNT is UNAVAILABLE by construction — billing cannot state it", () => {
    const spec = SETTLEMENT_CAPABILITIES.find((c) => c.capability === "EXPECTED_SETTLEMENT_COUNT_AVAILABLE")!;
    expect(spec.fields).toEqual([]); // no column on this extract, deliberately
    const c = cap(FULL, [row()], "EXPECTED_SETTLEMENT_COUNT_AVAILABLE");
    expect(c.available).toBe(false);
    expect(c.unavailableCode).toBe("NH-SX-3005");
    expect(spec.unavailableCode.ownedBy).toBe("contract_or_clm");
  });

  it("a currency mismatch is COUNTED and never converted, and rejects no row", () => {
    const v = validateSettlementExtract(FULL, [row({ currency: "EUR" }), row()], TERMS);
    expect(v.accepted).toHaveLength(2);
    expect(v.currencyMismatchCount).toBe(1);
    expect(v.accepted.find((a) => a.currency === "EUR")!.currencyMismatch).toBe(true);
    expect(v.rejections).toHaveLength(0);
  });
});

describe("what this contract REFUSES to carry", () => {
  it("declares no expected amount, no duplicate flag, no settlement count and no grain flag", () => {
    for (const forbidden of ["expected_amount", "amount_due", "is_duplicate", "is_erroneous",
      "settlement_count", "expected_attempts", "row_grain", "grain"]) {
      expect(SETTLEMENT_EXTRACT_COLUMNS).not.toContain(forbidden);
    }
    // ...and each refusal is RECORDED with its reason, not merely absent.
    const recorded = SETTLEMENT_STOPPED_FIELDS.map((s) => s.candidate).join(" | ");
    expect(recorded).toContain("expected_amount");
    expect(recorded).toContain("is_duplicate");
    expect(recorded).toContain("settlement_count");
    expect(recorded).toContain("row-grain flag");
    for (const s of SETTLEMENT_STOPPED_FIELDS) expect(s.why.length).toBeGreaterThan(60);
  });

  it("NH NEVER DERIVES an obligation_ref — the value comes from that column and nowhere else", () => {
    // Behaviour cannot prove the absence of a derivation today's fixtures never reach, so this reads
    // the code. The FIRST form of this guard was wrong in an instructive way: it banned any assignment
    // into `obligationRef`, which fired on the validator READING its own declared column — the correct
    // behaviour. Reading the stated fact and composing one from other facts are the two things that had
    // to be told apart, and a regex over the assignment could not tell them apart at all.
    //
    // So the guard now checks the right property: the statement that produces the value may mention
    // `obligation_ref` and NO OTHER declared column. Composing from payer, amount, date, invoice
    // number, subscription id or a row position would have to name one of them, and would fail here.
    const raw = readFileSync(resolve(__dirname, "settlementExtractValidator.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const at = code.indexOf("const obligationRef");
    expect(at).toBeGreaterThan(-1);
    const statement = code.slice(at, code.indexOf(";", at));
    for (const other of SETTLEMENT_EXTRACT_COLUMNS.filter((c) => c !== "obligation_ref")) {
      expect(statement).not.toContain(other);
    }
    expect(statement).toContain("obligation_ref");
    // ...and nothing anywhere in this path writes an obligation_ref INTO a row it emits.
    for (const file of ["settlementExtractValidator.ts", "dataReadiness.ts"]) {
      const body = readFileSync(resolve(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(body).not.toMatch(/obligation_ref\s*:/);
    }
  });

  it("a derived-looking obligation_ref is still only ever READ, never written", () => {
    // The positive half: the validator surfaces exactly what the source said, unchanged.
    const v = validateSettlementExtract(FULL, [row({ obligation_ref: "  ob-trimmed  " })], TERMS);
    expect(v.accepted[0]!.obligationRef).toBe("ob-trimmed"); // trimmed, never rewritten
    const blankOut = validateSettlementExtract(FULL, [row({ obligation_ref: "   " })], TERMS);
    expect(blankOut.accepted[0]!.obligationRef).toBeNull(); // NOT STATED, never a placeholder
  });

  it("states its claim boundary · a valid extract is not evidence that billing was correct", () => {
    const v = validateSettlementExtract(FULL, [row()], TERMS);
    expect(v.claimBoundary).toEqual({ observationOnly: true, constitutesProof: false, constitutesRevenue: false });
  });
});
