// EP-17 · Run the input retention policy once and print an auditable report.
//
// Prints every verdict, including the retained ones. A retention job that reports only what it deleted
// cannot be audited, because "nothing was eligible" and "the job never ran" look identical in a log.
// Exits non-zero when no policy is configured, so a scheduler surfaces the unconfigured state instead
// of recording a successful run that deleted nothing.
import { prisma } from "../db";
import { purgeEligibleInputs } from "./pilotInputRetention";
import { isBackendRole, type ActorContext } from "../auth/identity";

function actorFromEnvironment(env: Readonly<Record<string, string | undefined>>): ActorContext {
  const actorId = env.NH_PURGE_ACTOR_ID?.trim();
  const role = env.NH_PURGE_ACTOR_ROLE?.trim();
  if (!actorId || !isBackendRole(role)) {
    throw new Error("NH_PURGE_ACTOR_ID and NH_PURGE_ACTOR_ROLE are required (the role must hold PurgeAssessmentInput)");
  }
  const boundaries = (env.NH_PURGE_BOUNDARIES ?? "").split(",").map((b) => b.trim()).filter(Boolean);
  if (boundaries.length === 0) {
    throw new Error("NH_PURGE_BOUNDARIES is required — a purge is always scoped to boundaries it names");
  }
  return { actorId, role, boundaryIds: Object.freeze(boundaries) };
}

async function main(): Promise<void> {
  const actor = actorFromEnvironment(process.env);
  // One run per named boundary, so a purge can never quietly span tenants.
  const reports = [];
  for (const boundaryId of actor.boundaryIds ?? []) {
    reports.push(await purgeEligibleInputs(actor, { boundaryId }));
  }
  const unconfigured = reports.some((r) => r.policy === null);
  const incomplete = reports.filter((r) => r.reachedPurgeLimit);
  process.stdout.write(`${JSON.stringify({ reports }, null, 2)}\n`);
  // Said in plain words, not only as a JSON field: a run that spent its budget is a normal outcome,
  // but an operator who does not notice it will think the queue is empty when it is not.
  for (const report of incomplete) {
    process.stderr.write(
      `note: purge limit reached after ${report.purged} record(s); more may be eligible — run again\n`,
    );
  }
  if (unconfigured) {
    throw new Error("no retention policy is configured; nothing was purged");
  }
}

main()
  .catch((error: unknown) => {
    // Includes InputRetentionFailure, whose message names the execution it stopped on and how many
    // records were purged first — the two things needed to know what state the data is in.
    console.error(error instanceof Error ? error.message : "input retention run failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
