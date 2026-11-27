// STRATEGY A · the emission grain, and what it does to duplicates, idempotency and legacy rows.
//
// WHY A POSTGRES TEST AND NOT A PURE ONE. The questions are about IDENTITY COLLISION and REPEATED
// EXECUTION, which are properties of a unique index and an append-only store, not of a function. A
// pure test would assert that two keys differ, which is arithmetic; this asserts that the database
// refuses the second write and that a legacy row and a new row can be distinguished.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import {
  planReconciliation, coverageForCandidate, accountSourceRef, unitObligationRef,
  unitHasObligationIdentity, signalsForPlan, RECONCILIATION_RECOVERY_TYPE, RECONCILIATION_AGENT_ID,
  type PlannedUnit,
} from "./reconciliationObserver";
import { caseCandidateDedupeKey, candidateDedupeGrain, caseCandidateId } from "./caseAdmission";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import type { CandidateSignal } from "./types";
import { parseStrictCsv } from "../../src/contract/csvPairTransport";
import { projectFrozenPackage } from "../../scripts/pilot-synthetic-company/project";

const KEY = "SYNTHETIC-grain-test-key-not-a-deployment-secret";
const DIR = "e2e/fixtures/reconciliation-obligation-ref";

function plan() {
  const pair = projectFrozenPackage(DIR);
  const e = parseStrictCsv(pair.expectationCsv);
  const b = parseStrictCsv(pair.billingCsv);
  return planReconciliation({
    expectation: { columns: e.header, rows: e.rows },
    billing: { columns: b.header, rows: b.rows },
    currency: "USD",
  });
}

describe("Strategy A · obligation-grained emission", () => {
  const p = plan();

  it("emits ONE candidate per obligation and NONE as an account aggregate", () => {
    expect(p.candidates.length).toBeGreaterThan(0);
    const kinds = p.candidates.map((c) => coverageForCandidate(c, p.currency, KEY).kind);
    expect(kinds.every((k) => k === "SINGLE_OBLIGATION")).toBe(true);
    expect(p.candidates.every((c) => c.units.length === 1)).toBe(true);
  });

  it("the DETECTED MONEY does not move — only its grain does", () => {
    // THE LOAD-BEARING ASSERTION OF THE WHOLE CHANGE. A regrouping that also changed the total would
    // be re-detecting, not regrouping, and the exposure figure would no longer be comparable with the
    // pre-change baseline.
    const total = p.candidates.reduce((t, c) => t + c.residualMinor, 0);
    expect(total).toBe(p.observedExposureMinor);
    expect(total).toBe(7_645_830); // $76,458.30 — the pre-change figure, to the cent
  });

  it("every unit of the accepted population appears EXACTLY ONCE across all candidates", () => {
    // NO DOUBLE MONETARY ATTRIBUTION. The regrouping must partition the units, not copy them: a unit
    // appearing twice would be the same dollar on two candidates and two cases.
    const seen = new Map<string, number>();
    for (const c of p.candidates) {
      for (const u of c.units) {
        const k = `${u.entitlementRef}|${u.periodStart}|${u.periodEnd}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(seen.size).toBe(p.candidates.reduce((t, c) => t + c.units.length, 0));
  });

  it("is deterministic under re-planning — the same input yields the same ordered plan", () => {
    const again = plan();
    expect(again.candidates.map((c) => `${c.accountRef}|${c.units[0]!.entitlementRef}|${c.units[0]!.periodStart}`))
      .toEqual(p.candidates.map((c) => `${c.accountRef}|${c.units[0]!.entitlementRef}|${c.units[0]!.periodStart}`));
    expect(again.observedExposureMinor).toBe(p.observedExposureMinor);
  });

  it("two obligations of ONE payer are two candidates with two DIFFERENT dedupe keys", () => {
    const byAccount = new Map<string, typeof p.candidates[number][]>();
    for (const c of p.candidates) byAccount.set(c.accountRef, [...(byAccount.get(c.accountRef) ?? []), c]);
    const shared = [...byAccount.values()].find((cs) => cs.length > 1);
    expect(shared, "the frozen package must contain a payer with more than one obligation").toBeDefined();
    // THROUGH THE PRODUCTION EMITTER, not a hand-built signal: `signalsForPlan` is what the handler
    // actually publishes, and `actionAvailable` is required — omitting it returns [] and the first
    // form of this test read that empty list as "no signals matched". A context field missing from a
    // fixture is indistinguishable from a product that emits nothing, so the emitter is called ONCE
    // and the result is asserted non-empty before anything is looked up in it.
    const emitted = signalsForPlan(p, {
      pseudonymKey: KEY, boundaryId: "b-1", observedAt: new Date().toISOString(), actionAvailable: true,
    });
    expect(emitted.length).toBe(p.candidates.length);
    const signals = shared!.map((c) => emitted.find((s) =>
      s.sourceRef === accountSourceRef(KEY, c.accountRef)
      && (s.obligationCoverage as { obligationRef?: string } | undefined)?.obligationRef
         === unitObligationRef(KEY, c.units[0]!))!);
    expect(signals.every((s) => s !== undefined)).toBe(true);
    const keys = new Set(signals.map((s) => caseCandidateDedupeKey(s)));
    expect(keys.size).toBe(signals.length);
    // AND THE ACCOUNT REFERENCE IS SHARED, which is what makes the obligation component load-bearing:
    // without it these would collapse to one key, which is the defect this change fixes.
    expect(new Set(signals.map((s) => s.sourceRef)).size).toBe(1);
    expect(signals.every((s) => candidateDedupeGrain(s) === "OBLIGATION_V2")).toBe(true);
  });

  it("the account-grained FALLBACK is preserved for a unit with no authoritative identity", () => {
    // DEFENSIVE AND HONEST ABOUT IT. The expectation contract requires `entitlement_ref` and both
    // period bounds, so no unit in a validly accepted population reaches this branch — the predicate
    // is tested DIRECTLY rather than through data that cannot produce it, and the fact that it is
    // unexercised by real input is stated instead of implied by a passing test.
    const full: PlannedUnit = {
      entitlementRef: "ENT-1", periodStart: "2026-01-01", periodEnd: "2026-01-31",
      residualMinor: 100, expectedMinor: 100, observedMinor: 0,
    };
    expect(unitHasObligationIdentity(full)).toBe(true);
    for (const blanked of [
      { ...full, entitlementRef: "" }, { ...full, periodStart: "" }, { ...full, periodEnd: "" },
      { ...full, entitlementRef: "   " },
    ]) {
      expect(unitHasObligationIdentity(blanked)).toBe(false);
    }
  });
});

// ── THE OVERLAP · a legacy aggregate candidate meeting the new obligation-grained ones ────────────
describe("Strategy A · legacy V1 aggregate rows overlapping new V2 rows", () => {
  const boundaryId = `grain-overlap-${randomUUID().slice(0, 8)}`;
  const store = new PostgresCaseCandidateStore();
  const p = plan();

  const accountOf = (() => {
    const byAccount = new Map<string, number>();
    for (const c of p.candidates) byAccount.set(c.accountRef, (byAccount.get(c.accountRef) ?? 0) + 1);
    return [...byAccount.entries()].find(([, n]) => n > 1)![0];
  })();
  const mine = p.candidates.filter((c) => c.accountRef === accountOf);
  const aggregateMinor = mine.reduce((t, c) => t + c.residualMinor, 0);

  const base = {
    boundaryId,
    recoveryType: RECONCILIATION_RECOVERY_TYPE,
    sourceRef: accountSourceRef(KEY, accountOf),
    sourcePayloadHash: "0".repeat(64),
    detectorVersion: RECONCILIATION_AGENT_ID,
    observedAt: new Date().toISOString(),
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
  };

  // THE LEGACY ROW IS BUILT WITH THE PRODUCTION KEY FUNCTION, not a hand-written digest. The V1 path
  // is still live for account-grained signals, so this is exactly the row a pre-change run wrote —
  // simulating the upgrade rather than asserting about a shape I invented.
  const legacy: CandidateSignal = {
    ...base,
    signalId: `REC-legacy-${randomUUID().slice(0, 8)}`,
    amountAtRiskMinor: aggregateMinor,
    obligationCoverage: { kind: "ACCOUNT_AGGREGATE", unitCount: mine.length },
  };

  // NO SETUP OR TEARDOWN, AND THAT IS THE PRODUCT TALKING. The first form of this suite deleted its
  // own rows in `beforeAll`/`afterAll` and Postgres refused with 23001 — "append-only: DELETE on
  // agent_case_candidates is rejected (historical records are immutable; create a linked revision
  // instead)". The trigger is correct and the test was wrong to try. Isolation comes from a per-run
  // `boundaryId` instead, which is also closer to how the table is really used.

  it("the legacy aggregate key and each new obligation key are DIFFERENT keys", () => {
    const legacyKey = caseCandidateDedupeKey(legacy);
    expect(candidateDedupeGrain(legacy)).toBe("ACCOUNT_V1");
    for (const c of mine) {
      const v2: CandidateSignal = {
        ...base,
        signalId: `REC-${randomUUID().slice(0, 8)}`,
        amountAtRiskMinor: c.residualMinor,
        obligationCoverage: coverageForCandidate(c, p.currency, KEY),
      };
      expect(candidateDedupeGrain(v2)).toBe("OBLIGATION_V2");
      expect(caseCandidateDedupeKey(v2)).not.toBe(legacyKey);
    }
  });

  it("MEASURED: both rows coexist in the store, so the same money is reachable twice", async () => {
    // THIS TEST DOES NOT ASSERT THAT NH PREVENTS THIS, BECAUSE IT DOES NOT. Writing a test that
    // pretended otherwise would be worse than no test. What it asserts is the exposure, exactly:
    // a boundary that already holds a legacy aggregate candidate will, after this change, also hold
    // obligation-grained candidates for the SAME units, and nothing in the identity layer refuses it
    // — the keys are legitimately different because the claims are at different grains.
    await store.createIfAbsent({
      candidateId: caseCandidateId(caseCandidateDedupeKey(legacy)),
      dedupeKey: caseCandidateDedupeKey(legacy),
      boundaryId, agentId: RECONCILIATION_AGENT_ID, signal: legacy,
      status: "pending_review", submittedAt: new Date().toISOString(),
    });
    for (const c of mine) {
      const v2: CandidateSignal = {
        ...base,
        signalId: `REC-${randomUUID().slice(0, 8)}`,
        amountAtRiskMinor: c.residualMinor,
        obligationCoverage: coverageForCandidate(c, p.currency, KEY),
      };
      const key = caseCandidateDedupeKey(v2);
      await store.createIfAbsent({
        candidateId: caseCandidateId(key), dedupeKey: key,
        boundaryId, agentId: RECONCILIATION_AGENT_ID, signal: v2,
        status: "pending_review", submittedAt: new Date().toISOString(),
      });
    }
    const rows = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
    expect(rows).toHaveLength(mine.length + 1);
    const amounts = rows.map((r) => Number((r.signal as { amountAtRiskMinor: number }).amountAtRiskMinor));
    const total = amounts.reduce((t, n) => t + n, 0);
    // The aggregate's amount is counted a second time across its own obligations: the sum of the rows
    // is DOUBLE the money, and this is the number a rollout must not let reach a report.
    expect(total).toBe(aggregateMinor * 2);
  });

  it("re-running the SAME obligation emission creates nothing new — idempotency holds", async () => {
    const before = await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } });
    for (const c of mine) {
      const v2: CandidateSignal = {
        ...base,
        // A DIFFERENT signalId and a DIFFERENT observedAt, deliberately: the key must not depend on
        // either, or a second run of one extract would duplicate every candidate.
        signalId: `REC-rerun-${randomUUID().slice(0, 8)}`,
        observedAt: new Date(Date.now() + 60_000).toISOString(),
        amountAtRiskMinor: c.residualMinor,
        obligationCoverage: coverageForCandidate(c, p.currency, KEY),
      };
      const key = caseCandidateDedupeKey(v2);
      await store.createIfAbsent({
        candidateId: caseCandidateId(key), dedupeKey: key,
        boundaryId, agentId: RECONCILIATION_AGENT_ID, signal: v2,
        status: "pending_review", submittedAt: new Date().toISOString(),
      });
    }
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(before);
  });

  it("a CORRECTED amount for the same obligation is the SAME candidate, never a second one", async () => {
    // The amount is deliberately absent from the V2 preimage. Asserted here because the alternative —
    // a corrected observation becoming a second obligation — would double the measured exposure, and
    // that is the failure this property exists to prevent.
    const before = await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } });
    const c = mine[0]!;
    const corrected: CandidateSignal = {
      ...base,
      signalId: `REC-corrected-${randomUUID().slice(0, 8)}`,
      amountAtRiskMinor: c.residualMinor + 50_000,
      obligationCoverage: coverageForCandidate(c, p.currency, KEY),
    };
    const key = caseCandidateDedupeKey(corrected);
    await store.createIfAbsent({
      candidateId: caseCandidateId(key), dedupeKey: key,
      boundaryId, agentId: RECONCILIATION_AGENT_ID, signal: corrected,
      status: "pending_review", submittedAt: new Date().toISOString(),
    });
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId } })).toBe(before);
  });
});
