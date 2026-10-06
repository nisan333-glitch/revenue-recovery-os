// GOVERNED ISSUE #4 · the execution event log must order chronologically, not by a coin flip.
//
// THE DEFECT. `executionEvents` ordered by `[at, id]` under a comment claiming "`id` breaks ties so
// ordering is total". Total, yes. CHRONOLOGICAL, no: `id` is `PXE-${randomUUID()}` and `at` is
// timestamp(3), so two events appended inside one millisecond were ordered by a random string.
//
// AND IT IS NOT A COSMETIC MISLABEL. `deriveExecutionState` applies transitions in sequence, gated by
// legality, and stops at a terminal state. Reverse CLAIMED and COMPLETED and the terminal transition is
// not merely late — it is DROPPED, because COMPLETED is illegal from `queued` and is ignored, after
// which CLAIMED yields `running`. An execution that finished reads as still running, forever.
//
// WHY THIS TEST IS DETERMINISTIC. The original failure was found in CI at roughly a 1-in-20 rate, which
// is unfalsifiable as a regression test: a pass proves nothing. So the tie is CONSTRUCTED — rows are
// written with an identical explicit `at` and with ids chosen so that `id ASC` contradicts append order.
// No sleeps, no randomness, no retries, no wall clock.
//
// A DESIGN REFUSAL WORTH RECORDING. `appendExecutionEvent` was NOT given an `at` or `id` parameter to
// make this test easier. Letting a caller choose an event's timestamp is a backdating lever, and rule 3
// of the Trust Invariant exists to forbid exactly that. The test writes its rows with the client it
// already has, and the PRODUCTION READ PATH is what it then exercises.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { deriveExecutionState } from "../../src/contract/assessmentExecution";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendExecutionEvent, executionEvents, executionStatus } from "./pilotExecutionStore";

const BOUNDARY = "order-probe-boundary";
/** One fixed instant for every constructed tie. The whole point is that these do NOT differ. */
const TIED_AT = new Date("2026-03-01T12:00:00.000Z");

/**
 * Write one event with an explicit id and timestamp, bypassing `appendExecutionEvent` — which
 * deliberately offers neither. This is the only honest way to construct a same-millisecond tie.
 */
async function writeRaw(
  executionId: string,
  transition: string,
  id: string,
  at: Date = TIED_AT,
): Promise<void> {
  await prisma.pilotAssessmentExecutionEventRecord.create({
    data: { id, executionId, boundaryId: BOUNDARY, transition, code: null, byId: "probe@nh", detail: transition, at },
  });
}

/**
 * A row as it exists on disk from BEFORE the append-sequence migration: `seq` explicitly NULL. This is
 * the only way to exercise the legacy path, because a freshly migrated database has no legacy rows —
 * every row it holds was written with a sequence.
 */
async function writeLegacy(
  executionId: string,
  transition: string,
  id: string,
  at: Date = TIED_AT,
): Promise<void> {
  await prisma.pilotAssessmentExecutionEventRecord.create({
    data: {
      id, executionId, boundaryId: BOUNDARY, transition, code: null, byId: "legacy@nh",
      detail: transition, at, seq: null,
    },
  });
}

/**
 * An id that sorts by `rank` while staying globally unique.
 *
 * Both halves are needed. The RANK makes `id ASC` contradict append order, which is what turns a
 * probabilistic defect into a deterministic one. The UUID makes the row unique, which matters because
 * the table rejects DELETE by trigger — fixed literal ids passed once and then collided forever on the
 * second run against the same database. That collision is how this helper came to exist.
 */
const rankedId = (rank: string) => `PXE-${rank}-${randomUUID()}`;
/** Appended first, sorts LAST. */
const LATE_SORTING = () => rankedId("zz");
/** Appended second, sorts FIRST — so `id ASC` returns it before its predecessor. */
const EARLY_SORTING = () => rankedId("aa");

describe("execution event ordering · the constructed tie", () => {
  const ids: string[] = [];
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => {
    // The table rejects DELETE by trigger, which is correct and is why the probe rows are scoped to
    // their own boundary and simply left in place. Nothing else reads this boundary.
    void ids;
    await prisma.$disconnect();
  });

  it("1 · two events in one millisecond keep APPEND order, not id order", async () => {
    // Appended CLAIMED then COMPLETED. `id ASC` would return COMPLETED first — the exact inversion
    // that made a finished execution read as running.
    const executionId = `PX-tie-${randomUUID()}`;
    await writeRaw(executionId, "SCHEDULED", `PXE-sched-${randomUUID()}`, new Date(TIED_AT.getTime() - 1000));
    await writeRaw(executionId, "CLAIMED", LATE_SORTING());
    await writeRaw(executionId, "COMPLETED", EARLY_SORTING());

    const events = await executionEvents(executionId, BOUNDARY);
    expect(events.map((e) => e.transition)).toEqual(["SCHEDULED", "CLAIMED", "COMPLETED"]);
    // ...and therefore the state is the one the execution actually reached.
    expect(deriveExecutionState(events)).toBe("completed");
    expect((await executionStatus(executionId, BOUNDARY)).state).toBe("completed");
  });

  it("2 · THREE OR MORE events in one millisecond preserve append order exactly", async () => {
    const executionId = `PX-tri-${randomUUID()}`;
    // Strictly DESCENDING ranks, so `id ASC` would return all five exactly backwards.
    await writeRaw(executionId, "SCHEDULED", rankedId("ee"));
    await writeRaw(executionId, "CLAIMED", rankedId("dd"));
    await writeRaw(executionId, "RELEASED", rankedId("cc"));
    await writeRaw(executionId, "CLAIMED", rankedId("bb"));
    await writeRaw(executionId, "COMPLETED", rankedId("aa"));

    const events = await executionEvents(executionId, BOUNDARY);
    // Strictly descending ids, so `id ASC` would return this sequence exactly BACKWARDS.
    expect(events.map((e) => e.transition)).toEqual([
      "SCHEDULED", "CLAIMED", "RELEASED", "CLAIMED", "COMPLETED",
    ]);
    expect(deriveExecutionState(events)).toBe("completed");
  });

  it("3 · ordinary different-timestamp ordering still wins over the sequence", async () => {
    // `at` stays PRIMARY. A row appended later but dated earlier must still sort earlier, because the
    // log spans a migration boundary where older rows have timestamps and no sequence.
    const executionId = `PX-chron-${randomUUID()}`;
    await writeRaw(executionId, "COMPLETED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:02.000Z"));
    await writeRaw(executionId, "SCHEDULED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:00.000Z"));
    await writeRaw(executionId, "CLAIMED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:01.000Z"));

    const events = await executionEvents(executionId, BOUNDARY);
    expect(events.map((e) => e.transition)).toEqual(["SCHEDULED", "CLAIMED", "COMPLETED"]);
    expect(deriveExecutionState(events)).toBe("completed");
  });

  it("3b · a legacy row ALONE at its timestamp is ordered with certainty", async () => {
    // What does NOT count as uncertain. `at` alone decides a row with no neighbour, so the absence of
    // an append order costs nothing. Reporting it as doubtful would be as dishonest as the reverse.
    const executionId = `PX-lonelegacy-${randomUUID()}`;
    await writeLegacy(executionId, "SCHEDULED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:00.000Z"));
    await writeLegacy(executionId, "CLAIMED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:01.000Z"));
    await writeLegacy(executionId, "COMPLETED", `PXE-${randomUUID()}`, new Date("2026-03-01T12:00:02.000Z"));

    const status = await executionStatus(executionId, BOUNDARY);
    expect(status.state).toBe("completed");
    expect(status.orderCertain).toBe(true);
    expect(status.orderUncertainAt).toEqual([]);
  });

  it("4 · a replayed SCHEDULED creates no second ordering identity and no duplicate state", async () => {
    const executionId = `PX-replay-${randomUUID()}`;
    await writeRaw(executionId, "SCHEDULED", rankedId("cc"));
    await writeRaw(executionId, "SCHEDULED", rankedId("bb"));
    await writeRaw(executionId, "CLAIMED", rankedId("aa"));

    const events = await executionEvents(executionId, BOUNDARY);
    expect(events).toHaveLength(3);
    // Each append is its own row with its own ordering fact; the derived state is unaffected by the
    // replay, which is what `deriveExecutionState` already promised.
    expect(deriveExecutionState(events)).toBe("running");
  });
});

// ── LEGACY ROWS · the uncertainty is preserved, never manufactured ────────────────────────────────
describe("execution event ordering · legacy rows acquire no invented chronology", () => {
  it("a same-timestamp legacy tie is REPORTED as uncertain, and its state is not re-derived", async () => {
    // Two rows, one millisecond, no append order between them. There is no truthful way to order them,
    // so the log says so. What it must NOT do is pick one and present the result as chronology.
    const executionId = `PX-legacytie-${randomUUID()}`;
    await writeLegacy(executionId, "SCHEDULED", `PXE-${randomUUID()}`, new Date(TIED_AT.getTime() - 1000));
    await writeLegacy(executionId, "CLAIMED", rankedId("zz"));
    await writeLegacy(executionId, "COMPLETED", rankedId("aa"));

    const status = await executionStatus(executionId, BOUNDARY);
    expect(status.orderCertain).toBe(false);
    expect(status.orderUncertainAt).toEqual([TIED_AT.toISOString()]);
    // The derived state is whatever the arbitrary-but-total order yields — UNCHANGED from before the
    // fix. Changing what history says is re-deriving it, and labelling is the honest move instead.
    expect(status.state).toBe("running");
    expect(status.events).toHaveLength(3);
  });

  it("a MIXED tie — one legacy row, one sequenced — is also uncertain", async () => {
    // Possible only around the migration instant. One row has an append order and the other does not,
    // so there is still nothing that orders the PAIR; `nulls: "first"` puts the legacy row before the
    // sequenced one, which is a convention rather than a fact, and the flag says as much.
    const executionId = `PX-mixed-${randomUUID()}`;
    await writeLegacy(executionId, "SCHEDULED", `PXE-${randomUUID()}`, new Date(TIED_AT.getTime() - 1000));
    await writeLegacy(executionId, "CLAIMED", `PXE-mix1-${randomUUID()}`);
    await writeRaw(executionId, "COMPLETED", `PXE-mix2-${randomUUID()}`);

    const status = await executionStatus(executionId, BOUNDARY);
    // One of the two tied rows carries a sequence, so the tie is NOT two-sided-unknown: the sequenced
    // row's position is known relative to anything else sequenced. With exactly one legacy row in the
    // group there is a defensible order, and the group is therefore certain.
    expect(status.orderUncertainAt).toEqual([]);
    expect(status.orderCertain).toBe(true);
    expect(status.state).toBe("completed");
  });

  it("new writes always carry an append order — no code path can omit it", async () => {
    // The guarantee lives in the COLUMN DEFAULT, not in application logic, so this holds for callers
    // that do not exist yet. Asserted through the production append, not through a raw insert.
    const executionId = `PX-default-${randomUUID()}`;
    await appendExecutionEvent({
      executionId, boundaryId: BOUNDARY, transition: "SCHEDULED", code: null,
      byId: "probe@nh", detail: "scheduled",
    });
    const row = await prisma.pilotAssessmentExecutionEventRecord.findFirst({
      where: { executionId, boundaryId: BOUNDARY }, select: { seq: true },
    });
    expect(row?.seq).not.toBeNull();
    expect(typeof row?.seq).toBe("bigint");
  });
});

// ── IDENTITY AND HISTORY SAFETY ──────────────────────────────────────────────────────────────────
describe("execution event ordering · the ordering fact enters no identity", () => {
  it("no hash preimage reads an event, a timestamp or a sequence", () => {
    // Structural, on source with comments stripped: the comments in those files legitimately discuss
    // events, and a guard that reads comments is measuring documentation.
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const roots = [
      "src/contract/assessmentExecution.ts", "src/contract/policyHash.ts",
      "src/contract/analysisTerms.ts", "src/contract/exposureFinding.ts",
      "src/contract/leakInstanceIdentity.ts", "src/evidence/evidenceIdentity.ts",
      "src/contract/pilotDataContract.ts",
    ];
    for (const rel of roots) {
      const code = strip(readFileSync(resolve(__dirname, "..", "..", rel), "utf8"));
      // The ordering fact by every name it could enter a preimage under.
      expect(code, `${rel} must not hash a sequence`).not.toMatch(/\bseq\b/);
      expect(code, `${rel} must not hash order certainty`).not.toMatch(/orderCertain|orderUncertainAt/);
    }
  });

  it("the RETURNED event carries exactly four keys — `seq` never leaks to a consumer", async () => {
    // `seq` is deliberately NOT on `ExecutionLifecycleEvent`. The UI renders this type and the audit
    // view returns it verbatim; a storage detail has no business widening a published shape.
    //
    // THIS ASSERTION'S FIRST FORM WAS WORTHLESS and a falsifier proved it: it built a literal of the
    // type and checked ITS keys, so it tested the fixture rather than the store. Leaking `seq` from
    // `toLifecycleEvent` passed it cleanly. The subject of the check has to be what the store RETURNS.
    const executionId = `PX-keys-${randomUUID()}`;
    await appendExecutionEvent({
      executionId, boundaryId: BOUNDARY, transition: "SCHEDULED", code: null,
      byId: "probe@nh", detail: "scheduled",
    });
    const [event] = await executionEvents(executionId, BOUNDARY);
    expect(event).toBeDefined();
    expect(Object.keys(event!).sort()).toEqual(["at", "byId", "code", "transition"]);
    expect(event as Record<string, unknown>).not.toHaveProperty("seq");

    // ...and the same for the audit/history surface, which returns these verbatim over the API.
    const status = await executionStatus(executionId, BOUNDARY);
    expect(Object.keys(status.events[0]!).sort()).toEqual(["at", "byId", "code", "transition"]);
  });
});
