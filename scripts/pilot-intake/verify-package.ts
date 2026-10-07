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
import { EXPECTATION_EXTRACT_COLUMNS, STOPPED_FIELDS } from "../../src/contract/expectationExtract";
import { CORRECTED_CANDIDATES } from "../../src/contract/expectationExtractCorrections";
import { dependencyFor } from "./dependency";
import { validateExpectationExtract, type RawExpectationRow } from "../../src/contract/expectationExtractValidator";
import {
  BILLING_EVENT_DEFINITION, BILLING_EXTRACT_COLUMNS, BILLING_EXTRACT_FIELDS, BILLING_EXTRACT_REF,
} from "../../src/contract/billingExtract";
import { validateBillingExtract, type RawBillingRow } from "../../src/contract/billingExtractValidator";
import { evaluateDataReadiness } from "../../src/contract/dataReadiness";
import { ATTESTATION_CLAIMS } from "../../src/contract/provenanceAttestation";
import { EXPECTATION_EXAMPLE, BILLING_EXAMPLE, UNKNOWN_AMOUNT_OBLIGATION } from "./examples";

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
  ["billing_template.csv", BILLING_EXTRACT_COLUMNS],
] as const) {
  const header = read(name).trim();
  check(header === cols.join(","), `${name} · header is exactly the governed schema, in order`,
    header === cols.join(",") ? "" : `got "${header.slice(0, 80)}…"`);
  check(read(name).trim().split("\n").length === 1, `${name} · headers ONLY, no data rows`);
}
check(read("billing_template.csv").includes("obligation_ref"),
  "billing_template.csv · obligation_ref is present, per the accepted readiness contract");

// ── 2 · the examples carry only declared columns and pass their own validators ───────────────────
const eCsv = parseCsv(read("expectation_example.csv"));
const sCsv = parseCsv(read("billing_example.csv"));
check(eCsv.cols.join(",") === EXPECTATION_EXTRACT_COLUMNS.join(","), "expectation_example.csv · declared columns only, in order");
check(sCsv.cols.join(",") === BILLING_EXTRACT_COLUMNS.join(","), "billing_example.csv · declared columns only, in order");

const eVal = validateExpectationExtract(
  eCsv.cols,
  eCsv.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) as RawExpectationRow[],
  { currency: "USD" },
);
const sVal = validateBillingExtract(
  sCsv.cols,
  sCsv.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) as RawBillingRow[],
  { currency: "USD" },
);
check(eVal.usable && eVal.extractFaults.length === 0, "expectation_example.csv · no extract fault", JSON.stringify(eVal.extractFaults));
check(sVal.usable && sVal.extractFaults.length === 0, "billing_example.csv · no extract fault", JSON.stringify(sVal.extractFaults));
check(eVal.rejections.length === 0, "expectation_example.csv · every row ACCEPTED by the real validator",
  eVal.rejections.map((r) => `${r.rowNumber}:${r.code}`).join(" "));
check(sVal.rejections.length === 0, "billing_example.csv · every row ACCEPTED by the real validator",
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
check(readiness.billing.creditRows === 1, "the credit is recognised as a credit, not a charge", `${readiness.billing.creditRows}`);

// ── 4 · the generated documents have not drifted from the governed definitions ───────────────────
{
  const dict = read("FIELD_DICTIONARY.md");
  const missing = [...EXPECTATION_EXTRACT_COLUMNS, ...BILLING_EXTRACT_COLUMNS]
    .filter((c) => !dict.includes(`### \`${c}\``));
  check(missing.length === 0, "FIELD_DICTIONARY.md · every governed field has an entry", missing.join(", "));
  // ...and no entry for a field that does not exist.
  const entries = [...dict.matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1]!);
  const governed = new Set([...EXPECTATION_EXTRACT_COLUMNS, ...BILLING_EXTRACT_COLUMNS]);
  const invented = entries.filter((e) => !governed.has(e));
  check(invented.length === 0, "FIELD_DICTIONARY.md · documents NO field the contracts do not declare", invented.join(", "));

  const request = read("PILOT_DATA_REQUEST_V1.md");
  const absent = [...EXPECTATION_EXTRACT_COLUMNS, ...BILLING_EXTRACT_COLUMNS].filter((c) => !request.includes(`\`${c}\``));
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
  const nameCols = [...EXPECTATION_EXTRACT_COLUMNS, ...BILLING_EXTRACT_COLUMNS]
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

// ── 10 · SEMANTIC CONTRADICTION SWEEP ───────────────────────────────────────────────────────────
//
// Added after an independent read of the GENERATED documents found three contradictions that every
// existing check had passed. The lesson generalises past this package: the earlier verifier proved the
// documents matched the specs, which is a different claim from the documents being internally coherent.
// A generator can render two governed facts that are each true at their own layer and contradict each
// other on the page — a formal tier beside a capability requirement, a permitted blank beside a row
// rejection, a requested field beside a list of fields we do not request.
{
  const requestBody = read("PILOT_DATA_REQUEST_V1.md");
  const dictBody = read("FIELD_DICTIONARY.md");
  const customerFacing = readdirSync(DIR).filter((f) => f.endsWith(".md"));

  // ── A · nothing may be REQUESTED and STOPPED in the same artefact ─────────────────────────────
  const requestedFields = [...EXPECTATION_EXTRACT_COLUMNS, ...BILLING_EXTRACT_COLUMNS];
  for (const f of customerFacing) {
    const body = read(f);
    const stoppedSection = body.includes("## What we will NOT ask you for")
      ? body.slice(body.indexOf("## What we will NOT ask you for"))
      : "";
    if (stoppedSection === "") continue;
    // A refusal is only a CONTRADICTION when it is unqualified. Three entries refuse a column on one
    // export that we genuinely request on the OTHER — `expected_amount` is asked for on the contract
    // side and refused on the billing side — so the table now states the export per row, and this check
    // requires that qualifier to be present on any row naming a column we request. The first form had no
    // notion of sides and reported three false contradictions.
    const contradictions = requestedFields.filter((col) => {
      const requested = body.slice(0, body.indexOf("## What we will NOT ask you for")).includes(`\`${col}\``);
      if (!requested) return false;
      const rows = stoppedSection.split("\n").filter((l) => new RegExp(`(^|[^\\w])${col}([^\\w]|$)`).test(l));
      // Every row naming it must say which export it is refused on, or be about a DERIVED form of it.
      return rows.some((l) => !/A · expectation|B · (settlement|billing)/.test(l) && !/derived|composite|estimated/i.test(l));
    });
    check(contradictions.length === 0,
      `${f} · no field is both REQUESTED and listed as NOT requested`, contradictions.join(", "));
  }

  // ...and the mechanism that keeps it true: every corrected candidate is excluded from the ask.
  for (const candidate of CORRECTED_CANDIDATES) {
    const inRequest = requestBody.includes(candidate);
    check(!inRequest, `superseded design conclusion is absent from the customer request · "${candidate.slice(0, 48)}…"`);
  }
  check(CORRECTED_CANDIDATES.length > 0,
    "...and at least one correction exists, so that filter is not vacuous", `${CORRECTED_CANDIDATES.length}`);
  // The historical record itself is UNTOUCHED — history is referenced, never rewritten.
  check(STOPPED_FIELDS.some((x) => CORRECTED_CANDIDATES.includes(x.candidate)),
    "the superseded entry is still PRESERVED in the design record it was written in");

  // ── B · the obligation-link dependency is stated truthfully and is MEASURED ────────────────────
  for (const [field, side] of [["obligation_ref", "billing"], ["schedule_line_ref", "expectation"]] as const) {
    const dep = dependencyFor(field, side);
    check(dep.costsALevel,
      `${field} · dropping it provably costs a readiness level — the dependency is measured, not asserted`,
      `${dep.levelWith} -> ${dep.levelWithoutColumn}`);
    check(dep.blankCostsALevel,
      `${field} · a BLANK cell costs the same level, so a partly-filled column buys nothing`,
      `blank -> ${dep.levelWithBlankCells}`);
    check(dictBody.includes(`### \`${field}\``) && new RegExp(`### \`${field}\`[\\s\\S]*?\\*\\*Mandatory in practice\\?\\*\\* \\| \\*\\*YES\\*\\*`).test(dictBody),
      `FIELD_DICTIONARY.md · ${field} is marked MANDATORY IN PRACTICE`);
  }
  check(requestBody.includes("MANDATORY IN PRACTICE"),
    "PILOT_DATA_REQUEST_V1.md · names the mandatory-in-practice pair in the ask itself");
  check(requestBody.includes("`schedule_line_ref`"),
    "PILOT_DATA_REQUEST_V1.md · asks for schedule_line_ref, which obligation_ref resolves against");

  // ── C · the column / cell distinction for expected_amount ─────────────────────────────────────
  {
    const entry = dictBody.slice(dictBody.indexOf("### `expected_amount`"), dictBody.indexOf("### `currency`"));
    check(entry.includes("If the COLUMN is absent") && entry.includes("If a CELL is blank"),
      "FIELD_DICTIONARY.md · expected_amount distinguishes a missing COLUMN from a blank CELL");
    check(/If the COLUMN is absent\*\* \| \*\*The file cannot be read/.test(entry),
      "...a missing column is an extract fault");
    check(/If a CELL is blank\*\* \| \*\*Permitted, and meaningful\.\*\* The row is \*\*ACCEPTED\*\*/.test(entry),
      "...a blank cell ACCEPTS the row as UNKNOWN");
    check(!/If a CELL is blank[^|]*\|[^\n]*(The row is rejected|rejects the row|Not permitted)/.test(entry),
      "...and a blank cell is NEVER described as a row rejection");
    check(entry.includes("never as 0 and never estimated"), "...and never becomes zero");
  }

  // ── D · the general sweep · a permitted blank may never also reject the row ────────────────────
  {
    const entries = [...dictBody.matchAll(/### `([^`]+)`\n([\s\S]*?)(?=\n### |\n## |$)/g)];
    check(entries.length === EXPECTATION_EXTRACT_COLUMNS.length + BILLING_EXTRACT_COLUMNS.length,
      "FIELD_DICTIONARY.md · every governed field has exactly one entry", `${entries.length}`);
    const bad: string[] = [];
    for (const [, name, body] of entries) {
      const blankRow = /\*\*If a CELL is blank\*\* \| ([^\n]*)/.exec(body)?.[1] ?? "";
      const colRow = /\*\*If the COLUMN is absent\*\* \| ([^\n]*)/.exec(body)?.[1] ?? "";
      if (blankRow === "" || colRow === "") { bad.push(`${name}: missing a column/cell row`); continue; }
      // A blank described as permitted must not also be described as rejecting.
      // AFFIRMATIVE rejection only. The first form matched /reject/i and fired on "No row is rejected" —
      // the word inside a negation, which is the sixth time a guard here has matched a term rather than a
      // claim. The three affirmative forms the emitter can produce are enumerated instead.
      const affirmativelyRejects = /\bThe row is rejected\b|\brejects the row\b|\bNot permitted\b/.test(blankRow);
      if (/Permitted/.test(blankRow) && affirmativelyRejects) bad.push(`${name}: blank is both permitted and rejecting`);
      // A formally required field must never advertise a permitted blank, EXCEPT expected_amount, whose
      // declared UNKNOWN is the governed exception and is asserted explicitly above.
      const tier = /\*\*Formal tier\*\* \| ([^\n|]*)/.exec(body)?.[1] ?? "";
      if (/REQUIRED/.test(tier) && /Permitted/.test(blankRow) && name !== "expected_amount") {
        bad.push(`${name}: required yet advertises a permitted blank`);
      }
      // A field marked genuinely optional must not be contradicted by a measured level cost.
      const practice = /\*\*Mandatory in practice\?\*\* \| ([^\n|]*)/.exec(body)?.[1] ?? "";
      if (/No — genuinely optional/.test(practice) && /readiness falls to/.test(colRow)) {
        bad.push(`${name}: called optional yet its absence costs a level`);
      }
    }
    check(bad.length === 0, "FIELD_DICTIONARY.md · no entry contradicts itself across tier, column and cell", bad.join("; "));
  }

  // ── E · supplier vs issuer, and consistent money terminology ──────────────────────────────────
  {
    const entries = [...dictBody.matchAll(/### `([^`]+)`\n([\s\S]*?)(?=\n### |\n## |$)/g)];
    const missingIssuer = entries
      .filter(([, , body]) => /CONTRACT system/.test(body) && /\*\*Who issues the value\*\* \| n\/a/.test(body))
      .map(([, n]) => n);
    check(missingIssuer.length === 0,
      "FIELD_DICTIONARY.md · a field whose value another system issues says so", missingIssuer.join(", "));
    const oblig = entries.find(([, n]) => n === "obligation_ref")![2];
    check(/Who sends it to us\*\* \| Billing/.test(oblig) && /Who issues the value\*\* \| \*\*Contract/.test(oblig),
      "obligation_ref · billing SENDS it, the contract system ISSUES it — stated separately");
    // ── THE SETTLED-AT SEMANTIC GUARD ───────────────────────────────────────────────────────────
    //
    // Archaeology established the event: a CHARGE WAS RAISED. The core's `ObservationRow` carries no date
    // but the service period, nothing reads `AcceptedBillingLine.invoiceRaisedAt`, the frozen billing export
    // feeds it from `issued_at` and has no payment column, and payment lives elsewhere entirely as
    // `next_invoice_paid_at`. Usage has never been inconsistent — the NAME is, and it is three commits
    // old and ours.
    //
    // So the guard is on the CLAIM, in both directions: the documents must state the charge event and
    // must never describe either `invoice_raised_at` or Export B as a payment, a receipt, a clearing or a
    // settlement in the payments sense.
    const PAYMENT_SENSE = /\b(payment date|paid on|paid at|cash receipt|receipt date|collected|collection date|cleared|clearing|remittance|settlement (?:occurred|event|date)|when (?:money|cash|payment) (?:arrived|was received))\b/i;
    for (const f of customerFacing) {
      const body = read(f);
      // Sentences that NEGATE the payment reading are the point of this slice, so they are exempt —
      // "not a payment-clearing date" must be allowed to say the words it is ruling out.
      // Exempt a line when it NEGATES the payment reading, or when it IS one of the contract's own
      // "this is not what we mean" bullets. The first form missed both: `\bnot\b` was case-sensitive so
      // "Not when money arrived" slipped past it, and the rendered `isNot` list has no negating word on
      // the bullet line at all — the negation lives in the heading above it. A guard that cannot tell an
      // assertion from its own disclaimer flags the disclaimer, which is the seventh time a check here
      // has matched a term instead of a claim.
      const disclaimers = new Set(BILLING_EVENT_DEFINITION.isNot.map((x) => `* ${x}`));
      const claims = body.split(/\n/).filter((l) => {
        if (disclaimers.has(l.trim())) return false;
        return !/\bnot\b|\bnever\b|rather than|instead of|⚠|do NOT|wrong file/i.test(l);
      });
      const offending = claims.filter((l) => PAYMENT_SENSE.test(l)).map((l) => l.trim().slice(0, 70));
      check(offending.length === 0,
        `${f} · never describes the billing export or invoice_raised_at in the PAYMENT sense`, offending.join(" | "));
    }
    // ...and the positive half: the charge event is stated, or the guard above is satisfied by silence.
    check(dictBody.includes(BILLING_EVENT_DEFINITION.theEvent),
      "FIELD_DICTIONARY.md · states the canonical charge event verbatim from the contract");
    check(requestBody.includes(BILLING_EVENT_DEFINITION.theEvent),
      "PILOT_DATA_REQUEST_V1.md · states the canonical charge event verbatim from the contract");
    // ── THE RENAME, PROVED RATHER THAN TRUSTED ──────────────────────────────────────────────────
    //
    // The predecessor's remedy was a caveat telling the customer to read `settled_at` as a raise date.
    // The owner renamed the columns and the artefact instead, so the caveat is GONE — and its absence is
    // itself a proof obligation: a stale warning about names that no longer exist would be the same class
    // of defect as the contradiction it was covering for.
    for (const f of customerFacing.concat(["billing_template.csv", "billing_example.csv",
      "expectation_template.csv", "expectation_example.csv"])) {
      const body = read(f);
      for (const dead of ["settled_at", "settled_amount", "nh.settlement-extract", "settlement_template",
        "settlement_example"]) {
        check(!body.includes(dead), `${f} · no trace of the retired name "${dead}"`);
      }
      check(!/name is misleading|names are ours and they are misleading/i.test(body),
        `${f} · carries no warning about a misleading column name — there is nothing left to warn about`);
    }
    // The successor's own names, asserted on the SCHEMA so a document cannot be the only place they exist.
    check(BILLING_EXTRACT_COLUMNS.includes("invoice_raised_at")
      && BILLING_EXTRACT_COLUMNS.includes("invoice_line_amount"),
      "billingExtract.ts · the successor schema declares invoice_raised_at and invoice_line_amount");
    check(!BILLING_EXTRACT_COLUMNS.some((c) => /^settled_/.test(c)),
      "...and declares no column named settled_*");
    check(BILLING_EXTRACT_REF === "nh.billing-extract@1.0.0",
      "the artefact the customer is asked to supply is nh.billing-extract@1.0.0", BILLING_EXTRACT_REF);
    check(requestBody.includes(BILLING_EXTRACT_REF),
      "PILOT_DATA_REQUEST_V1.md · names that artefact, so the customer cites the one we validate");
    // NO COMPATIBILITY LAYER. The owner's constraint was that none be invented without a consumer. A
    // mapping from an old column name to a new one is exactly what such a layer looks like, so the only
    // place one may exist is the historical record's own inert `renameMap`.
    {
      const roots = ["src", "server", "scripts", "e2e"];
      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
          const rel = full.replace(/.*\/(src|server|scripts|e2e)\//, "$1/");
          // The historical record declares the rename as DATA, and its test reads it. Nothing else may.
          if (/^src\/contract\/historical\//.test(rel)) continue;
          const code = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
          if (/settled_at|settled_amount/.test(code)
            && !/paid_amount|settledAmountMayNotExceedObligation/.test(code)) offenders.push(rel);
        }
      };
      for (const r of roots) walk(r);
      check(offenders.length === 0,
        "no module outside the historical record maps or reads a retired column name", offenders.join(", "));
    }
    check(/Export B is INVOICES, not payments/.test(requestBody),
      "PILOT_DATA_REQUEST_V1.md · tells the customer explicitly that Export B is invoices and not payments");
    check(/An unpaid invoice/.test(requestBody) && /exactly as/.test(requestBody),
      "...and that an unpaid invoice belongs in it just as much as a paid one");
    // The contract's own two statements must agree with each other.
    const invoiceRaisedAtSpec = BILLING_EXTRACT_FIELDS.find((f) => f.name === "invoice_raised_at")!;
    check(/RAISED/.test(invoiceRaisedAtSpec.description) && /RAISED/.test(invoiceRaisedAtSpec.establishes),
      "billingExtract.ts · invoice_raised_at's meaning and the fact it establishes BOTH say raised",
      invoiceRaisedAtSpec.establishes);
    check(!/settlement event occurred/i.test(invoiceRaisedAtSpec.establishes),
      "...and it no longer claims a settlement event occurred");
    const amountSpec = BILLING_EXTRACT_FIELDS.find((f) => f.name === "invoice_line_amount")!;
    check(/CHARGED/.test(amountSpec.establishes) && /[Nn]ot how much was paid/.test(amountSpec.establishes),
      "billingExtract.ts · invoice_line_amount establishes what was CHARGED, not paid", amountSpec.establishes);
    // No customer-facing document may call Export B a settlement/payments export.
    for (const f of customerFacing) {
      check(!/settlement export|payments export|cash application/i.test(read(f)),
        `${f} · does not call Export B a settlement or payments export`);
    }
  }
}

// ── THE ATTESTATION FORM ────────────────────────────────────────────────────────────────────────
//
// The form is what a data owner signs, so the risk is specific: a signature collected against work we do
// not do. The guards therefore check the opposite direction from everywhere else — not only that the
// document says what the contract says, but that it ADMITS what the contract cannot check.
{
  const att = read("ATTESTATION.md");
  // Every governed claim appears verbatim. A form that paraphrased one would be collecting agreement to
  // a sentence the checks do not implement.
  for (const c of ATTESTATION_CLAIMS) {
    check(att.includes(c.statement), `ATTESTATION.md · renders the claim ${c.id} verbatim from the contract`);
    check(att.includes(c.howNhChecksIt), `ATTESTATION.md · states what NH does about ${c.id}`);
  }
  // The three it cannot check must be segregated AND must say NOTHING, in those words.
  const uncheckable = ATTESTATION_CLAIMS.filter((c) => c.kind === "UNCORROBORATED_CLAIM");
  check(uncheckable.length === 3, "exactly three claims are declared uncheckable", String(uncheckable.length));
  check(/## What you are asserting, and we cannot check/.test(att),
    "ATTESTATION.md · the uncheckable claims have their own named section");
  for (const c of uncheckable) {
    const after = att.slice(att.indexOf("and we cannot check"));
    check(after.includes(c.statement), `ATTESTATION.md · ${c.id} appears in the cannot-check section`);
  }
  // It must never promise verification, and the refusal must be explicit rather than merely absent.
  check(/does not make the data independently verified/.test(att),
    "ATTESTATION.md · says in terms that this does not make the data verified");
  check(/stays marked provisional/i.test(att),
    "...and that everything reported stays provisional until a real channel exists");
  check(!/AUTHORITY_VERIFIED|VERIFIED_FOR_PILOT/.test(att),
    "ATTESTATION.md · names no internal authority state, and promises no verified one");
  // The sending of the exports must not be gated on the form — the owner's explicit constraint.
  check(/You can send the exports without this form/.test(att),
    "ATTESTATION.md · states that the exports may be sent without it");
  // A ROLE, never a person. Minimization is the reason, and the form says so.
  // Asserted on the CONTRACT and not on the page's wording. The first form matched a literal phrase that
  // the generator then stopped using, so the guard failed while the property it cared about still held.
  const ownerSpec = ATTESTATION_CLAIMS.find((c) => c.id === "OWNER_ROLE")!;
  check(/\brole\b/i.test(ownerSpec.howNhChecksIt) && /not a person/i.test(ownerSpec.howNhChecksIt),
    "the contract itself says a ROLE is asked for and a person is not", ownerSpec.howNhChecksIt);
  check(att.includes(ownerSpec.howNhChecksIt),
    "ATTESTATION.md · renders that sentence, so the reason travels with the request");
  for (const personal of ["full name", "your name", "signature of", "individual's name", "email"]) {
    check(!new RegExp(personal, "i").test(att), `ATTESTATION.md · does not ask for "${personal}"`);
  }
  check(read("README.md").includes("ATTESTATION.md"), "README.md · the index lists the attestation form");
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
process.stdout.write("── PILOT INTAKE PACKAGE VERIFICATION ──\n");
for (const c of checks) process.stdout.write(`  ${c.ok ? "PASS" : "FAIL"} · ${c.label}${c.detail ? ` · ${c.detail}` : ""}\n`);
const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} package checks passed\n`);
if (failed.length > 0) { process.stdout.write("PACKAGE VERIFICATION FAILED\n"); process.exit(1); }
process.stdout.write("PACKAGE VERIFICATION PASSED\n");
