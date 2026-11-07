// THE GOVERNED READ for a boundary's CFO Proof report (READ-ONLY, WRITES NOTHING).
//
// IT TAKES EVERY DECISION FROM THE FINANCIAL TRACE and re-decides nothing. One case, one
// `readFinancialTrace`, one row — so the CFO report and the trace cannot disagree, because there is only
// one place each verdict is reached. A second derivation of "is this proven" or "what is disputed" would
// be a second thing that can drift from the first, which is the mistake this repository keeps correcting.
//
// WHY A NEW SURFACE RATHER THAN A WIDER `cfoAuditExport`. Measured before building, on commit fb09308:
// `cfoAuditExport` answers for a case id THAT DOES NOT EXIST with `provenRevenueReturnedMinor: 0`,
// `auditableRevenueMinor: 0`, `currency: null` and `excluded: false`. So a case with no proof, a case
// whose proofs were all reversed, and a case that was never opened are indistinguishable there — a clean
// zero on the most financially consequential surface in the product. That route has three production
// consumers (the UI trust client, the synthetic pilot harness and the HTTP route), so changing it is a
// decision with an owner and is NOT taken here. This is an additive sibling that fails closed, exactly
// as `recoveryCaseRead` is a sibling of the deliberately root-tolerant `caseAuditTrail`.
//
// A CASE THAT DOES NOT EXIST IS NOT A ROW. The report enumerates governed roots, so a non-existent id
// cannot appear at all, with zeros or otherwise. That is the structural form of failing closed: the
// absence is not reported as a settled account.
//
// FAILS CLOSED IN TWO STEPS, IN THIS ORDER. `AuditRead` first, so an unauthorized actor learns nothing —
// including whether a boundary holds any cases. Then boundary access, so an actor can only name a
// boundary they hold; the enumeration is scoped to it, and an unscoped read of every case in the estate
// is not reachable by omitting a parameter.
import { prisma } from "../db";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { readFinancialTrace } from "./financialTraceRead";
import {
  buildCfoProofReport,
  canonicalCfoProofReport,
  cfoProofRow,
  type CfoProofReport,
  type CfoProofRow,
  type ObligationCoverageStated,
  type UnpromotedCandidateFacts,
} from "../../src/domain/cfoProofReport";

export const CFO_PROOF_REPORT_READ_SCHEME = "nh-cfo-proof-report-read-v1";

export interface CfoProofReportView {
  readonly scheme: typeof CFO_PROOF_REPORT_READ_SCHEME;
  readonly report: CfoProofReport;
  /** The canonical preimage, so a reader re-derives the digest rather than trusting it. */
  readonly canonical: string;
  readonly reportDigest: string;
  /** Each row's trace digest, so a reader can go from a line to the evidence behind it. */
  readonly traceDigests: readonly { readonly recoveryCaseId: string; readonly traceDigest: string }[];
}

export async function readCfoProofReport(
  actor: ActorContext,
  boundaryId: string,
): Promise<CfoProofReportView> {
  requireCan(actor, "AuditRead");
  requireBoundaryAccess(actor, boundaryId);

  const roots = await prisma.recoveryCaseRecord.findMany({
    where: { boundaryId },
    select: { recoveryCaseId: true },
    orderBy: { recoveryCaseId: "asc" },
  });

  const rows: CfoProofRow[] = [];
  const traceDigests: { recoveryCaseId: string; traceDigest: string }[] = [];
  for (const root of roots) {
    const view = await readFinancialTrace(actor, root.recoveryCaseId);
    const correction = view.correctionSummary;
    rows.push(
      cfoProofRow({
        recoveryCaseId: view.trace.recoveryCaseId,
        currency: view.trace.currency,
        obligationCoverage: view.obligationCoverageStated,
        detectedExposureMinor: view.trace.observedExposure?.minor ?? null,
        // NOT_OBSERVED is not a zero dispute: it means no succeeded observation carrying this identity
        // was found in the append-only log, which is a different claim from "nothing is in dispute".
        disputedAmountMinor: correction === null ? null : correction.undecidedMagnitudeMinor,
        disputedDirection: correction?.direction ?? null,
        disputedState: correction === null ? "NOT_OBSERVED" : correction.state,
        proofChainFigureMinor: view.trace.revenueReturned.proofChainFigure?.minor ?? null,
        evidenceSources: view.evidenceSources.map((e) => ({
          sourceSystem: e.sourceSystem,
          trustClassification: e.trustClassification,
          signatureVerified: e.signatureVerified,
        })),
        attestationCode: view.trace.attestation.code,
        gateVerdict: view.gateVerdict,
        revenueReturnedWithheldCodes: view.trace.revenueReturned.codes,
      }),
    );
    traceDigests.push({ recoveryCaseId: root.recoveryCaseId, traceDigest: view.traceDigest });
  }

  const report = buildCfoProofReport({ boundaryId, rows, unpromoted: await unpromotedIn(boundaryId) });
  const canonical = canonicalCfoProofReport(report);
  return Object.freeze({
    scheme: CFO_PROOF_REPORT_READ_SCHEME,
    report,
    canonical,
    reportDigest: await sha256Hex(canonical),
    traceDigests: Object.freeze(traceDigests),
  });
}


/**
 * The candidates in this boundary that never became a case, split by what actually happened to them.
 *
 * THE STATE IS DERIVED FROM THE REVIEW ROW AND THE ROOT, NEVER FROM `agent_case_candidates.status`:
 * the constraint `agent_case_candidates_status_valid` pins that column to `'pending_review'` for EVERY
 * row, so it is inert by construction and reading it would report every candidate as unreviewed —
 * including ones long since promoted. A column that can only hold one value is not a state machine.
 *
 * `pendingReview`, `rejected` and `acceptedNotPromoted` are kept apart because they are three different
 * positions: nobody has looked, somebody looked and said no, and somebody said yes and the promotion
 * has not happened. Collapsing them would hide which one a reader can act on.
 *
 * The stated amounts are summed starting at the FIRST ESTABLISHED FIGURE, so a set with no readable
 * amount totals `null` rather than a clean zero.
 */
async function unpromotedIn(boundaryId: string): Promise<UnpromotedCandidateFacts> {
  const candidates = await prisma.agentCaseCandidateRecord.findMany({
    where: { boundaryId },
    select: { candidateId: true, signal: true },
  });
  if (candidates.length === 0) {
    return { pendingReview: 0, rejected: 0, acceptedNotPromoted: 0, statedAmountMinor: null, coverageKinds: [] };
  }
  const ids = candidates.map((c) => c.candidateId);
  const [reviews, promoted] = await Promise.all([
    prisma.agentCaseCandidateReviewRecord.findMany({
      where: { candidateId: { in: ids } }, select: { candidateId: true, decision: true },
    }),
    prisma.recoveryCaseRecord.findMany({
      where: { sourceCandidateId: { in: ids } }, select: { sourceCandidateId: true },
    }),
  ]);
  const decisionOf = new Map(reviews.map((r) => [r.candidateId, r.decision]));
  const hasRoot = new Set(promoted.map((r) => r.sourceCandidateId));

  let pendingReview = 0;
  let rejected = 0;
  let acceptedNotPromoted = 0;
  let statedAmountMinor: number | null = null;
  const kinds = new Set<ObligationCoverageStated>();
  for (const c of candidates) {
    if (hasRoot.has(c.candidateId)) continue;
    const decision = decisionOf.get(c.candidateId);
    if (decision === undefined) pendingReview += 1;
    else if (decision === "rejected") rejected += 1;
    else acceptedNotPromoted += 1;
    const signal = c.signal as { amountAtRiskMinor?: unknown; obligationCoverage?: { kind?: unknown } } | null;
    const amount = signal?.amountAtRiskMinor;
    if (Number.isSafeInteger(amount)) {
      statedAmountMinor = (statedAmountMinor ?? 0) + (amount as number);
    }
    const kind = signal?.obligationCoverage?.kind;
    kinds.add(
      kind === "SINGLE_OBLIGATION" ? "SINGLE_OBLIGATION" : kind === "ACCOUNT_AGGREGATE" ? "ACCOUNT_AGGREGATE" : "NOT_STATED",
    );
  }
  return {
    pendingReview, rejected, acceptedNotPromoted, statedAmountMinor,
    coverageKinds: [...kinds],
  };
}

/** Web Crypto, the same primitive the trace and `hashFinding` use, so one hash function serves all. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
