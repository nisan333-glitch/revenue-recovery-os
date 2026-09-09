// EP-11 · Case Halt enforcement — security P0 regression suite.
//
// PRE-EP-11 BEHAVIOR (the vulnerability these tests lock shut): `POST /cases/:id/halt` wrote a
// Halt row into the authority ledger and no write path ever read it back. Every assertion in the
// first three tests below returned 201 before this change — a halted case still accepted Author,
// EstablishBaseline, Intervene, IngestEvidence, Approve and Revise, so governance could stop
// nothing and a counted number could be created after a Steward had halted the case.
//
// Skips without DATABASE_URL (same gate as the rest of the server suite).
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { HALTED_MUTATIONS } from "./caseGuard";
import {
  uid,
  AUTHOR,
  APPROVER,
  VERIFIER,
  STEWARD,
  seedAuditableCase,
  seedBaseline,
  approveBody,
} from "../test/fixtures";

const HAS_DB = !!process.env.DATABASE_URL;

/** Every row class a governed mutation could create, counted per case. */
async function caseRowCounts(caseId: string) {
  const [proofs, authority, baselines, evidence] = await Promise.all([
    prisma.proof.count({ where: { recoveryCaseId: caseId } }),
    prisma.authorityEvent.count({ where: { recoveryCaseId: caseId } }),
    prisma.baselineSnapshot.count({ where: { recoveryCaseId: caseId } }),
    prisma.evidenceRecord.count({ where: { recoveryCaseId: caseId } }),
  ]);
  return { proofs, authority, baselines, evidence };
}

describe.skipIf(!HAS_DB)("EP-11 · a halted case rejects every governed mutation", () => {
  const app = buildApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const halt = (caseId: string) =>
    app.inject({ method: "POST", url: `/cases/${caseId}/halt`, headers: STEWARD });

  it("1 · Approve on a halted case is rejected and writes no proof row — was 201", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    expect((await halt(caseId)).statusCode).toBe(201);
    const before = await caseRowCounts(caseId);

    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });

    expect(res.statusCode).toBe(409);
    // Specifically the HALT, not the duplicate-chain-root rule: this case has no proof at all.
    expect(res.json().message).toMatch(/halted/i);
    expect(before.proofs).toBe(0);
    // Nothing at all was written — not the proof, and not its authority record either.
    expect(await caseRowCounts(caseId)).toEqual(before);
  });

  it("2 · Author / EstablishBaseline / Intervene / IngestEvidence are all rejected, writing nothing — were 201", async () => {
    const caseId = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
    expect((await halt(caseId)).statusCode).toBe(201);
    const before = await caseRowCounts(caseId);

    const attempts: Array<[string, Awaited<ReturnType<typeof app.inject>>]> = [
      ["Author", await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR })],
      [
        "EstablishBaseline",
        await app.inject({
          method: "POST",
          url: `/cases/${caseId}/baseline`,
          headers: AUTHOR,
          payload: {
            baselineId: `BL-${uid()}`,
            calculatedMinor: 260_000,
            currency: "USD",
            method: "matched_historical_cohort",
            methodVersion: 1,
            sourceRefs: ["src-1"],
            effectiveAt: "2026-07-01T00:00:00.000Z",
          },
        }),
      ],
      ["Intervene", await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: AUTHOR })],
      [
        "IngestEvidence",
        await app.inject({
          method: "POST",
          url: `/cases/${caseId}/evidence`,
          headers: AUTHOR,
          payload: {
            evidenceId: `EV-${uid()}`,
            sourceSystem: "billing",
            sourceRecordId: `inv-${uid()}`,
            evidenceType: "invoice_paid",
            observedAt: "2026-07-25T00:00:00.000Z",
            amountMinor: 1_320_000,
            currency: "USD",
          },
        }),
      ],
    ];

    for (const [mutation, res] of attempts) {
      expect(res.statusCode, `${mutation} must be rejected on a halted case`).toBe(409);
      expect(res.json().message).toMatch(/halted/i);
    }
    // No baseline row, no evidence row, and no new authority row for any of the four attempts.
    expect(await caseRowCounts(caseId)).toEqual(before);
  });

  it("3 · Revise on a halted case is rejected and adds no revision row — was 201", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/proofs",
          headers: APPROVER,
          payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
        })
      ).statusCode,
    ).toBe(201);
    expect((await halt(caseId)).statusCode).toBe(201);
    const before = await caseRowCounts(caseId);

    const res = await app.inject({
      method: "POST",
      url: `/proofs/${proofId}/revisions`,
      headers: APPROVER,
      payload: { newProofId: `PF-${uid()}`, status: "Corrected", collectedMinor: 1_400_000 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/halted/i);
    expect(await caseRowCounts(caseId)).toEqual(before);
    expect(await prisma.proof.count({ where: { chainId: proofId } })).toBe(1); // still only the original
  });

  it("4 · every mutation the guard claims to cover is actually rejected (no uncovered write path)", async () => {
    // Guards against the guard: if HALTED_MUTATIONS grows, this test fails until the new
    // mutation is genuinely wired to a rejecting endpoint here.
    expect([...HALTED_MUTATIONS].sort()).toEqual(
      ["Approve", "Author", "EstablishBaseline", "IngestEvidence", "Intervene", "Revise"].sort(),
    );
  });

  it("5 · audit and provenance READS stay available on a halted case", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect((await halt(caseId)).statusCode).toBe(201);

    // Halting a case must make it MORE inspectable, never less.
    const reads = [
      `/audit/cases/${caseId}`,
      `/audit/cases/${caseId}/cfo-export`,
      `/audit/proofs/${proofId}`,
      `/proofs/${proofId}`,
      `/cases/${caseId}/proofs`,
      `/cases/${caseId}/baselines`,
      `/cases/${caseId}/evidence`,
    ];
    for (const url of reads) {
      const res = await app.inject({ method: "GET", url, headers: STEWARD });
      expect(res.statusCode, `read ${url} must remain available`).toBe(200);
    }
    // The halt is itself visible in the audit trail, not a silent state.
    const trail = (await app.inject({ method: "GET", url: `/audit/cases/${caseId}`, headers: STEWARD })).json();
    expect(JSON.stringify(trail)).toMatch(/Halt/);
  });

  it("6 · concurrent Halt vs Approve is deterministic and fail-closed", async () => {
    // The race the advisory lock exists for. Whichever transaction takes the per-case lock first
    // decides the outcome; the assertion that matters is that the HTTP answer and the database
    // always agree — never a rejected approval that still left a row, never an accepted approval
    // with no row, and never a partial write (proof without its authority record).
    for (let round = 0; round < 6; round++) {
      const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
      const [haltRes, approveRes] = await Promise.all([
        halt(caseId),
        app.inject({
          method: "POST",
          url: "/proofs",
          headers: APPROVER,
          payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
        }),
      ]);

      expect(haltRes.statusCode, `round ${round}: the halt itself always lands`).toBe(201);
      expect([201, 409], `round ${round}: approve is either accepted or cleanly rejected`).toContain(
        approveRes.statusCode,
      );

      const proofRows = await prisma.proof.count({ where: { recoveryCaseId: caseId } });
      const approveEvents = await prisma.authorityEvent.count({
        where: { recoveryCaseId: caseId, action: "Approve" },
      });
      // HTTP outcome ⇔ database state. This is the invariant a TOCTOU window would break.
      expect(proofRows, `round ${round}: db must agree with the HTTP outcome`).toBe(
        approveRes.statusCode === 201 ? 1 : 0,
      );
      // Atomicity: the proof row and its authority record never come apart.
      expect(approveEvents, `round ${round}: no orphaned authority record`).toBe(proofRows);
      if (approveRes.statusCode === 409) expect(approveRes.json().message).toMatch(/halted/i);

      // Once the race is settled the case is halted for good: every later mutation is refused.
      const after = await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: AUTHOR });
      expect(after.statusCode, `round ${round}: the case stays halted afterwards`).toBe(409);
      expect(after.json().message).toMatch(/halted/i);
    }
  });

  it("7 · a Halt is never retroactive — a proof approved before it is untouched", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const approved = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect(approved.statusCode).toBe(201);
    const beforeRow = await prisma.proof.findUniqueOrThrow({ where: { proofId } });

    expect((await halt(caseId)).statusCode).toBe(201);

    // Proof immutability outranks the halt: history is never rewritten, only the future is stopped.
    const afterRow = await prisma.proof.findUniqueOrThrow({ where: { proofId } });
    expect(afterRow).toEqual(beforeRow);
    expect((await app.inject({ method: "GET", url: `/proofs/${proofId}`, headers: APPROVER })).statusCode).toBe(200);
  });

  it("8 · oversight actions remain available on a halted case", async () => {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    await app.inject({
      method: "POST",
      url: "/proofs",
      headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect((await halt(caseId)).statusCode).toBe(201);

    // Blocking these would strand a halted case with no way to exclude, annotate or verify it.
    // None of them creates or changes a counted number.
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/flag`, headers: STEWARD })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/cases/${caseId}/exclude`, headers: STEWARD })).statusCode).toBe(201);
    expect((await halt(caseId)).statusCode).toBe(201); // re-halt is idempotent, and itself an audit fact
    expect(
      (await app.inject({ method: "POST", url: `/proofs/${proofId}/verify`, headers: VERIFIER })).statusCode,
    ).toBe(200);
  });

  it("9 · a halt is scoped to its own case and never bleeds into another", async () => {
    const halted = `RC-${uid()}`;
    await app.inject({ method: "POST", url: `/cases/${halted}/author`, headers: AUTHOR });
    expect((await halt(halted)).statusCode).toBe(201);

    const other = `RC-${uid()}`;
    expect(
      (await app.inject({ method: "POST", url: `/cases/${other}/author`, headers: AUTHOR })).statusCode,
    ).toBe(201);
    await seedBaseline(app, other); // throws if not 201
    expect(
      (await app.inject({ method: "POST", url: `/cases/${other}/intervention`, headers: AUTHOR })).statusCode,
    ).toBe(201);
  });

  it("10 · least privilege still answers first — the halt gate does not mask a role denial", async () => {
    const { caseId, baselineId, evidenceId } = await seedAuditableCase(app);
    expect((await halt(caseId)).statusCode).toBe(201);
    // A Steward may never count. That must stay a 403 (role), not become a 409 (case state) —
    // otherwise a halted case would quietly hide separation-of-duties failures.
    const res = await app.inject({
      method: "POST",
      url: "/proofs",
      headers: STEWARD,
      payload: approveBody({ proofId: `PF-${uid()}`, caseId, baselineId, evidenceIds: [evidenceId] }),
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.proof.count({ where: { recoveryCaseId: caseId } })).toBe(0);
  });
});
