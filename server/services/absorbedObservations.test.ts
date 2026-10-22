// Falsifiers for the obligation-merge exposure diagnostic.
//
// EVERY ONE OF THESE DEMONSTRATES BEHAVIOUR, NOT WORDING. The three-state distinction is proved by feeding
// the three inputs and reading three different verdicts; the privacy property is proved by attempting the
// leak with values taken from the row rather than hardcoded; and the grouping is held against the REAL
// dedupe key so the two cannot drift apart.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ABSORBED_OBSERVATIONS_SCHEME,
  accountGrainedGroup,
  formatAbsorptionReport,
  readSucceededRows,
  summariseAbsorption,
  type RawSucceededRow,
  type SucceededTaskRow,
} from "./absorbedObservations";
import { caseCandidateDedupeKey } from "../agents/caseAdmission";
import type { CandidateSignal } from "../agents/types";

const FACTS = { recoveryType: "ActivationMissed", sourceRef: "crm:account-1", sourcePayloadHash: "a".repeat(64) };

function row(over: Partial<SucceededTaskRow> = {}): SucceededTaskRow {
  return {
    boundaryId: "tenant-1",
    agentId: "activation-agent",
    admittedCount: 1,
    createdCount: 1,
    signals: [FACTS],
    ...over,
  };
}

describe("absorbed observations · the three states stay distinguishable", () => {
  it("a candidate created for every admitted signal is NO_ABSORPTION_RECORDED", () => {
    const report = summariseAbsorption([row({ admittedCount: 1, createdCount: 1 })]);
    expect(report.verdict).toBe("NO_ABSORPTION_RECORDED");
    expect(report.totals.eventsWithAbsorption).toBe(0);
    expect(report.boundaries[0]!.eventsWithCandidateCreated).toBe(1);
  });

  it("admitted with NOTHING created is ABSORPTION_RECORDED", () => {
    const report = summariseAbsorption([row({ admittedCount: 1, createdCount: 0 })]);
    expect(report.verdict).toBe("ABSORPTION_RECORDED");
    expect(report.totals.eventsWithAbsorption).toBe(1);
  });

  it("ABSENT COUNTS ARE NOT ZERO — the defect a default would have introduced", () => {
    // A `task.succeeded` whose metadata carries no `admittedCount` means the candidate publisher was not
    // wired when that task ran. Coalescing the missing key to 0 would make this read as
    // NO_ABSORPTION_RECORDED — a clean result asserting a population was checked when nobody checked it.
    const report = summariseAbsorption([row({ admittedCount: null, createdCount: null })]);
    expect(report.verdict).toBe("NOT_ESTABLISHABLE");
    expect(report.boundaries[0]!.eventsWithoutAdmissionCounts).toBe(1);
    expect(report.boundaries[0]!.eventsWithCandidateCreated).toBe(0);
    expect(report.boundaries[0]!.eventsWithAbsorption).toBe(0);
    // And the three are reported as three numbers, so no reader can recover a clean verdict from them.
    expect(formatAbsorptionReport(report)).toMatch(/NOT ESTABLISHABLE, not zero/);
  });

  it("an EMPTY database is NOT_ESTABLISHABLE, never a pass", () => {
    // The one outcome that would make this diagnostic worse than not existing: reporting success having
    // examined nothing. An empty local database is evidence about that database and nothing else.
    const report = summariseAbsorption([]);
    expect(report.verdict).toBe("NOT_ESTABLISHABLE");
    expect(formatAbsorptionReport(report)).toMatch(/An empty local database says nothing about a deployed one/);
  });

  it("a recorded absorption OUTRANKS unreadable events — the fail-closed order", () => {
    // A positive finding must never be hidden behind "some events could not be read".
    const report = summariseAbsorption([
      row({ admittedCount: null, createdCount: null }),
      row({ admittedCount: 1, createdCount: 0 }),
    ]);
    expect(report.verdict).toBe("ABSORPTION_RECORDED");
    expect(report.totals.eventsWithoutAdmissionCounts).toBe(1);
  });
});

describe("absorbed observations · a replay is not a second obligation", () => {
  it("the SAME observation digest absorbed twice contributes nothing to the differing count", () => {
    // `createdCount = 0` also describes an idempotent replay of one observation under a fresh task key.
    // This is the number that separates the two, and a replay must not inflate it.
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 0 }),
      row({ admittedCount: 1, createdCount: 0 }),
    ]);
    expect(report.totals.eventsWithAbsorption).toBe(2);
    expect(report.boundaries[0]!.accountIdentitiesAbsorbing).toBe(1);
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(0);
    expect(report.boundaries[0]!.distinctObservationDigests).toBe(0);
  });

  it("a DIFFERING digest on the same account identity is the strongest available evidence", () => {
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 0 }),
      row({ admittedCount: 1, createdCount: 0, signals: [{ ...FACTS, sourcePayloadHash: "b".repeat(64) }] }),
    ]);
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(1);
    expect(report.boundaries[0]!.distinctObservationDigests).toBe(2);
  });

  it("and it still does NOT claim two obligations were merged", () => {
    const rendered = formatAbsorptionReport(
      summariseAbsorption([
        row({ admittedCount: 1, createdCount: 0 }),
        row({ admittedCount: 1, createdCount: 0, signals: [{ ...FACTS, sourcePayloadHash: "b".repeat(64) }] }),
      ]),
    );
    // The last step — observations to obligations — is an inference the stored data cannot make.
    expect(rendered).toMatch(/no column in this database identifies an obligation/);
    expect(rendered).toMatch(/never a count of merged obligations/);
    expect(rendered).not.toMatch(/obligations were merged/);
  });

  it("THE ORDINARY MERGE · one observation creates, a DIFFERENT one is absorbed", () => {
    // The exact shape the end-to-end production run produces, and the one an earlier form of this module
    // scored as zero: only one digest is ever on the absorbed side, so comparing absorbed digests against
    // each other found nothing. The comparison must span the created event too.
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 1, signals: [{ ...FACTS, sourcePayloadHash: "a".repeat(64) }] }),
      row({ admittedCount: 1, createdCount: 0, signals: [{ ...FACTS, sourcePayloadHash: "b".repeat(64) }] }),
    ]);
    expect(report.verdict).toBe("ABSORPTION_RECORDED");
    expect(report.boundaries[0]!.eventsWithCandidateCreated).toBe(1);
    expect(report.boundaries[0]!.eventsWithAbsorption).toBe(1);
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(1);
    expect(report.boundaries[0]!.distinctObservationDigests).toBe(2);
  });

  it("…and a REPLAY of the created observation still scores zero differing", () => {
    // The negative control for the test above: widening the comparison must not turn an idempotent
    // replay into a second obligation.
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 1 }),
      row({ admittedCount: 1, createdCount: 0 }),
    ]);
    expect(report.verdict).toBe("ABSORPTION_RECORDED");
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(0);
    expect(report.boundaries[0]!.distinctObservationDigests).toBe(0);
  });

  it("a boundary where every signal created its own candidate counts NO differing identity", () => {
    // Digests are recorded for created events too, so this is the guard that recording them did not
    // start reporting ordinary distinct accounts as evidence of a merge.
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 1, signals: [{ ...FACTS, sourcePayloadHash: "a".repeat(64) }] }),
      row({ admittedCount: 1, createdCount: 1, signals: [{ ...FACTS, sourcePayloadHash: "b".repeat(64) }] }),
    ]);
    expect(report.verdict).toBe("NO_ABSORPTION_RECORDED");
    expect(report.boundaries[0]!.accountIdentitiesAbsorbing).toBe(0);
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(0);
  });

  it("a different ACCOUNT is a different identity, not an absorption into the same one", () => {
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 0 }),
      row({ admittedCount: 1, createdCount: 0, signals: [{ ...FACTS, sourceRef: "crm:account-2" }] }),
    ]);
    expect(report.boundaries[0]!.accountIdentitiesAbsorbing).toBe(2);
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(0);
  });
});

describe("absorbed observations · the grouping cannot drift from the real dedupe key", () => {
  it("two signals share a group if and only if they share the production dedupe key", () => {
    // The module groups by the key's own PREIMAGE rather than importing the digest, because it never needs
    // the key's value. This holds the two together: were `caseCandidateDedupeKey` to gain or drop a
    // component, one of these four pairs would disagree.
    const base: CandidateSignal = {
      signalId: "signal-1",
      boundaryId: "tenant-1",
      recoveryType: "ActivationMissed",
      sourceRef: "crm:account-1",
      sourcePayloadHash: "a".repeat(64),
      detectorVersion: "activation@1",
      observedAt: "2026-09-13T00:00:00.000Z",
      amountAtRiskMinor: 50_000,
      currency: "USD",
      actionAvailable: true,
      expectedProofEvent: "invoice paid",
    };
    const variants: readonly CandidateSignal[] = [
      base,
      // Same account, DIFFERENT observation content: same key, same group — this IS the merge.
      { ...base, signalId: "signal-2", sourcePayloadHash: "b".repeat(64), amountAtRiskMinor: 90_000 },
      { ...base, sourceRef: "crm:account-2" },
      { ...base, boundaryId: "tenant-2" },
    ];
    for (const left of variants) {
      for (const right of variants) {
        const sameKey = caseCandidateDedupeKey(left) === caseCandidateDedupeKey(right);
        const sameGroup =
          accountGrainedGroup(left.boundaryId, left) === accountGrainedGroup(right.boundaryId, right);
        expect(sameGroup).toBe(sameKey);
      }
    }
  });
});

describe("absorbed observations · nothing customer-identifying is printed", () => {
  it("the account reference and the content digest are READ, grouped, and never rendered", () => {
    // The leak attempt uses distinctive values and the forbidden strings are taken FROM the row, so this
    // guard cannot drift from what the module is actually given.
    const sourceRef = "crm:acct-NORTHWIND-PLC-0042";
    const sourcePayloadHash = "f0e1d2c3".repeat(8);
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 0, signals: [{ ...FACTS, sourceRef, sourcePayloadHash }] }),
      row({
        admittedCount: 1,
        createdCount: 0,
        signals: [{ ...FACTS, sourceRef, sourcePayloadHash: "9".repeat(64) }],
      }),
    ]);
    const rendered = formatAbsorptionReport(report);

    // It genuinely used them — otherwise this would prove nothing at all.
    expect(report.boundaries[0]!.accountIdentitiesWithDifferingObservations).toBe(1);

    expect(rendered).not.toContain(sourceRef);
    expect(rendered).not.toContain("NORTHWIND");
    expect(rendered).not.toContain(sourcePayloadHash);
    expect(rendered).not.toContain("9".repeat(64));
    // Nor does the report OBJECT the CLI could print instead carry them.
    expect(JSON.stringify(report)).not.toContain(sourceRef);
    expect(JSON.stringify(report)).not.toContain(sourcePayloadHash);
  });

  it("no amount or currency figure is rendered, because an amount is the customer's money", () => {
    const rendered = formatAbsorptionReport(summariseAbsorption([row({ admittedCount: 1, createdCount: 0 })]));
    expect(rendered).not.toMatch(/\$/);
    expect(rendered).not.toMatch(/\bUSD\b/);
    expect(rendered).not.toMatch(/\d+\.\d{2}/);
  });

  it("the boundary and agent labels ARE printed — they are ours and the finding must be routable", () => {
    const rendered = formatAbsorptionReport(summariseAbsorption([row({ admittedCount: 1, createdCount: 0 })]));
    expect(rendered).toContain("tenant-1");
    expect(rendered).toContain("activation-agent");
    expect(rendered).toContain(ABSORBED_OBSERVATIONS_SCHEME);
  });
});

describe("absorbed observations · the diagnostic is structurally read-only", () => {
  const summary = readFileSync(`${process.cwd()}/server/services/absorbedObservations.ts`, "utf8");
  const cli = readFileSync(`${process.cwd()}/scripts/exposure/absorbed-observations.ts`, "utf8");

  function importSpecifiers(source: string): readonly string[] {
    // IMPORT SPECIFIERS ONLY. A prose mention is not a dependency and a string literal is not an import —
    // the lesson this repository has now recorded eleven times against its own guards.
    return [...source.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]!);
  }

  it("the summary module imports NOTHING that can reach a database, a clock or a disk", () => {
    expect(importSpecifiers(summary)).toEqual([]);
    for (const forbidden of ["prisma", "pg", "node:fs", "node:crypto", "../db"]) {
      expect(importSpecifiers(summary)).not.toContain(forbidden);
    }
  });

  it("neither file contains a write statement", () => {
    // Read as SQL verbs rather than as words, so a sentence about not deleting cannot trip it and a real
    // statement cannot hide. The guard is asserted to FIRE first, because a guard that cannot fire is no
    // guard at all.
    const write = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i;
    expect(write.test("INSERT INTO agent_task_events (event_id) VALUES ($1)")).toBe(true);
    expect(write.test(summary)).toBe(false);
    expect(write.test(cli)).toBe(false);
  });

  it("the CLI is I/O ONLY — its imports are prisma and the pure module, nothing more", () => {
    // It calls `main()` at module scope, so importing it would RUN the command: that is exactly how the
    // end-to-end test below failed with "Engine is not yet connected" when the scan lived here. Keeping
    // the logic in the import-free module and the side effects here satisfies both halves of *a command
    // whose claims cannot be imported cannot be falsified* without a self-invocation guard.
    expect(importSpecifiers(cli).sort()).toEqual([
      "../../server/db",
      "../../server/services/absorbedObservations",
    ]);
    expect(cli).not.toMatch(/writeFileSync|createWriteStream|appendFileSync|mkdirSync/);
    expect(cli).toMatch(/main\(\)/);
  });

  it("the SELECT lives in the pure module, where a test can read it", () => {
    expect(summary).toMatch(/SELECT ev\.boundary_id/);
    expect(summary).toMatch(/LEFT JOIN agent_tasks/);
    // A missing metadata key must stay NULL. Coalescing it to zero is the defect the module exists to
    // avoid, so the absence of that coalesce is asserted rather than described.
    expect(summary).not.toMatch(/COALESCE\s*\(\s*ev\.metadata/i);
  });
});

describe("absorbed observations · the rendering puts the answer first and hides nothing", () => {
  it("TOTALS precede the per-boundary detail", () => {
    // Found by running the command for real: it printed 67 boundaries and put the three numbers that
    // matter underneath them, so an operator scrolls past the finding to reach the finding.
    const rendered = formatAbsorptionReport(
      summariseAbsorption([row({ admittedCount: 1, createdCount: 0 }), row({ boundaryId: "tenant-2" })]),
    );
    expect(rendered.indexOf("TOTALS:")).toBeGreaterThan(-1);
    expect(rendered.indexOf("TOTALS:")).toBeLessThan(rendered.indexOf("── boundary"));
  });

  it("a boundary with NOTHING to report is collapsed to a COUNT, never dropped", () => {
    const report = summariseAbsorption([
      row({ admittedCount: 1, createdCount: 0 }),
      row({ boundaryId: "tenant-clean-a" }),
      row({ boundaryId: "tenant-clean-b" }),
    ]);
    // The pure report keeps every boundary — only the rendering collapses, so no consumer loses data.
    expect(report.boundaries).toHaveLength(3);
    const rendered = formatAbsorptionReport(report);
    expect(rendered).toMatch(/2 further boundaries: every admitted signal created its own candidate/);
    expect(rendered).toMatch(/nothing suppressed/);
    expect(rendered).not.toContain("tenant-clean-a");
    // And a boundary that cannot be read is NOT collapsed, because that is a finding of its own.
    const unreadable = formatAbsorptionReport(
      summariseAbsorption([row({ boundaryId: "tenant-dark", admittedCount: null, createdCount: null })]),
    );
    expect(unreadable).toContain("tenant-dark");
  });
});

// ── END TO END ON THE REAL TABLES · the production chain, not a fixture ───────────────────────────
//
// The diagnostic's whole claim is that absorption is derivable from what the DEPLOYED path already
// writes. A fixture cannot establish that: it would prove the summary function works on shapes I chose.
// So this drives the real `PostgresAgentTaskStore` with the real `PostgresCandidateSignalWriter` as its
// success sink, twice for ONE account, and then reads the answer back out of Postgres with the CLI's own
// query. Skips without DATABASE_URL, and a skip is visible rather than silent.
describe.skipIf(!process.env.DATABASE_URL)("absorbed observations · end to end on the production path", () => {
  it("two observations of ONE account leave a readable absorption in the database", async () => {
    const { prisma } = await import("../db");
    const { createPostgresAgentTaskStore } = await import("../agents/prismaTaskDatabase");
    const { PostgresCandidateSignalWriter } = await import("../agents/postgresCandidateSignalWriter");
    const { createHash } = await import("node:crypto");

    const boundaryId = `TEST-absorb-${Math.random().toString(36).slice(2, 10)}`;
    const agentId = "activation-deadline-v1";
    const sourceRef = `hmac-sha256:${createHash("sha256").update(boundaryId).digest("hex")}`;
    const store = createPostgresAgentTaskStore(
      prisma,
      new PostgresCandidateSignalWriter(
        new Map([["ActivationMissed", { recoveryType: "ActivationMissed", economicThresholdMinor: 10_000 }]]),
      ),
    );

    // Two observations of one account that DIFFER in amount and in content digest — the merge scenario.
    const signal = (amountAtRiskMinor: number, seed: string) =>
      Object.freeze({
        signalId: `ACT-${seed.repeat(32).slice(0, 32)}`,
        boundaryId,
        recoveryType: "ActivationMissed",
        sourceRef,
        sourcePayloadHash: seed.repeat(64).slice(0, 64),
        detectorVersion: agentId,
        observedAt: "2026-06-01T00:00:00.000Z",
        amountAtRiskMinor,
        currency: "USD",
        actionAvailable: true,
        expectedProofEvent: "activation followed by next invoice paid",
      });

    const runOnce = async (taskId: string, idempotencyKey: string, result: readonly unknown[]) => {
      const now = Date.now();
      await store.enqueueIfAbsent({ taskId, boundaryId, agentId, idempotencyKey, payload: { sourceRef }, now });
      const claimed = await store.claimDue({ boundaryId, agentId, workerId: "w1", now, leaseMs: 30_000, maxAttempts: 3 });
      if (!claimed?.leaseToken) throw new Error("task was not claimed");
      await store.succeed({
        taskId: claimed.taskId,
        boundaryId,
        workerId: "w1",
        leaseToken: claimed.leaseToken,
        now,
        result: result as never,
      });
    };

    await runOnce(`T1-${boundaryId}`, "k1", [signal(40_000, "1")]);
    await runOnce(`T2-${boundaryId}`, "k2", [signal(60_000, "2")]);

    // Read it back exactly as the command does, then narrow to this boundary so a shared CI database
    // cannot make the assertion pass or fail for unrelated reasons.
    const rows = await readSucceededRows(
      (sql) => prisma.$queryRawUnsafe(sql) as Promise<readonly RawSucceededRow[]>,
    );
    const mine = rows.filter((r) => r.boundaryId === boundaryId);
    expect(mine).toHaveLength(2);

    const report = summariseAbsorption(mine);
    expect(report.verdict).toBe("ABSORPTION_RECORDED");
    const b = report.boundaries.find((x) => x.boundaryId === boundaryId)!;
    expect(b.eventsWithCandidateCreated).toBe(1); // the first observation created the candidate
    expect(b.eventsWithAbsorption).toBe(1); // the second was admitted and created nothing
    expect(b.eventsWithoutAdmissionCounts).toBe(0); // the publisher was wired, so the counts are present
    expect(b.accountIdentitiesWithDifferingObservations).toBe(1); // and the digests DIFFER — not a replay

    // The money that was absorbed is NOT in the diagnostic's output, and this is the point of the slice:
    // only one candidate exists, carrying the FIRST amount. $600.00 of observed exposure is in no
    // candidate, no case and no figure any screen renders.
    const candidates = await prisma.agentCaseCandidateRecord.findMany({ where: { boundaryId } });
    expect(candidates).toHaveLength(1);
    expect((candidates[0]!.signal as { amountAtRiskMinor: number }).amountAtRiskMinor).toBe(40_000);
    const rendered = formatAbsorptionReport(report);
    expect(rendered).not.toContain("60000");
    expect(rendered).not.toContain(sourceRef);
  });
});
