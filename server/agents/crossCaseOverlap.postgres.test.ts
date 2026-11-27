// CROSS-CASE DOUBLE ATTRIBUTION · the release blocker, and the refusal that closes it.
//
// THE EXPOSURE WAS MEASURED BEFORE IT WAS FIXED (`obligationGrainEmission.postgres.test.ts` still
// drives the raw-store version and asserts the sum is exactly double). This file tests the GATE: the
// production `CaseAdmissionService`, against a real Postgres store, refusing an obligation-grained
// claim where an account-grained aggregate for the same payer already exists.
//
// IT TESTS THE SERVICE AND NOT THE STORE. The previous file writes through the store directly, which
// is how the hazard was demonstrated; a gate that only the store enforced would be bypassed by every
// caller that holds a store, and a gate that only the service enforced is bypassed by none that go
// through admission. Both facts are kept, in two files, rather than one replacing the other.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import {
  CaseAdmissionService, accountGrainedDedupeKey, caseCandidateDedupeKey, caseCandidateId,
  candidateDedupeGrain,
} from "./caseAdmission";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE } from "./reconciliationObserver";
import { OBLIGATION_GRAIN_DECISION, SUPERSEDED_IN_PART } from "./fixtures/reconciliation.grain.decision";
import { PROVEN_GRAIN_AUTHORIZATION } from "./fixtures/reconciliation.scenarios.expectations";
import type { CandidateSignal } from "./types";

// `economicThresholdMinor` is the REAL field name. My first form wrote `minimumAmountAtRiskMinor`,
// which exists nowhere in this repository, and the consequence was not a typo: `admission.ts:177`
// compares `signal.amountAtRiskMinor < policy.economicThresholdMinor`, and with the threshold
// `undefined` that comparison is always false — so every test in this file ran with the ECONOMIC
// ADMISSION GATE SILENTLY DISABLED and still passed. The ratchet caught it; no runtime assertion
// could have. *An excess property that looks like a governed term is worse than a missing one,
// because a reviewer believes it.* The threshold is 1 so the gate is LIVE and admits every amount
// these cases use, which is the point: overlap is what is under test, not the economic bar.
const POLICY = { recoveryType: RECONCILIATION_RECOVERY_TYPE, economicThresholdMinor: 1 };
const store = new PostgresCaseCandidateStore();
const service = new CaseAdmissionService(store, () => new Date());

function signal(boundaryId: string, sourceRef: string, over: Partial<CandidateSignal>): CandidateSignal {
  return {
    signalId: `REC-${randomUUID().slice(0, 12)}`,
    boundaryId,
    recoveryType: RECONCILIATION_RECOVERY_TYPE,
    sourceRef,
    sourcePayloadHash: "0".repeat(64),
    detectorVersion: RECONCILIATION_AGENT_ID,
    observedAt: new Date().toISOString(),
    amountAtRiskMinor: 40_000,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    ...over,
  } as CandidateSignal;
}

const payer = () => `hmac-sha256:${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
const obligation = () => `hmac-sha256:${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;

const aggregate = (b: string, p: string, units = 2, minor = 90_000) =>
  signal(b, p, { amountAtRiskMinor: minor, obligationCoverage: { kind: "ACCOUNT_AGGREGATE", unitCount: units } });

const single = (b: string, p: string, o: string, minor = 40_000) =>
  signal(b, p, {
    amountAtRiskMinor: minor,
    obligationCoverage: {
      kind: "SINGLE_OBLIGATION", obligationRef: o,
      expectedMinor: minor + 10_000, billedMinor: 10_000, residualMinor: minor, currency: "USD",
    },
  });

describe("cross-case double attribution · admission refuses the derivable overlap", () => {
  it("REFUSES an obligation-grained claim where an account aggregate already covers the payer", async () => {
    const b = `overlap-${randomUUID().slice(0, 8)}`;
    const p = payer();
    const agg = await service.submit(RECONCILIATION_AGENT_ID, aggregate(b, p), POLICY);
    expect(agg.admitted).toBe(true);

    const refused = await service.submit(RECONCILIATION_AGENT_ID, single(b, p, obligation()), POLICY);
    expect(refused.admitted).toBe(false);
    expect(refused.admitted === false && refused.reason).toMatch(/account-grained aggregate/i);
    // THE REFUSAL NAMES THE ROW AN OPERATOR MUST GO AND LOOK AT, not just the fact of a refusal.
    expect(refused.admitted === false && refused.reason)
      .toContain(caseCandidateId(accountGrainedDedupeKey(aggregate(b, p))));

    // AND IT WROTE NOTHING. A refusal that left a row behind would be the double count it refuses.
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(1);
  });

  it("is IDEMPOTENT — a refused claim stays refused and still writes nothing", async () => {
    const b = `overlap-idem-${randomUUID().slice(0, 8)}`;
    const p = payer();
    await service.submit(RECONCILIATION_AGENT_ID, aggregate(b, p), POLICY);
    const o = obligation();
    for (let i = 0; i < 3; i += 1) {
      const r = await service.submit(RECONCILIATION_AGENT_ID, single(b, p, o), POLICY);
      expect(r.admitted).toBe(false);
    }
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(1);
  });

  it("CONCURRENT obligation-grained claims against one aggregate are ALL refused", async () => {
    const b = `overlap-conc-${randomUUID().slice(0, 8)}`;
    const p = payer();
    await service.submit(RECONCILIATION_AGENT_ID, aggregate(b, p), POLICY);
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() => service.submit(RECONCILIATION_AGENT_ID, single(b, p, obligation()), POLICY)),
    );
    expect(results.every((r) => r.admitted === false)).toBe(true);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(1);
  });

  it("a FRESH boundary is unaffected — obligation-grained claims are admitted normally", async () => {
    // THE CONTROL, AND THE RUN WOULD BE WORTHLESS WITHOUT IT. A gate that refused everything would
    // satisfy every assertion above and make the product useless.
    const b = `overlap-fresh-${randomUUID().slice(0, 8)}`;
    const p = payer();
    const a = await service.submit(RECONCILIATION_AGENT_ID, single(b, p, obligation()), POLICY);
    const c = await service.submit(RECONCILIATION_AGENT_ID, single(b, p, obligation()), POLICY);
    expect(a.admitted).toBe(true);
    expect(c.admitted).toBe(true);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(2);
  });

  it("TENANT ISOLATION · an aggregate in ANOTHER boundary does not refuse this one", async () => {
    const other = `overlap-other-${randomUUID().slice(0, 8)}`;
    const mine = `overlap-mine-${randomUUID().slice(0, 8)}`;
    const p = payer();
    await service.submit(RECONCILIATION_AGENT_ID, aggregate(other, p), POLICY);
    const r = await service.submit(RECONCILIATION_AGENT_ID, single(mine, p, obligation()), POLICY);
    expect(r.admitted).toBe(true);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: mine } })).toBe(1);
  });

  it("CONCURRENT IDENTICAL obligation claims create ONE row, not two", async () => {
    // The pre-existing control, re-asserted here because the new check sits in front of it and must
    // not have displaced it: identity collision is still the database's job.
    const b = `overlap-dup-${randomUUID().slice(0, 8)}`;
    const p = payer();
    const o = obligation();
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() => service.submit(RECONCILIATION_AGENT_ID, single(b, p, o), POLICY)),
    );
    expect(results.every((r) => r.admitted === true)).toBe(true);
    expect(results.filter((r) => r.admitted === true && r.created)).toHaveLength(1);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(1);
  });

  it("an ACCOUNT-grained claim is never refused by this check — the asymmetry is deliberate", async () => {
    // Stated as a test rather than only in a comment: the reverse lookup would be unbounded, and the
    // overlap it would catch is unreachable from one emission because a payer's identified and
    // unidentified units go to DIFFERENT candidates.
    const b = `overlap-asym-${randomUUID().slice(0, 8)}`;
    const p = payer();
    const first = await service.submit(RECONCILIATION_AGENT_ID, single(b, p, obligation()), POLICY);
    expect(first.admitted).toBe(true);
    const agg = await service.submit(RECONCILIATION_AGENT_ID, aggregate(b, p), POLICY);
    expect(agg.admitted).toBe(true);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: b } })).toBe(2);
  });

  it("the grain predicate decides which claims the check applies to", () => {
    const b = "grain-pred";
    const p = payer();
    expect(candidateDedupeGrain(aggregate(b, p))).toBe("ACCOUNT_V1");
    expect(candidateDedupeGrain(single(b, p, obligation()))).toBe("OBLIGATION_V2");
    // AND THE TWO KEYS DIFFER FOR ONE PAYER, which is the whole reason the overlap is invisible to
    // `createIfAbsent` and must be derived instead.
    const s = single(b, p, obligation());
    expect(caseCandidateDedupeKey(s)).not.toBe(accountGrainedDedupeKey(s));
    // The v1 derivation is DELEGATED, not duplicated: an account-grained signal's own key IS the
    // account-grained key, byte for byte.
    expect(caseCandidateDedupeKey(aggregate(b, p))).toBe(accountGrainedDedupeKey(aggregate(b, p)));
  });
});

describe("the governance record", () => {
  it("supersedes the frozen authorization IN PART, and the frozen constant is untouched", () => {
    // THE FROZEN VALUE IS ASSERTED, so an edit to the frozen file fails here as well as in its lock.
    expect(PROVEN_GRAIN_AUTHORIZATION.businessAuthorizationProven).toBe(false);
    expect(PROVEN_GRAIN_AUTHORIZATION.doubleAttributionPrevented).toBe("WITHIN_CASE_ONLY");
    expect(SUPERSEDED_IN_PART.frozenValue.businessAuthorizationProven)
      .toBe(PROVEN_GRAIN_AUTHORIZATION.businessAuthorizationProven);
    expect(SUPERSEDED_IN_PART.frozenValue.doubleAttributionPrevented)
      .toBe(PROVEN_GRAIN_AUTHORIZATION.doubleAttributionPrevented);
    expect(SUPERSEDED_IN_PART.untouched).toBe(true);
  });

  it("records what the approval does NOT certify, as three separate facts", () => {
    expect(OBLIGATION_GRAIN_DECISION.businessAuthorizationProven).toBe(true);
    expect(OBLIGATION_GRAIN_DECISION.certifiesImplementationCorrectness).toBe(false);
    expect(OBLIGATION_GRAIN_DECISION.certifiesProductionReadiness).toBe(false);
    expect(OBLIGATION_GRAIN_DECISION.certifiesCrossCaseDoubleAttributionPrevented).toBe(false);
    // AND THE NEW STATE IS NOT CALLED "PREVENTED". It refuses the overlap it can derive; the reverse
    // direction is argued unreachable rather than checked, and the label says so.
    expect(OBLIGATION_GRAIN_DECISION.doubleAttributionPrevented).toBe("ADMISSION_REFUSES_DERIVABLE_OVERLAP");
    expect(OBLIGATION_GRAIN_DECISION.stillRequiresOwnerApproval.length).toBeGreaterThan(0);
  });
});
