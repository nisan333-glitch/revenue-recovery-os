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
  type ExecutionState,
} from "../../src/contract/assessmentExecution";
import {
  executionCode,
  type ExecutionCodeSpec,
  type ExecutionRefusal,
} from "../../src/contract/executionCodes";
import { mayEvaluate, whyCannotEvaluate, type PolicyState } from "../../src/contract/policyLifecycle";
import { makePolicy } from "../../src/assessment/policy";
import { observedSummary } from "../../src/assessment/observed";
import { splitCohorts } from "../../src/assessment/cohort";
import type { DateLocale } from "../../src/assessment/dateNormalize";
import type { AmountFormat } from "../../src/assessment/amountNormalize";
import { NotFoundError } from "../http/errors";
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
  /**
   * S4 · INERT. Kept on the wire, read by nothing.
   *
   * It used to reach `validatePilotDataset`, where a malformed or unsupported value raises a
   * `dataset_rejected` finding — which empties `acceptedCycles` and refused the schedule of a properly
   * admitted dataset with NH-AX-1009 "no accepted cycle survived projection". So a caller's claim about
   * the contract version could block the execution of a dataset the server had already judged, and the
   * refusal blamed the data. The authoritative declaration is the one recorded ON the admission, and
   * that is what is used now.
   *
   * Not yet removed: that is a breaking wire change and belongs with its own migration of the request
   * schema and both clients. Until then, two requests differing ONLY in this field must schedule
   * identically — asserted, not assumed.
   */
  readonly declaredVersion: string;
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
    // S4 · THE ADMITTED DECLARATION, never `request.declaredVersion`. See that field's own note.
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
    claimBoundary: CLAIM_BOUNDARY,
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
