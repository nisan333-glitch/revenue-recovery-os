// `npm run exposure:absorbed` — READ-ONLY. Did this database already swallow an observation?
//
// EVERY BIT OF I/O IS HERE AND NOTHING ELSE IS. The scan, the three-state summary, the rendering and the
// exit-code rule live in `server/services/absorbedObservations.ts`, which imports NOTHING — so the thing
// that computes the verdict is structurally incapable of touching a database, a clock or a disk, and a
// test can import and falsify every claim it makes. This file holds `prisma`, `process.env`, stdout and
// `process.exit`, because `main()` runs at module scope and those side effects must not fire on import.
//
// WHY A SCRIPT AND NOT A ROUTE. The question is forensic: answering it needs a content join over
// `agent_tasks.result` jsonb, which is unindexed and unbounded, and the answer is for an operator
// investigating their own estate rather than for a screen. A governed read surface able to run an
// unindexed whole-table scan is a different thing with a different owner. `RecoveryCaseView` and the
// candidate queue therefore report `absorbedObservations: { checked: false }` and name this command —
// which is honest: they did not look, and "not checked" is not "none".
//
// AN EMPTY RESULT IS NOT A PASS. `NOT_ESTABLISHABLE` is a first-class verdict and exit code 2, and it is
// what an empty database returns. Never read a quiet local run as evidence that a deployed estate is
// unaffected.
//
// NOTHING CUSTOMER-IDENTIFYING IS PRINTED. `sourceRef` is an account identifier and `sourcePayloadHash` a
// content digest; both are read, grouped and counted, and neither is ever rendered.
import { prisma } from "../../server/db";
import { runAbsorbedObservations, type RawSucceededRow } from "../../server/services/absorbedObservations";

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("absorbed observations: DATABASE_URL is not set, so NOTHING was examined.");
    console.error("An unexamined database is not an unaffected one. Set it and re-run.");
    return 2;
  }
  const { exitCode, output } = await runAbsorbedObservations(
    (sql) => prisma.$queryRawUnsafe(sql) as Promise<readonly RawSucceededRow[]>,
  );
  console.log(output);
  return exitCode;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    // Our own failure is reported as ours. Blaming the data for a claim we made is the `NH-AX-1009`
    // mistake, and a diagnostic that misattributes its own crash is worse than one that does not run.
    console.error("absorbed observations: the scan itself failed to complete. NOTHING was established.");
    console.error(error instanceof Error ? error.message : String(error));
    await prisma.$disconnect();
    process.exit(3);
  });
