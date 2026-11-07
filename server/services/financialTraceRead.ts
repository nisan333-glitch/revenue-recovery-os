// THE GOVERNED READ for one obligation's financial trace (READ-ONLY, WRITES NOTHING).
//
// It gathers; `src/domain/financialTrace.ts` decides. The split is the same one `caseProvenGate` makes
// against `provenEligibility`, and for the same reason: the rule can be falsified without a database,
// the gathering can be falsified without re-stating the rule, and a new refusal cannot be invented here
// where no test would look for it.
//
// IT COMPUTES NO MONEY. Every figure is read from a record: the at-risk amount from the frozen
// promotion row, the baseline from the locked snapshot, the proof figure from the frozen proof chain,
// the observed amounts from the append-only task log. Nothing is re-derived, nothing is netted, and the
// one arithmetic this module does perform — `expected − billed` — is a RE-DERIVATION used to refuse,
// never to report a new number.
//
// FAILS CLOSED IN THE SAME THREE STEPS AS `readRecoveryCase`, in the same order: `AuditRead` first so an
// unauthorized actor cannot learn whether a case id is real; then a missing root is 404; then boundary
// access against the ROOT'S OWN boundary, which no request parameter can name.
//
// NO RAW IDENTIFIER LEAVES THIS MODULE. `sourceRef` and `obligationRef` are pseudonyms already, and they
// are still not rendered: the trace carries NH-issued ids (case, candidate, review, baseline, proof,
// evidence) and digests. The correction identity is reported as the same 24-hex digest the correction
// ledger uses, so the two surfaces can be lined up without either publishing the preimage.
import { prisma } from "../db";
import { getRecoveryCase } from "../persistence/recoveryCaseStore";
import { getCaseProofs } from "../persistence/proofStore";
import { getBaselinesForCase } from "../persistence/baselineStore";
import { getEvidenceForCase, type IngestedEvidence } from "../persistence/evidenceStore";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { NotFoundError } from "../http/errors";
import { effectiveProofs, isEffectiveRecovery } from "../../src/domain/proof";
import { caseProvenEligibility } from "./caseProvenGate";
import {
  CANDIDATE_CORRECTIONS_SQL,
  correctionIdentity,
  observationsFromRows,
  summariseCorrections,
  type CorrectionRecord,
  type RawCorrectionRow,
  type SucceededObservationRow,
} from "./candidateCorrections";
import { identityDigest } from "./candidateCorrectionsRead";
import type { ProvenIneligibilityCode } from "../../src/domain/provenEligibility";
import type { ObligationCoverageStated } from "../../src/domain/cfoProofReport";
import {
  attestationVerdict,
  buildFinancialTrace,
  canonicalFinancialTrace,
  type FinancialTrace,
  type TraceFigure,
  type TraceStage,
} from "../../src/domain/financialTrace";

export const FINANCIAL_TRACE_READ_SCHEME = "nh-financial-trace-read-v1";

/**
 * The correction facts a downstream report needs, PROJECTED.
 *
 * `CorrectionRecord` itself carries `identity`, `sourceRef` and `obligationRef` — pseudonyms, and still
 * not things a report publishes. Only the decision and its magnitude travel; the redaction test on this
 * surface is what would catch a widening here, and it is the reason this is a projection rather than the
 * record.
 */
export interface CorrectionSummary {
  readonly state: CorrectionRecord["state"];
  readonly observationCount: number;
  readonly orderCertain: boolean;
  /** `null` where the observation order is not establishable, so the magnitude is unknowable. */
  readonly undecidedMagnitudeMinor: number | null;
  readonly direction: CorrectionRecord["direction"];
}

/**
 * The evidence facts a downstream report needs, PROJECTED from the real rows.
 *
 * `sourceSystem` is a system name — billing, crm, product, external — and not a customer identifier;
 * `recoveryCaseRead` already publishes `trustClassification` and a `sourceVerification` boolean on a
 * governed surface, so this is the same disclosure in the same shape rather than a new one.
 *
 * `signatureVerified` says a signature VERIFIED and deliberately NOT that the signer is independent.
 * That question is answered once, by `trace.attestation`, and collapsing the two would let the weaker
 * fact wear the stronger one's guarantee.
 */
export interface EvidenceSourceSummary {
  readonly evidenceId: string;
  readonly sourceSystem: string;
  readonly evidenceType: string;
  readonly evidenceRole: string;
  readonly trustClassification: string;
  readonly beneficiaryControl: boolean;
  readonly signatureVerified: boolean;
}

export interface FinancialTraceView {
  readonly scheme: typeof FINANCIAL_TRACE_READ_SCHEME;
  readonly trace: FinancialTrace;
  /** The canonical preimage, returned so a reader can re-derive the digest instead of trusting it. */
  readonly canonical: string;
  readonly traceDigest: string;
  /** The correction ledger's digest for this identity, so the two surfaces line up. */
  readonly correctionIdentityDigest: string;
  /**
   * STRUCTURED FACTS FOR A DOWNSTREAM REPORT, so no consumer has to parse a note.
   *
   * These are deliberately OUTSIDE the canonical form: they restate decisions the trace already made,
   * so including them would let a presentation detail re-identify a trace. A report built on these
   * cannot disagree with the trace, because there is only one place each decision is taken.
   */
  readonly correctionSummary: CorrectionSummary | null;
  readonly gateVerdict: "ELIGIBLE" | ProvenIneligibilityCode;
  readonly obligationCoverageStated: ObligationCoverageStated;
  readonly evidenceSources: readonly EvidenceSourceSummary[];
}

const figure = (
  label: string,
  ledger: TraceFigure["ledger"],
  minor: number | null,
  currency: string,
): TraceFigure => Object.freeze({ label, ledger, minor, currency });

interface Coverage {
  readonly kind: "SINGLE_OBLIGATION" | "ACCOUNT_AGGREGATE";
  readonly obligationRef?: unknown;
  readonly expectedMinor?: unknown;
  readonly billedMinor?: unknown;
  readonly residualMinor?: unknown;
  readonly unitCount?: unknown;
}

/** Shape-checked, never cast: a row written by an older build must not pretend to be well-formed. */
function coverageOf(signal: unknown): Coverage | null {
  if (!signal || typeof signal !== "object") return null;
  const c = (signal as { obligationCoverage?: unknown }).obligationCoverage;
  if (!c || typeof c !== "object") return null;
  const kind = (c as { kind?: unknown }).kind;
  if (kind === "SINGLE_OBLIGATION" || kind === "ACCOUNT_AGGREGATE") return c as Coverage;
  return null;
}

const int = (v: unknown): number | null => (Number.isSafeInteger(v) ? (v as number) : null);

/**
 * Stage 1 · what the SOURCE said this claim covers.
 *
 * The one refusal decided here is F1: billed exceeding expected is a NEGATIVE residual, which the
 * constitution classifies as a liability signal — money the company may owe back is not money it found.
 * It is refused as exposure and the three source figures are still PRESERVED, because what the source
 * stated is a fact; only its reading as exposure is refused.
 */
function sourceObligationStage(coverage: Coverage | null, currency: string): TraceStage {
  const source = "agent_case_candidates.signal.obligationCoverage";
  if (coverage === null) {
    return Object.freeze({
      stage: "SOURCE_OBLIGATION" as const,
      status: "ABSENT" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "NOT_ESTABLISHABLE" as const,
      recordSource: source,
      recordIds: Object.freeze([]),
      figures: Object.freeze([]),
      refusalCode: null,
      note:
        "the detector recorded no obligation coverage, so what this claim covers was never stated. " +
        "Absence is not an aggregate and not a single obligation — it is a claim whose subject is unknown.",
    });
  }
  if (coverage.kind === "ACCOUNT_AGGREGATE") {
    const units = int(coverage.unitCount);
    return Object.freeze({
      stage: "SOURCE_OBLIGATION" as const,
      status: "ESTABLISHED" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "SIMULATED" as const,
      recordSource: source,
      recordIds: Object.freeze([]),
      figures: Object.freeze([]),
      refusalCode: null,
      note:
        `the detector stated ACCOUNT-LEVEL coverage of ${units ?? "an unrecorded number of"} reconciliation ` +
        "units, so no single obligation underlies this case. The coverage IS stated; what it states is an " +
        "aggregate, and the obligation-identity gate refuses it at the proof stage.",
    });
  }
  const expected = int(coverage.expectedMinor);
  const billed = int(coverage.billedMinor);
  const residual = int(coverage.residualMinor);
  const figures = Object.freeze([
    figure("expected by the contract side", "SOURCE_STATED", expected, currency),
    figure("billed by the billing side", "SOURCE_STATED", billed, currency),
    figure("residual the source stated", "SOURCE_STATED", residual, currency),
  ]);
  // RE-DERIVED, never trusted as stated. The gate makes the same check; this stage needs the sign.
  const derived = expected !== null && billed !== null ? expected - billed : null;
  if (derived !== null && derived < 0) {
    return Object.freeze({
      stage: "SOURCE_OBLIGATION" as const,
      status: "REFUSED" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "SIMULATED" as const,
      recordSource: source,
      recordIds: Object.freeze([]),
      figures,
      refusalCode: "NEGATIVE_RESIDUAL_NOT_EXPOSURE" as const,
      note:
        `billed ${billed} exceeds expected ${expected}, so the residual is negative. That is an OVER-BILLED ` +
        "liability signal — money the company may owe back — and it is never exposure and never recovered " +
        "revenue. The three source figures above are preserved; only their reading as exposure is refused.",
    });
  }
  return Object.freeze({
    stage: "SOURCE_OBLIGATION" as const,
    status: "ESTABLISHED" as const,
    executionClass: "EXECUTED" as const,
    inputClass: "SIMULATED" as const,
    recordSource: source,
    recordIds: Object.freeze([]),
    figures,
    refusalCode: null,
    note:
      "the detector stated SINGLE-OBLIGATION coverage with the expected amount, the billed amount and the " +
      "discrepancy between them. The amounts were produced by NH's own harness, not read from a customer file.",
  });
}

/** Stage 8 · the correction ledger's verdict for this identity, read and not re-decided. */
function correctionStage(record: CorrectionRecord | null, currency: string): TraceStage {
  const source = "agent_tasks.result + agent_task_events (append-only)";
  if (record === null) {
    return Object.freeze({
      stage: "CORRECTION_RECORD" as const,
      status: "ABSENT" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "NOT_ESTABLISHABLE" as const,
      recordSource: source,
      recordIds: Object.freeze([]),
      figures: Object.freeze([]),
      refusalCode: null,
      note:
        "no succeeded detection observation carrying this case's identity was found in the append-only task " +
        "log. That is not a finding that no correction exists: it is a finding that none was observed here.",
    });
  }
  const figures = Object.freeze([
    ...record.observedAmountsMinor.map((m, i) =>
      figure(`observation ${i + 1} as stated`, "SOURCE_STATED", m, record.currency),
    ),
    figure("stored by the governed store", "SOURCE_STATED", record.storedMinor, record.currency),
    // THE LABEL DEPENDS ON THE STATE, because `undecidedMagnitudeMinor` is 0 when there is genuinely
    // NOTHING to decide and null when the answer is unknowable. Printing "undecided" beside a zero for
    // a single observation would tell a reader precedence is undecided when it is not in question.
    figure(
      record.undecidedMagnitudeMinor === 0
        ? "nothing is undecided — one statement, or several that agree"
        : "undecided because precedence is undecided",
      "UNDECIDED_CORRECTION_MAGNITUDE",
      record.undecidedMagnitudeMinor,
      record.currency,
    ),
  ]);
  const refusal =
    record.state === "ORDER_NOT_ESTABLISHABLE"
      ? ("CORRECTION_ORDER_NOT_ESTABLISHABLE" as const)
      : record.state === "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED"
        ? ("CORRECTION_PRECEDENCE_UNDECIDED" as const)
        : null;
  return Object.freeze({
    stage: "CORRECTION_RECORD" as const,
    status: refusal === null ? ("ESTABLISHED" as const) : ("REFUSED" as const),
    executionClass: "EXECUTED" as const,
    inputClass: "SIMULATED" as const,
    recordSource: source,
    recordIds: Object.freeze([identityDigest(record.identity)]),
    figures,
    refusalCode: refusal,
    note:
      `${record.observationCount} observation(s), state ${record.state}, append order ` +
      `${record.orderCertain ? "establishable" : "NOT establishable"}. Every amount ever observed is listed ` +
      "above and none was discarded. No corrected, authoritative or effective amount is offered: which " +
      "statement wins is a business rule nobody has approved, and a number here would be that decision " +
      `wearing a different name. Currency ${currency}.`,
  });
}

/** Stage 9 · the settlement evidence, and what its signature does and does not establish. */
function settlementStage(evidence: readonly IngestedEvidence[], currency: string): {
  readonly stage: TraceStage;
  readonly receiptFields: readonly string[];
  readonly verifiedSignatureCount: number;
} {
  const source = "evidence_records";
  const receiptFields = new Set<string>();
  let verified = 0;
  for (const item of evidence) {
    const receipt = item.sourceVerification;
    if (receipt && typeof receipt === "object") {
      verified += 1;
      for (const k of Object.keys(receipt)) receiptFields.add(k);
    }
  }
  const outcome = evidence.filter((e) => e.evidenceRole === "outcome");
  const figures = Object.freeze(
    outcome.map((e) => figure(`evidence ${e.evidenceType} as stated`, "SOURCE_STATED", e.amountMinor, e.currency ?? currency)),
  );
  const independent = evidence.filter((e) => e.trustClassification === "independent").length;
  const beneficiaryControlled = evidence.filter((e) => e.beneficiaryControl).length;
  if (evidence.length === 0) {
    return {
      stage: Object.freeze({
        stage: "SETTLEMENT_EVIDENCE" as const,
        status: "ABSENT" as const,
        executionClass: "EXECUTED" as const,
        inputClass: "NOT_ESTABLISHABLE" as const,
        recordSource: source,
        recordIds: Object.freeze([]),
        figures: Object.freeze([]),
        refusalCode: null,
        note: "no evidence has been ingested for this case.",
      }),
      receiptFields: Object.freeze([]),
      verifiedSignatureCount: 0,
    };
  }
  return {
    stage: Object.freeze({
      stage: "SETTLEMENT_EVIDENCE" as const,
      status: "REFUSED" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "SIMULATED" as const,
      recordSource: source,
      recordIds: Object.freeze(evidence.map((e) => e.evidenceId).sort()),
      figures,
      refusalCode: "SETTLEMENT_INDEPENDENCE_NOT_ESTABLISHABLE" as const,
      note:
        `${evidence.length} evidence row(s), ${independent} classified independent, ` +
        `${beneficiaryControlled} beneficiary-controlled, ${verified} carrying a verified source signature. ` +
        "Ed25519 verification is the real production path and really refuses a tampered payload — but it " +
        "establishes that the payload was signed by a key in NH's configured trust registry and NOTHING " +
        "about who holds that key. No customer system has ever signed anything here.",
    }),
    receiptFields: Object.freeze([...receiptFields].sort()),
    verifiedSignatureCount: verified,
  };
}

/**
 * Read one case's financial trace.
 *
 * THE BOUNDARY SCAN IS SCOPED, like the correction ledger's: unscoped, `CANDIDATE_CORRECTIONS_SQL` is a
 * forensic full-table scan, and a governed read must not be able to return another boundary's history by
 * omitting a parameter.
 */
export async function readFinancialTrace(
  actor: ActorContext,
  recoveryCaseId: string,
): Promise<FinancialTraceView> {
  requireCan(actor, "AuditRead");

  const root = await getRecoveryCase(recoveryCaseId);
  if (root === null) throw new NotFoundError(`recovery case ${recoveryCaseId} has no authoritative root`);
  requireBoundaryAccess(actor, root.boundaryId);

  const [candidate, review, baselines, evidence, proofs, gate, rawRows] = await Promise.all([
    prisma.agentCaseCandidateRecord.findUnique({
      where: { candidateId: root.sourceCandidateId },
      select: { candidateId: true, dedupeKey: true, agentId: true, signal: true, status: true },
    }),
    prisma.agentCaseCandidateReviewRecord.findUnique({
      where: { candidateId: root.sourceCandidateId },
      select: { reviewId: true, decision: true, reason: true, actorRole: true },
    }),
    getBaselinesForCase(recoveryCaseId),
    getEvidenceForCase(recoveryCaseId),
    getCaseProofs(recoveryCaseId),
    caseProvenEligibility(recoveryCaseId),
    prisma.$queryRawUnsafe<RawCorrectionRow[]>(CANDIDATE_CORRECTIONS_SQL, root.boundaryId),
  ]);

  const coverage = coverageOf(candidate?.signal);
  const currency = root.currency;

  // THE SAME IDENTITY FUNCTION THE CORRECTION LEDGER USES, applied to this case's own facts, so the two
  // surfaces group identically. Reimplementing the grouping here would be a second definition of one word.
  const caseIdentity = correctionIdentity(
    Object.freeze({
      boundaryId: root.boundaryId,
      recoveryType: root.recoveryType,
      sourceRef: root.sourceRef,
      observed: Object.freeze({
        eventSequence: 0,
        amountAtRiskMinor: 0,
        currency,
        obligationRef:
          coverage?.kind === "SINGLE_OBLIGATION" && typeof coverage.obligationRef === "string"
            ? coverage.obligationRef
            : null,
        obligationGrained: coverage?.kind === "SINGLE_OBLIGATION" && typeof coverage.obligationRef === "string",
      }),
    }) satisfies SucceededObservationRow,
  );
  const corrections = summariseCorrections(observationsFromRows(rawRows));
  const correctionRecord = corrections.records.find((r) => r.identity === caseIdentity) ?? null;
  const observationsForThisIdentity = observationsFromRows(rawRows).filter(
    (r) => correctionIdentity(r) === caseIdentity,
  );

  const settlement = settlementStage(evidence, currency);
  const attestation = attestationVerdict({
    receiptFields: settlement.receiptFields,
    verifiedSignatureCount: settlement.verifiedSignatureCount,
    evidenceCount: evidence.length,
  });

  const effective = effectiveProofs(proofs).filter(isEffectiveRecovery);
  const proofFigureMinor =
    effective.length === 0 || effective.some((p) => p.currency !== currency)
      ? null
      : effective.reduce((sum, p) => sum + p.revenueReturned.minor, 0);

  const sourceStage = sourceObligationStage(coverage, currency);
  // F1 · a negative residual yields NO exposure figure. The promotion row's amount is not reported as
  // exposure for a claim whose own source figures say the company over-billed.
  const exposureMinor = sourceStage.refusalCode === "NEGATIVE_RESIDUAL_NOT_EXPOSURE" ? null : root.amountAtRiskMinor;

  const stages: TraceStage[] = [
    sourceStage,
    Object.freeze({
      stage: "DETECTION" as const,
      status: observationsForThisIdentity.length > 0 ? ("ESTABLISHED" as const) : ("ABSENT" as const),
      executionClass: "EXECUTED" as const,
      inputClass: observationsForThisIdentity.length > 0 ? ("SIMULATED" as const) : ("NOT_ESTABLISHABLE" as const),
      recordSource: "agent_tasks + agent_task_events (append-only, database-allocated sequence)",
      recordIds: Object.freeze(
        observationsForThisIdentity.map((o) => `seq:${o.observed.eventSequence}`).sort(),
      ),
      figures: Object.freeze(
        observationsForThisIdentity.map((o, i) =>
          figure(`detector statement ${i + 1}`, "SOURCE_STATED", o.observed.amountAtRiskMinor, o.observed.currency),
        ),
      ),
      refusalCode: null,
      note:
        `${observationsForThisIdentity.length} succeeded detection observation(s) carry this identity. The ` +
        "detector ran as production code; the observation it read was injected by NH's harness, because NH " +
        "deliberately has no screen that creates a finding — one would let the beneficiary author what the " +
        "review gate exists to judge.",
    }),
    Object.freeze({
      stage: "CANDIDATE" as const,
      status: candidate ? ("ESTABLISHED" as const) : ("ABSENT" as const),
      executionClass: "EXECUTED" as const,
      inputClass: candidate ? ("SIMULATED" as const) : ("NOT_ESTABLISHABLE" as const),
      recordSource: "agent_case_candidates",
      recordIds: Object.freeze(candidate ? [candidate.candidateId] : []),
      figures: Object.freeze([]),
      refusalCode: null,
      note: candidate
        ? `candidate ${candidate.candidateId} staged by ${candidate.agentId}, status ${candidate.status}. Its ` +
          "dedupe key is under a UNIQUE index whose rows can be neither updated nor deleted, so a second " +
          "candidate for this identity is refused by the database and not by a check."
        : "the candidate row this case was promoted from is not present.",
    }),
    Object.freeze({
      stage: "REVIEW" as const,
      status: review ? ("ESTABLISHED" as const) : ("ABSENT" as const),
      executionClass: "EXECUTED" as const,
      inputClass: review ? ("SIMULATED" as const) : ("NOT_ESTABLISHABLE" as const),
      recordSource: "agent_case_candidate_reviews (immutable, one review per candidate)",
      recordIds: Object.freeze(review ? [review.reviewId] : []),
      figures: Object.freeze([]),
      refusalCode: null,
      note: review
        ? `decision ${review.decision} by role ${review.actorRole}, with a reason of ` +
          `${review.reason.trim().length} characters. A decision with no reason is refused at the screen and ` +
          "at the API; acceptance is not promotion, and the two are separate acts."
        : "no review row exists for this candidate.",
    }),
    Object.freeze({
      stage: "RECOVERY_CASE" as const,
      status: "ESTABLISHED" as const,
      executionClass: "EXECUTED" as const,
      inputClass: "SIMULATED" as const,
      recordSource: "recovery_cases",
      recordIds: Object.freeze([root.recoveryCaseId]),
      figures: Object.freeze([
        figure("at risk, frozen at promotion", "OBSERVED_EXPOSURE", exposureMinor, currency),
      ]),
      refusalCode: null,
      note:
        `root opened by ${root.openedByRole} under policy ${root.policyVersion}, detector ` +
        `${root.detectorVersion}. The at-risk figure is OBSERVED EXPOSURE and on this entry path it arrived ` +
        "as a request input rather than being derived from a customer file, so it is doubly not evidence.",
    }),
    Object.freeze({
      stage: "BASELINE" as const,
      status: baselines.length > 0 ? ("ESTABLISHED" as const) : ("ABSENT" as const),
      executionClass: "EXECUTED" as const,
      inputClass: baselines.length > 0 ? ("SIMULATED" as const) : ("NOT_ESTABLISHABLE" as const),
      recordSource: "baseline_snapshots (locked)",
      recordIds: Object.freeze(baselines.map((b) => b.baselineId).sort()),
      figures: Object.freeze(
        baselines.map((b) => figure(`baseline ${b.method} v${b.methodVersion}`, "BASELINE", b.calculatedMinor, b.currency)),
      ),
      refusalCode: null,
      note:
        baselines.length > 0
          ? "the baseline was locked before the outcome was known, which is what makes the later subtraction " +
            "a proof rather than a calculation."
          : "no baseline is locked, so no proof may be minted: there is nothing to subtract from.",
    }),
    Object.freeze({
      stage: "PROPOSED_CORRECTION" as const,
      status: "REFUSED" as const,
      executionClass: "NOT_IMPLEMENTED" as const,
      inputClass: "NOT_ESTABLISHABLE" as const,
      recordSource: "none — no table, route or status exists",
      recordIds: Object.freeze([]),
      figures: Object.freeze([]),
      refusalCode: "BILLING_CORRECTION_NOT_IMPLEMENTED" as const,
      note:
        "NH has NO billing-correction mechanism: no request, no approval, no execution, no status. " +
        "`BillingCorrection` is a RecoveryReason — a label a proof carries — and nothing more. The " +
        "execution is specified in docs/architecture/BILLING_CORRECTION_EXECUTION_SPEC_V1.md and is blocked " +
        "on the S-DUP-4 precedence decision, which is the owner's. Whatever a corrective-action record says " +
        "elsewhere in this case, NH did not contact a billing system and raised no charge.",
    }),
    correctionStage(correctionRecord, currency),
    settlement.stage,
    Object.freeze({
      stage: "PROOF" as const,
      status: gate.eligible && proofFigureMinor !== null ? ("ESTABLISHED" as const) : ("REFUSED" as const),
      executionClass: "EXECUTED" as const,
      inputClass: "SIMULATED" as const,
      recordSource: "proofs + caseProvenEligibility (obligation-identity gate)",
      recordIds: Object.freeze(effective.map((p) => p.proofId).sort()),
      figures: Object.freeze([
        figure("the proof chain's own figure", "PROVEN_REVENUE_RETURNED", proofFigureMinor, currency),
      ]),
      refusalCode: gate.eligible
        ? proofFigureMinor === null
          ? ("NO_EFFECTIVE_RECOVERY_PROOF" as const)
          : null
        : ("OBLIGATION_IDENTITY_GATE_REFUSED" as const),
      note: gate.eligible
        ? `the obligation-identity gate permits a proof for this case; ${effective.length} effective recovery ` +
          "proof(s) exist. The figure above is what the frozen chain computed from a locked baseline and " +
          "referenced evidence — and the trace's verdict on Revenue Returned is separate, because an " +
          "internally valid proof over evidence nobody independent asserted is not money the business got back."
        : `the obligation-identity gate REFUSED this case with ${gate.code}: ${gate.reason}`,
    }),
  ];

  const trace = buildFinancialTrace({
    recoveryCaseId: root.recoveryCaseId,
    boundaryId: root.boundaryId,
    currency,
    stages,
    observedExposureMinor: exposureMinor,
    proofChainFigureMinor: proofFigureMinor,
    proofIds: effective.map((p) => p.proofId).sort(),
    attestation,
    identityGateRefusalCode: gate.eligible ? null : gate.code,
  });

  const canonical = canonicalFinancialTrace(trace);
  return Object.freeze({
    scheme: FINANCIAL_TRACE_READ_SCHEME,
    trace,
    canonical,
    traceDigest: await sha256Hex(canonical),
    correctionIdentityDigest: identityDigest(caseIdentity),
    correctionSummary:
      correctionRecord === null
        ? null
        : Object.freeze({
            state: correctionRecord.state,
            observationCount: correctionRecord.observationCount,
            orderCertain: correctionRecord.orderCertain,
            undecidedMagnitudeMinor: correctionRecord.undecidedMagnitudeMinor,
            direction: correctionRecord.direction,
          }),
    gateVerdict: gate.eligible ? ("ELIGIBLE" as const) : gate.code,
    evidenceSources: Object.freeze(
      [...evidence]
        .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
        .map((e) =>
          Object.freeze({
            evidenceId: e.evidenceId,
            sourceSystem: e.sourceSystem,
            evidenceType: e.evidenceType,
            evidenceRole: e.evidenceRole,
            trustClassification: e.trustClassification,
            beneficiaryControl: e.beneficiaryControl,
            signatureVerified: Boolean(e.sourceVerification),
          }),
        ),
    ),
    obligationCoverageStated:
      coverage === null
        ? ("NOT_STATED" as const)
        : coverage.kind === "ACCOUNT_AGGREGATE"
          ? ("ACCOUNT_AGGREGATE" as const)
          : ("SINGLE_OBLIGATION" as const),
  });
}

/** Web Crypto, the same primitive `hashFinding` uses, so one hash function serves both runtimes. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
