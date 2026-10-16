import { describe, expect, it } from "vitest";
import { parseStrictCsv } from "./csvPairTransport";

describe("local CSV pair transport (no inference)", () => {
  it("parses CRLF, quoted commas, doubled quotes and multiline cells", () => {
    const parsed = parseStrictCsv('\uFEFFid,note,amount\r\n"a,1","hello ""world""\nnext",12.34\r\n');
    expect(parsed.header).toEqual(["id", "note", "amount"]);
    expect(parsed.rows).toEqual([{ rowNumber: 2, cells: { id: "a,1", note: 'hello "world"\nnext', amount: "12.34" } }]);
  });
  it("keeps blank amounts blank, never zero", () => {
    expect(parseStrictCsv("id,expected_amount\na,\n").rows[0]!.cells.expected_amount).toBe("");
  });
  it.each([
    ["id,id\na,b\n", "CSV_DUPLICATE_HEADER"],
    ["id,amount\na\n", "CSV_RAGGED_RECORD"],
    ["id\n\n", "CSV_EMPTY_RECORD"],
    ['id\n"unclosed\n', "CSV_UNCLOSED_QUOTE"],
    ['id\n"a"x\n', "CSV_TRAILING_AFTER_QUOTE"],
    ["id\na\0b\n", "CSV_NUL_BYTE"],
    ["", "CSV_NO_HEADER"],
    ["id\na\n\nb\n", "CSV_EMPTY_RECORD"],
  ])("fails closed on malformed input: %s", (csv, code) => {
    expect(() => parseStrictCsv(csv)).toThrow(code);
  });
  it("enforces a bounded row count", () => {
    expect(() => parseStrictCsv("id\na\nb\n", 1)).toThrow("CSV_ROW_LIMIT");
  });
});
