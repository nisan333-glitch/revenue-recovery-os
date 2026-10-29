// THE GOVERNED READ SURFACE for the correction ledger.
//
// `candidateCorrections.ts` derives what happened to a corrected observation and, until now, had NO
// consumer at all — which is the defect this repository already recorded against `obligation_ref`: a
// value that nothing reads collects no evidence and invites prose that overstates what happens to it.
// This module is that consumer.
//
// ── WHO MAY READ IT, AND WHY NOT THE OPERATOR ──────────────────────────────────────────────────────
//
// `AuditRead` — held by approver, verifier and steward, and NOT by author or operator. The ledger names
// an amount the governed store is not currently reporting, so an actor who benefits from a larger figure
// must not be the one reading it and deciding which statement to push. That is the Trust Invariant's
// standing test answered the only way it can be: the beneficiary never determines the number.
//
// AUTHORIZATION COMES FIRST, BEFORE EXISTENCE. An unauthorized actor must not learn which boundaries
// hold corrections by watching a 404 turn into a 403 — the same ordering `GET /recovery-cases/:caseId`
// settled, for the same reason.
//
// ── WHAT LEAVES, AND WHAT CANNOT ───────────────────────────────────────────────────────────────────
//
// NO IDENTIFIER LEAVES. The underlying records carry `sourceRef` and `obligationRef`, which are SUPPOSED
// to be pseudonyms — and measured, the reader accepts anything: a crafted task result with
// `sourceRef: "ENT-REAL-CUSTOMER-7781"` and `obligationRef: "ACME Corp invoice 9912"` passes straight
// through into the report. `assertCandidateSignal` refuses those at ingress, so no detector can produce
// them; but this surface must not rely on an upstream guard to decide what it emits. So it emits
// `identityDigest`, a 24-hex digest of the grouping identity, and never the identity itself. Grouping
// still works, and no customer value can leave even if one reached the table by another route.
//
// NO AUTHORITATIVE FIGURE LEAVES EITHER. The projection carries no corrected, effective or resolved
// amount, because S-DUP-4 precedence is NOT APPROVED and such a field is the precedence decision wearing
// a different name. Upward and downward magnitudes stay separate and there is no net.
//
// AN UNSAFE APPEND SEQUENCE IS A REFUSAL, NOT A 500. `observationsFromRows` throws when a sequence
// cannot be ordered safely — correctly, fail-closed. Letting that reach the HTTP layer as an internal
// error would blame the server for a property of the stored data, the `NH-AX-1009` mistake. It is
// reported as a named refusal with no figures instead.
//
// READ-ONLY, AND NOTHING IS PERSISTED. No table is written, no case advances, no money is claimed.
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import {
  CANDIDATE_CORRECTIONS_SCHEME, CANDIDATE_CORRECTIONS_SQL, observationsFromRows,
  summariseCorrections, type CorrectionDirection, type CorrectionState, type RawCorrectionRow,
} from "./candidateCorrections";

export const CANDIDATE_CORRECTIONS_READ_SCHEME = "nh-candidate-corrections-read-v1";

/** One identity's correction history, with every identifier replaced by a digest. */
export interface CorrectionViewRecord {
  /**
   * A 24-hex digest of the grouping identity. Stable for the same identity and reversible by nobody:
   * it is a one-way digest of a value that is itself already a pseudonym under a deployment key.
   */
  readonly identityDigest: string;
  readonly recoveryType: string;
  /** Whether the claim was obligation-grained. The REFERENCE itself is deliberately absent. */
  readonly obligationGrained: boolean;
  readonly state: CorrectionState;
  readonly orderCertain: boolean;
  readonly observationCount: number;
  readonly observedAmountsMinor: readonly number[];
  readonly storedMinor: number | null;
  readonly latestObservedMinor: number | null;
  readonly deltaMinor: number | null;
  readonly direction: CorrectionDirection | null;
  readonly undecidedMagnitudeMinor: number | null;
  readonly currency: string;
}

export type CorrectionViewOutcome =
  | { readonly outcome: "REPORTED" }
  /** The stored data cannot be ordered safely. Named, with no figures, and not an internal error. */
  | { readonly outcome: "REFUSED_ORDER_UNSAFE"; readonly reason: string };

export interface CorrectionView {
  readonly scheme: typeof CANDIDATE_CORRECTIONS_READ_SCHEME;
  readonly derivedFromScheme: typeof CANDIDATE_CORRECTIONS_SCHEME;
  /** The caller's own input, echoed. Never customer data. */
  readonly boundaryId: string;
  readonly result: CorrectionViewOutcome;
  readonly records: readonly CorrectionViewRecord[];
  readonly totals: {
    readonly identities: number;
    readonly withCorrections: number;
    readonly repeatedIdentical: number;
    readonly orderNotEstablishable: number;
    readonly upwardUndecidedMinor: number;
    readonly downwardUndecidedMinor: number;
  };
  /** Stated on the surface, not only in a comment: this is a report, never a recovery. */
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly precedenceApproved: false;
  };
  /** Why no authoritative figure appears. One wording, one place. */
  readonly precedenceNotice: string;
}

export const PRECEDENCE_NOTICE =
  "CORRECTED AMOUNTS ARE REPORTED, NOT RESOLVED. Where several statements of one obligation's shortfall " +
  "were observed, every amount is listed and the governed store's figure is named — but which statement " +
  "is authoritative is NOT decided here and no approved business rule decides it. Nothing in this " +
  "report is recovered revenue, and no figure here may be summed into one.";

const EMPTY_TOTALS = Object.freeze({
  identities: 0, withCorrections: 0, repeatedIdentical: 0, orderNotEstablishable: 0,
  upwardUndecidedMinor: 0, downwardUndecidedMinor: 0,
});

const CLAIM = Object.freeze({
  observationOnly: true as const, constitutesProof: false as const,
  constitutesRevenue: false as const, precedenceApproved: false as const,
});

/**
 * The digest of a grouping identity.
 *
 * Length-framed exactly as `caseCandidateDedupeKey`'s preimage is, so two different identities cannot
 * frame to one string — the same reason that derivation frames its components.
 */
export function identityDigest(identity: string): string {
  return createHash("sha256")
    .update(`${Buffer.byteLength(identity, "utf8")}:${identity}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Read one boundary's correction ledger.
 *
 * The query is SCOPED to the boundary: unscoped, `CANDIDATE_CORRECTIONS_SQL` is a forensic scan, and a
 * governed read must not be able to return another boundary's history by omission.
 */
export async function readCandidateCorrections(
  actor: ActorContext,
  boundaryId: string,
): Promise<CorrectionView> {
  // AUTHORIZATION FIRST, then the boundary, then anything that touches data.
  requireCan(actor, "AuditRead");
  if (!boundaryId.trim()) throw new Error("boundaryId is required");
  requireBoundaryAccess(actor, boundaryId);

  const raw = await prisma.$queryRawUnsafe<RawCorrectionRow[]>(CANDIDATE_CORRECTIONS_SQL, boundaryId);

  let report: ReturnType<typeof summariseCorrections>;
  try {
    report = summariseCorrections(observationsFromRows(raw));
  } catch (err) {
    // NAMED, WITH NO FIGURES. The message is this module's own wording and never the caught error's,
    // which could in principle carry a value from the row that produced it.
    return Object.freeze({
      scheme: CANDIDATE_CORRECTIONS_READ_SCHEME,
      derivedFromScheme: CANDIDATE_CORRECTIONS_SCHEME,
      boundaryId,
      result: Object.freeze({
        outcome: "REFUSED_ORDER_UNSAFE" as const,
        reason:
          "the stored append sequence for this boundary cannot be ordered safely, so no correction " +
          "history is reported for it. This is a property of the recorded data, not a server fault, " +
          "and no figures are reported rather than figures derived from an unsafe order.",
      }),
      records: Object.freeze([]),
      totals: EMPTY_TOTALS,
      claimBoundary: CLAIM,
      precedenceNotice: PRECEDENCE_NOTICE,
      // `err` is deliberately not read: see above.
    });
  }

  return Object.freeze({
    scheme: CANDIDATE_CORRECTIONS_READ_SCHEME,
    derivedFromScheme: CANDIDATE_CORRECTIONS_SCHEME,
    boundaryId,
    result: Object.freeze({ outcome: "REPORTED" as const }),
    records: Object.freeze(report.records.map((r) => Object.freeze({
      identityDigest: identityDigest(r.identity),
      recoveryType: r.recoveryType,
      obligationGrained: r.obligationGrained,
      state: r.state,
      orderCertain: r.orderCertain,
      observationCount: r.observationCount,
      observedAmountsMinor: r.observedAmountsMinor,
      storedMinor: r.storedMinor,
      latestObservedMinor: r.latestObservedMinor,
      deltaMinor: r.deltaMinor,
      direction: r.direction,
      undecidedMagnitudeMinor: r.undecidedMagnitudeMinor,
      currency: r.currency,
    }))),
    totals: Object.freeze({
      identities: report.totals.identities,
      withCorrections: report.totals.withCorrections,
      repeatedIdentical: report.totals.repeatedIdentical,
      orderNotEstablishable: report.totals.orderNotEstablishable,
      upwardUndecidedMinor: report.totals.upwardUndecidedMinor,
      downwardUndecidedMinor: report.totals.downwardUndecidedMinor,
    }),
    claimBoundary: CLAIM,
    precedenceNotice: PRECEDENCE_NOTICE,
  });
}
