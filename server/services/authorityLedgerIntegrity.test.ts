// WORKSTREAM C · The authority ledger — what it currently records, and what it cannot establish.
//
// Every assertion is VERIFIED CURRENT BEHAVIOUR. Nothing here proposes a correction; the proposals live
// in `docs/architecture/AUTHORITY_LEDGER_INTEGRITY_REVIEW_V1.md`, and the two blocks at the end of this
// file are EXECUTABLE SPECIFICATIONS of them, deliberately skipped.
//
// THE TWO ISSUES ARE COUPLED, which is this suite's main finding and the reason they are measured in one
// file. Issue 1 is that `revise()` writes the same `Approve` token as `approve()`. Issue 2 is that the
// ledger records no append order. The read-side fix for Issue 1 pairs ledger rows to proof rows IN TIME
// ORDER — so it inherits exactly the uncertainty Issue 2 describes.
//
// Skips without DATABASE_URL (the same gate as the rest of the server suite).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { uid, hdr, AUTHOR, APPROVER, VERIFIER, seedAuditableCase, approveBody } from "../test/fixtures";
import { authorityFor } from "../auth/authorityStore";
import { getCaseProofs } from "../persistence/proofStore";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("C · Issue 1 · an approval and a revision are the same token", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** Author → baseline → intervention → evidence → approve → revise. Returns the case and both proofs. */
  async function caseWithRevision() {
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    const approved = await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    });
    expect(approved.statusCode).toBe(201);
    const revisedId = `PF-${uid()}`;
    const revised = await app.inject({
      method: "POST", url: `/proofs/${proofId}/revisions`, headers: APPROVER,
      payload: { newProofId: revisedId, status: "Reversed" },
    });
    expect(revised.statusCode).toBe(201);
    return { caseId, proofId, revisedId };
  }

  it("1 · the ledger records TWO `Approve` rows and nothing distinguishes them", async () => {
    const { caseId } = await caseWithRevision();
    const approveRows = (await authorityFor(caseId)).filter((h) => h.action === "Approve");
    expect(approveRows).toHaveLength(2);
    // Same actor, same role, same policy version, same token. The ONLY field that differs is `at`.
    const distinguishing = new Set(
      approveRows.map((r) => `${r.action}|${r.actorId}|${r.role}|${r.policyVersion}`),
    );
    expect(distinguishing.size).toBe(1);
    // No `Revise` token exists anywhere in the ledger.
    expect((await authorityFor(caseId)).some((h) => h.action === "Revise")).toBe(false);
  });

  it("2 · but the PROOF CHAIN distinguishes them, immutably — the read-side derivation works", async () => {
    const { caseId, proofId, revisedId } = await caseWithRevision();
    const proofs = await getCaseProofs(caseId);
    expect(proofs).toHaveLength(2);

    // An approval is a CHAIN ROOT: proofVersion 1, no predecessor. A revision is not.
    const roots = proofs.filter((p) => p.previousProofId === null);
    const revisions = proofs.filter((p) => p.previousProofId !== null);
    expect(roots.map((p) => p.proofId)).toEqual([proofId]);
    expect(revisions.map((p) => p.proofId)).toEqual([revisedId]);
    expect(roots[0]!.proofVersion).toBe(1);
    expect(revisions[0]!.proofVersion).toBe(2);
    expect(revisions[0]!.previousProofId).toBe(proofId);

    // THE COUNTS CORRESPOND, which is what makes the derivation total: one `Approve` row per proof row.
    const approveRows = (await authorityFor(caseId)).filter((h) => h.action === "Approve");
    expect(approveRows).toHaveLength(proofs.length);
  });

  it("3 · THE LIMIT, stated rather than papered over: pairing row→proof rests on ORDER", async () => {
    const { caseId, proofId } = await caseWithRevision();
    const approveRows = (await authorityFor(caseId)).filter((h) => h.action === "Approve");
    const proofs = [...(await getCaseProofs(caseId))].sort((a, b) => a.proofVersion - b.proofVersion);

    // The k-th `Approve` row corresponds to the k-th proof. That is only decidable if the rows are
    // ordered, and the ledger's order is a millisecond clock with no tie-breaker — Issue 2. Where the
    // two timestamps are distinct the pairing is sound; where they tie it is NOT ESTABLISHED.
    const stamps = approveRows.map((r) => r.at.getTime());
    const orderEstablished = new Set(stamps).size === stamps.length;
    expect(typeof orderEstablished).toBe("boolean");
    if (orderEstablished) expect(proofs[0]!.proofId).toBe(proofId);
  });
});

describe.skipIf(!HAS_DB)("C · Issue 1 · the `Approve` token is LOAD-BEARING for separation of duties", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("4 · a revise-ONLY actor lands in `approvers` and is therefore refused `Verify`", async () => {
    // THE REASON THE OBVIOUS FIX IS UNSAFE. `enforceSeparation` builds `approvers = idsFor("Approve")`.
    // A second approver who only ever REVISED a proof is in that set today, and is blocked from
    // verifying the same case. If `revise()` wrote a distinct token instead of `Approve`, this actor
    // would drop out of the set and the refusal below would become a 201 — a loosening of separation of
    // duties in the beneficiary's favour, produced by what looks like a tidy-up.
    const { caseId, baselineId, evidenceId, collectedMinor } = await seedAuditableCase(app);
    const proofId = `PF-${uid()}`;
    expect((await app.inject({
      method: "POST", url: "/proofs", headers: APPROVER,
      payload: approveBody({ proofId, caseId, baselineId, evidenceIds: [evidenceId], collectedMinor }),
    })).statusCode).toBe(201);

    // A DIFFERENT approver identity performs only the revision.
    const reviser = hdr(`reviser-${uid()}@company`, "approver");
    expect((await app.inject({
      method: "POST", url: `/proofs/${proofId}/revisions`, headers: reviser,
      payload: { newProofId: `PF-${uid()}`, status: "Reversed" },
    })).statusCode).toBe(201);

    const reviserId = reviser["x-actor-id"];
    const approvers = new Set(
      (await authorityFor(caseId)).filter((h) => h.action === "Approve").map((h) => h.actorId),
    );
    expect(approvers.has(reviserId)).toBe(true);

    // And the gate actually fires on it.
    const verify = await app.inject({
      method: "POST", url: `/proofs/${proofId}/verify`,
      headers: { "x-actor-id": reviserId, "x-actor-role": "verifier" },
    });
    expect(verify.statusCode).toBe(403);
    expect(verify.json().message).toMatch(/approver.*cannot verify/i);
  });
});

describe.skipIf(!HAS_DB)("C · Issue 2 · how often does the ledger's order go unestablished?", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("5 · MEASURED, not assumed: same-timestamp ties across repeated writes", async () => {
    // The execution-event defect was fixed only after it was MEASURED — 4 ties in 40 trials, 2 of them
    // ordered wrongly. Issue 2's severity deserves the same treatment rather than an assertion that it
    // "could" happen.
    //
    // THE BOUND IS STATED HERE BECAUSE IT LIMITS THE RESULT: this machine, this Postgres, an idle
    // database, writes issued back-to-back from one process. A low rate here is NOT evidence of a low
    // rate on a loaded production database, where contention makes same-millisecond commits more likely,
    // not less. The number is a floor on the exposure, never a ceiling.
    const TRIALS = 20;
    let tied = 0;
    for (let i = 0; i < TRIALS; i += 1) {
      const caseId = `RC-${uid()}`;
      await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
      await app.inject({ method: "POST", url: `/cases/${caseId}/intervention`, headers: AUTHOR });
      const stamps = (await authorityFor(caseId)).map((r) => r.at.getTime());
      if (new Set(stamps).size !== stamps.length) tied += 1;
    }
    // No threshold is asserted — the point is to RECORD the rate, and a threshold would turn an
    // observation into a flaky gate. What IS asserted is that the measurement ran.
    console.log(`AUTHORITY LEDGER TIE RATE · ${tied}/${TRIALS} cases had two events sharing a timestamp`);
    expect(tied).toBeGreaterThanOrEqual(0);
    expect(tied).toBeLessThanOrEqual(TRIALS);
  }, 120_000);

  it("6 · the ledger exposes NO append order to read — the ordering input simply is not there", async () => {
    // Structural, and the reason a tie cannot be broken after the fact: the stored row has `at` and a
    // random `id`, and nothing else that the database allocated in append order.
    const { caseId } = await seedAuditableCase(app);
    const rows = await prisma.authorityEvent.findMany({ where: { recoveryCaseId: caseId } });
    expect(rows.length).toBeGreaterThan(0);
    const columns = new Set(Object.keys(rows[0]!));
    expect(columns.has("at")).toBe(true);
    expect(columns.has("seq")).toBe(false);
    // `id` is a random UUID, so it is a tie-breaker that establishes nothing — the exact defect the
    // execution-event migration names.
    expect(rows[0]!.id).toMatch(/^AE-[0-9a-f-]{36}$/);
  });

  it("7b · WHY the rate is low, structurally: at most ONE row per transaction", () => {
    // THIS OUTLASTS THE NUMBER, and it is the difference from the execution-event defect. That log
    // appended SEVERAL events inside one transaction, so two rows shared a `now()` by construction —
    // hence 4 ties in 40 trials there. The authority ledger has three writers and each appends exactly
    // one row per transaction, so a tie needs two SEPARATE transactions to commit in the same
    // millisecond. That is rarer, and it is not impossible: it is what concurrency does.
    const sources = [
      "server/auth/authorityStore.ts",
      "server/services/proofService.ts",
      "server/persistence/proofStore.ts",
      "server/agents/postgresCandidateReviewStore.ts",
    ];
    let writes = 0;
    for (const file of sources) {
      const code = readFileSync(`${process.cwd()}/${file}`, "utf8");
      writes += [...code.matchAll(/authorityEvent\.create\(/g)].length;
    }
    // Three direct `create` sites — one in `recordAuthority`, two in `proofStore`, one in the promotion
    // store. The guard must be able to fire: if the scan found nothing it would pass vacuously.
    expect(writes).toBeGreaterThanOrEqual(3);
    // And no site writes a LIST of rows, which is the shape that would put two in one transaction.
    for (const file of sources) {
      const code = readFileSync(`${process.cwd()}/${file}`, "utf8");
      expect(code, file).not.toMatch(/authorityEvent\.createMany/);
    }
  });

  it("7 · and `firstInterveneEvent`'s input is a bare timestamp comparison", async () => {
    // Blast radius: this value feeds the baseline-ordering trust gate in `auditService`. With one
    // `Intervene` row it is exact; the uncertainty only arises if a case ever recorded two at the same
    // millisecond, which is what test 5 measures.
    const { caseId } = await seedAuditableCase(app);
    const interventions = (await authorityFor(caseId)).filter((h) => h.action === "Intervene");
    expect(interventions).toHaveLength(1);
    expect(interventions[0]!.at).toBeInstanceOf(Date);
  });
});

// ── EXECUTABLE SPECIFICATIONS · PROPOSED behaviour, deliberately not implemented ──────────────────
//
// These describe what a correction must satisfy. They are skipped because satisfying them requires a
// migration and a ledger semantic change, neither of which is authorised in this slice. They are written
// as real assertions rather than prose so the next slice inherits a test rather than a paragraph.
describe.skip("C · PROPOSED · additive revision token (requires owner approval)", () => {
  it("S1 · a revision records BOTH `Approve` and a distinguishing fact", () => {
    // `approvers` must still contain the reviser, or test 4 above flips from 403 to 201.
    expect.fail("not implemented — see AUTHORITY_LEDGER_INTEGRITY_REVIEW_V1.md §4");
  });
  it("S2 · `idsFor(\"Approve\")` is widened in the SAME change, never after", () => {
    expect.fail("not implemented — the gap between the two is the vulnerability");
  });
  it("S3 · every historical row keeps its meaning: no backfill, no reinterpretation", () => {
    expect.fail("not implemented");
  });
});

describe.skip("C · PROPOSED · append sequence on AuthorityEvent (requires a migration)", () => {
  it("S4 · new rows carry a database-allocated `seq` from a COLUMN DEFAULT", () => {
    expect.fail("not implemented — see the executionEvents precedent migration");
  });
  it("S5 · legacy rows keep `seq = NULL` and are never backfilled", () => {
    // BIGSERIAL would backfill in physical heap order and commit a fabricated chronology to disk.
    expect.fail("not implemented");
  });
  it("S6 · a legacy row alone at its timestamp is CERTAIN; a tie is reported NOT ESTABLISHED", () => {
    expect.fail("not implemented");
  });
});
