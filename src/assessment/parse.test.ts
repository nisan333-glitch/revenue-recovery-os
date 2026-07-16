import { describe, it, expect } from "vitest";
import { parseCsv } from "./parse";

describe("parseCsv — quotes, CRLF, ragged rows", () => {
  it("maps cells by header and preserves row identity", () => {
    const p = parseCsv("a,b\n1,2\n3,4");
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rows[0]).toMatchObject({ sourceRowId: "row-1", cells: { a: "1", b: "2" }, malformed: false });
    expect(p.rows[1]!.sourceRowId).toBe("row-2");
  });

  it("handles quoted fields, escaped quotes and embedded commas/newlines", () => {
    const p = parseCsv('name,note\r\n"Acme, Inc","line1\nline2"\r\n"He said ""hi""",ok');
    expect(p.rows[0]!.cells).toEqual({ name: "Acme, Inc", note: "line1\nline2" });
    expect(p.rows[1]!.cells).toEqual({ name: 'He said "hi"', note: "ok" });
  });

  it("flags ragged rows as malformed (never silently dropped)", () => {
    const p = parseCsv("a,b,c\n1,2\n1,2,3,4");
    expect(p.rows[0]!.malformed).toBe(true);
    expect(p.rows[1]!.malformed).toBe(true);
  });

  it("ignores blank trailing lines", () => {
    const p = parseCsv("a,b\n1,2\n\n");
    expect(p.rows).toHaveLength(1);
  });

  it("strips a leading UTF-8 BOM so an Excel-exported CSV parses identically", () => {
    const plain = "entity_id,amount\nE1,100\nE2,200";
    const withBom = String.fromCharCode(0xfeff) + plain;
    expect(parseCsv(withBom)).toEqual(parseCsv(plain));
    expect(parseCsv(withBom).headers[0]).toBe("entity_id"); // not the BOM-prefixed header
  });
});
