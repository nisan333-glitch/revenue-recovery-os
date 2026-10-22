// Run every CONSTRUCTIBLE grain candidate through the unmodified reconciliation core and write the raw
// readings. This is the only file in the harness that touches the product.
//
// IT NEVER READS THE GROUND TRUTH. It reads the two exports and writes `results.json`; the scorer is
// the only thing that opens the answer key, and `verify.mjs` asserts the separation over the tree.
import { readFileSync, writeFileSync } from "node:fs";
import {
  GRAIN_CANDIDATES, type RawExpectation, type RawObservation,
} from "../../src/benchmark/grainCandidates";
import { reconcile, reconciliationWitness, type GovernedReconciliationTerms } from "../../src/benchmark/reconciliationCore";

const DIR = "e2e/fixtures/reconciliation-synthetic";

// NH MAY NOT RUN ON AN UNFROZEN PACKAGE. Checked here and not only at scoring time, because the order
// the control requires is generate -> validate -> FREEZE -> run -> score, and a run taken before the
// freeze would already have seen the data it is supposed to be blind to.
// @ts-expect-error — the harness gate is plain JS beside this file, deliberately product-free.
const { assertFrozen } = await import("./freeze.mjs");
assertFrozen("REFUSING TO RUN");

/** Minimal CSV reader: the generator quotes only when it must, and nothing here contains newlines. */
function readCsv(path: string): Readonly<Record<string, string>>[] {
  const [header, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = header!.split(",");
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.freeze(Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])));
  });
}

const expectationsRaw = readCsv(`${DIR}/expectation.csv`) as RawExpectation[];
const observationsRaw = readCsv(`${DIR}/observation.csv`) as RawObservation[];

/**
 * The governed terms. Every authoritative relation is SUPPLIED, never inferred — the payer hierarchy
 * is read from the contract export's own `parent_account_id`, which is the source stating the relation
 * rather than NH deriving one from a name.
 */
const payerHierarchy: Record<string, string> = {};
for (const r of expectationsRaw) {
  const parent = (r.parent_account_id ?? "").trim();
  const child = (r.payer_account_id ?? "").trim();
  if (parent !== "" && child !== "") payerHierarchy[child] = parent;
}

const results: unknown[] = [];
for (const c of GRAIN_CANDIDATES) {
  if (c.notConstructible !== null) {
    results.push({
      candidate: c.id, constructible: false, reason: c.notConstructible,
      expectationKey: c.expectationKey, observationKey: c.observationKey,
    });
    continue;
  }
  const { expectations, observations, aliases } = c.adapt(expectationsRaw, observationsRaw);
  const terms: GovernedReconciliationTerms = {
    currency: "USD",
    invoicingGracePeriods: 1,
    payerHierarchy: Object.freeze(payerHierarchy),
    identityAliases: aliases,
  };
  const r = reconcile(expectations, observations, terms);
  results.push({
    candidate: c.id, constructible: true,
    describes: c.describes, expectationKey: c.expectationKey, observationKey: c.observationKey,
    aliasCount: Object.keys(aliases).length,
    scheme: r.scheme, methodVersion: r.methodVersion,
    witness: await reconciliationWitness(expectations, observations, terms, r),
    coverage: r.coverage,
    unpairedPositiveMinor: r.unpairedPositiveMinor,
    pairedPositiveMinor: r.pairedPositiveMinor,
    grossPositiveMinor: r.grossPositiveMinor,
    grossNegativeMinor: r.grossNegativeMinor,
    unpricedExpectationCount: r.unpricedExpectationCount,
    refusedUnitCount: r.refusedUnitCount,
    unitCount: r.units.length,
    stateCounts: r.units.reduce<Record<string, number>>((acc, u) => {
      acc[u.state] = (acc[u.state] ?? 0) + 1;
      return acc;
    }, {}),
    // Per-unit detail, so the scorer can attribute money to a planted case without the core knowing
    // anything about planted cases.
    units: r.units.map((u) => ({
      entitlementRef: u.entitlementRef, periodStart: u.periodStart, state: u.state,
      residualMinor: u.residualMinor, expectedMinor: u.expectedMinor, observedMinor: u.observedMinor,
      pairedMechanism: u.pairedWith?.mechanism ?? null,
    })),
    claimBoundary: r.claimBoundary,
  });
}

writeFileSync(`${DIR}/results.json`, `${JSON.stringify({
  ranAt: "deterministic-no-clock",
  expectationRows: expectationsRaw.length,
  observationRows: observationsRaw.length,
  payerHierarchyPairs: Object.keys(payerHierarchy).length,
  results,
}, null, 2)}\n`);

process.stdout.write(`ran ${GRAIN_CANDIDATES.length} candidates (${results.filter((r) => (r as { constructible: boolean }).constructible).length} constructible) -> ${DIR}/results.json\n`);
