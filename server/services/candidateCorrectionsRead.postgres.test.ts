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

  it("structurally: the module declares no authoritative-amount field", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "candidateCorrectionsRead.ts"), "utf8",
    ) as string;
    expect(/readonly\s+(corrected|authoritative|effective|resolved)Minor/.test(src)).toBe(false);
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
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, event_sequence, task_id, boundary_id, agent_id,
         fencing_epoch, attempt, kind, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'corr-read-test', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), BigInt(Number.MAX_SAFE_INTEGER) + 10n, taskId, unsafe,
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
