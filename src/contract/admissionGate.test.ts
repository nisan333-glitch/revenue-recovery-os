// EP-14 · Pilot Assessment Admission Gate — executable specification.
//
// The gap being closed is stated in the first test: one valid row among many rejected ones is
// technically usable and must NOT be pilot-admissible. Everything else pins the fail-closed
// behaviour that makes that verdict trustworthy.
import { describe, it, expect } from "vitest";
import { evaluateAdmission, ADMISSION_EVALUATOR_VERSION } from "./admissionGate";
import {
  makeAdmissionPolicy,
  validateAdmissionPolicy,
  ADMISSION_CALC_VERSION,
  type PilotAdmissionPolicy,
} from "./pilotAdmissionPolicy";
import { ALL_ADMISSION_CODES, admissionCode } from "./admissionCodes";
import { validatePilotDataset, type ContractValidationReport } from "./validateDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";
import {
  SYNTHETIC_BOUNDARY,
  SYNTHETIC_PROVENANCE,
  syntheticPilotCsv,
  syntheticPilotRows,
  syntheticViolationCases,
  toCsv,
} from "./syntheticPilotDataset";
import { makePolicy } from "../assessment/policy";

const assessmentPolicy = makePolicy({
  stallThresholdDays: 30,
  asOf: "2026-04-15",
  currency: "USD",
  excludedStatuses: [],
});

/** A complete, explicit policy. Every threshold is stated — that is the point of the type. */
function policy(over: Partial<PilotAdmissionPolicy> = {}): PilotAdmissionPolicy {
  return makeAdmissionPolicy({
    policyId: "pilot-admission-test",
    policyVersion: "1.0.0",
    calculationMethodVersion: ADMISSION_CALC_VERSION,
    minAcceptedRows: 10,
    minDistinctEntities: 5,
    maxRejectionRate: 0.2,
    maxSingleReasonShare: 0.8,
    maxDuplicateRate: 0.05,
    minCoverageDays: 20,
    requiredLifecycleStates: ["stalled", "reference"],
    maxOrderingDefectRate: 0.05,
    maxMissingRecommendedColumns: 2,
    requireProvenanceDeclaration: true,
    ...over,
  });
}

/**
 * A RAW policy object that bypasses `makeAdmissionPolicy`. Needed because the constructor refuses to
 * build an invalid policy at all — which is the desired behaviour, and which means tests about
 * invalid policies must assemble the object directly rather than through it.
 */
function rawPolicy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyId: "pilot-admission-test",
    policyVersion: "1.0.0",
    calculationMethodVersion: ADMISSION_CALC_VERSION,
    minAcceptedRows: 10,
    minDistinctEntities: 5,
    maxRejectionRate: 0.2,
    maxSingleReasonShare: 0.8,
    maxDuplicateRate: 0.05,
    minCoverageDays: 20,
    requiredLifecycleStates: ["stalled", "reference"],
    maxOrderingDefectRate: 0.05,
    maxMissingRecommendedColumns: 2,
    requireProvenanceDeclaration: true,
    ...over,
  };
}

async function reportFor(csvText: string): Promise<ContractValidationReport> {
  return validatePilotDataset({
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundary: SYNTHETIC_BOUNDARY,
    provenance: SYNTHETIC_PROVENANCE,
    csvText,
    policy: assessmentPolicy,
  });
}

describe("admission gate — the gap it closes", () => {
  it("1 · one valid row among many rejected is USABLE but NOT ADMISSIBLE", async () => {
    // The exact situation `usableForAssessment` cannot see: the file parses, one row survived, and
    // a pilot built on it would be characterising a population from a single observation.
    const good = syntheticPilotRows(1);
    const bad = syntheticViolationCases().map((c) => c.row);
    const report = await reportFor(toCsv([...good, ...bad]));

    expect(report.usableForAssessment).toBe(true); // technically usable …
    expect(report.counts.acceptedRows).toBe(1);
    expect(report.counts.rejectedRows).toBeGreaterThan(5);

    const decision = evaluateAdmission(report, assessmentPolicy, policy());
    expect(decision.outcome).toBe("NOT_ADMISSIBLE"); // … and not fit for a pilot
    expect(decision.admissibleForPilotAssessment).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2001"); // sample too small
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2003"); // rejection rate
    // The exclusions stay visible: their effect on representativeness is reported, not absorbed.
    expect(decision.rates.rejection).toBeGreaterThan(0.5);
    expect(decision.rejectionDistribution.length).toBeGreaterThan(0);
  });

  it("2 · the three verdicts stay distinct and do not overwrite one another", async () => {
    const report = await reportFor(toCsv([syntheticPilotRows(1)[0]!]));
    const decision = evaluateAdmission(report, assessmentPolicy, policy());
    expect(report.accepted).toBe(true); // structure
    expect(report.usableForAssessment).toBe(true); // a cycle survived
    expect(decision.admissibleForPilotAssessment).toBe(false); // fitness
  });
});

describe("admission gate — fail closed on policy", () => {
  it("3 · a missing policy is NOT_ASSESSABLE, never a pass", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    for (const missing of [null, undefined]) {
      const decision = evaluateAdmission(report, assessmentPolicy, missing);
      expect(decision.outcome).toBe("NOT_ASSESSABLE");
      expect(decision.admissibleForPilotAssessment).toBe(false);
      expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-1001");
      expect(decision.checks).toEqual([]); // nothing is measured against thresholds that do not exist
    }
  });

  it("4 · an unset threshold is NOT_ASSESSABLE and names the field — never treated as 'no limit'", () => {
    const incomplete = { ...policy() } as Record<string, unknown>;
    delete incomplete.maxRejectionRate;
    const defects = validateAdmissionPolicy(incomplete);
    expect(defects.map((d) => d.field)).toContain("maxRejectionRate");
    expect(defects.map((d) => d.spec.code)).toContain("NH-AG-1002");
  });

  it("4b · zero is a configured value; absence is not — the two never collapse", () => {
    // "No duplicates tolerated" is a real, deliberate choice and must be honoured as one.
    expect(validateAdmissionPolicy(rawPolicy({ maxDuplicateRate: 0 }))).toEqual([]);
    // Absence is a question nobody answered, and must never read as "no limit".
    expect(validateAdmissionPolicy(rawPolicy({ maxDuplicateRate: undefined })).map((d) => d.spec.code)).toContain("NH-AG-1002");
    // NaN is absence too, not a number that happens to compare false against everything.
    expect(validateAdmissionPolicy(rawPolicy({ maxDuplicateRate: Number.NaN })).map((d) => d.spec.code)).toContain("NH-AG-1002");
    // And a rate of exactly 0 genuinely admits a dataset with no duplicates at all.
    expect(validateAdmissionPolicy(rawPolicy({ maxRejectionRate: 0 }))).toEqual([]);
  });

  it("4c · an out-of-range threshold is NOT_ASSESSABLE rather than clamped", () => {
    expect(validateAdmissionPolicy(rawPolicy({ maxRejectionRate: 1.5 })).map((d) => d.spec.code)).toContain("NH-AG-1003");
    expect(validateAdmissionPolicy(rawPolicy({ minAcceptedRows: -1 })).map((d) => d.spec.code)).toContain("NH-AG-1003");
    expect(validateAdmissionPolicy(rawPolicy({ minAcceptedRows: 2.5 })).map((d) => d.spec.code)).toContain("NH-AG-1003");
    // The constructor refuses to build one at all — there is no partial or defaulted constructor,
    // so an invalid policy cannot exist as an object and then be quietly used.
    expect(() => makeAdmissionPolicy(rawPolicy({ maxRejectionRate: 2 }) as unknown as PilotAdmissionPolicy)).toThrow(/invalid/i);
  });

  it("4d · an out-of-range policy reaching the gate is NOT_ASSESSABLE, never measured", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(
      report,
      assessmentPolicy,
      rawPolicy({ maxRejectionRate: 1.5 }) as unknown as PilotAdmissionPolicy,
    );
    expect(decision.outcome).toBe("NOT_ASSESSABLE");
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-1003");
    expect(decision.checks).toEqual([]);
  });

  it("5 · every defect is reported at once, not one per round trip", () => {
    const bare = { policyId: "p", policyVersion: "1.0.0", calculationMethodVersion: "v" };
    const defects = validateAdmissionPolicy(bare);
    expect(defects.length).toBeGreaterThan(8);
    expect(new Set(defects.map((d) => d.field)).size).toBe(defects.length); // one per field, no repeats
  });

  it("6 · an unusable dataset is NOT_ASSESSABLE — fitness presumes a dataset that parses", async () => {
    const report = await reportFor(toCsv(syntheticViolationCases().map((c) => c.row)));
    expect(report.usableForAssessment).toBe(false);
    const decision = evaluateAdmission(report, assessmentPolicy, policy());
    expect(decision.outcome).toBe("NOT_ASSESSABLE");
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-3001");
  });
});

describe("admission gate — dataset thresholds", () => {
  it("7 · the clean synthetic pilot is ADMISSIBLE under a policy it satisfies", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(report, assessmentPolicy, policy());
    expect(decision.outcome).toBe("ADMISSIBLE");
    expect(decision.admissibleForPilotAssessment).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(decision.checks.every((c) => c.passed)).toBe(true);
    // The decision carries everything needed to re-derive it later.
    expect(decision.policyRef).toBe("pilot-admission-test@1.0.0");
    expect(decision.datasetFingerprint).toBe(report.datasetFingerprint);
    expect(decision.calculationMethodVersion).toBe(ADMISSION_EVALUATOR_VERSION);
  });

  it("8 · insufficient sample size is refused with its own code", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minAcceptedRows: 500 }));
    expect(decision.outcome).toBe("NOT_ADMISSIBLE");
    const failed = decision.checks.find((c) => c.id === "sample_size")!;
    expect(failed.passed).toBe(false);
    expect(failed.observed).toBe(40);
    expect(failed.threshold).toBe(500);
    expect(failed.direction).toBe("at_least");
  });

  it("8b · many cycles from few accounts is not a large sample", async () => {
    // Every row belongs to one entity: 20 rows, 1 account. A count of rows would call this ample.
    const rows = syntheticPilotRows(20).map((r) => ({ ...r, entity_id: "synthetic-account-0001" }));
    const report = await reportFor(toCsv(rows));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minAcceptedRows: 10, minDistinctEntities: 5 }));
    expect(decision.counts.acceptedRows).toBe(20);
    expect(decision.counts.distinctEntities).toBe(1);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2002");
  });

  it("9 · insufficient temporal coverage is refused", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minCoverageDays: 3650 }));
    const failed = decision.checks.find((c) => c.id === "coverage_days")!;
    expect(failed.passed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2006");
    // A single day of data is one day of coverage, not zero.
    const single = await reportFor(toCsv([syntheticPilotRows(1)[0]!]));
    expect(evaluateAdmission(single, assessmentPolicy, policy()).counts.coverageDays).toBe(1);
  });

  it("10 · an excessive rejection rate is refused even when many rows survive", async () => {
    const good = syntheticPilotRows(9);
    const bad = syntheticViolationCases().map((c) => c.row);
    const report = await reportFor(toCsv([...good, ...bad]));
    const decision = evaluateAdmission(
      report,
      assessmentPolicy,
      policy({ minAcceptedRows: 5, minDistinctEntities: 2, maxRejectionRate: 0.1, minCoverageDays: 1 }),
    );
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2003");
    expect(decision.rates.rejection).toBeGreaterThan(0.1);
  });

  it("10b · rejections concentrated in one reason are refused separately from the rate", async () => {
    // 4 rows, all rejected for the SAME reason: a systematic export defect, not scattered noise.
    // The defective rows are rows 17-20 of the same generator, so they collide with nothing — an
    // earlier version reused rows 1-4 and their duplicate subscription ids added a second rejection
    // reason, diluting the very concentration this test exists to measure.
    const all = syntheticPilotRows(20);
    const clean = all.slice(0, 16);
    const defective = all.slice(16).map((r) => ({ ...r, signed_at: "2026-01-05 09:30:00" }));
    const report = await reportFor(toCsv([...clean, ...defective]));
    const decision = evaluateAdmission(
      report,
      assessmentPolicy,
      policy({ minAcceptedRows: 5, minDistinctEntities: 2, maxRejectionRate: 0.9, maxSingleReasonShare: 0.5, minCoverageDays: 1 }),
    );
    expect(decision.rejectionDistribution[0]!.code).toBe("NH-DC-2005");
    expect(decision.rates.largestSingleReasonShare).toBe(1); // every rejection has one cause
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2004");
  });

  it("11 · an excessive duplicate rate is refused", async () => {
    const base = syntheticPilotRows(20);
    const report = await reportFor(toCsv([...base, ...base.slice(0, 5)])); // five pairs collide; fifteen unrelated cycles remain
    const decision = evaluateAdmission(
      report,
      assessmentPolicy,
      policy({ minAcceptedRows: 5, minDistinctEntities: 2, maxRejectionRate: 0.9, maxSingleReasonShare: 1, maxDuplicateRate: 0.1, minCoverageDays: 1 }),
    );
    expect(decision.counts.duplicateRows).toBe(10);
    expect(decision.rates.duplicate).toBeCloseTo(0.4, 5);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2005");
  });

  it("12 · a required lifecycle state that is absent is named specifically", async () => {
    // Every cycle activates promptly, so there are no stalled cycles at all — nothing to recover,
    // and nothing a recovery pilot could measure.
    const rows = syntheticPilotRows(20).map((r) => ({
      ...r,
      activation_at: r.signed_at,
      next_invoice_paid_at: r.next_invoice_due_at,
      paid_amount: r.next_invoice_amount,
      refunded: "",
      refunded_at: "",
    }));
    const report = await reportFor(toCsv(rows));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minDistinctEntities: 2, minCoverageDays: 1 }));
    expect(decision.lifecyclePresent.stalled).toBe(0);
    const failed = decision.checks.find((c) => c.id === "lifecycle_stalled")!;
    expect(failed.passed).toBe(false);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2007");
  });

  it("13 · missing recommended columns are counted against the policy's allowance", async () => {
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      syntheticPilotRows(20)
        .map((r) => `${r.entity_id},${r.signed_at},${r.next_invoice_due_at},${r.next_invoice_amount},${r.currency}`)
        .join("\n") +
      "\n";
    const report = await reportFor(csv);
    const decision = evaluateAdmission(
      report,
      assessmentPolicy,
      policy({ minDistinctEntities: 2, minCoverageDays: 1, maxMissingRecommendedColumns: 1, requiredLifecycleStates: [] }),
    );
    expect(decision.counts.missingRecommendedColumns).toBeGreaterThan(1);
    expect(decision.reasons.map((r) => r.code)).toContain("NH-AG-2009");
  });
});

describe("admission gate — integrity", () => {
  it("14 · evaluation is deterministic — the same inputs always give a byte-identical decision", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const a = evaluateAdmission(report, assessmentPolicy, policy());
    const b = evaluateAdmission(report, assessmentPolicy, policy());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // ordering included, not just deep equality
  });

  it("15 · no rejected row's CONTENT reaches the decision — only its count and code", async () => {
    const secret = "leaked.person@customer.example";
    const rows = [
      ...syntheticPilotRows(20),
      { ...syntheticPilotRows(1)[0]!, entity_id: secret, subscription_id: "synthetic-sub-leak" },
    ];
    const report = await reportFor(toCsv(rows));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minDistinctEntities: 2, minCoverageDays: 1 }));

    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("synthetic-sub-leak");
    // The rejection is still VISIBLE — as a count and a code, which is what representativeness needs.
    expect(decision.counts.rejectedRows).toBeGreaterThan(0);
    expect(decision.rejectionDistribution.map((r) => r.code)).toContain("NH-DC-3002");
  });

  it("16 · the decision creates no money, proof or revenue claim", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(report, assessmentPolicy, policy());
    expect(decision.claimBoundary).toEqual({
      judgesFitnessOnly: true,
      constitutesProof: false,
      constitutesRevenue: false,
    });
    // Assert on KEYS, not substrings: the claim boundary legitimately contains the word "proof"
    // precisely in order to say this is not one, and a substring scan cannot tell the difference
    // between carrying a value and denying it.
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          keys.push(k);
          walk(v);
        }
      }
    };
    walk(decision);
    for (const forbidden of ["revenueReturned", "auditableRevenue", "collected", "recovered", "minor", "amount", "proofId", "caseId"]) {
      expect(keys, `decision must not carry a '${forbidden}' field`).not.toContain(forbidden);
    }
    // Nothing in the decision is a monetary object either.
    expect(JSON.stringify(decision)).not.toMatch(/"currency"\s*:/);
  });

  it("17 · every admission code is unique, well-formed and carries a remediation", () => {
    const codes = ALL_ADMISSION_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const spec of ALL_ADMISSION_CODES) {
      expect(spec.code).toMatch(/^NH-AG-\d{4}$/);
      expect(spec.remediation.length).toBeGreaterThan(0);
      expect(admissionCode(spec.code)).toEqual(spec);
    }
    // The two catalogues never collide: NH-DC answers "is the file valid", NH-AG "is it fit".
    expect(codes.every((c) => c.startsWith("NH-AG-"))).toBe(true);
  });

  it("18 · a failing check always reports the measure AND the threshold it was judged against", async () => {
    const report = await reportFor(syntheticPilotCsv(40));
    const decision = evaluateAdmission(report, assessmentPolicy, policy({ minAcceptedRows: 999 }));
    for (const c of decision.checks) {
      expect(Number.isFinite(c.observed)).toBe(true);
      expect(Number.isFinite(c.threshold)).toBe(true);
      expect(["at_least", "at_most"]).toContain(c.direction);
      expect(c.passed === (c.code === null)).toBe(true); // a failed check always carries its code
    }
  });
});
