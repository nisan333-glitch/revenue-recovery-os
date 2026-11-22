// THE PAIR ASSESSMENT · two CSV exports, read through the REAL validators and the REAL readiness
// evaluator, with no second implementation of either.
//
// WHY IT LIVES HERE AND NOT UNDER `scripts/`, which is where it was written. The two-extract pilot
// intake route needs exactly this, and production code may not import from `scripts/` — nothing in
// `server/` or `src/` ever has. The alternatives were both worse than moving it:
//
//   * the server re-implements parse → validate → evaluate. A SECOND IMPLEMENTATION OF ONE RULE, and
//     the one that disagreed would be the one a real customer's file met.
//   * the server imports from `scripts/`. That inverts the dependency and puts a CLI's lifetime in
//     the production path.
//
// So the function moved and `scripts/data-readiness/assessPairCore.ts` re-exports it. A test asserts
// the two are the SAME FUNCTION OBJECT — identity, not agreement — because *a finite agreement is
// necessary evidence of equivalence and never a proof of it*.
//
// IT COMPUTES NO MONEY AND PERSISTS NOTHING. It answers whether a pair can be read and validated, and
// at what readiness level. It cannot establish provenance: with no attestation the ceiling is
// `SOURCE_NATIVE` and every level stays PROVISIONAL.

import { validateExpectationExtract } from "./expectationExtractValidator";
import { validateBillingExtract } from "./billingExtractValidator";
import { evaluateDataReadiness, type ReadinessReport } from "./dataReadiness";
import { parseStrictCsv, type CsvTransport } from "./csvPairTransport";

/** The governed reading term. Stated by the operator, never inferred from the files. */
export interface PairTerms {
  readonly currency: string;
}

export interface PairAssessment {
  readonly report: ReadinessReport;
  /** 0 when both extracts are usable, 2 when either is not. The report is emitted either way. */
  readonly exitCode: 0 | 2;
  /**
   * The parsed transports, so a caller that must go on to DO something with the rows does not parse
   * them a second time.
   *
   * RETURNED RATHER THAN RE-DERIVED BY THE CALLER, for the reason this module exists at all: a second
   * parse is a second chance to disagree about what the file says. The intake route hands these to
   * the reconciliation observer; the CLI ignores them.
   */
  readonly transport: { readonly expectation: CsvTransport; readonly billing: CsvTransport };
}

/**
 * Read both CSVs through the real governed validators and the real readiness evaluator.
 *
 * It takes the file CONTENTS, not paths: a function that reads the disk could not be tested without
 * fixtures on it, and keeping I/O at the edge is what makes the redaction property checkable.
 *
 * It throws `CsvTransportError` when either file is not readable as CSV at all — that is a transport
 * fault about the INPUT and it carries its own code, distinct from a contract-level extract fault.
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
  // No attestation and no submission object: nothing here can raise authority, and the evaluator has
  // no parameter by which a caller could claim it did.
  const report = evaluateDataReadiness(e, b);
  return Object.freeze({
    report,
    exitCode: e.usable && b.usable ? 0 : 2,
    transport: Object.freeze({ expectation, billing }),
  });
}
