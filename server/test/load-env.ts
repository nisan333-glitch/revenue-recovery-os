// EP-2 test setup: populate DATABASE_URL from the local (gitignored) .env if present.
// When no .env / DATABASE_URL exists (e.g. CI without Postgres), the persistence
// tests skip themselves via describe.skipIf, so the default suite stays portable.
import { readFileSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env — tests that need a DB will skip
  }
}
