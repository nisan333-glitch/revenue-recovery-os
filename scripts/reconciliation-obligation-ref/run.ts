// Run the OBLIGATION-REFERENCE COUNTERFACTUAL. The only file in this harness that touches the product.
//
// IT NEVER READS THE GROUND TRUTH. It reads the two variant exports and writes `results.json`; the
// scorer is the only thing that opens the answer key, and `verify.mjs` asserts the separation.
//
// THREE CANDIDATES, AND TWO OF THEM ARE CONTROLS. A counterfactual that only reports the new reading
// cannot show that the new FACT moved the money rather than the new CODE. So the same variant exports
// are also run through the UNMODIFIED core at the two grains V3 reports, ignoring the new column
// entirely. Those two must reproduce V3's figures exactly; the scorer prints all three side by side.
import { readFileSync, writeFileSync } from "node:fs";
import { GRAIN_CANDIDATES, type RawExpectation, type RawObservation } from "../../src/benchmark/grainCandidates";
import { reconcile, reconciliationWitness, type GovernedReconciliationTerms } from "../../src/benchmark/reconciliationCore";
import {
  reconcileWithObligationIdentity, obligationReconciliationWitness,
  type ObligationObservationRow,
} from "../../src/benchmark/obligationAwareReconciliation";

const DIR = "e2e/fixtures/reconciliation-obligation-ref";

// @ts-expect-error — the harness gate is plain JS beside this file, deliberately product-free.
const { assertFrozen } = await import("./freeze.mjs");
assertFrozen("REFUSING TO RUN");

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

const payerHierarchy: Record<string, string> = {};
for (const r of expectationsRaw) {
  const parent = (r.parent_account_id ?? "").trim();
  const child = (r.payer_account_id ?? "").trim();
  if (parent !== "" && child !== "") payerHierarchy[child] = parent;
}
const baseTerms = { currency: "USD", invoicingGracePeriods: 1, payerHierarchy: Object.freeze(payerHierarchy) };

const unitDetail = (us: readonly {
  entitlementRef: string; periodStart: string; state: string;
  residualMinor: number | null; expectedMinor: number | null; observedMinor: number;
  pairedWith: { mechanism: string } | null;
}[]) => us.map((u) => ({
  entitlementRef: u.entitlementRef, periodStart: u.periodStart, state: u.state,
  residualMinor: u.residualMinor, expectedMinor: u.expectedMinor, observedMinor: u.observedMinor,
  pairedMechanism: u.pairedWith?.mechanism ?? null,
}));

const results: unknown[] = [];

// ── The two CONTROLS · the unmodified core, blind to the new column ─────────────────────────────
for (const id of ["A_SUBSCRIPTION", "E_SUBSCRIPTION_WITH_LEGACY_ALIAS"] as const) {
  const c = GRAIN_CANDIDATES.find((x) => x.id === id)!;
  const { expectations, observations, aliases } = c.adapt(expectationsRaw, observationsRaw);
  const terms: GovernedReconciliationTerms = { ...baseTerms, identityAliases: aliases };
  const r = reconcile(expectations, observations, terms);
  results.push({
    candidate: id, constructible: true, role: "CONTROL · unmodified core, obligation_ref ignored",
    describes: c.describes, expectationKey: c.expectationKey, observationKey: c.observationKey,
    aliasCount: Object.keys(aliases).length,
    scheme: r.scheme, methodVersion: r.methodVersion,
    witness: await reconciliationWitness(expectations, observations, terms, r),
    coverage: r.coverage,
    unpairedPositiveMinor: r.unpairedPositiveMinor, pairedPositiveMinor: r.pairedPositiveMinor,
    grossPositiveMinor: r.grossPositiveMinor, grossNegativeMinor: r.grossNegativeMinor,
    unpricedExpectationCount: r.unpricedExpectationCount, refusedUnitCount: r.refusedUnitCount,
    unitCount: r.units.length,
    stateCounts: r.units.reduce<Record<string, number>>((a, u) => { a[u.state] = (a[u.state] ?? 0) + 1; return a; }, {}),
    units: unitDetail(r.units),
    claimBoundary: r.claimBoundary,
  });
}

// ── The READING UNDER TEST · the same data, with the obligation references consulted ────────────
//
// The key is still the ENTITLEMENT. The obligation reference is used as EVIDENCE — to resolve a
// re-keyed billing identity, and to refute a timing-displacement pairing — and never as the grain.
// Keying units by obligation would also have made every reading unscoreable against a truth that
// names entitlements, which is a measurement reason on top of the semantic one.
{
  const a = GRAIN_CANDIDATES.find((x) => x.id === "A_SUBSCRIPTION")!;
  const { expectations } = a.adapt(expectationsRaw, observationsRaw);
  const observations: ObligationObservationRow[] = observationsRaw.map((r) => Object.freeze({
    invoiceRef: r.invoice_id ?? "",
    entitlementRef: r.subscription_id ?? "",
    customerRef: r.payer_account_id ?? "",
    periodStart: r.period_start ?? "",
    periodEnd: r.period_end ?? "",
    billedAmountMinor: (() => {
      const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec((r.billed_amount ?? "").trim());
      if (!m) return 0;
      const n = Number(`${m[2]}${(m[3] ?? "").padEnd(2, "0")}`);
      return m[1] === "-" ? -n : n;
    })(),
    currency: (r.currency ?? "").toUpperCase(),
    isCredit: (r.is_credit ?? "").trim().toLowerCase() === "true",
    // NO ALIAS MAP IS SUPPLIED. If identity resolves, it resolved from the source's own reference.
    obligationRef: (r.obligation_ref ?? "").trim() === "" ? null : (r.obligation_ref ?? "").trim(),
  }));
  const terms: GovernedReconciliationTerms = { ...baseTerms, identityAliases: Object.freeze({}) };
  const r = reconcileWithObligationIdentity(expectations, observations, terms);
  results.push({
    candidate: "F_OBLIGATION_REF", constructible: true,
    role: "READING UNDER TEST · obligation references consulted, NO alias map",
    describes:
      "Candidate A's grain, with the billing side's own statement of which contract obligation each invoice line settles. The fact C_SCHEDULE_LINE names as missing, supplied by the source.",
    expectationKey: "entitlement_id (obligation: schedule_line_id)",
    observationKey: "obligation_ref -> schedule_line_id -> entitlement_id",
    aliasCount: 0,
    scheme: r.scheme, methodVersion: r.methodVersion, underlyingMethodVersion: r.underlyingMethodVersion,
    witness: await obligationReconciliationWitness(expectations, observations, terms, r),
    coverage: r.coverage, obligationCoverage: r.obligationCoverage,
    unpairedPositiveMinor: r.unpairedPositiveMinor, pairedPositiveMinor: r.pairedPositiveMinor,
    grossPositiveMinor: r.grossPositiveMinor, grossNegativeMinor: r.grossNegativeMinor,
    unpricedExpectationCount: r.unpricedExpectationCount, refusedUnitCount: r.refusedUnitCount,
    unitCount: r.units.length,
    stateCounts: r.units.reduce<Record<string, number>>((acc, u) => { acc[u.state] = (acc[u.state] ?? 0) + 1; return acc; }, {}),
    unkeyedObservationCount: r.unkeyedObservationCount,
    refutedPairings: r.refutedPairings,
    obligationEventCounts: r.obligationEvents.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc; }, {}),
    obligationEvents: r.obligationEvents,
    units: unitDetail(r.units),
    claimBoundary: r.claimBoundary,
  });
}

writeFileSync(`${DIR}/results.json`, `${JSON.stringify({
  ranAt: "deterministic-no-clock",
  variant: "OBLIGATION_REF",
  expectationRows: expectationsRaw.length,
  observationRows: observationsRaw.length,
  payerHierarchyPairs: Object.keys(payerHierarchy).length,
  results,
}, null, 2)}\n`);

process.stdout.write(`ran 2 controls + 1 reading under test -> ${DIR}/results.json\n`);
