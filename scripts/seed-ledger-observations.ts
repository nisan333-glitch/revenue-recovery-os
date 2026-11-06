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

/** One task + one event. `sequence` is explicit so a TIE can be written deliberately. */
async function writeTask(signals: readonly unknown[], sequence: bigint | null): Promise<void> {
  const taskId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_tasks (task_id, boundary_id, agent_id, idempotency_key, payload, status,
       attempt, not_before, fencing_epoch, result, created_at, updated_at)
     VALUES ($1, $2, 'ledger-journey-seed', $3, '{}'::jsonb, 'succeeded', 1, now(), 1, $4::jsonb, now(), now())`,
    taskId, boundaryId, randomUUID(), JSON.stringify(signals),
  );
  if (sequence === null) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, task_id, boundary_id, agent_id, fencing_epoch, attempt,
         kind, metadata, created_at)
       VALUES ($1, $2, $3, 'ledger-journey-seed', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), taskId, boundaryId,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_task_events (event_id, event_sequence, task_id, boundary_id, agent_id,
         fencing_epoch, attempt, kind, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'ledger-journey-seed', 1, 1, 'task.succeeded', '{}'::jsonb, now())`,
      randomUUID(), sequence, taskId, boundaryId,
    );
  }
}

async function main(): Promise<void> {
  // 1 · UPWARD correction: 600.00 then 800.00. Two events, so the order is establishable.
  await writeTask([signal(60_000, OBLIGATION_UP)], null);
  await writeTask([signal(80_000, OBLIGATION_UP)], null);

  // 2 · DOWNWARD correction: 600.00 then 200.00.
  await writeTask([signal(60_000, OBLIGATION_DOWN)], null);
  await writeTask([signal(20_000, OBLIGATION_DOWN)], null);

  // 3 · A TIE: two signals in ONE task, so both inherit one event sequence and the order of the two
  //     statements cannot be established. Written through the same tables, with an explicit sequence
  //     chosen above anything the sequence has handed out so it cannot collide with 1 and 2.
  const high = await prisma.$queryRawUnsafe<{ next: bigint }[]>(
    `SELECT (COALESCE(max(event_sequence), 0) + 1000)::bigint AS next FROM agent_task_events`,
  );
  await writeTask([signal(30_000, OBLIGATION_TIED), signal(90_000, OBLIGATION_TIED)], high[0]!.next);

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
