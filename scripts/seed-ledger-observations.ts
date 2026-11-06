// SEEDER for the Correction Ledger browser journey.
//
// It writes succeeded-task rows and their append-only events DIRECTLY, which is the honest shape for
// this harness: the production detector emits ONE signal per candidate per run, so producing a tied
// append sequence — two observations of one identity sharing one event — cannot be arranged by running
// the detector. The ledger's job is to read whatever the tables hold, so the tables are what this
// seeds.
//
// EVERY REFERENCE IT WRITES IS A PSEUDONYM in the form the signal contract requires, so nothing here
// smuggles a value the production boundary would refuse.
//
// Usage: vite-node scripts/seed-ledger-observations.ts <boundaryId>
// Prints JSON describing exactly what it wrote, so the journey asserts against the seeder's own report
// rather than against numbers restated in two places.
import { randomUUID } from "node:crypto";
import { prisma } from "../server/db";

const boundaryId = process.argv[2];
if (!boundaryId || !boundaryId.trim()) {
  console.error("usage: seed-ledger-observations.ts <boundaryId>");
  process.exit(2);
}

const ACCOUNT = `hmac-sha256:${"a".repeat(64)}`;
/** Three identities, one per ledger state the screen must render. */
const OBLIGATION_UP = `hmac-sha256:${"1".repeat(64)}`;
const OBLIGATION_DOWN = `hmac-sha256:${"2".repeat(64)}`;
const OBLIGATION_TIED = `hmac-sha256:${"3".repeat(64)}`;

const signal = (amountAtRiskMinor: number, obligationRef: string) => ({
  recoveryType: "RevenueUnderBilled",
  sourceRef: ACCOUNT,
  amountAtRiskMinor,
  currency: "USD",
  obligationCoverage: { kind: "SINGLE_OBLIGATION", obligationRef },
});

/**
 * One task + one event, with the sequence ALLOCATED BY THE DATABASE in every case.
 *
 * THE TIE NEEDS NO EXPLICIT SEQUENCE, and believing it did cost a real failure. An earlier form of this
 * seeder wrote the tied pair with `max(event_sequence) + 1000` over the WHOLE TABLE, to put it "above
 * anything the sequence has handed out". That was unnecessary — two signals in ONE task result inherit
 * that one event's sequence whatever its value, which is exactly what makes them tied — and it was
 * harmful: on a database where another test had already planted a sequence near the safe-integer
 * ceiling, `max + 1000` exceeded `Number.MAX_SAFE_INTEGER`, and `observationsFromRows` then correctly
 * REFUSED the whole boundary ("event sequence cannot be ordered safely"). The journey read zero records
 * and three checks failed, on a product that was behaving exactly as designed.
 *
 * TWO LESSONS, AND THE SECOND IS THE GENERAL ONE. A fixture that computes a value from the whole
 * table's state behaves differently depending on every other test that ever ran against that database.
 * And this hid in CI precisely because CI's database is nearly empty — the journey job runs migrations
 * and the journeys and nothing else — so the inverse of "a test CI never runs is not a guard" also
 * holds: a test that has only ever run against a pristine database is not a guard against a real one.
 */
async function writeTask(signals: readonly unknown[]): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'ledger-journey-seed', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(), JSON.stringify(signals),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
       kind, metadata, created_at)
     VALUES ($1, $2, $3, 'ledger-journey-seed', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
    randomUUID(), taskId, boundaryId,
  );
}

async function main(): Promise<void> {
  // 1 · UPWARD correction: 600.00 then 800.00. Two events, so the order is establishable.
  await writeTask([signal(60_000, OBLIGATION_UP)]);
  await writeTask([signal(80_000, OBLIGATION_UP)]);

  // 2 · DOWNWARD correction: 600.00 then 200.00.
  await writeTask([signal(60_000, OBLIGATION_DOWN)]);
  await writeTask([signal(20_000, OBLIGATION_DOWN)]);

  // 3 · A TIE: two signals in ONE task, so both inherit that one event's sequence and the order of the
  //     two statements cannot be established. The sequence is the database's own — the tie comes from
  //     the two signals sharing one event row, not from the number on it.
  await writeTask([signal(30_000, OBLIGATION_TIED), signal(90_000, OBLIGATION_TIED)]);

  console.log(JSON.stringify({
    boundaryId,
    upward: { storedMinor: 60_000, latestMinor: 80_000, magnitudeMinor: 20_000 },
    downward: { storedMinor: 60_000, latestMinor: 20_000, magnitudeMinor: 40_000 },
    tied: { amountsMinor: [30_000, 90_000] },
    expectedIdentities: 3,
    expectedWithCorrections: 2,
    expectedOrderNotEstablishable: 1,
  }));
  await prisma.$disconnect();
}

await main();
