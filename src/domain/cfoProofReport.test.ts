// The CFO Proof report's pure half, with the pre-registration as the source of the expectations.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CFO_PROOF_REPORT_SCHEME,
  CFO_PROOF_REPORT_VERSION,
  buildCfoProofReport,
  canonicalCfoProofReport,
  cfoProofRow,
  cfoProofTotals,
  type CfoProofRowInput,
} from "./cfoProofReport";

/** FROZEN BEFORE THE IMPLEMENTATION EXISTED, in commit a2b07c5, which contains no implementation. */
const PREREGISTRATION_SHA256 = "0eb568b9e53532d682c1bd6b90ef9ada7d7073747b4281e8d3d673558fa6fc06";

const PREREG_BYTES = readFileSync(
  fileURLToPath(new URL("../../docs/architecture/cfo-proof-report-preregistration.json", import.meta.url)),
);
const PREREG = JSON.parse(PREREG_BYTES.toString("utf8")) as {
  scheme: string;
  version: string;
  columns: readonly { field: string }[];
  properties: readonly { id: string; property: string; expected?: number }[];
  adversarialCases: readonly { id: string; name: string }[];
};

const row = (over: Partial<CfoProofRowInput> = {}) =>
  cfoProofRow({
    recoveryCaseId: "RC-1",
    currency: "USD",
    obligationCoverage: "SINGLE_OBLIGATION",
    detectedExposureMinor: 60_000,
    disputedAmountMinor: 0,
    disputedDirection: null,
    disputedState: "SINGLE_OBSERVATION",
    proofChainFigureMinor: 60_000,
    evidenceSources: [
      { sourceSystem: "billing", trustClassification: "independent", signatureVerified: true },
    ],
    attestationCode: "INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD",
    gateVerdict: "ELIGIBLE",
    revenueReturnedWithheldCodes: ["REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED"],
    ...over,
  });

describe("the pre-registration governs these tests", () => {
  it("has not moved since it was frozen, before any implementation existed", () => {
    expect(createHash("sha256").update(PREREG_BYTES).digest("hex")).toBe(PREREGISTRATION_SHA256);
  });

  it("names the scheme, version, twelve columns, eight properties and six adversarial cases", () => {
    expect(PREREG.scheme).toBe(CFO_PROOF_REPORT_SCHEME);
    expect(PREREG.version).toBe(CFO_PROOF_REPORT_VERSION);
    expect(PREREG.columns).toHaveLength(12);
    expect(PREREG.properties.map((p) => p.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
    expect(PREREG.adversarialCases.map((a) => a.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
  });

  it("every pre-registered column exists on a built row", () => {
    const built = row() as unknown as Record<string, unknown>;
    for (const c of PREREG.columns) expect(Object.keys(built)).toContain(c.field);
  });
});

describe("P1 · the claimed collected figure is zero, and the zero is an assertion", () => {
  it("is the literal 0 on every row, with the assertion flag beside it", () => {
    const r = row();
    expect(r.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
    expect(r.claimedCollectedIsAsserted).toBe(true);
    expect(PREREG.properties.find((p) => p.id === "P1")!.property).toContain("ASSERTION");
  });

  it("the type cannot express a positive claim", () => {
    const r = row();
    // @ts-expect-error the field is the literal 0; a positive claim would be a reviewed change.
    const _never: { claimedIndependentlyEvidencedCollectedMinor: 1 } = r;
    void _never;
  });

  it("a caller cannot supply it, so a positive claim cannot arrive from outside", () => {
    const built = row({
      // @ts-expect-error not part of the row input: supplying it is a type error, not an override.
      claimedIndependentlyEvidencedCollectedMinor: 50_000,
    });
    expect(built.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
  });

  it("is never null — 'we claim nothing' is not 'nobody computed it'", () => {
    expect(row({ detectedExposureMinor: null }).claimedIndependentlyEvidencedCollectedMinor).toBe(0);
    expect(row({ proofChainFigureMinor: null }).claimedIndependentlyEvidencedCollectedMinor).toBe(0);
  });
});

describe("P2 · the open balance is the whole detected exposure", () => {
  it("equals exposure, because the claim is zero", () => {
    expect(row({ detectedExposureMinor: 60_000 }).openBalanceMinor).toBe(60_000);
    expect(row({ detectedExposureMinor: 1 }).openBalanceMinor).toBe(1);
  });

  it("is null when exposure is not established — a zero would assert the account is settled", () => {
    expect(row({ detectedExposureMinor: null }).openBalanceMinor).toBeNull();
  });

  it("is derived, so a caller cannot state a balance its own figures do not support", () => {
    const built = row({
      detectedExposureMinor: 60_000,
      // @ts-expect-error not part of the row input.
      openBalanceMinor: 0,
    });
    expect(built.openBalanceMinor).toBe(60_000);
  });

  it("is NOT reduced by a proof the chain computed", () => {
    expect(row({ detectedExposureMinor: 60_000, proofChainFigureMinor: 60_000 }).openBalanceMinor).toBe(60_000);
  });
});

describe("P3 · the disputed amount is never netted into exposure", () => {
  it("leaves exposure and the balance untouched", () => {
    const r = row({ detectedExposureMinor: 60_000, disputedAmountMinor: 20_000, disputedDirection: "UPWARD" });
    expect(r.detectedExposureMinor).toBe(60_000);
    expect(r.openBalanceMinor).toBe(60_000);
  });

  it("refuses a magnitude with no direction", () => {
    expect(() => row({ disputedAmountMinor: 20_000, disputedDirection: null })).toThrow(/must carry its direction/);
  });

  it("totals the two directions APART, with no net figure anywhere", () => {
    const rows = [
      row({ recoveryCaseId: "RC-a", disputedAmountMinor: 20_000, disputedDirection: "UPWARD" }),
      row({ recoveryCaseId: "RC-b", disputedAmountMinor: 40_000, disputedDirection: "DOWNWARD" }),
    ];
    const t = cfoProofTotals(rows, "USD");
    expect(t.disputedUpwardMinor).toBe(20_000);
    expect(t.disputedDownwardMinor).toBe(40_000);
    // 20,000 netted against 40,000 would be -20,000 or 20,000-as-net. Neither appears.
    expect(JSON.stringify(t)).not.toContain("-20000");
    expect(Object.keys(t)).not.toContain("disputedNetMinor");
  });

  it("counts an unknowable magnitude instead of totalling it as zero", () => {
    const t = cfoProofTotals([row({ disputedAmountMinor: null, disputedDirection: null })], "USD");
    expect(t.disputedNotEstablishableCount).toBe(1);
    expect(t.disputedUpwardMinor).toBeNull();
    expect(t.disputedDownwardMinor).toBeNull();
  });
});

describe("P4 · nothing presents money as collected", () => {
  it("has no field named corrected, authoritative, effective or resolved", () => {
    const src = readFileSync(fileURLToPath(new URL("./cfoProofReport.ts", import.meta.url)), "utf8");
    expect(/readonly\s+(corrected|authoritative|effective|resolved)[A-Za-z]*Minor/.test(src)).toBe(false);
  });

  it("states the claim in words, on the report", () => {
    const report = buildCfoProofReport({ boundaryId: "b-1", rows: [row()] });
    expect(report.claimStatement).toContain("$0.00");
    expect(report.claimStatement).toContain("still OPEN");
    expect(report.disclosure).toContain("no amount here was collected");
  });

  it("carries the proof chain figure for audit and the withheld codes beside it", () => {
    const r = row({ proofChainFigureMinor: 60_000 });
    expect(r.proofChainFigureMinor).toBe(60_000);
    expect(r.revenueReturnedWithheldCodes).toContain("REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED");
  });
});

describe("P5 · totals per column, and no grand total", () => {
  it("sums exposure and the open balance per column", () => {
    const rows = [
      row({ recoveryCaseId: "RC-a", detectedExposureMinor: 60_000 }),
      row({ recoveryCaseId: "RC-b", detectedExposureMinor: 40_000 }),
    ];
    const t = cfoProofTotals(rows, "USD");
    expect(t.detectedExposureMinor).toBe(100_000);
    expect(t.openBalanceMinor).toBe(100_000);
    expect(t.rowCount).toBe(2);
  });

  it("returns null rather than zero when nothing in a column is established", () => {
    const t = cfoProofTotals([row({ detectedExposureMinor: null })], "USD");
    expect(t.detectedExposureMinor).toBeNull();
    expect(t.openBalanceMinor).toBeNull();
    expect(t.exposureNotEstablishedCount).toBe(1);
  });

  it("refuses to total across currencies rather than converting", () => {
    const rows = [
      row({ recoveryCaseId: "RC-a", currency: "USD" }),
      row({ recoveryCaseId: "RC-b", currency: "EUR" }),
    ];
    const report = buildCfoProofReport({ boundaryId: "b-1", rows });
    expect(report.currency).toBeNull();
    expect(report.totals.unavailableReason).toBe("currency_disagreement");
    expect(report.totals.detectedExposureMinor).toBeNull();
    // Both rows are still REPORTED; only the sum is refused.
    expect(report.rows).toHaveLength(2);
  });

  it("has no exported function offering a total across columns", () => {
    const src = readFileSync(fileURLToPath(new URL("./cfoProofReport.ts", import.meta.url)), "utf8");
    for (const name of [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!)) {
      expect(name).not.toMatch(/grandTotal|netTotal|combined|allColumns/i);
    }
  });
});

describe("P6 · the report is reproducible", () => {
  it("is byte-identical for the same rows, and stable under row order", () => {
    const a = buildCfoProofReport({ boundaryId: "b-1", rows: [row({ recoveryCaseId: "RC-a" }), row({ recoveryCaseId: "RC-b" })] });
    const b = buildCfoProofReport({ boundaryId: "b-1", rows: [row({ recoveryCaseId: "RC-b" }), row({ recoveryCaseId: "RC-a" })] });
    expect(canonicalCfoProofReport(a)).toBe(canonicalCfoProofReport(b));
  });

  it("moves when a verdict moves", () => {
    const a = buildCfoProofReport({ boundaryId: "b-1", rows: [row()] });
    const b = buildCfoProofReport({ boundaryId: "b-1", rows: [row({ gateVerdict: "OBLIGATION_COVERAGE_IS_AGGREGATE" })] });
    expect(canonicalCfoProofReport(a)).not.toBe(canonicalCfoProofReport(b));
  });

  it("excludes our prose, so a clearer sentence cannot re-identify a report", () => {
    const report = buildCfoProofReport({ boundaryId: "b-1", rows: [row()] });
    expect(canonicalCfoProofReport(report)).not.toContain("still OPEN");
    expect(canonicalCfoProofReport(report)).not.toContain("SYNTHETIC");
  });

  it("reads no clock at all — asserted on the source", () => {
    const src = readFileSync(fileURLToPath(new URL("./cfoProofReport.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const clock of ["Date.now", "new Date", "generatedAt", "toISOString"]) {
      expect(code).not.toContain(clock);
    }
  });
});

describe("P8 / A6 · an empty boundary is not a finding that nothing is owed", () => {
  it("reports zero rows, null totals and an explicit notice", () => {
    const report = buildCfoProofReport({ boundaryId: "b-empty", rows: [] });
    expect(report.rows).toEqual([]);
    expect(report.totals.rowCount).toBe(0);
    expect(report.totals.detectedExposureMinor).toBeNull();
    expect(report.totals.openBalanceMinor).toBeNull();
    expect(report.totals.unavailableReason).toBe("no_rows");
    expect(report.emptyBoundaryNotice).toContain("NOT");
    expect(report.emptyBoundaryNotice).toContain("a finding that nothing is owed");
  });

  it("carries the notice EXACTLY when there are no rows", () => {
    expect(buildCfoProofReport({ boundaryId: "b-1", rows: [row()] }).emptyBoundaryNotice).toBeNull();
  });

  it("does not report a clean zero for an empty boundary", () => {
    const report = buildCfoProofReport({ boundaryId: "b-empty", rows: [] });
    // The claimed figure is still the asserted 0 — we claim nothing, which stays true of an empty book.
    expect(report.totals.claimedIndependentlyEvidencedCollectedMinor).toBe(0);
    // But no exposure, dispute or balance is reported as zero.
    expect([
      report.totals.detectedExposureMinor,
      report.totals.disputedUpwardMinor,
      report.totals.disputedDownwardMinor,
      report.totals.openBalanceMinor,
    ]).toEqual([null, null, null, null]);
  });
});

describe("A1 / A3 / A4 · the adversarial rows are reported, not hidden", () => {
  it("A1 · an aggregate row appears, with its coverage leading and the gate's refusal", () => {
    const r = row({ obligationCoverage: "ACCOUNT_AGGREGATE", gateVerdict: "OBLIGATION_COVERAGE_IS_AGGREGATE" });
    expect(r.obligationCoverage).toBe("ACCOUNT_AGGREGATE");
    expect(r.gateVerdict).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");
    expect(buildCfoProofReport({ boundaryId: "b-1", rows: [r] }).rows).toHaveLength(1);
  });

  it("A3 · an unorderable dispute carries null and its state, never 0", () => {
    const r = row({ disputedAmountMinor: null, disputedDirection: null, disputedState: "ORDER_NOT_ESTABLISHABLE" });
    expect(r.disputedAmountMinor).toBeNull();
    expect(r.disputedState).toBe("ORDER_NOT_ESTABLISHABLE");
  });

  it("A4 · a case with no evidence carries no sources and the NO_EVIDENCE code", () => {
    const r = row({ evidenceSources: [], attestationCode: "NO_EVIDENCE", proofChainFigureMinor: null });
    expect(r.evidenceSources).toEqual([]);
    expect(r.attestationCode).toBe("NO_EVIDENCE");
    expect(r.proofChainFigureMinor).toBeNull();
  });
});
