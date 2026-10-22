// The governed read surface for an authoritative Recovery Case (READ-ONLY).
//
// WHY A NEW ROUTE AND NOT AN EXTENSION OF `/audit/cases/:caseId`. Decided by reading the code, not by
// preference, and the deciding fact is that `caseAuditTrail` never touches `RecoveryCaseRecord`. It takes
// a case id as a bare string, reads the authority ledger and the proof chain, and returns a perfectly
// well-formed object for an id that has no root at all. That is not an oversight: `EventDetail.tsx` calls
// it with `event.eventId` — SEED event ids, which have no `RecoveryCaseRecord` and never will. Making that
// route fail closed on a missing root would break the one screen already using it. So the audit route is
// deliberately root-tolerant and stays that way, and the surface that must fail closed is a new one.
//
// The second deciding fact: a Recovery Case read has to be boundary-checked, and the audit route has no
// boundary to check — the boundary lives on the case root it does not read.
//
// WHAT IT DOES NOT DO. It computes no money. The proven figure is taken from the same effective-proof rule
// `cfoAuditExport` already applies, and the at-risk figure is read from the frozen promotion row. Nothing
// here recomputes a counted number, and nothing here writes.
import {
  getRecoveryCase,
  type RecoveryCaseRoot,
} from "../persistence/recoveryCaseStore";
import { getCaseProofs } from "../persistence/proofStore";
import { getBaselinesForCase } from "../persistence/baselineStore";
import { getEvidenceForCase, type IngestedEvidence } from "../persistence/evidenceStore";
import { authorityFor } from "../auth/authorityStore";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { NotFoundError } from "../http/errors";
import { effectiveProofs, isEffectiveRecovery } from "../../src/domain/proof";
import { addMoney, money, type Money } from "../../src/domain/money";
import {
  deriveCaseLifecycle,
  unknownAuthorityActions,
  type CaseLifecycle,
} from "../../src/domain/caseLifecycle";
import {
  deriveCaseIdentityGrain,
  type CaseIdentityGrainDisclosure,
} from "../../src/domain/caseIdentityGrain";
import {
  leakInstanceIdentityStatus,
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
} from "../../src/contract/leakInstanceIdentity";

/** Why the proven ledger could not be stated. NAMED, never collapsed into a zero or a null. */
export type ProvenLedgerUnavailableReason = "no_effective_recovery_proof" | "proof_currency_disagreement";

export interface RecoveryCaseView {
  readonly root: RecoveryCaseRoot;
  readonly lifecycle: CaseLifecycle;
  /**
   * What the at-risk figure IS and IS NOT, carried on the payload rather than left to a renderer.
   *
   * The constitution's rule — an identified gap is not returned money — has to survive every screen and
   * every report, and a reader of this JSON is one of those reports. `exposureIsNotRecoveredRevenue` is
   * structural on the lifecycle; this is the sentence a human reads.
   */
  readonly exposureLabel: string;
  /**
   * WHAT THIS CASE'S IDENTITY COVERS — one account, or one obligation.
   *
   * This is the field that stops the payload being readable as a per-obligation claim. `root.sourceRef`
   * is a pseudonym of the ACCOUNT, so `lifecycle.exposure` may cover more than one obligation and a
   * merged figure is indistinguishable from a single-obligation figure by amount alone.
   *
   * `absorbedObservations` is `{ checked: false }` here, DELIBERATELY AND SAID SO. Establishing absorption
   * requires a content join over `agent_tasks.result`/`payload` against the candidate's dedupe triple —
   * exact, but unindexed jsonb, which is a forensic query and not a governed read path. Reporting
   * `count: 0` instead would assert work this route did not do. `scripts/exposure/absorbed-observations.ts`
   * is the thing that looks.
   */
  readonly identityGrain: CaseIdentityGrainDisclosure;
  /** `null` when the proven ledger is unavailable; the reason is always stated beside it. */
  readonly provenRevenueReturnedMinor: number | null;
  readonly provenLedgerUnavailableReason: ProvenLedgerUnavailableReason | null;
  /** Every proof the proven figure was summed from. Empty exactly when the figure is null. */
  readonly provenFromProofIds: readonly string[];
  readonly baselineCount: number;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly evidenceRole: string;
    readonly trustClassification: string;
    readonly beneficiaryControl: boolean;
    readonly sourceVerification: boolean;
  }[];
  /**
   * Authority actions in the ledger this build does not recognise. Reported, never an error: the ledger
   * is append-only and a vocabulary addition must not make a historical case unreadable.
   */
  readonly unknownAuthorityActions: readonly string[];
}

/**
 * The proven ledger for one case — the SAME rule `cfoAuditExport` applies, read once.
 *
 * It refuses rather than authors a number in the one case it cannot state honestly: if any effective
 * recovery proof is in a currency other than the case's own, the sum would be a figure no proof asserts.
 * `proofService.approve` already matches the proof currency to the locked baseline, so this should be
 * unreachable — which is exactly the kind of guard this repository keeps and does not loosen.
 */
function provenLedger(
  root: RecoveryCaseRoot,
  proofs: Awaited<ReturnType<typeof getCaseProofs>>,
):
  | { readonly amount: Money; readonly proofIds: readonly string[]; readonly reason: null }
  | { readonly amount: null; readonly proofIds: readonly string[]; readonly reason: ProvenLedgerUnavailableReason } {
  const effective = effectiveProofs(proofs).filter(isEffectiveRecovery);
  if (effective.length === 0) {
    return { amount: null, proofIds: [], reason: "no_effective_recovery_proof" };
  }
  if (effective.some((p) => p.currency !== root.currency)) {
    return { amount: null, proofIds: [], reason: "proof_currency_disagreement" };
  }
  let total = money(0, root.currency);
  for (const p of effective) total = addMoney(total, p.revenueReturned);
  return {
    amount: total,
    proofIds: Object.freeze(effective.map((p) => p.proofId).sort()),
    reason: null,
  };
}

function projectEvidence(items: readonly IngestedEvidence[]): RecoveryCaseView["evidence"] {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        evidenceId: item.evidenceId,
        evidenceRole: item.evidenceRole,
        trustClassification: item.trustClassification,
        beneficiaryControl: item.beneficiaryControl,
        sourceVerification: Boolean(item.sourceVerification),
      }),
    ),
  );
}

/**
 * Read one authoritative Recovery Case. FAILS CLOSED in three ways, in this order.
 *
 *  1. `AuditRead` first, so an actor without oversight authority learns nothing about any case —
 *     including whether it exists. It is the SAME gate every other provenance-bearing read uses; no new
 *     permission is invented here and the matrix is untouched. The consequence is stated rather than
 *     hidden: the case's own operator does not hold `AuditRead`, so they cannot read this surface. That
 *     is the existing EP-8.1 H2 decision — a beneficiary may not read frozen proof provenance — and
 *     widening it to admit a beneficiary is a governance change with an owner, not a convenience.
 *  2. No root → `NotFoundError`. A case id with no promotion row is not a case, whatever else exists
 *     under that id in the authority ledger.
 *  3. Boundary access against the ROOT'S OWN boundary, which is the only authoritative statement of
 *     which customer this case belongs to.
 */
export async function readRecoveryCase(
  actor: ActorContext,
  recoveryCaseId: string,
): Promise<RecoveryCaseView> {
  requireCan(actor, "AuditRead");

  const root = await getRecoveryCase(recoveryCaseId);
  if (root === null) throw new NotFoundError(`recovery case ${recoveryCaseId} has no authoritative root`);
  requireBoundaryAccess(actor, root.boundaryId);

  const [authority, baselines, evidence, proofs] = await Promise.all([
    authorityFor(recoveryCaseId),
    getBaselinesForCase(recoveryCaseId),
    getEvidenceForCase(recoveryCaseId),
    getCaseProofs(recoveryCaseId),
  ]);

  const ledger = provenLedger(root, proofs);
  const authorityEntries = authority.map((a) => ({
    actorId: a.actorId,
    role: a.role,
    action: a.action,
    at: a.at.toISOString(),
  }));

  const lifecycle = deriveCaseLifecycle({
    root,
    authority: authorityEntries,
    baselineCount: baselines.length,
    evidenceCount: evidence.length,
    provenRevenueReturned:
      ledger.amount === null ? null : { amount: ledger.amount, proofIds: ledger.proofIds },
  });

  return Object.freeze({
    root,
    lifecycle,
    exposureLabel:
      "OBSERVED EXPOSURE recorded when this case was opened — an identified gap, not money returned. " +
      "It is never summed into Revenue Returned and never into Auditable Revenue.",
    identityGrain: deriveCaseIdentityGrain({
      // The real contract status, never a literal: the day obligation identity is declared, this payload
      // changes with it and no edit here is required.
      obligationIdentityEstablishable: leakInstanceIdentityStatus().establishable,
      identityRefusalDetail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
      absorbedObservations: { checked: false },
    }),
    provenRevenueReturnedMinor: ledger.amount === null ? null : ledger.amount.minor,
    provenLedgerUnavailableReason: ledger.reason,
    provenFromProofIds: ledger.proofIds,
    baselineCount: baselines.length,
    evidence: projectEvidence(evidence),
    unknownAuthorityActions: unknownAuthorityActions(authorityEntries),
  });
}
