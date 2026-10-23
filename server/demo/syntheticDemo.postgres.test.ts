import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { createAgentProcessFromEnvironment } from "../agents/bootstrap";
import { configuredAgentHandlers } from "../agents/activationDetector";
import { RECONCILIATION_RECOVERY_TYPE } from "../agents/reconciliationObserver";
import { SyntheticDemo } from "./syntheticDemo";
import { postgresSyntheticDemoPorts } from "./syntheticDemoPorts";

// THE PRODUCTION PATH. Real Fastify app, real routes, real verifier, real role/separation gates, real
// worker, real Postgres. The only thing standing in for a billing system is the demo's own synthetic
// source — which is exactly the thing under test. Every operator step is an HTTP call; no seed script, no
// direct database write, and no fabricated attestation reaches the case.
const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });
const OPERATOR = hdr("pilot-operator@company", "operator");
const AUTHOR_ROLE = hdr("dana@company", "author");
const APPROVER = hdr("cfo@company", "approver");

describe.skipIf(!process.env.DATABASE_URL)("synthetic demo · operator journey through the real routes", () => {
  const boundaryId = `SYNTHETIC-DEMO-test-${randomUUID().slice(0, 8)}`;
  const env = {
    NH_AGENTS_ENABLED: "true",
    NH_RECONCILIATION_OBSERVER_ENABLED: "true",
    NH_RECONCILER_PSEUDONYM_KEY: `test-${randomUUID()}-${randomUUID()}`,
    NH_AGENT_BOUNDARIES: boundaryId,
    NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:10000`,
    NH_AGENT_IDLE_DELAY_MS: "10",
  };
  const demo = new SyntheticDemo({ boundaryId }, postgresSyntheticDemoPorts());
  const app = buildApp({ syntheticDemo: demo });
  const worker = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));

  beforeAll(() => { worker.start(); });
  afterAll(async () => {
    await worker.stop();
    await app.close();
    await prisma.$disconnect();
  });

  const call = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: unknown) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

  it("runs Identify → Fix → Prove to PROVEN, with exposure and returned kept apart, and refuses every shortcut", async () => {
    // ── status: labelled, and says nothing about money
    const status = await call("GET", "/synthetic-demo/status", OPERATOR);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: true, boundaryId, currency: "USD" });
    expect(status.json().label).toMatch(/SYNTHETIC/i);
    expect(JSON.stringify(status.json())).not.toMatch(/PRIVATE KEY/);

    // ── NEGATIVE: only an operator may launch
    for (const who of [AUTHOR_ROLE, APPROVER, hdr("val@company", "verifier"), hdr("gov@company", "steward")]) {
      expect((await call("POST", "/synthetic-demo/launch", who)).statusCode).toBe(403);
    }
    expect((await call("POST", "/synthetic-demo/launch", {})).statusCode).toBe(401);

    // ── LAUNCH (operator, through the route) and the idempotent repeat
    const launched = await call("POST", "/synthetic-demo/launch", OPERATOR);
    expect(launched.statusCode).toBe(201);
    expect(launched.json()).toMatchObject({ launched: true, alreadyLaunched: false, boundaryId });
    const again = await call("POST", "/synthetic-demo/launch", OPERATOR);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ launched: false, alreadyLaunched: true });

    // ── IDENTIFY: the REAL reconciler, in the REAL worker, produced exactly the three shortfalls
    let items: Array<{ candidateId: string; boundaryId: string; signal: { amountAtRiskMinor: number } }> = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && items.length < 3) {
      const queue = await call("GET", `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, OPERATOR);
      if (queue.statusCode === 200) items = queue.json();
      if (items.length < 3) await new Promise((r) => setTimeout(r, 50));
    }
    expect(items.map((i) => i.signal.amountAtRiskMinor).sort((a, b) => a - b)).toEqual([60_000, 100_000, 150_000]);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId } })).toBe(0);

    const picked = items.find((i) => i.signal.amountAtRiskMinor === 60_000)!;
    const review = await call("POST", `/agent-candidates/${picked.candidateId}/review`, OPERATOR, {
      boundaryId, decision: "accepted", reason: "test · confirmed against the synthetic schedule",
    });
    expect(review.statusCode).toBe(201);
    const promoted = await call("POST", `/agent-candidates/${picked.candidateId}/promote`, OPERATOR, { boundaryId });
    expect(promoted.statusCode).toBe(201);
    const caseId: string = promoted.json().recoveryCase.recoveryCaseId;
    const exposure = 60_000;

    // ── NEGATIVE: the simulated payer cannot settle before the fix exists
    const early = await call("POST", `/synthetic-demo/cases/${caseId}/settle`, OPERATOR);
    expect(early.statusCode).toBe(409);
    expect(early.body).toMatch(/corrective action/);

    // ── FIX (operator): owner, baseline, intervention
    expect((await call("POST", `/cases/${caseId}/author`, OPERATOR)).statusCode).toBe(201);
    const baseline = await call("POST", `/cases/${caseId}/baseline`, OPERATOR, {
      baselineId: `BL-SYN-${caseId.slice(3, 11)}`, calculatedMinor: 10_000, currency: "USD",
      method: "matched_historical_cohort", methodVersion: 1, sourceRefs: ["synthetic-demo-baseline"],
      effectiveAt: new Date().toISOString(),
    });
    expect(baseline.statusCode).toBe(201);
    // still no intervention → still refused
    expect((await call("POST", `/synthetic-demo/cases/${caseId}/settle`, OPERATOR)).statusCode).toBe(409);
    expect((await call("POST", `/cases/${caseId}/intervention`, OPERATOR)).statusCode).toBe(201);

    // ── NEGATIVE: not every role may trigger the source; and nothing the caller sends is honoured
    for (const who of [APPROVER, hdr("val@company", "verifier"), hdr("gov@company", "steward")]) {
      expect((await call("POST", `/synthetic-demo/cases/${caseId}/settle`, who)).statusCode).toBe(403);
    }
    expect((await call("POST", `/synthetic-demo/cases/RC-does-not-exist/settle`, OPERATOR)).statusCode).toBe(404);

    // ── PROVE (1): the synthetic payer settles. The caller tries to inflate it; the body is not read.
    const settled = await call("POST", `/synthetic-demo/cases/${caseId}/settle`, OPERATOR, {
      amountMinor: 9_999_999, currency: "EUR", evidenceId: "EV-attacker",
    });
    expect(settled.statusCode).toBe(201);
    const evidence = settled.json();
    expect(evidence).toMatchObject({
      evidenceId: `EV-SYNTHETIC-${caseId}`, evidenceRole: "outcome", trustClassification: "independent",
      amountMinor: exposure, currency: "USD",
    });
    expect(evidence.sourceRecordId).toMatch(/^SYNTHETIC-/);
    expect(evidence.sourceVerification).toBeTruthy();
    expect(evidence.sourceVerification.keyId).toBe(demo.trustKey.keyId);

    // at most once
    expect((await call("POST", `/synthetic-demo/cases/${caseId}/settle`, OPERATOR)).statusCode).toBe(409);

    // evidence is not money: EVIDENCED, nothing proven
    const evidenced = await call("GET", `/recovery-cases/${caseId}`, APPROVER);
    expect(evidenced.json().lifecycle.progress).toBe("EVIDENCED");
    expect(evidenced.json().provenRevenueReturnedMinor).toBeNull();

    // ── NEGATIVE controls at approval
    const body = (over: Record<string, unknown> = {}) => ({
      proofId: `PF-SYN-${caseId.slice(3, 11)}`, recoveryCaseId: caseId, currency: "USD",
      collectedMinor: exposure, excludedRecoveryMinor: 0,
      exclusionStatement: "test · no exclusions (synthetic)", recoveryReason: "BillingCorrection",
      attribution: "corrective invoice raised and collected (synthetic)",
      evidenceIds: [evidence.evidenceId], baselineId: `BL-SYN-${caseId.slice(3, 11)}`, confidenceUsed: 95,
      ...over,
    });
    expect((await call("POST", "/proofs", OPERATOR, body({ proofId: "PF-nc-op" }))).statusCode).toBe(403);
    expect((await call("POST", "/proofs", APPROVER, body({ proofId: "PF-nc-over", collectedMinor: exposure + 1 }))).statusCode)
      .toBeGreaterThanOrEqual(400);
    expect((await call("POST", "/proofs", APPROVER, body({ proofId: "PF-nc-reason", recoveryReason: "billing_correction" }))).statusCode)
      .toBe(400);
    expect((await call("POST", "/proofs", APPROVER, body({ proofId: "PF-nc-none", evidenceIds: [] }))).statusCode).toBe(400);
    const stillNone = await call("GET", `/recovery-cases/${caseId}`, APPROVER);
    expect(stillNone.json().provenRevenueReturnedMinor).toBeNull();

    // ── PROVE (2): a DIFFERENT identity freezes the proof
    const approved = await call("POST", "/proofs", APPROVER, body());
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ recoveryReason: "BillingCorrection" });
    expect(approved.json().revenueReturned.minor).toBe(exposure - 10_000);

    const proven = (await call("GET", `/recovery-cases/${caseId}`, APPROVER)).json();
    expect(proven.lifecycle.progress).toBe("PROVEN");
    expect(proven.provenRevenueReturnedMinor).toBe(50_000);
    // the two ledgers stay two numbers: identified exposure is untouched and is not the returned figure
    expect(proven.lifecycle.exposure.minor).toBe(60_000);
    expect(proven.provenRevenueReturnedMinor).not.toBe(proven.lifecycle.exposure.minor);

    // the other two shortfalls are still just candidates
    const rest = await call("GET", `/agent-candidates?boundaryId=${encodeURIComponent(boundaryId)}`, OPERATOR);
    expect(rest.json()).toHaveLength(2);
  }, 60_000);
});

describe.skipIf(!process.env.DATABASE_URL)("synthetic demo · disabled (the default)", () => {
  const app = buildApp({ syntheticDemo: null });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("says it is off and has no launch or settle handler to coax into running", async () => {
    const status = await app.inject({ method: "GET", url: "/synthetic-demo/status", headers: OPERATOR });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ enabled: false });
    expect((await app.inject({ method: "POST", url: "/synthetic-demo/launch", headers: OPERATOR })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/synthetic-demo/cases/RC-x/settle", headers: OPERATOR })).statusCode).toBe(404);
  });
});
