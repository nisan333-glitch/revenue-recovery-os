// THE RUN. Five pre-registered scenario families through the PRODUCTION path: the real Postgres task
// store, the real worker claiming the task, the real Postgres candidate store.
//
// WHY A RUN AND NOT A CITATION. A test that drives a worker and expects `succeeded` proves such a test
// exists. To establish that the path works at a given revision one needs a RESULT: real task ids, the
// rows actually created, and the business outcome — because `succeeded` is a QUEUE status and says
// nothing about whether the money is right.
//
// THE EXPECTATIONS WERE FROZEN FIRST. `fixtures/reconciliation.scenarios.expectations.ts` was hashed
// into a tracked lock and committed before this file existed, so nothing here can have been written to
// match a result already seen. Four of the families record `MEASURED IN THE RUN` rather than a
// prediction; for those this file MEASURES and the measurement is the finding.
//
// A PASS HERE IS A PASS OF THE INSTRUMENT. Where a scenario's frozen `knownGap` is non-null, this file
// asserts the CURRENT behaviour and the gap stands — a green test is not a working product, and the two
// verdicts are reported apart.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "./bootstrap";
import { configuredAgentHandlers } from "./activationDetector";
import { createPostgresAgentTaskStore } from "./prismaTaskDatabase";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE, planReconciliation } from "./reconciliationObserver";
import { SCENARIOS } from "./fixtures/reconciliation.scenarios.expectations";
import {
  type RawSucceededRow, readSucceededRows, summariseAbsorption,
} from "../services/absorbedObservations";
import {
  BILLING_COLUMNS, CHG_AMB_BILLING, CHG_AMB_EXPECTATION, CHG_OK_BILLING, CHG_OK_EXPECTATION,
  CRD_EXPECTATION, CRD_STAGE1_BILLING, CRD_STAGE2_BILLING, DUP2_BILLING, DUP2_EXPECTATION,
  DUP3_RUN1_BILLING, DUP3_RUN1_EXPECTATION, DUP3_RUN2_BILLING, DUP3_RUN2_EXPECTATION,
  DUP4_EXPECTATION, EXPECTATION_COLUMNS, ID_BILLING, ID_EXPECTATION, PAY_ADJ_BILLING,
  PAY_ADJ_EXPECTATION, PAY_FAR_BILLING, PAY_FAR_EXPECTATION, SCENARIO_CURRENCY, dup4Billing,
} from "./fixtures/reconciliation.scenarios.data";

type Rows = readonly { readonly rowNumber: number; readonly cells: Readonly<Record<string, string>> }[];

/** Every measurement this run produced, written out so a reported figure can be traced to a run. */
const MEASURED: Record<string, unknown> = {};

const payload = (expectation: Rows, billing: Rows) => ({
  expectation: { columns: [...EXPECTATION_COLUMNS], rows: expectation },
  billing: { columns: [...BILLING_COLUMNS], rows: billing },
  currency: SCENARIO_CURRENCY,
  observedAt: new Date(Date.now() - 60_000).toISOString(),
  actionAvailable: true,
});

/** One isolated boundary per scenario, so no scenario can read another's rows. */
function harness(tag: string) {
  const boundaryId = `SYNTHETIC-scen-${tag}-${randomUUID()}`;
  const env = {
    NH_AGENTS_ENABLED: "true", NH_RECONCILIATION_OBSERVER_ENABLED: "true",
    NH_RECONCILER_PSEUDONYM_KEY: `test-${randomUUID()}-${randomUUID()}`,
    NH_AGENT_BOUNDARIES: boundaryId,
    // A FLOOR, NOT A CAP. `economicThresholdMinor` admits a candidate only ABOVE this figure
    // (server/agents/admission.ts:128, config.ts:60). The first run of this file set 1000000 — $10,000 —
    // believing it was a ceiling, and excluded every scenario candidate, the largest of which is $900.
    // Five scenarios then read zero and S-DUP-1 PASSED VACUOUSLY on 0 === 0.
    NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:1000`,
    NH_AGENT_IDLE_DELAY_MS: "10",
  };
  const worker = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
  const store = createPostgresAgentTaskStore();
  const taskIds: string[] = [];
  const enqueue = async (p: unknown) => {
    const taskId = randomUUID();
    taskIds.push(taskId);
    await store.enqueueIfAbsent({
      taskId, boundaryId, agentId: RECONCILIATION_AGENT_ID,
      idempotencyKey: randomUUID(), now: Date.now(), payload: p,
    });
    return taskId;
  };
  /** Waits for the worker to FINISH n tasks — not for a fixed delay, so "no new row" is about a
   *  processed observation and never about one that had not been read yet. */
  const settled = async (n: number) => {
    const deadline = Date.now() + 15_000;
    const done = () => prisma.agentTaskRecord.count({ where: { boundaryId, status: "succeeded" } });
    while (Date.now() < deadline && (await done()) < n) await new Promise((r) => setTimeout(r, 25));
    return done();
  };
  const candidates = async () => {
    const rows = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId }, orderBy: { candidateId: "asc" } });
    return rows.map((r) => ({
      candidateId: r.candidateId, status: r.status,
      amountAtRiskMinor: (r.signal as { amountAtRiskMinor: number }).amountAtRiskMinor,
      sourceRef: (r.signal as { sourceRef: string }).sourceRef,
    }));
  };
  const tasks = async () => prisma.agentTaskRecord.findMany({
    where: { boundaryId }, select: { taskId: true, status: true, result: true },
  });
  return { boundaryId, worker, enqueue, settled, candidates, tasks, taskIds };
}

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

describe.skipIf(!process.env.DATABASE_URL)("pre-registered scenarios, production path", () => {
  afterAll(async () => {
    writeFileSync(
      process.env.NH_SCENARIO_RESULTS ?? "/tmp/nh-scenario-results.json",
      JSON.stringify({ measuredAt: new Date().toISOString(), scenarios: MEASURED }, null, 2),
    );
    await prisma.$disconnect();
  });

  it("the frozen expectations are the ones this run is judged against", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "S-DUP-1", "S-DUP-2", "S-DUP-3", "S-DUP-4", "S-CHG-1", "S-ID-1", "S-CRD-1", "S-PAY-1",
    ]);
  });

  // ── S-DUP-1 · the identical observation twice ─────────────────────────────────────────────────────
  it("S-DUP-1 · an identical second submission creates no additional case and no double count", async () => {
    const h = harness("dup1");
    const p = payload(DUP2_EXPECTATION, DUP2_BILLING);
    await h.enqueue(p);
    h.worker.start();
    try {
      expect(await h.settled(1)).toBe(1);
      const first = await h.candidates();
      // THE BASELINE MUST EXIST. Comparing two empty results satisfies every assertion below and
      // proves nothing — a test that cannot fail is not a control, and this one could not until here.
      expect(first.length).toBeGreaterThan(0);
      expect(sum(first.map((c) => c.amountAtRiskMinor))).toBe(90_000);
      await h.enqueue(p); // byte-identical payload, new task
      expect(await h.settled(2)).toBe(2);
      const second = await h.candidates();

      MEASURED["S-DUP-1"] = { boundaryId: h.boundaryId, taskIds: h.taskIds, first, second };

      // REQUIRED OUTCOME (approved): no additional case, no double count.
      expect(second).toHaveLength(first.length);
      expect(sum(second.map((c) => c.amountAtRiskMinor))).toBe(sum(first.map((c) => c.amountAtRiskMinor)));
      expect(new Set(second.map((c) => c.candidateId)).size).toBe(second.length);
      // No partial write: no case opened, and every task genuinely finished.
      expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: h.boundaryId } })).toBe(0);
      expect((await h.tasks()).every((t) => t.status === "succeeded")).toBe(true);
    } finally { await h.worker.stop(); }
  }, 40_000);

  // ── S-DUP-2 · two obligations, one payer, SAME run ────────────────────────────────────────────────
  it("S-DUP-2 · both obligations' money survives in one account-grained candidate", async () => {
    const h = harness("dup2");
    await h.enqueue(payload(DUP2_EXPECTATION, DUP2_BILLING));
    h.worker.start();
    try {
      expect(await h.settled(1)).toBe(1);
      const rows = await h.candidates();
      MEASURED["S-DUP-2"] = {
        boundaryId: h.boundaryId, taskIds: h.taskIds, rows,
        shortfallA: 40_000, shortfallB: 50_000, totalObserved: sum(rows.map((c) => c.amountAtRiskMinor)),
      };

      // REQUIRED OUTCOME: neither amount silently lost. 400.00 + 500.00 = 900.00.
      expect(sum(rows.map((c) => c.amountAtRiskMinor))).toBe(90_000);
      // CURRENT BEHAVIOUR, which the frozen knownGap names: one candidate, so per-obligation
      // attribution is not recoverable from the record. Asserted so a future split is visible.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    } finally { await h.worker.stop(); }
  }, 40_000);

  // ── S-DUP-3 · two obligations, one payer, DIFFERENT runs ──────────────────────────────────────────
  it("S-DUP-3 · the second run's obligation is absorbed and its money reaches no figure", async () => {
    const h = harness("dup3");
    await h.enqueue(payload(DUP3_RUN1_EXPECTATION, DUP3_RUN1_BILLING));
    h.worker.start();
    try {
      expect(await h.settled(1)).toBe(1);
      const afterRun1 = await h.candidates();
      await h.enqueue(payload(DUP3_RUN2_EXPECTATION, DUP3_RUN2_BILLING));
      expect(await h.settled(2)).toBe(2);
      const afterRun2 = await h.candidates();

      const observedRun1 = sum(afterRun1.map((c) => c.amountAtRiskMinor));
      const observedRun2 = sum(afterRun2.map((c) => c.amountAtRiskMinor));
      MEASURED["S-DUP-3"] = {
        boundaryId: h.boundaryId, taskIds: h.taskIds, afterRun1, afterRun2,
        shortfallRun1Minor: 30_000, shortfallRun2Minor: 70_000,
        observedRun1, observedRun2,
        amountLostFromTreatmentMinor: 70_000 - (observedRun2 - observedRun1),
      };

      // MEASURED, and the loss is quantified here rather than assumed. Run 1's shortfall is 300.00 and
      // run 2's is 700.00 on a DIFFERENT obligation of the same payer.
      expect(observedRun1).toBe(30_000);
      // The product's own header says the later shortfall "reaches no figure". If that is what happens,
      // the figure does not move and 700.00 is the amount lost from treatment.
      expect(observedRun2).toBe(30_000);
      expect(afterRun2).toHaveLength(1);
      // RECORDED IS NOT TREATED, read through the PRODUCTION reader rather than by grepping the task
      // result. The first form of this assertion looked for /admitted/i in `agentTaskRecord.result`,
      // which holds the EMITTED SIGNAL ARRAY and no admission counts at all — so it failed while the
      // behaviour it was testing was present. The counts live in the `task.succeeded` EVENT metadata,
      // which is what `absorbedObservations` was built to read.
      //
      // AND THE EMITTED SIGNAL IS THE SHARPER FINDING: run 2's signal carries amountAtRiskMinor 70000
      // while the stored candidate stayed at 30000. The task result therefore records an amount that
      // reached no figure, and nothing reconciles the two.
      const emitted = (await h.tasks()).flatMap((t) => (t.result as readonly { amountAtRiskMinor: number }[]) ?? []);
      expect(emitted.map((e) => e.amountAtRiskMinor).sort((a, b) => a - b)).toEqual([30_000, 70_000]);

      const rows = await readSucceededRows((sql) => prisma.$queryRawUnsafe<RawSucceededRow[]>(sql));
      const report = summariseAbsorption(rows.filter((r) => r.boundaryId === h.boundaryId));
      expect(report.verdict).toBe("ABSORPTION_RECORDED");
      const b = report.boundaries.find((x) => x.boundaryId === h.boundaryId)!;
      expect(b.eventsWithAbsorption).toBe(1);
      // Two DISTINCT observation digests on one account identity: the strongest evidence the stored
      // data can offer that a second, genuinely different observation was folded in — not a replay.
      expect(b.accountIdentitiesWithDifferingObservations).toBe(1);
      (MEASURED["S-DUP-3"] as Record<string, unknown>).absorption = {
        verdict: report.verdict, eventsWithAbsorption: b.eventsWithAbsorption,
        distinctObservationDigests: b.distinctObservationDigests,
        emittedAmountsMinor: emitted.map((e) => e.amountAtRiskMinor),
        storedTotalMinor: observedRun2,
      };
    } finally { await h.worker.stop(); }
  }, 40_000);

  // ── S-DUP-4 · a correction arriving second, both directions ───────────────────────────────────────
  it("S-DUP-4 · an upward and a downward correction are both absorbed; no approved rule covers either", async () => {
    const up = harness("dup4up");
    await up.enqueue(payload(DUP4_EXPECTATION, dup4Billing("400.00")));   // short 600.00
    up.worker.start();
    let upMeasured: unknown;
    try {
      expect(await up.settled(1)).toBe(1);
      const before = await up.candidates();
      await up.enqueue(payload(DUP4_EXPECTATION, dup4Billing("200.00"))); // corrected: short 800.00
      expect(await up.settled(2)).toBe(2);
      const after = await up.candidates();
      upMeasured = { boundaryId: up.boundaryId, taskIds: up.taskIds, before, after };
      expect(sum(before.map((c) => c.amountAtRiskMinor))).toBe(60_000);
      expect(sum(after.map((c) => c.amountAtRiskMinor))).toBe(60_000); // first wins; 200.00 unreported
    } finally { await up.worker.stop(); }

    const down = harness("dup4down");
    await down.enqueue(payload(DUP4_EXPECTATION, dup4Billing("400.00"))); // short 600.00
    down.worker.start();
    try {
      expect(await down.settled(1)).toBe(1);
      const before = await down.candidates();
      await down.enqueue(payload(DUP4_EXPECTATION, dup4Billing("800.00"))); // corrected: short 200.00
      expect(await down.settled(2)).toBe(2);
      const after = await down.candidates();
      MEASURED["S-DUP-4"] = {
        upward: upMeasured,
        downward: { boundaryId: down.boundaryId, taskIds: down.taskIds, before, after },
        note: "upward correction loses money; downward correction leaves exposure overstated",
      };
      expect(sum(before.map((c) => c.amountAtRiskMinor))).toBe(60_000);
      expect(sum(after.map((c) => c.amountAtRiskMinor))).toBe(60_000); // first wins; overstated by 400.00
    } finally { await down.worker.stop(); }
  }, 60_000);

  // ── S-CHG-1 · mid-period contract change ─────────────────────────────────────────────────────────
  it("S-CHG-1 · a superseded amendment is not added to its successor; an unlinked pair is refused", async () => {
    const ok = harness("chgok");
    await ok.enqueue(payload(CHG_OK_EXPECTATION, CHG_OK_BILLING));
    ok.worker.start();
    let okRows: unknown;
    try {
      expect(await ok.settled(1)).toBe(1);
      okRows = await ok.candidates();
    } finally { await ok.worker.stop(); }

    const amb = harness("chgamb");
    await amb.enqueue(payload(CHG_AMB_EXPECTATION, CHG_AMB_BILLING));
    amb.worker.start();
    try {
      expect(await amb.settled(1)).toBe(1);
      const ambRows = await amb.candidates();
      const ambResults = (await amb.tasks()).map((t) => t.result);
      MEASURED["S-CHG-1"] = {
        superseded: { boundaryId: ok.boundaryId, rows: okRows, expectedShortfallIfHonouredMinor: 50_000 },
        ambiguous: { boundaryId: amb.boundaryId, rows: ambRows, results: ambResults },
      };
      // REQUIRED OUTCOME: the ambiguous unit yields NO candidate. A refusal is not zero exposure, and
      // publishing a candidate from an authored sum is the defect this rule exists to prevent.
      expect(ambRows).toHaveLength(0);
    } finally { await amb.worker.stop(); }
  }, 60_000);

  // ── S-ID-1 · a dangling obligation reference ──────────────────────────────────────────────────────
  it("S-ID-1 · a dangling reference does not collapse the dataset and is not read as zero owed", async () => {
    const h = harness("id1");
    await h.enqueue(payload(ID_EXPECTATION, ID_BILLING));
    h.worker.start();
    try {
      expect(await h.settled(1)).toBe(1);
      const rows = await h.candidates();
      const results = (await h.tasks()).map((t) => t.result);
      MEASURED["S-ID-1"] = {
        boundaryId: h.boundaryId, taskIds: h.taskIds, rows, results,
        realObligationShortfallMinor: 45_000, danglingLineAmountMinor: 99_900,
      };
      // THE FROZEN ACCEPTANCE ITEM "other units in the same dataset still produce their candidates" IS
      // FALSIFIED HERE, and is recorded as falsified rather than edited — the freeze permits fixing the
      // PRODUCT and re-running, never adjusting the ruler after seeing the result.
      //
      // MEASURED, by a three-arm control that isolates the dangling line (see §S-ID-1 in the report):
      //   no ghost line            → exposure 45000, candidates 1      (the real $450 shortfall is found)
      //   ghost line, dangling ref → exposure 0,     refused 1         (THIS ARM)
      //   same line, resolvable    → exposure 0,     overBilledLiability 1
      //
      // So the product DOES distinguish a dangling reference from a resolvable one, and does not credit
      // the ghost line against the real obligation. What it also does is suppress $450 of establishable
      // exposure because an unrelated malformed line sits in the same unit.
      //
      // REFUSED IS NOT ZERO — the counts carry refused:1 — but `observedExposureMinor` reads 0 beside
      // it, so a surface reading only the exposure figure cannot tell "nothing was owed" from "we
      // refused to say". That is the coverage.event shape, one layer out, and it is a finding.
      expect(rows).toHaveLength(0);
    } finally { await h.worker.stop(); }
  }, 40_000);

  // ── S-ID-1 CONTROL · three arms, so the dangling reference's effect is ISOLATED ───────────────────
  // A single arm showing "exposure 0" cannot say WHY. These three differ in exactly one cell, which is
  // what licenses attributing the suppression to the dangling reference rather than to the extra line's
  // existence or its amount. Run on the pure planner: no database, no worker, no network.
  it("S-ID-1 control · the suppression is caused by the dangling reference, not by a second line", () => {
    const plan = (rows: typeof ID_BILLING) => planReconciliation({
      expectation: { columns: [...EXPECTATION_COLUMNS], rows: ID_EXPECTATION },
      billing: { columns: [...BILLING_COLUMNS], rows },
      currency: SCENARIO_CURRENCY, observedAt: new Date().toISOString(), actionAvailable: true,
    });

    const withGhost = plan(ID_BILLING);
    const withoutGhost = plan(ID_BILLING.filter((r) => r.cells.obligation_ref !== "SL-SC-ID-GHOST")
      .map((r, i) => Object.freeze({ rowNumber: i + 1, cells: r.cells })));
    const ghostResolved = plan(ID_BILLING.map((r) => (r.cells.obligation_ref === "SL-SC-ID-GHOST"
      ? Object.freeze({ rowNumber: r.rowNumber, cells: { ...r.cells, obligation_ref: "SL-SC-ID-A" } })
      : r)));

    MEASURED["S-ID-1-control"] = {
      withGhost: { exposure: withGhost.observedExposureMinor, counts: withGhost.counts },
      withoutGhost: { exposure: withoutGhost.observedExposureMinor, counts: withoutGhost.counts },
      ghostResolved: { exposure: ghostResolved.observedExposureMinor, counts: ghostResolved.counts },
    };

    // ARM 1 — the real shortfall is findable: 1200.00 owed, 750.00 billed.
    expect(withoutGhost.observedExposureMinor).toBe(45_000);
    expect(withoutGhost.counts.candidates).toBe(1);
    expect(withoutGhost.counts.refused).toBe(0);

    // ARM 2 — the dangling reference REFUSES the unit. Not zero, and not a liability.
    expect(withGhost.observedExposureMinor).toBe(0);
    expect(withGhost.counts.refused).toBe(1);
    expect(withGhost.counts.candidates).toBe(0);
    expect(withGhost.counts.overBilledLiability).toBe(0);

    // ARM 3 — the SAME line, resolvable, is an OVER_BILLED liability: 750.00 + 999.00 > 1200.00. So the
    // product distinguishes "cites nothing" from "cites this", which is the distinction that matters and
    // the one a single arm could not have shown.
    expect(ghostResolved.counts.overBilledLiability).toBe(1);
    expect(ghostResolved.counts.refused).toBe(0);
    // A liability is never exposure and is never netted into a smaller leakage figure.
    expect(ghostResolved.observedExposureMinor).toBe(0);
  });

  // ── S-CRD-1 · a credit after a billed line, as sequential stages ──────────────────────────────────
  it("S-CRD-1 · stage 1 balanced, then stage 2 adds a credit — measured, not predicted", async () => {
    const h = harness("crd1");
    await h.enqueue(payload(CRD_EXPECTATION, CRD_STAGE1_BILLING));
    h.worker.start();
    try {
      expect(await h.settled(1)).toBe(1);
      const stage1 = await h.candidates();
      await h.enqueue(payload(CRD_EXPECTATION, CRD_STAGE2_BILLING));
      expect(await h.settled(2)).toBe(2);
      const stage2 = await h.candidates();
      MEASURED["S-CRD-1"] = {
        boundaryId: h.boundaryId, taskIds: h.taskIds, stage1, stage2,
        obligationMinor: 180_000, billedMinor: 180_000, creditMinor: 60_000,
        results: (await h.tasks()).map((t) => t.result),
      };
      // Stage 1 is billed in full, so there is no exposure and therefore no candidate.
      expect(stage1).toHaveLength(0);
      // Stage 2 is MEASURED. Whatever it does, the first observation's absence of a candidate means the
      // account has no existing candidate to absorb into — so this is the one credit path where the
      // account-grained store cannot hide the answer.
    } finally { await h.worker.stop(); }
  }, 40_000);

  // ── S-PAY-1 · an unrelated payment during the period ──────────────────────────────────────────────
  it("S-PAY-1 · an adjacent surplus holds the residual; a far one does not suppress the candidate", async () => {
    const adj = harness("payadj");
    await adj.enqueue(payload(PAY_ADJ_EXPECTATION, PAY_ADJ_BILLING));
    adj.worker.start();
    let adjRows: Awaited<ReturnType<ReturnType<typeof harness>["candidates"]>>;
    try {
      expect(await adj.settled(1)).toBe(1);
      adjRows = await adj.candidates();
    } finally { await adj.worker.stop(); }

    const far = harness("payfar");
    await far.enqueue(payload(PAY_FAR_EXPECTATION, PAY_FAR_BILLING));
    far.worker.start();
    try {
      expect(await far.settled(1)).toBe(1);
      const farRows = await far.candidates();
      MEASURED["S-PAY-1"] = {
        adjacent: { boundaryId: adj.boundaryId, rows: adjRows, shortfallMinor: 80_000, surplusMinor: 80_000 },
        far: { boundaryId: far.boundaryId, rows: farRows, shortfallMinor: 80_000, surplusMinor: 80_000 },
      };
      // REQUIRED OUTCOME: settlement is possible for the adjacent pair, so the residual is HELD — no
      // candidate. For the far pair nothing authoritative makes settlement possible, so it stands.
      expect(adjRows).toHaveLength(0);
      expect(sum(farRows.map((c) => c.amountAtRiskMinor))).toBe(80_000);
    } finally { await far.worker.stop(); }
  }, 60_000);
});
