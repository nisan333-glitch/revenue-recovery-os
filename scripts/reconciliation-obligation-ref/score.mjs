// Score the OBLIGATION-REFERENCE VARIANT against the SAME frozen ground truth V3 was scored against.
//
// THIS FILE IS A BYTE COPY of scripts/reconciliation-synthetic/score.mjs with two lines redirected:
// `DIR` and the freeze import. Nothing about the arithmetic, the attribution clustering, the
// false-positive accounting or the denominators differs — recorded as score.v3-to-variant.diff and
// asserted by verify.mjs. A counterfactual measured with a reshaped ruler measures the ruler.
//
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

const DIR = "e2e/fixtures/reconciliation-obligation-ref";
const sha = (t) => createHash("sha256").update(t).digest("hex");

// ── The freeze gate · refuse to score an experiment that moved ───────────────────────────────────
//
// It checks the TRACKED lock, which covers the data AND every script including this one. Gating on the
// generator's own record instead was the first form's mistake: that record was rewritten on every
// regeneration, so it always agreed with whatever was on disk.
import { assertFrozen } from "./freeze.mjs";
assertFrozen("REFUSING TO SCORE");

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

  // ATTRIBUTION CLUSTERS. At a coarse grain two planted mechanisms can land on the SAME unit key —
  // six payers here carry more than one — and then the residual belongs to both cases and to neither.
  // The first form of this scorer printed per-mechanism numbers anyway and DOUBLE-COUNTED that money,
  // which flattered a candidate for being unable to tell two defects apart. So cases sharing any key
  // are scored as one cluster, and the per-mechanism line says NOT ATTRIBUTABLE instead of a figure.
  const clusters = [];
  for (const t of truth) {
    const keys = keysFor(t);
    const hit = clusters.find((cl) => [...keys].some((k) => cl.keys.has(k)));
    if (hit) { hit.cases.push(t); for (const k of keys) hit.keys.add(k); }
    else clusters.push({ cases: [t], keys: new Set(keys) });
  }
  const sharedKeyCases = new Set(clusters.filter((cl) => cl.cases.length > 1).flatMap((cl) => cl.cases.map((t) => t.mechanism)));

  let tp = 0, fn = 0, refusedWarranted = 0, refusedUnwarranted = 0;
  for (const cl of clusters) {
    const units = c.units.filter((u) => cl.keys.has(u.entitlementRef));
    const found = units.filter((u) => u.state === "UNDER_BILLED")
      .reduce((n, u) => n + (u.residualMinor ?? 0), 0);
    const planted = cl.cases
      .filter((t) => t.authoritative_exposure_minor !== "UNKNOWN" && t.nh_should_detect === "yes")
      .reduce((n, t) => n + Number(t.authoritative_exposure_minor), 0);
    tp += Math.min(planted, found);
    fn += Math.max(0, planted - found);
  }

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

    if (refused > 0) { if (t.nh_must_refuse === "YES") refusedWarranted += 1; else refusedUnwarranted += 1; }
    perCase.push({
      mechanism: t.mechanism, cohort: Number(t.cohort_size || 1), plantedMinor: planted,
      unitsFound: units.length, positiveMinor: positive, pairedMinor: paired, refusedUnits: refused,
      states: [...new Set(units.map((u) => u.state))].sort(),
      shouldDetect: t.nh_should_detect, mustRefuse: t.nh_must_refuse,
      attributable: !sharedKeyCases.has(t.mechanism),
    });
  }

  // FALSE-POSITIVE MONEY: positive residuals NH reports on units belonging to no planted case that
  // should produce money, plus anything beyond a planted case's authoritative figure.
  const plantedKeys = new Set();
  for (const t of truth) for (const k of keysFor(t)) plantedKeys.add(k);
  const fpOutside = c.units
    .filter((u) => u.state === "UNDER_BILLED" && u.pairedMechanism === null && !plantedKeys.has(u.entitlementRef))
    .reduce((n, u) => n + (u.residualMinor ?? 0), 0);
  // Over-reporting is measured per CLUSTER too, for the same reason.
  let fpInside = 0, fpOnZeroTruth = 0;
  for (const cl of clusters) {
    const units = c.units.filter((u) => cl.keys.has(u.entitlementRef));
    const found = units.filter((u) => u.state === "UNDER_BILLED").reduce((n, u) => n + (u.residualMinor ?? 0), 0);
    const planted = cl.cases
      .filter((t) => t.authoritative_exposure_minor !== "UNKNOWN")
      .reduce((n, t) => n + Number(t.authoritative_exposure_minor), 0);
    fpInside += Math.max(0, found - planted);
    if (planted === 0) fpOnZeroTruth += found;
  }

  board.push({
    candidate: c.candidate, constructible: true, describes: c.describes,
    expectationKey: c.expectationKey, observationKey: c.observationKey, aliasCount: c.aliasCount,
    unitCount: c.unitCount, coverage: c.coverage, witness: c.witness,
    attributionClusters: clusters.length,
    casesNotIndividuallyAttributable: [...sharedKeyCases].sort(),
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

writeFileSync(`${DIR}/scoreboard.json`, `${JSON.stringify({
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
  out += `  attribution clusters ${b.attributionClusters} of ${truth.length} cases`;
  out += b.casesNotIndividuallyAttributable.length
    ? ` · NOT INDIVIDUALLY ATTRIBUTABLE at this grain: ${b.casesNotIndividuallyAttributable.join(", ")}\n`
    : ` · every case individually attributable\n`;
  out += `  per mechanism:\n`;
  for (const p of b.perCase) {
    const want = p.plantedMinor === null ? "UNKNOWN" : d(p.plantedMinor);
    out += `    ${p.mechanism.padEnd(32)} n=${String(p.cohort).padStart(2)} truth ${want.padStart(10)}`;
    out += p.attributable ? ` found ${d(p.positiveMinor).padStart(10)}` : `   NOT-ATTRIB${"".padStart(5)}`;
    out += ` paired ${d(p.pairedMinor).padStart(9)} refused ${String(p.refusedUnits).padStart(3)}`;
    out += `  ${p.states.join("+") || "(no units)"}\n`;
  }
}
writeFileSync(`${DIR}/report.txt`, out);
process.stdout.write(out);
