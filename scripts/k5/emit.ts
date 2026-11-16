// THE COMMAND. argv, filesystem and stdout live here and nowhere else; the rendering lives in
// `renderChecklist.ts` and is tested directly.
//
// UNCONDITIONAL, NOT GUARDED. A `process.argv[1]` self-invocation guard never fires under `vite-node`,
// which is how this repository runs every script — so a guarded command is a command that does nothing.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderK5Checklist } from "./renderChecklist";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = resolve(REPO, "docs/K5_EVIDENCE_CHECKLIST_V1.md");
writeFileSync(OUT, renderK5Checklist(), "utf8");
console.log(`wrote docs/K5_EVIDENCE_CHECKLIST_V1.md (${renderK5Checklist().length} bytes)`);
