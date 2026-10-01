// 2.1.0 · The observation must be inert, and must never read as a green light.
//
// The sharpest test in here is "an aggregated export looks CLEAN": it demonstrates, executably, that grain
// completeness has no observable predicate. If that test ever starts failing because someone added a
// predicate, read docs/OBLIGATION_IDENTITY_V1.md before celebrating.
import { describe, expect, it } from "vitest";
import {
  observeObligationReferences,
  OBLIGATION_OBSERVATION_VERSION,
  OBLIGATION_REF_ATTRIBUTE,
} from "./obligationObservation";
import type { ExpectationCycle } from "../assessment/types";
import { validatePilotDataset, type DatasetSubmission } from "./validateDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";
import { SYNTHETIC_BOUNDARY, SYNTHETIC_PROVENANCE } from "./syntheticPilotDataset";
import { makePolicy } from "../assessment/policy";
import { money } from "../domain/money";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" });

/** A stalled, unpaid cycle — so it CONTRIBUTES value and therefore participates in the shadow run. */
function stalled(id: string, entityId: string, amountMinor: number, ref?: string): ExpectationCycle {
  return {
    cycleId: id,
    sourceRowId: `row-${id}`,
    entityId,
    expectationAt: "2026-01-01",
    observationAt: null,
    currency: "USD",
    statusRaw: null,
    attributes: ref === undefined ? {} : { [OBLIGATION_REF_ATTRIBUTE]: ref },
    monetaryEvent: {
      dueAt: "2026-02-01",
      amount: money(amountMinor, "USD"),
      paidAt: null,
      paidAmount: null,
      refundedAt: null,
      cancelledAt: null,
    },
  };
}

const observe = (acceptedCycles: readonly ExpectationCycle[], rowsLostToCycleCollision = 0) =>
  observeObligationReferences({ acceptedCycles, rowsLostToCycleCollision, policy });

/** Run the real contract path, and translate its collision findings exactly as a caller would. */
async function observeCsv(csvText: string) {
  const submission: DatasetSubmission = {
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundary: SYNTHETIC_BOUNDARY,
    provenance: SYNTHETIC_PROVENANCE,
    csvText,
    policy,
  };
  const report = await validatePilotDataset(submission);
  const rowsLostToCycleCollision = report.rowFindings.filter((f) => f.code === "NH-DC-2016").length;
  return {
    report,
    observation: observeObligationReferences({
      acceptedCycles: report.acceptedCycles,
      rowsLostToCycleCollision,
      policy,
    }),
  };
}

const header = "entity_id,subscription_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,obligation_ref";

describe("2.1.0 · obligation reference observation", () => {
  it("is inert — the claim boundary denies identity, grain and emission structurally", () => {
    const obs = observe([stalled("c1", "acct-a", 50_000, "INV-1")]);
    expect(obs.rule).toBe(OBLIGATION_OBSERVATION_VERSION);
    expect(obs.claimBoundary).toEqual({
      observationOnly: true,
      establishesObligationIdentity: false,
      establishesRowGrain: false,
      enablesCandidateEmission: false,
    });
    // No key anywhere that could be mistaken for money or for a verdict.
    for (const forbidden of ["amount", "totalAtRisk", "admissible", "candidate", "proof", "revenue"]) {
      expect(Object.keys(obs)).not.toContain(forbidden);
    }
  });

  it("NEVER returns an empty blocker list — row grain can never be cleared by any file", () => {
    // Two distinct obligations of one account, both referenced, nothing malformed, nothing lost. As clean
    // as a population gets — and still blocked, because grain is a customer assertion.
    const clean = observe([stalled("c1", "acct-a", 50_000, "INV-1"), stalled("c2", "acct-a", 30_000, "INV-2")]);
    expect(clean.cyclesWithoutReference).toBe(0);
    expect(clean.malformedReferences).toBe(0);
    expect(clean.rowsLostToCycleCollision).toBe(0);
    expect(clean.shadowAmbiguousReferences).toBe(0);
    expect(clean.blockers).toEqual(["row_grain_unverifiable"]);
  });

  it("CANNOT see an aggregated row — the class-C finding, demonstrated rather than asserted", async () => {
    // ONE reality, TWO exports of it.
    //
    // TRUTH: two obligations of 500 and 300, each with its own reference.
    const truth = await observeCsv(
      [
        header,
        "acct-1,SUB-1,2026-01-01,2026-02-01,500.00,USD,INV-1001",
        "acct-1,SUB-2,2026-01-01,2026-03-01,300.00,USD,INV-1002",
      ].join("\n"),
    );
    // AGGREGATED: the customer's export rolled both into one row under ONE of the two references.
    const aggregated = await observeCsv(
      [header, "acct-1,SUB-1,2026-01-01,2026-02-01,800.00,USD,INV-1001"].join("\n"),
    );

    // The two populations are genuinely different: one obligation has disappeared, and its money is now
    // attributed to a reference that does not own it.
    expect(truth.observation.acceptedCycles).toBe(2);
    expect(truth.observation.distinctReferences).toBe(2);
    expect(aggregated.observation.acceptedCycles).toBe(1);
    expect(aggregated.observation.distinctReferences).toBe(1);

    // And NOTHING reports the difference. Both files are accepted, neither loses a row to a collision,
    // neither has a malformed or ambiguous or missing reference, and both carry the same single blocker.
    expect(truth.report.accepted).toBe(true);
    expect(aggregated.report.accepted).toBe(true);
    expect(aggregated.observation.rowsLostToCycleCollision).toBe(0);
    expect(aggregated.observation.malformedReferences).toBe(0);
    expect(aggregated.observation.cyclesWithoutReference).toBe(0);
    expect(aggregated.observation.shadowAmbiguousReferences).toBe(0);
    expect(aggregated.observation.blockers).toEqual(["row_grain_unverifiable"]);
    expect(truth.observation.blockers).toEqual(["row_grain_unverifiable"]);

    // That is the class-C finding: an aggregated export is clean by every predicate that exists, so the
    // blocker has to be unconditional. There is nothing else to report it with.
  });

  it("reports a partial population as incomplete rather than keying the part that is keyable", () => {
    const obs = observe([stalled("c1", "acct-a", 50_000, "INV-1"), stalled("c2", "acct-b", 30_000)]);
    expect(obs.cyclesWithReference).toBe(1);
    expect(obs.cyclesWithoutReference).toBe(1);
    expect(obs.blockers).toContain("reference_incomplete");
    // The unkeyed cycle CONTRIBUTES, so the shadow run reports it rather than quietly omitting it.
    expect(obs.shadowUnresolvedContributingCycles).toBe(1);
  });

  it("reports one reference claimed by two contributing cycles — the split direction it CAN see", () => {
    const obs = observe([
      stalled("c1", "acct-a", 50_000, "INV-SAME"),
      stalled("c2", "acct-a", 30_000, "INV-SAME"),
    ]);
    expect(obs.distinctReferences).toBe(1);
    expect(obs.referencesOnMoreThanOneCycle).toBe(1);
    expect(obs.shadowAmbiguousReferences).toBe(1);
    expect(obs.blockers).toContain("reference_ambiguous");
  });

  it("reports a malformed reference without dropping it from the counts", () => {
    const obs = observe([
      stalled("c1", "acct-a", 50_000, "has a space"),
      stalled("c2", "acct-b", 30_000, "INV-2"),
    ]);
    expect(obs.cyclesWithReference).toBe(2);
    expect(obs.malformedReferences).toBe(1);
    expect(obs.blockers).toContain("reference_malformed");
  });

  it("surfaces obligations ALREADY LOST to a cycle collision, which no reference can rescue", () => {
    const obs = observe([], 2);
    expect(obs.acceptedCycles).toBe(0);
    expect(obs.rowsLostToCycleCollision).toBe(2);
    expect(obs.blockers).toContain("obligations_lost_to_cycle_collision");
    expect(obs.blockers).toContain("no_reference_present");
  });

  it("END TO END · two real obligations of one subscription are lost BEFORE the reference is read", async () => {
    // The whole reason emission stays disabled. Two genuine invoices, two distinct references, one
    // subscription id — and nothing survives, because the cycle-key collision pass runs first.
    const { report, observation } = await observeCsv(
      [
        header,
        "acct-1,SUB-1,2026-01-01,2026-02-01,500.00,USD,INV-1001",
        "acct-1,SUB-1,2026-01-01,2026-03-01,300.00,USD,INV-1002",
      ].join("\n"),
    );
    expect(report.acceptedCycles.length).toBe(0);
    expect(report.rowFindings.filter((f) => f.code === "NH-DC-2016").length).toBe(2);

    expect(observation.acceptedCycles).toBe(0);
    expect(observation.cyclesWithReference).toBe(0);
    expect(observation.rowsLostToCycleCollision).toBe(2);
    // Both references were present and well formed in the file, and neither reached the population.
    expect(observation.blockers).toContain("obligations_lost_to_cycle_collision");
  });

  it("END TO END · references survive onto accepted cycles when the cycle keys do not collide", async () => {
    const { observation } = await observeCsv(
      [
        header,
        "acct-1,SUB-1,2026-01-01,2026-02-01,500.00,USD,INV-1001",
        "acct-2,SUB-2,2026-01-01,2026-02-01,300.00,USD,INV-1002",
      ].join("\n"),
    );
    expect(observation.acceptedCycles).toBe(2);
    expect(observation.cyclesWithReference).toBe(2);
    expect(observation.distinctReferences).toBe(2);
    expect(observation.rowsLostToCycleCollision).toBe(0);
    expect(observation.shadowAttributions).toBe(2);
    expect(observation.blockers).toEqual(["row_grain_unverifiable"]);
  });

  it("is total on an empty population rather than throwing", () => {
    const obs = observe([]);
    expect(obs.acceptedCycles).toBe(0);
    expect(obs.shadowAttributions).toBe(0);
    expect(obs.blockers).toEqual(["no_reference_present", "row_grain_unverifiable"]);
  });
});
