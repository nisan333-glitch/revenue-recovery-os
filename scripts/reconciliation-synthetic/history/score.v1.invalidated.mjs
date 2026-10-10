// ═══════════════════════════════════════════════════════════════════════════════════════════════
// V1 HISTORICAL MEASUREMENT · INVALIDATED FOR DECISION USE
//
// REASON: this scorer DOUBLE-COUNTED monetary attribution across co-located mechanisms at payer
// grain. Six payers in the frozen package carry more than one planted mechanism, so a residual on a
// shared payer-period unit was charged to every case that touched it. The figures it produced are
// therefore not the benchmark result and must never be quoted as one.
//
// IT IS KEPT because the first measurement is evidence of the measurement defect, and deleting it
// would hide the thing most worth recording. Its reported FALSE-POSITIVE MONEY of $22,598.80 is the
// artefact; the governed V2 figure for the same frozen data is $9,800.00.
//
// HOW THIS FILE CAME TO EXIST, stated plainly: the V1 bytes were NEVER COMMITTED. The scorer was
// corrected in the working tree after its first run and only the corrected form reached git. This
// file is therefore a RECONSTRUCTION, produced by reversing the two recorded patches, and it is
// validated the only way a reconstruction can be — by checking that it reproduces V1's reported
// $22,598.80 against the byte-identical frozen package. That it had to be reconstructed at all is
// part of the finding: the freeze control now covers the scorer precisely so this cannot recur.
//
// IT IS NOT PART OF THE HARNESS. It writes to *.v1.* files, is not in the freeze lock's script set,
// and nothing runs it except the revision record that cites it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Score each grain candidate against the ground truth that was frozen before any run.
//
// IT NEVER IMPORTS THE PRODUCT. It reads `results.json` (what NH said), `ground-truth.csv` and
// `expectation.csv` (data, not code) and writes `scoreboard.json` plus a human report. That is the
// EP-31 separation: the thing being measured cannot see the ruler, and the ruler cannot see the thing.
//
// DETECTION AND MONEY ARE SCORED APART. A case put in the right cohort with the wrong amount is a
// monetary variance, not a detection failure, and one "accuracy" number would hide the defect worth
// finding. And a REFUSAL is its own outcome: it is neither a detection nor a miss, because "I cannot
// tell" is an answer this product is allowed to give — the question the scoreboard asks is whether the
// refusal was WARRANTED.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "e2e/fixtures/reconciliation-synthetic";
const sha = (t) => createHash("sha256").update(t).digest("hex");

// ── The freeze gate · refuse to score an experiment that moved ───────────────────────────────────
const frozen = JSON.parse(readFileSync(`${DIR}/FROZEN.json`, "utf8"));
const { compositeSha256, ...record } = frozen;
const problems = [];
if (sha(JSON.stringify(record)) !== compositeSha256) problems.push("FROZEN.json itself was edited");
for (const [name, want] of Object.entries(frozen.files)) {
  if (sha(readFileSync(`${DIR}/${name}`, "utf8")) !== want) problems.push(`${name} changed since the freeze`);
}
if (problems.length > 0) {
  process.stdout.write(`REFUSING TO SCORE\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}

const csv = (path) => {
  const [h, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = h.split(",");
  return lines.map((l) => {
    const cells = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
};

const truth = csv(`${DIR}/ground-truth.csv`);
const expectation = csv(`${DIR}/expectation.csv`);
const run = JSON.parse(readFileSync(`${DIR}/results.json`, "utf8"));

// entitlement -> payer, from the DATA. Needed because a payer-grain candidate reports units keyed by
// payer, and a case planted on an entitlement has to be found under whatever key the candidate used.
const payerOf = new Map();
for (const r of expectation) payerOf.set(r.entitlement_id, r.payer_account_id);

const KNOWN = truth.filter((t) => t.authoritative_exposure_minor !== "UNKNOWN");
const UNKNOWN_CASES = truth.filter((t) => t.authoritative_exposure_minor === "UNKNOWN");
const totalPlanted = KNOWN.reduce((n, t) => n + Number(t.authoritative_exposure_minor), 0);
const shouldDetect = truth.filter((t) => t.nh_should_detect === "yes");
const mustRefuse = truth.filter((t) => t.nh_must_refuse === "YES");

const board = [];
for (const c of run.results) {
  if (!c.constructible) { board.push({ candidate: c.candidate, constructible: false, reason: c.reason }); continue; }

  // Which keys does this candidate report units under?
  const byPayer = c.candidate === "D_PAYER_PERIOD";
  const keysFor = (t) => {
    const ents = (t.cohort_entitlements || t.first_entitlement_id || "").split(" ").filter(Boolean);
    const extra = (t.sibling_entitlements || "").split(" ").filter(Boolean);
    const all = [...ents, ...extra];
    return new Set(byPayer ? all.map((e) => payerOf.get(e)).filter(Boolean) : all);
  };

  let tp = 0, fn = 0, refusedWarranted = 0, refusedUnwarranted = 0;
  const perCase = [];
  for (const t of truth) {
    const keys = keysFor(t);
    const units = c.units.filter((u) => keys.has(u.entitlementRef));
    const positive = units.filter((u) => u.state === "UNDER_BILLED" && u.pairedMechanism === null)
      .reduce((n, u) => n + (u.residualMinor ?? 0), 0);
    const paired = units.filter((u) => u.state === "UNDER_BILLED" && u.pairedMechanism !== null)
      .reduce((n, u) => n + (u.residualMinor ?? 0), 0);
    const refused = units.filter((u) => u.state.startsWith("REFUSED")).length;
    const planted = t.authoritative_exposure_minor === "UNKNOWN" ? null : Number(t.authoritative_exposure_minor);

    if (planted !== null && t.nh_should_detect === "yes") {
      tp += Math.min(planted, positive + paired);
      fn += Math.max(0, planted - (positive + paired));
    }
    if (refused > 0) { if (t.nh_must_refuse === "YES") refusedWarranted += 1; else refusedUnwarranted += 1; }
    perCase.push({
      mechanism: t.mechanism, cohort: Number(t.cohort_size || 1), plantedMinor: planted,
      unitsFound: units.length, positiveMinor: positive, pairedMinor: paired, refusedUnits: refused,
      states: [...new Set(units.map((u) => u.state))].sort(),
      shouldDetect: t.nh_should_detect, mustRefuse: t.nh_must_refuse,
    });
  }

  // FALSE-POSITIVE MONEY: positive residuals NH reports on units belonging to no planted case that
  // should produce money, plus anything beyond a planted case's authoritative figure.
  const plantedKeys = new Set();
  for (const t of truth) for (const k of keysFor(t)) plantedKeys.add(k);
  const fpOutside = c.units
    .filter((u) => u.state === "UNDER_BILLED" && u.pairedMechanism === null && !plantedKeys.has(u.entitlementRef))
    .reduce((n, u) => n + (u.residualMinor ?? 0), 0);
  const fpInside = perCase
    .filter((p) => p.plantedMinor !== null)
    .reduce((n, p) => n + Math.max(0, p.positiveMinor + p.pairedMinor - p.plantedMinor), 0);
  const fpOnZeroTruth = perCase
    .filter((p) => p.plantedMinor === 0)
    .reduce((n, p) => n + p.positiveMinor, 0);

  board.push({
    candidate: c.candidate, constructible: true, describes: c.describes,
    expectationKey: c.expectationKey, observationKey: c.observationKey, aliasCount: c.aliasCount,
    unitCount: c.unitCount, coverage: c.coverage, witness: c.witness,
    totalPlantedMinor: totalPlanted,
    detectedPositiveMinor: c.grossPositiveMinor,
    truePositiveMinor: tp,
    falsePositiveMinor: fpOutside + fpInside,
    falsePositiveOnZeroTruthMinor: fpOnZeroTruth,
    falseNegativeMinor: fn,
    monetaryRecall: totalPlanted === 0 ? null : tp / totalPlanted,
    monetaryPrecision: c.grossPositiveMinor === 0 ? null : tp / c.grossPositiveMinor,
    unknownMoneyCases: UNKNOWN_CASES.length,
    unpricedUnits: c.unpricedExpectationCount,
    refusedUnits: c.refusedUnitCount,
    refusalsWarranted: refusedWarranted,
    refusalsUnwarranted: refusedUnwarranted,
    grossNegativeMinor: c.grossNegativeMinor,
    pairedHeldOutMinor: c.pairedPositiveMinor,
    attributionCoverage: c.coverage.correlation === "AVAILABLE" ? "payer relation supplied" : "unavailable",
    mechanismsWithAnyDetection: perCase.filter((p) => p.positiveMinor + p.pairedMinor > 0).length,
    mechanismsShouldDetect: shouldDetect.length,
    perCase,
  });
}

writeFileSync(`${DIR}/scoreboard.v1.json`, `${JSON.stringify({
  totalPlantedMinor: totalPlanted, knownCases: KNOWN.length, unknownCases: UNKNOWN_CASES.length,
  mustRefuseCases: mustRefuse.length, candidates: board,
}, null, 2)}\n`);

// ── Report ────────────────────────────────────────────────────────────────────────────────────────
const d = (m) => `$${(m / 100).toFixed(2)}`;
const pct = (x) => (x === null ? "null" : `${(x * 100).toFixed(2)}%`);
let out = `SYNTHETIC RECONCILIATION · ${run.expectationRows} expectation rows · ${run.observationRows} observation rows\n`;
out += `TOTAL AUTHORITATIVE PLANTED MONEY ${d(totalPlanted)} · ${KNOWN.length} priced cases · ${UNKNOWN_CASES.length} UNKNOWN · ${mustRefuse.length} must-refuse\n`;
for (const b of board) {
  out += `\n${"=".repeat(78)}\n${b.candidate}\n`;
  if (!b.constructible) { out += `  NOT CONSTRUCTIBLE · ${b.reason}\n`; continue; }
  out += `  keys: ${b.expectationKey}  <->  ${b.observationKey}${b.aliasCount ? ` (${b.aliasCount} aliases)` : ""}\n`;
  out += `  units ${b.unitCount} · monetary coverage ${b.coverage.monetary}\n`;
  out += `  DETECTED POSITIVE      ${d(b.detectedPositiveMinor)}\n`;
  out += `  TRUE POSITIVE          ${d(b.truePositiveMinor)}\n`;
  out += `  FALSE POSITIVE         ${d(b.falsePositiveMinor)}   (on zero-truth cases ${d(b.falsePositiveOnZeroTruthMinor)})\n`;
  out += `  FALSE NEGATIVE         ${d(b.falseNegativeMinor)}\n`;
  out += `  MONETARY RECALL        ${pct(b.monetaryRecall)}\n`;
  out += `  MONETARY PRECISION     ${pct(b.monetaryPrecision)}\n`;
  out += `  gross negative ${d(b.grossNegativeMinor)} · paired held out ${d(b.pairedHeldOutMinor)}\n`;
  out += `  unpriced units ${b.unpricedUnits} · refused units ${b.refusedUnits}`;
  out += ` (warranted ${b.refusalsWarranted} / UNWARRANTED ${b.refusalsUnwarranted})\n`;
  out += `  mechanisms with any detection ${b.mechanismsWithAnyDetection} of ${b.mechanismsShouldDetect} that should detect\n`;
  out += `  per mechanism:\n`;
  for (const p of b.perCase) {
    const want = p.plantedMinor === null ? "UNKNOWN" : d(p.plantedMinor);
    out += `    ${p.mechanism.padEnd(32)} n=${String(p.cohort).padStart(2)} truth ${want.padStart(10)}`;
    out += ` found ${d(p.positiveMinor).padStart(10)}`;
    out += ` paired ${d(p.pairedMinor).padStart(9)} refused ${String(p.refusedUnits).padStart(3)}`;
    out += `  ${p.states.join("+") || "(no units)"}\n`;
  }
}
writeFileSync(`${DIR}/report.v1.txt`, out);
process.stdout.write(out);
