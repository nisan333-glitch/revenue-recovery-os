// The conformance barrier for stage-A DATA INTERPRETATION — the thing that makes the revision mean
// something.
//
// WHY THESE VECTORS ARE NOT A WRAPPER. The repository already has `syntheticScenarios.test.ts`, whose
// expectations are hand-written from the contract's rules, and this file does NOT re-run them: wrapping
// the same expectations in a second file would add a name, not protection. Every expected value below is
// written from the RULE as stated in source — `parse.ts`'s BOM/CRLF/quote/trim handling,
// `amountNormalize.ts`'s separator precedence, `dateNormalize.ts`'s self-disambiguation,
// `COMPATIBILITY_POLICY`'s codes, the adapter's cycle-key precedence, `dedupeCollisions`' both-rows rule
// — and never read back out of the code under test. A regression therefore cannot update itself.
//
// WHAT IT PROTECTS. A later slice will preserve 2.x semantics while 3.x diverges. The components that do
// NOT differ will be SHARED, so nothing structural stops a future edit to the parser, the mapping, a
// normalizer, a validation rule or the dedupe rule from silently changing what "2.x semantics" means. A
// pinned behaviour set is the only forcing function: such an edit must either leave these vectors
// passing, or make its author mint a new revision and preserve the old component deliberately.
//
// WHAT IT DOES NOT DO. It pins TODAY'S behaviour, including the D1 baseline — a blank `subscription_id`
// suppressing a supplied `cycle_id`. That is pinned as the CURRENT truth, not endorsed. The 3.x
// behaviour is not implemented, not declared and not tested here.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_INTERPRETATION_EXCLUSIONS,
  DATA_INTERPRETATION_REVISION,
  DATA_INTERPRETATION_SURFACE,
} from "./dataInterpretationRevision";
import { parseCsv } from "../assessment/parse";
import { applyMapping, autoDetectMapping } from "../assessment/columnMap";
import { SAAS_MAPPING_SPEC, toCycle } from "../assessment/adapters/saasActivation";
import { normalizeAmount } from "../assessment/amountNormalize";
import { normalizeDate } from "../assessment/dateNormalize";
import { assessCsv } from "../assessment/assess";
import { makePolicy } from "../assessment/policy";
import { validatePilotDataset, type DatasetSubmission } from "./validateDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";
import type { DatasetProvenance } from "./pilotDataContract";
import type { RawRow } from "../assessment/parse";

/** Which stage-A surfaces this file actually pins. Asserted against the declared surface at the end. */
const covered = new Set<string>();
const pins = (surface: string) => {
  covered.add(surface);
};

const POLICY = makePolicy({ stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" });

/** Hand-written provenance. The coverage window is explicit because row rejection depends on it. */
const PROVENANCE: DatasetProvenance = Object.freeze({
  sourceSystems: Object.freeze({ contract: "conformance", billing: "conformance", product: "conformance" }),
  dataOwnerRole: "conformance-fixture",
  extractionMethod: "hand-written stage-A conformance vector",
  extractedAt: "2026-04-01T00:00:00.000Z",
  coverageStart: "2026-01-01",
  coverageEnd: "2026-03-31",
  assertedIndependentOfBeneficiary: false,
});

const submit = (csvText: string): DatasetSubmission => ({
  declaredVersion: PILOT_DATA_CONTRACT_VERSION,
  boundary: { boundaryId: "conformance-boundary", datasetId: "stage-a-vectors" },
  provenance: PROVENANCE,
  csvText,
  policy: POLICY,
});

const raw = (cells: Record<string, string>): RawRow => ({ sourceRowId: "row-1", cells, malformed: false });
const codes = (fs: readonly { code: string }[]) => fs.map((f) => f.code);

/** Narrow the discriminated unions once, so a refusal reads as a value rather than a type error. */
const amountOf = (input: string, format?: "US" | "EU"): string => {
  const r = normalizeAmount(input, format ? { format } : {});
  return r.ok ? r.decimal : `FAIL(${r.reason})`;
};
const dateOf = (input: string, locale?: "MDY" | "DMY"): string => {
  const r = normalizeDate(input, locale ? { locale } : {});
  return r.ok ? r.iso : `FAIL(${r.reason})`;
};

const REQUIRED_HEADER = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency";
const BASE_CELLS: Record<string, string> = {
  entity_id: "acct-1",
  signed_at: "2026-01-05",
  next_invoice_due_at: "2026-02-05",
  next_invoice_amount: "100.00",
  currency: "USD",
};

// ── A · PARSING ───────────────────────────────────────────────────────────────────────────────────

describe("stage-A conformance · A · parsing", () => {
  it("strips a leading UTF-8 BOM from the first header", () => {
    pins("parsing");
    const { headers } = parseCsv("﻿entity_id,other\nacct-1,x\n");
    expect(headers).toEqual(["entity_id", "other"]);
  });

  it("normalises CRLF line endings", () => {
    pins("parsing");
    const { headers, rows } = parseCsv("a,b\r\nX,Y\r\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.cells).toEqual({ a: "X", b: "Y" });
  });

  it("trims header names", () => {
    pins("parsing");
    expect(parseCsv("  a  ,  b  \nX,Y\n").headers).toEqual(["a", "b"]);
  });

  it("keeps a comma inside a quoted field", () => {
    pins("parsing");
    const { rows } = parseCsv('a,b\n"x,1",Y\n');
    expect(rows[0]!.cells.a).toBe("x,1");
    expect(rows[0]!.cells.b).toBe("Y");
  });

  it("keeps an embedded newline inside a quoted field", () => {
    pins("parsing");
    expect(parseCsv('a,b\n"x\ny",Y\n').rows[0]!.cells.a).toBe("x\ny");
  });

  it("normalises an embedded CRLF inside a quoted field to LF", () => {
    pins("parsing");
    // CR→LF runs over the WHOLE text before records are split, so quoting does not protect a CR.
    expect(parseCsv('a,b\n"x\r\ny",Y\n').rows[0]!.cells.a).toBe("x\ny");
  });

  it('collapses an escaped double quote ("") to one', () => {
    pins("parsing");
    expect(parseCsv('a\n"x""y"\n').rows[0]!.cells.a).toBe('x"y');
  });

  it("trims every cell value", () => {
    pins("parsing");
    expect(parseCsv("a,b\n  X  ,  Y  \n").rows[0]!.cells).toEqual({ a: "X", b: "Y" });
  });

  it("fills a short row with empty strings AND flags it malformed", () => {
    pins("parsing");
    const row = parseCsv("a,b,c\nX,Y\n").rows[0]!;
    expect(row.malformed).toBe(true);
    expect(row.cells).toEqual({ a: "X", b: "Y", c: "" });
  });

  it("rejects duplicate and blank headers loudly rather than guessing", () => {
    pins("parsing");
    expect(() => parseCsv("a,a\nX,Y\n")).toThrow(/duplicate column header/);
    expect(() => parseCsv("a,\nX,Y\n")).toThrow(/empty column header/);
  });
});

// ── B · MAPPING ───────────────────────────────────────────────────────────────────────────────────

describe("stage-A conformance · B · mapping", () => {
  it("prefers an exact canonical header and does not call it a synonym match", () => {
    pins("mapping");
    const d = autoDetectMapping(["entity_id"], SAAS_MAPPING_SPEC);
    expect(d.mapping.entity_id).toBe("entity_id");
    expect(d.synonymMatched).not.toContain("entity_id");
  });

  it("matches a declared synonym and reports it as a guess", () => {
    pins("mapping");
    const d = autoDetectMapping(["customer_id"], SAAS_MAPPING_SPEC);
    expect(d.mapping.entity_id).toBe("customer_id");
    expect(d.synonymMatched).toContain("entity_id");
  });

  it("matches headers case-insensitively while preserving the source spelling", () => {
    pins("mapping");
    expect(autoDetectMapping(["Entity_Id"], SAAS_MAPPING_SPEC).mapping.entity_id).toBe("Entity_Id");
  });

  it("maps NO header to cycle_id, because cycle_id has no synonyms", () => {
    pins("mapping");
    // The D1-adjacent fact: a customer's invoice-ish column is never auto-detected as the cycle key.
    for (const header of ["invoice_id", "invoice_number", "charge_id", "obligation_id"]) {
      expect(autoDetectMapping([header], SAAS_MAPPING_SPEC).mapping.cycle_id, header).toBeUndefined();
    }
  });

  it("re-keys to canonical names while preserving the original keys", () => {
    pins("mapping");
    const parsed = parseCsv("customer_id\nacct-1\n");
    const mapped = applyMapping(parsed, autoDetectMapping(parsed.headers, SAAS_MAPPING_SPEC).mapping);
    expect(mapped.rows[0]!.cells.entity_id).toBe("acct-1");
    expect(mapped.rows[0]!.cells.customer_id).toBe("acct-1");
  });

  it("yields an empty string for a canonical field whose source column is absent", () => {
    pins("mapping");
    const mapped = applyMapping(parseCsv("a\nX\n"), { entity_id: "entity_id" });
    expect(mapped.rows[0]!.cells.entity_id).toBe("");
  });
});

// ── C · NORMALIZATION ─────────────────────────────────────────────────────────────────────────────

describe("stage-A conformance · C · normalization · amounts", () => {
  it("refuses a single separator with a 3-digit tail when no format is declared", () => {
    pins("normalization");
    const r = normalizeAmount("1.200");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous_amount");
  });

  it("resolves that ambiguity by the DECLARED format, in both directions", () => {
    pins("normalization");
    expect(amountOf("1.200", "US")).toBe("1.200");
    expect(amountOf("1.200", "EU")).toBe("1200");
  });

  it("treats the LAST-occurring separator as the decimal point when both appear", () => {
    pins("normalization");
    expect(amountOf("1,234.56")).toBe("1234.56");
    expect(amountOf("1.234,56")).toBe("1234.56");
  });

  it("reads matched parentheses as an accounting negative", () => {
    pins("normalization");
    expect(amountOf("(1.234,56)")).toBe("-1234.56");
  });

  it("strips an ISO currency code and a currency symbol", () => {
    pins("normalization");
    expect(amountOf("USD 1,200.00")).toBe("1200.00");
  });

  it("treats a single separator with a non-3-digit tail as the decimal point", () => {
    pins("normalization");
    expect(amountOf("100.00")).toBe("100.00");
  });

  it("refuses a value carrying anything but digits and the two separators", () => {
    pins("normalization");
    const r = normalizeAmount("1,2a0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_amount");
  });
});

describe("stage-A conformance · C · normalization · dates", () => {
  it("accepts ISO and drops any time component to day granularity", () => {
    pins("normalization");
    expect(dateOf("2026-02-01")).toBe("2026-02-01");
    expect(dateOf("2026-02-01T10:30:00Z")).toBe("2026-02-01");
  });

  it("refuses an ambiguous numeric date when no locale is declared", () => {
    pins("normalization");
    const r = normalizeDate("03/04/2026");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous_date");
  });

  it("resolves that ambiguity by the DECLARED locale, in both directions", () => {
    pins("normalization");
    expect(dateOf("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(dateOf("03/04/2026", "DMY")).toBe("2026-04-03");
  });

  it("self-disambiguates when exactly one part exceeds 12, with no locale needed", () => {
    pins("normalization");
    expect(dateOf("25/12/2026")).toBe("2026-12-25");
  });

  it("accepts a month-name form and zero-pads the ISO output", () => {
    pins("normalization");
    expect(dateOf("2 Jan 2026")).toBe("2026-01-02");
  });
});

// ── D · VALIDATION ────────────────────────────────────────────────────────────────────────────────

describe("stage-A conformance · D · validation", () => {
  it("accepts a representative minimal valid row", async () => {
    pins("validation");
    const report = await validatePilotDataset(submit(`${REQUIRED_HEADER}\nacct-1,2026-01-05,2026-02-05,100.00,USD\n`));
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    expect(report.counts.dataRows).toBe(1);
    expect(report.counts.acceptedRows).toBe(1);
    expect(report.counts.rejectedRows).toBe(0);
  });

  it("rejects a ROW carrying a wall-clock timestamp with no UTC offset", async () => {
    pins("validation");
    const report = await validatePilotDataset(
      submit(`${REQUIRED_HEADER}\nacct-1,2026-01-05T10:00,2026-02-05,100.00,USD\n`),
    );
    expect(codes(report.rowFindings)).toContain("NH-DC-2005");
    expect(report.counts.rejectedRows).toBe(1);
    expect(report.counts.acceptedRows).toBe(0);
    expect(report.usableForAssessment).toBe(false);
  });

  it("rejects the DATASET for an undeclared column, and yields no cycles", async () => {
    pins("validation");
    const report = await validatePilotDataset(
      submit(`${REQUIRED_HEADER},extra_column\nacct-1,2026-01-05,2026-02-05,100.00,USD,anything\n`),
    );
    expect(codes(report.datasetFindings)).toContain("NH-DC-1005");
    expect(report.accepted).toBe(false);
    expect(report.acceptedCycles).toEqual([]);
  });

  it("rejects a row whose obligation date falls outside the declared coverage window", async () => {
    pins("validation");
    const report = await validatePilotDataset(
      submit(`${REQUIRED_HEADER}\nacct-1,2026-01-05,2026-06-05,100.00,USD\n`),
    );
    expect(codes(report.rowFindings)).toContain("NH-DC-2021");
    expect(report.counts.acceptedRows).toBe(0);
  });
});

// ── E · CYCLE-KEY DERIVATION — TODAY'S D1 BASELINE ────────────────────────────────────────────────

describe("stage-A conformance · E · cycle-key derivation", () => {
  const cycleIdOf = (cells: Record<string, string>) => {
    const out = toCycle(raw(cells), POLICY);
    return out.kind === "cycle" ? out.cycle.cycleId : `EXCLUDED(${out.exclusion.reason})`;
  };

  it("D1 BASELINE · a BLANK subscription_id suppresses a supplied cycle_id", () => {
    pins("cycle_key_derivation");
    // PINNED AS TODAY'S TRUTH, NOT ENDORSED. `""` is not nullish, so `??` never reaches `cycle_id` and
    // the key falls through to the date composite. This is defect D1. A later MAJOR changes it; until
    // then, a change here is a regression and must fail.
    expect(cycleIdOf({ ...BASE_CELLS, subscription_id: "", cycle_id: "CYC-7" })).toBe(
      "acct-1|2026-01-05|2026-02-05",
    );
  });

  it("an ABSENT subscription_id column DOES reach cycle_id — the difference D1 turns on", () => {
    pins("cycle_key_derivation");
    expect(cycleIdOf({ ...BASE_CELLS, cycle_id: "CYC-7" })).toBe("CYC-7");
  });

  it("a POPULATED subscription_id is the cycle key, and cycle_id is ignored", () => {
    pins("cycle_key_derivation");
    // Unchanged by the future D1 cutover in BOTH interpretations. Two invoices of one subscription
    // therefore still collide — that is D2, untouched here.
    expect(cycleIdOf({ ...BASE_CELLS, subscription_id: "SUB-1", cycle_id: "CYC-7" })).toBe("SUB-1");
  });

  it("derives the date composite when neither key is present", () => {
    pins("cycle_key_derivation");
    expect(cycleIdOf(BASE_CELLS)).toBe("acct-1|2026-01-05|2026-02-05");
  });
});

// ── F · DEDUPE ────────────────────────────────────────────────────────────────────────────────────

describe("stage-A conformance · F · dedupe", () => {
  it("excludes EVERY row sharing a cycle identity, never choosing a winner", async () => {
    pins("dedupe");
    // Two genuinely different obligations of one subscription. Both are discarded and the money reads
    // zero. Pinned because the both-rows rule is a constitutional anti-tuning requirement: no surviving
    // row may be chosen by file position.
    const result = await assessCsv(
      [
        `${REQUIRED_HEADER},subscription_id`,
        "acct-1,2026-01-05,2026-02-05,500.00,USD,SUB-1",
        "acct-1,2026-01-05,2026-03-05,300.00,USD,SUB-1",
      ].join("\n"),
      POLICY,
      { createdAt: "2026-04-15T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(0);
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").length).toBe(2);
    expect(result.observed.observedUnpaid.minor).toBe(0);
  });
});

// ── G · COMPLETE STAGE-A OUTCOME ──────────────────────────────────────────────────────────────────

describe("stage-A conformance · G · end-to-end stage-A outcome", () => {
  it("pins counts, codes, usability and the surviving cycle identities together", async () => {
    pins("validation");
    pins("cycle_key_derivation");
    const report = await validatePilotDataset(
      submit(
        [
          `${REQUIRED_HEADER},subscription_id`,
          "acct-1,2026-01-05,2026-02-05,100.00,USD,SUB-1",
          "acct-2,2026-01-06,2026-02-06,200.00,USD,SUB-2",
          "acct-3,2026-01-07,2026-02-07,300.00,USD,SUB-3",
          "acct-4,2026-01-08T09:00,2026-02-08,400.00,USD,SUB-4",
        ].join("\n"),
      ),
    );
    expect(report.counts.dataRows).toBe(4);
    expect(report.counts.acceptedRows).toBe(3);
    expect(report.counts.rejectedRows).toBe(1);
    expect(codes(report.rowFindings)).toContain("NH-DC-2005");
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    expect(report.acceptedCycles.map((c) => c.cycleId)).toEqual(["SUB-1", "SUB-2", "SUB-3"]);
  });
});

// ── THE REVISION ITSELF ───────────────────────────────────────────────────────────────────────────

describe("stage-A revision · identity and inertness", () => {
  it("names a semantic revision, derived from no build, package, clock or component version", () => {
    expect(DATA_INTERPRETATION_REVISION).toBe("nh-data-interpretation-2x-r1");
    for (const forbidden of ["csv-2026.1", "2026.1", "assess-", "admission-", PILOT_DATA_CONTRACT_VERSION]) {
      expect(DATA_INTERPRETATION_REVISION, forbidden).not.toContain(forbidden);
    }
  });

  it("declares exactly one revision — no 3.x semantics are asserted yet", () => {
    expect(DATA_INTERPRETATION_REVISION).toMatch(/-2x-r1$/);
    expect(DATA_INTERPRETATION_REVISION).not.toMatch(/3x/);
  });

  it("excludes the other stages by name, not merely by omission", () => {
    expect([...DATA_INTERPRETATION_EXCLUSIONS]).toEqual([
      "admission_evaluation",
      "assessment_calculation",
      "candidate_semantics",
      "proof_semantics",
      "build_version",
    ]);
  });

  it("pins at least one vector for EVERY declared stage-A surface", () => {
    // A surface declared but unpinned is a gap this test reports rather than a claim the comment makes.
    const unpinned = DATA_INTERPRETATION_SURFACE.filter((s) => !covered.has(s));
    expect(unpinned, `unpinned stage-A surfaces: ${unpinned.join(", ")}`).toEqual([]);
  });

  it("has NO runtime importer outside this test — the revision is inert in this slice", () => {
    const roots = ["src", "server"].map((r) => join(__dirname, "..", "..", r));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "node_modules") walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
        if (entry === "dataInterpretationRevision.test.ts") continue; // the only permitted importer
        if (/dataInterpretationRevision/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders, `unexpected importers: ${offenders.join(", ")}`).toEqual([]);
  });

  it("imports nothing at all in the production module", () => {
    const code = readFileSync(join(__dirname, "dataInterpretationRevision.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!)).toEqual([]);
  });
});
