// EP-10 · Runs after `tsc -p tsconfig.server.json`. The root package.json declares
// "type": "module", but the server build compiles to CommonJS (so it can `require()`
// its own files without explicit ".js" extensions and needs no runtime transform) —
// this marker overrides that for just the dist-server/ output, as Node's module
// resolution requires.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "dist-server", "package.json");
writeFileSync(outFile, JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
console.log(`wrote ${outFile}`);
