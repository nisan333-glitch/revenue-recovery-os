// Client for the governed correction-ledger read.
//
// The DTO mirrors `server/services/candidateCorrectionsRead.ts` exactly, INCLUDING its absences: there
// is no `sourceRef`, no `obligationRef`, no `identity`, and no corrected / effective / resolved amount.
// A field the server does not send must not exist here either, or a screen could be written against one
// and the gap would only show at runtime.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";

export type CorrectionStateDTO =
  | "SINGLE_OBSERVATION"
  | "REPEATED_IDENTICAL_OBSERVATION"
  | "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED"
  | "ORDER_NOT_ESTABLISHABLE";

export interface CorrectionRecordDTO {
  identityDigest: string;
  recoveryType: string;
  obligationGrained: boolean;
  state: CorrectionStateDTO;
  orderCertain: boolean;
  observationCount: number;
  observedAmountsMinor: number[];
  /** Null where the order is not establishable. NOT zero — see the server module. */
  storedMinor: number | null;
  latestObservedMinor: number | null;
  deltaMinor: number | null;
  direction: "UPWARD" | "DOWNWARD" | null;
  undecidedMagnitudeMinor: number | null;
  currency: string;
}

export interface CorrectionViewDTO {
  scheme: string;
  derivedFromScheme: string;
  boundaryId: string;
  result: { outcome: "REPORTED" } | { outcome: "REFUSED_ORDER_UNSAFE"; reason: string };
  records: CorrectionRecordDTO[];
  totals: {
    identities: number;
    withCorrections: number;
    repeatedIdentical: number;
    orderNotEstablishable: number;
    upwardUndecidedMinor: number;
    downwardUndecidedMinor: number;
  };
  claimBoundary: {
    observationOnly: true;
    constitutesProof: false;
    constitutesRevenue: false;
    precedenceApproved: false;
  };
  precedenceNotice: string;
}

/**
 * Read one boundary's correction ledger.
 *
 * The actor is passed explicitly rather than defaulted: this endpoint is `AuditRead`-gated, so the
 * caller must be an approver, verifier or steward, and a screen that quietly defaulted to an operator
 * identity would present a 403 as if the feature were broken.
 */
export function readCandidateCorrections(boundaryId: string, actor: DevActor): Promise<CorrectionViewDTO> {
  return apiRequest("GET", `/candidate-corrections?boundaryId=${encodeURIComponent(boundaryId)}`, actor);
}
