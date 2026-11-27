// VERIFY THE RULER · read-only. Never rewrites the lock.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK = resolve(HERE, "FREEZE.lock.json");
if (!existsSync(LOCK)) { console.error("REFUSED: no FREEZE.lock.json — the harness is not frozen"); process.exit(1); }
const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let bad = 0;
for (const [name, expected] of Object.entries(lock.scripts)) {
  const p = resolve(HERE, name);
  if (!existsSync(p)) { console.error(`MISSING  ${name}`); bad += 1; continue; }
  const actual = sha(p);
  if (actual !== expected) { console.error(`CHANGED  ${name}\n  expected ${expected}\n  actual   ${actual}`); bad += 1; }
}
const composite = createHash("sha256")
  .update(JSON.stringify(Object.keys(lock.scripts).map((n) => [n, lock.scripts[n]])))
  .digest("hex");
if (composite !== lock.compositeSha256) { console.error("CHANGED  the lock's own composite digest"); bad += 1; }
if (bad > 0) { console.error(`\n${bad} problem(s) — the ruler moved since the freeze. A result measured with it is not comparable.`); process.exit(1); }
console.log(`verified · ${Object.keys(lock.scripts).length} harness scripts match the tracked freeze lock · composite ${composite}`);
