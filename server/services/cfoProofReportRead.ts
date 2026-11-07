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
  type RefusedExposureFacts,
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

  const [unpromoted, refused] = await Promise.all([unpromotedIn(boundaryId), refusedIn(boundaryId)]);
  const report = buildCfoProofReport({ boundaryId, rows, unpromoted, refused });
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

/** One succeeded run's recorded observation, as the metadata stores it. */
const REFUSED_SQL = `SELECT ev.metadata -> 'observation' -> 'refusedExposure' AS refused
       FROM agent_task_events AS ev
      WHERE ev.kind = 'task.succeeded'
        AND ev.boundary_id = $1
        AND ev.metadata -> 'observation' -> 'refusedExposure' IS NOT NULL
      ORDER BY ev.event_sequence ASC`;

interface RefusedRow {
  readonly refused: unknown;
}

/**
 * The refused-exposure facts for a boundary, read from the append-only task log.
 *
 * `null` means NO RUN RECORDED ONE — which the report renders as `NOT_RECORDED`, not as
 * `NONE_REFUSED`. That distinction is the whole reason this function returns a nullable: either no
 * detector that can refuse has run here, or its runs predate handlers being able to record one, and
 * **absence of the record is not absence of refusals**.
 *
 * SEVERAL RUNS ARE COMBINED BY TAKING THE WORST STATE, never by averaging or by taking the latest.
 * `UNDETERMINED` on any run means something was refused in this boundary and that cannot be undone by a
 * later clean run; `NOT_EXAMINED` on any run means part of the book was never read. Only when every run
 * examined its units and refused none is the answer `NONE_REFUSED` — the one state in which a zero is a
 * finding. The counts are summed across runs that carry them.
 *
 * `refusedExpectedMinor` is `null` for `NOT_EXAMINED`, because nothing was read and a zero would assert
 * the contract side stated nothing.
 */
async function refusedIn(boundaryId: string): Promise<RefusedExposureFacts | null> {
  const rows = await prisma.$queryRawUnsafe<RefusedRow[]>(REFUSED_SQL, boundaryId);
  const observed: {
    state: "NOT_EXAMINED" | "NONE_REFUSED" | "UNDETERMINED";
    refusedUnits: number;
    refusedExpectedMinor: number;
    refusedWithoutExpected: number;
    currency: string;
  }[] = [];
  for (const row of rows) {
    const r = row.refused;
    // SHAPE-CHECKED ON THE WAY OUT TOO. The writer validates, but a row written by another build or
    // edited by hand must not reach a financial report pretending to be well formed. A malformed row
    // contributes NOTHING rather than a zero.
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (rec.state !== "NOT_EXAMINED" && rec.state !== "NONE_REFUSED" && rec.state !== "UNDETERMINED") continue;
    if (!Number.isSafeInteger(rec.refusedUnits) || !Number.isSafeInteger(rec.refusedExpectedMinor)
      || !Number.isSafeInteger(rec.refusedWithoutExpected) || typeof rec.currency !== "string") continue;
    observed.push({
      state: rec.state,
      refusedUnits: rec.refusedUnits as number,
      refusedExpectedMinor: rec.refusedExpectedMinor as number,
      refusedWithoutExpected: rec.refusedWithoutExpected as number,
      currency: rec.currency,
    });
  }
  if (observed.length === 0) return null;

  const state = observed.some((o) => o.state === "UNDETERMINED")
    ? ("UNDETERMINED" as const)
    : observed.some((o) => o.state === "NOT_EXAMINED")
      ? ("NOT_EXAMINED" as const)
      : ("NONE_REFUSED" as const);
  const currencies = new Set(observed.map((o) => o.currency));
  return {
    state,
    runsCarryingAnObservation: observed.length,
    refusedUnits: observed.reduce((n, o) => n + o.refusedUnits, 0),
    // NULL FOR NOT_EXAMINED, and null where the runs disagree on currency: a sum across currencies is a
    // figure no record asserts, and NH holds no governed rate to convert with.
    refusedExpectedMinor:
      state === "NOT_EXAMINED" || currencies.size !== 1
        ? null
        : observed.reduce((n, o) => n + o.refusedExpectedMinor, 0),
    refusedWithoutExpected: observed.reduce((n, o) => n + o.refusedWithoutExpected, 0),
    currency: currencies.size === 1 ? [...currencies][0]! : null,
  };
}

/** Web Crypto, the same primitive the trace and `hashFinding` use, so one hash function serves all. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
