// ONE SYNTHETIC OBLIGATION, END TO END, THROUGH THE REAL PATH · Issue #18 Priority 3.
//
// Every record these tests read was written by production code: the candidate by the real staging path,
// the review by `CandidateReviewService`, the root by `CandidatePromotionService.promote`, the baseline,
// intervention, evidence and proof by the real HTTP routes with the real separation-of-duties and
// source-verification gates in force. Nothing is INSERTed into `recovery_cases`, `proofs` or
// `baseline_snapshots` — a fixture that wrote those rows directly would let every assertion below pass
// against a case the product could never have produced.
//
// WHAT IS SIMULATED, STATED HERE RATHER THAN IMPLIED: the observation the detector reads, the Ed25519
// key that signs the settlement evidence, and every amount. That is the whole point of the trace these
// tests exercise — it reports those facts instead of letting a green test imply their absence.
//
// THE SIX FAILURE SCENARIOS ARE PRE-REGISTERED, in `docs/architecture/financial-trace-preregistration.json`,
// frozen at sha256 241a39f7… in a commit containing no implementation. The expected refusal codes are
// READ FROM THAT FILE, not transcribed here.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { APPROVER, AUTHOR, seedBaseline, seedEvidence, seedIntervention, uid } from "../test/fixtures";
import { CandidateReviewService } from "../agents/candidateReview";
import { CandidatePromotionService } from "../agents/recoveryCase";
import { PostgresCandidateReviewStore } from "../agents/postgresCandidateReviewStore";
import { caseCandidateDedupeKey, caseCandidateId } from "../agents/caseAdmission";
import { readFinancialTrace } from "./financialTraceRead";
import { HOLDER_INDEPENDENCE_FIELDS, TRACE_STAGE_ORDER } from "../../src/domain/financialTrace";
import { provenEligibility } from "../../src/domain/provenEligibility";
import type { SourceReceipt, SourceTrustKey } from "./sourceVerification";
import type { ActorContext } from "../auth/identity";

const HAS_DB = !!process.env.DATABASE_URL;

const PREREG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../docs/architecture/financial-trace-preregistration.json", import.meta.url)),
    "utf8",
  ),
) as {
  failureScenarios: readonly {
    id: string;
    expectedRefusalCode?: string;
    expectedStageStatus?: string;
    expectedCorrectionState?: string;
    expectedProofVerdict?: string;
  }[];
  globalProperties: readonly { id: string; expectedCode?: string }[];
};
const scenario = (id: string) => PREREG.failureScenarios.find((f) => f.id === id)!;

const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });

const hex = () => createHash("sha256").update(randomUUID()).digest("hex");
const pseudonym = () => `hmac-sha256:${hex()}`;

type Coverage =
  | {
      kind: "SINGLE_OBLIGATION";
      obligationRef: string;
      expectedMinor: number;
      billedMinor: number;
      residualMinor: number;
      currency: string;
    }
  | { kind: "ACCOUNT_AGGREGATE"; unitCount: number };

interface Seeded {
  readonly caseId: string;
  readonly candidateId: string;
  readonly boundaryId: string;
  readonly sourceRef: string;
  readonly obligationRef: string | null;
}

/**
 * Promote one case through the REAL governed path, with whatever coverage the scenario needs.
 *
 * `bypassAdmissionAssertion` exists for F5 only, and is named for what it is: `assertCandidateSignal`
 * re-derives `residualMinor` at the boundary and REFUSES an inconsistent triple, so an inconsistent row
 * cannot be created through the normal path at all. That is a defence this slice did not add and must
 * not report as absent — F5's subject is the GATE's fail-closed branch for a row written by an older
 * build or edited by hand, so the row is created directly and the test says so.
 */
async function seedCase(opts: {
  readonly coverage?: Coverage;
  readonly amountAtRiskMinor?: number;
  readonly recoveryType?: string;
}): Promise<Seeded> {
  const boundaryId = `TEST-trace-${uid()}`;
  const sourceRef = pseudonym();
  const recoveryType = opts.recoveryType ?? "RevenueUnderBilled";
  const signal = {
    signalId: `FIX-${hex().slice(0, 32)}`,
    boundaryId,
    recoveryType,
    sourceRef,
    sourcePayloadHash: hex(),
    detectorVersion: "trace-test-v1",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
    amountAtRiskMinor: opts.amountAtRiskMinor ?? 60_000,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    ...(opts.coverage ? { obligationCoverage: opts.coverage } : {}),
  };
  const dedupeKey = caseCandidateDedupeKey(signal as never);
  const candidateId = caseCandidateId(dedupeKey);
  await prisma.agentCaseCandidateRecord.create({
    data: { candidateId, dedupeKey, boundaryId, agentId: "trace-test-v1", signal, submittedAt: new Date() },
  });
  const operator = actor("ops@test", "operator", [boundaryId]);
  const store = new PostgresCandidateReviewStore();
  await new CandidateReviewService(store).decide(operator, {
    candidateId,
    boundaryId,
    decision: "accepted",
    reason: "test · governed review of a synthetic single-obligation claim",
  });
  const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
  return {
    caseId: promoted.recoveryCase.recoveryCaseId,
    candidateId,
    boundaryId,
    sourceRef,
    obligationRef: opts.coverage?.kind === "SINGLE_OBLIGATION" ? opts.coverage.obligationRef : null,
  };
}

/** One succeeded detection task plus its append-only event, exactly as the publisher writes them. */
async function recordObservation(
  seeded: Seeded,
  signals: readonly Record<string, unknown>[],
  metadata: Record<string, unknown>,
): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'trace-test-v1', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, seeded.boundaryId, randomUUID(), JSON.stringify(signals),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'trace-test-v1', 1, 1, 'task.succeeded', $4::jsonb, now())`,
    randomUUID(), taskId, seeded.boundaryId, JSON.stringify(metadata),
  );
}

const observation = (seeded: Seeded, amountAtRiskMinor: number) => ({
  recoveryType: "RevenueUnderBilled",
  sourceRef: seeded.sourceRef,
  amountAtRiskMinor,
  currency: "USD",
  ...(seeded.obligationRef
    ? { obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef: seeded.obligationRef } }
    : {}),
});

const singleObligation = (expectedMinor: number, billedMinor: number): Coverage => ({
  kind: "SINGLE_OBLIGATION",
  obligationRef: pseudonym(),
  expectedMinor,
  billedMinor,
  residualMinor: expectedMinor - billedMinor,
  currency: "USD",
});

describe.skipIf(!HAS_DB)("the financial trace · one obligation, end to end", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const approverIn = (b: string) => actor("cfo@test", "approver", [b]);

  /** The happy path: a single-obligation claim carried all the way to a frozen proof. */
  async function fullyProvenCase(): Promise<Seeded & { readonly proofId: string }> {
    const seeded = await seedCase({ coverage: singleObligation(160_000, 100_000), amountAtRiskMinor: 60_000 });
    // The detector's own statement, recorded as the publisher records it: one signal, candidate created.
    await recordObservation(seeded, [observation(seeded, 60_000)], { admittedCount: 1, createdCount: 1 });
    const { caseId } = seeded;
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })).statusCode).toBe(201);
    const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 10_000 });
    await seedIntervention(app, caseId);
    const { evidenceId, res } = await seedEvidence(app, caseId, { amountMinor: 70_000, currency: "USD" });
    expect(res.statusCode, res.body).toBe(201);
    const proofId = `SYNTHETIC-proof-${randomUUID()}`;
    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: {
        proofId, recoveryCaseId: caseId, currency: "USD", collectedMinor: 70_000,
        excludedRecoveryMinor: 0, exclusionStatement: "no exclusions asserted",
        recoveryReason: "BillingCorrection", attribution: "ar-system",
        evidenceIds: [evidenceId], baselineId, confidenceUsed: 95,
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().revenueReturned.minor).toBe(60_000);
    return { ...seeded, proofId };
  }

  // ── G6 · authorization, in the same order every provenance-bearing read uses ──────────────────────
  it("G6 · AuditRead first, then the root, then the boundary", async () => {
    const seeded = await seedCase({ coverage: singleObligation(160_000, 100_000) });
    const { boundaryId, caseId } = seeded;
    for (const role of ["operator", "author"] as const) {
      await expect(readFinancialTrace(actor(`${role}@test`, role, [boundaryId]), caseId)).rejects.toThrow(
        /forbidden|not permitted|AuditRead/i,
      );
    }
    // An unauthorized actor must not learn whether an id is real: the SAME refusal for a case that does
    // not exist at all, so the route cannot be used to probe.
    await expect(
      readFinancialTrace(actor("op@test", "operator", [boundaryId]), `RC-does-not-exist-${uid()}`),
    ).rejects.toThrow(/forbidden|not permitted|AuditRead/i);
    await expect(
      readFinancialTrace(approverIn(boundaryId), `RC-does-not-exist-${uid()}`),
    ).rejects.toThrow(/no authoritative root/);
    // Another tenant's approver is refused on the ROOT'S OWN boundary, which no parameter can name.
    await expect(readFinancialTrace(approverIn(`TEST-other-${uid()}`), caseId)).rejects.toThrow(
      /boundary|forbidden/i,
    );
    const view = await readFinancialTrace(approverIn(boundaryId), caseId);
    expect(view.trace.recoveryCaseId).toBe(caseId);
  });

  // ── The whole arc, on a case that really did reach a frozen proof ─────────────────────────────────
  it("traces all ten stages, and every stage names the record its facts came from", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    expect(view.trace.stages.map((s) => s.stage)).toEqual([...TRACE_STAGE_ORDER]);
    for (const stage of view.trace.stages) {
      expect(stage.recordSource.length).toBeGreaterThan(3);
      expect(stage.note.length).toBeGreaterThan(20);
    }
    const byName = new Map(view.trace.stages.map((s) => [s.stage, s]));
    expect(byName.get("SOURCE_OBLIGATION")!.status).toBe("ESTABLISHED");
    expect(byName.get("DETECTION")!.status).toBe("ESTABLISHED");
    expect(byName.get("CANDIDATE")!.recordIds).toEqual([seeded.candidateId]);
    expect(byName.get("REVIEW")!.status).toBe("ESTABLISHED");
    expect(byName.get("RECOVERY_CASE")!.recordIds).toEqual([seeded.caseId]);
    expect(byName.get("BASELINE")!.status).toBe("ESTABLISHED");
    expect(byName.get("CORRECTION_RECORD")!.status).toBe("ESTABLISHED");
    expect(byName.get("PROOF")!.status).toBe("ESTABLISHED");
    expect(byName.get("PROOF")!.recordIds).toEqual([seeded.proofId]);
  });

  it("separates simulated from executed, and reaches ATTESTED nowhere", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const classes = view.trace.stages.map((s) => `${s.stage}:${s.executionClass}/${s.inputClass}`);
    // Nine stages are real production code over inputs NH itself produced. One is not implemented at all.
    expect(classes.filter((c) => c.includes("EXECUTED/"))).toHaveLength(9);
    expect(view.trace.stages.filter((s) => s.executionClass === "NOT_IMPLEMENTED").map((s) => s.stage))
      .toEqual(["PROPOSED_CORRECTION"]);
    expect(view.trace.stages.some((s) => s.inputClass === "ATTESTED")).toBe(false);
    expect(view.trace.stages.some((s) => s.inputClass === "OBSERVED")).toBe(false);
  });

  // ── G1 · the headline the owner's requirement 5 asks for ─────────────────────────────────────────
  it("G1 · a frozen, internally valid proof still does NOT establish Revenue Returned", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);

    // The proof chain really did compute 70,000 − 10,000 = 60,000, and that figure is carried for audit.
    expect(view.trace.revenueReturned.proofChainFigure?.minor).toBe(60_000);
    expect(view.trace.revenueReturned.fromProofIds).toEqual([seeded.proofId]);

    // And Revenue Returned is WITHHELD, with the build-level reason first.
    expect(view.trace.revenueReturned.established).toBe(false);
    expect(view.trace.revenueReturned.codes[0]).toBe(
      PREREG.globalProperties.find((p) => p.id === "G1")!.expectedCode,
    );
    expect(view.trace.attestation.independentlyAttested).toBe(false);
    expect(view.trace.attestation.code).toBe("INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD");
    // TWO signed records now: G1 made the Fix leg evidential, so the case carries the billing source's
    // signed correction attestation alongside the signed settlement. The SUBJECT is untouched — neither
    // signature establishes independence, because neither receipt carries a key holder.
    expect(view.trace.attestation.verifiedSignatureCount).toBe(2);
    expect(view.trace.attestation.holderFieldsPresent).toEqual([]);
  });

  it("G1 · the verdict is derived from the receipt's SHAPE — the stored receipt carries no holder", async () => {
    const seeded = await fullyProvenCase();
    const rows = await prisma.evidenceRecord.findMany({
      where: { recoveryCaseId: seeded.caseId }, select: { sourceVerification: true },
    });
    // Both signed records are inspected, not just the settlement: the claim is about the receipt SHAPE,
    // so every stored receipt must be shown to carry no holder, not merely the one that carries money.
    expect(rows).toHaveLength(2);
    // EVERY stored receipt, not just the first. The comment above says every one carries no holder, and a
    // check that reads `rows[0]` would be claiming more than it tested.
    for (const row of rows) {
      const receipt = row.sourceVerification as Record<string, unknown>;
      // A signature really was verified — this is not a case of there being no attestation attempt.
      expect(receipt.method).toBe("ed25519-v1");
      expect(typeof receipt.signature).toBe("string");
      // And not one field could say whose key it was.
      for (const f of HOLDER_INDEPENDENCE_FIELDS) expect(Object.keys(receipt)).not.toContain(f);
    }

    // THE SAME FACT AT THE TYPE LEVEL, so adding a holder field to the type cannot be forgotten here:
    // these assignments stop compiling the day either type gains one of the declared fields.
    const receiptHasNoHolder: Record<string, never> = {} as Pick<
      SourceReceipt,
      Extract<keyof SourceReceipt, (typeof HOLDER_INDEPENDENCE_FIELDS)[number]>
    >;
    const registryHasNoHolder: Record<string, never> = {} as Pick<
      SourceTrustKey,
      Extract<keyof SourceTrustKey, (typeof HOLDER_INDEPENDENCE_FIELDS)[number]>
    >;
    expect(Object.keys(receiptHasNoHolder)).toEqual([]);
    expect(Object.keys(registryHasNoHolder)).toEqual([]);
  });

  // ── G4 · reproducible ────────────────────────────────────────────────────────────────────────────
  it("G4 · the same records yield the same digest, twice, and the canonical form re-derives it", async () => {
    const seeded = await fullyProvenCase();
    const a = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const b = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    expect(a.traceDigest).toBe(b.traceDigest);
    expect(a.canonical).toBe(b.canonical);
    expect(a.traceDigest).toMatch(/^[a-f0-9]{64}$/);
    const recomputed = createHash("sha256").update(a.canonical).digest("hex");
    expect(recomputed).toBe(a.traceDigest);
    // No clock value reached the preimage, so the digest is a function of the records and not the run.
    for (const clock of [new Date().getFullYear().toString().slice(0, 2) + "26-", "verifiedAt", "ingestedAt"]) {
      expect(a.canonical).not.toContain(clock);
    }
  });

  // ── G5 · redaction ───────────────────────────────────────────────────────────────────────────────
  it("G5 · no raw pseudonymous reference reaches the trace", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(seeded.sourceRef);
    expect(serialized).not.toContain(seeded.obligationRef!);
    expect(serialized).not.toContain("hmac-sha256:");
    expect(view.correctionIdentityDigest).toMatch(/^[a-f0-9]{24}$/);
  });

  // ── The six pre-registered failure scenarios ─────────────────────────────────────────────────────
  it("F1 · a negative residual is refused as exposure, and its figures are preserved", async () => {
    const f1 = scenario("F1");
    // THE HAZARD IS REAL AND WAS NOT KNOWN BEFORE THIS TEST: `assertCandidateSignal` requires a
    // non-negative `amountAtRiskMinor` and requires `residualMinor` to equal expected − billed, but
    // NOTHING requires the two statements to agree, and nothing refuses a negative residual. So this
    // row goes through the ordinary path: a positive at-risk figure beside coverage saying the company
    // over-billed by the same amount.
    const seeded = await seedCase({
      coverage: singleObligation(100_000, 160_000),
      amountAtRiskMinor: 60_000,
    });
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const stage = view.trace.stages.find((s) => s.stage === "SOURCE_OBLIGATION")!;
    expect(stage.status).toBe(f1.expectedStageStatus);
    expect(stage.refusalCode).toBe(f1.expectedRefusalCode);
    // The three source figures survive — what the source stated is a fact.
    expect(stage.figures.map((f) => f.minor)).toEqual([100_000, 160_000, -60_000]);
    expect(stage.figures.every((f) => f.ledger === "SOURCE_STATED")).toBe(true);
    // And NO exposure is reported, although the promotion row carries a positive at-risk amount.
    expect(view.trace.observedExposure).toBeNull();
    const caseStage = view.trace.stages.find((s) => s.stage === "RECOVERY_CASE")!;
    expect(caseStage.figures[0]!.minor).toBeNull();
    expect(caseStage.figures[0]!.ledger).toBe("OBSERVED_EXPOSURE");
  });

  it("F2 · a replay is not a correction, and the two observations are never summed", async () => {
    const f2 = scenario("F2");
    const seeded = await seedCase({ coverage: singleObligation(160_000, 100_000), amountAtRiskMinor: 60_000 });
    await recordObservation(seeded, [observation(seeded, 60_000)], { admittedCount: 1, createdCount: 1 });
    await recordObservation(seeded, [observation(seeded, 60_000)], { admittedCount: 1, createdCount: 0 });
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const stage = view.trace.stages.find((s) => s.stage === "CORRECTION_RECORD")!;
    expect(stage.note).toContain(f2.expectedCorrectionState!);
    expect(stage.status).toBe("ESTABLISHED");
    expect(stage.refusalCode).toBeNull();
    // Both statements are listed, and 120,000 — their sum — appears nowhere.
    const observed = stage.figures.filter((f) => f.label.startsWith("observation"));
    expect(observed.map((f) => f.minor)).toEqual([60_000, 60_000]);
    expect(JSON.stringify(view)).not.toContain("120000");
    // Exposure is counted ONCE: the one figure the promotion row froze.
    expect(view.trace.observedExposure!.minor).toBe(60_000);
    const exposures = view.trace.stages.flatMap((s) => s.figures).filter((f) => f.ledger === "OBSERVED_EXPOSURE");
    expect(exposures).toHaveLength(1);
    // The replay WAS recorded as absorbed, so the identity gate refuses a proof for it — reported, and
    // a different fact from the correction state above.
    expect(view.trace.stages.find((s) => s.stage === "PROOF")!.refusalCode).toBe(
      "OBLIGATION_IDENTITY_GATE_REFUSED",
    );
  });

  it("F3 · an account aggregate may not be proven", async () => {
    const f3 = scenario("F3");
    const seeded = await seedCase({ coverage: { kind: "ACCOUNT_AGGREGATE", unitCount: 4 } });
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const proof = view.trace.stages.find((s) => s.stage === "PROOF")!;
    expect(proof.status).toBe("REFUSED");
    expect(proof.note).toContain(f3.expectedRefusalCode!);
    expect(view.trace.revenueReturned.codes).toContain("OBLIGATION_IDENTITY_GATE_REFUSED");
    // The coverage IS stated; what it states is an aggregate. Those are different findings.
    const source = view.trace.stages.find((s) => s.stage === "SOURCE_OBLIGATION")!;
    expect(source.status).toBe("ESTABLISHED");
    expect(source.note).toContain("4 reconciliation units");
  });

  // ── F4 and F5 · THE PRE-REGISTERED OUTCOME DID NOT HAPPEN, AND THE REASON IS STRONGER ───────────
  //
  // I pre-registered both as "the obligation-identity gate refuses the case". Measured, neither
  // scenario can be constructed against a promoted case AT ALL on this build, so the gate's branch is
  // never reached — not because it is weak, but because THREE independent defences sit in front of it.
  // The deviation is reported here rather than the pre-registration being rewritten to match.
  it("F4/F5 · a malformed coverage row cannot reach a Recovery Case: three defences, measured", async () => {
    const f4 = scenario("F4");
    const f5 = scenario("F5");

    // DEFENCE 1 · the boundary assertion refuses to CREATE one, for either defect.
    await expect(
      seedCase({
        coverage: {
          kind: "SINGLE_OBLIGATION", obligationRef: pseudonym(),
          expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 99_999, currency: "USD",
        },
      }),
    ).rejects.toThrow(/residualMinor must equal/);
    await expect(
      seedCase({
        coverage: {
          kind: "SINGLE_OBLIGATION", obligationRef: "   ",
          expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 60_000, currency: "USD",
        },
      }),
    ).rejects.toThrow(/obligationRef must be an hmac-sha256 pseudonym/);

    // DEFENCE 2 · a row inserted directly — the shape an older build could have left behind, and the
    // database itself imposes no schema on the signal json — cannot be PROMOTED, because the promotion
    // path re-asserts the signal when it reads the candidate.
    //
    // MEASURED, NOT ASSUMED, AND MY FIRST GUESS WAS WRONG: I expected the refusal at review. The review
    // is ACCEPTED and the refusal lands at promotion. That ordering is reported as an observation — an
    // operator can accept a candidate that can never become a case, and learns so only at promotion —
    // and it is not patched here, because changing where a governed refusal fires is not this slice's.
    const boundaryId = `TEST-trace-${uid()}`;
    const dedupeKey = hex();
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: {
        candidateId, dedupeKey, boundaryId, agentId: "trace-test-v1", submittedAt: new Date(),
        signal: {
          signalId: `FIX-${hex().slice(0, 32)}`, boundaryId, recoveryType: "RevenueUnderBilled",
          sourceRef: pseudonym(), sourcePayloadHash: hex(), detectorVersion: "trace-test-v1",
          observedAt: new Date().toISOString(), amountAtRiskMinor: 60_000, currency: "USD",
          actionAvailable: true, expectedProofEvent: "corrective invoice raised and collected",
          obligationCoverage: {
            kind: "SINGLE_OBLIGATION", obligationRef: "   ",
            expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 99_999, currency: "USD",
          },
        },
      },
    });
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "test · accepted, and still not promotable",
    });
    await expect(
      new CandidatePromotionService(store).promote(operator, candidateId, boundaryId),
    ).rejects.toThrow(/obligationRef must be an hmac-sha256 pseudonym/);
    // So no root exists, and the trace surface fails closed on the id rather than tracing a case.
    expect(await prisma.recoveryCaseRecord.count({ where: { sourceCandidateId: candidateId } })).toBe(0);
    await expect(
      readFinancialTrace(approverIn(boundaryId), `RC-${candidateId}`),
    ).rejects.toThrow(/no authoritative root/);

    // DEFENCE 3 · a VALID candidate cannot be corrupted afterwards: the table is append-only by trigger.
    const valid = await seedCase({ coverage: singleObligation(160_000, 100_000) });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE agent_case_candidates SET signal = '{}'::jsonb WHERE candidate_id = $1`,
        valid.candidateId,
      ),
    ).rejects.toThrow(/append-only/);

    // AND THE GATE'S OWN BRANCHES ARE STILL EXERCISED, purely, on the predicate the gate delegates to —
    // so "unreachable from the database" is not reported as "untested".
    expect(
      provenEligibility({
        coverage: {
          kind: "SINGLE_OBLIGATION", obligationRef: "   ",
          expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 60_000, currency: "USD",
        },
        absorbedObservations: { checked: true, count: 0 },
      }),
    ).toMatchObject({ eligible: false, code: f4.expectedRefusalCode });
    expect(
      provenEligibility({
        coverage: {
          kind: "SINGLE_OBLIGATION", obligationRef: pseudonym(),
          expectedMinor: 160_000, billedMinor: 100_000, residualMinor: 99_999, currency: "USD",
        },
        absorbedObservations: { checked: true, count: 0 },
      }),
    ).toMatchObject({ eligible: false, code: f5.expectedRefusalCode });
  });

  it("F6 · five ledgers, and every figure traces to one record value", async () => {
    const seeded = await fullyProvenCase();
    // Add a genuine undecided correction so all five ledgers carry a figure at once.
    await recordObservation(seeded, [observation(seeded, 80_000)], { admittedCount: 1, createdCount: 0 });
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const ledgers = new Set(view.trace.stages.flatMap((s) => s.figures).map((f) => f.ledger));
    expect([...ledgers].sort()).toEqual([
      "BASELINE", "OBSERVED_EXPOSURE", "PROVEN_REVENUE_RETURNED", "SOURCE_STATED",
      "UNDECIDED_CORRECTION_MAGNITUDE",
    ]);
    const correction = view.trace.stages.find((s) => s.stage === "CORRECTION_RECORD")!;
    expect(correction.refusalCode).toBe("CORRECTION_PRECEDENCE_UNDECIDED");
    expect(correction.figures.find((f) => f.ledger === "UNDECIDED_CORRECTION_MAGNITUDE")!.minor).toBe(20_000);

    // THE POSITIVE PROPERTY, because it is the one that cannot be defeated by arithmetic coincidence:
    // every figure the trace reports is a value that EXISTS IN A RECORD, or is the one documented
    // derivation (the undecided magnitude, which `candidateCorrections` derives). A summed figure would
    // appear here as a value no record holds.
    const recordValues = new Set<number>([
      160_000, // coverage.expectedMinor
      100_000, // coverage.billedMinor
      60_000,  // coverage.residualMinor, recovery_cases.amount_at_risk_minor, proofs.revenue_returned
      10_000,  // baseline_snapshots.calculated_minor
      70_000,  // evidence_records.amount_minor and proofs.collected
      80_000,  // the second observation's amountAtRiskMinor
      20_000,  // DERIVED: 80,000 − 60,000, the undecided magnitude
    ]);
    for (const f of view.trace.stages.flatMap((s) => s.figures)) {
      if (f.minor === null) continue;
      expect(recordValues, `figure "${f.label}" reports ${f.minor}, which no record holds`)
        .toContain(f.minor);
    }

    // And the narrow negative, limited to cross-ledger sums that do NOT collide with a real figure.
    // THE LIMIT IS STATED RATHER THAN HIDDEN: exposure+baseline, baseline+proof, exposure+undecided and
    // proof+undecided all land on 70,000 or 80,000, which are genuine values here, so a string search
    // cannot distinguish a sum from a record. That is exactly why the positive property above is the
    // load-bearing one, and why the ledger tags are enforced in the pure core rather than by a scan.
    const serialized = JSON.stringify(view);
    for (const sum of [120_000, 130_000, 150_000, 30_000]) {
      expect(serialized, `a cross-ledger sum ${sum} appears in the payload`).not.toContain(String(sum));
    }
  });

  it("the proposed-correction stage reports a mechanism that does not exist", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    const stage = view.trace.stages.find((s) => s.stage === "PROPOSED_CORRECTION")!;
    expect(stage.executionClass).toBe("NOT_IMPLEMENTED");
    expect(stage.refusalCode).toBe("BILLING_CORRECTION_NOT_IMPLEMENTED");
    expect(stage.figures).toEqual([]);
    expect(stage.note).toContain("raised no charge");
    // Even though the proof's own RecoveryReason is BillingCorrection — a label, not an execution.
    const proofs = await prisma.proof.findMany({
      where: { recoveryCaseId: seeded.caseId }, select: { recoveryReason: true },
    });
    expect(proofs[0]!.recoveryReason).toBe("BillingCorrection");
  });

  it("carries the synthetic disclosure, and claims no collected money anywhere", async () => {
    const seeded = await fullyProvenCase();
    const view = await readFinancialTrace(approverIn(seeded.boundaryId), seeded.caseId);
    expect(view.trace.syntheticDisclosure).toContain("No billing system was contacted");
    expect(view.trace.syntheticDisclosure).toContain("was collected");
    expect(view.trace.observedExposureLabel).toContain("never summed into Revenue Returned");
  });
});
