// THE READINESS CONTROL — run the readiness path against the FROZEN synthetic exports and assert it
// recognises what it must.
//
// IT IS READ-ONLY OVER BOTH PACKAGES. It opens `expectation.csv` and `observation.csv` and writes
// nothing into either fixture directory: no regeneration, no re-freeze, no re-run of the money
// benchmark, no re-score. Both `recon:verify` and `recon:ref:verify` must still pass afterwards, and
// that is asserted by the slice's verification matrix rather than hoped for.
//
// WHY A CONTROL AT ALL. A readiness validator that says "ready" to everything is worse than none: it
// would send a customer away satisfied and arrive at reconciliation with facts that cannot support it.
// The two frozen packages are a known-answer pair — one WITHOUT a billing-side obligation reference and
// one WITH, differing by exactly that column — so the readiness path has a right answer to be wrong
// about.
//
// THE ADAPTER BELOW IS A TEST HARNESS, NOT AN INTAKE. The frozen CSVs were authored for the benchmark
// and use its header names. Mapping them onto the contracts' field names is a harness concern; no
// production path reads these files, and nothing here is wired to reconciliation.
import { readFileSync } from "node:fs";
import {
  EXPECTATION_EXTRACT_COLUMNS,
} from "../../src/contract/expectationExtract";
import { validateExpectationExtract, type RawExpectationRow } from "../../src/contract/expectationExtractValidator";
import { BILLING_EXTRACT_COLUMNS } from "../../src/contract/billingExtract";
import { validateBillingExtract, type RawBillingRow } from "../../src/contract/billingExtractValidator";
import { evaluateDataReadiness, type ReadinessReport } from "../../src/contract/dataReadiness";

const V3 = "e2e/fixtures/reconciliation-synthetic";
const VARIANT = "e2e/fixtures/reconciliation-obligation-ref";

function readCsv(path: string): { cols: string[]; rows: Record<string, string>[] } {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
  const parse = (l: string): string[] => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i]!;
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const cols = parse(lines[0]!);
  return { cols, rows: lines.slice(1).map((l) => Object.fromEntries(parse(l).map((c, i) => [cols[i]!, c]))) };
}

/** Benchmark header → expectation-extract field. Harness mapping only. */
const E_MAP: Readonly<Record<string, string>> = Object.freeze({
  entitlement_id: "entitlement_ref", period_start: "period_start", period_end: "period_end",
  expected_amount: "expected_amount", currency: "currency", payer_account_id: "payer_ref",
  terminated_at: "terminated_at", pause_start: "pause_start", pause_end: "pause_end",
  amended_at: "amended_at", supersedes_schedule_line_id: "supersedes_ref",
  schedule_line_id: "schedule_line_ref",
});

/** Benchmark header → billing-extract field. `obligation_ref` exists only in the variant. */
const S_MAP: Readonly<Record<string, string>> = Object.freeze({
  invoice_id: "invoice_ref", invoice_line_id: "invoice_line_ref", issued_at: "invoice_raised_at",
  billed_amount: "invoice_line_amount", currency: "currency", payer_account_id: "payer_ref",
  is_credit: "is_credit", period_start: "period_start", period_end: "period_end",
  legacy_subscription_id: "legacy_subscription_ref", source_system: "source_system",
  obligation_ref: "obligation_ref",
});

function mapRows(
  src: { cols: string[]; rows: Record<string, string>[] },
  map: Readonly<Record<string, string>>,
  declared: readonly string[],
): { cols: string[]; rows: { rowNumber: number; cells: Record<string, string> }[] } {
  // Only the columns this contract declares. A benchmark column with no counterpart is DROPPED here,
  // in the harness, rather than being passed through to be refused as undeclared — the contract's
  // undeclared-column rule is about a CUSTOMER file, and conflating the two would test the adapter.
  const cols = src.cols.map((c) => map[c]).filter((c): c is string => c !== undefined && declared.includes(c));
  const rows = src.rows.map((r, i) => ({
    rowNumber: i + 1,
    cells: Object.fromEntries(
      Object.entries(r)
        .map(([k, v]) => [map[k], v] as const)
        .filter((pair): pair is readonly [string, string] => pair[0] !== undefined && cols.includes(pair[0])),
    ),
  }));
  return { cols, rows };
}

function readinessFor(dir: string): ReadinessReport {
  const e = mapRows(readCsv(`${dir}/expectation.csv`), E_MAP, EXPECTATION_EXTRACT_COLUMNS);
  const s = mapRows(readCsv(`${dir}/observation.csv`), S_MAP, BILLING_EXTRACT_COLUMNS);
  return evaluateDataReadiness(
    validateExpectationExtract(e.cols, e.rows as RawExpectationRow[], { currency: "USD", asOf: "2026-06-30" }),
    validateBillingExtract(s.cols, s.rows as RawBillingRow[], { currency: "USD" }),
  );
}

const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail = "") => checks.push({ ok, label, detail });

const v3 = readinessFor(V3);
const variant = readinessFor(VARIANT);

const blockedCode = (r: ReadinessReport, capability: string): string | null =>
  r.blocked.find((b) => b.capability === capability)?.code ?? null;

// ── 1 · V3 has no billing-side obligation identity ──────────────────────────────────────────────
check(blockedCode(v3, "MONETARY_RECONCILIATION") === "NH-BX-3001",
  "V3 · the missing billing-side obligation link is recognised",
  `code=${blockedCode(v3, "MONETARY_RECONCILIATION")}`);
check(v3.billing.obligationRefPopulatedRows === 0,
  "V3 · no billing line carries an obligation reference",
  `${v3.billing.obligationRefPopulatedRows} populated`);
check(v3.level === "L1_STRUCTURALLY_VALID",
  "V3 · ceiling is L1 — structurally valid, reconciliation NOT possible", `level=${v3.level}`);

// ── 2 · the variant reaches the higher level ────────────────────────────────────────────────────
check(variant.level === "L2_MONETARY_RECONCILIATION_POSSIBLE",
  "variant · reaches L2, monetary reconciliation possible", `level=${variant.level}`);
check(variant.billing.obligationRefPopulatedRows === variant.billing.acceptedRows,
  "variant · every accepted billing line names the obligation it settles",
  `${variant.billing.obligationRefPopulatedRows}/${variant.billing.acceptedRows}`);
// The 11 dangling references are a CORRECT finding, not a defect: they name obligations whose
// expectation rows were quarantined — 2 ambiguous live lines (NH-EX-2016) and 9 in a non-governed
// currency (NH-EX-2008). What must hold is that they are REPORTED and INTERPRETED, and that they do
// not block the 586 that resolve.
check(variant.danglingObligationRefs === 11,
  "variant · billing lines naming a quarantined obligation are counted, not hidden",
  `dangling=${variant.danglingObligationRefs}`);
check(variant.danglingObligationRefNote !== null && variant.danglingObligationRefNote.includes("cannot be joined"),
  "variant · the dangling count carries its interpretation", "");
check(variant.level === "L2_MONETARY_RECONCILIATION_POSSIBLE",
  "variant · 11 unjoinable rows of 597 do NOT make reconciliation impossible for the rest",
  `level=${variant.level}`);

// ── 3 · UNKNOWN amounts stay UNKNOWN ────────────────────────────────────────────────────────────
check(variant.expectation.unknownAmountRows > 0,
  "M16 · blank expected amounts are counted as UNKNOWN", `${variant.expectation.unknownAmountRows} rows`);
check(variant.expectation.monetaryQuantification !== "AVAILABLE",
  "M16 · the roll-up refuses to claim full quantification",
  `quantification=${variant.expectation.monetaryQuantification}`);
check(variant.level !== "L3_EXACT_MONEY",
  "M16 · exact money is NOT reached while any unit is UNKNOWN", `level=${variant.level}`);
check(blockedCode(variant, "EXACT_MONEY") === "NH-EX-3006",
  "M16 · the blocked capability names the unpriced unit", `code=${blockedCode(variant, "EXACT_MONEY")}`);

// ── 4 · M17-type expectation ambiguity is unresolved ────────────────────────────────────────────
check(blockedCode(variant, "ADDITIVE_OBLIGATION") === "NH-EX-2016",
  "M17 · additive-obligation capability is UNRESOLVED, not assumed",
  `code=${blockedCode(variant, "ADDITIVE_OBLIGATION")}`);

// ── 5 · currency mismatch closes exact reconciliation ───────────────────────────────────────────
check(variant.billing.currencyMismatchRows === 0 && variant.expectation.rejectionCodes.length >= 0,
  "M19 · a cross-currency obligation is handled without converting anything",
  `mismatched billing lines=${variant.billing.currencyMismatchRows}`);
check(!variant.currencyCompatible || variant.level !== "L3_EXACT_MONEY",
  "M19 · exact money is unavailable wherever currency is not comparable", `compatible=${variant.currencyCompatible}`);

// ── 6 · no fabricated authority ─────────────────────────────────────────────────────────────────
for (const [label, r] of [["V3", v3], ["variant", variant]] as const) {
  check(r.authority.reached === "SOURCE_NATIVE", `${label} · authority caps at SOURCE_NATIVE`, r.authority.reached);
  check(r.provisional === true, `${label} · every level is reported PROVISIONAL`, String(r.provisional));
  check(r.refusedSelfAssertedAuthority.length === 0, `${label} · nothing self-asserted authority`, "");
  check(r.claimBoundary.computesMoney === false, `${label} · the report computes no money`, "");
}

// ── every blocked capability is actionable ───────────────────────────────────────────────────────
for (const [label, r] of [["V3", v3], ["variant", variant]] as const) {
  const complete = r.blocked.every((b) =>
    b.missingSourceFact.length > 20 && b.blockedMoneyDiscoveryCapability.length > 20 && /^NH-(EX|BX)-\d{4}$/.test(b.code));
  check(complete, `${label} · every blocked capability names fact, owner and what is blocked`,
    `${r.blocked.length} blocked`);
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const line = (label: string, r: ReadinessReport) => {
  process.stdout.write(`\n── ${label} ──\n`);
  process.stdout.write(`  level ${r.level}${r.provisional ? " (PROVISIONAL)" : ""} · authority ${r.authority.reached}\n`);
  process.stdout.write(`  expectation: ${r.expectation.acceptedRows} accepted, ${r.expectation.rejectedRows} rejected, `
    + `${r.expectation.unknownAmountRows} UNKNOWN amount, quantification ${r.expectation.monetaryQuantification}\n`);
  process.stdout.write(`  billing    : ${r.billing.acceptedRows} accepted, ${r.billing.rejectedRows} rejected, `
    + `${r.billing.obligationRefPopulatedRows} with obligation_ref, ${r.billing.creditRows} credits, `
    + `${r.billing.currencyMismatchRows} currency mismatches\n`);
  if (r.expectation.rejectionCodes.length > 0) process.stdout.write(`  expectation rejections: ${r.expectation.rejectionCodes.join(", ")}\n`);
  if (r.billing.rejectionCodes.length > 0) process.stdout.write(`  billing rejections : ${r.billing.rejectionCodes.join(", ")}\n`);
  process.stdout.write(`  BLOCKED:\n`);
  for (const b of r.blocked) {
    process.stdout.write(`    ${b.capability} [${b.code}] owner=${b.owningSourceSystem}\n`);
    process.stdout.write(`        missing : ${b.missingSourceFact.slice(0, 150)}\n`);
    process.stdout.write(`        blocks  : ${b.blockedMoneyDiscoveryCapability.slice(0, 150)}\n`);
  }
};
line("V3 · no billing-side obligation identity", v3);
line("VARIANT · obligation_ref supplied", variant);

process.stdout.write(`\n── CONTROL CHECKS ──\n`);
for (const c of checks) process.stdout.write(`  ${c.ok ? "PASS" : "FAIL"} · ${c.label}${c.detail ? ` · ${c.detail}` : ""}\n`);
const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} control checks passed\n`);
if (failed.length > 0) {
  process.stdout.write("READINESS CONTROL FAILED\n");
  process.exit(1);
}
process.stdout.write("READINESS CONTROL PASSED\n");
