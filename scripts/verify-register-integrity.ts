// `npm run verify:registers` — a read-only integrity sweep over both governed registers.
//
// Exits NONZERO when any record fails, so it is usable as a gate. It writes nothing: a sweep that could
// repair would be a sweep that could launder, and a witness whose disagreement can be quietly resolved
// is not a witness.
//
// NO DATABASE IS A FAILURE, not a pass. A sweep that reports success having checked nothing is the one
// outcome that would make it worse than not existing.
import { prisma } from "../server/db";
import { sweepRegisterIntegrity, sweepPassed, type SweptRecord } from "../server/services/registerIntegritySweep";

function line(record: SweptRecord): string {
  const { integrity } = record;
  return [
    `  ${integrity.status.padEnd(12)} ${record.register} ${record.ref}  (boundary ${record.boundaryId})`,
    `      stored   ${integrity.storedHash}`,
    `      computed ${integrity.computedHash ?? "— not computable from the stored values"}`,
    `      ${integrity.detail ?? ""}`,
  ].join("\n");
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error("register integrity: DATABASE_URL is not set, so NOTHING was checked.");
    console.error("A sweep that reports success having checked nothing is worse than no sweep. Set it and re-run.");
    return 2;
  }

  const report = await sweepRegisterIntegrity();
  for (const [register, counts] of Object.entries(report.byRegister)) {
    console.log(`── ${register}: ${counts.checked} record(s), ${counts.failures} failing`);
  }

  if (sweepPassed(report)) {
    console.log(
      report.checked === 0
        ? "\nregister integrity: both registers are EMPTY — nothing to verify, and nothing reported as verified."
        : `\nregister integrity verified — all ${report.checked} governed record(s) hash to their stored witness.`,
    );
    return 0;
  }

  console.error(`\n${report.failures.length} of ${report.checked} governed record(s) FAILED integrity:\n`);
  for (const record of report.failures) console.error(line(record));
  console.error(
    "\nNothing was repaired, and nothing here can repair it. A stored witness that no longer matches its\n" +
      "values means the record changed after it was blessed. Investigate the record and the migration that\n" +
      "touched it; do not re-register over it, which would replace the evidence rather than explain it.\n" +
      "A failing record already judges nothing and cannot be put in force; freezing or retiring it works.",
  );
  return 1;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("register integrity: the sweep itself failed to complete.");
    console.error(error instanceof Error ? error.message : String(error));
    await prisma.$disconnect();
    process.exit(3);
  });
