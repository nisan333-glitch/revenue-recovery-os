// THE PILOT ACCEPTANCE REPORT. Pure: no clock, no I/O, no randomness, no database.
//
// WHAT IT IS FOR. The acceptance journey drives one governed loop per scenario and records, for each,
// how far it got and what stopped it. This module turns those records into the artefact an owner reads.
// It is separate from the driver for the reason this repository keeps re-learning: a command whose
// claims cannot be imported cannot be falsified, so the formatting rules are tested from fixtures here
// and the driver only gathers.
//
// THE REPORT'S ONE JOB IS TO KEEP THREE THINGS APART. What is PROVEN, what is REFUSED and why, and what
// was never reached at all. A scenario that stopped at stage 4 has not "failed stage 8" — it never got
// there, and collapsing the two would turn an absence into a finding. Same rule as NOT COMPUTED versus
// $0.00, one level up.

/** The eight stages of the governed loop, in order. A scenario reaches a prefix of these. */
export const ACCEPTANCE_STAGES = Object.freeze([
  "opportunity",            // 1 · a genuine recovery opportunity exists in the source data
  "detection_and_case",     // 2 · a detector signal becomes a candidate, and a case root is created
  "candidate_review",       // 3 · a human accepts the candidate; acceptance is not promotion
  "correction_evidence",    // 4 · a source-attested record that the correction was EXECUTED
  "collection_evidence",    // 5 · a source-attested record that the money ARRIVED
  "reconciliation",         // 6 · identity, absorption and duplicate checks
  "proven_decision",        // 7 · the PROVEN eligibility decision, either way
  "audit_evidence",         // 8 · the Correction Ledger and the CFO-facing audit read
] as const);

export type AcceptanceStage = (typeof ACCEPTANCE_STAGES)[number];

export type ScenarioOutcome =
  /** The loop completed and a proof was frozen. `provenMinor` is the figure the kernel computed. */
  | { readonly kind: "PROVEN"; readonly provenMinor: number; readonly exposureMinor: number }
  /** The loop was refused at a named stage, for a named reason. NOT a failure of the journey. */
  | { readonly kind: "REFUSED"; readonly atStage: AcceptanceStage; readonly code: string; readonly detail: string }
  /** The journey could not establish the scenario at all — our own fault, never the data's. */
  | { readonly kind: "NOT_RUN"; readonly why: string };

export interface ScenarioRecord {
  readonly id: string;
  readonly intent: string;
  /** What the scenario was PRE-REGISTERED to do, written before it ran. */
  readonly expected: "PROVEN" | "REFUSED";
  readonly stagesReached: readonly AcceptanceStage[];
  readonly outcome: ScenarioOutcome;
}

export interface AcceptanceTotals {
  readonly scenarios: number;
  readonly proven: number;
  readonly refused: number;
  readonly notRun: number;
  /** Sum of frozen proofs. Synthetic in every run of this journey. */
  readonly provenMinor: number;
  /** Sum of identified exposure on the PROVEN scenarios only. Never added to `provenMinor`. */
  readonly provenScenarioExposureMinor: number;
}

export interface AcceptanceReport {
  readonly scheme: "nh-pilot-acceptance-v1";
  readonly scenarios: readonly ScenarioRecord[];
  readonly totals: AcceptanceTotals;
  /** Every scenario whose outcome differs from what it was pre-registered to do. */
  readonly surprises: readonly string[];
  readonly verdict: "ACCEPTED" | "NOT_ACCEPTED";
}

export const ACCEPTANCE_SCHEME = "nh-pilot-acceptance-v1" as const;

/**
 * Build the report. TOTAL AND DETERMINISTIC — the same records always produce a byte-identical report.
 *
 * THE VERDICT IS NOT "EVERYTHING PASSED". It is "every scenario did what it was pre-registered to do",
 * which is a different and stricter claim: a refusal that was expected is a PASS, and a proof that was
 * not expected is a FAILURE. Scoring a journey by how much money it proved would reward exactly the
 * behaviour the trust invariant forbids.
 */
export function buildAcceptanceReport(scenarios: readonly ScenarioRecord[]): AcceptanceReport {
  const proven = scenarios.filter((s) => s.outcome.kind === "PROVEN");
  const refused = scenarios.filter((s) => s.outcome.kind === "REFUSED");
  const notRun = scenarios.filter((s) => s.outcome.kind === "NOT_RUN");
  const surprises = scenarios
    .filter((s) => s.outcome.kind === "NOT_RUN" || s.outcome.kind !== s.expected)
    .map((s) =>
      s.outcome.kind === "NOT_RUN"
        ? `${s.id}: NOT RUN — ${s.outcome.why}`
        : `${s.id}: expected ${s.expected}, got ${s.outcome.kind}`,
    );
  return Object.freeze({
    scheme: ACCEPTANCE_SCHEME,
    scenarios: Object.freeze([...scenarios]),
    totals: Object.freeze({
      scenarios: scenarios.length,
      proven: proven.length,
      refused: refused.length,
      notRun: notRun.length,
      provenMinor: proven.reduce((t, s) => t + (s.outcome.kind === "PROVEN" ? s.outcome.provenMinor : 0), 0),
      provenScenarioExposureMinor: proven.reduce(
        (t, s) => t + (s.outcome.kind === "PROVEN" ? s.outcome.exposureMinor : 0),
        0,
      ),
    }),
    surprises: Object.freeze(surprises),
    verdict: surprises.length === 0 ? "ACCEPTED" : "NOT_ACCEPTED",
  });
}

const money = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
const pad = (n: number): string => new Array(n + 1).join(" ");

/**
 * Render the report for a human.
 *
 * THE TWO FIGURES NEVER MERGE. Identified exposure and proven return are printed as separate lines with
 * separate totals, and this renderer has no expression that adds them — because a single number
 * combining a forecast with a proof is the one output this product must never produce.
 */
export function formatAcceptanceReport(report: AcceptanceReport): string {
  const L: string[] = [];
  L.push("PILOT ACCEPTANCE JOURNEY · SYNTHETIC DATA ONLY");
  L.push(`scheme: ${report.scheme}`);
  L.push("");
  L.push(`VERDICT: ${report.verdict}`);
  L.push(
    report.verdict === "ACCEPTED"
      ? "  every scenario did what it was pre-registered to do — refusals included."
      : "  at least one scenario did not do what it was pre-registered to do. See SURPRISES.",
  );
  L.push("");
  L.push("-- SCENARIOS --");
  for (const s of report.scenarios) {
    const reached = `${s.stagesReached.length}/8`;
    if (s.outcome.kind === "PROVEN") {
      L.push(
        `  ${s.id.padEnd(24)} ${reached}  PROVEN   identified ${money(s.outcome.exposureMinor)}` +
          ` · returned ${money(s.outcome.provenMinor)}`,
      );
    } else if (s.outcome.kind === "REFUSED") {
      L.push(`  ${s.id.padEnd(24)} ${reached}  REFUSED  at ${s.outcome.atStage} · ${s.outcome.code}`);
      L.push(`  ${pad(24)}       ${s.outcome.detail}`);
    } else {
      L.push(`  ${s.id.padEnd(24)} ${reached}  NOT RUN  ${s.outcome.why}`);
    }
    L.push(`  ${pad(24)}       intent: ${s.intent}`);
  }
  L.push("");
  L.push("-- TOTALS --");
  L.push(`  scenarios            ${report.totals.scenarios}`);
  L.push(`  proven               ${report.totals.proven}`);
  L.push(`  refused (expected)   ${report.totals.refused}`);
  L.push(`  not run              ${report.totals.notRun}`);
  L.push("");
  // THE TWO LEDGERS, PRINTED APART. Revenue Opportunity is a forecast and is never counted as money;
  // Revenue Returned is `Collected - Baseline` and is the only figure that was proven.
  L.push(
    `  identified exposure on the PROVEN scenarios  ${money(report.totals.provenScenarioExposureMinor)}` +
      "   (Revenue Opportunity - NOT money)",
  );
  L.push(
    `  Revenue Returned, frozen in proofs           ${money(report.totals.provenMinor)}` +
      "   (Collected - Baseline)",
  );
  L.push("");
  L.push("  These two figures are never added. The first is a forecast of what is at stake; the second");
  L.push("  is what a source the beneficiary cannot alter attested arrived, minus a baseline locked");
  L.push("  before the outcome was known.");
  if (report.surprises.length > 0) {
    L.push("");
    L.push("-- SURPRISES --");
    for (const s of report.surprises) L.push(`  ${s}`);
  }
  L.push("");
  L.push("SYNTHETIC. Every figure above was generated by this journey. Nothing here is a claim about any");
  L.push("customer's book, and no observed amount became Revenue Returned.");
  return L.join("\n");
}
