// The orchestrator command's entry point. I/O ONLY: argv in, stdout out, exit code set.
//
// Every claim worth testing lives in `command.ts`, which this file imports. Nothing here runs when that
// module is imported by a test — which is the point, and a defect this repository has already shipped once.
import { runOrchestratorCommand } from "./command.ts";

async function main(): Promise<void> {
  const result = await runOrchestratorCommand(process.argv.slice(2), process.env, new Date());
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  process.exit(result.exitCode);
}

void main().catch((err: unknown) => {
  // Our own bug is reported as ours. Blaming the input for a failure in our code is the NH-AX-1009 mistake.
  process.stdout.write(`NH_ORCHESTRATOR_INTERNAL_ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
