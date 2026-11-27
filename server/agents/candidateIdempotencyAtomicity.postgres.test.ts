// CANDIDATE INSERT ATOMICITY · the defect CI caught and a local run could not.
//
// WHAT HAPPENED. `crossCaseOverlap.postgres.test.ts`'s concurrency case passed ten times locally and
// failed in CI on the identical commit, with a raw Postgres 23505 escaping `CaseAdmissionService.submit`:
// `Key (candidate_id)=(CC-d96c108fc355abff03098161) already exists.` That is not a flaky test. It is the
// signature of a race, and the cause was one clause: `insertCandidateIfAbsent` wrote
// `ON CONFLICT (dedupe_key) DO NOTHING` while `agent_case_candidates` carries THREE unique constraints.
// An ON CONFLICT arbiter covers exactly ONE index; every other unique violation is raised. So the
// function's advertised contract — idempotent, returning `created: false` for a candidate that already
// exists — held sequentially and broke under concurrency.
//
// WHY THIS FILE EXISTS RATHER THAN A SECOND CONCURRENCY TEST. Ten green runs after the fix prove nothing
// on their own: the test was green locally BEFORE the fix too. *A test that cannot fail is not a
// control*, applied to my own verification. So the property is proved DETERMINISTICALLY in raw SQL
// against the real table — the arbiter's scope is a fact about Postgres, not about timing — and the
// derivation that makes the unarbitrated clause exactly as narrow as the old one INTENDED to be is
// pinned separately. The race is then only the symptom, and the symptom is not the thing under test.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db";
import { CaseAdmissionService, caseCandidateDedupeKey, caseCandidateId } from "./caseAdmission";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE } from "./reconciliationObserver";
import type { CandidateSignal } from "./types";

const POLICY = { recoveryType: RECONCILIATION_RECOVERY_TYPE, economicThresholdMinor: 1 };
const store = new PostgresCaseCandidateStore();
const service = new CaseAdmissionService(store, () => new Date());
const ref = () => `hmac-sha256:${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;

function single(boundaryId: string, sourceRef: string, obligationRef: string): CandidateSignal {
  const minor = 40_000;
  return {
    signalId: `REC-${randomUUID().slice(0, 12)}`,
    boundaryId,
    recoveryType: RECONCILIATION_RECOVERY_TYPE,
    sourceRef,
    sourcePayloadHash: "0".repeat(64),
    detectorVersion: RECONCILIATION_AGENT_ID,
    observedAt: new Date().toISOString(),
    amountAtRiskMinor: minor,
    currency: "USD",
    actionAvailable: true,
    expectedProofEvent: "corrective invoice raised and collected",
    obligationCoverage: {
      kind: "SINGLE_OBLIGATION", obligationRef,
      expectedMinor: minor + 10_000, billedMinor: 10_000, residualMinor: minor, currency: "USD",
    },
  } as CandidateSignal;
}

describe("candidate identity · the three unique constraints are ONE event", () => {
  it("derives candidate_id as a PURE FUNCTION of the dedupe key — this is what licenses dropping the arbiter", () => {
    // THE LOAD-BEARING PIN. `ON CONFLICT DO NOTHING` with no arbiter is only as narrow as
    // `ON CONFLICT (dedupe_key)` INTENDED to be while `candidate_id` is determined by `dedupe_key`.
    // Decouple them and the unarbitrated clause starts suppressing a genuinely different collision,
    // so this must fail loudly rather than be rediscovered as a wrong `created: false`.
    for (let i = 0; i < 32; i += 1) {
      const key = caseCandidateDedupeKey(single(`b-${i}`, ref(), ref()));
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(caseCandidateId(key)).toBe(`CC-${key.slice(0, 24)}`);
      // Same key twice ⇒ same id. A function, not a registry.
      expect(caseCandidateId(key)).toBe(caseCandidateId(key));
    }
  });

  it("names exactly the three unique constraints this reasoning depends on, and no fourth", async () => {
    // Derived from the live catalog rather than from the migration text, because the reasoning is
    // about what the DATABASE will enforce. A fourth unique index would mean a conflict the
    // unarbitrated clause could suppress WITHOUT it being this candidate's dedupe key — which the
    // fallback below turns into a loud throw, but which nobody should discover that way.
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT c.conname FROM pg_constraint c
       WHERE c.conrelid = 'agent_case_candidates'::regclass AND c.contype IN ('p','u','x')
       ORDER BY c.conname`;
    expect(rows.map((r) => r.conname)).toEqual([
      "agent_case_candidates_dedupe_key_key",
      "agent_case_candidates_identity_boundary_unique",
      "agent_case_candidates_pkey",
    ]);
  });
});

// THIS BLOCK IS A FACT ABOUT POSTGRES, NOT A GUARD ON THE PRODUCT, and the distinction was measured
// rather than assumed. These cases build their own INSERT strings, so restoring the defective
// `ON CONFLICT (dedupe_key)` in `postgresCaseCandidateStore.ts` leaves all of them GREEN — verified by
// doing exactly that, nine runs across both suites, every one passing. They establish WHY the arbiter
// is insufficient; the structural test below is what makes a regression fail. *A guard must read the
// construct it is actually asking about* — and a reader counting passing tests here would credit the
// wrong one.
describe("ON CONFLICT scope · a fact about Postgres that explains the fix (and does not guard it)", () => {
  // EVERY IDENTITY IS FRESH PER RUN, and that is not tidiness. `agent_case_candidates` is append-only
  // BY TRIGGER, so nothing can delete a row afterwards. My first form used a fixed `CC-aaa…` literal,
  // which made the whole file SINGLE-USE: the first run committed that primary key and every later run
  // collided on it. *A test that has only run against a clean database is not a guard against a dirty
  // one* — the same lesson this repository already recorded against the guided-demo idempotence guard.
  function fresh() {
    const keyA = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const keyB = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    // DELIBERATELY the SAME candidate_id for a DIFFERENT dedupe key. That is the whole probe: it puts
    // the conflict on a NON-arbiter index, deterministically, with no race to wait for.
    return { id: caseCandidateId(keyA), keyA, keyB, boundaryId: `b-atomicity-${keyA.slice(0, 10)}` };
  }
  const INSERT = `INSERT INTO agent_case_candidates
      (candidate_id, dedupe_key, boundary_id, agent_id, signal, status, submitted_at, persisted_at)
     VALUES ($1,$2,$3,'ag',$4::jsonb,$5, clock_timestamp(), clock_timestamp())`;

  it("ON CONFLICT (dedupe_key) does NOT suppress a primary-key conflict — the defect, reproduced", async () => {
    const f = fresh();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(INSERT, f.id, f.keyA, f.boundaryId, '{"k":1}', "pending_review");
      await tx.$executeRawUnsafe(`${INSERT} ON CONFLICT (dedupe_key) DO NOTHING`,
        f.id, f.keyB, f.boundaryId, '{"k":2}', "pending_review");
    })).rejects.toThrow(/agent_case_candidates_pkey|already exists/);
  });

  it("ON CONFLICT with NO arbiter suppresses it, leaving exactly the one row — the fix", async () => {
    const f = fresh();
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(INSERT, f.id, f.keyA, f.boundaryId, '{"k":1}', "pending_review");
      await tx.$executeRawUnsafe(`${INSERT} ON CONFLICT DO NOTHING`,
        f.id, f.keyB, f.boundaryId, '{"k":2}', "pending_review");
      return tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM agent_case_candidates WHERE boundary_id = ${f.boundaryId}`;
    });
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("and STILL RAISES a CHECK violation — the unarbitrated clause is not a blanket swallow", async () => {
    // The honest bound on the fix. DO NOTHING covers unique and exclusion violations only; a row that
    // breaks a CHECK is refused either way, so nothing was traded away for the atomicity.
    const f = fresh();
    await expect(prisma.$transaction(async (tx) =>
      tx.$executeRawUnsafe(`${INSERT} ON CONFLICT DO NOTHING`,
        f.id, f.keyA, f.boundaryId, '{"k":3}', "approved")))
      .rejects.toThrow(/agent_case_candidates_status_valid|check constraint/);
  });
});

describe("the service's idempotency under concurrency · the symptom, which cannot fail on demand", () => {
  it("answers CREATED once and ALREADY-EXISTS for the rest, with no raw database error escaping", async () => {
    // The symptom test. It is kept BESIDE the deterministic proof above, never instead of it: it
    // passed before the fix too, and a race that happens not to happen is not evidence.
    const boundaryId = `b-concurrent-${randomUUID().slice(0, 8)}`;
    const sig = single(boundaryId, ref(), ref());
    const results = await Promise.all(Array.from({ length: 8 }, () => service.submit(RECONCILIATION_AGENT_ID, sig, POLICY)));
    expect(results.every((r) => r.admitted)).toBe(true);
    const created = results.filter((r) => r.admitted && r.created).length;
    expect(created).toBe(1);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM agent_case_candidates WHERE boundary_id = ${boundaryId}`;
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe("the production clause itself · the only test that catches the regression", () => {
  it("insertCandidateIfAbsent uses an UNARBITRATED ON CONFLICT DO NOTHING", () => {
    // STRUCTURAL, and load-bearing. Everything above describes the hazard; this is what fails if the
    // arbiter comes back. It reads the SQL the production function actually sends — not a copy of it
    // written here, which would be a second implementation free to agree while the first drifted.
    const src = readFileSync(resolve("server/agents/postgresCaseCandidateStore.ts"), "utf8");
    const insert = src.slice(src.indexOf("INSERT INTO agent_case_candidates"));
    const stmt = insert.slice(0, insert.indexOf("RETURNING"));
    expect(stmt).toContain("ON CONFLICT DO NOTHING");
    // An arbiter in the STATEMENT is the defect. Narrowed to the statement rather than the whole file
    // so the explanatory comment above it — which necessarily quotes the broken form — is not read as
    // the code. The prose-is-not-code lesson, applied to my own guard before trusting it.
    expect(stmt).not.toMatch(/ON CONFLICT\s*\(/);
  });

  it("and the guard FIRES on the defective form — asserted, not assumed", () => {
    // Without this, the check above could be vacuously true. The mutation is applied to a string here
    // because the real file must stay correct; the point is that the predicate discriminates.
    const broken = `INSERT INTO agent_case_candidates (candidate_id)\n  VALUES ($1)\n  ON CONFLICT (dedupe_key) DO NOTHING\n  RETURNING candidate_id`;
    const stmt = broken.slice(0, broken.indexOf("RETURNING"));
    expect(stmt).toMatch(/ON CONFLICT\s*\(/);
  });
});
