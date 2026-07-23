#!/usr/bin/env node
// EP-1 · Domain-core purity guard (infra check — not shipped, not type-checked).
//
// The Constitution requires the domain core (src/domain) to be PURE and
// UI-independent. This guard fails (exit 1) if any production (non-test) domain
// file imports React, an app/UI layer, or seed data. It runs in CI so the core
// cannot be coupled to the UI "through the code" and the invariant cannot be
// weakened silently. Test files are exempt (they may import vitest and fixtures).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOMAIN_DIR = fileURLToPath(new URL("../src/domain/", import.meta.url));

const FORBIDDEN = [
  [/^react(-dom)?(\/.*)?$/, "React / UI runtime"],
  [/^\.\.\/modules(\/|$)/, "UI modules layer"],
  [/^\.\.\/components(\/|$)/, "UI components layer"],
  [/^\.\.\/state(\/|$)/, "UI state layer"],
  [/^\.\.\/hooks(\/|$)/, "UI hooks layer"],
  [/^\.\.\/lib(\/|$)/, "app lib layer"],
  [/^\.\.\/data(\/|$)/, "seed data / fixtures"],
];

const files = readdirSync(DOMAIN_DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
);

if (files.length === 0) {
  console.error("purity guard: no domain files found — check path");
  process.exit(2);
}

const importsOf = (code) => {
  const out = [];
  const re = /(?:from\s+|import\s+)["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
};

let violations = 0;
for (const file of files) {
  const code = readFileSync(DOMAIN_DIR + file, "utf8");
  for (const src of importsOf(code)) {
    for (const [re, reason] of FORBIDDEN) {
      if (re.test(src)) {
        console.error(`✗ ${file}: forbidden import "${src}" (${reason})`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\nDomain purity FAILED: ${violations} forbidden import(s). The core must stay pure and UI-independent.`,
  );
  process.exit(1);
}
console.log(`✓ domain purity OK — ${files.length} core files, no UI/app/seed imports.`);
