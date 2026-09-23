// EP-16 · Persistence for pilot assessment executions.
//
// Four append-only tables, all boundary-scoped, none with a mutation path:
//   • the execution record — the immutable binding, keyed by its own deterministic id;
//   • the de-identified input the execution runs on;
//   • the lifecycle log, from which the five UI states are DERIVED (never an editable column);
//   • the finding, keyed by the execution so a retry cannot write a second answer.
//
// TENANT ISOLATION is enforced twice over, on purpose. The execution id already contains the
// boundary (it is hashed into the binding), and every read here ALSO filters by `boundaryId`. The
// second filter is what survives a future refactor of the first: if id derivation were ever changed,
// a lookup still cannot return another tenant's row — it reads as absent, never as theirs.
import { randomUUID } from "node:crypto";
import { prisma, type DbClient } from "../db";
import type {
  ExecutionBinding,
  ExecutionInput,
  ExecutionLifecycleEvent,
  ExecutionState,
  ExecutionTransition,
  AssessmentFinding,
} from "../../src/contract/assessmentExecution";
import { deriveExecutionState } from "../../src/contract/assessmentExecution";

export interface ExecutionRecord {
  readonly executionId: string;
  readonly binding: ExecutionBinding;
  readonly bindingHash: string;
  readonly inputHash: string;
  readonly scheduledByActorId: string;
  readonly scheduledByRole: string;
  readonly scheduledAt: string;
}

type ExecutionRow = {
  executionId: string;
  boundaryId: string;
  datasetFingerprint: string;
  admissionDecisionId: string;
  admissionPolicyId: string;
  admissionPolicyVersion: string;
  admissionPolicyHash: string;
  contractVersion: string;
  assessmentPolicyId: string;
  assessmentPolicyVersion: string;
  calculationMethodVersion: string;
  asOf: string;
  stallThresholdDays: number;
  currency: string;
  mappingId: string;
  amountFormat: string;
  dateLocale: string;
  recoveryCaseId: string | null;
  bindingHash: string;
  inputHash: string;
  scheduledByActorId: string;
  scheduledByRole: string;
  scheduledAt: Date;
};

function toExecutionRecord(row: ExecutionRow): ExecutionRecord {
  return Object.freeze({
    executionId: row.executionId,
    binding: Object.freeze({
      boundaryId: row.boundaryId,
      datasetFingerprint: row.datasetFingerprint,
      admissionDecisionId: row.admissionDecisionId,
      admissionPolicyId: row.admissionPolicyId,
      admissionPolicyVersion: row.admissionPolicyVersion,
      admissionPolicyHash: row.admissionPolicyHash,
      contractVersion: row.contractVersion,
      assessmentPolicy: Object.freeze({
        policyId: row.assessmentPolicyId,
        policyVersion: row.assessmentPolicyVersion,
        calculationMethodVersion: row.calculationMethodVersion,
        asOf: row.asOf,
        stallThresholdDays: row.stallThresholdDays,
        currency: row.currency,
      }),
      interpretation: Object.freeze({
        mappingId: row.mappingId,
        amountFormat: row.amountFormat,
        dateLocale: row.dateLocale,
      }),
      recoveryCaseId: row.recoveryCaseId,
    }),
    bindingHash: row.bindingHash,
    inputHash: row.inputHash,
    scheduledByActorId: row.scheduledByActorId,
    scheduledByRole: row.scheduledByRole,
    scheduledAt: row.scheduledAt.toISOString(),
  });
}

export interface CreateExecutionInput {
  readonly executionId: string;
  readonly binding: ExecutionBinding;
  readonly bindingHash: string;
  readonly input: ExecutionInput;
  readonly inputHash: string;
  readonly scheduledByActorId: string;
  readonly scheduledByRole: string;
}

/**
 * Create an execution, its input and its `SCHEDULED` event — atomically, or not at all.
 *
 * `created: false` is the idempotent path, and it is reached by a PRIMARY KEY COLLISION rather than
 * by a read-then-write check. That matters under concurrency: two workers scheduling the same
 * binding at the same instant cannot both see "absent" and both insert, because the second insert
 * is refused by the database rather than by a race the application hoped to win.
 */
export async function createExecutionIfAbsent(
  input: CreateExecutionInput,
  client: DbClient = prisma,
): Promise<{ readonly execution: ExecutionRecord; readonly created: boolean }> {
  const b = input.binding;
  const existing = await findExecution(input.executionId, b.boundaryId, client);
  if (existing) return { execution: existing, created: false };

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.pilotAssessmentExecutionRecord.create({
        data: {
          executionId: input.executionId,
          boundaryId: b.boundaryId,
          datasetFingerprint: b.datasetFingerprint,
          admissionDecisionId: b.admissionDecisionId,
          admissionPolicyId: b.admissionPolicyId,
          admissionPolicyVersion: b.admissionPolicyVersion,
          admissionPolicyHash: b.admissionPolicyHash,
          contractVersion: b.contractVersion,
          assessmentPolicyId: b.assessmentPolicy.policyId,
          assessmentPolicyVersion: b.assessmentPolicy.policyVersion,
          calculationMethodVersion: b.assessmentPolicy.calculationMethodVersion,
          asOf: b.assessmentPolicy.asOf,
          stallThresholdDays: b.assessmentPolicy.stallThresholdDays,
          currency: b.assessmentPolicy.currency,
          mappingId: b.interpretation.mappingId,
          amountFormat: b.interpretation.amountFormat,
          dateLocale: b.interpretation.dateLocale,
          recoveryCaseId: b.recoveryCaseId,
          bindingHash: input.bindingHash,
          inputHash: input.inputHash,
          scheduledByActorId: input.scheduledByActorId,
          scheduledByRole: input.scheduledByRole,
        },
      });
      await tx.pilotAssessmentExecutionInputRecord.create({
        data: {
          executionId: input.executionId,
          boundaryId: b.boundaryId,
          cycles: JSON.parse(JSON.stringify(input.input.cycles)),
          cycleCount: input.input.cycles.length,
          inputHash: input.inputHash,
        },
      });
      await appendExecutionEvent(
        {
          executionId: input.executionId,
          boundaryId: b.boundaryId,
          transition: "SCHEDULED",
          code: null,
          byId: input.scheduledByActorId,
          detail: "execution scheduled",
        },
        tx,
      );
      return { execution: toExecutionRecord(row), created: true };
    });
  } catch {
    // Lost a race with an identical concurrent schedule. The row the other request wrote IS the
    // execution — re-read it rather than reporting a failure for work that did happen.
    const raced = await findExecution(input.executionId, b.boundaryId, client);
    if (!raced) throw new Error("execution could not be created or re-read");
    return { execution: raced, created: false };
  }
}

/** Boundary-scoped lookup. Another tenant's execution reads as absent, never as theirs. */
export async function findExecution(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<ExecutionRecord | null> {
  const row = await client.pilotAssessmentExecutionRecord.findFirst({
    where: { executionId, boundaryId },
  });
  return row ? toExecutionRecord(row) : null;
}

/**
 * Load an execution by id ALONE — for the worker, which is told a boundary by its own configuration
 * and must verify that the execution agrees rather than assuming it. The caller compares the two;
 * this function never decides authorization by itself, and the service layer above it always does.
 */
export async function findExecutionUnscoped(
  executionId: string,
  client: DbClient = prisma,
): Promise<ExecutionRecord | null> {
  const row = await client.pilotAssessmentExecutionRecord.findUnique({ where: { executionId } });
  return row ? toExecutionRecord(row) : null;
}

export async function listExecutions(
  boundaryId: string,
  limit = 50,
  client: DbClient = prisma,
): Promise<readonly ExecutionRecord[]> {
  const rows = await client.pilotAssessmentExecutionRecord.findMany({
    where: { boundaryId },
    orderBy: { scheduledAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return Object.freeze(rows.map(toExecutionRecord));
}

export interface AppendExecutionEventInput {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly transition: ExecutionTransition;
  readonly code: string | null;
  readonly byId: string;
  readonly detail: string;
}

export async function appendExecutionEvent(
  input: AppendExecutionEventInput,
  client: DbClient = prisma,
): Promise<ExecutionLifecycleEvent> {
  const row = await client.pilotAssessmentExecutionEventRecord.create({
    data: {
      id: `PXE-${randomUUID()}`,
      executionId: input.executionId,
      boundaryId: input.boundaryId,
      transition: input.transition,
      code: input.code,
      byId: input.byId,
      detail: input.detail,
    },
  });
  return Object.freeze({
    transition: row.transition as ExecutionTransition,
    code: row.code,
    byId: row.byId,
    at: row.at.toISOString(),
  });
}

/** Full lifecycle history, oldest first. Boundary-scoped; `id` breaks ties so ordering is total. */
export async function executionEvents(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<readonly ExecutionLifecycleEvent[]> {
  const rows = await client.pilotAssessmentExecutionEventRecord.findMany({
    where: { executionId, boundaryId },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  return Object.freeze(
    rows.map((r) =>
      Object.freeze({
        transition: r.transition as ExecutionTransition,
        code: r.code,
        byId: r.byId,
        at: r.at.toISOString(),
      }),
    ),
  );
}

export interface ExecutionStatus {
  readonly state: ExecutionState | null;
  readonly events: readonly ExecutionLifecycleEvent[];
  /** The code of the most recent stopping transition, if the execution is blocked or failed. */
  readonly code: string | null;
}

export async function executionStatus(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<ExecutionStatus> {
  const events = await executionEvents(executionId, boundaryId, client);
  const state = deriveExecutionState(events);
  const stopped = [...events].reverse().find((e) => e.transition === "BLOCKED" || e.transition === "FAILED");
  return Object.freeze({
    state,
    events,
    code: state === "blocked" || state === "failed" ? (stopped?.code ?? null) : null,
  });
}

export interface StoredExecutionInput {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly cycles: ExecutionInput["cycles"];
  readonly cycleCount: number;
  readonly inputHash: string;
}

export async function findExecutionInput(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<StoredExecutionInput | null> {
  const row = await client.pilotAssessmentExecutionInputRecord.findFirst({
    where: { executionId, boundaryId },
  });
  if (!row) return null;
  return Object.freeze({
    executionId: row.executionId,
    boundaryId: row.boundaryId,
    cycles: row.cycles as unknown as ExecutionInput["cycles"],
    cycleCount: row.cycleCount,
    inputHash: row.inputHash,
  });
}

export interface StoredFinding {
  readonly executionId: string;
  readonly boundaryId: string;
  readonly assessmentId: string;
  readonly finding: AssessmentFinding;
  readonly findingHash: string;
  readonly producedBy: string;
  readonly recordedAt: string;
}

function toStoredFinding(row: {
  executionId: string;
  boundaryId: string;
  assessmentId: string;
  finding: unknown;
  findingHash: string;
  producedBy: string;
  recordedAt: Date;
}): StoredFinding {
  return Object.freeze({
    executionId: row.executionId,
    boundaryId: row.boundaryId,
    assessmentId: row.assessmentId,
    finding: row.finding as AssessmentFinding,
    findingHash: row.findingHash,
    producedBy: row.producedBy,
    recordedAt: row.recordedAt.toISOString(),
  });
}

export async function findFinding(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<StoredFinding | null> {
  const row = await client.pilotAssessmentFindingRecord.findFirst({
    where: { executionId, boundaryId },
  });
  return row ? toStoredFinding(row) : null;
}

/**
 * Record a finding, or recognise that this exact finding is already recorded.
 *
 * `duplicate: true` with a MATCHING hash is the safe, expected outcome of a retry: the finding is
 * deterministic given the binding and the input, so re-deriving it after a lease expiry produces
 * byte-identical content and the second write is a provable no-op. A DIFFERENT hash for the same
 * execution is the opposite of safe — it means the binding, the input, or the calculation changed
 * under a frozen identity — so it is surfaced as a conflict rather than resolved by a last-writer
 * rule. Nothing here ever overwrites.
 */
export async function recordFindingIfAbsent(
  input: {
    readonly finding: AssessmentFinding;
    readonly findingHash: string;
    readonly producedBy: string;
  },
  client: DbClient = prisma,
): Promise<{ readonly stored: StoredFinding; readonly created: boolean; readonly conflict: boolean }> {
  const { finding } = input;
  const existing = await findFinding(finding.executionId, finding.boundaryId, client);
  if (existing) {
    return {
      stored: existing,
      created: false,
      conflict: existing.findingHash !== input.findingHash,
    };
  }
  try {
    const row = await client.pilotAssessmentFindingRecord.create({
      data: {
        executionId: finding.executionId,
        boundaryId: finding.boundaryId,
        assessmentId: finding.assessmentId,
        finding: JSON.parse(JSON.stringify(finding)),
        findingHash: input.findingHash,
        producedBy: input.producedBy,
      },
    });
    return { stored: toStoredFinding(row), created: true, conflict: false };
  } catch {
    const raced = await findFinding(finding.executionId, finding.boundaryId, client);
    if (!raced) throw new Error("finding could not be recorded or re-read");
    return { stored: raced, created: false, conflict: raced.findingHash !== input.findingHash };
  }
}

/** Has this execution's input been purged? Boundary-scoped, like every other read. */
export async function inputPurgeRecord(
  executionId: string,
  boundaryId: string,
  client: DbClient = prisma,
): Promise<{
  readonly reason: string;
  readonly inputHash: string;
  readonly cycleCount: number;
  readonly purgedAt: string;
  readonly authorizedByActorId: string;
  readonly authorizedByRole: string;
} | null> {
  const row = await client.pilotAssessmentInputPurgeRecord.findFirst({
    where: { executionId, boundaryId },
  });
  return row
    ? Object.freeze({
        reason: row.reason,
        inputHash: row.inputHash,
        cycleCount: row.cycleCount,
        purgedAt: row.purgedAt.toISOString(),
        authorizedByActorId: row.authorizedByActorId,
        authorizedByRole: row.authorizedByRole,
      })
    : null;
}
