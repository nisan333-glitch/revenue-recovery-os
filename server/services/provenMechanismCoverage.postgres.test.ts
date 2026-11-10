// PROVEN COVERAGE ACROSS THE EIGHT CORRECTION MECHANISMS — measured, and the gap PINNED rather than closed.
//
// THE DETERMINATION, from the repository's own evidence contracts rather than from preference:
//
//   `BillingCorrection` is the ONLY mechanism whose recovery can be proven, because it is the only one
//   where the executed correction and the collected money are linked by an ACCOUNTING IDENTITY on the
//   same obligation: the billing system raised a corrective charge for X, and X was collected. Both
//   halves have declared, source-attested evidence types — `corrective_invoice_issued` /
//   `billing_corrected` for the correction, `invoice_paid` / `payment_received` for the collection.
//
//   The other seven apply to lifecycle and engagement leakage (StalledOnboarding, ActivationMissed,
//   NoFirstValue, LowAdoption, ExpansionStalled, RenewalAtRisk). Their "correction" is a human action —
//   an outreach, a session, a nudge, a flag switched on. NO SOURCE SYSTEM ATTESTS ANY OF THEM, and the
//   link between the action and a later payment is a BEHAVIOURAL HYPOTHESIS, not a chain on one
//   obligation. Closing that link is CAUSATION, which `causationEstablished = false` withholds by
//   construction. So those seven are not merely unimplemented: they are unprovable under the current
//   trust model, and no evidence contract that could be added would change that without a separately
//   validated causal standard.
//
// WHAT THIS FILE THEREFORE DOES. It asserts the determination where the determination is enforced, and
// it ASSERTS THE CURRENT BEHAVIOUR WHERE THE GAP IS STILL OPEN — the same thing
// `provenGateGaps.postgres.test.ts` does for G1 and G2. The gap test is written to FAIL the day the
// refusal becomes blocking, so whoever closes it must update this record in the same change. A gap that
// is merely described in prose gets forgotten; a gap that is asserted cannot be.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import {
  correctionMapping, mappingBlocksApproval, DECLARED_REASONS, CORRECTION_CHANNELS,
  BLOCKING_MAPPING_CODES, ALL_MAPPING_REFUSALS_BLOCK, type CorrectionMappingCode,
} from "../../src/domain/correctionMapping";
import { ENFORCED_REASON_SCOPE, reasonScopeViolation } from "../../src/domain/reasons";
import { cfoAuditExport } from "../audit/auditService";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;
const actor = (a: string, r: ActorContext["role"], b: readonly string[]): ActorContext =>
  Object.freeze({ actorId: a, role: r, boundaryIds: Object.freeze([...b]) });

/** The one mechanism whose evidence chain is an accounting identity rather than a hypothesis. */
const PROVABLE = "BillingCorrection";

describe("PROVEN coverage · the determination, from the evidence contracts", () => {
  it("exactly ONE of the eight mechanisms has a declared correction channel", () => {
    const withChannel = CORRECTION_CHANNELS.filter((c) => c.permitted.length > 0).map((c) => c.reason);
    expect(DECLARED_REASONS).toHaveLength(8);
    expect(withChannel).toEqual([PROVABLE]);
  });

  it("and the other seven DECLARE why no channel exists, rather than leaving the list empty", () => {
    // An empty `permitted` must read as decided-not-to-exist, never as nobody-filled-it-in.
    for (const c of CORRECTION_CHANNELS.filter((x) => x.permitted.length === 0)) {
      expect(c.why, c.reason).toMatch(/no source-attested correction channel exists/);
      expect(c.why, c.reason).toMatch(/governance decision/);
    }
  });

  it("only ONE mechanism has an ENFORCED case-type scope — the other seven are unscoped", () => {
    // `RECOVERY_REASONS.appliesTo` is prose; `ENFORCED_REASON_SCOPE` is the enforced form, and it holds
    // one entry. So seven reasons may currently be attached to a case of ANY recovery type, and
    // `reasonScopeViolation` returns null for them by its own stated contract.
    expect(Object.keys(ENFORCED_REASON_SCOPE)).toEqual([PROVABLE]);
    expect(reasonScopeViolation(PROVABLE, "ActivationMissed")).not.toBeNull();
    expect(reasonScopeViolation("UsageActivation", "RevenueUnderBilled")).toBeNull();
    expect(reasonScopeViolation("OnboardingReboot", "RevenueUnderBilled")).toBeNull();
  });

  it("the refusal for the seven is COMPUTED but does NOT block an approval today", () => {
    for (const reason of DECLARED_REASONS) {
      const verdict = correctionMapping(reason, "corrective_invoice_issued");
      if (reason === PROVABLE) {
        expect(verdict.ok).toBe(true);
        continue;
      }
      expect(verdict.ok).toBe(false);
      expect(!verdict.ok && verdict.code).toBe("CORRECTION_CHANNEL_NOT_DECLARED");
      // CLOSED 2026-11-10, owner-approved. This assertion was `toBe(false)` and recorded the gap; it is
      // now the opposite claim, and the inversion is the whole change.
      expect(mappingBlocksApproval(verdict)).toBe(true);
    }
  });

  it("EVERY mapping refusal blocks — the set is exhaustive, not a list someone must remember to extend", () => {
    // THE DANGEROUS SHAPE THIS FORBIDS. If a future `CorrectionMappingCode` is added and left out of
    // `BLOCKING_MAPPING_CODES`, a new unsupported mechanism could mint Revenue Returned while every
    // existing test still passed. Enumerating the codes from a verdict is not enough — they must be
    // enumerated from the TYPE's own inhabitants, which is what this list is.
    const everyCode: CorrectionMappingCode[] = [
      "RECOVERY_REASON_UNKNOWN",
      "CORRECTION_CHANNEL_NOT_DECLARED",
      "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON",
    ];
    for (const code of everyCode) {
      expect(BLOCKING_MAPPING_CODES, code).toContain(code);
    }
    expect(BLOCKING_MAPPING_CODES).toHaveLength(everyCode.length);
    expect(ALL_MAPPING_REFUSALS_BLOCK).toBe(true);
  });
});

describe.skipIf(!HAS_DB)("PROVEN coverage · the gap, measured on the real path", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function provableCase(): Promise<string> {
    const boundaryId = `TEST-pmc-${uid()}`;
    const sourceRef = pseudonym();
    const signal = {
      signalId: `FIX-${hex().slice(0, 32)}`, boundaryId, recoveryType: "RevenueUnderBilled", sourceRef,
      sourcePayloadHash: hex(), detectorVersion: "proven-coverage-v1",
      observedAt: new Date(Date.now() - 86_400_000).toISOString(),
      amountAtRiskMinor: 60_000, currency: "USD", actionAvailable: true,
      expectedProofEvent: "corrective invoice raised and collected",
      obligationCoverage: {
        kind: "SINGLE_OBLIGATION", obligationRef: pseudonym(),
        expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 60_000, currency: "USD",
      },
    };
    const dk = caseCandidateDedupeKey(signal as never);
    const cid = caseCandidateId(dk);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId: cid, dedupeKey: dk, boundaryId, agentId: "proven-coverage-v1", signal, submittedAt: new Date() },
    });
    const op = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(op, {
      candidateId: cid, boundaryId, decision: "accepted", reason: "coverage · synthetic governed review",
    });
    const promoted = await new CandidatePromotionService(store).promote(op, cid, boundaryId);
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1,$2,'proven-coverage-v1',$3,'{}'::jsonb,'succeeded',1,now(),1,$4::jsonb,now(),now())`,
      taskId, boundaryId, randomUUID(), JSON.stringify([signal]),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1,$2,$3,'proven-coverage-v1',1,1,'task.succeeded',$4::jsonb,now())`,
      randomUUID(), taskId, boundaryId, JSON.stringify({ admittedCount: 1, createdCount: 1 }),
    );
    return promoted.recoveryCase.recoveryCaseId;
  }

  async function caseBoundary(caseId: string): Promise<string> {
    const row = await prisma.recoveryCaseRecord.findUnique({
      where: { recoveryCaseId: caseId }, select: { boundaryId: true },
    });
    if (!row) throw new Error(`no governed root for ${caseId}`);
    return row.boundaryId;
  }

  async function approveWith(reason: string): Promise<{ status: number; body: string; caseId: string }> {
    const caseId = await provableCase();
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, caseId);
    const { evidenceId } = await seedEvidence(app, caseId, { amountMinor: 70_000, currency: "USD" });
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId: `SYNTHETIC-proof-${randomUUID()}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: 70_000, excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: reason, attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    return { status: res.statusCode, body: res.body, caseId };
  }

  it("POSITIVE · BillingCorrection reaches PROVEN, which is the supported mechanism", async () => {
    const res = await approveWith("BillingCorrection");
    expect(res.status, res.body).toBe(201);
    expect(JSON.parse(res.body).revenueReturned.minor).toBe(60_000);
  }, 120_000);

  // ── WHAT THESE TESTS REPLACED, kept because the inversion is the record ──────────────────────────
  //
  // Until 2026-11-10 one test here asserted the DEFECT: that `UsageActivation` reached 201 and minted
  // $600.00 on a billing correction record. It was written to fail the day the refusal became blocking,
  // and it did. These are its replacements, and they assert the opposite in three independent ways —
  // the status, the absence of a proof row, and the absence of any Revenue Returned at all.
  //
  // THREE ASSERTIONS AND NOT ONE, because "403" alone would not establish that no money was minted. A
  // refusal that nonetheless wrote a row would satisfy a status check and violate the rule.

  it("REJECTED · every unsupported mechanism is refused, and mints NOTHING", async () => {
    for (const reason of DECLARED_REASONS.filter((r) => r !== PROVABLE)) {
      const { status, body, caseId } = await approveWith(reason);
      expect(status, `${reason}: ${body}`).toBe(403);
      expect(body, reason).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      // NO PROOF ROW. The decisive assertion: a refusal that still wrote a proof would pass a status
      // check and break the rule.
      expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } }), reason).toBe(0);
      // AND NO REVENUE RETURNED ANYWHERE FOR THIS CASE. `null` is NOT COMPUTED; a `0` here would assert
      // that a proof was found and summed to nothing, which is a different and false claim.
      const auditor = actor("cfo@company", "approver", [(await caseBoundary(caseId))]);
      const audit = await cfoAuditExport(auditor, caseId);
      expect(audit.provenRevenueReturnedMinor, reason).toBeNull();
    }
  }, 600_000);

  it("REJECTED · the refusal names the mechanism and says the channel does not exist", async () => {
    // A refusal a CFO cannot read is not a control. The message must name which mechanism was claimed
    // and why no evidence could substantiate it — not merely that something was forbidden.
    const { status, body } = await approveWith("UsageActivation");
    expect(status).toBe(403);
    expect(body).toContain("UsageActivation");
    expect(body).toContain("no source-attested correction channel exists for this mechanism");
    expect(body).toMatch(/governance decision/);
  }, 120_000);

  it("CONTROL · a reason outside the closed vocabulary IS refused, so the gate is not inert", async () => {
    // Without this the two tests above could be measuring an endpoint that accepts anything at all.
    const res = await approveWith("NotADeclaredReason");
    expect(res.status).toBe(400);
    expect(res.body).toContain("must be equal to one of the allowed values");
  }, 120_000);

  it("CONTROL · BillingCorrection on a case of the WRONG type is refused by enforced scope", async () => {
    // The one enforced scope really does fire, which is what makes its absence for the other seven a
    // measurable gap rather than a theory.
    expect(reasonScopeViolation("BillingCorrection", "ActivationMissed"))
      .toContain("applies only to RevenueUnderBilled");
  });
});
