// EP-16 · Pilot Assessment Orchestration — the governed handoff.
//
// WHAT WAS MISSING. EP-13/14/15 produced a dataset that is validated, judged fit, and judged under a
// bar governance put in force. Then the trail stopped. Assessment still ran in the browser, over
// whatever bytes were in memory, under whatever policy the page happened to hold. So the admission
// decision governed a verdict about a FILE and governed nothing about the RUN — and a number that
// comes out of an ungoverned run is indistinguishable from a number someone typed.
//
// THE ORDER BELOW IS THE SECURITY DESIGN, and S4 reversed the first half of it:
//   1. least privilege      — may this role schedule at all;
//   2. tenant authorization — is this actor entitled to THIS boundary;
//   3. the anchor           — load the IMMUTABLE admission decision, and check it against itself:
//                             the supplied bytes are its bytes, and it still hashes to its own id;
//   4. the admitted terms   — read the interpretation this verdict was reached under, and the
//                             governed analysis-terms version it names, FROM THE RECORD;
//   5. the identity         — re-derive the submission key from exactly those facts and compare it,
//                             unconditionally, to the key the record is stored under;
//   6. contract support     — may this build still serve what that decision was admitted under;
//   7. contract validation  — the same validator, over the supplied bytes, under the ADMITTED
//                             interpretation rather than under anything this request claims;
//   8. governance           — is the bar that admitted it still ACTIVE;
//   9. projection           — accepted cycles only, de-identified;
//  10. persistence + enqueue — atomically, keyed by a deterministic id.
//
// WHY THAT ORDER CHANGED. Validation used to run FIRST, over caller-supplied interpretation, and the
// key it produced was how the decision was found. Everything authoritative therefore arrived from the
// party that benefits from the number: the date locale, the amount format and the analysis terms all
// came from the request, and the "check" at the end compared a hash of those inputs against a record
// selected BY that same hash — which can only ever agree. `declaredVersion` was worse than inert: a
// malformed or unsupported value raised a dataset-level rejection, emptied `acceptedCycles`, and
// refused a properly admitted dataset with NH-AX-1009 as though its data were at fault.
//
// Now the reference comes first and the record answers. The re-derivation can genuinely fail, and
// what it then reports is the record's own inconsistency — not a disagreement with the caller.
//
// Nothing is written before step 9 passes, so a refused schedule leaves no execution behind.
//
// WHAT IT NEVER DOES. No Proof, no Recovery Case, no authority-ledger entry, no counted dollar. The
// agent it enqueues emits zero CandidateSignals, which is how the automatic path into case creation
// is kept structurally absent rather than merely unused.
import {
  deriveIdempotencyKey,
  validatePilotDataset,
  type ContractValidationReport,
  type DatasetSubmission,
} from "../../src/contract/validateDataset";
import {
  PILOT_DATA_CONTRACT_VERSION,
  isSupportedContractVersion,
  parseContractVersion,
  type DatasetProvenance,
} from "../../src/contract/pilotDataContract";
import { sha256Hex } from "../../src/assessment/fingerprint";
import type { AnalysisTerms } from "../../src/contract/analysisTerms";
import {
  assessmentPolicyRef,
  deriveAdmissionDecisionId,
  deriveExecutionId,
  hashExecutionBinding,
  hashExecutionInput,
  projectExecutionInput,
  type ExecutionBinding,
  type ExecutionInput,
  type ExecutionState,
} from "../../src/contract/assessmentExecution";
import {
  executionCode,
  type ExecutionCodeSpec,
  type ExecutionRefusal,
} from "../../src/contract/executionCodes";
import { mayEvaluate, whyCannotEvaluate, type PolicyState } from "../../src/contract/policyLifecycle";
import { ASSESSMENT_CALC_VERSION, makePolicy } from "../../src/assessment/policy";
import { calculationMethodsCompatible } from "../../src/assessment/calculationMethodLineage";
import { bindingRevisionDelta, isPermittedRevision, type BindingRevisionDelta } from "../../src/contract/assessmentRevision";
import { findAdmissionPolicy } from "../persistence/pilotAdmissionPolicyStore";
import { policyHashMatches } from "../../src/contract/policyHash";
import { observedSummary } from "../../src/assessment/observed";
import { splitCohorts } from "../../src/assessment/cohort";
import type { DateLocale } from "../../src/assessment/dateNormalize";
import type { AmountFormat } from "../../src/assessment/amountNormalize";
import { ForbiddenError, NotFoundError } from "../http/errors";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import {
  findSubmission,
  findSubmissionByDecisionId,
  type PilotSubmissionRecord,
} from "../persistence/pilotDatasetStore";
import { policyGovernanceState } from "../persistence/pilotPolicyGovernanceStore";
import {
  createExecutionIfAbsent,
  findExecutionInput,
  inputPurgeRecord,
  executionStatus,
  findExecution,
  findFinding,
  listExecutions,
  type ExecutionRecord,
} from "../persistence/pilotExecutionStore";
import { resolveGovernedAnalysisTerms } from "./pilotAnalysisTermsService";
import { readDatasetFirstSeenAt, readSourceGovernance } from "./sourceAuthorityService";
import { resolveSourceNamespace, sourceResolutionHash } from "../../src/contract/sourceNamespace";
import {
  deriveStagedAttributions,
  resolveSignalStagingConfig,
  type CandidateStagingBlockedReason,
  type CandidateStagingDecision,
  type SignalStagingConfig,
} from "./governedSignalStaging";
import { PILOT_ASSESSMENT_AGENT_ID } from "../agents/pilotAssessmentAgent";
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import type { AgentTaskStore } from "../agents/types";

export interface SchedulePilotAssessmentRequest {
  /** Authorization REQUEST, never an assertion — `requireBoundaryAccess` decides. */
  readonly boundaryId: string;
  readonly datasetId: string;
  // S5 · `declaredVersion` IS NOT HERE. S4 made it inert; this removes it, so the type can no longer
  // express it and no call site can pass it. It used to reach `validatePilotDataset`, where a malformed
  // or unsupported value raises a `dataset_rejected` finding — which empties `acceptedCycles` and
  // refused the schedule of a properly admitted dataset with NH-AX-1009, blaming the data for a claim
  // the caller made. The authoritative declaration is `decision.declaredVersion ?? decision.contractVersion`,
  // read from the immutable admission on both paths.
  /**
   * S4 · REFERENCE-FIRST. The admission decision this execution is to be bound to, as returned by the
   * intake that recorded it.
   *
   * CITED, NOT ASSERTED: it is looked up boundary-scoped, so an identifier minted for another tenant
   * reads as absent, and every authoritative fact — the admitted declaration, the date locale, the
   * amount format, the governed analysis terms, the contract major — is then read from the stored
   * record rather than from this request. Supplying it is what makes the submission-identity
   * re-derivation EVIDENCE of lineage instead of a restatement of the caller's own inputs.
   *
   * Optional, and absence is not a loophole: without it the server falls back to discovering the
   * decision from a key derived over caller-supplied interpretation (the legacy path below), which
   * can only ever find a record that already agrees with those inputs — and, because the key embeds
   * the build's contract major, can only find one admitted under the SAME major. A dataset admitted
   * under a previous major is reachable only by citing it here.
   */
  readonly admissionDecisionId?: string;
  readonly csvText: string;
  /**
   * EP-26b · WHICH GOVERNED ASSESSMENT POLICY this execution is measured under. Not a set of values:
   * `asOf`, `stallThresholdDays` and the currency together define what is being measured, so they are
   * proposed by one identity and activated by another. An absent, unknown, draft, frozen or retired
   * reference is refused with NH-AX-1010 — there is no default and no fallback.
   */
  readonly analysisTermsId?: string;
  readonly analysisTermsVersion?: string;
  readonly provenance: DatasetProvenance;
  readonly locale?: DateLocale;
  readonly amountFormat?: AmountFormat;
  /**
   * Optional link to a governed recovery case. When set, that case's Halt blocks the execution.
   * Supplying it never CREATES a case, and an execution never authors one.
   */
  readonly recoveryCaseId?: string;
}

export interface SchedulePilotAssessmentResponse {
  readonly scheduled: boolean;
  /** False when an identical binding was already scheduled — the idempotent path. */
  readonly created: boolean;
  readonly executionId: string | null;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly binding: ExecutionBinding | null;
  /** The deterministic NH-AX-#### refusal, when the schedule was refused. */
  readonly refusal: ExecutionCodeSpec | null;
  /** Non-identifying context for the refusal. Never echoes a customer value. */
  readonly refusalDetail: string | null;
  /**
   * EP-31c · Whether candidate-capable attribution was staged for this execution, and if not, why.
   *
   * DELIBERATELY NOT `refusal`/`refusalDetail`. Those are the deterministic NH-AX-#### refusals of the
   * EXECUTION, and putting a candidate-side outcome there would let `scheduled: true` sit beside a
   * `refusal` — which reads as the assessment having been refused when it was not. No NH-AX code is
   * invented for this: the execution vocabulary is unchanged.
   *
   * `staged: false` is the ordinary case. Under the current data contract it is ALWAYS false, with
   * reason `leak_instance_identity_unavailable`, because no declared field can establish a stable
   * obligation identity (`src/contract/leakInstanceIdentity.ts`). An assessment does not need one.
   */
  readonly candidateStaging: CandidateStagingDecisionSummary;
  readonly admissionPolicyState: PolicyState | null;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

const CLAIM_BOUNDARY = Object.freeze({
  observationOnly: true as const,
  constitutesProof: false as const,
  constitutesRevenue: false as const,
  createsRecoveryCase: false as const,
});

function refused(
  boundaryId: string,
  refusal: ExecutionRefusal,
  detail: string,
  admissionPolicyState: PolicyState | null = null,
): SchedulePilotAssessmentResponse {
  return Object.freeze({
    scheduled: false,
    created: false,
    executionId: null,
    boundaryId,
    state: null,
    binding: null,
    refusal: executionCode(refusal),
    refusalDetail: detail,
    // A refused schedule reaches no staging decision at all, and reporting `staged: false` with the
    // boundary reason keeps the field total rather than nullable.
    candidateStaging: Object.freeze({
      staged: false,
      reason: "boundary_not_enrolled" as const,
      detail: "the schedule was refused before candidate-capable staging was considered",
    }),
    admissionPolicyState,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

/** The decision, without the staged rows: a response never carries customer-derived figures. */
export interface CandidateStagingDecisionSummary {
  readonly staged: boolean;
  readonly reason: CandidateStagingBlockedReason | null;
  readonly detail: string;
}

function stagingSummary(decision: CandidateStagingDecision): CandidateStagingDecisionSummary {
  return Object.freeze({ staged: decision.staged, reason: decision.reason, detail: decision.detail });
}

export interface PilotAssessmentDeps {
  /** Injectable so the queue can be driven directly in tests; production uses the Postgres store. */
  readonly taskStore?: AgentTaskStore;
  readonly now?: () => number;
  /**
   * EP-31 · Staging configuration for the governed signal bridge. `null` means off, which is the
   * default: absent here resolves from the environment, where unset is also off.
   */
  readonly signalStaging?: SignalStagingConfig | null;
}

/**
 * Resolved ONCE per process, not per request, so a misconfiguration is a startup failure rather than a
 * server that silently stages nothing. `resolveSignalStagingConfig` throws on a non-boolean switch and on
 * an allowlisted boundary with no usable HMAC key.
 */
let cachedSignalStaging: SignalStagingConfig | null | undefined;
function defaultSignalStagingConfig(): SignalStagingConfig | null {
  if (cachedSignalStaging === undefined) cachedSignalStaging = resolveSignalStagingConfig(process.env);
  return cachedSignalStaging;
}

/**
 * S4 · The interpretation facts an admission must carry for its submission identity to be reproducible.
 *
 * The two locale fields ARE submission-identity components, recorded exactly as declared. The two terms
 * fields are an address into the governed register, which is append-only and holds the cut-off, the
 * threshold and the currency forever; they are deliberately NOT identity components, because the key
 * commits the governed VALUES and two terms versions with identical values are intentionally one
 * identity.
 */
interface AdmissionInterpretation {
  readonly dateLocale: string;
  readonly amountFormat: string;
  readonly termsId: string;
  readonly termsVersion: string;
  /** The same two values as adapter options: `"auto"` is the absence of a pin, not a third locale. */
  readonly localeOption: DateLocale | undefined;
  readonly amountOption: AmountFormat | undefined;
}

type AdmissionSnapshotRead =
  | { readonly kind: "present"; readonly snapshot: AdmissionInterpretation }
  /** Written before the snapshot columns existed. A verifiable fact about the schema epoch. */
  | { readonly kind: "absent" }
  /** Present but not usable. A defect in the record, which is a different thing from an old record. */
  | { readonly kind: "unusable"; readonly detail: string };

const DATE_LOCALE_TOKENS: readonly string[] = Object.freeze(["MDY", "DMY"]);
const AMOUNT_FORMAT_TOKENS: readonly string[] = Object.freeze(["US", "EU"]);

/**
 * Read the admission's interpretation snapshot, distinguishing "never recorded" from "wrong".
 *
 * ALL FOUR OR NONE. The intake writes them in one statement, so a partial row cannot arise from the
 * application; if one is seen it came from a migration, a restore or a direct write, and treating the
 * rest as authoritative would read half a record as a whole one. Unknown option tokens fail the same
 * way: the digest would still be reproducible from the stored string, but this build could not actually
 * READ the file that way, and claiming to have executed under an interpretation it cannot perform is
 * the one thing worse than refusing.
 */
function readAdmissionSnapshot(decision: PilotSubmissionRecord): AdmissionSnapshotRead {
  const locale = decision.snapshotDateLocale;
  const format = decision.snapshotAmountFormat;
  const termsId = decision.snapshotTermsId;
  const termsVersion = decision.snapshotTermsVersion;
  if (locale === null && format === null && termsId === null && termsVersion === null) {
    return { kind: "absent" };
  }
  if (locale === null || format === null || termsId === null || termsVersion === null) {
    return { kind: "unusable", detail: "the admission's interpretation snapshot is only partly recorded" };
  }
  if (locale !== "auto" && !DATE_LOCALE_TOKENS.includes(locale)) {
    return { kind: "unusable", detail: "the admission records a date locale this build cannot interpret" };
  }
  if (format !== "auto" && !AMOUNT_FORMAT_TOKENS.includes(format)) {
    return { kind: "unusable", detail: "the admission records an amount format this build cannot interpret" };
  }
  return {
    kind: "present",
    snapshot: Object.freeze({
      dateLocale: locale,
      amountFormat: format,
      termsId,
      termsVersion,
      localeOption: locale === "auto" ? undefined : (locale as DateLocale),
      amountOption: format === "auto" ? undefined : (format as AmountFormat),
    }),
  };
}

/**
 * Does the request ask to run under something other than what was admitted?
 *
 * SAYING NOTHING IS ALWAYS ALLOWED — the record supplies it. Naming the admitted value is allowed.
 * Naming a different one is refused, and the detail names only the ADMITTED value: a refusal must not
 * reflect a request's own strings back at it.
 *
 * `declaredVersion` is deliberately absent from this check. It is not a choice anyone makes about the
 * run — both clients send the build constant — and S4's rule for it is inertness, not refusal.
 */
function admissionConflict(
  request: SchedulePilotAssessmentRequest,
  snapshot: AdmissionInterpretation,
): string | null {
  const citedTermsId = request.analysisTermsId?.trim();
  const citedTermsVersion = request.analysisTermsVersion?.trim();
  if (citedTermsId && citedTermsId !== snapshot.termsId) {
    return `the dataset was admitted under analysis terms ${snapshot.termsId}; the request names a different id`;
  }
  if (citedTermsVersion && citedTermsVersion !== snapshot.termsVersion) {
    return `the dataset was admitted under analysis terms version ${snapshot.termsVersion}; the request names a different version`;
  }
  if (request.locale !== undefined && request.locale !== snapshot.dateLocale) {
    return `the dataset was admitted under date locale ${snapshot.dateLocale}; the request names a different one`;
  }
  if (request.amountFormat !== undefined && request.amountFormat !== snapshot.amountFormat) {
    return `the dataset was admitted under amount format ${snapshot.amountFormat}; the request names a different one`;
  }
  return null;
}

/**
 * Schedule one governed assessment execution over an already-admitted dataset.
 *
 * The caller re-supplies the CSV rather than the server holding it: the intake deliberately persists
 * no uploaded bytes, and re-supplying them is what lets the fingerprint check prove that the file
 * being executed is the file that was admitted. A dataset that cannot produce the admitted
 * fingerprint is refused — it is a different dataset, whatever it is named.
 */
export async function schedulePilotAssessment(
  actor: ActorContext,
  request: SchedulePilotAssessmentRequest,
  deps: PilotAssessmentDeps = {},
): Promise<SchedulePilotAssessmentResponse> {
  requireCan(actor, "SchedulePilotAssessment");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();
  const citedDecisionId = request.admissionDecisionId?.trim() || null;

  // The stable identity of the bytes, computed once and before anything is looked up. It depends on
  // nothing else and nothing else is trusted to produce it.
  const datasetFingerprint = await sha256Hex(request.csvText);

  // ── 3 · THE ANCHOR ─────────────────────────────────────────────────────────────────────────────
  //
  // TWO NAMED PATHS, NEVER BLENDED.
  //
  // REFERENCE-FIRST (`admissionDecisionId` cited): the decision is addressed directly, boundary-scoped,
  // so nothing the request claims about the reading takes part in finding it. This is the path on which
  // step 5's comparison is evidence: the key is re-derived from the record's own facts and checked
  // against a record that was NOT selected by that key.
  //
  // LEGACY DISCOVERY (no reference): the key is derived over caller-supplied interpretation and used as
  // the address, exactly as before S4. It is kept because every admission recorded before the snapshot
  // columns existed can only be reached this way, and failing those closed would have broken scheduling
  // for every dataset already admitted — a destructive change, not a tightening. Its limits are stated
  // rather than papered over: a record found this way already agrees with the inputs that found it, so
  // the comparison in step 5 is a consistency check and not a lineage proof; and because the key embeds
  // the build's contract major, it can only ever reach an admission from the SAME major.
  let decision: PilotSubmissionRecord | null;
  let discoveredTerms: AnalysisTerms | null = null;
  if (citedDecisionId !== null) {
    decision = await findSubmissionByDecisionId(citedDecisionId, boundaryId);
    if (!decision) {
      return refused(
        boundaryId,
        "dataset_not_submitted",
        "no admission decision with that identifier exists in this boundary",
      );
    }
  } else {
    const resolvedTerms = await resolveGovernedAnalysisTerms(
      boundaryId,
      request.analysisTermsId,
      request.analysisTermsVersion,
    );
    if (!resolvedTerms.ok) {
      return refused(boundaryId, "analysis_terms_not_governed", resolvedTerms.reason);
    }
    discoveredTerms = resolvedTerms.stored.terms;
    const discoveryKey = await deriveIdempotencyKey({
      boundary: { boundaryId, datasetId: request.datasetId },
      datasetFingerprint,
      dateLocale: request.locale ?? "auto",
      amountFormat: request.amountFormat ?? "auto",
      asOf: discoveredTerms.asOf,
      stallThresholdDays: discoveredTerms.stallThresholdDays,
      currency: discoveredTerms.currency,
    });
    decision = await findSubmission(discoveryKey, boundaryId);
    if (!decision) {
      return refused(
        boundaryId,
        "dataset_not_submitted",
        "no admission decision exists for these bytes in this boundary",
      );
    }
  }

  // Belt and braces. Both lookups filter by boundary, so this is unreachable by construction — which
  // is why it is checked: tenancy is the one thing that must not depend on a single query being right.
  if (decision.boundaryId !== boundaryId) {
    return refused(boundaryId, "boundary_mismatch", "the stored decision belongs to another boundary");
  }

  // The supplied file must BE the admitted file. Checked here, before any of the decision's facts are
  // put to work, so that "wrong dataset" can never be reported as one of the record's own problems.
  if (decision.datasetFingerprint !== datasetFingerprint) {
    return refused(boundaryId, "fingerprint_mismatch", "the supplied bytes do not match the admitted dataset");
  }

  if (!decision.admissionDecisionId) {
    return refused(boundaryId, "admission_decision_missing", "the stored submission predates assessment orchestration");
  }

  if (decision.admissionOutcome !== "ADMISSIBLE") {
    return refused(
      boundaryId,
      "admission_not_admissible",
      `the admission outcome was ${decision.admissionOutcome ?? "not recorded"}`,
    );
  }
  if (!decision.admissionPolicyId || !decision.admissionPolicyVersion || !decision.admissionPolicyHash) {
    // An ADMISSIBLE outcome is only reachable with a policy, so this is unreachable by construction —
    // which is exactly why it is checked rather than asserted away.
    return refused(boundaryId, "admission_not_admissible", "the admission decision names no policy");
  }

  // Re-derive the decision's identifier from its own stored fields. If they disagree, the record
  // changed after it was written; recomputing and carrying on would launder the change.
  //
  // AFTER the two checks above, because the identifier is a hash OVER those fields: a record that does
  // not carry them cannot be asked whether it hashes to its own id, and "not admissible" is the
  // truthful answer for one that does not.
  const rederivedDecisionId = await deriveAdmissionDecisionId({
    boundaryId,
    idempotencyKey: decision.idempotencyKey,
    datasetFingerprint: decision.datasetFingerprint,
    contractVersion: decision.contractVersion,
    outcome: decision.admissionOutcome,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
  });
  if (rederivedDecisionId !== decision.admissionDecisionId) {
    return refused(boundaryId, "decision_binding_mismatch", "the stored decision does not hash to its own identifier");
  }

  // ── 4 · THE ADMITTED INTERPRETATION, AND THE DEFINITION IT NAMES ───────────────────────────────
  //
  // S4a persisted four facts with every admission: the date locale and the amount format AS DECLARED
  // (both are submission-identity components, and "auto" is itself a declaration), plus the id and
  // version of the governed analysis-terms row. The first two are read directly. The last two are an
  // ADDRESS, not values: the register holds the cut-off, the stall threshold and the currency forever
  // and is append-only, so resolving the address recovers them from the authority rather than from a
  // copy that could have drifted.
  //
  // The register is also re-consulted for GOVERNANCE, not just for values: a definition that has since
  // been frozen or retired may not authorise a new run, exactly as a frozen admission bar may not.
  // That is NH-AX-1010, and it is the same answer the legacy path has always given.
  const snapshotRead = readAdmissionSnapshot(decision);
  let governedTerms: AnalysisTerms;
  let dateLocale: string;
  let amountFormat: string;
  let adapterOptions: { locale?: DateLocale; amountFormat?: AmountFormat };

  if (snapshotRead.kind === "present") {
    const snapshot = snapshotRead.snapshot;
    // THE REQUEST MAY CITE WHAT WAS ADMITTED, OR SAY NOTHING. It may not name something else and have
    // the run proceed under the admitted terms regardless: that would report a result nobody asked
    // for. Nor may it name something else and get it: "a verdict computed under one definition does
    // not authorise an execution under another" — the extract must be re-submitted under the new one.
    const conflict = admissionConflict(request, snapshot);
    if (conflict !== null) {
      return refused(boundaryId, "request_contradicts_admission", conflict);
    }
    const resolvedTerms = await resolveGovernedAnalysisTerms(boundaryId, snapshot.termsId, snapshot.termsVersion);
    if (!resolvedTerms.ok) {
      return refused(boundaryId, "analysis_terms_not_governed", resolvedTerms.reason);
    }
    governedTerms = resolvedTerms.stored.terms;
    dateLocale = snapshot.dateLocale;
    amountFormat = snapshot.amountFormat;
    adapterOptions = { locale: snapshot.localeOption, amountFormat: snapshot.amountOption };
  } else {
    // FAIL CLOSED where the reference-first promise cannot be kept. A cited reference asks for the
    // authoritative path explicitly; an admission with no snapshot cannot supply it, and approximating
    // one from this request would assert that today's claims are what the verdict was reached under.
    // A partly written snapshot, or one naming an option this build cannot interpret, fails closed on
    // BOTH paths: it is a defect in the record, not a schema epoch.
    if (citedDecisionId !== null || snapshotRead.kind === "unusable") {
      return refused(
        boundaryId,
        "admission_snapshot_unavailable",
        snapshotRead.kind === "unusable"
          ? snapshotRead.detail
          : "the stored submission predates the admission interpretation snapshot",
      );
    }
    if (discoveredTerms === null) {
      // UNREACHABLE: `citedDecisionId === null` is precisely the branch that resolved them above.
      return refused(boundaryId, "analysis_terms_not_governed", "no analysis-terms version was resolved for this schedule");
    }
    governedTerms = discoveredTerms;
    dateLocale = request.locale ?? "auto";
    amountFormat = request.amountFormat ?? "auto";
    adapterOptions = { locale: request.locale, amountFormat: request.amountFormat };
  }

  // ── 5 · THE SUBMISSION IDENTITY, RE-DERIVED AND COMPARED UNCONDITIONALLY ───────────────────────
  //
  // Every input below is a stored fact or a value resolved from the governed register. Nothing in the
  // request reaches it. A stored key that cannot be recomputed from the record's own facts is not an
  // identity anyone can audit later, so it is refused rather than accepted on its own word.
  //
  // THE MAJOR COMES FROM THE DECISION, NOT FROM THIS BUILD. A stored key embeds the contract major
  // that was current when it was minted. Re-deriving under today's major would make every bump report
  // NH-AX-1012 against data that never changed — and would silently void §10's promise that two majors
  // coexist, since a previous-major admission would cease to be reachable at all.
  const admittedMajor = parseContractVersion(decision.contractVersion)?.major;
  if (admittedMajor === undefined) {
    return refused(
      boundaryId,
      "contract_version_mismatch",
      "the stored admission records a contract version that is not a semantic version",
    );
  }
  const expectedIdempotencyKey = await deriveIdempotencyKey({
    boundary: { boundaryId, datasetId: decision.datasetId },
    datasetFingerprint: decision.datasetFingerprint,
    dateLocale,
    amountFormat,
    asOf: governedTerms.asOf,
    stallThresholdDays: governedTerms.stallThresholdDays,
    currency: governedTerms.currency,
    contractMajor: admittedMajor,
  });
  if (expectedIdempotencyKey !== decision.idempotencyKey) {
    return refused(
      boundaryId,
      "submission_identity_mismatch",
      "the admission's own recorded facts do not re-derive the submission key it is stored under",
    );
  }

  // ── 6 · CONTRACT SUPPORT, APPLIED SEPARATELY ───────────────────────────────────────────────────
  // EP-27 · COMPATIBILITY, not string equality. This was `decision.contractVersion !== report.contractVersion`
  // — the version the build implemented at submit time against the version it implements now — so ANY bump,
  // including a purely editorial patch, refused execution of every already-admitted dataset with NH-AX-1006
  // and the message "the fields may not mean the same thing", which for a patch is simply false. A promise
  // that two MAJORS coexist (§10) is void in a build where two PATCHES cannot.
  //
  // The question that actually matters is whether THIS build can still faithfully interpret what that
  // decision was made under, which is exactly what the version gate answers. `declaredVersion` is null only
  // for rows written before EP-27's column existed; those fall back to the implemented version they were
  // recorded with — the same value the migration backfilled — never to an optimistic assumption.
  //
  // DELIBERATELY NOT FOLDED INTO STEP 5. Support is a question about THIS BUILD'S current declarations,
  // which a human may withdraw at any time; identity is a question about an immutable record. Answering
  // them together would let a withdrawal of support report itself as the record having changed.
  const admittedUnder = decision.declaredVersion ?? decision.contractVersion;
  if (!isSupportedContractVersion(admittedUnder)) {
    return refused(
      boundaryId,
      "contract_version_mismatch",
      `admitted under ${admittedUnder}; this build serves ${PILOT_DATA_CONTRACT_VERSION} and does not accept it`,
    );
  }

  // ── 6b · THE CALCULATION METHOD THE TERMS WERE BLESSED FOR ─────────────────────────────────────
  //
  // A governed AnalysisTerms version records `calculationMethodVersion`: a BUILD CONSTANT at the moment
  // of registration, recorded so a historical registration says which implementation it was approved
  // against. Nothing checked that the build about to measure under it still implements that method, so a
  // definition blessed for one implementation could silently authorise a run by another. That is the
  // same error the transport already refuses to allow for the terms themselves — `analysisTermsSchema`
  // omits the field precisely because letting a request state it "would invite a definition blessed for
  // an implementation that never ran it".
  //
  // The value is tamper-evident before it gets here: `resolveGovernedAnalysisTerms` verifies the terms
  // hash, which commits `calculationMethodVersion`, so a row whose method was altered is already refused
  // as NH-AX-1010 rather than reaching this comparison.
  //
  // SEPARATE FROM CONTRACT SUPPORT ABOVE, and deliberately so. Step 6 asks what DATA this build can
  // interpret; this asks what CALCULATION it implements. They move independently, and one code for both
  // would send someone to re-export a file when what changed was the assessment implementation.
  //
  // Today this refuses nothing: `ASSESSMENT_CALC_VERSION` has never moved, so every registered row
  // carries the current value. It exists for the bump, which is exactly when a silent divergence would
  // otherwise be least visible.
  // COMPATIBLE, not merely equal. String equality treated a RENAME of the method exactly like a change
  // of arithmetic, and forced every governed definition to be re-proposed and every extract re-submitted
  // for what may have been a scheme tidy-up. `calculationMethodsCompatible` accepts the same method
  // under two names only when the lineage DECLARES the rename and a test has checked the declaration by
  // recomputing both fingerprints — so "compatible" means provably the same answers, never a promise.
  //
  // It fails closed on a version this build cannot describe at all, including by string equality: a
  // build that does not know what a method DOES cannot claim its answers are unchanged.
  if (!calculationMethodsCompatible(governedTerms.calculationMethodVersion, ASSESSMENT_CALC_VERSION)) {
    return refused(
      boundaryId,
      "calculation_method_unsupported",
      `the analysis terms were blessed for ${governedTerms.calculationMethodVersion}; this build implements ${ASSESSMENT_CALC_VERSION} and does not declare them equivalent`,
    );
  }

  // ── 7 · VALIDATION, UNDER THE ADMITTED INTERPRETATION ──────────────────────────────────────────
  // The caller re-supplies the CSV rather than the server holding it: the intake deliberately persists
  // no uploaded bytes, and re-supplying them is what let step 3 prove that the file being executed is
  // the file that was admitted. What has changed is WHAT IT IS READ UNDER — the declaration, the locale,
  // the amount format and the whole policy are the admitted ones.
  let policy;
  try {
    policy = makePolicy({
      policyId: governedTerms.termsId,
      policyVersion: governedTerms.termsVersion,
      stallThresholdDays: governedTerms.stallThresholdDays,
      asOf: governedTerms.asOf,
      currency: governedTerms.currency,
    });
  } catch (e) {
    // UNREACHABLE BY CONSTRUCTION: every value came from a registered row that the store already
    // rebuilt through `makeAnalysisTerms`. Checked rather than asserted away, and rethrown rather than
    // reported as a caller error — there is no longer any caller input here to blame.
    throw e;
  }

  const submissionInput: DatasetSubmission = {
    // S4/S5 · THE ADMITTED DECLARATION. There is no longer a request field this could be confused
    // with: the scheduling type and the HTTP body both omit it entirely.
    declaredVersion: admittedUnder,
    // The dataset LABEL is deliberately not an identity component (contract 2.0.0 removed it, because
    // the uploader controls it), so it is informational here and is taken from the request as before.
    boundary: { boundaryId, datasetId: request.datasetId },
    ingestionBoundaryId: boundaryId,
    provenance: request.provenance,
    csvText: request.csvText,
    policy,
    adapterOptions,
  };

  const report: ContractValidationReport = await validatePilotDataset(submissionInput);

  // ── 8 · Governance, re-checked NOW ─────────────────────────────────────────────────────────────
  // The dataset was admitted under a bar that was ACTIVE then. This asks whether it is ACTIVE now.
  // A frozen bar is a deliberate governance pause and a retired one is over; neither authorises new
  // work, and letting an old admission carry a new run past them would make freezing decorative.
  const governance = await policyGovernanceState(
    boundaryId,
    decision.admissionPolicyId,
    decision.admissionPolicyVersion,
  );
  if (!mayEvaluate(governance.state)) {
    return refused(boundaryId, "policy_not_active", whyCannotEvaluate(governance.state), governance.state);
  }

  // ── 9 · Projection ─────────────────────────────────────────────────────────────────────────────
  // ONLY the accepted cycles. A rejected row has no representation in what follows, so no rejected
  // value can reach a cohort, a sum, a finding, or any agent's context.
  const input = projectExecutionInput(report.acceptedCycles);
  if (input.cycles.length === 0) {
    return refused(boundaryId, "no_assessable_cycles", "no accepted cycle survived projection", governance.state);
  }

  const binding: ExecutionBinding = Object.freeze({
    boundaryId,
    datasetFingerprint: report.datasetFingerprint,
    admissionDecisionId: decision.admissionDecisionId,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
    contractVersion: report.contractVersion,
    assessmentPolicy: assessmentPolicyRef(policy),
    interpretation: Object.freeze({
      mappingId: report.mappingId,
      // S4 · WHAT THE RUN ACTUALLY READ UNDER. These were `request.amountFormat ?? "auto"` and
      // `request.locale ?? "auto"`; they are now the authoritative pair, which is the same pair on
      // the legacy path and on any run that reaches here with a snapshot — a request that named a
      // different one was refused in step 4. No execution identity moves.
      amountFormat,
      dateLocale,
    }),
    recoveryCaseId: request.recoveryCaseId?.trim() || null,
  });

  const executionId = await deriveExecutionId(binding);
  const [bindingHash, inputHash] = await Promise.all([
    hashExecutionBinding(binding),
    hashExecutionInput(input),
  ]);

  // ── 6b · EP-31 · Stage the per-account at-risk attribution, if this boundary is enrolled ────────
  //
  // HERE AND NOWHERE ELSE, because this is the last moment the account identity exists:
  // `projectExecutionInput` above has already replaced it with an ordinal whose mapping is not stored
  // and not recoverable, and the worker reads only that projection. The rows are written inside the
  // execution's own transaction below, so if the execution cannot be created no attribution exists —
  // and therefore no candidate can ever be derived from one.
  //
  // THIS IS NOT A CANDIDATE. Nothing lists these rows in a review queue and nothing can promote them.
  // Only the emitter, and only once the execution has reached `completed`, turns them into signals. The
  // execution is the governed artefact; the candidate is strictly downstream of it.
  //
  // Off unless the boundary is explicitly enrolled — `mayStage` requires both the master switch and the
  // allowlist — so the default is an empty list and no behaviour change at all.
  const stagingConfig = deps.signalStaging ?? defaultSignalStagingConfig();
  const candidateStaging = deriveStagedAttributions(
    stagingConfig,
    boundaryId,
    report.acceptedCycles,
    policy,
    observedSummary(splitCohorts(report.acceptedCycles, policy).stalled, policy),
  );

  // ── 6c · Step 5 · Resolve the GOVERNED source namespace for these bytes ─────────────────────────
  //
  // AUDIT LINEAGE, NOT A GATE ON ASSESSMENT. A submission that no governed authority resolves is assessed
  // exactly as before and simply carries no lineage. That is EP-31c's invariant restated: an ordinary
  // assessment may complete without source authority; candidate-capable work may not. A refusal is never
  // turned into an execution refusal, so `scheduled: true` can never coexist with a fabricated `NH-AX-*`.
  //
  // The first sighting comes from the record the intake wrote BEFORE it resolved the admission bar, so the
  // ordering rule compares authority against when these bytes actually arrived rather than against anything
  // in this request.
  const firstSeenAt = await readDatasetFirstSeenAt(boundaryId, binding.datasetFingerprint);
  const resolution = firstSeenAt === null
    ? ({ resolved: false, reason: "source_namespace_unresolved", detail: "these bytes have no recorded first sighting" } as const)
    : resolveSourceNamespace({
        boundaryId,
        datasetFingerprint: binding.datasetFingerprint,
        firstSeenAt,
        declaredBillingSource: request.provenance.sourceSystems.billing,
        ...(await readSourceGovernance(boundaryId, binding.datasetFingerprint)),
      });
  const sourceResolution = resolution.resolved
    ? {
        ...resolution.lineage,
        sourceResolutionHash: await sourceResolutionHash(boundaryId, binding.datasetFingerprint, resolution.lineage),
      }
    : null;

  const { execution, created } = await createExecutionIfAbsent({
    executionId,
    binding,
    bindingHash,
    input,
    inputHash,
    scheduledByActorId: actor.actorId,
    scheduledByRole: actor.role,
    attributions: candidateStaging.attributions,
    sourceResolution,
  });

  // ── 7 · Enqueue ────────────────────────────────────────────────────────────────────────────────
  // The task's idempotency key IS the execution id, so a repeated schedule reuses the same task row
  // rather than queuing a second run of identical work. The payload carries ONE field — the
  // execution id — so the agent's context contains no customer-derived value whatsoever; everything
  // it needs is looked up, boundary-scoped, from records it cannot influence.
  const store = deps.taskStore ?? createPostgresAgentTaskStore();
  const enqueued = await store.enqueueIfAbsent({
    taskId: `TASK-${executionId}`,
    boundaryId,
    agentId: PILOT_ASSESSMENT_AGENT_ID,
    idempotencyKey: executionId,
    payload: { executionId },
    now: (deps.now ?? Date.now)(),
  });
  void enqueued;

  const status = await executionStatus(executionId, boundaryId);
  return Object.freeze({
    scheduled: true,
    created,
    executionId,
    boundaryId,
    state: status.state,
    binding: execution.binding,
    refusal: null,
    refusalDetail: null,
    candidateStaging: stagingSummary(candidateStaging),
    admissionPolicyState: governance.state,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

export interface ReassessPilotAssessmentRequest {
  /** Authorization REQUEST, never an assertion — `requireBoundaryAccess` decides. */
  readonly boundaryId: string;
  /** The execution to re-assess. Its retained input is reused; no file is re-supplied. */
  readonly executionId: string;
  /** The governed analysis-terms version blessing the new calculation method. Required. */
  readonly analysisTermsId: string;
  readonly analysisTermsVersion: string;
  /** Why. Required — a revision nobody can explain is indistinguishable from a quiet re-grade. */
  readonly reason: string;
}

export interface ReassessPilotAssessmentResponse {
  readonly reassessed: boolean;
  readonly created: boolean;
  /** The NEW execution. The one it revises is untouched and still readable at its own id. */
  readonly executionId: string | null;
  readonly revisesExecutionId: string;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly binding: ExecutionBinding | null;
  /** What differs from the execution being revised, derived rather than narrated. */
  readonly delta: BindingRevisionDelta | null;
  readonly refusal: ExecutionCodeSpec | null;
  readonly refusalDetail: string | null;
  readonly claimBoundary: typeof CLAIM_BOUNDARY;
}

function reassessmentRefused(
  boundaryId: string,
  revisesExecutionId: string,
  refusal: ExecutionRefusal,
  detail: string,
): ReassessPilotAssessmentResponse {
  return Object.freeze({
    reassessed: false,
    created: false,
    executionId: null,
    revisesExecutionId,
    boundaryId,
    state: null,
    binding: null,
    delta: null,
    refusal: executionCode(refusal),
    refusalDetail: detail,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

/**
 * Re-assess an already-admitted dataset under a new calculation method, WITHOUT asking for the file again.
 *
 * WHY THIS IS SOUND, and it rests on a derivation rather than a convenience: the admission verdict does
 * not depend on the calculation method. `evaluateAdmission` reads the assessment policy only to split
 * cohorts, and never reads its method — so an admission reached under one method would have been
 * identical under another, and reusing it re-uses a decision that was never about the thing that changed.
 * Full argument in docs/CALCULATION_IDENTITY_V1.md.
 *
 * WHAT MAY CHANGE, and nothing else: the assessment policy. Same bytes, same admission, same
 * interpretation, same cut-off, same threshold, same currency. A different cut-off or threshold is a
 * different READING of the data — it changes which rows count and what "stalled" means — and the
 * admission was for the old reading, so that case is refused and the extract must be re-submitted.
 *
 * IT NEVER REPLACES. A new execution and a new finding are created, LINKED to the previous ones, which
 * remain exactly as they were and readable at their own identifiers. Trust Invariant rule 9 requires a
 * revision to be a new linked record and rule 5 requires the historical result to stay reproducible;
 * both are satisfied by construction, because the previous rows are not written to at all.
 *
 * THE INPUT MUST BE THERE AND MUST VERIFY. The whole point is not to ask the customer for the file
 * again, and that is only honest while the retained input is the one the earlier finding was computed
 * from. Purged, absent or failing its hash → refused, and the extract must be re-submitted.
 */
export async function reassessPilotAssessment(
  actor: ActorContext,
  request: ReassessPilotAssessmentRequest,
  deps: PilotAssessmentDeps = {},
): Promise<ReassessPilotAssessmentResponse> {
  // CURRENT AUTHORIZATION, not a new capability. A re-assessment produces a governed finding, which is
  // what scheduling produces, so it is gated by the same right — inventing a weaker one would create a
  // path to a finding that the scheduling gate does not cover.
  requireCan(actor, "SchedulePilotAssessment");
  requireBoundaryAccess(actor, request.boundaryId);
  const boundaryId = request.boundaryId.trim();
  const previousId = request.executionId.trim();

  const reason = request.reason.trim();
  if (reason === "") {
    throw new ForbiddenError("a re-assessment must state why it exists; a revision with no stated reason cannot be reviewed");
  }

  // ── 1 · The execution being revised, and its own integrity ─────────────────────────────────────
  const previous = await findExecution(previousId, boundaryId);
  if (!previous) throw new NotFoundError("no such assessment execution exists for this boundary");
  if ((await deriveExecutionId(previous.binding)) !== previousId) {
    return reassessmentRefused(boundaryId, previousId, "decision_binding_mismatch", "the execution does not hash to its own identifier");
  }

  // ── 2 · The retained input: present, and the one the earlier finding was computed from ──────────
  const stored = await findExecutionInput(previousId, boundaryId);
  if (!stored) {
    const purge = await inputPurgeRecord(previousId, boundaryId);
    return reassessmentRefused(
      boundaryId,
      previousId,
      "reassessment_input_unavailable",
      purge
        ? `the input was purged under the retention policy (${purge.reason})`
        : "the execution has no stored input",
    );
  }
  const input: ExecutionInput = Object.freeze({ scheme: "nh-pilot-assessment-projection-v1", cycles: stored.cycles });
  const inputHash = await hashExecutionInput(input);
  if (inputHash !== stored.inputHash || stored.inputHash !== previous.inputHash) {
    // UNVERIFIABLE, not merely absent. Re-assessing it would compute a new finding from rows the earlier
    // one never saw, under the earlier one's identity lineage.
    return reassessmentRefused(
      boundaryId,
      previousId,
      "reassessment_input_unavailable",
      "the stored input does not match its recorded hash",
    );
  }

  // ── 3 · The new definition, governed NOW ────────────────────────────────────────────────────────
  const resolved = await resolveGovernedAnalysisTerms(boundaryId, request.analysisTermsId, request.analysisTermsVersion);
  if (!resolved.ok) return reassessmentRefused(boundaryId, previousId, "analysis_terms_not_governed", resolved.reason);
  const terms = resolved.stored.terms;

  // ONLY THE METHOD. The three governed values that decide what is measured must be identical, or this is
  // a different reading and the admission does not cover it.
  const measured: readonly [string, string, string][] = [
    ["asOf", previous.binding.assessmentPolicy.asOf, terms.asOf],
    ["stallThresholdDays", String(previous.binding.assessmentPolicy.stallThresholdDays), String(terms.stallThresholdDays)],
    ["currency", previous.binding.assessmentPolicy.currency, terms.currency],
  ];
  const differing = measured.filter(([, before, after]) => before !== after).map(([name]) => name);
  if (differing.length > 0) {
    return reassessmentRefused(
      boundaryId,
      previousId,
      "reassessment_terms_not_method_only",
      `the cited terms change ${differing.join(", ")}, which changes what is measured rather than how`,
    );
  }

  if (!calculationMethodsCompatible(terms.calculationMethodVersion, ASSESSMENT_CALC_VERSION)) {
    return reassessmentRefused(
      boundaryId,
      previousId,
      "calculation_method_unsupported",
      `the cited terms were blessed for ${terms.calculationMethodVersion}; this build implements ${ASSESSMENT_CALC_VERSION} and does not declare them equivalent`,
    );
  }
  if (terms.calculationMethodVersion === previous.binding.assessmentPolicy.calculationMethodVersion) {
    return reassessmentRefused(
      boundaryId,
      previousId,
      "reassessment_no_method_change",
      "the cited terms name the calculation method this execution already used",
    );
  }

  // The governed definition, rebuilt into a policy. Every field comes from the registered terms, so the
  // revision measures what the governed version says and not what the request would prefer.
  const policy = makePolicy({
    policyId: terms.termsId,
    policyVersion: terms.termsVersion,
    stallThresholdDays: terms.stallThresholdDays,
    asOf: terms.asOf,
    currency: terms.currency,
  });

  // ── 4 · The admission still stands, and the bar that made it is still sound and ACTIVE ──────────
  const decision = await findSubmissionByDecisionId(previous.binding.admissionDecisionId, boundaryId);
  if (!decision) {
    return reassessmentRefused(boundaryId, previousId, "dataset_not_submitted", "the bound admission decision no longer resolves in this boundary");
  }
  if (decision.admissionOutcome !== "ADMISSIBLE") {
    return reassessmentRefused(boundaryId, previousId, "admission_not_admissible", "the bound decision is not ADMISSIBLE");
  }
  if (!decision.admissionPolicyId || !decision.admissionPolicyVersion || !decision.admissionPolicyHash) {
    return reassessmentRefused(boundaryId, previousId, "admission_not_admissible", "the bound decision names no policy");
  }
  const rederivedDecisionId = await deriveAdmissionDecisionId({
    boundaryId,
    idempotencyKey: decision.idempotencyKey,
    datasetFingerprint: decision.datasetFingerprint,
    contractVersion: decision.contractVersion,
    outcome: decision.admissionOutcome,
    admissionPolicyId: decision.admissionPolicyId,
    admissionPolicyVersion: decision.admissionPolicyVersion,
    admissionPolicyHash: decision.admissionPolicyHash,
  });
  if (rederivedDecisionId !== previous.binding.admissionDecisionId) {
    return reassessmentRefused(boundaryId, previousId, "decision_binding_mismatch", "the stored decision does not hash to its own identifier");
  }
  // The bar's own row must still hash to its definition. A re-assessment is new governed work, so it may
  // not proceed on a bar whose record has moved since it was blessed.
  const storedBar = await findAdmissionPolicy(boundaryId, decision.admissionPolicyId, decision.admissionPolicyVersion);
  if (!storedBar || !(await policyHashMatches(storedBar.policy, storedBar.policyHash))) {
    return reassessmentRefused(
      boundaryId,
      previousId,
      "admission_not_admissible",
      "the admission policy no longer hashes to the definition it was registered with",
    );
  }
  const governance = await policyGovernanceState(boundaryId, decision.admissionPolicyId, decision.admissionPolicyVersion);
  if (!mayEvaluate(governance.state)) {
    return reassessmentRefused(boundaryId, previousId, "policy_not_active", whyCannotEvaluate(governance.state));
  }

  // ── 5 · The new binding: the previous one, with the assessment policy replaced ──────────────────
  const binding: ExecutionBinding = Object.freeze({
    ...previous.binding,
    assessmentPolicy: assessmentPolicyRef(policy),
  });
  const delta = bindingRevisionDelta(previous.binding, binding);
  if (!isPermittedRevision(delta)) {
    // UNREACHABLE: the checks above pin every field the delta calls unexpected, and the method change is
    // required. Checked rather than asserted away, because a revision that changed something it must not
    // is the one outcome that would make "what changed" untrustworthy.
    return reassessmentRefused(
      boundaryId,
      previousId,
      "decision_binding_mismatch",
      `the revision would change ${delta.unexpectedChanges.map((c) => c.field).join(", ") || "nothing"}`,
    );
  }

  const executionId = await deriveExecutionId(binding);

  // AN EXECUTION'S IDENTITY IS ITS BINDING, so the revision may land on a row that already exists —
  // someone could have scheduled these bytes under these terms directly. Two cases, and they are not
  // the same answer:
  //
  //   • it already revises THIS execution → an idempotent repeat. Return it; nothing new is written.
  //   • it revises nothing, or something else → the answer exists INDEPENDENTLY of this request.
  //     Writing a revision link onto it would claim it was produced by re-assessing this execution,
  //     which it was not, and there is no second identity available for identical content.
  //
  // Found by a test whose fixture arrived at exactly this collision, which is how it became visible.
  const colliding = await findExecution(executionId, boundaryId);
  if (colliding && colliding.revisesExecutionId !== previousId) {
    return reassessmentRefused(
      boundaryId,
      previousId,
      "reassessment_already_exists",
      `execution ${executionId} already holds this binding${colliding.revisesExecutionId === null ? "" : " as a revision of another execution"}`,
    );
  }

  const [bindingHash, newInputHash] = await Promise.all([hashExecutionBinding(binding), hashExecutionInput(input)]);

  // THE SAME INPUT, written again under the new execution's identity. Not moved and not shared: the
  // previous execution keeps its own input row, so purging one never strands the other, and the earlier
  // finding stays reproducible from its own stored rows.
  const { execution, created } = await createExecutionIfAbsent({
    executionId,
    binding,
    bindingHash,
    input,
    inputHash: newInputHash,
    scheduledByActorId: actor.actorId,
    scheduledByRole: actor.role,
    revision: { revisesExecutionId: previousId, revisionReason: reason },
    // EP-31 · No staging on a revision: the attribution belongs to the first assessment of these bytes,
    // and staging it again would double-count the same at-risk accounts.
    attributions: [],
    sourceResolution: null,
  });

  const store = deps.taskStore ?? createPostgresAgentTaskStore();
  await store.enqueueIfAbsent({
    taskId: `TASK-${executionId}`,
    boundaryId,
    agentId: PILOT_ASSESSMENT_AGENT_ID,
    idempotencyKey: executionId,
    payload: { executionId },
    now: (deps.now ?? Date.now)(),
  });

  const status = await executionStatus(executionId, boundaryId);
  return Object.freeze({
    reassessed: true,
    created,
    executionId,
    revisesExecutionId: previousId,
    boundaryId,
    state: status.state,
    binding: execution.binding,
    delta,
    refusal: null,
    refusalDetail: null,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

export interface PilotAssessmentView {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly binding: ExecutionRecord["binding"];
  readonly bindingHash: string;
  readonly inputHash: string;
  readonly scheduledByActorId: string;
  readonly scheduledByRole: string;
  readonly scheduledAt: string;
  readonly events: Awaited<ReturnType<typeof executionStatus>>["events"];
  readonly finding: Awaited<ReturnType<typeof findFinding>>;
  /**
   * What this execution revises, what differs, and why — or null for a first assessment.
   *
   * The DELTA IS DERIVED from the two bindings rather than narrated, because a hand-written summary can
   * be wrong about its own diff. The REASON is the only part a human supplies, since no computation can.
   * `previousFindingExists` is reported because "the earlier result is still there" is the claim that
   * makes this a revision rather than a replacement, and a reader should not have to take it on trust.
   */
  readonly revises: {
    readonly executionId: string;
    readonly reason: string;
    readonly delta: BindingRevisionDelta | null;
    readonly previousFindingExists: boolean;
  } | null;
  readonly claimBoundary: typeof CLAIM_BOUNDARY;
}

/**
 * Read one execution: its state, its full lineage, and its finding if it produced one.
 *
 * Boundary-scoped twice — the actor must hold the boundary, and the lookup filters by it — so a
 * cross-tenant execution id reads as not-found rather than as someone else's run.
 */
export async function readPilotAssessment(
  actor: ActorContext,
  boundaryId: string,
  executionId: string,
): Promise<PilotAssessmentView> {
  requireCan(actor, "ReadPilotAssessment");
  requireBoundaryAccess(actor, boundaryId);
  const scoped = boundaryId.trim();
  const execution = await findExecution(executionId, scoped);
  if (!execution) throw new NotFoundError("no such assessment execution exists for this boundary");
  const status = await executionStatus(executionId, scoped);
  return Object.freeze({
    executionId: execution.executionId,
    boundaryId: scoped,
    state: status.state,
    code: status.code,
    binding: execution.binding,
    bindingHash: execution.bindingHash,
    inputHash: execution.inputHash,
    scheduledByActorId: execution.scheduledByActorId,
    scheduledByRole: execution.scheduledByRole,
    scheduledAt: execution.scheduledAt,
    events: status.events,
    finding: await findFinding(executionId, scoped),
    revises: await describeRevision(execution, scoped),
    claimBoundary: CLAIM_BOUNDARY,
  });
}

/**
 * Resolve the revision link for a read, if there is one.
 *
 * A missing predecessor yields a null delta rather than throwing: the link is a fact this record states
 * about itself, and a reader asking about THIS execution should still get it even if the record it points
 * at cannot be loaded. That case should be impossible — nothing deletes an execution — so it is reported
 * as an absent delta rather than smoothed over.
 */
async function describeRevision(
  execution: ExecutionRecord,
  boundaryId: string,
): Promise<PilotAssessmentView["revises"]> {
  if (execution.revisesExecutionId === null) return null;
  const previous = await findExecution(execution.revisesExecutionId, boundaryId);
  return Object.freeze({
    executionId: execution.revisesExecutionId,
    reason: execution.revisionReason ?? "",
    delta: previous ? bindingRevisionDelta(previous.binding, execution.binding) : null,
    previousFindingExists: previous !== null && (await findFinding(execution.revisesExecutionId, boundaryId)) !== null,
  });
}

/** Every execution for one boundary, newest first. The list the UI's status board reads. */
export async function listPilotAssessments(
  actor: ActorContext,
  boundaryId: string,
  limit = 50,
): Promise<readonly {
  readonly executionId: string;
  readonly state: ExecutionState | null;
  readonly code: string | null;
  readonly datasetFingerprint: string;
  readonly admissionDecisionId: string;
  readonly admissionPolicyRef: string;
  readonly scheduledAt: string;
}[]> {
  requireCan(actor, "ReadPilotAssessment");
  requireBoundaryAccess(actor, boundaryId);
  const scoped = boundaryId.trim();
  const executions = await listExecutions(scoped, limit);
  return Object.freeze(
    await Promise.all(
      executions.map(async (execution) => {
        const status = await executionStatus(execution.executionId, scoped);
        return Object.freeze({
          executionId: execution.executionId,
          state: status.state,
          code: status.code,
          datasetFingerprint: execution.binding.datasetFingerprint,
          admissionDecisionId: execution.binding.admissionDecisionId,
          admissionPolicyRef: `${execution.binding.admissionPolicyId}@${execution.binding.admissionPolicyVersion}`,
          scheduledAt: execution.scheduledAt,
        });
      }),
    ),
  );
}
