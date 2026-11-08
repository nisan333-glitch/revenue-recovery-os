// THE GOVERNED READ SURFACE for the correction ledger · authorization, isolation, redaction, refusal.
//
// The module under test exists because `candidateCorrections.ts` had NO consumer. These tests are about
// what the consumer is allowed to say and to whom — not about the derivation, which is covered purely.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import type { ActorContext } from "../auth/identity";

/** The same shape the governed-read tests use: a frozen ActorContext, built here rather than mocked. */
const actor = (actorId: string, role: ActorContext["role"], boundaryIds: readonly string[]): ActorContext =>
  Object.freeze({ actorId, role, boundaryIds: Object.freeze([...boundaryIds]) });
import { identityDigest, readCandidateCorrections } from "./candidateCorrectionsRead";

const HAS_DB = !!process.env.DATABASE_URL;

/** An event + task pair, written through the same append-only tables production writes. */
async function recordObservation(
  boundaryId: string,
  sequenceTasks: readonly { readonly signals: readonly Record<string, unknown>[] }[],
): Promise<void> {
  for (const { signals } of sequenceTasks) {
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1, $2, 'corr-read-test', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
      taskId, boundaryId, randomUUID(), JSON.stringify(signals),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1, $2, $3, 'corr-read-test', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), taskId, boundaryId,
    );
  }
}

const obligationSignal = (amountAtRiskMinor: number, obligationRef: string) => ({
  recoveryType: "RevenueUnderBilled",
  sourceRef: `hmac-sha256:${"a".repeat(64)}`,
  amountAtRiskMinor,
  currency: "USD",
  obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef },
});

const OBL = `hmac-sha256:${"1".repeat(64)}`;

describe.skipIf(!HAS_DB)("GET /candidate-corrections · the governed correction read", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  const boundary = `SYNTHETIC-corrread-${randomUUID()}`;
  beforeAll(async () => {
    await app.ready();
    // An upward correction: 600.00 then 800.00 on ONE obligation, two events.
    await recordObservation(boundary, [
      { signals: [obligationSignal(60_000, OBL)] },
      { signals: [obligationSignal(80_000, OBL)] },
    ]);
  }, 60_000);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const read = (role: string, b = boundary) =>
    readCandidateCorrections(actor(`${role}@test`, role as ActorContext["role"], [b]), b);

  // ── S-DUP-4 · PRECEDENCE FROM AUTHORITATIVE BILLING EVIDENCE, on the real path ───────────────────
  //
  // THE SHAPE OF THE DEFECT, so the assertions below are readable. Two observations of ONE obligation
  // carry 600.00 then 800.00. "First observation wins" answers 600.00 — and the only ordering the data
  // holds is the append sequence, which is arrival order. The corrective charge the billing system
  // actually raised is the evidence that decides, and here it was raised for 800.00.
  async function seedCorroboratedIdentity(opts: {
    readonly charges: readonly number[];
    readonly payments: readonly number[];
  }): Promise<{ readonly boundaryId: string }> {
    const boundaryId = `SYNTHETIC-corrread-sdup4-${randomUUID()}`;
    const sourceRef = `hmac-sha256:${"a".repeat(64)}`;
    await recordObservation(boundaryId, [
      { signals: [obligationSignal(60_000, OBL)] },
      { signals: [obligationSignal(80_000, OBL)] },
    ]);
    // THROUGH THE REAL PROMOTION PATH, because a shortcut was REFUSED by the database: inserting the
    // root directly raised `RecoveryCase requires an accepted candidate review` (23514). That control is
    // doing its job, and going through review and promotion is the more faithful fixture anyway.
    const { CandidateReviewService } = await import("../agents/candidateReview");
    const { CandidatePromotionService } = await import("../agents/recoveryCase");
    const { PostgresCandidateReviewStore } = await import("../agents/postgresCandidateReviewStore");
    const { caseCandidateDedupeKey, caseCandidateId } = await import("../agents/caseAdmission");
    const signal = {
      signalId: `FIX-sdup4${randomUUID().replace(/-/g, "").slice(0, 8)}`,
      boundaryId,
      recoveryType: "RevenueUnderBilled",
      sourceRef,
      sourcePayloadHash: "b".repeat(64),
      detectorVersion: "corr-read-test",
      observedAt: new Date(Date.now() - 86_400_000).toISOString(),
      amountAtRiskMinor: 80_000,
      currency: "USD",
      actionAvailable: true,
      expectedProofEvent: "corrective invoice raised and collected",
      obligationCoverage: {
        kind: "SINGLE_OBLIGATION", obligationRef: OBL,
        expectedMinor: 180_000, billedMinor: 100_000, residualMinor: 80_000, currency: "USD",
      },
    };
    const dedupeKey = caseCandidateDedupeKey(signal as never);
    const candidateId = caseCandidateId(dedupeKey);
    await prisma.agentCaseCandidateRecord.create({
      data: { candidateId, dedupeKey, boundaryId, agentId: "corr-read-test", signal, submittedAt: new Date() },
    });
    const operator = actor("ops@test", "operator", [boundaryId]);
    const store = new PostgresCandidateReviewStore();
    await new CandidateReviewService(store).decide(operator, {
      candidateId, boundaryId, decision: "accepted", reason: "test · S-DUP-4 corroboration fixture",
    });
    const promoted = await new CandidatePromotionService(store).promote(operator, candidateId, boundaryId);
    const caseId = promoted.recoveryCase.recoveryCaseId;
    const { attestFixture } = await import("../test/sourceFixture");
    const ingest = async (evidenceType: string, amountMinor: number, n: number) => {
      const res = await app.inject({
        method: "POST", url: `/cases/${caseId}/evidence`,
        headers: { "x-actor-id": "dana@company", "x-actor-role": "author" },
        payload: {
          ...attestFixture(caseId, {
            evidenceId: `EV-sdup4-${n}-${randomUUID()}`,
            sourceSystem: "billing",
            sourceRecordId: `SDUP4-${n}-${randomUUID()}`,
            evidenceType,
            observedAt: "2026-07-20T00:00:00.000Z",
            amountMinor,
            currency: "USD",
          }),
        },
      });
      if (res.statusCode !== 201) throw new Error(`seed evidence failed: ${res.statusCode} ${res.body}`);
    };
    let n = 0;
    for (const c of opts.charges) await ingest("corrective_invoice_issued", c, n++);
    for (const p of opts.payments) await ingest("invoice_paid", p, n++);
    return { boundaryId };
  }

  const sdup4 = async (b: string) => {
    const view = await readCandidateCorrections(actor("cfo@test", "approver", [b]), b);
    expect(view.result.outcome).toBe("REPORTED");
    expect(view.records).toHaveLength(1);
    return view.records[0]!.precedence;
  };

  it("S-DUP-4 · the corrective charge decides, NOT the first observation", async () => {
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [80_000], payments: [80_000] });
    const p = await sdup4(boundaryId);
    expect(p.resolved).toBe(true);
    if (!p.resolved) return;
    // THE WHOLE POINT: first-wins would answer 60_000 here.
    expect(p.authoritativeMinor).toBe(80_000);
    expect(p.authoritativeMinor).not.toBe(60_000);
    expect(p.billedMinor).toBe(80_000);
    expect(p.collectedMinor).toBe(80_000);
    expect(p.settlement).toBe("FULLY_SETTLED");
    expect(p.outstandingMinor).toBe(0);
  }, 90_000);

  it("S-DUP-4 · a verified PARTIAL payment series is summed, and does not reduce what was owed", async () => {
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [80_000], payments: [30_000, 20_000] });
    const p = await sdup4(boundaryId);
    expect(p.resolved).toBe(true);
    if (!p.resolved) return;
    expect(p.collectedMinor).toBe(50_000);
    expect(p.settlement).toBe("PARTIALLY_SETTLED");
    // The authoritative figure is what was CHARGED. Subtracting the payment would under-report it.
    expect(p.authoritativeMinor).toBe(80_000);
    expect(p.outstandingMinor).toBe(30_000);
  }, 90_000);

  it("S-DUP-4 · two corrective charges FAIL CLOSED rather than being summed", async () => {
    // Two charges may be two additive charges or one re-issued. 40_000 + 40_000 = 80_000 would match an
    // observation and look convincing — which is exactly why it is refused.
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [40_000, 40_000], payments: [] });
    const p = await sdup4(boundaryId);
    expect(p.resolved).toBe(false);
    expect(!p.resolved && p.code).toBe("BILLED_AMOUNT_AMBIGUOUS");
  }, 90_000);

  it("S-DUP-4 · collecting more than was charged is CONTRADICTORY, and nothing is made authoritative", async () => {
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [80_000], payments: [80_001] });
    const p = await sdup4(boundaryId);
    expect(!p.resolved && p.code).toBe("BILLING_EVIDENCE_CONTRADICTORY");
  }, 90_000);

  it("S-DUP-4 · no corrective charge at all leaves it unresolved, never a zero", async () => {
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [], payments: [80_000] });
    const p = await sdup4(boundaryId);
    expect(!p.resolved && p.code).toBe("NO_AUTHORITATIVE_BILLING_EVIDENCE");
  }, 90_000);

  it("S-DUP-4 · a charge matching NEITHER observation corroborates nothing", async () => {
    const { boundaryId } = await seedCorroboratedIdentity({ charges: [70_000], payments: [] });
    const p = await sdup4(boundaryId);
    expect(!p.resolved && p.code).toBe("NO_OBSERVATION_MATCHES_BILLED");
  }, 90_000);

  it("S-DUP-4 · the identity-only boundary, with no case, reports no authoritative amount", async () => {
    // The default fixture has the two conflicting observations and NO Recovery Case, so there is nothing
    // to corroborate against. An absence, reported as one.
    const p = (await readCandidateCorrections(actor("cfo@test", "approver", [boundary]), boundary))
      .records[0]!.precedence;
    expect(!p.resolved && p.code).toBe("NO_AUTHORITATIVE_BILLING_EVIDENCE");
  }, 60_000);

  // ── AUTHORIZATION ─────────────────────────────────────────────────────────────────────────────────
  it("approver, verifier and steward may read it", async () => {
    for (const role of ["approver", "verifier", "steward"] as const) {
      const view = await read(role);
      expect(view.result.outcome, role).toBe("REPORTED");
      expect(view.totals.withCorrections, role).toBe(1);
    }
  });

  it("the AUTHOR and the OPERATOR may NOT — the beneficiary does not read the ledger that names the amount", async () => {
    for (const role of ["author", "operator"] as const) {
      await expect(read(role), role).rejects.toThrow(/may not perform 'AuditRead'/);
    }
  });

  it("authorization comes BEFORE existence, so an unauthorized actor learns nothing about which boundaries exist", async () => {
    // A boundary that holds nothing. An operator must get the SAME refusal as for a real one, so the
    // response cannot be used to probe.
    const empty = `SYNTHETIC-corrread-empty-${randomUUID()}`;
    await expect(
      readCandidateCorrections(actor("op@test", "operator", [empty]), empty),
    ).rejects.toThrow(/may not perform 'AuditRead'/);
  });

  // ── BOUNDARY ISOLATION ────────────────────────────────────────────────────────────────────────────
  it("an actor scoped to another boundary is refused, and the query is scoped so none could leak anyway", async () => {
    const other = `SYNTHETIC-corrread-other-${randomUUID()}`;
    await expect(
      readCandidateCorrections(actor("cfo@test", "approver", [other]), boundary),
    ).rejects.toThrow();
    // And a reader of an empty boundary sees an empty report rather than this one's.
    const view = await readCandidateCorrections(actor("cfo@test", "approver", [other]), other);
    expect(view.records).toEqual([]);
    expect(view.totals.identities).toBe(0);
  });

  it("a blank boundary is refused rather than treated as 'all boundaries'", async () => {
    await expect(
      readCandidateCorrections(actor("cfo@test", "approver", [""]), "   "),
    ).rejects.toThrow(/boundaryId is required/);
  });

  // ── REDACTION · THE F1 ATTACK ─────────────────────────────────────────────────────────────────────
  it("NO identifier leaves, even when a crafted row carries RAW customer values", async () => {
    // Measured before this surface existed: the derivation accepts anything as a reference and passes
    // it through. `assertCandidateSignal` refuses these at ingress so no detector can produce them —
    // but this surface must not rely on an upstream guard to decide what it emits.
    const hostile = `SYNTHETIC-corrread-raw-${randomUUID()}`;
    const RAW_ACCOUNT = "ENT-REAL-CUSTOMER-7781";
    const RAW_OBLIGATION = "ACME Corp invoice 9912";
    await recordObservation(hostile, [
      { signals: [{
        recoveryType: "RevenueUnderBilled", sourceRef: RAW_ACCOUNT,
        amountAtRiskMinor: 60_000, currency: "USD",
        obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef: RAW_OBLIGATION },
      }] },
      { signals: [{
        recoveryType: "RevenueUnderBilled", sourceRef: RAW_ACCOUNT,
        amountAtRiskMinor: 80_000, currency: "USD",
        obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef: RAW_OBLIGATION },
      }] },
    ]);
    const view = await readCandidateCorrections(actor("cfo@test", "approver", [hostile]), hostile);
    // The correction IS reported — redaction must not cost the finding.
    expect(view.totals.withCorrections).toBe(1);
    expect(view.records[0]!.direction).toBe("UPWARD");
    // And neither raw value appears anywhere in the response.
    const body = JSON.stringify(view);
    expect(body).not.toContain(RAW_ACCOUNT);
    expect(body).not.toContain(RAW_OBLIGATION);
    expect(body).not.toContain("ACME");
    // Nor do the fields that would carry them exist at all.
    const keys = Object.keys(view.records[0]!);
    expect(keys).not.toContain("sourceRef");
    expect(keys).not.toContain("obligationRef");
    expect(keys).not.toContain("identity");
    // What IS emitted is a digest, and it is stable for the same identity.
    expect(view.records[0]!.identityDigest).toMatch(/^[a-f0-9]{24}$/);
    const again = await readCandidateCorrections(actor("cfo@test", "approver", [hostile]), hostile);
    expect(again.records[0]!.identityDigest).toBe(view.records[0]!.identityDigest);
  }, 60_000);

  it("the digest is length-framed, so two identities cannot frame to one value", () => {
    // `a|b` and `a` + `|b` would collide under naive concatenation. Framing is why they do not — the
    // same reason `caseCandidateDedupeKey` frames its components.
    expect(identityDigest("a|b")).not.toBe(identityDigest("a||b"));
    expect(identityDigest("ab")).not.toBe(identityDigest("a") + identityDigest("b"));
    expect(identityDigest("x")).toBe(identityDigest("x"));
  });

  // ── NO AUTHORITATIVE FIGURE ───────────────────────────────────────────────────────────────────────
  it("the response names no corrected, effective or resolved amount, and no net", async () => {
    const view = await read("approver");
    const r = view.records[0]!;
    for (const forbidden of ["correctedMinor", "authoritativeMinor", "effectiveMinor", "resolvedMinor"]) {
      expect(Object.keys(r), forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(view.totals)).not.toContain("netMinor");
    // The two directions stay separate, and the surface SAYS precedence is unapproved rather than
    // leaving a reader to infer it.
    expect(view.totals.upwardUndecidedMinor).toBe(20_000);
    expect(view.totals.downwardUndecidedMinor).toBe(0);
    expect(view.claimBoundary.precedenceApproved).toBe(false);
    expect(view.claimBoundary.constitutesRevenue).toBe(false);
    expect(view.precedenceNotice).toContain("NOT decided here");
  });

  it("structurally: this module picks no winner on its own authority", () => {
    // WHAT THIS GUARD WAS, AND WHAT IT IS NOW. It asserted that no authoritative-amount field existed at
    // all, which was right while no approved requirement said which statement of an amount wins. S-DUP-4
    // now states one, so the field exists — and the guard's real subject SURVIVES and is stronger: the
    // figure must come from a governed predicate fed by source-attested evidence, never from a rule
    // chosen in this file. Simply deleting the guard would have thrown away the property it protects.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "candidateCorrectionsRead.ts"), "utf8",
    ) as string;
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // No selection rule of any kind is implemented here: no sort, no ordering, no max/min over amounts.
    // `latestObservedMinor` is deliberately NOT on this list, and my first form of the check wrongly put
    // it there. REPORTING the latest observed amount is not CHOOSING an authoritative one — it is one of
    // the observations, passed through beside all the others. Banning it would have banned the module's
    // own honest disclosure in the name of guarding against selection.
    for (const forbidden of ["sort(", "Math.max", "Math.min", "eventSequence"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And the authoritative figure is reachable ONLY through the verdict the pure rule produced.
    expect(code).toContain("r.precedence.resolved");
    expect(code).toContain("authoritativeMinor: r.precedence.authoritativeMinor");
    // The pure rule is imported as a TYPE here; the decision itself is taken in candidateCorrections.ts.
    expect(code).toContain('from "../../src/domain/correctionPrecedence"');
  });

  // ── THE UNSAFE SEQUENCE IS A REFUSAL, NOT A 500 ───────────────────────────────────────────────────
  it("an unorderable append sequence is reported as a named refusal with no figures", async () => {
    const unsafe = `SYNTHETIC-corrread-unsafe-${randomUUID()}`;
    const taskId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
         attempt, not_before, fencing_epoch, result, created_at, updated_at)
       VALUES ($1, $2, 'corr-read-test', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
      taskId, unsafe, randomUUID(), JSON.stringify([obligationSignal(60_000, OBL)]),
    );
    // THE SEQUENCE IS WRITTEN OUT OF RANGE AT INSERT, not patched afterwards: `agent_task_events` is
    // append-only by database trigger — "UPDATE on agent_task_events is rejected" — which is another
    // control confirmed by being refused, and the reason this fixture had to be built this way.
    //
    // AND IT IS DERIVED RATHER THAN HARDCODED, because the first form of this test could only pass ONCE
    // PER DATABASE. `event_sequence` is UNIQUE, so a literal `MAX_SAFE_INTEGER + 10` collided with the
    // row left by the previous run — "Key (event_sequence)=(9007199254741001) already exists" — and the
    // test failed on every re-run against the same database. CI never saw it, because CI gets a fresh
    // database; a test that has only ever run against a pristine database is not a guard against a real
    // one. Computing the value from the table's state is justified HERE and was not in the seeder that
    // taught this lesson: the value must be above a fixed threshold to be unsafe at all, and unique
    // because the column says so, and those two requirements together force a derived value. The floor
    // is explicit, so the result is unsafe whatever the table holds.
    const unsafeSequence = await prisma.$queryRawUnsafe<{ next: bigint }[]>(
      `SELECT (GREATEST(COALESCE(max(event_sequence), 0), ${Number.MAX_SAFE_INTEGER}) + 1)::bigint AS next
         FROM agent_task_events`,
    );
    expect(unsafeSequence[0]!.next > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, event_sequence, task_id, boundary_id, agent_id,
         fencing_epoch, attempt, kind, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'corr-read-test', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), unsafeSequence[0]!.next, taskId, unsafe,
    );
    const view = await readCandidateCorrections(actor("cfo@test", "approver", [unsafe]), unsafe);
    expect(view.result.outcome).toBe("REFUSED_ORDER_UNSAFE");
    if (view.result.outcome === "REFUSED_ORDER_UNSAFE") {
      expect(view.result.reason).toContain("cannot be ordered safely");
      expect(view.result.reason).toContain("not a server fault");
    }
    // NO FIGURES, and zeroes only in the totals a refusal legitimately has nothing to report in.
    expect(view.records).toEqual([]);
    expect(view.totals.identities).toBe(0);
    expect(view.precedenceNotice).toContain("NOT decided here");
  }, 60_000);

  // ── THE HTTP EDGE ─────────────────────────────────────────────────────────────────────────────────
  it("the route enforces the same gate and rejects an injected query parameter", async () => {
    const hdr = (id: string, role: string) => ({ "x-actor-id": id, "x-actor-role": role });
    const ok = await app.inject({
      method: "GET", url: `/candidate-corrections?boundaryId=${boundary}`, headers: hdr("cfo@company", "approver"),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().totals.withCorrections).toBe(1);

    const denied = await app.inject({
      method: "GET", url: `/candidate-corrections?boundaryId=${boundary}`, headers: hdr("ops@company", "operator"),
    });
    expect(denied.statusCode).toBe(403);

    const unauthenticated = await app.inject({
      method: "GET", url: `/candidate-corrections?boundaryId=${boundary}`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    // `additionalProperties: false` — an injected parameter is a 400, never a silent strip.
    const injected = await app.inject({
      method: "GET", url: `/candidate-corrections?boundaryId=${boundary}&precedence=last_wins`,
      headers: hdr("cfo@company", "approver"),
    });
    expect(injected.statusCode).toBe(400);

    // And no boundary at all is a 400 rather than every boundary.
    const missing = await app.inject({
      method: "GET", url: "/candidate-corrections", headers: hdr("cfo@company", "approver"),
    });
    expect(missing.statusCode).toBe(400);
  }, 60_000);

  it("the read persists nothing", async () => {
    const before = await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: boundary } });
    const proofs = await prisma.proof.count();
    await read("approver");
    await read("steward");
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: boundary } })).toBe(before);
    expect(await prisma.proof.count()).toBe(proofs);
  });
});
