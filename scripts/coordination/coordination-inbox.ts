// `npm run coordination:inbox -- <issue>` — READ-ONLY entry point. I/O ONLY: argv in, streams out, one exit.
//
// Every claim worth testing lives in `inboxCommand.ts`, which this file imports and a test imports too.
// Nothing here runs when that module is imported, because nothing here is in that module.
//
// ONE EXIT, AND IT IS NOT INSIDE A `.catch()`. The defect this file used to carry was a promise chain whose
// `.catch()` called `process.exit(3)`: when the exit itself threw, the rejection had nowhere left to go and
// became the unhandled error that failed two CI jobs. The code is now computed first and the single
// `process.exit` is the last statement.
//
// IT READS BODIES AND REPORTS NONE. A comment body may hold anything a sender wrote; this is a delivery
// check, so only ids, hashes and counts are printed.
import { readFileSync } from "node:fs";

import { runInboxCommand } from "./inboxCommand.ts";

async function main(): Promise<void> {
  let code: number;
  try {
    const result = await runInboxCommand(process.argv.slice(2), process.env, {
      fetchImpl: fetch,
      readStdin: () => readFileSync(0, "utf8"),
    });
    for (const line of result.errLines) process.stderr.write(`${line}\n`);
    for (const line of result.lines) process.stdout.write(`${line}\n`);
    code = result.exitCode;
  } catch (error) {
    // Our own bug is reported as ours, and this branch does not exit — it sets the code like the other one.
    process.stderr.write(`NH_INTERNAL_ERROR — ${error instanceof Error ? error.message : String(error)}\n`);
    code = 3;
  }
  process.exit(code);
}

void main();
