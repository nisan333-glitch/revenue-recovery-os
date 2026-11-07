// THE CFO PROOF REPORT · one row per obligation: detected, disputed, evidenced, open.
//
// WHAT A CFO IS ACTUALLY ASKING. Not "what does the system think it recovered" — that question invites
// the answer the constitution forbids. The four questions are: what did you find, what is in dispute,
// what of it is independently evidenced as collected, and what is still open. This report answers those
// four and refuses to blend them.
//
// THE CLAIMED COLLECTED FIGURE IS THE LITERAL `0`, AND THE TYPE CANNOT EXPRESS ANYTHING ELSE. That is the
// same treatment `constitutesProof: false as const` gets, for the same reason: the one number that must
// never become quotable as a positive is the one a reader will quote. A build that can genuinely claim
// collected money adds a new type rather than widening this field, and that is a reviewed change rather
// than an accident.
//
// AND THAT ZERO IS AN ASSERTION, NOT AN ABSENCE. `claimedCollectedIsAsserted` says so on every row. "We
// claim nothing" and "nobody computed it" are different statements: the first is a position NH takes and
// stands behind, the second is a gap. Everywhere else in this repository a monetary zero is suspect and
// `null` means not established — here the zero is the honest answer and the field beside it is what keeps
// the two readings apart.
//
// IT COMPUTES NO MONEY AND DERIVES FROM THE FINANCIAL TRACE. Every figure arrives from a record by way of
// `financialTrace`; the only arithmetic here is the open balance, and it is derived rather than passed so
// a caller cannot state a balance the two figures beside it do not support.
//
// PURE. No clock, no I/O, no randomness, no crypto.
import { addMoney, money, type Money } from "./money";

export const CFO_PROOF_REPORT_SCHEME = "nh-cfo-proof-report-v1";
export const CFO_PROOF_REPORT_VERSION = "1.0.0";

export type ObligationCoverageStated = "SINGLE_OBLIGATION" | "ACCOUNT_AGGREGATE" | "NOT_STATED";

/** The direction of a disputed magnitude. Magnitudes of opposite direction are NEVER netted. */
export type DisputeDirection = "UPWARD" | "DOWNWARD";

export interface CfoEvidenceSource {
  /** The source system as the evidence record states it. Our own column, not a customer identifier. */
  readonly sourceSystem: string;
  readonly trustClassification: string;
  /** Whether a source signature verified. NOT whether the signer is independent — see `attestationCode`. */
  readonly signatureVerified: boolean;
}

export interface CfoProofRowInput {
  readonly recoveryCaseId: string;
  readonly currency: string;
  readonly obligationCoverage: ObligationCoverageStated;
  /** `null` is NOT ESTABLISHED. Never zero. */
  readonly detectedExposureMinor: number | null;
  /** `null` where the observation order is not establishable, so the magnitude is unknowable. */
  readonly disputedAmountMinor: number | null;
  readonly disputedDirection: DisputeDirection | null;
  readonly disputedState: string;
  /** What the frozen proof chain computed. Carried FOR AUDIT and never as collected money. */
  readonly proofChainFigureMinor: number | null;
  readonly evidenceSources: readonly CfoEvidenceSource[];
  readonly attestationCode: string;
  readonly gateVerdict: string;
  readonly revenueReturnedWithheldCodes: readonly string[];
}

export interface CfoProofRow extends CfoProofRowInput {
  /**
   * WHAT NH CLAIMS IS INDEPENDENTLY EVIDENCED AS COLLECTED. The literal `0`, always, on this build.
   *
   * No evidence anywhere in this system is independently attested — the stored source receipt records no
   * holder, so a key NH generated and a key a customer's system holds are indistinguishable once
   * verification has succeeded. So the claim is nothing, and nothing is what this says.
   */
  readonly claimedIndependentlyEvidencedCollectedMinor: 0;
  /** The zero above is a POSITION NH TAKES, not a figure nobody computed. */
  readonly claimedCollectedIsAsserted: true;
  /**
   * `detectedExposureMinor − claimedIndependentlyEvidencedCollectedMinor`, derived here.
   *
   * Which on this build is the whole of the detected exposure: **every dollar identified is still open**.
   * `null` when exposure is not established — a zero balance would assert the account is settled.
   */
  readonly openBalanceMinor: number | null;
}

export type TotalsUnavailableReason = "currency_disagreement" | "no_rows";

export interface CfoProofTotals {
  readonly rowCount: number;
  /** `null` when nothing was established — never a clean zero over an empty or unestablished set. */
  readonly detectedExposureMinor: number | null;
  readonly exposureNotEstablishedCount: number;
  /**
   * The two dispute magnitudes, APART. An understatement and an overstatement are two problems and
   * their sum is zero problems, so there is no net dispute figure and no function returns one.
   */
  readonly disputedUpwardMinor: number | null;
  readonly disputedDownwardMinor: number | null;
  readonly disputedNotEstablishableCount: number;
  readonly claimedIndependentlyEvidencedCollectedMinor: 0;
  readonly openBalanceMinor: number | null;
  readonly unavailableReason: TotalsUnavailableReason | null;
}

/**
 * WHAT POPULATION THE MONETARY TOTALS COVER — and what they structurally cannot.
 *
 * The report enumerates GOVERNED ROOTS. So an obligation that never became a case is invisible to it:
 * one the detector refused, one awaiting review, one rejected at review, or an aggregate nobody
 * promoted. A reader seeing "detected $1,400.00 / open $1,400.00" would reasonably take that for the
 * book, so without this block the report's completeness is overstated BY OMISSION — the same family as
 * "an empty report is the same shape whether the book is clean or was never read".
 */
export interface CfoCoverage {
  /** Our own constant naming the population, so a renderer cannot describe it differently. */
  readonly population: "governed roots in this boundary";
  readonly governedRootsReported: number;
  /**
   * Candidates in this boundary with no governed root.
   *
   * `examined: true` is the point: a `0` HERE IS CORRECT, because the population was read and found
   * empty. That is a different claim from `refusedUpstreamExposure`, which cannot be read at all — and
   * the two are separate shapes rather than one nullable number, so the distinction cannot be lost in a
   * renderer.
   *
   * THE STATE IS DERIVED FROM THE REVIEW AND THE ROOT, NEVER FROM `status`:
   * `agent_case_candidates_status_valid` pins that column to `'pending_review'` for every row, so it is
   * inert by constraint and reading it would report every candidate as unreviewed.
   */
  readonly unpromotedCandidates: {
    readonly examined: true;
    readonly pendingReview: number;
    readonly rejected: number;
    readonly acceptedNotPromoted: number;
    /**
     * Σ of the amounts those candidates STATE. A DIFFERENT LEDGER from detected exposure, and never
     * added to it: a candidate's stated amount is a detector's claim, a case's exposure is a figure
     * frozen at promotion, and their sum is a number no record asserts. `null` when there are none.
     */
    readonly statedAmountMinor: number | null;
    readonly coverageKinds: readonly ObligationCoverageStated[];
  };
  /**
   * Exposure the detector refused upstream — now READ from the append-only task log.
   *
   * FOUR STATES, AND NOT ONE OF THEM IS A BARE ZERO.
   *
   *  - `NOT_RECORDED` · no succeeded run in this boundary carried an observation at all. Either the
   *    observer never ran here, or the runs predate the handler being able to record one. **Absence of
   *    the record is not absence of refusals**, which is why this is not `NONE_REFUSED`.
   *  - `NOT_EXAMINED` · a run recorded that it could not read the extract. Nobody looked, so "no
   *    refusals" would claim work that never happened.
   *  - `NONE_REFUSED` · the units were examined and none was refused. **This zero IS correct**, and it
   *    is the only state in which `refusedUnits: 0` means anything.
   *  - `UNDETERMINED` · units were refused. `refusedExpectedMinor` is what the CONTRACT side stated on
   *    them and is not in doubt; the residual is absent BY DESIGN, because the residual is exactly what
   *    the refusal is about and publishing one would be the authored figure the refusal prevents.
   *
   * `refusedExpectedMinor` IS NOT EXPOSURE and is never summed into any monetary total. Where
   * `refusedWithoutExpected` is above zero the expected total is a LOWER BOUND, and the count is
   * carried so a reader can see that rather than being told a complete figure.
   */
  readonly refusedUpstreamExposure:
    | {
        readonly state: "NOT_RECORDED";
        readonly establishable: false;
        readonly reason: string;
      }
    | {
        readonly state: "NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED";
        readonly establishable: true;
        readonly runsCarryingAnObservation: number;
        readonly refusedUnits: number;
        /** What the contract side stated on refused units. NOT exposure. `null` in NOT_EXAMINED. */
        readonly refusedExpectedMinor: number | null;
        readonly refusedWithoutExpected: number;
        readonly currency: string | null;
        readonly reason: string;
      };
  readonly completenessStatement: string;
}

export interface CfoProofReport {
  readonly scheme: typeof CFO_PROOF_REPORT_SCHEME;
  readonly version: typeof CFO_PROOF_REPORT_VERSION;
  readonly boundaryId: string;
  /** `null` when the rows disagree on currency, or there are none. */
  readonly currency: string | null;
  readonly rows: readonly CfoProofRow[];
  readonly totals: CfoProofTotals;
  readonly coverage: CfoCoverage;
  /** Non-null EXACTLY when there are no rows, and it says what that does and does not mean. */
  readonly emptyBoundaryNotice: string | null;
  readonly claimStatement: string;
  readonly disclosure: string;
}

const CLAIM_STATEMENT =
  "INDEPENDENTLY EVIDENCED AS COLLECTED: $0.00, and that zero is an assertion rather than a gap. No " +
  "evidence in this system is independently attested — the stored source receipt records no key holder, " +
  "so a key NH generated and a key a customer's system of record holds are indistinguishable once " +
  "verification has succeeded. Every dollar in the detected column is therefore still OPEN. The proof " +
  "chain's own figures are shown for audit and are not collected money.";

const DISCLOSURE =
  "SYNTHETIC. Every figure in this report was produced by NH or its harness. No billing system was " +
  "contacted, no charge was raised, no independent party asserted any settlement, and no amount here " +
  "was collected. Nothing in this report is Revenue Returned or Auditable Revenue.";

const REFUSED_NOT_RECORDED_REASON =
  "no succeeded run in this boundary recorded an observation, so whether anything was refused is NOT " +
  "ESTABLISHABLE here. That is not the same as nil: either no detector that can refuse has run in this " +
  "boundary, or its runs predate handlers being able to record one. Absence of the record is not " +
  "absence of refusals.";

const REFUSED_REASONS: Readonly<Record<"NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED", string>> =
  Object.freeze({
    NOT_EXAMINED:
      "a run recorded that it could not read the extract, so nobody looked. 'No refusals' would claim " +
      "work that never happened, and no expected figure is stated.",
    NONE_REFUSED:
      "the units were examined and none was refused. This zero is a finding, not an absence.",
    UNDETERMINED:
      "units were refused, so what they withhold cannot be stated. The expected figure beside this is " +
      "what the CONTRACT side stated on those units and is not in doubt; the residual is deliberately " +
      "absent, because the residual is exactly what the refusal is about. It is never exposure and is " +
      "never summed into any total here.",
  });

const COMPLETENESS_STATEMENT =
  "THE MONETARY TOTALS COVER GOVERNED ROOTS ONLY. An obligation that never became a case does not " +
  "appear in them: one the detector refused, one awaiting review, one rejected at review, or an " +
  "account-level aggregate nobody promoted. The counts beside this sentence are what this system can " +
  "see; the refused figure is what it cannot. Neither is added to any amount above.";

const EMPTY_NOTICE =
  "NO RECOVERY CASE WAS FOUND for this boundary. That is a statement about what this system holds, NOT " +
  "a finding that nothing is owed: an obligation nobody detected produces no row, and an empty report " +
  "is the same shape whether the book is clean or was never read.";

/**
 * Assemble one row. The open balance is DERIVED, and the claim is stamped rather than accepted.
 *
 * A caller cannot supply either: that is what stops a row stating a balance its own two figures do not
 * support, and what stops a positive collected claim arriving from outside.
 */
export function cfoProofRow(input: CfoProofRowInput): CfoProofRow {
  if (input.disputedAmountMinor !== null && input.disputedAmountMinor !== 0 && input.disputedDirection === null) {
    throw new Error("a disputed magnitude must carry its direction; an undirected magnitude cannot be reported");
  }
  return Object.freeze({
    ...input,
    evidenceSources: Object.freeze([...input.evidenceSources]),
    revenueReturnedWithheldCodes: Object.freeze([...input.revenueReturnedWithheldCodes]),
    claimedIndependentlyEvidencedCollectedMinor: 0 as const,
    claimedCollectedIsAsserted: true as const,
    // Derived, never passed. Nothing is subtracted but the claim, and the claim is zero — so the open
    // balance IS the exposure. The subtraction is written out rather than elided, because the day the
    // claim can be non-zero this line must already be the one that computes the balance.
    openBalanceMinor: input.detectedExposureMinor === null ? null : input.detectedExposureMinor - 0,
  });
}

/**
 * Sum a column, with the accumulator starting at the FIRST ESTABLISHED FIGURE rather than at a zero.
 *
 * A column with nothing established totals `null`, not `$0.00`: a zero would assert the column summed
 * cleanly to nothing. This is the same correction the financial trace's ledger totals needed, and it is
 * shared rather than re-written because two implementations of one rule are two things that can drift.
 */
function sumEstablished(values: readonly (number | null)[], currency: string): Money | null {
  let total: Money | null = null;
  for (const v of values) {
    if (v === null) continue;
    total = total === null ? money(v, currency) : addMoney(total, money(v, currency));
  }
  return total;
}

export function cfoProofTotals(rows: readonly CfoProofRow[], currency: string | null): CfoProofTotals {
  const empty = {
    rowCount: rows.length,
    detectedExposureMinor: null,
    exposureNotEstablishedCount: rows.filter((r) => r.detectedExposureMinor === null).length,
    disputedUpwardMinor: null,
    disputedDownwardMinor: null,
    disputedNotEstablishableCount: rows.filter((r) => r.disputedAmountMinor === null).length,
    claimedIndependentlyEvidencedCollectedMinor: 0 as const,
    openBalanceMinor: null,
  };
  if (rows.length === 0) return Object.freeze({ ...empty, unavailableReason: "no_rows" as const });
  // A BOUNDARY MAY HOLD MORE THAN ONE CURRENCY, and a sum across them is a figure no record asserts.
  // Refused rather than converted: NH holds no governed rate, and inventing one here would make the
  // report's headline a function of a number nobody blessed.
  if (currency === null) {
    return Object.freeze({ ...empty, unavailableReason: "currency_disagreement" as const });
  }
  const up = sumEstablished(
    rows.map((r) => (r.disputedDirection === "UPWARD" ? r.disputedAmountMinor : null)), currency,
  );
  const down = sumEstablished(
    rows.map((r) => (r.disputedDirection === "DOWNWARD" ? r.disputedAmountMinor : null)), currency,
  );
  return Object.freeze({
    ...empty,
    detectedExposureMinor: sumEstablished(rows.map((r) => r.detectedExposureMinor), currency)?.minor ?? null,
    disputedUpwardMinor: up?.minor ?? null,
    disputedDownwardMinor: down?.minor ?? null,
    openBalanceMinor: sumEstablished(rows.map((r) => r.openBalanceMinor), currency)?.minor ?? null,
    unavailableReason: null,
  });
}

/**
 * The refused-exposure facts a caller read out of the append-only task log, or `null` where no run
 * recorded one. `null` is REQUIRED to be passed rather than defaulted, so a caller that never looked
 * cannot produce the `NONE_REFUSED` finding by omission.
 */
export interface RefusedExposureFacts {
  readonly state: "NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED";
  readonly runsCarryingAnObservation: number;
  readonly refusedUnits: number;
  readonly refusedExpectedMinor: number | null;
  readonly refusedWithoutExpected: number;
  readonly currency: string | null;
}

export interface UnpromotedCandidateFacts {
  readonly pendingReview: number;
  readonly rejected: number;
  readonly acceptedNotPromoted: number;
  readonly statedAmountMinor: number | null;
  readonly coverageKinds: readonly ObligationCoverageStated[];
}

export function buildCfoProofReport(input: {
  readonly boundaryId: string;
  readonly rows: readonly CfoProofRow[];
  readonly unpromoted: UnpromotedCandidateFacts;
  readonly refused: RefusedExposureFacts | null;
}): CfoProofReport {
  const currencies = new Set(input.rows.map((r) => r.currency));
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  return Object.freeze({
    scheme: CFO_PROOF_REPORT_SCHEME,
    version: CFO_PROOF_REPORT_VERSION,
    boundaryId: input.boundaryId,
    currency,
    rows: Object.freeze([...input.rows]),
    totals: cfoProofTotals(input.rows, currency),
    coverage: Object.freeze({
      population: "governed roots in this boundary" as const,
      governedRootsReported: input.rows.length,
      unpromotedCandidates: Object.freeze({
        examined: true as const,
        pendingReview: input.unpromoted.pendingReview,
        rejected: input.unpromoted.rejected,
        acceptedNotPromoted: input.unpromoted.acceptedNotPromoted,
        statedAmountMinor: input.unpromoted.statedAmountMinor,
        coverageKinds: Object.freeze([...input.unpromoted.coverageKinds].sort()),
      }),
      refusedUpstreamExposure:
        input.refused === null
          ? Object.freeze({
              state: "NOT_RECORDED" as const,
              establishable: false as const,
              reason: REFUSED_NOT_RECORDED_REASON,
            })
          : Object.freeze({
              state: input.refused.state,
              establishable: true as const,
              runsCarryingAnObservation: input.refused.runsCarryingAnObservation,
              refusedUnits: input.refused.refusedUnits,
              refusedExpectedMinor: input.refused.refusedExpectedMinor,
              refusedWithoutExpected: input.refused.refusedWithoutExpected,
              currency: input.refused.currency,
              reason: REFUSED_REASONS[input.refused.state],
            }),
      completenessStatement: COMPLETENESS_STATEMENT,
    }),
    emptyBoundaryNotice: input.rows.length === 0 ? EMPTY_NOTICE : null,
    claimStatement: CLAIM_STATEMENT,
    disclosure: DISCLOSURE,
  });
}

/**
 * The canonical form — the reproducibility claim, as a string. Clock values are excluded by
 * construction, because nothing here reads one; our prose is excluded so a clearer sentence cannot
 * re-identify a report, and the CODES are in, because a code is a decision.
 */
export function canonicalCfoProofReport(report: CfoProofReport): string {
  return JSON.stringify({
    scheme: report.scheme,
    version: report.version,
    boundaryId: report.boundaryId,
    currency: report.currency,
    rows: [...report.rows]
      .map((r) => ({
        recoveryCaseId: r.recoveryCaseId,
        currency: r.currency,
        obligationCoverage: r.obligationCoverage,
        detectedExposureMinor: r.detectedExposureMinor,
        disputedAmountMinor: r.disputedAmountMinor,
        disputedDirection: r.disputedDirection,
        disputedState: r.disputedState,
        claimedIndependentlyEvidencedCollectedMinor: r.claimedIndependentlyEvidencedCollectedMinor,
        proofChainFigureMinor: r.proofChainFigureMinor,
        openBalanceMinor: r.openBalanceMinor,
        evidenceSources: [...r.evidenceSources]
          .map((e) => ({
            sourceSystem: e.sourceSystem,
            trustClassification: e.trustClassification,
            signatureVerified: e.signatureVerified,
          }))
          .sort((a, b) => (a.sourceSystem + a.trustClassification).localeCompare(b.sourceSystem + b.trustClassification)),
        attestationCode: r.attestationCode,
        gateVerdict: r.gateVerdict,
        revenueReturnedWithheldCodes: [...r.revenueReturnedWithheldCodes].sort(),
      }))
      .sort((a, b) => a.recoveryCaseId.localeCompare(b.recoveryCaseId)),
    coverage: {
      population: report.coverage.population,
      governedRootsReported: report.coverage.governedRootsReported,
      unpromotedCandidates: {
        examined: report.coverage.unpromotedCandidates.examined,
        pendingReview: report.coverage.unpromotedCandidates.pendingReview,
        rejected: report.coverage.unpromotedCandidates.rejected,
        acceptedNotPromoted: report.coverage.unpromotedCandidates.acceptedNotPromoted,
        statedAmountMinor: report.coverage.unpromotedCandidates.statedAmountMinor,
        coverageKinds: [...report.coverage.unpromotedCandidates.coverageKinds].sort(),
      },
      refusedUpstreamExposure: {
        state: report.coverage.refusedUpstreamExposure.state,
        establishable: report.coverage.refusedUpstreamExposure.establishable,
        refusedUnits: report.coverage.refusedUpstreamExposure.establishable
          ? report.coverage.refusedUpstreamExposure.refusedUnits
          : null,
        refusedExpectedMinor: report.coverage.refusedUpstreamExposure.establishable
          ? report.coverage.refusedUpstreamExposure.refusedExpectedMinor
          : null,
        refusedWithoutExpected: report.coverage.refusedUpstreamExposure.establishable
          ? report.coverage.refusedUpstreamExposure.refusedWithoutExpected
          : null,
      },
    },
    totals: {
      rowCount: report.totals.rowCount,
      detectedExposureMinor: report.totals.detectedExposureMinor,
      exposureNotEstablishedCount: report.totals.exposureNotEstablishedCount,
      disputedUpwardMinor: report.totals.disputedUpwardMinor,
      disputedDownwardMinor: report.totals.disputedDownwardMinor,
      disputedNotEstablishableCount: report.totals.disputedNotEstablishableCount,
      claimedIndependentlyEvidencedCollectedMinor: report.totals.claimedIndependentlyEvidencedCollectedMinor,
      openBalanceMinor: report.totals.openBalanceMinor,
      unavailableReason: report.totals.unavailableReason,
    },
  });
}
