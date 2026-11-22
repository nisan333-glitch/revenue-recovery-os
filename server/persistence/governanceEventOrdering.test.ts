// GOVERNED ISSUE #4, PART 2 · the two governance lifecycle logs order chronologically.
//
// WHAT THIS PROVES, AND WHY A UNIT TEST COULD NOT. The defect lives in a SQL `ORDER BY` against a
// `timestamp(3)` column, so it is only reachable through a real database: a double would order whatever
// the double was told to. These tests therefore write real rows, and the decisive ones write them with
// an IDENTICAL `at` — which is the case the random-uuid tie-breaker decided by coin flip.
//
// THE FAILURE THIS CLOSES WAS OBSERVED, NOT IMAGINED. CI run 44990616435 failed two tests in SETUP with
// `403 … terms-test@1.0.0: the policy is a draft and has not been activated`. `deriveState` is a fold
// gated by legality: ACTIVATED read FIRST finds `state === null`, is rejected as illegal and SILENTLY
// DROPPED; the PROPOSED that follows then sets DRAFT. So a correctly governed definition reads as a
// draft and every submission under it is refused.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import {
  analysisTermsEvents,
  analysisTermsGovernanceState,
  appendAnalysisTermsEvent,
} from "./pilotAnalysisTermsStore";
import { appendPolicyEvent, policyEvents, policyGovernanceState } from "./pilotPolicyGovernanceStore";

const REPO = resolve(__dirname, "..", "..");
const uid = () => randomUUID().slice(0, 8);

/** The two logs, behind one shape, so every property below is asserted on BOTH rather than on one. */
const LOGS = [
  {
    name: "analysis terms",
    async seed(boundaryId: string, id: string, version: string, rows: readonly {
      id: string; transition: string; at: Date; seq?: bigint | null;
    }[]) {
      await prisma.pilotAnalysisTermsEventRecord.createMany({
        data: rows.map((r) => ({
          id: r.id, boundaryId, termsId: id, termsVersion: version, transition: r.transition,
          actorId: r.transition === "PROPOSED" ? "op" : "gov",
          actorRole: r.transition === "PROPOSED" ? "operator" : "steward",
          rationale: "fixture", at: r.at, ...(r.seq === undefined ? {} : { seq: r.seq }),
        })),
      });
    },
    append: (boundaryId: string, id: string, version: string, transition: "PROPOSED" | "ACTIVATED") =>
      appendAnalysisTermsEvent({
        boundaryId, termsId: id, termsVersion: version, transition,
        actorId: transition === "PROPOSED" ? "op" : "gov",
        actorRole: transition === "PROPOSED" ? "operator" : "steward",
        rationale: "fixture",
      }),
    state: analysisTermsGovernanceState,
    events: analysisTermsEvents,
    table: "pilot_analysis_terms_events",
    seqName: "pilot_analysis_terms_events_seq",
    orderIndex: "pilot_analysis_terms_events_order_idx",
    identityIndex: "pilot_analysis_terms_events_identity_idx",
    source: "server/persistence/pilotAnalysisTermsStore.ts",
  },
  {
    name: "admission policy",
    async seed(boundaryId: string, id: string, version: string, rows: readonly {
      id: string; transition: string; at: Date; seq?: bigint | null;
    }[]) {
      await prisma.pilotAdmissionPolicyEventRecord.createMany({
        data: rows.map((r) => ({
          id: r.id, boundaryId, policyId: id, policyVersion: version, transition: r.transition,
          actorId: r.transition === "PROPOSED" ? "op" : "gov",
          actorRole: r.transition === "PROPOSED" ? "operator" : "steward",
          rationale: "fixture", at: r.at, ...(r.seq === undefined ? {} : { seq: r.seq }),
        })),
      });
    },
    append: (boundaryId: string, id: string, version: string, transition: "PROPOSED" | "ACTIVATED") =>
      appendPolicyEvent({
        boundaryId, policyId: id, policyVersion: version, transition,
        actorId: transition === "PROPOSED" ? "op" : "gov",
        actorRole: transition === "PROPOSED" ? "operator" : "steward",
        rationale: "fixture",
      }),
    state: policyGovernanceState,
    events: policyEvents,
    table: "PilotAdmissionPolicyEventRecord",
    seqName: "pilot_admission_policy_events_seq",
    orderIndex: "pilot_policy_events_order_idx",
    identityIndex: "pilot_policy_events_identity_idx",
    source: "server/persistence/pilotPolicyGovernanceStore.ts",
  },
] as const;

describe.skipIf(!process.env.DATABASE_URL)("governance event ordering", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  for (const log of LOGS) {
    describe(log.name, () => {
      // ── A · THE EXACT FAILING CASE ───────────────────────────────────────────────────────────────
      it("A · same millisecond, ACTIVATED's id sorting FIRST, still reads ACTIVE", async () => {
        // BEFORE THE FIX this returned DRAFT. Measured on a disposable database: identical `at`, the
        // only difference being which uuid sorts first —
        //   proposed-id-first  [PROPOSED,ACTIVATED] → ACTIVE
        //   activated-id-first [ACTIVATED,PROPOSED] → DRAFT   ← the 403
        // The ids below are chosen so `id ASC` alone would reverse the pair, so a regression that drops
        // `seq` from the ORDER BY fails here rather than flaking.
        const b = `pb-${uid()}`;
        const at = new Date("2026-11-22T00:00:00.000Z");
        await log.seed(b, "t", "1.0.0", [
          { id: `zzzz-p-${b}`, transition: "PROPOSED", at, seq: 1n },
          { id: `0000-a-${b}`, transition: "ACTIVATED", at, seq: 2n },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        expect(st.events.map((e) => e.transition)).toEqual(["PROPOSED", "ACTIVATED"]);
        expect(st.state).toBe("ACTIVE");
        expect(st.orderCertain).toBe(true);
        expect(st.orderUncertainAt).toEqual([]);
      });

      it("A2 · and the reverse append order genuinely yields DRAFT — the test is not order-blind", async () => {
        // THE CONTROL. Without it, A would pass for a build that ignored `seq` and simply never saw a
        // tie. Here the APPEND order really is activate-then-propose, which is an illegal history, and
        // the fold's answer must stay DRAFT. *A test that cannot fail is not a control.*
        const b = `pb-${uid()}`;
        const at = new Date("2026-11-22T00:00:00.000Z");
        await log.seed(b, "t", "1.0.0", [
          { id: `aaaa-a-${b}`, transition: "ACTIVATED", at, seq: 1n },
          { id: `bbbb-p-${b}`, transition: "PROPOSED", at, seq: 2n },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        expect(st.events.map((e) => e.transition)).toEqual(["ACTIVATED", "PROPOSED"]);
        expect(st.state).toBe("DRAFT");
      });

      // ── B · THROUGH THE REAL APPEND PATH ─────────────────────────────────────────────────────────
      it("B · 40 propose/activate pairs through the production append path are ALL ACTIVE", async () => {
        // The production writers allocate `seq` from the COLUMN DEFAULT, so this also proves no code
        // path can append without an append order. On a fast host many of these share a millisecond;
        // before the fix each tie was a coin flip.
        const b = `pb-${uid()}`;
        let sameMillisecond = 0;
        for (let i = 0; i < 40; i++) {
          const id = `t-${i}`;
          await log.append(b, id, "1.0.0", "PROPOSED");
          await log.append(b, id, "1.0.0", "ACTIVATED");
          const st = await log.state(b, id, "1.0.0");
          expect(st.state, `pair ${i} did not read ACTIVE`).toBe("ACTIVE");
          expect(st.orderCertain).toBe(true);
          if (st.events[0]!.at === st.events[1]!.at) sameMillisecond++;
        }
        // Reported, not asserted: the tie rate is a property of the host, and requiring one would make
        // this test fail on a slow machine for a reason that is not a defect.
        console.log(`    ${log.name}: ${sameMillisecond} of 40 pairs shared a millisecond`);
      });

      it("B2 · two activations in one millisecond: the LATER-APPENDED one is the one in force", async () => {
        // `activatedAt` feeds the pre-registration test `activatedAt > firstSeenAt`, so which activation
        // counts as current must not be decided by a random uuid.
        const b = `pb-${uid()}`;
        const at = new Date("2026-11-22T00:00:00.000Z");
        await log.seed(b, "t", "1.0.0", [
          { id: `m-p-${b}`, transition: "PROPOSED", at, seq: 1n },
          { id: `z-a1-${b}`, transition: "ACTIVATED", at, seq: 2n },
          { id: `a-a2-${b}`, transition: "ACTIVATED", at, seq: 3n },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        // `id ASC` alone would put `a-second-activation` before `z-first-activation` and report the
        // FIRST activation as current. `seq` decides it instead.
        expect(st.events.length).toBe(3);
        expect(st.activatedBy).toBe("gov");
        expect(st.state).toBe("ACTIVE");
      });

      // ── C/D · LEGACY ROWS: COMPATIBLE, AND THEIR AMBIGUITY LABELLED NOT RESOLVED ─────────────────
      it("C · legacy rows (seq NULL) keep their historical `at` order and their derived state", async () => {
        const b = `pb-${uid()}`;
        await log.seed(b, "t", "1.0.0", [
          { id: `p-${b}`, transition: "PROPOSED", at: new Date("2026-01-01T00:00:00.000Z"), seq: null },
          { id: `a-${b}`, transition: "ACTIVATED", at: new Date("2026-01-02T00:00:00.000Z"), seq: null },
          { id: `f-${b}`, transition: "FROZEN", at: new Date("2026-01-03T00:00:00.000Z"), seq: null },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        expect(st.events.map((e) => e.transition)).toEqual(["PROPOSED", "ACTIVATED", "FROZEN"]);
        expect(st.state).toBe("FROZEN");
        // DISTINCT TIMESTAMPS ARE CERTAIN even with no seq: `at` alone decides them. A legacy row ALONE
        // at its timestamp is ordered with certainty — only a tie with nothing to break it is not.
        expect(st.orderCertain).toBe(true);
      });

      it("D · two legacy rows tied on `at` are reported UNCERTAIN, and are NOT reordered", async () => {
        const b = `pb-${uid()}`;
        const at = new Date("2026-01-01T00:00:00.000Z");
        await log.seed(b, "t", "1.0.0", [
          { id: `aaa-a-${b}`, transition: "ACTIVATED", at, seq: null },
          { id: `bbb-p-${b}`, transition: "PROPOSED", at, seq: null },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        expect(st.orderCertain).toBe(false);
        expect(st.orderUncertainAt).toEqual([at.toISOString()]);
        // THE HISTORICAL READING IS LEFT EXACTLY AS IT WAS. `id ASC` still decides this pair, so the
        // state is what the pre-fix build produced. The uncertainty is DISCLOSED, never resolved
        // retroactively — resolving it would be inventing a chronology nobody recorded.
        expect(st.events.map((e) => e.transition)).toEqual(["ACTIVATED", "PROPOSED"]);
        expect(st.state).toBe("DRAFT");
      });

      it("E · at one timestamp, legacy rows sort BEFORE sequenced ones (NULLS FIRST)", async () => {
        const b = `pb-${uid()}`;
        const at = new Date("2026-01-01T00:00:00.000Z");
        await log.seed(b, "t", "1.0.0", [
          { id: `zzz-legacy-p-${b}`, transition: "PROPOSED", at, seq: null },
          { id: `aaa-new-a-${b}`, transition: "ACTIVATED", at, seq: 7n },
        ]);
        const st = await log.state(b, "t", "1.0.0");
        expect(st.events.map((e) => e.transition)).toEqual(["PROPOSED", "ACTIVATED"]);
        expect(st.state).toBe("ACTIVE");
        // One legacy row at this timestamp, so there is no legacy TIE: the order is certain.
        expect(st.orderCertain).toBe(true);
      });

      it("F · `seq` reaches no consumer — the event shape is unchanged", async () => {
        const b = `pb-${uid()}`;
        await log.seed(b, "t", "1.0.0", [
          { id: `fp-${b}`, transition: "PROPOSED", at: new Date("2026-01-01T00:00:00.000Z"), seq: 1n },
        ]);
        const events = await log.events(b, "t", "1.0.0");
        expect(Object.keys(events[0]!).sort()).toEqual(["actorId", "actorRole", "at", "rationale", "transition"]);
      });
    });
  }

  // ── G · THE DATABASE OBJECTS THE MIGRATION PROMISES ───────────────────────────────────────────────
  it("G · both sequences and both order indexes exist, and the identity indexes were KEPT", async () => {
    const seqs = await prisma.$queryRawUnsafe<{ sequencename: string }[]>(
      "select sequencename from pg_sequences where schemaname='public'",
    );
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      "select indexname from pg_indexes where schemaname='public'",
    );
    for (const log of LOGS) {
      expect(seqs.map((s) => s.sequencename)).toContain(log.seqName);
      expect(idx.map((i) => i.indexname)).toContain(log.orderIndex);
      // Dropping an index to tidy up is a performance change smuggled into a correctness fix.
      expect(idx.map((i) => i.indexname)).toContain(log.identityIndex);
    }
  });

  it("G2 · the column is NULLABLE with a sequence default — not BIGSERIAL", async () => {
    for (const log of LOGS) {
      const cols = await prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string | null }[]>(
        `select is_nullable, column_default from information_schema.columns
          where table_schema='public' and table_name=$1 and column_name='seq'`,
        log.table,
      );
      expect(cols).toHaveLength(1);
      // NULLABLE is what makes "no append order was recorded" representable at all.
      expect(cols[0]!.is_nullable).toBe("YES");
      expect(cols[0]!.column_default).toContain(`nextval('${log.seqName}'`);
    }
  });

  // ── H · NO HISTORICAL IDENTITY CAN MOVE ───────────────────────────────────────────────────────────
  it("H · no witness preimage contains an event, an event order or a `seq`", () => {
    // The structural half of "no historical proof is re-identified". If a hash preimage ever starts
    // reading the lifecycle log, this fails and the version question has to be answered deliberately.
    for (const f of [
      "src/contract/assessmentIdentity.ts", "src/contract/analysisTerms.ts",
      "src/contract/pilotDataContract.ts", "server/services/admissionPolicyHash.ts",
    ]) {
      let src: string;
      try { src = readFileSync(resolve(REPO, f), "utf8"); } catch { continue; }
      expect(src, `${f} names seq in a hash preimage`).not.toMatch(/\bseq\b/);
    }
  });

  it("H2 · the migration performs no UPDATE, no backfill and no BIGSERIAL", () => {
    const sql = readFileSync(
      resolve(REPO, "prisma/migrations/20261122090000_governance_event_append_sequence/migration.sql"),
      "utf8",
    );
    const statements = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/BIGSERIAL/i);
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bSET\s+"?seq"?\s*=/i);
    expect(statements).not.toMatch(/\bNOT\s+NULL\b/i);
    // And it really does what it claims, on both logs.
    for (const log of LOGS) {
      expect(statements).toContain(`CREATE SEQUENCE "${log.seqName}"`);
      expect(statements).toContain(`CREATE INDEX "${log.orderIndex}"`);
    }
  });

  it("H3 · neither store reads `seq` as anything but an ordering key", () => {
    for (const log of LOGS) {
      const src = readFileSync(resolve(REPO, log.source), "utf8");
      expect(src).toMatch(/orderBy: \[\{ at: "asc" \}, \{ seq: \{ sort: "asc", nulls: "first" \} \}, \{ id: "asc" \}\]/);
      // The random tie-breaker's claim is gone from the comment as well as from the code.
      expect(src).not.toMatch(/id breaks ties so ordering is total/);
    }
  });

  // ── I · LIVE UPGRADE AND ROLLBACK, ON A DISPOSABLE DATABASE ───────────────────────────────────────
  it("I · a LIVE UPGRADE leaves pre-existing rows at seq NULL — the only honest test of the legacy path",
    async () => {
      // ON ITS OWN DATABASE, which is not fastidiousness. This test rolls the migration BACK, writes
      // rows as the old build would, and rolls it forward again. Doing that on the shared test database
      // would drop a column out from under every other suite running beside it — a test that breaks its
      // neighbours is not isolated, and the failure would look like a product defect.
      //
      // A test that only ever sees a freshly-migrated database cannot observe the one property that
      // matters: that `ADD COLUMN seq BIGINT` rewrites no existing row.
      const base = process.env.DATABASE_URL!;
      const dbName = `govupgrade_synthetic_${uid()}`;
      const adminUrl = base.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
      const url = base.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
      const psqlOn = (target: string, args: string[]) =>
        execFileSync("psql", [target, "-v", "ON_ERROR_STOP=1", "-At", ...args], { encoding: "utf8" });

      psqlOn(adminUrl, ["-c", `CREATE DATABASE "${dbName}"`]);
      const client = new PrismaClient({ datasources: { db: { url } } });
      try {
        execFileSync("npx", ["prisma", "migrate", "deploy"], {
          env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", stdio: "pipe",
        });
        const down = resolve(REPO, "scripts/migration-design/governance-event-sequence-down.sql");
        const up = resolve(REPO, "prisma/migrations/20261122090000_governance_event_append_sequence/migration.sql");
        const b = `pb-upgrade-${uid()}`;

        // ── the rollback, proved ───────────────────────────────────────────────────────────────────
        psqlOn(url, ["-f", down]);
        for (const log of LOGS) {
          expect(psqlOn(url, ["-c", `select count(*) from information_schema.columns
              where table_name='${log.table}' and column_name='seq'`]).trim()).toBe("0");
          expect(psqlOn(url, ["-c",
            `select count(*) from pg_sequences where sequencename='${log.seqName}'`]).trim()).toBe("0");
          // The identity index and the append-only trigger are untouched by the rollback.
          expect(psqlOn(url, ["-c",
            `select count(*) from pg_indexes where indexname='${log.identityIndex}'`]).trim()).toBe("1");
        }

        // ── rows written by the OLD build, which had no column to write ────────────────────────────
        psqlOn(url, ["-c", `insert into "pilot_analysis_terms_events"
            (id, boundary_id, terms_id, terms_version, transition, actor_id, actor_role, rationale, at)
          values ('lp-${b}','${b}','t','1.0.0','PROPOSED','op','operator','r','2026-01-01T00:00:00Z'),
                 ('la-${b}','${b}','t','1.0.0','ACTIVATED','gov','steward','r','2026-01-02T00:00:00Z')`]);
        psqlOn(url, ["-c", `insert into "PilotAdmissionPolicyEventRecord"
            (id, boundary_id, policy_id, policy_version, transition, actor_id, actor_role, rationale, at)
          values ('lpp-${b}','${b}','p','1.0.0','PROPOSED','op','operator','r','2026-01-01T00:00:00Z'),
                 ('lpa-${b}','${b}','p','1.0.0','ACTIVATED','gov','steward','r','2026-01-02T00:00:00Z')`]);

        // ── the upgrade ───────────────────────────────────────────────────────────────────────────
        psqlOn(url, ["-f", up]);

        // NOT BACKFILLED. The rows written before the column existed still carry no append order,
        // which is the whole reason the column is nullable rather than BIGSERIAL.
        for (const log of LOGS) {
          expect(
            psqlOn(url, ["-c", `select count(*) from "${log.table}" where boundary_id='${b}' and seq is null`]).trim(),
            `${log.name} backfilled a pre-existing row`,
          ).toBe("2");
        }
        // And their derived state is exactly what it was before the upgrade.
        expect((await analysisTermsGovernanceState(b, "t", "1.0.0", client)).state).toBe("ACTIVE");
        expect((await policyGovernanceState(b, "p", "1.0.0", client)).state).toBe("ACTIVE");

        // A new append after the upgrade DOES receive one, and sorts after the legacy rows.
        await appendAnalysisTermsEvent({
          boundaryId: b, termsId: "t", termsVersion: "1.0.0", transition: "FROZEN",
          actorId: "gov", actorRole: "steward", rationale: "post-upgrade",
        }, client);
        const after = await analysisTermsGovernanceState(b, "t", "1.0.0", client);
        expect(after.events.map((e) => e.transition)).toEqual(["PROPOSED", "ACTIVATED", "FROZEN"]);
        expect(after.state).toBe("FROZEN");
        expect(after.orderCertain).toBe(true);
        expect(psqlOn(url, ["-c", `select count(*) from "pilot_analysis_terms_events"
            where boundary_id='${b}' and seq is not null`]).trim()).toBe("1");
      } finally {
        await client.$disconnect();
        psqlOn(adminUrl, ["-c", `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`]);
      }
    }, 120_000);
});
