// The governed Recovery Case read surface — and the falsifiers for the rules it has to keep.
//
// WHAT THIS SUITE IS REALLY PROTECTING. The constitution's working rule for this slice is that an
// identified gap is not returned money, on every screen and in every report. A JSON payload is a report.
// So the tests below do not merely check that the route answers: they check that the at-risk figure can
// never arrive in the proven field, that an absent proof reads as NOT COMPUTED rather than as zero, and
// that each of the three ways this surface must fail closed actually does.
//
// Skips without DATABASE_URL (the same gate as the rest of the server suite).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { AUTHOR, APPROVER, STEWARD, uid, seedBaseline, seedIntervention, seedEvidence, approveBody } from "../test/fixtures";
import { readRecoveryCase } from "./recoveryCaseRead";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { AUTHORITY_ACTIONS } from "../../src/domain/caseLifecycle";
import { refusesObligationLevelGuarantee } from "../../src/domain/caseIdentityGrain";
import {
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  OBLIGATION_IDENTITY_FIELDS,
} from "../../src/contract/leakInstanceIdentity";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;

const AMOUNT_AT_RISK_MINOR = 10_000;

const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

/**
 * Promote one candidate into an authoritative Recovery Case, through the REAL governed path:
 * candidate row → immutable accepted review → `CandidatePromotionService.promote`.
 *
 * Deliberately not an INSERT into `recovery_cases`. A fixture that writes the row directly would let
 * every assertion below pass against a case the product could never have produced.
 */
async function promoteCase(boundaryId: string, operator: ActorContext) {
  const signal = {
    signalId: `ACT-${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 32)}`,
    boundaryId,
    recoveryType: "ActivationMissed",
    sourceRef: `hmac-sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`,
    sourcePayloadHash: createHash("sha256").update(randomUUID()).digest("hex"),
    detectorVersion: "activation-deadline-v1",
    observedAt: new Date().toISOString(),
    amountAtRiskMinor: AMOUNT_AT_RISK_MINOR,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "activation followed by next invoice paid",
  };
  const dedupeKey = caseCandidateDedupeKey(signal);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "activation-deadline-v1", signal, submittedAt: new Date() },
  });

  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId,
    boundaryId,
    decision: "accepted",
    reason: "test · governed review",
  });
  const promotion = new CandidatePromotionService(store);
  const promoted = await promotion.promote(operator, candidateId, boundaryId);
  return { candidateId, promotion, ...promoted };
}

describe.skipIf(!HAS_DB)("the governed Recovery Case read surface", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const boundary = () => `TEST-rc-${uid()}`;
  const operatorIn = (b: string) => actor("op@test", "operator", [b]);
  const approverIn = (b: string) => actor("cfo@test", "approver", [b]);

  it("1 · a promoted case reads back its frozen root, OPENED, with the proven ledger NOT COMPUTED", async () => {
    const b = boundary();
    const { recoveryCase, candidateId } = await promoteCase(b, operatorIn(b));
    const view = await readRecoveryCase(approverIn(b), recoveryCase.recoveryCaseId);

    expect(view.root.sourceCandidateId).toBe(candidateId);
    expect(view.root.boundaryId).toBe(b);
    expect(view.root.detectorVersion).toBe("activation-deadline-v1");
    expect(view.root.amountAtRiskMinor).toBe(AMOUNT_AT_RISK_MINOR);
    expect(view.lifecycle.progress).toBe("OPENED");
    expect(view.lifecycle.exposure.minor).toBe(AMOUNT_AT_RISK_MINOR);

    // "Not computed" is not "zero". A promoted case with no proof has no proven figure AT ALL, and the
    // reason is named — a `0` here would assert that a proof was found and established nothing.
    expect(view.provenRevenueReturnedMinor).toBeNull();
    expect(view.lifecycle.revenueReturned).toBeNull();
    expect(view.provenLedgerUnavailableReason).toBe("no_effective_recovery_proof");
    expect(view.provenFromProofIds).toEqual([]);

    // The promotion's own ledger row is recognised vocabulary, not an "unknown action" on every case.
    expect(view.lifecycle.trail.map((t) => t.action)).toEqual(["PromoteCandidate"]);
    expect(view.unknownAuthorityActions).toEqual([]);
  });

  it("2 · FAILS CLOSED · an authority ledger with no promotion root is not a Recovery Case", async () => {
    // `seedAuditableCase` builds a full `RC-…` history — author, baseline, intervention, evidence —
    // and creates NO `recovery_cases` row, because nothing in that path promotes a candidate. The audit
    // route answers for such an id by design; this one must not.
    const caseId = `RC-${uid()}`;
    const b = boundary();
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } })).toBe(1);

    await expect(readRecoveryCase(approverIn(b), caseId)).rejects.toThrow(/no authoritative root/);
    const res = await app.inject({ method: "GET", url: `/recovery-cases/${caseId}`, headers: APPROVER });
    expect(res.statusCode).toBe(404);
  });

  it("3 · FAILS CLOSED · a beneficiary role is refused, and learns nothing about the case", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    // The operator who OPENED the case holds no `AuditRead`. The refusal is the existing EP-8.1 H2
    // decision, applied unchanged — no new permission is invented to make this surface convenient.
    for (const role of ["author", "operator"] as const) {
      await expect(readRecoveryCase(actor("x@test", role, [b]), recoveryCase.recoveryCaseId)).rejects.toThrow(
        /may not perform 'AuditRead'/,
      );
    }
    // And the refusal happens BEFORE the case is looked up, so it is identical for an id that does not
    // exist — an unauthorized actor cannot probe for which case ids are real.
    await expect(readRecoveryCase(actor("x@test", "operator", [b]), `RC-${uid()}`)).rejects.toThrow(
      /may not perform 'AuditRead'/,
    );
  });

  it("4 · FAILS CLOSED · oversight authority in the WRONG boundary is refused", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    await expect(
      readRecoveryCase(actor("cfo@other", "approver", ["SOME-OTHER-BOUNDARY"]), recoveryCase.recoveryCaseId),
    ).rejects.toThrow(/not authorized for this boundary/);
    // The boundary is taken from the ROOT, never from the request: there is no parameter by which a
    // caller could name the boundary a case belongs to.
    await expect(
      readRecoveryCase(actor("cfo@none", "approver", []), recoveryCase.recoveryCaseId),
    ).rejects.toThrow(/not authorized for this boundary/);
  });

  it("5 · progress advances with the history, and exposure NEVER becomes the proven figure", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const caseId = recoveryCase.recoveryCaseId;
    const read = () => readRecoveryCase(approverIn(b), caseId);

    expect((await read()).lifecycle.progress).toBe("OPENED");

    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    let view = await read();
    expect(view.lifecycle.progress).toBe("OWNED");
    expect(view.lifecycle.responsible).toEqual({ actorId: "dana@company", role: "author" });

    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 2_000 });
    expect((await read()).lifecycle.progress).toBe("BASELINED");

    await seedIntervention(app, caseId);
    expect((await read()).lifecycle.progress).toBe("INTERVENED");

    const { evidenceId, res: evRes } = await seedEvidence(app, caseId, { amountMinor: 9_000, currency: "USD" });
    expect(evRes.statusCode).toBe(201);
    view = await read();
    expect(view.lifecycle.progress).toBe("EVIDENCED");
    expect(view.evidence.map((e) => e.evidenceId)).toEqual([evidenceId]);

    // EVIDENCED is as far as evidence alone goes. Up to this exact point the proven ledger is still
    // NOT COMPUTED — evidence is not a proof, and a renderer has nothing it could print as recovered.
    expect(view.provenRevenueReturnedMinor).toBeNull();
    expect(view.provenLedgerUnavailableReason).toBe("no_effective_recovery_proof");

    const proofId = `PF-${uid()}`;
    const approve = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor: 9_000 }),
    });
    expect(approve.statusCode).toBe(201);

    view = await read();
    expect(view.lifecycle.progress).toBe("PROVEN");
    // 9_000 collected − 2_000 baseline = 7_000, computed by the kernel and merely read here.
    expect(view.provenRevenueReturnedMinor).toBe(7_000);
    expect(view.provenFromProofIds).toEqual([proofId]);
    expect(view.provenLedgerUnavailableReason).toBeNull();

    // THE SEPARATION, stated as an assertion rather than as a label: the exposure recorded at promotion
    // and the money a proof established are different numbers and neither moved into the other.
    expect(view.lifecycle.exposure.minor).toBe(AMOUNT_AT_RISK_MINOR);
    expect(view.lifecycle.revenueReturned?.minor).toBe(7_000);
    expect(view.lifecycle.exposureIsNotRecoveredRevenue).toBe(true);
    expect(view.exposureLabel).toMatch(/not money returned/i);
  });

  it("6 · NO DUPLICATE CASE · re-promoting the same finding returns the same case and writes no row", async () => {
    const b = boundary();
    const op = operatorIn(b);
    const { recoveryCase, candidateId, promotion } = await promoteCase(b, op);

    const replay = await promotion.promote(op, candidateId, b);
    expect(replay.created).toBe(false);
    expect(replay.recoveryCase.recoveryCaseId).toBe(recoveryCase.recoveryCaseId);
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: b } })).toBe(1);

    // And the SECOND promotion left no second ledger row either, so the trail cannot imply two openings.
    const view = await readRecoveryCase(approverIn(b), recoveryCase.recoveryCaseId);
    expect(view.lifecycle.trail.filter((t) => t.action === "PromoteCandidate")).toHaveLength(1);
  });

  it("7 · NO MONETARY PROMOTION WITHOUT AN EFFECTIVE PROOF · a reversal returns the ledger to NOT COMPUTED", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const caseId = recoveryCase.recoveryCaseId;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 2_000 });
    await seedIntervention(app, caseId);
    const { evidenceId } = await seedEvidence(app, caseId, { amountMinor: 9_000, currency: "USD" });
    const proofId = `PF-${uid()}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/proofs",
          headers: APPROVER,
          payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor: 9_000 }),
        })
      ).statusCode,
    ).toBe(201);
    expect((await readRecoveryCase(approverIn(b), caseId)).provenRevenueReturnedMinor).toBe(7_000);

    const reversal = await app.inject({
      method: "POST",
      url: `/proofs/${proofId}/revisions`,
      headers: APPROVER,
      payload: { newProofId: `PF-${uid()}`, status: "Reversed" },
    });
    expect(reversal.statusCode).toBe(201);

    const view = await readRecoveryCase(approverIn(b), caseId);
    // Back to NOT COMPUTED, not to zero — and the case does not read PROVEN any more either. The frozen
    // history is untouched: the reversal is a new linked record and both proof rows still exist.
    expect(view.provenRevenueReturnedMinor).toBeNull();
    expect(view.provenLedgerUnavailableReason).toBe("no_effective_recovery_proof");
    expect(view.lifecycle.revenueReturned).toBeNull();
    expect(view.lifecycle.progress).toBe("EVIDENCED");
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(2);
  });

  it("8 · a governance marker is reported ALONGSIDE progress, never instead of it", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const caseId = recoveryCase.recoveryCaseId;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/halt`, headers: STEWARD })).statusCode).toBe(201);

    const view = await readRecoveryCase(approverIn(b), caseId);
    expect(view.lifecycle.governance).toContain("HALTED");
    expect(view.lifecycle.progress).toBe("OWNED");
    // A halt must make a case MORE inspectable — `caseGuard.ts` says every read stays available on a
    // halted case, and this surface is a read.
    expect(view.root.recoveryCaseId).toBe(caseId);
  });

  it("8b · THE GRAIN DISCLOSURE · the case says what its identity covers, and refuses the guarantee", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const view = await readRecoveryCase(approverIn(b), recoveryCase.recoveryCaseId);

    // Account-grained, and the payload says so rather than leaving a reader to infer it from `sourceRef`.
    expect(view.identityGrain.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(view.identityGrain.mayCoverMultipleObligations).toBe(true);
    expect(view.identityGrain.obligationUniquenessGuaranteed).toBe(false);
    expect(view.identityGrain.headline).toMatch(/ACCOUNT-LEVEL IDENTITY/);
    // The reason is the contract's own exported sentence, not one authored at this call site.
    expect(view.identityGrain.reason).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);

    // NOT CHECKED is not NONE. This route does not run the forensic join, and it says so rather than
    // reporting a zero nobody measured.
    expect(view.identityGrain.absorbedObservations).toEqual({ checked: false });

    // FAILS CLOSED: any action wanting a per-obligation guarantee is refused, with the reason attached.
    const gate = refusesObligationLevelGuarantee(view.identityGrain);
    expect(gate.permitted).toBe(false);
    expect(gate.refusal).toContain(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
  });

  it("8c · the disclosure is derived from the CONTRACT, so it cannot be set affirmative here", async () => {
    // The negative control at the API boundary. `OBLIGATION_IDENTITY_FIELDS` is empty, so the guaranteed
    // state is unreachable through this route for any case, promoted however.
    expect(OBLIGATION_IDENTITY_FIELDS).toHaveLength(0);
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const view = await readRecoveryCase(approverIn(b), recoveryCase.recoveryCaseId);
    expect(view.identityGrain.grain).not.toBe("OBLIGATION_UNIQUENESS_GUARANTEED");
  });

  it("8d · the disclosure leaks nothing · the refusals still fire and carry no case data", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    // A beneficiary role and a wrong boundary are still refused — the new field did not widen the gate.
    await expect(
      readRecoveryCase(actor("op@test", "operator", [b]), recoveryCase.recoveryCaseId),
    ).rejects.toThrow(/may not perform 'AuditRead'/);
    await expect(
      readRecoveryCase(actor("cfo@other", "approver", ["OTHER"]), recoveryCase.recoveryCaseId),
    ).rejects.toThrow(/not authorized for this boundary/);
    // And a 403 body carries no grain disclosure either, which would otherwise be a free read.
    const res = await app.inject({
      method: "GET", url: `/recovery-cases/${recoveryCase.recoveryCaseId}`,
      headers: { "x-actor-id": "op@test", "x-actor-role": "operator" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("ACCOUNT-LEVEL IDENTITY");
    expect(res.body).not.toContain("identityGrain");
  });

  it("9 · the HTTP route carries the whole governed answer, not a summary", async () => {
    const b = boundary();
    const { recoveryCase } = await promoteCase(b, operatorIn(b));
    const res = await app.inject({
      method: "GET",
      url: `/recovery-cases/${recoveryCase.recoveryCaseId}`,
      headers: APPROVER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.root.recoveryCaseId).toBe(recoveryCase.recoveryCaseId);
    expect(body.lifecycle.progress).toBe("OPENED");
    expect(body.lifecycle.exposureIsNotRecoveredRevenue).toBe(true);
    // `null` SURVIVES THE WIRE. A field dropped by serialisation would be read as "absent", which a
    // renderer is free to turn into 0 — the exact failure the domain type exists to prevent.
    expect(Object.keys(body)).toContain("provenRevenueReturnedMinor");
    expect(body.provenRevenueReturnedMinor).toBeNull();
    expect(body.provenLedgerUnavailableReason).toBe("no_effective_recovery_proof");
  });
});

// This one needs no database: it reads the server's source and asks what the code writes.
describe("the authority vocabulary is derived from the code, not from memory", () => {
  it("10 · every action string any writer puts in the ledger is known to the derivation", () => {
    // A STRUCTURAL GUARD MUST READ THE CONSTRUCT IT IS ASKING ABOUT. The question is "what action values
    // reach `authority_events`", and the answer has three sources, which is how `PromoteCandidate` and
    // `Approve` were missing from the first version of `AUTHORITY_ACTIONS`: both are written straight to
    // `authorityEvent.create`, bypassing `recordAuthority` entirely.
    const sources = [
      "server/services/proofService.ts",
      "server/agents/postgresCandidateReviewStore.ts",
      "server/persistence/proofStore.ts",
    ];
    const written = new Set<string>();
    for (const file of sources) {
      const code = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      for (const m of code.matchAll(/recordAuthority\([^,]+,[^,]+,\s*"([A-Za-z]+)"/g)) written.add(m[1]!);
      for (const m of code.matchAll(/\baction:\s*"([A-Za-z]+)"/g)) written.add(m[1]!);
    }
    // The guard has to be able to fire: if the scan finds nothing, it would pass vacuously.
    expect(written.size).toBeGreaterThanOrEqual(7);
    expect([...written].sort()).toEqual(
      [...written].filter((a) => (AUTHORITY_ACTIONS as readonly string[]).includes(a)).sort(),
    );
  });
});
