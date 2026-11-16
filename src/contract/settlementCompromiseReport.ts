// G6 · WHICH ARRIVALS OF MONEY REST ON A COMPROMISED KEY.
//
// WHAT THIS IS. The pure half of the question a revocation forces. G1's `compromiseAssessment` can say
// whether ONE attestation falls inside an exposure window; G5's ledger can say WHICH arrivals rest on a
// key. Neither alone answers the operator's actual question — *we have just revoked this key; what did
// it touch?* — and this module is the join, expressed as a decision over inputs with no store, no clock
// and no route.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//
//   IT RECOMPUTES NO PROOF. Trust Invariant rule 5 says historical proof is immutable and reproducible
//   forever, and rule 6 says learning may change FUTURE decisions only. What this produces is a TRUST
//   STATUS BESIDE the frozen record — a per-row marker, which is the remedy the constitution already
//   names. Not one byte of a proof, an amount, a reason or an approval is touched or implied.
//
//   IT RE-ASKS NO QUESTION THAT WAS ALREADY ANSWERED. `validAt(issuedAt)` — was the key in force when
//   it signed — was decided at verification time by G4 and frozen there. Asking it again here would be
//   a second implementation of one rule, and two implementations are two things that can drift. This
//   module asks exactly one question: given a declared exposure window, where does each arrival fall?
//
//   IT CARRIES NO MONEY. The ledger stores no amount, so a monetary figure is STRUCTURALLY absent here
//   rather than promised absent. A compromise report is a statement about evidence, never about a
//   ledger of dollars, and the two must not meet on one surface.
//
// THE RULE THAT SHAPES EVERY COUNT BELOW: THE FOUR OUTCOMES STAY DISTINGUISHABLE. *No compromise has
// been declared*, *checked and outside the window*, *inside the window*, and *the signing instant was
// never recorded* are four different positions, and collapsing any pair hides the only half of the
// answer that says what to do next — the same reason `leakInstanceIdentityStatus` and
// `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE` are named apart, and the same reason `RETIRED` and
// `REVOKED_COMPROMISED` never became one `INACTIVE`.
import {
  compromiseAssessment,
  SETTLEMENT_KEY_LIFECYCLE_VERSION,
  type SettlementKeyEvent,
} from "./settlementKeyLifecycle";

/** Version of this report's semantics. A change in meaning is a NEW id, never a silent re-grade. */
export const SETTLEMENT_COMPROMISE_REPORT_VERSION = "scr-2026.1";

// ── The input: one arrival as the ledger holds it ────────────────────────────────────────────────

export interface ArrivalRestingOnKey {
  readonly boundaryId: string;
  readonly claimRef: string;
  /** `sha256:<64 hex>` over the canonical settlement identity. Never the external reference itself. */
  readonly settlementDigest: string;
  /** When NH recorded the consumption. */
  readonly consumedAt: string;
  /**
   * When the ATTESTATION WAS SIGNED, which is the only instant the compromise question can be asked
   * about — and `null` means NOT RECORDED.
   *
   * `consumedAt` IS NOT A SUBSTITUTE, and the reason is not that it would be unsafe. It would in fact
   * err conservatively, because an arrival is consumed at or after it is signed, so substituting it can
   * only ever move an arrival INTO the window and never out of it. It is refused because it answers a
   * DIFFERENT QUESTION: *when did we record this* is a fact about NH, and the exposure window is about
   * when the institution's key was in the wrong hands. A conservative wrong answer is still a wrong
   * answer, and one that reads as measured.
   */
  readonly attestationIssuedAt: string | null;
}

// ── The outcome, per arrival ─────────────────────────────────────────────────────────────────────

export type ArrivalCompromiseStatus =
  /** No compromise has been declared for this key. NOT a finding of cleanliness — no window exists. */
  | "NOT_APPLICABLE"
  /** A window exists and this attestation was signed before it opened. */
  | "UNAFFECTED"
  /** A window exists and this attestation falls inside it. */
  | "FLAGGED_COMPROMISED_WINDOW"
  /**
   * A window exists and the signing instant was never recorded, so the arrival cannot be placed.
   *
   * COUNTED, NEVER ZEROED AND NEVER READ AS UNAFFECTED. "Not computed is not zero" applied to a row:
   * silently treating an unplaceable arrival as outside the window is the flattering direction, and it
   * is exactly the default `compromiseAssessment` already refuses for an unknown exposure start.
   */
  | "NOT_ESTABLISHABLE";

export interface ArrivalCompromiseFinding {
  readonly boundaryId: string;
  readonly claimRef: string;
  readonly settlementDigest: string;
  readonly consumedAt: string;
  readonly attestationIssuedAt: string | null;
  readonly status: ArrivalCompromiseStatus;
  /** The exposure start the finding was judged against, or null when UNKNOWN or not applicable. */
  readonly exposureFrom: string | null;
  /** True when the status rests on an UNKNOWN exposure start — the whole lifetime being the window. */
  readonly exposureStartUnknown: boolean;
  readonly detail: string;
}

// ── The declaration the report is judged against ─────────────────────────────────────────────────

export type KeyCompromiseDeclaration =
  | {
      readonly declared: false;
      readonly detail: string;
    }
  | {
      readonly declared: true;
      readonly revokedAt: string;
      /** `null` is UNKNOWN: the whole of the key's life is the window. Never the revocation date. */
      readonly exposureFrom: string | null;
      readonly exposureStartUnknown: boolean;
      readonly detail: string;
    };

export type ReportCoverage =
  /** The key has never been revoked as compromised, so no question was asked of the arrivals. */
  | "NO_COMPROMISE_DECLARED"
  /** A window exists and every arrival carried a signing instant. */
  | "COMPLETE"
  /** A window exists and at least one arrival could not be placed in it. */
  | "PARTIAL_SIGNING_INSTANT_MISSING";

export interface SettlementCompromiseReport {
  readonly reportVersion: string;
  readonly lifecycleVersion: string;
  readonly keyId: string;
  readonly compromise: KeyCompromiseDeclaration;
  /**
   * How many ledger rows were examined.
   *
   * ZERO IS A STATEMENT ABOUT THE LEDGER, NOT ABOUT THE MONEY, and the detail says so. An operator
   * reading "0 flagged" next to "0 examined" must not take it for an all-clear: it means no consumption
   * naming this key is recorded, which is also what an unwired caller, a wrong database and a key that
   * genuinely signed nothing all look like.
   */
  readonly arrivalsExamined: number;
  /** The four counts, never collapsed and never summed into a single "affected?" boolean. */
  readonly notApplicable: number;
  readonly unaffected: number;
  readonly flagged: number;
  readonly notEstablishable: number;
  readonly coverage: ReportCoverage;
  readonly findings: readonly ArrivalCompromiseFinding[];
  readonly detail: string;
  /**
   * Stated on the payload rather than left to a renderer, exactly as `exposureIsNotRecoveredRevenue` is
   * on the Recovery Case: a flagged arrival is a question raised about evidence, and it neither reverses
   * a proof nor reduces Revenue Returned by one cent.
   */
  readonly flaggingDoesNotAlterProof: string;
}

const PROOF_NOTE =
  "a flagged arrival RAISES A QUESTION about the evidence that substantiated a claim; it does not " +
  "reverse, recompute or reduce any frozen proof, and no Revenue Returned figure changes because of " +
  "this report — the remedy for a compromised key is a per-row marker, never a rewrite of history";

/**
 * What this key's own log DECLARES about its compromise, independent of any arrival.
 *
 * SEPARATE AND EXPORTED because the two facts become available at different moments. The declaration
 * is read from the key register; the arrivals are read from the ledger, and the ledger can be
 * unreachable — unprovisioned, in another database, behind a migration nobody has authorised. A caller
 * who cannot enumerate arrivals must still be able to say *this key is revoked, and here is the
 * window*, rather than lose that too. `settlementCompromiseReport` calls this same function, so there
 * is one implementation and not two that can drift.
 */
export function settlementCompromiseDeclaration(
  events: readonly SettlementKeyEvent[],
): KeyCompromiseDeclaration {
  const revocation = events.find((e) => e.transition === "REVOKED_COMPROMISED");
  if (revocation === undefined) {
    return Object.freeze({
      declared: false as const,
      detail:
        "no REVOKED_COMPROMISED event appears in this key's log; this is the ABSENCE of a " +
        "declaration and is not a finding that the key's attestations are sound",
    });
  }
  const exposureFrom = revocation.exposureFrom ?? null;
  return Object.freeze({
    declared: true as const,
    revokedAt: revocation.at,
    exposureFrom,
    exposureStartUnknown: exposureFrom === null,
    detail:
      exposureFrom === null
        ? "the key was revoked as compromised with an UNKNOWN exposure start, so its whole " +
          "lifetime is the window and every placeable arrival it signed is flagged"
        : "the key was revoked as compromised with a stated exposure start",
  });
}

/**
 * Every arrival resting on one key, placed against that key's declared exposure window.
 *
 * THE DECLARATION IS DERIVED FROM THE KEY'S OWN LOG, never supplied by the caller. A caller who could
 * state the exposure window would be choosing which arrivals are flagged, and the party asking this
 * question is the party a smaller answer flatters.
 *
 * ORDER IS THE CALLER'S. The report does not sort: the ledger's own append order (`seq`) is the only
 * order anything recorded, and re-sorting here by a timestamp would be total rather than chronological
 * — the defect the execution-event log already had, and the one `stateAt` refuses to repair silently.
 */
export function settlementCompromiseReport(
  keyId: string,
  events: readonly SettlementKeyEvent[],
  arrivals: readonly ArrivalRestingOnKey[],
): SettlementCompromiseReport {
  const revocation = events.find((e) => e.transition === "REVOKED_COMPROMISED");
  const compromise = settlementCompromiseDeclaration(events);

  const findings: ArrivalCompromiseFinding[] = [];
  let notApplicable = 0;
  let unaffected = 0;
  let flagged = 0;
  let notEstablishable = 0;

  for (const arrival of arrivals) {
    if (revocation === undefined) {
      // NO WINDOW EXISTS, SO NOTHING IS BEING ASKED — and a missing signing instant costs nothing here.
      // The absence only becomes a defect once there is a window to place the arrival in, which is why
      // it is NOT reported as NOT_ESTABLISHABLE on an unrevoked key: that would report a gap in an
      // answer nobody requested.
      notApplicable += 1;
      findings.push(
        Object.freeze({
          ...pick(arrival),
          status: "NOT_APPLICABLE" as const,
          exposureFrom: null,
          exposureStartUnknown: false,
          detail: "the key has never been revoked as compromised, so no exposure window exists",
        }),
      );
      continue;
    }

    if (arrival.attestationIssuedAt === null) {
      // FAIL CLOSED, LOUDLY. See `ArrivalRestingOnKey.attestationIssuedAt` for why `consumedAt` is not
      // quietly used instead.
      notEstablishable += 1;
      findings.push(
        Object.freeze({
          ...pick(arrival),
          status: "NOT_ESTABLISHABLE" as const,
          exposureFrom: revocation.exposureFrom ?? null,
          exposureStartUnknown: (revocation.exposureFrom ?? null) === null,
          detail:
            "the instant this attestation was signed was never recorded, so the arrival cannot be " +
            "placed inside or outside the exposure window; it is counted as unplaceable and is NOT " +
            "treated as unaffected",
        }),
      );
      continue;
    }

    const assessment = compromiseAssessment(events, arrival.attestationIssuedAt);
    if (assessment.status === "FLAGGED_COMPROMISED_WINDOW") flagged += 1;
    else if (assessment.status === "UNAFFECTED") unaffected += 1;
    else notApplicable += 1; // unreachable while `revocation` is defined; counted rather than assumed
    findings.push(
      Object.freeze({
        ...pick(arrival),
        status: assessment.status,
        exposureFrom: assessment.exposureFrom,
        exposureStartUnknown: assessment.exposureStartUnknown,
        detail: assessment.detail,
      }),
    );
  }

  const coverage: ReportCoverage =
    revocation === undefined
      ? "NO_COMPROMISE_DECLARED"
      : notEstablishable > 0
        ? "PARTIAL_SIGNING_INSTANT_MISSING"
        : "COMPLETE";

  return Object.freeze({
    reportVersion: SETTLEMENT_COMPROMISE_REPORT_VERSION,
    lifecycleVersion: SETTLEMENT_KEY_LIFECYCLE_VERSION,
    keyId,
    compromise,
    arrivalsExamined: arrivals.length,
    notApplicable,
    unaffected,
    flagged,
    notEstablishable,
    coverage,
    findings: Object.freeze(findings),
    detail: detailFor(arrivals.length, coverage, flagged, notEstablishable),
    flaggingDoesNotAlterProof: PROOF_NOTE,
  });
}

function pick(a: ArrivalRestingOnKey): {
  boundaryId: string;
  claimRef: string;
  settlementDigest: string;
  consumedAt: string;
  attestationIssuedAt: string | null;
} {
  return {
    boundaryId: a.boundaryId,
    claimRef: a.claimRef,
    settlementDigest: a.settlementDigest,
    consumedAt: a.consumedAt,
    attestationIssuedAt: a.attestationIssuedAt,
  };
}

function detailFor(
  examined: number,
  coverage: ReportCoverage,
  flagged: number,
  notEstablishable: number,
): string {
  const empty =
    examined === 0
      ? "no consumption naming this key is recorded in the ledger; that is a statement about the " +
        "ledger and not about the money — an unwired caller, a different database and a key that " +
        "genuinely signed nothing all look like this. "
      : "";
  if (coverage === "NO_COMPROMISE_DECLARED") {
    return `${empty}no compromise has been declared for this key, so no arrival was placed against a window`;
  }
  if (coverage === "PARTIAL_SIGNING_INSTANT_MISSING") {
    return (
      `${empty}${flagged} arrival(s) fall inside the exposure window and ${notEstablishable} could not ` +
      "be placed at all; the report is PARTIAL and the unplaceable arrivals must be resolved rather " +
      "than read as unaffected"
    );
  }
  return `${empty}${flagged} arrival(s) fall inside the exposure window; every arrival was placeable`;
}
