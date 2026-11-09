// THE COMMAND. argv, stdout and the exit code live here and nowhere else; the claims live in
// `serverTestRatchet.ts` and `serverTestBaseline.ts`, which import-run nothing and are tested directly.
//
// UNCONDITIONAL, NOT GUARDED. A `process.argv[1]` self-invocation guard never fires under `vite-node`,
// which is how this repository runs every script — so a guarded command is a command that does nothing.
import { runServerTestTypecheck } from "./serverTestRatchet";

const result = runServerTestTypecheck(process.cwd());
for (const line of result.lines) console.log(line);
process.exit(result.ok ? 0 : 1);
