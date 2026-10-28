// NEGATIVE HTTP REGRESSION · a case that is not a RevenueUnderBilled case cannot freeze a proof whose
// reason is BillingCorrection.
//
// The rule is pure and unit-tested (src/domain/reasonScope.test.ts) and its call site is pinned
// structurally (proofReasonScope.test.ts). Neither exercises the REFUSAL through the real route, so a
// wiring mistake (wrong key, wrong ordering, a swallowed error) could pass both. This does: real Fastify
// app, real authority gates, real Postgres, real `POST /proofs`.
//
// Every refusal below is checked for the thing that matters most about an immutable record — that NOTHING
// was persisted — and each refusal is paired with a control showing it was THIS rule that refused:
//   · the seven other reasons are not refused by it on the same case;
//   · an unauthorised caller is refused earlier and is told nothing about the case's type.
// The positive path (BillingCorrection on a genuine RevenueUnderBilled case, to PROVEN) is exercised by
// server/demo/syntheticDemo.postgres.test.ts and the EP-19 journey, not repeated here.
//
// Synthetic only: every identifier is generated per run; no customer data.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { AUTHORITY_POLICY_VERSION } from "../auth/authorityGate";
import { ALL_REASON_KEYS } from "../../src/domain/reasons";

const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });
const OPERATOR = hdr("pilot-operator@company", "operator");
const APPROVER = hdr("cfo@company", "approver");

describe.skipIf(!process.env.DATABASE_URL)("proof approval · BillingCorrection scope, through the real route", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const call = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: unknown) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

  const proofBody = (recoveryCaseId: string, recoveryReason: string, proofId = `PF-scope-${randomUUID().slice(0, 8)}`) => ({
    proofId, recoveryCaseId, currency: "USD", collectedMinor: 10_000, excludedRecoveryMinor: 0,
    exclusionStatement: "test · no exclusions (synthetic)", recoveryReason,
    attribution: "scope regression (synthetic)", evidenceIds: ["EV-never-reached"],
    baselineId: "BL-never-reached", confidenceUsed: 95,
  });

  /** A genuine promoted case of a NON-reconciler type, authored through the real route. */
  async function openActivationCase(): Promise<string> {
    const boundaryId = `scope-${randomUUID().slice(0, 8)}`;
    const signal = Object.freeze({
      signalId: `ACT-${randomUUID()}`, boundaryId, recoveryType: "ActivationMissed",
      sourceRef: `hmac-sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`,
      sourcePayloadHash: createHash("sha256").update(randomUUID()).digest("hex"),
      detectorVersion: "activation-deadline-v1", observedAt: "2026-06-01T00:00:00.000Z",
      amountAtRiskMinor: 10_000, currency: "USD", actionAvailable: true,
      expectedProofEvent: "activation followed by next invoice paid",
    });
    const dedupeKey = caseCandidateDedupeKey(signal);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "activation-deadline-v1", signal, submittedAt: new Date() },
    });
    const review = await call("POST", `/agent-candidates/${candidateId}/review`, OPERATOR, {
      boundaryId, decision: "accepted", reason: "test · governed review (synthetic)",
    });
    expect(review.statusCode).toBe(201);
    const promoted = await call("POST", `/agent-candidates/${candidateId}/promote`, OPERATOR, { boundaryId });
    expect(promoted.statusCode).toBe(201);
    const caseId: string = promoted.json().recoveryCase.recoveryCaseId;
    expect((await call("POST", `/cases/${caseId}/author`, OPERATOR)).statusCode).toBe(201);
    return caseId;
  }

  const nothingPersisted = async (recoveryCaseId: string) => {
    expect(await prisma.proof.count({ where: { recoveryCaseId } })).toBe(0);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId, action: "Approve" } })).toBe(0);
  };

  it("refuses BillingCorrection on a case whose governed root is not RevenueUnderBilled, and persists nothing", async () => {
    const caseId = await openActivationCase();
    const root = await prisma.recoveryCaseRecord.findUnique({ where: { recoveryCaseId: caseId } });
    expect(root?.recoveryType).toBe("ActivationMissed"); // the premise: a real root of another type

    const res = await call("POST", "/proofs", APPROVER, proofBody(caseId, "BillingCorrection"));
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("BillingCorrection");
    expect(res.json().message).toContain("RevenueUnderBilled");
    expect(res.json().message).toContain("'ActivationMissed'");
    await nothingPersisted(caseId);

    // Repeating it changes nothing: still refused, still nothing written.
    expect((await call("POST", "/proofs", APPROVER, proofBody(caseId, "BillingCorrection"))).statusCode).toBe(403);
    await nothingPersisted(caseId);
  });

  it("it is THIS rule that refused: the seven other reasons are not stopped by it on the same case", async () => {
    const caseId = await openActivationCase();
    const others = ALL_REASON_KEYS.filter((k) => k !== "BillingCorrection");
    expect(others).toHaveLength(7);
    for (const reason of others) {
      const res = await call("POST", "/proofs", APPROVER, proofBody(caseId, reason));
      // Past the scope check they reach the NEXT gate — which is now the OBLIGATION-IDENTITY gate, not
      // the baseline one. This case's candidate is an ACTIVATION signal and states no obligation
      // coverage, so every reason is refused there, before any baseline or evidence id is looked up.
      //
      // THE SUBJECT OF THIS TEST IS UNCHANGED and is still what the last two assertions check: the
      // refusal must not be the SCOPE rule. A different gate refusing afterwards does not weaken that;
      // it is why the message is asserted and not only the status.
      expect(res.statusCode, `${reason}: ${res.body}`).toBe(403);
      expect(res.json().message).toContain("OBLIGATION_COVERAGE_NOT_STATED");
      expect(res.body).not.toContain("applies only to");
      expect(res.body).not.toContain("no recorded recovery type");
    }
    await nothingPersisted(caseId);
  });

  it("authorization comes first: a caller who may not approve is refused earlier and learns nothing about the case's type", async () => {
    const caseId = await openActivationCase();
    const res = await call("POST", "/proofs", OPERATOR, proofBody(caseId, "BillingCorrection"));
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/may not perform 'Approve'/);
    expect(res.body).not.toContain("ActivationMissed");
    expect(res.body).not.toContain("RevenueUnderBilled");
    await nothingPersisted(caseId);
  });

  it("fails closed when the case has no governed root at all (absent is not 'any type')", async () => {
    // An authored case id with NO RecoveryCaseRecord — the shape seed-backed screens use. The Author row is
    // written directly because it is only the precondition that lets the request reach the scope check;
    // the thing under test is the route's answer.
    const caseId = `RC-noroot-${randomUUID().slice(0, 8)}`;
    await prisma.authorityEvent.create({
      data: {
        id: randomUUID(), recoveryCaseId: caseId, actorId: "dana@company", role: "author",
        action: "Author", policyVersion: AUTHORITY_POLICY_VERSION,
      },
    });
    expect(await prisma.recoveryCaseRecord.count({ where: { recoveryCaseId: caseId } })).toBe(0);

    const res = await call("POST", "/proofs", APPROVER, proofBody(caseId, "BillingCorrection"));
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("no recorded recovery type");
    await nothingPersisted(caseId);

    // Control: the same unrooted case with an unenforced reason is NOT refused by the scope rule. It is
    // refused by the obligation-identity gate instead — a case with no governed root has no recorded
    // subject — and the point of the control is WHICH rule answered, asserted on the message below.
    const control = await call("POST", "/proofs", APPROVER, proofBody(caseId, "UsageActivation"));
    expect(control.statusCode).toBe(403);
    expect(control.json().message).toContain("OBLIGATION_COVERAGE_NOT_STATED");
    expect(control.json().message).not.toContain("no recorded recovery type");
    expect(control.body).not.toContain("applies only to");
    await nothingPersisted(caseId);
  });

  it("a reason outside the closed vocabulary is still refused at the schema (400), before any of this", async () => {
    const caseId = await openActivationCase();
    const res = await call("POST", "/proofs", APPROVER, proofBody(caseId, "billing_correction"));
    expect(res.statusCode).toBe(400);
    await nothingPersisted(caseId);
  });
});
