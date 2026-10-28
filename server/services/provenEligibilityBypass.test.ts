// NEGATIVE CONTROLS · deliberate attempts to obtain PROVEN without establishing obligation identity.
//
// A gate that has only been seen to permit the right thing has not been tested. Each test below is an
// ATTACK, written to succeed if the gate can be talked around, and the assertion is that it is refused
// AND that nothing was written. "Refused" alone is insufficient: a 403 after a partial write would still
// have consumed the one proof chain the claim is allowed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import {
  APPROVER, AUTHOR, approveBody, seedGovernedRoot, uid,
} from "../test/fixtures";
import { assertCandidateSignal } from "../agents/admission";
import { caseProvenEligibility } from "./caseProvenGate";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("negative controls · attempts to bypass obligation identity", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const nothingWritten = async (caseId: string) => {
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(0);
  };

  /**
   * Write a candidate + accepted review + case root carrying an ARBITRARY coverage, in raw SQL.
   *
   * RAW SQL ON PURPOSE, and this is a finding rather than a convenience. Two separate controls refuse
   * the hostile shapes through the ordinary route, which the first draft of this file discovered by
   * being refused:
   *
   *   • `agent_case_candidates` is APPEND-ONLY BY DATABASE TRIGGER — "UPDATE ... is rejected (historical
   *     records are immutable)" — so a stored signal cannot be edited at all. Asserted on its own below.
   *   • `assertCandidateSignal` refuses an unreconcilable triple, a raw identifier and an extra key at
   *     the ingress boundary, so a hostile coverage cannot be created through the product either.
   *
   * So these rows are written UNDER both controls, to test the thing that is left: that the gate itself
   * re-derives the answer from the record rather than trusting what the record says. Two independent
   * checks of one arithmetic fact is the design; this proves the second one is real.
   */
  const seedHostileRoot = async (coverage: unknown) => {
    const caseId = `RC-nc-${randomUUID().slice(0, 8)}`;
    const boundaryId = `SYNTHETIC-nc-${randomUUID().slice(0, 8)}`;
    const candidateId = `CC-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const dedupeKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const sourceRef = `hmac-sha256:${"a".repeat(64)}`;
    const signal = {
      signalId: `NC-${randomUUID().slice(0, 8)}`, boundaryId, recoveryType: "RevenueUnderBilled",
      sourceRef, sourcePayloadHash: "b".repeat(64), detectorVersion: "nc-hostile-v1",
      observedAt: new Date(Date.now() - 86_400_000).toISOString(), amountAtRiskMinor: 1_000_000,
      currency: "USD", actionAvailable: true, expectedProofEvent: "nc",
      ...(coverage === undefined ? {} : { obligationCoverage: coverage }),
    };
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_case_candidates (candidate_id, dedupe_key, boundary_id, agent_id, signal,
         status, submitted_at, persisted_at)
       VALUES ($1, $2, $3, 'nc-hostile-v1', $4::jsonb, 'pending_review', now(), now())`,
      candidateId, dedupeKey, boundaryId, JSON.stringify(signal),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_case_candidate_reviews (review_id, candidate_id, boundary_id, decision, reason,
         actor_id, actor_role, policy_version, decided_at)
       VALUES ($1, $2, $3, 'accepted', 'nc', 'ops@company', 'operator', 'nc', now())`,
      `CR-${randomUUID().slice(0, 8)}`, candidateId, boundaryId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO recovery_cases (recovery_case_id, boundary_id, source_candidate_id, recovery_type,
         source_ref, amount_at_risk_minor, currency, detector_version, opened_by_actor_id,
         opened_by_role, policy_version, opened_at, persisted_at)
       VALUES ($1, $2, $3, 'RevenueUnderBilled', $4, 1000000, 'USD', 'nc-hostile-v1', 'ops@company',
         'operator', 'nc', now(), now())`,
      caseId, boundaryId, candidateId, sourceRef,
    );
    return { caseId, boundaryId, candidateId };
  };


  // ── 1 · THE REQUEST CANNOT CARRY THE FACT ─────────────────────────────────────────────────────────
  it("an approval request cannot assert its own obligation coverage — the field is not in the body", async () => {
    const { caseId } = await seedHostileRoot(undefined); // states no coverage at all
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        ...approveBody({
          proofId: `PF-${uid()}`, caseId, baselineId: `BL-${uid()}`, evidenceIds: [`EV-${uid()}`],
        }),
        // THE ATTACK: assert eligibility in the body.
        obligationCoverage: {
          kind: "SINGLE_OBLIGATION", obligationRef: `hmac-sha256:${"b".repeat(64)}`,
          expectedMinor: 1_000_000, billedMinor: 0, residualMinor: 1_000_000, currency: "USD",
        },
        obligationRef: `hmac-sha256:${"c".repeat(64)}`,
        provenEligible: true,
      },
    });
    // The schema refuses an undeclared property outright (400); if it ever stopped doing so, the gate
    // still refuses (403) because it never reads the body. Either answer is a pass; a 201 is not.
    expect([400, 403]).toContain(res.statusCode);
    const decision = await caseProvenEligibility(caseId);
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) expect(decision.code).toBe("OBLIGATION_COVERAGE_NOT_STATED");
    await nothingWritten(caseId);
  });

  // ── 2 · AN AGGREGATE CANNOT BE RELABELLED ─────────────────────────────────────────────────────────
  it("a multi-unit aggregate candidate cannot reach PROVEN, and the refusal names the aggregate", async () => {
    const { caseId } = await seedHostileRoot({ kind: "ACCOUNT_AGGREGATE", unitCount: 4 });
    const decision = await caseProvenEligibility(caseId);
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) expect(decision.code).toBe("OBLIGATION_COVERAGE_IS_AGGREGATE");

    // AUTHORED FIRST, so the request gets past the pre-existing unowned-case refusal and the message
    // under test is the identity gate's. Without this the route answers "no authoritative case
    // author/owner exists" — a different fail-closed control, and asserting it here would prove nothing
    // about this one.
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: approveBody({
        proofId: `PF-${uid()}`, caseId, baselineId: `BL-${uid()}`, evidenceIds: [`EV-${uid()}`],
      }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("OBLIGATION_COVERAGE_IS_AGGREGATE");
    await nothingWritten(caseId);
  });

  // ── 3 · A FABRICATED TRIPLE IS CAUGHT BY ARITHMETIC, TWICE ────────────────────────────────────────
  it("coverage whose discrepancy does not reconcile is refused by the gate, independently of the ingress check", async () => {
    const { caseId } = await seedHostileRoot({
      kind: "SINGLE_OBLIGATION", obligationRef: `hmac-sha256:${"d".repeat(64)}`,
      expectedMinor: 1_000_000, billedMinor: 0, residualMinor: 9_000_000, currency: "USD",
    });
    const decision = await caseProvenEligibility(caseId);
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) expect(decision.code).toBe("OBLIGATION_FACTS_INCONSISTENT");
    await nothingWritten(caseId);
  });

  // ── 3b · THE STORED SIGNAL CANNOT BE EDITED AT ALL ────────────────────────────────────────────────
  it("a stored candidate signal is immutable — the append-only trigger refuses the edit outright", async () => {
    const { caseId, candidateId } = await seedHostileRoot({ kind: "ACCOUNT_AGGREGATE", unitCount: 2 });
    // THE ATTACK: relabel a stored aggregate as a single obligation. This is the obvious bypass and the
    // database refuses it before the gate is reached, which is why the gate is not the only control.
    await expect(prisma.agentCaseCandidateRecord.update({
      where: { candidateId },
      data: {
        signal: {
          kind: "SINGLE_OBLIGATION", obligationRef: `hmac-sha256:${"a".repeat(64)}`,
        } as object,
      },
    })).rejects.toThrow(/append-only/);
    const decision = await caseProvenEligibility(caseId);
    expect(decision.eligible).toBe(false);
    await nothingWritten(caseId);
  });

  // ── 4 · A RAW IDENTIFIER CANNOT BE SMUGGLED IN AS AN OBLIGATION REFERENCE ─────────────────────────
  it("a raw obligation identifier is refused at the signal boundary, never stored as a pseudonym", () => {
    const base = {
      signalId: "NC-raw", boundaryId: "B", recoveryType: "RevenueUnderBilled",
      sourceRef: `hmac-sha256:${"e".repeat(64)}`, sourcePayloadHash: "f".repeat(64),
      detectorVersion: "nc", observedAt: new Date().toISOString(), amountAtRiskMinor: 1,
      currency: "USD", actionAvailable: true, expectedProofEvent: "x",
    };
    expect(() => assertCandidateSignal({
      ...base,
      obligationCoverage: {
        kind: "SINGLE_OBLIGATION", obligationRef: "ENT-REAL-CUSTOMER-0001",
        expectedMinor: 10, billedMinor: 0, residualMinor: 10, currency: "USD",
      },
    })).toThrow(/hmac-sha256 pseudonym, never a raw identifier/);
  });

  it("an extra field inside the coverage is a hard error, not a silent strip", () => {
    const base = {
      signalId: "NC-extra", boundaryId: "B", recoveryType: "RevenueUnderBilled",
      sourceRef: `hmac-sha256:${"e".repeat(64)}`, sourcePayloadHash: "f".repeat(64),
      detectorVersion: "nc", observedAt: new Date().toISOString(), amountAtRiskMinor: 1,
      currency: "USD", actionAvailable: true, expectedProofEvent: "x",
    };
    expect(() => assertCandidateSignal({
      ...base,
      obligationCoverage: {
        kind: "SINGLE_OBLIGATION", obligationRef: `hmac-sha256:${"a".repeat(64)}`,
        expectedMinor: 10, billedMinor: 0, residualMinor: 10, currency: "USD",
        provenEligible: true,
      },
    })).toThrow(/forbidden fields: provenEligible/);
  });

  it("a half-stated coverage is refused rather than completed", () => {
    const base = {
      signalId: "NC-half", boundaryId: "B", recoveryType: "RevenueUnderBilled",
      sourceRef: `hmac-sha256:${"e".repeat(64)}`, sourcePayloadHash: "f".repeat(64),
      detectorVersion: "nc", observedAt: new Date().toISOString(), amountAtRiskMinor: 1,
      currency: "USD", actionAvailable: true, expectedProofEvent: "x",
    };
    expect(() => assertCandidateSignal({
      ...base,
      obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef: `hmac-sha256:${"a".repeat(64)}` },
    })).toThrow(/is missing: billedMinor, currency, expectedMinor, residualMinor/);
  });

  // ── 5 · A CASE WITH NO GOVERNED ROOT CANNOT BE PROVEN ─────────────────────────────────────────────
  it("an authored case with no governed root is refused — the subject of the claim was never recorded", async () => {
    const caseId = `RC-noroot-${randomUUID().slice(0, 8)}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const decision = await caseProvenEligibility(caseId);
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) expect(decision.code).toBe("OBLIGATION_COVERAGE_NOT_STATED");
    await nothingWritten(caseId);
  });

  // ── 6 · AN ABSORBED OBSERVATION DEFEATS AN OTHERWISE PERFECT CLAIM ────────────────────────────────
  it("a recorded absorption refuses a single-obligation claim, and the refusal survives a retry", async () => {
    const caseId = `RC-${uid()}`;
    const seededRoot = await seedGovernedRoot(caseId);
    expect(seededRoot).not.toBeNull();
    const before = await caseProvenEligibility(caseId);
    expect(before.eligible).toBe(true);

    // An append-only `task.succeeded` event recording an admission that created nothing: the stored
    // shape of an absorbed observation. Written through the same tables production writes.
    const taskId = randomUUID();
    const signal = {
      recoveryType: "RevenueUnderBilled", sourceRef: seededRoot!.sourceRef,
      sourcePayloadHash: "a".repeat(64),
    };
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1, $2, 'nc-absorb', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
      taskId, seededRoot!.boundaryId, randomUUID(), JSON.stringify([signal]),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1, $2, $3, 'nc-absorb', 1, 1, 'task.succeeded', $4::jsonb, now())`,
      randomUUID(), taskId, seededRoot!.boundaryId,
      JSON.stringify({ admittedCount: 1, createdCount: 0 }),
    );

    const after = await caseProvenEligibility(caseId);
    expect(after.eligible).toBe(false);
    if (!after.eligible) expect(after.code).toBe("ABSORBED_OBSERVATION_RECORDED");
    // A RETRY CHANGES NOTHING. The refusal is derived from an append-only record, so it cannot be
    // cleared by asking again — which is the property that separates a gate from a flaky check.
    const retry = await caseProvenEligibility(caseId);
    expect(JSON.stringify(retry)).toBe(JSON.stringify(after));
    await nothingWritten(caseId);
  });
});
