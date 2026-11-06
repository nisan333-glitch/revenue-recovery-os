// The pure half of the financial trace, falsified without a database.
//
// THE PRE-REGISTRATION IS IMPORTED, NOT TRANSCRIBED. Every expectation these tests assert is read out
// of `docs/architecture/financial-trace-preregistration.json`, whose sha256 is frozen below. An
// expectation written twice drifts silently; this repository has paid for that twice already.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADDITIVE_LEDGERS,
  FINANCIAL_TRACE_SCHEME,
  FINANCIAL_TRACE_VERSION,
  HOLDER_INDEPENDENCE_FIELDS,
  TRACE_STAGE_ORDER,
  attestationVerdict,
  buildFinancialTrace,
  canonicalFinancialTrace,
  ledgerTotals,
  type FinancialTraceInput,
  type TraceStage,
  type TraceStageName,
} from "./financialTrace";

/**
 * FROZEN BEFORE THE IMPLEMENTATION EXISTED, in commit f706202, which contains no implementation.
 *
 * Editing the pre-registration now fails this assertion rather than quietly moving the goalposts. The
 * freeze that matters is git's commit order — a lock written by the artefact it covers always agrees
 * with it — and this constant is what makes a drift loud.
 */
const PREREGISTRATION_SHA256 = "241a39f7fd7d14507db8e5a26d71c5849b70e461c963ac39385246cdd092b46f";

const PREREG_PATH = fileURLToPath(
  new URL("../../docs/architecture/financial-trace-preregistration.json", import.meta.url),
);
const PREREG_BYTES = readFileSync(PREREG_PATH);
const PREREG = JSON.parse(PREREG_BYTES.toString("utf8")) as {
  scheme: string;
  version: string;
  stages: readonly {
    stage: string;
    recordSource: string;
    expectedExecutionClass: string;
    expectedInputClass: string;
  }[];
  globalProperties: readonly { id: string; property: string; expectedCode?: string }[];
  failureScenarios: readonly {
    id: string;
    name: string;
    expectedRefusalCode?: string;
    expectedStageStatus?: string;
    expectedCorrectionState?: string;
    expectedProofVerdict?: string;
  }[];
};

const stage = (name: TraceStageName, over: Partial<TraceStage> = {}): TraceStage =>
  Object.freeze({
    stage: name,
    status: "ESTABLISHED",
    executionClass: "EXECUTED",
    inputClass: "SIMULATED",
    recordSource: "test",
    recordIds: [],
    figures: [],
    refusalCode: null,
    note: "test",
    ...over,
  });

const allStages = (over: Partial<Record<TraceStageName, Partial<TraceStage>>> = {}): TraceStage[] =>
  TRACE_STAGE_ORDER.map((n) => stage(n, over[n] ?? {}));

const input = (over: Partial<FinancialTraceInput> = {}): FinancialTraceInput => ({
  recoveryCaseId: "RC-TRACE-1",
  boundaryId: "b-1",
  currency: "USD",
  stages: allStages(),
  observedExposureMinor: 60_000,
  proofChainFigureMinor: null,
  proofIds: [],
  attestation: attestationVerdict({ receiptFields: [], verifiedSignatureCount: 0, evidenceCount: 0 }),
  identityGateRefusalCode: null,
  ...over,
});

const attested = (fields: readonly string[] = []) =>
  attestationVerdict({ receiptFields: fields, verifiedSignatureCount: 1, evidenceCount: 1 });

describe("the pre-registration governs these tests", () => {
  it("has not moved since it was frozen, before any implementation existed", () => {
    expect(createHash("sha256").update(PREREG_BYTES).digest("hex")).toBe(PREREGISTRATION_SHA256);
  });

  it("names the same scheme and version the implementation declares", () => {
    expect(PREREG.scheme).toBe(FINANCIAL_TRACE_SCHEME);
    expect(PREREG.version).toBe(FINANCIAL_TRACE_VERSION);
  });

  it("pre-registered exactly the ten stages, in this order", () => {
    expect(PREREG.stages.map((s) => s.stage)).toEqual([...TRACE_STAGE_ORDER]);
  });

  it("pre-registered six global properties and six failure scenarios", () => {
    expect(PREREG.globalProperties.map((p) => p.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(PREREG.failureScenarios.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4", "F5", "F6"]);
  });
});

describe("stage order is enforced, never trusted", () => {
  it("accepts all ten in order", () => {
    expect(buildFinancialTrace(input()).stages.map((s) => s.stage)).toEqual([...TRACE_STAGE_ORDER]);
  });

  it("refuses a missing stage — an absent stage would read as having nothing to report", () => {
    const short = allStages().filter((s) => s.stage !== "BASELINE");
    expect(() => buildFinancialTrace(input({ stages: short }))).toThrow(/all 10 stages in order/);
  });

  it("refuses a reordered trace — the same records must not tell a different causal story", () => {
    const swapped = allStages();
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(() => buildFinancialTrace(input({ stages: swapped }))).toThrow(/in order/);
  });

  it("refuses a duplicated stage", () => {
    const dup = [...allStages(), stage("PROOF")];
    expect(() => buildFinancialTrace(input({ stages: dup }))).toThrow(/in order/);
  });
});

describe("G1 · Revenue Returned is never established in this build", () => {
  it("withholds it even when a proof chain computed a figure and a signature verified", () => {
    const t = buildFinancialTrace(
      input({ proofChainFigureMinor: 50_000, proofIds: ["PF-1"], attestation: attested() }),
    );
    expect(t.revenueReturned.established).toBe(false);
    expect(t.revenueReturned.codes).toContain(
      PREREG.globalProperties.find((p) => p.id === "G1")!.expectedCode,
    );
  });

  it("carries the build-level reason FIRST, so a case-level reason can never displace it", () => {
    const t = buildFinancialTrace(input({ identityGateRefusalCode: "OBLIGATION_COVERAGE_IS_AGGREGATE" }));
    expect(t.revenueReturned.codes[0]).toBe("REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED");
    expect(t.revenueReturned.codes).toContain("NO_EFFECTIVE_RECOVERY_PROOF");
    expect(t.revenueReturned.codes).toContain("OBLIGATION_IDENTITY_GATE_REFUSED");
  });

  it("reports EVERY applicable reason rather than the most specific one", () => {
    const t = buildFinancialTrace(input({ identityGateRefusalCode: "OBLIGATION_FACTS_INCOMPLETE" }));
    expect(t.revenueReturned.codes).toHaveLength(3);
    expect(t.revenueReturned.reasons).toHaveLength(3);
  });

  it("keeps the proof chain's own figure for audit, branded and never as Revenue Returned", () => {
    const t = buildFinancialTrace(
      input({ proofChainFigureMinor: 50_000, proofIds: ["PF-1"], attestation: attested() }),
    );
    expect(t.revenueReturned.proofChainFigure?.minor).toBe(50_000);
    expect(t.revenueReturned.established).toBe(false);
  });
});

describe("G2 · null is NOT ESTABLISHED and is never a zero", () => {
  it("leaves the proof figure null rather than zero when no proof exists", () => {
    const t = buildFinancialTrace(input());
    expect(t.revenueReturned.proofChainFigure).toBeNull();
    expect(t.revenueReturned.fromProofIds).toEqual([]);
  });

  it("leaves observed exposure null rather than zero when the detector stated none", () => {
    expect(buildFinancialTrace(input({ observedExposureMinor: null })).observedExposure).toBeNull();
  });

  it("refuses to mint a proof figure from an id-less amount", () => {
    const t = buildFinancialTrace(input({ proofChainFigureMinor: 50_000, proofIds: [] }));
    expect(t.revenueReturned.proofChainFigure).toBeNull();
    expect(t.revenueReturned.codes).toContain("NO_EFFECTIVE_RECOVERY_PROOF");
  });
});

describe("G3 / F6 · figures from different ledgers are never summed", () => {
  const mixed = () =>
    buildFinancialTrace(
      input({
        stages: allStages({
          SOURCE_OBLIGATION: {
            figures: [
              { label: "expected", ledger: "SOURCE_STATED", minor: 160_000, currency: "USD" },
              { label: "billed", ledger: "SOURCE_STATED", minor: 100_000, currency: "USD" },
            ],
          },
          RECOVERY_CASE: {
            figures: [{ label: "at risk", ledger: "OBSERVED_EXPOSURE", minor: 60_000, currency: "USD" }],
          },
          BASELINE: {
            figures: [{ label: "baseline", ledger: "BASELINE", minor: 10_000, currency: "USD" }],
          },
          CORRECTION_RECORD: {
            figures: [
              { label: "undecided", ledger: "UNDECIDED_CORRECTION_MAGNITUDE", minor: 20_000, currency: "USD" },
              { label: "unorderable", ledger: "UNDECIDED_CORRECTION_MAGNITUDE", minor: null, currency: "USD" },
            ],
          },
          PROOF: {
            figures: [{ label: "proof chain", ledger: "PROVEN_REVENUE_RETURNED", minor: 50_000, currency: "USD" }],
          },
        }),
        proofChainFigureMinor: 50_000,
        proofIds: ["PF-1"],
        attestation: attested(),
      }),
    );

  it("totals the four additive ledgers and keeps them apart", () => {
    const totals = ledgerTotals(mixed());
    expect(totals.get("OBSERVED_EXPOSURE")!.total!.minor).toBe(60_000);
    expect(totals.get("BASELINE")!.total!.minor).toBe(10_000);
    expect(totals.get("UNDECIDED_CORRECTION_MAGNITUDE")!.total!.minor).toBe(20_000);
    expect(totals.get("PROVEN_REVENUE_RETURNED")!.total!.minor).toBe(50_000);
  });

  // FOUND BY RUNNING IT, NOT BY READING IT. The first form added every ledger and a real run printed
  // `SOURCE_STATED: $5,700.00` — expected plus billed plus residual plus observations plus stored plus
  // evidence, six statements about one obligation summed into a figure no record asserts. A trace built
  // to prevent that kind of number must not print one itself.
  it("refuses to total SOURCE_STATED, because those figures are statements and not a ledger", () => {
    const summary = ledgerTotals(mixed()).get("SOURCE_STATED")!;
    expect(summary.additive).toBe(false);
    expect(summary.total).toBeNull();
    expect(summary.figureCount).toBe(2);
    expect(ADDITIVE_LEDGERS).not.toContain("SOURCE_STATED");
    // And 260,000 — the sum the first form printed for this fixture — appears nowhere.
    expect(JSON.stringify([...ledgerTotals(mixed())])).not.toContain("260000");
  });

  it("counts an unestablished figure instead of adding a zero for it", () => {
    expect(ledgerTotals(mixed()).get("UNDECIDED_CORRECTION_MAGNITUDE")!.unestablishedCount).toBe(1);
  });

  it("exposes no grand total anywhere on the trace or from any export", () => {
    const t = mixed();
    // A sum across ledgers would be 400_000. It must appear in no field and in no canonical form.
    const serialized = JSON.stringify(t) + canonicalFinancialTrace(t);
    expect(serialized).not.toContain("400000");
    const totals = ledgerTotals(t);
    expect([...totals.keys()].sort()).toEqual([
      "BASELINE",
      "OBSERVED_EXPOSURE",
      "PROVEN_REVENUE_RETURNED",
      "SOURCE_STATED",
      "UNDECIDED_CORRECTION_MAGNITUDE",
    ]);
  });

  it("has no exported function whose name offers a total across ledgers", () => {
    const src = readFileSync(fileURLToPath(new URL("./financialTrace.ts", import.meta.url)), "utf8");
    const exported = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
    expect(exported).toContain("ledgerTotals");
    for (const name of exported) {
      expect(name).not.toMatch(/grandTotal|totalMoney|combinedTotal|netTotal|allLedgers/i);
    }
  });
});

describe("G4 · the canonical form is reproducible and reads no clock", () => {
  it("is identical for two traces built from the same records", () => {
    expect(canonicalFinancialTrace(buildFinancialTrace(input()))).toBe(
      canonicalFinancialTrace(buildFinancialTrace(input())),
    );
  });

  it("is stable under record-id and figure ordering, because both are sorted", () => {
    const a = buildFinancialTrace(
      input({ stages: allStages({ PROOF: { recordIds: ["PF-2", "PF-1"] } }) }),
    );
    const b = buildFinancialTrace(
      input({ stages: allStages({ PROOF: { recordIds: ["PF-1", "PF-2"] } }) }),
    );
    expect(canonicalFinancialTrace(a)).toBe(canonicalFinancialTrace(b));
  });

  it("moves when a decision moves", () => {
    const refused = buildFinancialTrace(
      input({ stages: allStages({ PROOF: { status: "REFUSED", refusalCode: "NO_EFFECTIVE_RECOVERY_PROOF" } }) }),
    );
    expect(canonicalFinancialTrace(refused)).not.toBe(canonicalFinancialTrace(buildFinancialTrace(input())));
  });

  it("excludes our prose, so a clearer sentence cannot re-identify a trace", () => {
    const a = buildFinancialTrace(input({ stages: allStages({ PROOF: { note: "one wording" } }) }));
    const b = buildFinancialTrace(input({ stages: allStages({ PROOF: { note: "another wording" } }) }));
    expect(canonicalFinancialTrace(a)).toBe(canonicalFinancialTrace(b));
  });

  it("reads no clock field at all — asserted on the source, not on one sample", () => {
    const src = readFileSync(fileURLToPath(new URL("./financialTrace.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const clock of ["verifiedAt", "ingestedAt", "issuedAt", "Date.now", "new Date", "observedAt"]) {
      expect(code).not.toContain(clock);
    }
  });
});

describe("the attestation verdict is derived from the record's shape", () => {
  it("cannot express a yes — the type permits only false", () => {
    const v = attested();
    expect(v.independentlyAttested).toBe(false);
    // @ts-expect-error `independentlyAttested` is the literal false; a true would be a reviewed change.
    const _never: { independentlyAttested: true } = v;
    void _never;
  });

  it("says NO_EVIDENCE when nothing was ingested", () => {
    expect(attestationVerdict({ receiptFields: [], verifiedSignatureCount: 0, evidenceCount: 0 }).code)
      .toBe("NO_EVIDENCE");
  });

  it("says NO_VERIFIED_SIGNATURE when evidence exists but nothing signed it", () => {
    expect(attestationVerdict({ receiptFields: [], verifiedSignatureCount: 0, evidenceCount: 2 }).code)
      .toBe("NO_VERIFIED_SIGNATURE");
  });

  it("says INDEPENDENCE_NOT_ESTABLISHABLE when a signature verified and no holder is recorded", () => {
    const v = attested(["method", "keyId", "signature", "publicKeyPem", "payloadSha256"]);
    expect(v.code).toBe("INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD");
    expect(v.holderFieldsPresent).toEqual([]);
  });

  // THE TWELFTH INSTANCE OF MY OWN RECURRING TRAP, kept in the file because it keeps recurring. The
  // first form of this check banned the words SYNTHETIC, DEMO and fixture anywhere in the module, and
  // failed on `SYNTHETIC_DISCLOSURE` — the constant whose entire job is to say the figures are
  // synthetic. A term is not a claim. The claim is that the DERIVATION does not branch on the key id's
  // content, so the guard now reads the derivation's own body.
  it("is NOT a keyId string match — the derivation never looks at a key id's content", () => {
    expect(attested(["keyId"]).code).toBe(attested(["keyId", "publicKeyPem"]).code);
    const src = readFileSync(fileURLToPath(new URL("./financialTrace.ts", import.meta.url)), "utf8");
    const body = src.slice(
      src.indexOf("export function attestationVerdict"),
      src.indexOf("// ── Revenue Returned"),
    );
    expect(body.length).toBeGreaterThan(200);
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // It may count signatures and look up declared field NAMES; it may not read a key's value.
    for (const f of ["keyId", "publicKey", "sourceSystem", "startsWith", "endsWith"]) {
      expect(code).not.toContain(f);
    }
  });

  it("reports a holder field the day one is recorded, instead of needing an edit here", () => {
    const v = attested(["keyId", "keyHolder"]);
    expect(v.holderFieldsPresent).toEqual(["keyHolder"]);
    // Still false: recording a holder is necessary evidence of independence and is not proof of it.
    expect(v.independentlyAttested).toBe(false);
  });

  it("declares the holder fields as data, so the derivation is over the real record", () => {
    expect(HOLDER_INDEPENDENCE_FIELDS.length).toBeGreaterThan(0);
    expect(HOLDER_INDEPENDENCE_FIELDS).toContain("keyHolder");
  });
});

describe("F1 · a negative residual is a liability signal, never exposure", () => {
  it("is carried as a REFUSED stage with its own code and no exposure figure", () => {
    const f1 = PREREG.failureScenarios.find((f) => f.id === "F1")!;
    const t = buildFinancialTrace(
      input({
        observedExposureMinor: null,
        stages: allStages({
          SOURCE_OBLIGATION: {
            status: "REFUSED",
            refusalCode: "NEGATIVE_RESIDUAL_NOT_EXPOSURE",
            figures: [
              { label: "expected", ledger: "SOURCE_STATED", minor: 100_000, currency: "USD" },
              { label: "billed", ledger: "SOURCE_STATED", minor: 160_000, currency: "USD" },
              { label: "residual", ledger: "SOURCE_STATED", minor: -60_000, currency: "USD" },
            ],
          },
        }),
      }),
    );
    const s = t.stages.find((x) => x.stage === "SOURCE_OBLIGATION")!;
    expect(s.status).toBe(f1.expectedStageStatus);
    expect(s.refusalCode).toBe(f1.expectedRefusalCode);
    expect(t.observedExposure).toBeNull();
    // The negative figure is PRESERVED as a source statement and reaches no NH ledger.
    expect(ledgerTotals(t).has("OBSERVED_EXPOSURE")).toBe(false);
  });
});
