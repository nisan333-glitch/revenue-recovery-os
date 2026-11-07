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

  const report = buildCfoProofReport({ boundaryId, rows });
  const canonical = canonicalCfoProofReport(report);
  return Object.freeze({
    scheme: CFO_PROOF_REPORT_READ_SCHEME,
    report,
    canonical,
    reportDigest: await sha256Hex(canonical),
    traceDigests: Object.freeze(traceDigests),
  });
}

/** Web Crypto, the same primitive the trace and `hashFinding` use, so one hash function serves all. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
