// WORKSTREAM A · QUANTIFYING THE MERGE — what actually happens to two distinct obligations of one
// customer, measured end to end on both paths.
//
// Pure: no database, no clock, no network. Everything here is VERIFIED CURRENT BEHAVIOUR.
//
// WHY THIS DESERVED ITS OWN FILE. The identity table says "two obligations of one customer are merged".
// That is the diagnosis; it is not the damage. The damage is different on each of the two paths into the
// Case lane, and one of them is reachable TODAY:
//
//   • the ASSESSMENT path SUMS them into one figure and then DROPS the count that would have disclosed
//     the merge — structurally unreachable today, because the identity gate refuses;
//   • the ACTIVATION path DISCARDS the second one's amount — live today.
//
// Discard is the worse of the two, and it is the reachable one. That asymmetry is the finding.
//
// ── CORRECTION, 2026-10-22 ───────────────────────────────────────────────────────────────────────
//
// Tests 5 and 6 below originally measured `CaseAdmissionService` + `InMemoryCaseCandidateStore` and
// concluded that the absorption is recorded NOWHERE. That is true of those two classes and FALSE of the
// deployed path, which does not use them: production goes
// `postgresTaskStore.succeed()` → `PostgresCandidateSignalWriter.writeWithin` → the returned
// `{admittedCount, createdCount}` merged into `agent_task_events.metadata`, a table that is append-only
// by database trigger and has no purge path anywhere.
//
// So I measured a non-production lane and reported its behaviour as the product's — "a capability in the
// benchmark lane is not a product capability", inverted. Tests 5 and 6 are now split: the in-memory
// behaviour is kept and LABELLED as such, and tests 5p/6p measure the writer that actually ships. The
// amount is still lost; what was wrong was the claim that nothing knows it happened.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { uid } from "../test/fixtures";
import { attributeByEntity } from "../../src/assessment/entityAttribution";
import { makePolicy } from "../../src/assessment/policy";
import type { ExpectationCycle } from "../../src/assessment/types";
import { CaseAdmissionService, InMemoryCaseCandidateStore, caseCandidateDedupeKey } from "./caseAdmission";
import type { CandidateSignal } from "./types";
import {
  leakInstanceIdentityStatus,
  OBLIGATION_IDENTITY_FIELDS,
} from "../../src/contract/leakInstanceIdentity";

const POLICY = makePolicy({ asOf: "2026-06-01", stallThresholdDays: 30, currency: "USD" });

/** One unpaid, overdue obligation. Two of these on one account is the whole scenario. */
const obligation = (cycleId: string, amountMinor: number, dueAt: string): ExpectationCycle =>
  Object.freeze({
    cycleId,
    sourceRowId: `row-${cycleId}`,
    entityId: "ACC-1", // ONE customer
    expectationAt: "2026-01-01",
    observationAt: null, // never activated ⇒ stalled
    monetaryEvent: {
      dueAt,
      amount: { minor: amountMinor, currency: "USD" },
      paidAt: null,
      paidAmount: null,
      refundedAt: null,
      cancelledAt: null,
    },
    currency: "USD",
    statusRaw: "active",
    attributes: {},
  }) as ExpectationCycle;

describe("A · the ASSESSMENT path SUMS two obligations, then drops the disclosure", () => {
  it("1 · two distinct obligations become ONE attribution carrying their SUM", () => {
    const result = attributeByEntity(
      [obligation("CYC-A", 40_000, "2026-02-01"), obligation("CYC-B", 60_000, "2026-03-01")],
      POLICY,
    );
    // Two obligations in. One attribution out.
    expect(result.attributions).toHaveLength(1);
    const only = result.attributions[0]!;
    expect(only.entityId).toBe("ACC-1");
    // $400.00 + $600.00 = $1,000.00 presented as a single at-risk figure.
    expect(only.amountAtRisk.minor).toBe(100_000);
    // The count EXISTS here — the schema comment says it is kept "so one figure is never mistaken for
    // one invoice". Test 2 is about where it stops existing.
    expect(only.contributingCycleCount).toBe(2);
  });

  it("2 · and the count is DROPPED before a candidate is built — the disclosure never ships", () => {
    // `SignalLineage` in `governedSignalEmitter.ts` has no `contributingCycleCount`, and
    // `CandidateSignal` has no such field either. So the safeguard exists at the layer that does not
    // need it and is absent at the layer that does — the `coverage.event` shape, one lane over.
    const signalFields: readonly (keyof CandidateSignal)[] = [
      "signalId", "boundaryId", "recoveryType", "sourceRef", "sourcePayloadHash",
      "detectorVersion", "observedAt", "amountAtRiskMinor", "currency", "actionAvailable",
      "expectedProofEvent",
    ];
    expect(signalFields).not.toContain("contributingCycleCount" as never);
    // Stated as the consequence rather than as a field list: a Recovery Case opened from this path
    // carries a summed amount and NOTHING anywhere downstream says how many obligations it covers.
    expect(signalFields.some((f) => /count|cycles|obligations/i.test(f))).toBe(false);
  });

  it("3 · a SINGLE obligation is indistinguishable from a merged pair by amount alone", () => {
    // Why the missing count is not cosmetic: the two cases are identical on the wire.
    const merged = attributeByEntity(
      [obligation("CYC-A", 40_000, "2026-02-01"), obligation("CYC-B", 60_000, "2026-03-01")],
      POLICY,
    ).attributions[0]!;
    const single = attributeByEntity([obligation("CYC-C", 100_000, "2026-02-01")], POLICY).attributions[0]!;
    expect(merged.amountAtRisk.minor).toBe(single.amountAtRisk.minor);
    expect(merged.entityId).toBe(single.entityId);
    // Only the field that does not travel tells them apart.
    expect(merged.contributingCycleCount).not.toBe(single.contributingCycleCount);
  });
});

describe("A · the ACTIVATION path discards the second obligation's amount — in-memory lane, NOT production", () => {
  const signal = (over: Partial<CandidateSignal>): CandidateSignal =>
    Object.freeze({
      signalId: `ACT-${"a".repeat(32)}`,
      boundaryId: "pb-1",
      recoveryType: "ActivationMissed",
      sourceRef: `hmac-sha256:${"b".repeat(64)}`, // ONE account
      sourcePayloadHash: "c".repeat(64),
      detectorVersion: "activation-deadline-v1",
      observedAt: "2026-06-01T00:00:00.000Z",
      amountAtRiskMinor: 40_000,
      currency: "USD",
      actionAvailable: true,
      expectedProofEvent: "activation followed by next invoice paid",
      ...over,
    });

  it("4 · two distinct obligations of one account collide on the dedupe key", () => {
    // The key is `(boundaryId, recoveryType, sourceRef)` — the obligation is not in it, so two genuinely
    // different leaks for one customer are one key.
    const first = signal({ amountAtRiskMinor: 40_000, signalId: `ACT-${"1".repeat(32)}` });
    const second = signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` });
    expect(caseCandidateDedupeKey(second)).toBe(caseCandidateDedupeKey(first));
  });

  it("5 · THE DAMAGE · the second obligation's amount is DISCARDED, not summed and not reported", async () => {
    // NOTE: `CaseAdmissionService` + `InMemoryCaseCandidateStore` are NOT the deployed path. See the
    // correction in the header and tests 5p/6p for what production records.
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };

    const first = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 40_000, signalId: `ACT-${"1".repeat(32)}` }),
      policy,
    );
    const second = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` }),
      policy,
    );

    expect(first.admitted && first.created).toBe(true);
    // The second is ADMITTED — it passed every gate — and then absorbed.
    expect(second.admitted).toBe(true);
    if (!second.admitted || !first.admitted) throw new Error("both submissions must be admitted");
    expect(second.created).toBe(false);

    // THE MEASUREMENT. The surviving candidate carries the FIRST amount. The second obligation's
    // $600.00 is not summed, not held, not flagged — it exists nowhere.
    expect(second.candidate.signal.amountAtRiskMinor).toBe(40_000);
    expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
    // And this is WORSE than the assessment path's summation: there, $1,000.00 is at least present
    // under one label. Here $600.00 of observed exposure is simply gone.
  });

  it("6 · in THIS lane the discard is invisible in the candidate — but see 5p: production records it", async () => {
    const store = new InMemoryCaseCandidateStore();
    const service = new CaseAdmissionService(store, () => new Date("2026-06-01T00:00:00.000Z"));
    const policy = { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 };
    await service.submit("activation-deadline-v1", signal({ signalId: `ACT-${"1".repeat(32)}` }), policy);
    const second = await service.submit(
      "activation-deadline-v1",
      signal({ amountAtRiskMinor: 60_000, signalId: `ACT-${"2".repeat(32)}` }),
      policy,
    );
    if (!second.admitted) throw new Error("admitted");
    // `created: false` is returned to the CALLER and is not persisted on the CANDIDATE. A reviewer opening
    // the queue still sees one candidate at $400.00 — true in production too, because the queue reads
    // `agent_case_candidates` and never `agent_task_events`. What IS recorded lives on the task event.
    expect(Object.keys(second.candidate)).not.toContain("absorbedCount");
    expect(JSON.stringify(second.candidate)).not.toContain("60000");
  });
});

describe("A · what is NOT exposed today — the bound on the risk", () => {
  it("7 · the assessment path cannot reach a case at all, so it has created no merged case", () => {
    // Stated so the risk is sized honestly rather than dramatised. `deriveStagedAttributions` refuses at
    // `leakInstanceIdentityStatus()`, which is unconditionally false while `OBLIGATION_IDENTITY_FIELDS`
    // is empty — so no staged row and therefore no emitted candidate has ever existed on that path.
    // The activation path above is the live one, and its merge is the one that matters commercially.
    //
    // This is a structural fact, re-derived here rather than cited: the status predicate reads only the
    // declared field list and nothing about any dataset.
    expect(OBLIGATION_IDENTITY_FIELDS).toHaveLength(0);
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
    expect(leakInstanceIdentityStatus().reason).toBe("leak_instance_identity_unavailable");
  });
});

// ── THE PRODUCTION LANE · what the deployed path actually records ─────────────────────────────────
//
// Postgres-backed, because the evidence IS the database. Skips without DATABASE_URL.
describe.skipIf(!process.env.DATABASE_URL)("A · production · absorption IS recorded, and the amount is still lost", () => {
  const policies = new Map([["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }]]);

  /** Two observations of ONE account that differ in amount — the merge scenario, production shapes. */
  const prodSignal = (boundaryId: string, sourceRef: string, amountAtRiskMinor: number, seed: string) =>
    Object.freeze({
      signalId: `ACT-${seed.repeat(32).slice(0, 32)}`,
      boundaryId,
      recoveryType: "ActivationMissed",
      sourceRef,
      sourcePayloadHash: seed.repeat(64).slice(0, 64),
      detectorVersion: "activation-deadline-v1",
      observedAt: "2026-06-01T00:00:00.000Z",
      amountAtRiskMinor,
      currency: "USD",
      actionAvailable: true,
      expectedProofEvent: "activation followed by next invoice paid",
    });

  it("5p · the SECOND signal is admitted and `createdCount` is 0 — the absorption is a returned fact", async () => {
    const { PostgresCandidateSignalWriter } = await import("./postgresCandidateSignalWriter");
    const writer = new PostgresCandidateSignalWriter(policies);
    const boundaryId = `TEST-merge-${uid()}`;
    const sourceRef = `hmac-sha256:${createHash("sha256").update(boundaryId).digest("hex")}`;

    // The writer takes a transaction-scoped SQL client. Prisma's raw result IS the row array, so
    // `rowCount` is derived from its length exactly as the store's own client does.
    const run = async (signal: ReturnType<typeof prodSignal>) =>
      writer.writeWithin(
        {
          query: async (sql: string, params: readonly unknown[]) => {
            const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as unknown[];
            return { rows, rowCount: rows.length } as never;
          },
        } as never,
        { taskId: `T-${uid()}`, boundaryId, agentId: "activation-deadline-v1", signals: [signal] },
      );

    const first = await run(prodSignal(boundaryId, sourceRef, 40_000, "1"));
    expect(first.admittedCount).toBe(1);
    expect(first.createdCount).toBe(1);

    // A DIFFERENT observation — different signalId, different payload hash, different amount — for the
    // SAME account. It clears the admission gate and creates nothing.
    const second = await run(prodSignal(boundaryId, sourceRef, 60_000, "2"));
    expect(second.admittedCount).toBe(1);
    expect(second.createdCount).toBe(0);

    // THE CORRECTION, stated as an assertion: `admittedCount >= 1 && createdCount === 0` IS the record
    // that a signal passed the gate and was swallowed. `postgresTaskStore` merges exactly this object
    // into `agent_task_events.metadata`, which is append-only by trigger and has no purge path.
    expect(second.admittedCount >= 1 && second.createdCount === 0).toBe(true);

    // And the amount is still lost: one candidate, carrying the FIRST figure.
    const stored = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
    expect(stored).toHaveLength(1);
    expect((stored[0]!.signal as { amountAtRiskMinor: number }).amountAtRiskMinor).toBe(40_000);
  });

  it("6p · the absorption fact is on the TASK EVENT, never on the candidate — both halves asserted", async () => {
    // Why the queue still cannot show it without new work: the review queue reads
    // `agent_case_candidates` and never joins `agent_task_events`. The evidence exists and no screen
    // reads it — which is exactly why the disclosure says "not checked" rather than "none".
    const candidateColumns = Object.keys(
      (await prisma.agentCaseCandidateRecord.findFirst()) ?? {
        candidateId: "", dedupeKey: "", boundaryId: "", agentId: "", signal: {},
        status: "", submittedAt: new Date(), persistedAt: new Date(),
      },
    );
    for (const absent of ["absorbedCount", "observationCount", "contributingCycleCount"]) {
      expect(candidateColumns).not.toContain(absent);
    }
    // The event table is where it lands, and it is append-only: a row cannot be edited or removed.
    const trigger = await prisma.$queryRawUnsafe<{ tgname: string }[]>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'agent_task_events'::regclass AND NOT tgisinternal`,
    );
    const names = trigger.map((t) => t.tgname);
    expect(names).toContain("agent_task_events_no_update");
    expect(names).toContain("agent_task_events_no_delete");
  });
});
