// EP-16 · Pilot Assessment Orchestration — the governed handoff from an admitted dataset into
// assessment execution.
//
// THE GAP THIS CLOSES. EP-13/14/15 built a dataset that has been validated, judged fit, and judged
// under a bar governance put in force. Then nothing happened. Assessment still ran in the browser,
// on whatever file happened to be in memory, under whatever policy the page held — so the admission
// decision governed a *verdict about a file* and governed nothing about the *run that used it*.
// Between "this dataset is admissible" and "here is what it showed" there was an ungoverned gap, and
// a number that emerges from an ungoverned gap is indistinguishable from a number someone typed.
//
// WHAT THIS MODULE IS. Pure. It holds the identity, the binding, the lifecycle and the input
// projection. No storage, no authorization, no clock, no network — the server enforces those, and
// keeping the rules here means they can be reasoned about, and tested, without a database.
//
// WHAT AN EXECUTION IS NOT. It is not a Proof. It produces an OBSERVATION: counts, cohort sizes and
// exact-minor-unit sums over the accepted cycles. Nothing here is Revenue Returned, Auditable
// Revenue, or a financial claim, and nothing here creates a Recovery Case. The agent that runs an
// execution deliberately emits zero CandidateSignals, so the automatic path into case creation is
// structurally absent rather than merely unused.
import { assess } from "../assessment/assess";
import { SAAS_ADAPTER_ID, SAAS_ADAPTER_VERSION } from "../assessment/adapters/saasActivation";
import { sha256Hex } from "../assessment/fingerprint";
import type { AssessmentPolicy } from "../assessment/policy";
import type { ExpectationCycle } from "../assessment/types";
import { EXCLUSION_REASON_CODES } from "./rejectionCodes";

/** Version of the identity/binding scheme itself. A change here is a new scheme, not a re-grade. */
export const EXECUTION_BINDING_SCHEME = "nh-pilot-assessment-execution-v1";

/** Version of the input-projection rules. Stamped into the input hash. */
export const EXECUTION_PROJECTION_SCHEME = "nh-pilot-assessment-projection-v1";

// ── 1 · The admission decision's identity ─────────────────────────────────────────────────────────

/**
 * The fields of a recorded admission decision that an execution binds to.
 *
 * Every one of these is already stored on the submission record. Deriving the identifier FROM them,
 * rather than minting a random one, means the identifier is falsifiable: if any field is later
 * altered, the stored id and the recomputed id diverge and the change is visible instead of silent.
 */
export interface AdmissionDecisionRef {
  readonly boundaryId: string;
  readonly idempotencyKey: string;
  readonly datasetFingerprint: string;
  readonly contractVersion: string;
  readonly outcome: string;
  readonly admissionPolicyId: string | null;
  readonly admissionPolicyVersion: string | null;
  readonly admissionPolicyHash: string | null;
}

function canonicalDecision(ref: AdmissionDecisionRef): string {
  // NUL-separated so no value can impersonate a separator and shift the fields after it.
  return [
    EXECUTION_BINDING_SCHEME,
    ref.boundaryId,
    ref.idempotencyKey,
    ref.datasetFingerprint,
    ref.contractVersion,
    ref.outcome,
    ref.admissionPolicyId ?? "",
    ref.admissionPolicyVersion ?? "",
    ref.admissionPolicyHash ?? "",
  ].join("\u0000");
}

/** `PAD-<32 hex>` — deterministic, reproducible from the decision's own stored fields. */
export async function deriveAdmissionDecisionId(ref: AdmissionDecisionRef): Promise<string> {
  return `PAD-${(await sha256Hex(canonicalDecision(ref))).slice(0, 32)}`;
}

// ── 2 · The execution binding ─────────────────────────────────────────────────────────────────────

/** The assessment policy's identity, as it participates in the binding. */
export interface AssessmentPolicyRef {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly calculationMethodVersion: string;
  readonly asOf: string;
  readonly stallThresholdDays: number;
  readonly currency: string;
}

export function assessmentPolicyRef(policy: AssessmentPolicy): AssessmentPolicyRef {
  return Object.freeze({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    calculationMethodVersion: policy.calculationMethodVersion,
    asOf: policy.asOf,
    stallThresholdDays: policy.stallThresholdDays,
    currency: policy.currency,
  });
}

/**
 * Everything an execution is bound to, immutably.
 *
 * The ASSESSMENT policy is in here alongside the ADMISSION policy on purpose. They answer different
 * questions — "was this dataset fit?" versus "as of when, and with what stall threshold, was it
 * read?" — and changing either changes what the run means. Two executions over the same admitted
 * bytes with different `asOf` values are two different executions, not a repeat of one.
 */
export interface ExecutionBinding {
  readonly boundaryId: string;
  readonly datasetFingerprint: string;
  readonly admissionDecisionId: string;
  readonly admissionPolicyId: string;
  readonly admissionPolicyVersion: string;
  readonly admissionPolicyHash: string;
  readonly contractVersion: string;
  readonly assessmentPolicy: AssessmentPolicyRef;
  /**
   * How the bytes were READ. A different column mapping, amount format or date locale produces
   * different numbers from the identical file, so interpretation is part of the identity: it is
   * already folded into `assessmentId` by the assessment core, and folding it in here too means two
   * readings of one dataset are two executions rather than one that quietly changed its mind.
   */
  readonly interpretation: {
    readonly mappingId: string;
    /** "US" | "EU" | "auto" */
    readonly amountFormat: string;
    /** "MDY" | "DMY" | "auto" */
    readonly dateLocale: string;
  };
  /**
   * Optional link to a governed recovery case. When set, the case's Halt applies: a halted case
   * blocks the execution. When null, no case is involved and none is created — an execution never
   * authors a case, in either direction.
   */
  readonly recoveryCaseId: string | null;
}

function canonicalBinding(binding: ExecutionBinding): string {
  const p = binding.assessmentPolicy;
  return [
    EXECUTION_BINDING_SCHEME,
    binding.boundaryId,
    binding.datasetFingerprint,
    binding.admissionDecisionId,
    binding.admissionPolicyId,
    binding.admissionPolicyVersion,
    binding.admissionPolicyHash,
    binding.contractVersion,
    p.policyId,
    p.policyVersion,
    p.calculationMethodVersion,
    p.asOf,
    String(p.stallThresholdDays),
    p.currency,
    binding.interpretation.mappingId,
    binding.interpretation.amountFormat,
    binding.interpretation.dateLocale,
    binding.recoveryCaseId ?? "",
  ].join("\u0000");
}

/**
 * `PAX-<32 hex>` — the execution's identity AND its idempotency key.
 *
 * This is the whole retry story in one line. Scheduling the same binding twice derives the same id,
 * so the second attempt collides on a primary key and returns the first execution rather than
 * starting a parallel one. Scheduling a DIFFERENT binding — a new policy version, a later `asOf`,
 * other bytes — derives a different id, so a changed bar can never silently re-grade an existing
 * execution. Nothing has to remember to deduplicate; the arithmetic does it.
 */
export async function deriveExecutionId(binding: ExecutionBinding): Promise<string> {
  return `PAX-${(await sha256Hex(canonicalBinding(binding))).slice(0, 32)}`;
}

/** `sha256:<64 hex>` over the binding — stored so a later read can prove the binding is unchanged. */
export async function hashExecutionBinding(binding: ExecutionBinding): Promise<string> {
  return `sha256:${await sha256Hex(canonicalBinding(binding))}`;
}

// ── 3 · The lifecycle ─────────────────────────────────────────────────────────────────────────────

/**
 * The five states the UI must distinguish (requirement 14), and nothing else.
 *
 * As with the policy lifecycle, state is DERIVED from an append-only event log rather than stored in
 * an editable column. A status column can be set to anything by anyone who can write the row; a
 * derived state can only be what its events produced.
 */
export type ExecutionState = "queued" | "running" | "blocked" | "completed" | "failed";

export type ExecutionTransition =
  | "SCHEDULED"
  | "CLAIMED"
  | "RELEASED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export interface ExecutionLifecycleEvent {
  readonly transition: ExecutionTransition;
  /** The NH-AX-#### code, when the transition carries one. Null for ordinary progress. */
  readonly code: string | null;
  /** Who or what caused it: an actor id when scheduled, a worker id when run. */
  readonly byId: string;
  readonly at: string;
}

/**
 * States a transition may be applied from. Anything not listed is refused.
 *
 * `CLAIMED` is legal from `failed` as well as `queued` because the runtime's normal retry puts a
 * failed task back in play — and from `running`, which is the expired-lease case: a worker that
 * died mid-run left the execution reading `running` with nobody running it, and the next worker to
 * win the fenced claim is legitimately taking over. Allowing it here does not weaken exclusion;
 * exclusion is the task store's fenced lease, and this log only records what that decided. It is
 * NOT legal from `blocked` or `completed`, which are terminal.
 */
const LEGAL_FROM: Readonly<Record<ExecutionTransition, readonly ExecutionState[]>> = Object.freeze({
  SCHEDULED: Object.freeze([]), // birth: only valid when no prior event exists
  CLAIMED: Object.freeze(["queued", "running", "failed"] as ExecutionState[]),
  RELEASED: Object.freeze(["running"] as ExecutionState[]),
  BLOCKED: Object.freeze(["queued", "running"] as ExecutionState[]),
  COMPLETED: Object.freeze(["running"] as ExecutionState[]),
  FAILED: Object.freeze(["running"] as ExecutionState[]),
});

const RESULTING_STATE: Readonly<Record<ExecutionTransition, ExecutionState>> = Object.freeze({
  SCHEDULED: "queued",
  CLAIMED: "running",
  RELEASED: "queued",
  BLOCKED: "blocked",
  COMPLETED: "completed",
  FAILED: "failed",
});

/** Terminal states. No transition moves out of one, so a verdict, once reached, stays reached. */
const TERMINAL: readonly ExecutionState[] = Object.freeze(["blocked", "completed"]);

export function isTerminalExecutionState(state: ExecutionState | null): boolean {
  return state !== null && TERMINAL.includes(state);
}

/**
 * Derive the current state from the log.
 *
 * Fail-closed on an empty log: an execution with no events was never scheduled, and the answer is
 * "no state", not "assume queued". An illegal transition in the log is IGNORED, not applied — the
 * store refuses to write one, so seeing one here means the log was tampered with, and the safe
 * reading of a tampered log is the state its legal events produced.
 */
export function deriveExecutionState(
  events: readonly ExecutionLifecycleEvent[],
): ExecutionState | null {
  if (events.length === 0) return null;
  let state: ExecutionState | null = null;
  for (const event of events) {
    if (event.transition === "SCHEDULED") {
      // A replayed SCHEDULED never resets a running or terminal execution back to queued.
      if (state === null) state = "queued";
      continue;
    }
    if (state !== null && !isTerminalExecutionState(state) && LEGAL_FROM[event.transition].includes(state)) {
      state = RESULTING_STATE[event.transition];
    }
  }
  return state;
}

export function canTransitionExecution(
  from: ExecutionState | null,
  transition: ExecutionTransition,
): boolean {
  if (transition === "SCHEDULED") return from === null;
  if (from === null || isTerminalExecutionState(from)) return false;
  return LEGAL_FROM[transition].includes(from);
}

// ── 4 · The input projection ──────────────────────────────────────────────────────────────────────

/**
 * WHAT THIS IS: PSEUDONYMISED CUSTOMER-DERIVED DATA. Not anonymous data.
 *
 * An earlier version of this comment said the projection was "minimized until what remains cannot
 * identify anyone" and was "not linkable to any other dataset". Both claims were wrong, and wrong in
 * the direction that matters — a reader could have concluded this table sits outside data-protection
 * obligations. It does not. The accurate statement:
 *
 *   • Direct identifiers are replaced. `cycleId`, `entityId` and `sourceRowId` become FIRST-APPEARANCE
 *     ORDINALS (`c-0001`, `e-0001`, `r-0001`), which preserves equality classes exactly — two cycles
 *     that shared an entity still share one — so the cohort and payment arithmetic is bit-for-bit
 *     unchanged. The mapping is not stored and not recoverable from the projection alone, and it needs
 *     no secret key, so there is no key to leak, rotate or forget.
 *   • What remains CAN PERMIT LINKAGE. Each projected cycle still carries four to six exact dates and
 *     one or two exact minor-unit amounts. Anyone holding the source export — or any other extract
 *     covering the same subscriptions — can match rows on those values. Removing a direct identifier
 *     does not prevent that, and no claim is made here about how often it would succeed: this file
 *     states the exposure, not a measured rate.
 *   • Therefore: pseudonymised, retained under an explicit policy, and in scope. See
 *     `server/services/pilotInputRetention.ts` for the retention rules and the governed purge path.
 *
 * WHAT IS DROPPED, verified rather than assumed:
 *   • `statusRaw` — free text from the customer's source system. The adapter is the only thing that
 *     ever reads it; by the time a cycle exists, its effect is already baked into
 *     `refundedAt`/`cancelledAt` and the exclusion decision.
 *   • `attributes` keeps only `paid_timing`, whose sole value is a fixed internal marker. `plan`,
 *     `segment`, `product` and anything else a customer's export carried are free text and are gone.
 *
 * WHY ANYTHING ROW-DERIVED IS PERSISTED AT ALL. EP-13 stored none, which was right for a submission
 * record whose only job was to recognise a repeated upload. An execution is asynchronous and leased: a
 * worker that picks one up has no CSV, so the input it runs on must be durable. That is the whole
 * justification, and it is narrower than the one this comment used to give — reproducibility ALONE
 * would not require it, because `input_hash` plus the customer's original file already reproduce the
 * finding without our copy. Retaining the projection buys durability for the run and reproduction
 * without the customer's file; it does not buy correctness, and it is therefore bounded in time.
 *
 * REJECTED ROWS NEVER ENTER. The projection's only input is the accepted cycles. A rejected row has
 * no representation here, so no rejected value can influence a cohort, a sum or a finding.
 */
export interface ExecutionInput {
  readonly scheme: typeof EXECUTION_PROJECTION_SCHEME;
  readonly cycles: readonly ExpectationCycle[];
}

const ordinal = (prefix: string, n: number): string => `${prefix}-${String(n).padStart(4, "0")}`;

/** Stable first-appearance ordinal assignment. Same input order ⇒ same labels, always. */
class OrdinalTable {
  private readonly seen = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  label(value: string): string {
    const existing = this.seen.get(value);
    if (existing !== undefined) return existing;
    const next = ordinal(this.prefix, this.seen.size + 1);
    this.seen.set(value, next);
    return next;
  }
}

/**
 * Project accepted cycles into the de-identified input an execution runs on.
 *
 * Deterministic and order-preserving: the same accepted cycles in the same order always produce
 * byte-identical output, which is what makes `hashExecutionInput` a usable tamper check.
 */
export function projectExecutionInput(cycles: readonly ExpectationCycle[]): ExecutionInput {
  const cycleIds = new OrdinalTable("c");
  const entityIds = new OrdinalTable("e");
  const rowIds = new OrdinalTable("r");
  return Object.freeze({
    scheme: EXECUTION_PROJECTION_SCHEME,
    cycles: Object.freeze(
      cycles.map((cycle) => {
        const paidTiming = cycle.attributes["paid_timing"];
        return Object.freeze({
          cycleId: cycleIds.label(cycle.cycleId),
          sourceRowId: rowIds.label(cycle.sourceRowId),
          entityId: entityIds.label(cycle.entityId),
          expectationAt: cycle.expectationAt,
          observationAt: cycle.observationAt,
          monetaryEvent: Object.freeze({
            dueAt: cycle.monetaryEvent.dueAt,
            amount: Object.freeze({ ...cycle.monetaryEvent.amount }),
            paidAt: cycle.monetaryEvent.paidAt,
            paidAmount:
              cycle.monetaryEvent.paidAmount === null
                ? null
                : Object.freeze({ ...cycle.monetaryEvent.paidAmount }),
            refundedAt: cycle.monetaryEvent.refundedAt,
            cancelledAt: cycle.monetaryEvent.cancelledAt,
          }),
          currency: cycle.currency,
          // Dropped, not blanked-by-accident: the adapter has already consumed it.
          statusRaw: null,
          attributes: Object.freeze(paidTiming === undefined ? {} : { paid_timing: paidTiming }),
        }) as ExpectationCycle;
      }),
    ),
  });
}

/** Canonical JSON of the projection — fixed key order, so it is a stable hash input. */
export function canonicalExecutionInput(input: ExecutionInput): string {
  return JSON.stringify({
    scheme: input.scheme,
    cycles: input.cycles.map((c) => ({
      cycleId: c.cycleId,
      sourceRowId: c.sourceRowId,
      entityId: c.entityId,
      expectationAt: c.expectationAt,
      observationAt: c.observationAt,
      monetaryEvent: {
        dueAt: c.monetaryEvent.dueAt,
        amount: { minor: c.monetaryEvent.amount.minor, currency: c.monetaryEvent.amount.currency },
        paidAt: c.monetaryEvent.paidAt,
        paidAmount:
          c.monetaryEvent.paidAmount === null
            ? null
            : { minor: c.monetaryEvent.paidAmount.minor, currency: c.monetaryEvent.paidAmount.currency },
        refundedAt: c.monetaryEvent.refundedAt,
        cancelledAt: c.monetaryEvent.cancelledAt,
      },
      currency: c.currency,
      statusRaw: c.statusRaw,
      attributes: Object.fromEntries(Object.entries(c.attributes).sort(([a], [b]) => a.localeCompare(b))),
    })),
  });
}

/** `sha256:<64 hex>` over the canonical projection. Stored, then re-checked before every run. */
export async function hashExecutionInput(input: ExecutionInput): Promise<string> {
  return `sha256:${await sha256Hex(canonicalExecutionInput(input))}`;
}

// ── 5 · The finding ───────────────────────────────────────────────────────────────────────────────

/**
 * What an execution produces.
 *
 * Read the claim boundary first: this is an OBSERVATION. `constitutesProof` and `constitutesRevenue`
 * are typed as the literal `false`, so a future edit that tried to set either true would not compile.
 * The two-ledger separation is kept by construction — nothing in this module imports the proof
 * kernel, the ledger, or anything that can count a dollar, and a structural test asserts it.
 */
export interface AssessmentFinding {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly assessmentId: string;
  readonly calculationMethodVersion: string;
  readonly acceptedCycleCount: number;
  readonly excludedCycleCount: number;
  /** Exclusions the assessment itself produced, as NH-DC-#### codes with counts. */
  readonly exclusionCodes: readonly { readonly code: string; readonly count: number }[];
  readonly stalledCount: number;
  readonly undeterminedCount: number;
  readonly referenceCount: number;
  readonly currency: string;
  /** Exact minor units. Revenue OPPORTUNITY — a forecast-side observation, never money returned. */
  readonly observedUnpaidMinor: number;
  readonly grossEligibleMinor: number;
  readonly partialOutstandingMinor: number;
  readonly excludedValueMinor: number;
  readonly unknownValueMinor: number;
  readonly stateCounts: Readonly<Record<string, number>>;
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
    readonly createsRecoveryCase: false;
  };
}

/** Canonical JSON of a finding — the hash input that makes a duplicate write provably a no-op. */
export function canonicalFinding(finding: AssessmentFinding): string {
  return JSON.stringify({
    executionId: finding.executionId,
    boundaryId: finding.boundaryId,
    assessmentId: finding.assessmentId,
    calculationMethodVersion: finding.calculationMethodVersion,
    acceptedCycleCount: finding.acceptedCycleCount,
    excludedCycleCount: finding.excludedCycleCount,
    exclusionCodes: [...finding.exclusionCodes]
      .map((e) => ({ code: e.code, count: e.count }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    stalledCount: finding.stalledCount,
    undeterminedCount: finding.undeterminedCount,
    referenceCount: finding.referenceCount,
    currency: finding.currency,
    observedUnpaidMinor: finding.observedUnpaidMinor,
    grossEligibleMinor: finding.grossEligibleMinor,
    partialOutstandingMinor: finding.partialOutstandingMinor,
    excludedValueMinor: finding.excludedValueMinor,
    unknownValueMinor: finding.unknownValueMinor,
    stateCounts: Object.fromEntries(
      Object.entries(finding.stateCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

export async function hashFinding(finding: AssessmentFinding): Promise<string> {
  return `sha256:${await sha256Hex(canonicalFinding(finding))}`;
}

// ── 6 · Running one execution ─────────────────────────────────────────────────────────────────────

/**
 * Compute the finding for one execution.
 *
 * It calls `assess` — the SAME pure core the browser has always used — rather than reimplementing
 * cohort splitting or the observed summary. That is deliberate: an orchestrated run must produce the
 * number the assessment core produces, or the orchestration has quietly become a second, unreviewed
 * definition of the same word.
 *
 * `createdAt` is supplied by the caller and folded into nothing that identifies the run, so this
 * function has no clock and is fully deterministic: the same input, policy and binding always give
 * the same finding, which is what makes a duplicate write provably a no-op.
 */
export function runProjectedAssessment(input: {
  readonly executionId: string;
  readonly binding: ExecutionBinding;
  readonly input: ExecutionInput;
  readonly policy: AssessmentPolicy;
  readonly createdAt: string;
}): AssessmentFinding {
  const result = assess(
    input.input.cycles.map((cycle) => ({ kind: "cycle" as const, cycle })),
    input.policy,
    {
      fingerprint: input.binding.datasetFingerprint,
      fingerprintAlgo: "SHA-256",
      createdAt: input.createdAt,
      adapterId: SAAS_ADAPTER_ID,
      adapterVersion: SAAS_ADAPTER_VERSION,
      // The mapping itself is not carried into the projection — only its deterministic id, which is
      // what `assessmentId` folds in. An empty map here would change the id, so the id is the field
      // that travels, and the map is reported by the intake that produced it.
      columnMapping: Object.freeze({}),
      mappingId: input.binding.interpretation.mappingId,
      amountFormat: input.binding.interpretation.amountFormat,
      dateLocale: input.binding.interpretation.dateLocale,
    },
  );

  // Exclusions the assessment itself produced (cycle-identity collisions) are reported in the SAME
  // vocabulary the intake used, via the contract's total reason→code map. One exclusion vocabulary,
  // so a customer never has to learn that the same problem has two names depending on who found it.
  const counts = new Map<string, number>();
  for (const exclusion of result.exclusions) {
    const spec = EXCLUSION_REASON_CODES[exclusion.reason];
    counts.set(spec.code, (counts.get(spec.code) ?? 0) + 1);
  }

  return Object.freeze({
    executionId: input.executionId,
    boundaryId: input.binding.boundaryId,
    assessmentId: result.assessmentId,
    calculationMethodVersion: input.policy.calculationMethodVersion,
    acceptedCycleCount: result.acceptedCycleCount,
    excludedCycleCount: result.excludedRowCount,
    exclusionCodes: Object.freeze(
      [...counts.entries()]
        .map(([code, count]) => Object.freeze({ code, count }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ),
    stalledCount: result.stalledCount,
    undeterminedCount: result.undeterminedCount,
    referenceCount: result.referenceCount,
    currency: result.observed.currency,
    observedUnpaidMinor: result.observed.observedUnpaid.minor,
    grossEligibleMinor: result.observed.grossEligible.minor,
    partialOutstandingMinor: result.observed.partialOutstanding.minor,
    excludedValueMinor: result.observed.excludedValue.minor,
    unknownValueMinor: result.observed.unknownValue.minor,
    stateCounts: Object.freeze({ ...result.observed.stateCounts }),
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      constitutesProof: false as const,
      constitutesRevenue: false as const,
      createsRecoveryCase: false as const,
    }),
  });
}
