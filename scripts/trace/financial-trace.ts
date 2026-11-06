// `npm run trace:case -- <recoveryCaseId>` — READ-ONLY. One obligation, end to end, with its evidence.
//
// EVERY BIT OF I/O IS HERE AND NOTHING ELSE IS. The decision logic is `runTraceCommand` in
// `traceCommand.ts`, the assembly is `server/services/financialTraceRead.ts` and the rendering is
// `renderFinancialTrace`, which is pure. `main()` runs at module scope, so argv, the environment, stdout
// and the exit code must stay here: a command whose claims cannot be imported cannot be falsified.
//
// WHY A COMMAND AND NOT A SCREEN. The owner's goal for this slice is REPRODUCIBLE financial evidence
// rather than a screen showing amounts, and what makes it reproducible is the canonical form and its
// digest: two runs over the same records print the same digest, and a reader can re-derive it from the
// canonical string. A screen can come later and will render this same object; what it must never do is
// become the only place the evidence exists.
import { prisma } from "../../server/db";
import { runTraceCommand } from "./traceCommand";

async function main(): Promise<number> {
  const { exitCode, output } = await runTraceCommand({
    argv: process.argv.slice(2),
    env: process.env,
  });
  if (exitCode === 0) console.log(output);
  else console.error(output);
  return exitCode;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`NH_INTERNAL_ERROR — ${error instanceof Error ? error.message : String(error)}`);
    await prisma.$disconnect();
    process.exit(3);
  });
