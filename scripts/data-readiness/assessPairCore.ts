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
// MOVED, 2026-11-22: `assessPairFromCsv` now lives in `src/contract/pairAssessment.ts` so the
// two-extract pilot intake route can use the SAME function. Production code may not import from
// `scripts/`, and copying parse → validate → evaluate into the server would have been a second
// implementation of one rule. This file re-exports it and keeps the CLI's own argument parsing, which
// is genuinely a CLI concern. A test asserts the re-export is the same function object.
export { assessPairFromCsv, type PairAssessment, type PairTerms } from "../../src/contract/pairAssessment";
export { CsvTransportError } from "./csvPairTransport";
// Imported as a VALUE as well, because the argument/exit helpers below still catch it.
import { CsvTransportError } from "./csvPairTransport";

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
