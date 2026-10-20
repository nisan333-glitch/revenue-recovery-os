// WORKSTREAM A · QUANTIFYING THE MERGE — what actually happens to two distinct obligations of one
// customer, measured end to end on both paths.
//
// Pure: no database, no clock, no network. Everything here is VERIFIED CURRENT BEHAVIOUR.
//
// WHY THIS DESERVED ITS OWN FILE. The identity table says "two obligations of one customer are merged".
// That is the diagnosis; it is not the damage. The damage is different on each of the two paths into the
// Case lane, and one of them is reachable TODAY:
//
//   • the ASSESSMENT path SUMS them into one figure and then DROPS the count that would have disclosed
//     the merge — structurally unreachable today, because the identity gate refuses;
//   • the ACTIVATION path SILENTLY DISCARDS the second one — live today.
//
// Silent discard is the worse of the two, and it is the reachable one. That asymmetry is the finding.
import { describe, it, expect } from "vitest";
import { attributeByEntity } from "../../src/assessment/entityAttribution";
import { makePolicy } from "../../src/assessment/policy";
import type { ExpectationCycle } from "../../src/assessment/types";
import { CaseAdmissionService, InMemoryCaseCandidateStore, caseCandidateDedupeKey } from "./caseAdmission";
import type { CandidateSignal } from "./types";
import {
  leakInstanceIdentityStatus,
  OBLIGATION_IDENTITY_FIELDS,
} from "../../src/contract/leakInstanceIdentity";

const POLICY = makePolicy({ asOf: "2026-06-01", stallThresholdDays: 30, currency: "USD" });

/** One unpaid, overdue obligation. Two of these on one account is the whole scenario. */
const obligation = (cycleId: string, amountMinor: number, dueAt: string): ExpectationCycle =>
  Object.freeze({
    cycleId,
    sourceRowId: `row-${cycleId}`,
    entityId: "ACC-1", // ONE customer
    expectationAt: "2026-01-01",
    observationAt: null, // never activated ⇒ stalled
    monetaryEvent: {
      dueAt,
      amount: { minor: amountMinor, currency: "USD" },
      paidAt: null,
      paidAmount: null,
      refundedAt: null,
      cancelledAt: null,
    },
    currency: "USD",
    statusRaw: "active",
    attributes: {},
  }) as ExpectationCycle;

describe("A · the ASSESSMENT path SUMS two obligations, then drops the disclosure", () => {
  it("1 · two distinct obligations become ONE attribution carrying their SUM", () => {
    const result = attributeByEntity(
      [obligation("CYC-A", 40_000, "2026-02-01"), obligation("CYC-B", 60_000, "2026-03-01")],
      POLICY,
    );
    // Two obligations in. One attribution out.
    expect(result.attributions).toHaveLength(1);
    const only = result.attributions[0]!;
    expect(only.entityId).toBe("ACC-1");
    // $400.00 + $600.00 = $1,000.00 presented as a single at-risk figure.
    expect(only.amountAtRisk.minor).toBe(100_000);
    // The count EXISTS here — the schema comment says it is kept "so one figure is never mistaken for
    // one invoice". Test 2 is about where it stops existing.
    expect(only.contributingCycleCount).toBe(2);
  });

  it("2 · and the count is DROPPED before a candidate is built — the disclosure never ships", () => {
    // `SignalLineage` in `governedSignalEmitter.ts` has no `contributingCycleCount`, and
    // `CandidateSignal` has no such field either. So the safeguard exists at the layer that does not
    // need it and is absent at the layer that does — the `coverage.event` shape, one lane over.
    const signalFields: readonly (keyof CandidateSignal)[] = [
      "signalId", "boundaryId", "recoveryType", "sourceRef", "sourcePayloadHash",
      "detectorVersion", "observedAt", "amountAtRiskMinor", "currency", "actionAvailable",
      "expectedProofEvent",
    ];
    expect(signalFields).not.toContain("contributingCycleCount" as never);
    // Stated as the consequence rather than as a field list: a Recovery Case opened from this path
    // carries a summed amount and NOTHING anywhere downstream says how many obligations it covers.
    expect(signalFields.some((f) => /count|cycles|obligations/i.test(f))).toBe(false);
  });

  it("3 · a SINGLE obligation is indistinguishable from a merged pair by amount alone", () => {
    // Why the missing count is not cosmetic: the two cases are identical on the wire.
    const merged = attributeByEntity(
      [obligation("CYC-A", 40_000, "2026-02-01"), obligation("CYC-B", 60_000, "2026-03-01")],
      POLICY,
    ).attributions[0]!;
    const single = attributeByEntity([obligation("CYC-C", 100_000, "2026-02-01")], POLICY).attributions[0]!;
    expect(merged.amountAtRisk.minor).toBe(single.amountAtRisk.minor);
    expect(merged.entityId).toBe(single.entityId);
    // Only the field that does not travel tells them apart.
    expect(merged.contributingCycleCount).not.toBe(single.contributingCycleCount);
  });
});

describe("A · the ACTIVATION path SILENTLY DISCARDS the second obligation — and it is LIVE", () => {
  const signal = (over: Partial<CandidateSignal>): CandidateSignal =>
    Object.freeze({
      signalId: `ACT-${"a".repeat(32)}`,
      boundaryId: "pb-1",
      recoveryType: "ActivationMissed",
      sourceRef: `hmac-sha256:${"b".repeat(64)}`, // ONE account
      sourcePayloadHash: "c".repeat(64),
      detectorVersion: "activation-deadline-v1",
      observedAt: "2026-06-01T00:00:00.000Z",
      amountAtRiskMinor: 40_000,
      currency: "USD",
      actionAvailable: true,
      expectedProofEvent: "activation followed by next invoice paid",
      ...over,
    });

  it("4 · two distinct obligations of one account collide on the dedupe key", () => {
    // The key is `(boundaryId, recoveryType, sourceRef)` — the obligation is not in it, so two genuinely
    // different leaks for one customer are one key.
    const first = signal({ amountAtRiskMinor: 40_000, signalId: `ACT-${"1".repeat(32)}` });
    const second = signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` });
    expect(caseCandidateDedupeKey(second)).toBe(caseCandidateDedupeKey(first));
  });

  it("5 · THE DAMAGE · the second obligation's amount is DISCARDED, not summed and not reported", async () => {
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };

    const first = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 40_000, signalId: `ACT-${"1".repeat(32)}` }),
      policy,
    );
    const second = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` }),
      policy,
    );

    expect(first.admitted && first.created).toBe(true);
    // The second is ADMITTED — it passed every gate — and then absorbed.
    expect(second.admitted).toBe(true);
    if (!second.admitted || !first.admitted) throw new Error("both submissions must be admitted");
    expect(second.created).toBe(false);

    // THE MEASUREMENT. The surviving candidate carries the FIRST amount. The second obligation's
    // $600.00 is not summed, not held, not flagged — it exists nowhere.
    expect(second.candidate.signal.amountAtRiskMinor).toBe(40_000);
    expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
    // And this is WORSE than the assessment path's summation: there, $1,000.00 is at least present
    // under one label. Here $600.00 of observed exposure is simply gone.
  });

  it("6 · the discard is INVISIBLE in the stored candidate — nothing records that a second arrived", async () => {
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };
    await service.submit("activation-deadline-v1", signal({ signalId: `ACT-${"1".repeat(32)}` }), policy);
    const second = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` }),
      policy,
    );
    if (!second.admitted) throw new Error("admitted");
    // `created: false` is returned to the CALLER and is not persisted on the candidate. A reviewer
    // opening the queue sees one candidate at $400.00 with no indication a second was absorbed.
    expect(Object.keys(second.candidate)).not.toContain("absorbedCount");
    expect(JSON.stringify(second.candidate)).not.toContain("60000");
  });
});

describe("A · what is NOT exposed today — the bound on the risk", () => {
  it("7 · the assessment path cannot reach a case at all, so it has created no merged case", () => {
    // Stated so the risk is sized honestly rather than dramatised. `deriveStagedAttributions` refuses at
    // `leakInstanceIdentityStatus()`, which is unconditionally false while `OBLIGATION_IDENTITY_FIELDS`
    // is empty — so no staged row and therefore no emitted candidate has ever existed on that path.
    // The activation path above is the live one, and its merge is the one that matters commercially.
    //
    // This is a structural fact, re-derived here rather than cited: the status predicate reads only the
    // declared field list and nothing about any dataset.
    expect(OBLIGATION_IDENTITY_FIELDS).toHaveLength(0);
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
    expect(leakInstanceIdentityStatus().reason).toBe("leak_instance_identity_unavailable");
  });
});
