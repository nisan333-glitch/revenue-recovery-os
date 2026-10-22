// PHASE 3 REGRESSION · the safety disclosure works, and it changed nothing it was not allowed to change.
//
// WHY THIS IS A SEPARATE FILE. `obligationMergeExposure.test.ts` MEASURES the merge; this one asserts the
// SAFETY PROPERTIES of the disclosure built on top of that measurement. Keeping them apart means a future
// change to the measurement cannot quietly weaken a safety assertion by living in the same describe.
//
// THE BAR: every test below demonstrates current BEHAVIOUR. None of them asserts that a warning string
// exists — the string assertions live on the screens, where the string is the deliverable. Here the
// claims are about what the system does: one candidate for two obligations, a derived disclosure that
// therefore reaches rows written before it existed, and dedupe/money/authority left byte-identical.
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../db";
import { buildApp } from "../app";
import { fixtureVerifier } from "../test/sourceFixture";
import { readRecoveryCase } from "./recoveryCaseRead";
import { CandidateReviewService, InMemoryCandidateReviewStore } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { CaseAdmissionService, InMemoryCaseCandidateStore, caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { AUTHORITY_ACTIONS } from "../../src/domain/caseLifecycle";
import { refusesObligationLevelGuarantee } from "../../src/domain/caseIdentityGrain";
import {
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  OBLIGATION_IDENTITY_FIELDS,
} from "../../src/contract/leakInstanceIdentity";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

/** Two obligations of ONE account differ in everything the contract can carry EXCEPT the account. */
const obligationOf = (boundaryId: string, sourceRef: string, amountAtRiskMinor: number, seed: string) =>
  Object.freeze({
    signalId: `ACT-${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`,
    boundaryId,
    recoveryType: "ActivationMissed",
    sourceRef,
    sourcePayloadHash: createHash("sha256").update(seed).digest("hex"),
    detectorVersion: "activation-deadline-v1",
    observedAt: "2026-06-01T00:00:00.000Z",
    amountAtRiskMinor,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "activation followed by next invoice paid",
  });

describe("grain safety · two obligations of one account", () => {
  it("collapse into ONE candidate, and the disclosure is what says so", async () => {
    // The behaviour first, with no reference to any warning: the merge is real.
    const boundaryId = `tenant-${uid()}`;
    const sourceRef = `hmac-sha256:${createHash("sha256").update(boundaryId).digest("hex")}`;
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };

    const first = await service.submit("activation-deadline-v1", obligationOf(boundaryId, sourceRef, 40_000, "one"), policy);
    const second = await service.submit("activation-deadline-v1", obligationOf(boundaryId, sourceRef, 60_000, "two"), policy);
    if (!first.admitted || !second.admitted) throw new Error("both were expected to clear the gate");

    // Both cleared admission. One candidate exists. It carries the FIRST amount, and $600.00 of observed
    // exposure is in no candidate, no case and no figure any screen renders.
    expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
    expect(second.candidate.signal.amountAtRiskMinor).toBe(40_000);
    expect(second.created).toBe(false);

    // And the two signals really were distinct observations — differing amount AND content digest — so
    // this is a merge of different things rather than a replay of one.
    expect(obligationOf(boundaryId, sourceRef, 40_000, "one").sourcePayloadHash)
      .not.toBe(obligationOf(boundaryId, sourceRef, 60_000, "two").sourcePayloadHash);

    // NOW the disclosure. The queue the operator reads declares the grain on that single candidate.
    const queueStore = new InMemoryCandidateReviewStore();
    queueStore.seed(first.candidate);
    const queue = await new CandidateReviewService(queueStore).list(
      actor("op", "operator", [boundaryId]),
      boundaryId,
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]!.identityGrain.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(queue[0]!.identityGrain.mayCoverMultipleObligations).toBe(true);
    expect(refusesObligationLevelGuarantee(queue[0]!.identityGrain).permitted).toBe(false);
  });

  it("RE-OBSERVING the same obligation makes no claim that a second one was absorbed", async () => {
    // The dedupe key is identical in both cases, so the candidate layer cannot tell a reassessment of one
    // obligation from the arrival of a second. The disclosure must therefore not assert absorption from
    // the IDENTITY RULE alone — only `ABSORBED_OBSERVATIONS_RECORDED` may, and only on evidence.
    const boundaryId = `tenant-${uid()}`;
    const sourceRef = `hmac-sha256:${createHash("sha256").update(boundaryId).digest("hex")}`;
    const service = new CaseAdmissionService(new InMemoryCaseCandidateStore(), () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };
    const same = obligationOf(boundaryId, sourceRef, 40_000, "one");

    const first = await service.submit("activation-deadline-v1", same, policy);
    const again = await service.submit("activation-deadline-v1", same, policy);
    if (!first.admitted || !again.admitted) throw new Error("both were expected to clear the gate");
    expect(again.created).toBe(false);

    const queueStore = new InMemoryCandidateReviewStore();
    queueStore.seed(first.candidate);
    const queue = await new CandidateReviewService(queueStore).list(actor("op", "operator", [boundaryId]), boundaryId);
    // POTENTIAL, never RECORDED — and `{ checked: false }` carries no count a reader could misread as a
    // confirmed absorption. A reassessment produces no false positive here.
    expect(queue[0]!.identityGrain.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(queue[0]!.identityGrain.absorbedObservations).toEqual({ checked: false });
  });
});

describe.skipIf(!HAS_DB)("grain safety · the disclosure reaches rows written before it existed", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });

  it("because it is DERIVED, not stored — no table holds it and none gained a column", async () => {
    const boundaryId = `tenant-${uid()}`;
    const operator = actor("op", "operator", [boundaryId]);
    const signal = obligationOf(boundaryId, `hmac-sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`, 10_000, randomUUID());
    const dedupeKey = caseCandidateDedupeKey(signal);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "activation-deadline-v1", signal, submittedAt: new Date() },
    });
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "test · governed review",
    });
    const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);

    // THE PERSISTED ROW IS THE "HISTORICAL" ONE. Nothing about the disclosure was written when it was
    // created: the grain is computed at read time from the contract's own identity rule, so every case
    // ever recorded carries it on inspection — no backfill, no migration, no mutable cache of an
    // immutable fact. A `grain` column would have been exactly the stored status this repository has
    // refused for admission decisions, analysis terms and execution events alike.
    const row = await prisma.recoveryCaseRecord.findFirst({ where: { boundaryId } });
    expect(row).not.toBeNull();
    expect(Object.keys(row!)).not.toContain("identityGrain");
    expect(Object.keys(row!)).not.toContain("grain");
    // A BigInt-safe stringify: the row carries a bigint column, and `JSON.stringify` throws on one.
    // Scanning the whole row rather than the key list is the stronger check — it would catch the grain
    // smuggled inside a jsonb payload as well as in a column of its own.
    const asText = JSON.stringify(row, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(asText).not.toContain("ACCOUNT_GRAINED");
    expect(asText).not.toContain("mayCoverMultipleObligations");

    // `approver`, NOT "auditor" — which is not a BackendRole at all (server/auth/identity.ts:11).
    // It typechecked only because tsconfig.server.json EXCLUDES server/**/*.test.ts, so no server test
    // is typechecked by anything: `tsc --listFiles` puts zero test files in the program. Reported in
    // the slice record, not fixed here — widening that include is outside this slice and would surface
    // pre-existing errors across the whole server suite.
    const view = await readRecoveryCase(
      actor("approver", "approver", [boundaryId]),
      promoted.recoveryCase.recoveryCaseId,
    );
    expect(view.identityGrain.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    // VERBATIM, not paraphrased. `leak_instance_identity_unavailable` is the STATUS token and does not
    // appear in this string — my first assertion looked for it and was simply wrong about which field
    // carries what. The stronger property is the one the design actually rests on: the disclosure quotes
    // the contract layer's own exported wording, which exists "so callers do not invent wording of their
    // own", so equality is the assertion rather than containment.
    expect(view.identityGrain.reason).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
    expect(view.identityGrain.reason).toContain("declares no obligation-level identifier");

    // AND NO RECOVERED-REVENUE CLAIM CAME WITH IT. An identified gap is not returned money.
    expect(view.provenRevenueReturnedMinor).toBeNull();
    expect(view.provenLedgerUnavailableReason).not.toBeNull();
  });
});

describe("grain safety · nothing else moved", () => {
  it("the dedupe key for a fixed signal still hashes to its pinned digest", async () => {
    // The strongest cheap control in the slice. If the disclosure had touched identity in any way — a new
    // component, a different order, a trimmed field — this digest would move, and every stored candidate
    // and case in every database would be re-identified. It is pinned as a literal so the assertion
    // cannot be satisfied by recomputing whatever the code now does.
    const signal = obligationOf("tenant-pinned", "hmac-sha256:pinned-account", 40_000, "pinned-seed");
    // A BARE HEX LITERAL, not a recomputation. Deriving the expected value by calling the same helper
    // the subject uses would make this test pass under any change at all. The preimage is recorded
    // beside it so a failure says WHICH part moved:
    //   framed = "13:tenant-pinned|16:ActivationMissed|26:hmac-sha256:pinned-account"
    // length-framed per component and pipe-joined — see `digest` in server/agents/caseAdmission.ts.
    // My first form of this test used plain JSON.stringify and failed, which is the framing earning
    // its place in the pin rather than being assumed.
    expect(caseCandidateDedupeKey(signal)).toBe(
      "0f62e1c3f7971e496e434c7636c3c6ee389513d50c3e8739bddbde4f845cb453",
    );
    // And the preimage is those three components and nothing more: a fourth would change the digest.
    expect(caseCandidateDedupeKey(signal)).toBe(caseCandidateDedupeKey({ ...signal, amountAtRiskMinor: 1 }));
    expect(caseCandidateDedupeKey(signal)).toBe(caseCandidateDedupeKey({ ...signal, sourcePayloadHash: "0".repeat(64) }));
    expect(caseCandidateDedupeKey(signal)).not.toBe(caseCandidateDedupeKey({ ...signal, sourceRef: "other" }));
  });

  it("the authority vocabulary is unchanged — no token was added, removed or substituted", () => {
    // The brief forbids substituting "Revise" for "Approve" without a separately approved design, and
    // `enforceSeparation` reads the "Approve" token to build its approver set: an actor who only ever
    // revised is in that set today, and a substitution would turn their 403 into a 201. Pinned as an
    // exact ordered list so an addition fails just as loudly as a removal.
    expect([...AUTHORITY_ACTIONS]).toEqual([
      "PromoteCandidate",
      "Author",
      "Intervene",
      "Approve",
      "Verify",
      "Flag",
      "Halt",
      "Exclude",
    ]);
  });

  it("the obligation-identity gate is still closed, and the disclosure did not open it", () => {
    // The disclosure DESCRIBES the limitation; it must not be mistaken for having fixed it. While the
    // field list is empty no build can reach the guaranteed state, which is what makes the refusal
    // structural rather than a policy someone could flip.
    expect(OBLIGATION_IDENTITY_FIELDS).toHaveLength(0);
    expect(
      refusesObligationLevelGuarantee({
        grain: "ACCOUNT_GRAINED_POTENTIAL",
        mayCoverMultipleObligations: true,
        obligationUniquenessGuaranteed: false,
        reason: "r",
        absorbedObservations: { checked: false },
        headline: "h",
      }).permitted,
    ).toBe(false);
  });
});
