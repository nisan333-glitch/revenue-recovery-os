// EP-19 · The risk scenarios, checked against the contract and the admission gate.
//
// The expectations live in `syntheticPilotDataset.ts` and are HAND-WRITTEN from the contract's rules.
// This file confronts them with what the validator and the gate actually do. That direction matters: a
// test that read the expectation back out of the code under test would pass forever, including after a
// regression, and would be a snapshot rather than a check.
//
// Where an expectation and the implementation disagree, one of them is wrong and the disagreement is
// the finding. Neither is adjusted to match the other without saying why.
import { describe, it, expect } from "vitest";
import {
  SCENARIO_POLICY,
  SYNTHETIC_PROVENANCE,
  syntheticScenario,
  syntheticScenarios,
} from "./syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";
import { validatePilotDataset } from "./validateDataset";
import { evaluateAdmission } from "./admissionGate";
import { ADMISSION_CALC_VERSION, makeAdmissionPolicy } from "./pilotAdmissionPolicy";
import { makePolicy } from "../assessment/policy";

const ASSESSMENT_POLICY = makePolicy({
  stallThresholdDays: 30,
  asOf: "2026-03-01",
  currency: "USD",
});

const ADMISSION_POLICY = makeAdmissionPolicy({
  policyId: "synthetic-scenario-bar",
  policyVersion: "1.0.0",
  calculationMethodVersion: ADMISSION_CALC_VERSION,
  ...SCENARIO_POLICY,
  requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
});

async function assess(csvText: string) {
  const report = await validatePilotDataset({
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundary: { boundaryId: "synthetic-boundary-0001", datasetId: "synthetic-scenario" },
    provenance: SYNTHETIC_PROVENANCE,
    csvText,
    policy: ASSESSMENT_POLICY,
  });
  return { report, admission: evaluateAdmission(report, ASSESSMENT_POLICY, ADMISSION_POLICY) };
}

describe("EP-19 · every scenario matches its independently stated expectation", () => {
  it.each(syntheticScenarios().map((s) => [s.id, s] as const))("%s", async (_id, scenario) => {
    const { report, admission } = await assess(scenario.csvText);
    const e = scenario.expected;

    expect(report.counts.dataRows, `${scenario.label}: dataRows`).toBe(e.dataRows);
    expect(report.counts.acceptedRows, `${scenario.label}: acceptedRows`).toBe(e.acceptedRows);
    expect(report.counts.rejectedRows, `${scenario.label}: rejectedRows`).toBe(e.rejectedRows);
    expect(report.usableForAssessment, `${scenario.label}: usableForAssessment`).toBe(
      e.usableForAssessment,
    );
    expect(admission.outcome, `${scenario.label}: admission`).toBe(e.admission);

    const codes = new Set([
      ...report.datasetFindings.map((f) => f.code),
      ...report.rowFindings.map((f) => f.code),
    ]);
    for (const code of e.codes) {
      expect([...codes], `${scenario.label}: expected ${code}`).toContain(code);
    }
  });

  it("states a reason for every scenario, so an expectation cannot be changed thoughtlessly", () => {
    for (const s of syntheticScenarios()) {
      expect(s.expected.why.trim().length, s.id).toBeGreaterThan(20);
      expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(new Set(syntheticScenarios().map((s) => s.id)).size).toBe(syntheticScenarios().length);
  });

  it("throws on an unknown scenario id rather than returning nothing", () => {
    expect(() => syntheticScenario("does-not-exist")).toThrow(/no synthetic scenario/);
    expect(syntheticScenario("valid").id).toBe("valid");
  });
});

describe("EP-19 · the scenarios are self-evidently synthetic and carry no inference", () => {
  it("prefixes every identifier so a leaked row is obviously fake", () => {
    for (const s of syntheticScenarios()) {
      const rows = s.csvText.split("\n").slice(1).filter(Boolean);
      for (const row of rows) {
        const [entity, subscription] = row.split(",");
        expect(entity, `${s.id}: ${entity}`).toMatch(/^synthetic-account-\d+$/);
        expect(subscription, `${s.id}: ${subscription}`).toMatch(/^synthetic-sub-\d+$/);
      }
    }
  });

  it("is deterministic — the same scenario twice is byte-identical", () => {
    for (const s of syntheticScenarios()) {
      expect(syntheticScenario(s.id).csvText).toBe(s.csvText);
    }
  });

  it("claims no rate, ratio or performance figure in any scenario's stated reason", () => {
    // A fixture shaped to exercise a rule says nothing about how real data behaves. If a `why` ever
    // starts quoting a percentage, someone has begun reading performance into a test fixture.
    for (const s of syntheticScenarios()) {
      expect(s.expected.why, s.id).not.toMatch(/\d+(\.\d+)?\s*%/);
      expect(s.expected.why, s.id).not.toMatch(/\bROI\b|precision|recall|causal|recovered revenue/i);
    }
  });
});

describe("EP-19 · the scenarios that carry the point of the admission gate", () => {
  it("proves one surviving row is technically usable and still refused as unfit", async () => {
    const { report, admission } = await assess(syntheticScenario("one-valid-row").csvText);
    // Both halves matter. Either alone would be a different, weaker claim.
    expect(report.usableForAssessment).toBe(true);
    expect(admission.outcome).toBe("NOT_ADMISSIBLE");
    expect(admission.admissibleForPilotAssessment).toBe(false);
    expect(admission.rates.rejection).toBeGreaterThan(SCENARIO_POLICY.maxRejectionRate);
  });

  it("excludes every colliding row regardless of the order supplied by the beneficiary", async () => {
    // THE ASSERTION THAT CARRIES THE RULE. Both layers now reject every row in a collision, so no row
    // survives because of where it sat in the file — and file order is supplied by the party who
    // benefits from the number. The reorder half below is the part that would catch a regression back
    // to "first wins": the counts alone would still pass under either rule for some datasets.
    const { report } = await assess(syntheticScenario("duplicates").csvText);
    const duplicates = report.rowFindings.filter((f) => f.code === "NH-DC-2016");
    expect(duplicates.length).toBe(6);
    expect(duplicates[0]!.detail).toMatch(/cycle id shared by data rows/);
    expect(report.counts.acceptedRows).toBe(17);
    expect(report.counts.dataRows).toBe(23);
    const { admission } = await assess(syntheticScenario("duplicates").csvText);
    expect(admission.rates.duplicate).toBeCloseTo(6 / 23, 5);
    const lines = syntheticScenario("duplicates").csvText.trim().split("\n");
    const reordered = `${lines[0]}\n${lines.slice(1).reverse().join("\n")}\n`;
    const opposite = await assess(reordered);
    expect(opposite.report.counts.acceptedRows).toBe(17);
    expect(opposite.admission.outcome).toBe(admission.outcome);
    expect(opposite.admission.rates.duplicate).toBeCloseTo(6 / 23, 5);
    expect(opposite.report.acceptedCycles.map(c => c.cycleId).sort()).toEqual(report.acceptedCycles.map(c => c.cycleId).sort());
  });

  it("keeps a reversal after the cutoff invisible at that cutoff", async () => {
    const { report } = await assess(syntheticScenario("partial-payments").csvText);
    expect(report.usableForAssessment).toBe(true);
    // The row refunded in June cannot be Refunded as-of March; the one refunded in February can.
    const refundedAt = report.acceptedCycles
      .map((c) => c.monetaryEvent.refundedAt)
      .filter((d): d is string => d !== null);
    expect(refundedAt.some((d) => d > "2026-03-01")).toBe(true); // it is recorded…
    // …and the point-in-time classifier is what must ignore it; asserted at the finding level in the
    // server matrix, where an actual execution computes the cohort.
  });

  it("reports a narrow file as valid but unfit, so 'valid' is never mistaken for 'enough'", async () => {
    const { report, admission } = await assess(syntheticScenario("narrow-coverage").csvText);
    expect(report.accepted).toBe(true);
    expect(report.counts.rejectedRows).toBe(0);
    expect(admission.outcome).toBe("NOT_ADMISSIBLE");
  });
});
