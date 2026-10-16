/**
 * THE LOCAL PILOT-PAIR READINESS CORE — pure, read-only, and testable.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE CLI, which is an integration correction rather than a
 * preference. As supplied, the whole command was top-level statements: reading argv, touching the
 * filesystem and writing stdout the moment the module was imported. Code that executes on import cannot
 * be imported by a test, so **none of its claims could be falsified** — and its claims are the
 * interesting part: that it prints no source row, no identifier, no amount and no path. So the logic
 * lives here behind an exported function, the entry point keeps argv and I/O, and the assertions below
 * are checked rather than asserted in a comment.
 *
 * WHAT THIS CAN AND CANNOT DO. It answers *can a real, independently sourced pair of CSV exports be read
 * and validated at all* — before any pilot customer exists. It computes no money, persists nothing,
 * creates no Recovery Case, opens no network connection, and **cannot establish provenance**: with no
 * attestation it reports `SOURCE_NATIVE` and every level stays PROVISIONAL, which is the honest ceiling.
 */
import { validateExpectationExtract } from "../../src/contract/expectationExtractValidator";
import { validateBillingExtract } from "../../src/contract/billingExtractValidator";
import { evaluateDataReadiness, type ReadinessReport } from "../../src/contract/dataReadiness";
import { CsvTransportError, parseStrictCsv } from "./csvPairTransport";

/** The governed reading term. Stated by the operator, never inferred from the files. */
export interface PairTerms {
  readonly currency: string;
}

export interface PairAssessment {
  readonly report: ReadinessReport;
  /** 0 when both extracts are usable, 2 when either is not. The report is emitted either way. */
  readonly exitCode: 0 | 2;
}

/**
 * Read both CSVs through the real governed validators and the real readiness evaluator.
 *
 * It takes the file CONTENTS, not paths: a function that reads the disk could not be tested without
 * fixtures on it, and keeping I/O at the edge is what makes the redaction property checkable.
 */
export function assessPairFromCsv(
  expectationCsv: string,
  billingCsv: string,
  terms: PairTerms,
): PairAssessment {
  const expectation = parseStrictCsv(expectationCsv);
  const billing = parseStrictCsv(billingCsv);
  const e = validateExpectationExtract(expectation.header, expectation.rows, { currency: terms.currency });
  const b = validateBillingExtract(billing.header, billing.rows, { currency: terms.currency });
  // No attestation and no submission object: nothing here can raise authority, and the evaluator has no
  // parameter by which this CLI could claim it did.
  const report = evaluateDataReadiness(e, b);
  return { report, exitCode: e.usable && b.usable ? 0 : 2 };
}

/**
 * Parse the command line. Exported so the refusals are falsifiable rather than merely intended.
 *
 * Exactly three flags, each once, no inference. `--currency` is required because it is a governed
 * reading term: guessing it from the rows would let the file decide which rows count.
 */
export function parseArguments(argv: readonly string[]): { expectation: string; billing: string; currency: string } {
  const expected = new Set(["--expectation", "--billing", "--currency"]);
  if (argv.length !== 6) throw new CsvTransportError("ARGUMENTS_INVALID");
  const seen: Record<string, string> = Object.create(null);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1]!;
    if (!expected.has(flag) || !value || value.startsWith("--") || flag in seen) {
      throw new CsvTransportError("ARGUMENTS_INVALID");
    }
    seen[flag] = value;
  }
  const currency = seen["--currency"]!;
  if (!/^[A-Z]{3}$/.test(currency)) throw new CsvTransportError("ARGUMENTS_INVALID");
  return { expectation: seen["--expectation"]!, billing: seen["--billing"]!, currency };
}

/**
 * WHAT THE OPERATOR IS TOLD BEFORE THE REPORT, so a local run cannot be mistaken for a finding.
 *
 * Printed, not merely documented. A JSON blob on a terminal invites the reading "NH assessed our data",
 * and the two sentences that matter — no money, no provenance — are the ones a reader supplies for
 * themselves if we do not.
 */
export const PAIR_RUN_PREAMBLE: readonly string[] = Object.freeze([
  "NH local readiness run — validation only.",
  "This reports whether two independently sourced exports can be READ and VALIDATED. It computes no",
  "money, finds no leakage, creates no case and persists nothing.",
  "Authority is UNVERIFIED and every level is PROVISIONAL: a local file cannot establish where it came",
  "from. This output is not evidence of recovered revenue.",
]);
