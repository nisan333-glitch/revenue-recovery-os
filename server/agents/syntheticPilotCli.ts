import { prisma } from "../db";
import { runSyntheticPilot } from "./syntheticPilot";

runSyntheticPilot(process.env)
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "synthetic pilot failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
