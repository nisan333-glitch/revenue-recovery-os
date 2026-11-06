// The trace command's own claims, falsified without a database.
//
// These tests exist because the first form of this command ran argv, the environment, stdout and
// `process.exit` at module scope, which made its interesting properties — that a refusal about the
// REQUEST is distinguished from our own bug, and that no identifier is printed — unreachable by any
// test. The command is now a function and the entry point keeps the I/O.
import { describe, expect, it } from "vitest";
import { runTraceCommand } from "./traceCommand";
import {
  attestationVerdict,
  buildFinancialTrace,
  canonicalFinancialTrace,
  renderFinancialTrace,
  TRACE_STAGE_ORDER,
  type FinancialTrace,
  type TraceStage,
  type TraceStageName,
} from "../../src/domain/financialTrace";
import { formatMoney, money } from "../../src/domain/money";

const format = (minor: number, currency: string): string =>
  formatMoney(money(minor, currency), { exact: true });

const stage = (name: TraceStageName, over: Partial<TraceStage> = {}): TraceStage =>
  Object.freeze({
    stage: name,
    status: "ESTABLISHED",
    executionClass: "EXECUTED",
    inputClass: "SIMULATED",
    recordSource: "test_table",
    recordIds: [],
    figures: [],
    refusalCode: null,
    note: "a note long enough to be a real sentence about this stage",
    ...over,
  });

function traceWith(over: Partial<Record<TraceStageName, Partial<TraceStage>>> = {}): FinancialTrace {
  return buildFinancialTrace({
    recoveryCaseId: "RC-RENDER-1",
    boundaryId: "b-1",
    currency: "USD",
    stages: TRACE_STAGE_ORDER.map((n) => stage(n, over[n] ?? {})),
    observedExposureMinor: 60_000,
    proofChainFigureMinor: 60_000,
    proofIds: ["PF-1"],
    attestation: attestationVerdict({
      receiptFields: ["method", "keyId", "signature"],
      verifiedSignatureCount: 1,
      evidenceCount: 1,
    }),
    identityGateRefusalCode: null,
  });
}

const render = (t: FinancialTrace) => renderFinancialTrace(t, "d".repeat(64), format);

describe("the rendered report", () => {
  it("prints NOT ESTABLISHED for a null figure and never a monetary zero in its place", () => {
    const out = render(
      traceWith({
        CORRECTION_RECORD: {
          figures: [
            { label: "undecided", ledger: "UNDECIDED_CORRECTION_MAGNITUDE", minor: null, currency: "USD" },
          ],
        },
      }),
    );
    expect(out).toContain("undecided: NOT ESTABLISHED");
    expect(out).not.toContain("$0.00");
  });

  it("prints exact cents, because a report that rounds its own evidence is not evidence", () => {
    const out = render(
      traceWith({
        BASELINE: { figures: [{ label: "baseline", ledger: "BASELINE", minor: 60_000, currency: "USD" }] },
      }),
    );
    expect(out).toContain("$600.00");
    expect(out).not.toMatch(/baseline: \$600(?!\.)/);
  });

  it("puts both class fields on every stage line, so EXECUTED is never read alone", () => {
    const out = render(traceWith());
    for (const name of TRACE_STAGE_ORDER) {
      const line = out.split("\n").find((l) => l.includes(name))!;
      expect(line).toMatch(/(EXECUTED|NOT_IMPLEMENTED) \/ (SIMULATED|OBSERVED|ATTESTED|NOT_ESTABLISHABLE)/);
    }
  });

  it("says NOT ADDITIVE for a ledger of statements rather than printing their sum", () => {
    const out = render(
      traceWith({
        SOURCE_OBLIGATION: {
          figures: [
            { label: "expected", ledger: "SOURCE_STATED", minor: 160_000, currency: "USD" },
            { label: "billed", ledger: "SOURCE_STATED", minor: 100_000, currency: "USD" },
          ],
        },
      }),
    );
    expect(out).toContain("SOURCE_STATED: NOT ADDITIVE");
    expect(out).not.toContain("$2,600.00");
  });

  it("states plainly that Revenue Returned is not established, beside the proof's own figure", () => {
    const out = render(traceWith());
    expect(out).toContain("ESTABLISHED: NO");
    expect(out).toContain("WITHHELD · REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED");
    expect(out).toContain("the proof chain's own figure: $600.00");
    expect(out).toContain("independently attested: NO");
  });

  it("is deterministic, and the digest it prints is the one it was given", () => {
    const t = traceWith();
    expect(render(t)).toBe(render(t));
    expect(render(t)).toContain("d".repeat(64));
    expect(canonicalFinancialTrace(t)).toBe(canonicalFinancialTrace(t));
  });
});

describe("the command's exit codes distinguish the request from our own failure", () => {
  const stub = async () => {
    throw new Error("should not be called");
  };

  it("2 · no case id", async () => {
    const r = await runTraceCommand({ argv: [], env: { DATABASE_URL: "x" } }, stub as never);
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("no recovery case id");
  });

  it("2 · no DATABASE_URL, and it does not report an unexamined database as an empty case", async () => {
    const r = await runTraceCommand({ argv: ["RC-1"], env: {} }, stub as never);
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("NOTHING was examined");
    expect(r.output).toContain("not a case without evidence");
  });

  it("2 · no boundary", async () => {
    const r = await runTraceCommand({ argv: ["RC-1"], env: { DATABASE_URL: "x" } }, stub as never);
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("NH_TRACE_BOUNDARY is required");
  });

  it("1 · a gate refusal or a missing root is an answer about the REQUEST", async () => {
    for (const message of [
      "actor is not permitted: AuditRead",
      "recovery case RC-1 has no authoritative root",
      "actor does not hold boundary b-1",
    ]) {
      const r = await runTraceCommand(
        { argv: ["RC-1"], env: { DATABASE_URL: "x", NH_TRACE_BOUNDARY: "b-1" } },
        (async () => {
          throw new Error(message);
        }) as never,
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain("refused");
    }
  });

  it("3 · anything else is OURS, and is not reported as bad input", async () => {
    const r = await runTraceCommand(
      { argv: ["RC-1"], env: { DATABASE_URL: "x", NH_TRACE_BOUNDARY: "b-1" } },
      (async () => {
        throw new Error("Cannot read properties of undefined (reading 'minor')");
      }) as never,
    );
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain("NH_INTERNAL_ERROR");
    expect(r.output).not.toContain("refused");
  });

  it("0 · prints the rendered trace and nothing identifying", async () => {
    const t = traceWith();
    const r = await runTraceCommand(
      { argv: ["RC-RENDER-1"], env: { DATABASE_URL: "x", NH_TRACE_BOUNDARY: "b-1" } },
      (async () => ({
        scheme: "nh-financial-trace-read-v1" as const,
        trace: t,
        canonical: canonicalFinancialTrace(t),
        traceDigest: "a".repeat(64),
        correctionIdentityDigest: "b".repeat(24),
      })) as never,
    );
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("FINANCIAL TRACE");
    expect(r.output).toContain("a".repeat(64));
    expect(r.output).not.toContain("hmac-sha256:");
  });

  it("the entry point holds the I/O and the command holds none", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const command = strip(
      readFileSync(fileURLToPath(new URL("./traceCommand.ts", import.meta.url)), "utf8"),
    );
    for (const io of ["console.", "process.exit", "process.argv", "readFileSync", "prisma"]) {
      expect(command, `the command must not touch ${io}`).not.toContain(io);
    }
    const entry = strip(
      readFileSync(fileURLToPath(new URL("./financial-trace.ts", import.meta.url)), "utf8"),
    );
    expect(entry).toContain("process.exit");
    expect(entry).toContain("runTraceCommand");
  });
});
