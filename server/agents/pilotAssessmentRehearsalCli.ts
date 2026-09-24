import { prisma } from "../db";
import { runPilotAssessmentRehearsal } from "./pilotAssessmentRehearsal";

runPilotAssessmentRehearsal(process.env)
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "pilot assessment rehearsal failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
