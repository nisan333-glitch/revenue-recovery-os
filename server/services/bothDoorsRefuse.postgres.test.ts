// NEITHER DOOR MINTS AN UNATTESTABLE PROOF — the governed HTTP route or the pure approval path.
//
// The order this closes asks for "negative tests proving unsupported mechanisms cannot mint proofs
// through either server or frontend", and the reason both halves live in ONE file is the defect they
// exist to prevent: before this slice the two answered the same claim differently, and nothing
// compared them. Two files would have let one drift while the other stayed green.
//
// IT ALSO ASSERTS THE POSITIVE CONTROL. A build that refused everything would satisfy every negative
// assertion here and be useless, so `BillingCorrection` is driven to a real 201 through the governed
// route and to a real frozen `Proof` through the pure path, in the same file, on the same figures.
// A test that cannot fail is not a control.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import "../test/load-env";
import { CORRECTION_CHANNELS, DECLARED_CORRECTION_TYPES } from "../../src/domain/correctionMapping";
import { approveProofForCase, validateApproval, type CaseApprovalContext } from "../../src/domain/approval";
import { establishBaseline, lockBaseline } from "../../src/domain/baseline";
import { makeEvidence, type Evidence } from "../../src/domain/evidence";
import { money } from "../../src/domain/money";
import { CURRENT_POLICY } from "../../src/domain/policy";
import type { Actor } from "../../src/domain/authority";
import type { LeakageType } from "../../src/domain/types";

const HAS_DB = Boolean(process.env.DATABASE_URL);

/** Derived from the channel table, never hand-listed: declaring a channel changes this set. */
const CHANNEL_LESS = CORRECTION_CHANNELS.filter((c) => c.permitted.length === 0).map((c) => c.reason);
const WITH_CHANNEL = CORRECTION_CHANNELS.filter((c) => c.permitted.length > 0).map((c) => c.reason);

// ── The pure path ────────────────────────────────────────────────────────────────────────────────

const APPROVER: Actor = { id: "cfo@company", displayName: "CFO", roles: ["proofApprover"] };

const baselineFor = (leakType: LeakageType) =>
  lockBaseline(
    establishBaseline({
      baselineId: "BL-doors",
      method: CURRENT_POLICY.baselineMethodId,
      methodVersion: CURRENT_POLICY.baselineMethodVersion,
      sourceRefs: ["cohort:doors"],
      calculatedAmount: money(1_250_000, "USD"),
      applicableLeakType: leakType,
      effectiveAt: "2026-06-01T00:00:00.000Z",
      establishedAt: "2026-06-01T00:00:00.000Z",
      establishedBy: "system",
    }),
    "2026-06-02T00:00:00.000Z",
    "pre-registered",
  );

const correction: Evidence = makeEvidence({
  evidenceId: "EV-doors-fix", evidenceType: "corrective_invoice_issued", sourceSystem: "billing",
  sourceRecordId: "CN-D", observedAt: "2026-06-04T00:00:00.000Z", ingestedAt: "2026-06-04T00:00:00.000Z",
  trustClassification: "independent", suppliedBy: "billing",
});
const settlement: Evidence = makeEvidence({
  evidenceId: "EV-doors-paid", evidenceType: "invoice_paid", sourceSystem: "billing",
  sourceRecordId: "INV-D", observedAt: "2026-06-14T00:00:00.000Z", ingestedAt: "2026-06-14T00:00:00.000Z",
  trustClassification: "independent", suppliedBy: "billing",
});

function pureCtx(over: Partial<CaseApprovalContext> = {}): CaseApprovalContext {
  return {
    proofId: "PF-doors", recoveryCaseId: "RE-doors", approvedAt: "2026-06-20T00:00:00.000Z",
    ownerActorId: "owner@company", approverActor: APPROVER,
    baseline: baselineFor("RevenueUnderBilled"),
    evidence: [correction, settlement],
    interventionAt: "2026-06-03T00:00:00.000Z", outcomeObservedAt: "2026-06-14T00:00:00.000Z",
    collectedMinor: 1_800_000, currency: "USD", excludedMinor: 0,
    exclusionStatement: "No excluded recovery — asserted: the delta is the corrective charge.",
    recoveryReason: "BillingCorrection",
    attribution: "CN-D raised for the shortfall; INV-D settled it in full.",
    confidenceUsed: 92, policy: CURRENT_POLICY, recoveryType: "RevenueUnderBilled",
    ...over,
  };
}

describe("DOOR 1 · the pure approval path refuses every unattestable mechanism", () => {
  it("1 · the channel table really does split 1 / 7, so the loops below are about something", () => {
    expect(WITH_CHANNEL).toEqual(["BillingCorrection"]);
    expect(CHANNEL_LESS).toHaveLength(7);
    expect([...DECLARED_CORRECTION_TYPES]).toEqual(["corrective_invoice_issued", "billing_corrected"]);
  });

  it("2 · every channel-less mechanism is refused, WITH a corrective invoice on the case", () => {
    // The correction evidence is present and attested. The refusal is about the MECHANISM, so a
    // reader cannot conclude the remedy is a different upload.
    for (const reason of CHANNEL_LESS) {
      const ctx = pureCtx({ recoveryReason: reason as CaseApprovalContext["recoveryReason"] });
      const violations = validateApproval(ctx);
      expect(violations.join(" "), reason).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      expect(() => approveProofForCase(ctx), reason).toThrow(/CORRECTION_CHANNEL_NOT_DECLARED/);
    }
  });

  it("3 · a missing or blank recoveryType FAILS CLOSED for an enforced reason", () => {
    for (const recoveryType of [null, "", "   "]) {
      const violations = validateApproval(pureCtx({ recoveryType }));
      expect(violations.join(" "), JSON.stringify(recoveryType)).toMatch(/applies only to RevenueUnderBilled/);
      expect(() => approveProofForCase(pureCtx({ recoveryType }))).toThrow(/applies only to/);
    }
  });

  it("4 · a BillingCorrection on the wrong recovery type is refused on SCOPE", () => {
    const violations = validateApproval(pureCtx({ recoveryType: "ActivationMissed" }));
    expect(violations.join(" ")).toMatch(/applies only to RevenueUnderBilled/);
  });

  it("5 · an unknown reason is refused outright, not treated as unconstrained", () => {
    const violations = validateApproval(
      pureCtx({ recoveryReason: "MadeUpPlay" as CaseApprovalContext["recoveryReason"] }),
    );
    expect(violations.join(" ")).toContain("RECOVERY_REASON_UNKNOWN");
  });

  it("6 · the correction must be a CORRECTION, not merely some independent evidence", () => {
    // A paid invoice is outcome-role. On its own it says the money arrived and nothing about a fix.
    const violations = validateApproval(pureCtx({ evidence: [settlement] }));
    expect(violations.join(" ")).toContain("CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON");
    // And a credit note is deliberately NOT a correction — it moves billing the other way.
    const creditNote = makeEvidence({
      evidenceId: "EV-doors-credit", evidenceType: "credit_note_issued", sourceSystem: "billing",
      sourceRecordId: "CR-D", observedAt: "2026-06-04T00:00:00.000Z", ingestedAt: "2026-06-04T00:00:00.000Z",
      trustClassification: "independent", suppliedBy: "billing",
    });
    expect(validateApproval(pureCtx({ evidence: [creditNote, settlement] })).join(" "))
      .toContain("CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON");
  });

  it("7 · the correction cannot be self-asserted — a non-billing source does not reach the channel", () => {
    const productClaim = makeEvidence({
      evidenceId: "EV-doors-product", evidenceType: "corrective_invoice_issued", sourceSystem: "product",
      sourceRecordId: "P-D", observedAt: "2026-06-04T00:00:00.000Z", ingestedAt: "2026-06-04T00:00:00.000Z",
      trustClassification: "independent", suppliedBy: "product",
    });
    expect(validateApproval(pureCtx({ evidence: [productClaim, settlement] })).join(" "))
      .toContain("CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON");
  });

  it("8 · POSITIVE CONTROL · a real BillingCorrection mints a frozen proof of $5,500", () => {
    const violations = validateApproval(pureCtx());
    expect(violations).toEqual([]);
    const proof = approveProofForCase(pureCtx());
    expect(Object.isFrozen(proof)).toBe(true);
    expect(proof.revenueReturned.minor).toBe(550_000);
    expect(proof.recoveryReason).toBe("BillingCorrection");
  });

  it("9 · which correction is chosen does not depend on array order", () => {
    // Two corrections at different times; the earliest must win either way round. A selection that
    // followed iteration order would make the verdict a function of how the caller built the list.
    const later = makeEvidence({
      evidenceId: "EV-doors-fix2", evidenceType: "billing_corrected", sourceSystem: "billing",
      sourceRecordId: "CN-D2", observedAt: "2026-06-05T00:00:00.000Z", ingestedAt: "2026-06-05T00:00:00.000Z",
      trustClassification: "independent", suppliedBy: "billing",
    });
    const a = validateApproval(pureCtx({ evidence: [correction, later, settlement] }));
    const b = validateApproval(pureCtx({ evidence: [later, correction, settlement] }));
    expect(a).toEqual(b);
    expect(a).toEqual([]);
  });
});

// ── The governed route ───────────────────────────────────────────────────────────────────────────

describe.skipIf(!HAS_DB)("DOOR 2 · the governed route answers identically", () => {
  let app: import("fastify").FastifyInstance;
  const uid = () => Math.random().toString(16).slice(2, 10);

  beforeAll(async () => {
    const { buildApp } = await import("../app");
    const { fixtureVerifier } = await import("../test/sourceFixture");
    app = buildApp({ sourceVerifier: fixtureVerifier });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const { prisma } = await import("../db");
    await prisma.$disconnect();
  });

  /**
   * Drive a case to EVIDENCED through the real route, then attempt the approval.
   *
   * The case's recovery type is always `RevenueUnderBilled` — `seedGovernedRoot` fixes it, and that is
   * the HARDER setting for these tests rather than a convenience: it means every refusal below is the
   * CHANNEL refusing, with the scope gate already satisfied. A case of some other type would be
   * refused on scope first and would prove nothing about the channel.
   */
  async function attempt(reason: string) {
    const caseId = `RE-DOORS-${uid()}`;
    const { seedGovernedRoot } = await import("../test/fixtures");
    const { attestFixture } = await import("../test/sourceFixture");
    const author = { "x-actor-id": "owner@company", "x-actor-role": "operator" };
    const approver = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };

    await seedGovernedRoot(caseId, { expectedMinor: 1_800_000, billedMinor: 1_250_000 });
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: author });
    await app.inject({
      method: "POST", url: `/cases/${caseId}/baseline`, headers: author,
      payload: {
        baselineId: `BL-${caseId}`, calculatedMinor: 1_250_000, currency: "USD",
        method: "matched_historical_cohort", methodVersion: 1,
        sourceRefs: ["cohort:RevenueUnderBilled"], effectiveAt: "2026-06-01T09:00:00.000Z",
      },
    });
    await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: author });
    await app.inject({
      method: "POST", url: `/cases/${caseId}/evidence`, headers: author,
      payload: { ...attestFixture(caseId, {
        evidenceId: `EV-${caseId}-fix`, sourceSystem: "billing", sourceRecordId: `CN-${uid()}`,
        evidenceType: "corrective_invoice_issued", observedAt: "2026-06-04T14:00:00.000Z",
      }) },
    });
    const settled = await app.inject({
      method: "POST", url: `/cases/${caseId}/evidence`, headers: author,
      payload: { ...attestFixture(caseId, {
        evidenceId: `EV-${caseId}-src`, sourceSystem: "billing", sourceRecordId: `INV-${uid()}`,
        evidenceType: "invoice_paid", observedAt: "2026-06-14T09:00:00.000Z",
        amountMinor: 1_800_000, currency: "USD",
      }) },
    });
    expect(settled.statusCode, settled.body).toBe(201);
    const { evidenceId } = settled.json() as { evidenceId: string };
    const res = await app.inject({
      method: "POST", url: "/proofs", headers: approver,
      payload: {
        proofId: `PF-${caseId}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: 1_800_000, excludedRecoveryMinor: 0,
        exclusionStatement: "No excluded recovery — asserted.",
        recoveryReason: reason, attribution: "doors test",
        evidenceIds: [evidenceId], baselineId: `BL-${caseId}`, confidenceUsed: 92,
      },
    });
    return { caseId, res };
  }

  it("10 · every channel-less mechanism is 403, and mints nothing", async () => {
    const { prisma } = await import("../db");
    for (const reason of CHANNEL_LESS) {
      const { caseId, res } = await attempt(reason);
      expect(res.statusCode, `${reason}: ${res.body}`).toBe(403);
      expect(res.body, reason).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      // Two independent mechanisms: the route refuses, and no row exists to be read back.
      expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } }), reason).toBe(0);
    }
  }, 60_000);

  it("11 · POSITIVE CONTROL · BillingCorrection is 201 and mints exactly one proof of $5,500", async () => {
    const { prisma } = await import("../db");
    const { caseId, res } = await attempt("BillingCorrection");
    expect(res.statusCode, res.body).toBe(201);
    const rows = await prisma.proof.findMany({ where: { recoveryCaseId: caseId } });
    expect(rows).toHaveLength(1);
    // `Number(...)`: Prisma maps the column to `BigInt`, so `550000n` is not `550000`.
    expect(Number(rows[0]!.revenueReturnedMinor)).toBe(550_000);
    expect(rows[0]!.recoveryReason).toBe("BillingCorrection");
  }, 30_000);

  it("12 · BOTH DOORS agree, refusal code for refusal code", async () => {
    // The property this whole file exists for. The governed route's refusal code and the pure path's
    // must be the same for the same claim — not merely both non-empty.
    for (const reason of CHANNEL_LESS) {
      const pure = validateApproval(
        pureCtx({ recoveryReason: reason as CaseApprovalContext["recoveryReason"] }),
      ).join(" ");
      const { res } = await attempt(reason);
      expect(res.statusCode).toBe(403);
      // Same code on both sides.
      expect(pure).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      expect(res.body).toContain("CORRECTION_CHANNEL_NOT_DECLARED");
      // And the same mechanism named.
      expect(pure, reason).toContain(reason);
      expect(res.body, reason).toContain(reason);
    }
  }, 60_000);
});
