// EVERY MONETARY FIGURE IN THE AUDIT REPORT MUST TRACE TO A SOURCE.
//
// This is the guard the audit most needs, because an audit's own figures are exactly the thing nobody
// re-checks. A report is prose, and prose is where a number drifts from the measurement it came from —
// this repository has already paid for that with a `+32.5%` uplift figure reaching a customer-facing
// draft and with a stale `settled_at` caveat surviving two slices.
//
// THE RULE: a dollar amount in `docs/NH_DIAGNOSTIC_AUDIT_V2.md` is admissible only if it is
//
//   (a) present as a minor-unit integer in a TRACKED source — a frozen baseline, the tracked 2026-09-27
//       score, or the dated re-measurement output; or
//   (b) declared below as DERIVED, with its arithmetic recomputed here from source figures.
//
// A figure that is neither fails the build. $0.00 is exempt: it is the absence of money, it appears in
// every ledger, and requiring it to "trace" would be theatre.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const REPORT = "docs/NH_DIAGNOSTIC_AUDIT_V2.md";

/** The tracked sources a figure may come from. Each is verified by its own CI verifier. */
const SOURCES = [
  "docs/audit/cycle2-remeasured-2026-10-16.json",
  "e2e/fixtures/synthetic-validation-2026-09-27/score.json",
  "e2e/fixtures/synthetic-validation-2026-09-27/ground-truth.json",
  "e2e/fixtures/reconciliation-synthetic/baseline.v3.postcapability.json",
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.postcapability.json",
  // The PRE-pairing variant baseline. Added because this guard caught $9,800.00 as an orphan: the report
  // quoted the obligation-reference unlock from the constitution, and the figure is a DELTA between two
  // baselines rather than a value in either. Exactly the drift this test exists to catch, caught in the
  // report it was written for.
  "e2e/fixtures/reconciliation-obligation-ref/baseline.variant.json",
] as const;

/**
 * Figures the report DERIVES, each with the source figures it is derived from.
 *
 * Declared rather than inferred, for the reason the ground-truth transport defect established: a
 * schema — or here, an admissibility list — read off a sample of its own rows cannot detect the row it
 * missed. Each entry's arithmetic is recomputed below, so a derived figure cannot be quietly wrong.
 */
const DERIVED: Readonly<Record<string, { readonly from: readonly number[]; readonly reduce: (xs: readonly number[]) => number }>> = {
  // Representable money = planted total − not-representable. The report's central claim is that this
  // equals detected money exactly, so if either side drifts this test fails rather than the claim.
  "$57,150.66": { from: [12225066, 6510000], reduce: ([a, b]) => a! - b! },
  // Detector #2's closed gap = S17 + S18.
  "$14,800.00": { from: [550000, 930000], reduce: ([a, b]) => a! + b! },
  // Lane B headline claimable on the variant = detected positive − paired held out.
  "$79,846.00": { from: [8204600, 220000], reduce: ([a, b]) => a! - b! },
  // The obligation-reference unlock = the money the pairing hold released between the V3 baseline and
  // the pre-pairing variant, i.e. the difference of the two `pairedHeldOutMinor` figures. Derived from
  // both tracked baselines rather than quoted, because a delta exists in neither file.
  "$9,800.00": { from: [2180000, 1200000], reduce: ([a, b]) => a! - b! },
};

const toMinor = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);

/** Every integer appearing anywhere in a JSON source, so a minor-unit figure can be looked up. */
function minorUnitsIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/-?\d+/g)) out.add(Number(m[0]));
  return out;
}

describe("audit report · every monetary figure traces to a tracked source", () => {
  const report = read(REPORT);
  const figures = [...new Set([...report.matchAll(/\$[0-9][0-9,]*\.[0-9]{2}/g)].map((m) => m[0]))].sort();
  const universe = new Set<number>();
  for (const s of SOURCES) for (const n of minorUnitsIn(read(s))) universe.add(n);

  it("1 · the report contains monetary figures at all, so this guard has a subject", () => {
    // A guard whose subject could vanish is not a guard. If the report is ever rewritten without
    // figures, this fails loudly rather than passing vacuously.
    expect(figures.length).toBeGreaterThan(10);
    expect(universe.size).toBeGreaterThan(100);
  });

  it("2 · EVERY figure is either in a tracked source or a declared derivation", () => {
    const orphans: string[] = [];
    for (const f of figures) {
      if (f === "$0.00") continue; // the absence of money needs no provenance
      const minor = toMinor(f);
      if (universe.has(minor)) continue;
      const d = DERIVED[f];
      if (d && d.reduce(d.from) === minor) continue;
      orphans.push(f);
    }
    expect(orphans, `figures with no tracked source and no declared derivation: ${orphans.join(", ")}`).toEqual([]);
  });

  it("3 · every DECLARED derivation's inputs are themselves in a tracked source", () => {
    // Otherwise a derivation could launder an invented number through arithmetic.
    for (const [figure, d] of Object.entries(DERIVED)) {
      for (const input of d.from) {
        expect(universe.has(input), `${figure} derives from ${input}, which is in no tracked source`).toBe(true);
      }
      expect(d.reduce(d.from), figure).toBe(toMinor(figure));
    }
  });

  it("4 · THE GUARD CAN FAIL · an invented figure is rejected", () => {
    // A test that cannot fail is not a control. $77,777.77 appears in no source and no derivation.
    const invented = "$77,777.77";
    expect(universe.has(toMinor(invented))).toBe(false);
    expect(DERIVED[invented]).toBeUndefined();
    // ...and the report does not contain it, which is what makes test 2 meaningful rather than lucky.
    expect(report).not.toContain(invented);
  });

  it("5 · the three headline claims are stated with their lane and their qualifier", () => {
    // The report's central job per its own §0a. Checked as CLAIMS, not as terms: each requires the
    // figure and its qualifier to co-occur, because this repository's recurring defect is a guard that
    // matches a word rather than an assertion.
    const benchmarkPara = report.slice(report.indexOf("$62,446.00") - 600, report.indexOf("$62,446.00") + 600);
    expect(benchmarkPara).toMatch(/benchmark|zero production callers/i);
    expect(report).toMatch(/no observed amount is Revenue Returned|no observed amount became Revenue Returned/i);
    expect(report).toMatch(/NOT ESTABLISHED/);
  });

  it("6 · it carries no forecast, no estimate and no uplift percentage presented as a finding", () => {
    // The ban the pilot-intake verifier learned to apply to customer documents, applied here: a
    // percentage change is the form in which a synthetic result gets quoted as a business projection.
    expect(report).not.toMatch(/\bROI\b/);
    expect(report).not.toMatch(/projected revenue|expected revenue|forecast(ed)? (recovery|revenue)/i);
  });

  it("7 · V1 is preserved and marked, not rewritten", () => {
    const v1 = read("docs/NH_DISCOVERY_COVERAGE_AUDIT_V1.md");
    expect(v1).toMatch(/SUPERSEDED IN PART/);
    expect(v1).toContain("NH_DIAGNOSTIC_AUDIT_V2.md");
    // Its original scores must still be readable, or "preserved" is a word rather than a fact.
    expect(v1).toContain("## 7 · The three scores");
    expect(v1).toMatch(/27\.3% of classes \/ 34\.6% of money/);
  });
});
