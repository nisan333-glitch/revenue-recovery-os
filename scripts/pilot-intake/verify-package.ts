// VERIFY THE CUSTOMER-READY PILOT INTAKE PACKAGE.
//
// This package is the first artefact in the repository that is meant to LEAVE it, so the failure mode is
// different from everything else: a drifted column, a fabricated reference or a stray zero does not break
// a test here — it reaches a customer's data owner, who gathers the wrong thing and discovers it weeks
// later at reconciliation. The $89.70 transport defect taught the same lesson one layer in: an artefact
// derived from a governed definition by hand drifts silently, and the drift is only visible once someone
// has already acted on the stale version.
//
// So the strongest proofs here do not inspect the package with a bespoke checker. They run the EXAMPLES
// THROUGH THE REAL VALIDATORS and the REAL readiness evaluator, which is the same code a customer's file
// will meet. An example that would be rejected in practice fails this build instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXPECTATION_EXTRACT_COLUMNS } from "../../src/contract/expectationExtract";
import { validateExpectationExtract, type RawExpectationRow } from "../../src/contract/expectationExtractValidator";
import { SETTLEMENT_EXTRACT_COLUMNS } from "../../src/contract/settlementExtract";
import { validateSettlementExtract, type RawSettlementRow } from "../../src/contract/settlementExtractValidator";
import { evaluateDataReadiness } from "../../src/contract/dataReadiness";
import { EXPECTATION_EXAMPLE, SETTLEMENT_EXAMPLE, UNKNOWN_AMOUNT_OBLIGATION } from "./examples";

const DIR = "docs/pilot-intake";
const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail = "") => checks.push({ ok, label, detail });

const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");
const parseCsv = (text: string) => {
  const lines = text.split("\n").filter((l) => l !== "");
  const pa = (l: string): string[] => {
    const o: string[] = []; let c = "", q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i]!;
      if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i += 1; } else if (ch === '"') q = false; else c += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch;
    }
    o.push(c); return o;
  };
  const cols = pa(lines[0]!);
  return { cols, rows: lines.slice(1).map((l) => Object.fromEntries(pa(l).map((c, i) => [cols[i]!, c]))) };
};

// ── 1 · template headers exactly equal the governed column lists, in order ──────────────────────
for (const [name, cols] of [
  ["expectation_template.csv", EXPECTATION_EXTRACT_COLUMNS],
  ["settlement_template.csv", SETTLEMENT_EXTRACT_COLUMNS],
] as const) {
  const header = read(name).trim();
  check(header === cols.join(","), `${name} · header is exactly the governed schema, in order`,
    header === cols.join(",") ? "" : `got "${header.slice(0, 80)}…"`);
  check(read(name).trim().split("\n").length === 1, `${name} · headers ONLY, no data rows`);
}
check(read("settlement_template.csv").includes("obligation_ref"),
  "settlement_template.csv · obligation_ref is present, per the accepted readiness contract");

// ── 2 · the examples carry only declared columns and pass their own validators ───────────────────
const eCsv = parseCsv(read("expectation_example.csv"));
const sCsv = parseCsv(read("settlement_example.csv"));
check(eCsv.cols.join(",") === EXPECTATION_EXTRACT_COLUMNS.join(","), "expectation_example.csv · declared columns only, in order");
check(sCsv.cols.join(",") === SETTLEMENT_EXTRACT_COLUMNS.join(","), "settlement_example.csv · declared columns only, in order");

const eVal = validateExpectationExtract(
  eCsv.cols,
  eCsv.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) as RawExpectationRow[],
  { currency: "USD" },
);
const sVal = validateSettlementExtract(
  sCsv.cols,
  sCsv.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) as RawSettlementRow[],
  { currency: "USD" },
);
check(eVal.usable && eVal.extractFaults.length === 0, "expectation_example.csv · no extract fault", JSON.stringify(eVal.extractFaults));
check(sVal.usable && sVal.extractFaults.length === 0, "settlement_example.csv · no extract fault", JSON.stringify(sVal.extractFaults));
check(eVal.rejections.length === 0, "expectation_example.csv · every row ACCEPTED by the real validator",
  eVal.rejections.map((r) => `${r.rowNumber}:${r.code}`).join(" "));
check(sVal.rejections.length === 0, "settlement_example.csv · every row ACCEPTED by the real validator",
  sVal.rejections.map((r) => `${r.rowNumber}:${r.code}`).join(" "));

// ── 3 · the example pair reaches L2 through the real readiness evaluator ────────────────────────
const readiness = evaluateDataReadiness(eVal, sVal);
check(readiness.level === "L2_MONETARY_RECONCILIATION_POSSIBLE",
  "the example pair reaches L2 — a joinable, reconcilable package", `level=${readiness.level}`);
check(readiness.danglingObligationRefs === 0,
  "every example obligation_ref resolves to a stated obligation — the join is demonstrated", `dangling=${readiness.danglingObligationRefs}`);
check(readiness.expectation.monetaryQuantification === "PARTIAL",
  "...and stops at L2 because one obligation is deliberately unpriced", readiness.expectation.monetaryQuantification);
check(readiness.provisional === true && readiness.authority.reached === "SOURCE_NATIVE",
  "the example package is PROVISIONAL and claims no verified authority", readiness.authority.reached);
check(readiness.settlement.creditRows === 1, "the credit is recognised as a credit, not a charge", `${readiness.settlement.creditRows}`);

// ── 4 · the generated documents have not drifted from the governed definitions ───────────────────
{
  const dict = read("FIELD_DICTIONARY.md");
  const missing = [...EXPECTATION_EXTRACT_COLUMNS, ...SETTLEMENT_EXTRACT_COLUMNS]
    .filter((c) => !dict.includes(`### \`${c}\``));
  check(missing.length === 0, "FIELD_DICTIONARY.md · every governed field has an entry", missing.join(", "));
  // ...and no entry for a field that does not exist.
  const entries = [...dict.matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1]!);
  const governed = new Set([...EXPECTATION_EXTRACT_COLUMNS, ...SETTLEMENT_EXTRACT_COLUMNS]);
  const invented = entries.filter((e) => !governed.has(e));
  check(invented.length === 0, "FIELD_DICTIONARY.md · documents NO field the contracts do not declare", invented.join(", "));

  const request = read("PILOT_DATA_REQUEST_V1.md");
  const absent = [...EXPECTATION_EXTRACT_COLUMNS, ...SETTLEMENT_EXTRACT_COLUMNS].filter((c) => !request.includes(`\`${c}\``));
  check(absent.length === 0, "PILOT_DATA_REQUEST_V1.md · every governed field appears", absent.join(", "));
  check(request.includes("Generated from the governed definitions"), "PILOT_DATA_REQUEST_V1.md · declares itself generated");
}

// ── 5 · no direct personal data anywhere in the examples ────────────────────────────────────────
{
  // SCANNED PER CELL, not over the whole file. The first form matched the file text and reported two
  // "phone-like values" that were ISO DATES — `2026-01-01` is ten characters of digits and hyphens. An
  // apparatus error read as a finding, which is the defect class this repository has met before, so the
  // scan now excludes cells that are valid dates, amounts or flags before asking whether they look personal.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const AMOUNT = /^-?\d+(?:\.\d{1,2})?$/;
  const patterns: [RegExp, string][] = [
    [/@/, "an email-like value"],
    [/^\+?[\d ()-]{9,}$/, "a phone-like value"],
    [/^[A-Z]{1,2}\d{1,2} ?\d[A-Z]{2}$/, "a postcode-like value"],
    [/\b(?:Mr|Mrs|Ms|Dr)\b/, "a personal title"],
  ];
  const hits: string[] = [];
  for (const { rows } of [eCsv, sCsv]) {
    for (const r of rows) {
      for (const [k, raw] of Object.entries(r)) {
        const v = (raw ?? "").trim();
        if (v === "" || ISO_DATE.test(v) || AMOUNT.test(v) || v === "true" || v === "false") continue;
        for (const [re, what] of patterns) if (re.test(v)) hits.push(`${what} in ${k}="${v}"`);
      }
    }
  }
  check(hits.length === 0, "examples carry NO direct personal data", hits.join(", "));
  const nameCols = [...EXPECTATION_EXTRACT_COLUMNS, ...SETTLEMENT_EXTRACT_COLUMNS]
    .filter((c) => /name|email|phone|address|contact/i.test(c));
  check(nameCols.length === 0, "no governed column asks for personal data at all", nameCols.join(", "));
}

// ── 6 · no fabricated obligation_ref ────────────────────────────────────────────────────────────
//
// Scoped to the SETTLEMENT example, which is where the fabrication risk lives. It is deliberately NOT
// applied to the expectation side, where `supersedes_ref` legitimately contains another line's reference —
// an amendment lineage is a real relationship, not a composed key, and a guard that could not tell those
// apart would be measuring the wrong thing.
{
  const bad: string[] = [];
  for (const r of sCsv.rows) {
    const ref = (r.obligation_ref ?? "").trim();
    if (ref === "") continue;
    for (const [k, v] of Object.entries(r)) {
      if (k === "obligation_ref") continue;
      const other = (v ?? "").trim();
      if (other === "") continue;
      // Exact equality disqualifies at any length. CONTAINMENT only counts for a value long enough to be
      // a key: the first form flagged `SL-7781` for containing the invoice LINE NUMBER "1", which no
      // reference could meaningfully be derived from. A one-character cell is not a composition source.
      const meaningful = other.length >= 4;
      if (other === ref || (meaningful && (ref.includes(other) || other.includes(ref)))) {
        bad.push(`${ref} overlaps ${k}="${other}"`);
      }
    }
  }
  check(bad.length === 0, "no example obligation_ref is derivable from another cell on its row", bad.join("; "));

  // ...and the generator composes none. Comments and string literals stripped, because both legitimately
  // discuss the ban by name — the lesson a structural guard here has had to learn four times.
  for (const f of ["emit-package.ts", "examples.ts", "verify-package.ts"]) {
    const code = readFileSync(join("scripts/pilot-intake", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    check(!/obligation_ref\s*[:=]\s*[^,}\s]*[+`$]/.test(code), `scripts/pilot-intake/${f} · composes no obligation_ref`);
  }
}

// ── 7 · the UNKNOWN amount is still UNKNOWN ─────────────────────────────────────────────────────
{
  const row = eCsv.rows.find((r) => r.schedule_line_ref === UNKNOWN_AMOUNT_OBLIGATION);
  check(row !== undefined, `the unpriced example obligation ${UNKNOWN_AMOUNT_OBLIGATION} is present`);
  const amount = (row?.expected_amount ?? "x").trim();
  check(amount === "", "the unpriced obligation's amount is BLANK — not 0, not 0.00, not a dash", `got "${amount}"`);
  check(eVal.unknownAmountCount === 1, "the validator reads exactly one UNKNOWN amount", `${eVal.unknownAmountCount}`);
  const accepted = eVal.accepted.find((a) => a.scheduleLineRef === UNKNOWN_AMOUNT_OBLIGATION);
  check(accepted !== undefined, "...and its row is PRESERVED rather than rejected");
}

// ── 8 · no money is computed and no reconciliation is executed ──────────────────────────────────
{
  // COMMENTS AND STRING LITERALS STRIPPED. The first form scanned raw text and flagged THIS FILE for
  // every module in its own forbidden list — the guard reported itself. Fifth instance of the same
  // lesson: a structural guard must read code, not the words the code is talking about.
  for (const f of readdirSync("scripts/pilot-intake")) {
    const src = readFileSync(join("scripts/pilot-intake", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const forbidden of ["reconciliationCore", "obligationAwareReconciliation", "provenLedger", "domain/money", "domain/outcomes"]) {
      check(!src.includes(forbidden), `scripts/pilot-intake/${f} · does not import ${forbidden}`);
    }
  }
  check(readiness.claimBoundary.computesMoney === false, "the readiness evaluation computes no money");
  // No dollar FIGURE in any customer-facing document. The synthetic experiment is referred to
  // qualitatively ("the single highest-value field we tested"), never as an amount, because a figure from
  // a synthetic run has no standing in a customer conversation.
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".md"))) {
    const body = read(f);
    // NO MONETARY FIGURE AND NO UPLIFT PERCENTAGE. The first form banned only `$`-amounts and let a
    // "+32.5%" through, which a customer reads as an expected return on their own book. Both are figures
    // from a synthetic run, and neither has standing in a customer conversation.
    const figures = [
      ...[...body.matchAll(/\$\s?[\d,]+(?:\.\d{2})?/g)].map((m) => m[0]),
      ...[...body.matchAll(/[+-]?\d+(?:\.\d+)?\s?%/g)].map((m) => m[0]),
    ];
    check(figures.length === 0, `${f} · quotes no monetary figure and no uplift percentage`, figures.join(" "));
  }
}

// ── 9 · no production module consumes the package ───────────────────────────────────────────────
{
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
      const code = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      // The PACKAGE PATH, not the bare word. `INTAKE_KIT_VERSION = "pilot-intake-2026.1"` and an export
      // filename prefix both predate this package and have nothing to do with it; the first form flagged
      // them and would have had me "fix" two files that were never wrong.
      if (/docs\/pilot-intake/.test(code)) hits.push(full);
    }
  };
  for (const root of ["src", "server"]) walk(root);
  // A TEST referencing the package is a consumer we WANT — it is what proves the committed documents have
  // not drifted from the governed specs. The guard's subject is PRODUCTION code, so tests are separated
  // rather than excluded, and the positive half is asserted too: a drift test must actually exist, or the
  // package could rot with nothing noticing.
  const production = hits.filter((f) => !/\.test\.tsx?$/.test(f));
  const tests = hits.filter((f) => /\.test\.tsx?$/.test(f));
  check(production.length === 0, "NO PRODUCTION module under src/ or server/ consumes the package", production.join(", "));
  check(tests.length > 0, "...and a test DOES, so drift from the governed specs is caught", tests.join(", "));
  check(statSync(DIR).isDirectory(), "the package is a plain directory of documents and CSVs");
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
process.stdout.write("── PILOT INTAKE PACKAGE VERIFICATION ──\n");
for (const c of checks) process.stdout.write(`  ${c.ok ? "PASS" : "FAIL"} · ${c.label}${c.detail ? ` · ${c.detail}` : ""}\n`);
const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} package checks passed\n`);
if (failed.length > 0) { process.stdout.write("PACKAGE VERIFICATION FAILED\n"); process.exit(1); }
process.stdout.write("PACKAGE VERIFICATION PASSED\n");
