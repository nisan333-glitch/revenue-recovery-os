// FREEZE for the OBLIGATION-REFERENCE COUNTERFACTUAL — a separate package with its own lock.
//
// This is a sibling of the V3 harness, never a reshaping of it. The V3 package, its ruler and its
// recorded results are untouched and must stay that way: this module's integrity proofs are what make
// that claim checkable rather than asserted.
//
// WHAT A COUNTERFACTUAL PACKAGE HAS TO PROVE THAT A NEW PACKAGE DOES NOT. A fresh benchmark only has
// to be internally consistent. A counterfactual has to be the SAME BUSINESS as its baseline plus ONE
// NEW FACT, or the comparison measures the wrong thing — a second difference anywhere would let a
// movement be credited to the new fact when it came from somewhere else. So six proofs run BEFORE the
// freeze, and the freeze refuses on any of them.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "e2e/fixtures/reconciliation-obligation-ref";
const V3 = "e2e/fixtures/reconciliation-synthetic";
const HARNESS = "scripts/reconciliation-obligation-ref";
export const LOCK = `${HARNESS}/FREEZE.lock.json`;

/** The ONE new column. Named once, here, so every proof reads the same definition. */
export const NEW_COLUMN = "obligation_ref";

export const DATA_FILES = ["expectation.csv", "observation.csv", "ground-truth.csv", "planted-register.json"];
export const SCRIPT_FILES = ["generate.mjs", "freeze.mjs", "run.ts", "score.mjs", "verify.mjs"];

export const sha = (t) => createHash("sha256").update(t).digest("hex");

/** The V3 artefact hashes this variant is derived from. Stated, so a drift in EITHER package fails. */
export const V3_HASHES = Object.freeze({
  "expectation.csv": "31992d23dc8cd86d25aca9cb993d760d396f78e15294e88be5f17ce912959939",
  "observation.csv": "0ef21e4097f488877a09f35ab9fa8f1c7ac61e167bc4163dce1b5199a6dfb186",
  "ground-truth.csv": "0f5558e402912047783d06d171e2cbfa674ab262de660f9832907f99eb71f074",
  "planted-register.json": "111db9d180c43fe46939d2889538cd9f5cb2e4c6d7676317f2f34ea6129aab9f",
});

export function currentHashes() {
  const data = {};
  for (const f of DATA_FILES) data[f] = sha(readFileSync(`${DIR}/${f}`, "utf8"));
  const scripts = {};
  for (const f of SCRIPT_FILES) scripts[f] = sha(readFileSync(`${HARNESS}/${f}`, "utf8"));
  return { data, scripts };
}

export function frozenProblems() {
  if (!existsSync(LOCK)) return ["no freeze lock exists — the variant was never frozen, so no result may be taken from it"];
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  const { compositeSha256, ...record } = lock;
  const problems = [];
  if (sha(JSON.stringify(record)) !== compositeSha256) problems.push("the freeze lock itself was edited");
  const now = currentHashes();
  for (const [f, want] of Object.entries(lock.data)) {
    if (now.data[f] !== want) problems.push(`${f} changed since the freeze — the VARIANT PACKAGE moved`);
  }
  for (const [f, want] of Object.entries(lock.scripts)) {
    if (now.scripts[f] !== want) problems.push(`${f} changed since the freeze — the VARIANT HARNESS moved`);
  }
  // The baseline is part of this experiment too: a counterfactual quoted against a moved baseline is
  // not a counterfactual. Checked here and not only in V3's own gate, because the comparison is MINE.
  for (const [f, want] of Object.entries(V3_HASHES)) {
    if (sha(readFileSync(`${V3}/${f}`, "utf8")) !== want) problems.push(`${V3}/${f} moved — the BASELINE this variant is compared against changed`);
  }
  return problems;
}

export function assertFrozen(headline) {
  const problems = frozenProblems();
  if (problems.length === 0) return;
  process.stdout.write(`${headline}\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}

// ── CSV, read as cells rather than as bytes ──────────────────────────────────────────────────────
//
// Cell comparison is the authoritative instrument and byte comparison is the convenient one, which is
// the wrong way round for this proof. The first form of proof 4 re-serialised the stripped variant and
// hashed it; it reported a difference that did not exist, because the file carries no trailing newline
// and the re-serialiser added one. That is the SAME CLASS OF DEFECT as the $89.70 transport bug the V3
// revision exists to correct — an apparatus error read as a finding — so the proof now compares cells,
// and the byte form is derived from the real bytes rather than rebuilt.
export function readCells(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
  const parse = (l) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const rows = lines.map(parse);
  return { cols: rows[0], rows: rows.slice(1) };
}

/**
 * THE SIX PROOFS. Each returns a sentence on failure and nothing on success, so the freeze gate and
 * the verifier can both print them.
 */
export function integrityProblems() {
  const problems = [];

  // 1-3 · the three artefacts that may not move AT ALL.
  for (const f of ["expectation.csv", "ground-truth.csv", "planted-register.json"]) {
    const got = sha(readFileSync(`${DIR}/${f}`, "utf8"));
    if (got !== V3_HASHES[f]) problems.push(`PROOF ${f}: expected V3's ${V3_HASHES[f].slice(0, 12)}…, got ${got.slice(0, 12)}…`);
  }

  // 4 · the billing export is V3's PLUS ONE COLUMN and nothing else. Compared cell by cell over every
  //     pre-existing column, which is the claim that matters; a byte check cannot distinguish a
  //     changed value from a changed quoting rule.
  const a = readCells(`${V3}/observation.csv`);
  const b = readCells(`${DIR}/observation.csv`);
  const k = b.cols.indexOf(NEW_COLUMN);
  if (k === -1) problems.push(`PROOF 4: the variant's observation.csv does not declare ${NEW_COLUMN}`);
  else if (b.cols.filter((c, i) => i !== k).join(",") !== a.cols.join(","))
    problems.push("PROOF 4: the pre-existing billing columns changed, or their order did");
  else if (a.rows.length !== b.rows.length)
    problems.push(`PROOF 4: row count moved — ${a.rows.length} -> ${b.rows.length}`);
  else {
    let diffs = 0;
    for (let i = 0; i < a.rows.length; i += 1) {
      const kept = b.rows[i].filter((_, j) => j !== k);
      for (let j = 0; j < a.cols.length; j += 1) if (a.rows[i][j] !== kept[j]) diffs += 1;
    }
    if (diffs > 0) problems.push(`PROOF 4: ${diffs} pre-existing billing cell(s) changed — the variant is not V3 plus one column`);
  }

  // 5 · the money and the mechanisms are the same business. Read from the truth, which proof 2 has
  //     already pinned — so this is a statement about what that file MEANS, kept because a future
  //     revision could keep the hash gate and lose the meaning.
  const t = readCells(`${DIR}/ground-truth.csv`);
  const iA = t.cols.indexOf("authoritative_exposure_minor");
  const planted = t.rows.reduce((n, r) => n + (r[iA] === "UNKNOWN" ? 0 : Number(r[iA])), 0);
  if (planted !== 8_594_200) problems.push(`PROOF 5: planted money is ${planted}, expected 8594200`);
  if (t.rows.length !== 19) problems.push(`PROOF 5: ${t.rows.length} mechanisms, expected 19`);

  // 6 · the new fact is actually present and actually resolvable. A column of blanks would pass every
  //     proof above and measure nothing; a column of references naming no obligation would measure a
  //     fiction. Both are checked, and NEITHER is allowed to be partial by accident.
  if (k !== -1) {
    const exp = readCells(`${DIR}/expectation.csv`);
    const iS = exp.cols.indexOf("schedule_line_id");
    const obligations = new Set(exp.rows.map((r) => r[iS]));
    const blank = b.rows.filter((r) => (r[k] ?? "").trim() === "").length;
    const dangling = b.rows.filter((r) => (r[k] ?? "").trim() !== "" && !obligations.has(r[k])).length;
    if (blank > 0) problems.push(`PROOF 6: ${blank} billing row(s) carry no ${NEW_COLUMN} — this variant's premise is that the source supplies it on every line`);
    if (dangling > 0) problems.push(`PROOF 6: ${dangling} billing row(s) name an obligation that appears on no expectation row`);
  }

  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = integrityProblems();
  if (problems.length > 0) {
    process.stdout.write(`VARIANT INTEGRITY FAILED — nothing frozen\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  const { data, scripts } = currentHashes();
  const record = {
    frozenAt: "2026-10-07",
    variant: "OBLIGATION_REF",
    question: "What additional money becomes trustworthily detectable if the billing side provides an authoritative obligation reference?",
    derivedFrom: { revision: "V3", lock: "scripts/reconciliation-synthetic/FREEZE.lock.json", hashes: V3_HASHES },
    theOneNewFact:
      "obligation_ref on the billing export: the contract obligation (schedule_line_id) that each invoice line settles, STATED BY THE SOURCE at emission. Never inferred from amount, date, payer, row order or any NH identifier.",
    semantics:
      "BILLING'S OWN ALLOCATION, not settlement intent. Where billing's allocation step is itself the defect (M08) the reference carries billing's own belief and therefore testifies to nothing new — the conservative reading, declared before the run.",
    order: "generate -> prove integrity -> FREEZE -> record hashes -> run NH -> score with V3's ruler",
    data, scripts,
  };
  const next = `${JSON.stringify({ ...record, compositeSha256: sha(JSON.stringify(record)) }, null, 2)}\n`;
  if (existsSync(LOCK) && readFileSync(LOCK, "utf8") !== next) {
    process.stdout.write(
      `RE-FREEZING an existing lock. This is a GOVERNED BENCHMARK REVISION:\n` +
      `  - it will appear as a diff on ${LOCK}, which a reviewer must approve\n` +
      `  - it is legitimate ONLY with explicit evidence that the frozen package was objectively wrong\n` +
      `  - it is NEVER legitimate to improve a result\n`,
    );
  }
  writeFileSync(LOCK, next);
  process.stdout.write(`frozen · ${DATA_FILES.length} data artefacts + ${SCRIPT_FILES.length} scripts -> ${LOCK}\n`);
}
