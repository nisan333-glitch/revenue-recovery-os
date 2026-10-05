// The two sides must be INDEPENDENT, and absence must be represented BY ABSENCE.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RECONCILIATION_SCENARIOS } from "./reconciliationScenarios";
import {
  EXPECTATION_HEADER, OBSERVATION_HEADER, emitExpectationSide, emitObservationSide,
  emitTwoSided, minorToDecimal,
} from "./reconciliationEmit";

const S = RECONCILIATION_SCENARIOS;
const dataRows = (csv: string) => csv.split("\n").slice(1).filter((l) => l.trim() !== "");

describe("two-sided emission · independence", () => {
  it("each side reads ONLY its own half of the scenario", () => {
    // Blanking the observations cannot change the expectation side, and vice versa. That is the
    // property the architecture rests on: an expectation survives the total absence of billing.
    const noObs = S.map((s) => ({ ...s, o: [] as typeof s.o }));
    const noExp = S.map((s) => ({ ...s, e: [] as typeof s.e }));
    expect(emitExpectationSide(noObs)).toBe(emitExpectationSide(S));
    expect(emitObservationSide(noExp)).toBe(emitObservationSide(S));
  });

  it("the emitter module never joins the two sides — checked on CODE, not on prose", () => {
    // This check first failed against its own fixture: the slice between the two functions includes the
    // JSDoc of the SECOND one, and that comment legitimately contains "scenario.o". A structural guard
    // that reads comments is measuring documentation, so comments are stripped before matching.
    const src = readFileSync(resolve(__dirname, "reconciliationEmit.ts"), "utf8");
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const between = (from: string, to: string) => code(src.slice(src.indexOf(from), src.indexOf(to)));
    expect(between("export function emitExpectationSide", "export function emitObservationSide")).not.toMatch(/\.o\b/);
    expect(between("export function emitObservationSide", "export interface TwoSidedExtract")).not.toMatch(/\.e\b/);
  });
});

describe("two-sided emission · absence is absence", () => {
  it("a missing invoice emits NO observation row — not a zero row, not a blank row", () => {
    const missing = S.find((s) => s.id === "R01-missing-billing")!;
    expect(missing.o).toHaveLength(0);
    const only = emitObservationSide([missing]);
    expect(dataRows(only)).toHaveLength(0);
    expect(only).toBe(OBSERVATION_HEADER.join(","));
    // ...while its expectation is fully present on the other side.
    expect(dataRows(emitExpectationSide([missing]))).toHaveLength(1);
  });

  it("an UNKNOWN expected amount is an EMPTY CELL, never \"0.00\"", () => {
    const unknown = S.find((s) => s.id === "R12-proration-unknown-amount")!;
    const cells = dataRows(emitExpectationSide([unknown]))[0]!.split(",");
    const idx = EXPECTATION_HEADER.indexOf("expected_amount");
    expect(cells[idx]).toBe("");
    expect(cells[idx]).not.toBe("0.00");
  });

  it("row counts match the scenario table exactly, on both sides", () => {
    const out = emitTwoSided(S);
    expect(dataRows(out.expectationCsv)).toHaveLength(out.expectationRowCount);
    expect(dataRows(out.observationCsv)).toHaveLength(out.observationRowCount);
    expect(out.expectationRowCount).toBe(45);
    expect(out.observationRowCount).toBe(31);
  });

  it("money is written as exact decimals from integer minor units", () => {
    expect(minorToDecimal(10_000)).toBe("100.00");
    expect(minorToDecimal(200_001)).toBe("2000.01");
    expect(minorToDecimal(7_500)).toBe("75.00");
    expect(minorToDecimal(1)).toBe("0.01");
    expect(minorToDecimal(0)).toBe("0.00");
  });

  it("emission is deterministic", () => {
    expect(emitTwoSided(S).expectationCsv).toBe(emitTwoSided(S).expectationCsv);
    expect(emitTwoSided(S).observationCsv).toBe(emitTwoSided(S).observationCsv);
  });
});
