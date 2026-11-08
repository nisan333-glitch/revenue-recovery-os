// Task identity and the task ledger for the coordination orchestrator.
//
// WHAT THIS IS. The pure rules that decide what a task IS, whether two submissions are the same task, how
// deep a chain of continuations may go, and when a task has run out of attempts. It is the same discipline
// `bridge.ts` applies to messages, one lane over: a closed record, derived identity, idempotent submission,
// bounded retry, and failure as a visible state rather than silence.
//
// WHY IDENTITY IS DERIVED AND NOT SUPPLIED. A caller-supplied task id is a lever: submit the same work under
// a new id and it runs again, each run costing money and each result arriving as if it were new. So the id is
// `sha256` over the governed fields and the caller may not choose it. A caller MAY state the id it expects —
// that is useful, because a disagreement means the caller and the orchestrator do not have the same task in
// mind — but a disagreement is REFUSED rather than resolved in the caller's favour. This is the
// beneficiary-determines-the-number shape: the party that benefits from a task running again must not be the
// party that decides whether it is a new task.
//
// WHY DEPTH IS READ FROM THE LEDGER. A continuation declares its parent, never its own depth. Depth is then
// counted by walking the recorded chain. A request that could declare `depth: 0` on its hundredth hop would
// be an unbounded loop with a field that says otherwise.
//
// PURE. No clock, no filesystem, no network, no process exit. `node:crypto` is used for SHA-256 only, which
// is a pure function of its input.
import { createHash } from "node:crypto";

/**
 * Who or what may appear in an orchestrator record.
 *
 * `openai-api-model` IS DELIBERATELY NOT A BRIDGE PARTY. `bridge.ts` PARTIES is ["claude-code","chatgpt",
 * "owner"], where `chatgpt` means the owner's own ChatGPT conversation — a human-driven correspondent that
 * cannot be pushed to. The model this orchestrator invokes over HTTP is a different thing entirely: a service
 * call, with a provider, a model name and a billing meter. Representing the two as one system would tell the
 * owner that their personal conversation had been automated, which is false. So the model never enters the
 * bridge's party vocabulary, and a test asserts PARTIES does not contain it.
 */
export const ORCHESTRATOR_ACTORS = Object.freeze([
  "claude-code",
  "openai-api-model",
  "reveniq",
  "owner",
] as const);
export type OrchestratorActor = (typeof ORCHESTRATOR_ACTORS)[number];

/** The channel a model was reached on. There is exactly one, and it is not a chat conversation. */
export const MODEL_CHANNEL = "openai-api" as const;

export const TASK_SCHEMA = "nh-orchestrator-task/v1";

/** The governed fields: the ones whose change makes it a DIFFERENT task. */
export interface TaskSpec {
  /** What kind of work this is. Part of identity: the same text asked as two kinds is two tasks. */
  kind: string;
  /** The instruction text handed to the model. Part of identity. */
  prompt: string;
  /** The parent task this continues, or null for a root. Part of identity: a continuation is its own task. */
  parentId: string | null;
  /** Free-form context the caller supplies. Part of identity, canonicalised by sorted keys. */
  context: Readonly<Record<string, string>>;
}

export type TaskState = "queued" | "running" | "succeeded" | "failed" | "refused";

export interface TaskRecord {
  schema: typeof TASK_SCHEMA;
  id: string;
  spec: TaskSpec;
  state: TaskState;
  attempts: number;
  /** Why this task is not progressing, when it is not. Null while it is healthy. */
  reason: string | null;
  submittedBy: OrchestratorActor;
  submittedAt: string;
}

export type TaskLedger = Readonly<Record<string, TaskRecord>>;

export interface OrchestratorLimits {
  /** Attempts per task before it is `failed`. */
  maxAttempts: number;
  /** How many links a continuation chain may have, root included. */
  maxChainDepth: number;
  /** How many direct continuations one task may have. */
  maxFanOut: number;
}

export const DEFAULT_LIMITS: Readonly<OrchestratorLimits> = Object.freeze({
  maxAttempts: 3,
  maxChainDepth: 4,
  maxFanOut: 3,
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const KIND_RE = /^[a-z][a-z0-9_-]{2,47}$/;
export const MAX_PROMPT_BYTES = 16 * 1024;

/**
 * The canonical byte string a task id is taken over.
 *
 * Declared explicitly rather than handed to `JSON.stringify` on the whole object, because stringify's output
 * follows insertion order: the same task built by two code paths would hash differently, and identity would
 * depend on how the object was assembled rather than on what it says.
 */
export function canonicalTask(spec: TaskSpec): string {
  const ctx = Object.keys(spec.context)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(spec.context[k])}`)
    .join(",");
  return [
    TASK_SCHEMA,
    JSON.stringify(spec.kind),
    JSON.stringify(spec.prompt),
    JSON.stringify(spec.parentId),
    `{${ctx}}`,
  ].join("\n");
}

export function deriveTaskId(spec: TaskSpec): string {
  return `tsk-${createHash("sha256").update(canonicalTask(spec), "utf8").digest("hex").slice(0, 32)}`;
}

export interface SpecValidation {
  ok: boolean;
  errors: string[];
}

export function validateSpec(spec: TaskSpec): SpecValidation {
  const errors: string[] = [];
  if (typeof spec.kind !== "string" || !KIND_RE.test(spec.kind)) errors.push("kind is malformed");
  if (typeof spec.prompt !== "string" || spec.prompt.trim().length === 0) errors.push("prompt is empty");
  else if (Buffer.byteLength(spec.prompt, "utf8") > MAX_PROMPT_BYTES) errors.push(`prompt exceeds ${MAX_PROMPT_BYTES} bytes`);
  if (spec.parentId !== null && (typeof spec.parentId !== "string" || !/^tsk-[0-9a-f]{32}$/.test(spec.parentId))) {
    errors.push("parentId must be null or a derived task id");
  }
  if (typeof spec.context !== "object" || spec.context === null || Array.isArray(spec.context)) {
    errors.push("context is not an object");
  } else {
    for (const [k, v] of Object.entries(spec.context)) {
      if (typeof v !== "string") errors.push(`context.${k} is not a string`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * How many links the chain ending at `id` has, root included, counted from the LEDGER.
 *
 * Returns null when the chain cannot be established — a parent that is not recorded, or a cycle. Null is not
 * depth 1: a chain we cannot walk is not a chain we have shown to be short, and the caller refuses on it.
 */
export function chainDepth(ledger: TaskLedger, parentId: string | null): number | null {
  if (parentId === null) return 1;
  const seen = new Set<string>();
  let cursor: string | null = parentId;
  let depth = 1;
  while (cursor !== null) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const rec: TaskRecord | undefined = Object.prototype.hasOwnProperty.call(ledger, cursor) ? ledger[cursor] : undefined;
    if (rec === undefined) return null;
    depth += 1;
    cursor = rec.spec.parentId;
  }
  return depth;
}

export function fanOut(ledger: TaskLedger, parentId: string): number {
  return Object.values(ledger).filter((r) => r.spec.parentId === parentId).length;
}

export type SubmitOutcome = "accepted" | "duplicate" | "conflict" | "refused";

export interface SubmitResult {
  ledger: TaskLedger;
  outcome: SubmitOutcome;
  taskId: string | null;
  errors: string[];
}

export interface SubmitInput {
  spec: TaskSpec;
  submittedBy: OrchestratorActor;
  /** Optional: the id the caller believes this is. A disagreement is refused, never resolved. */
  expectedId?: string;
}

/**
 * Record a task.
 *
 * Idempotent on identity. A caller-stated id that disagrees with the derived one is `conflict` and changes
 * nothing — see the header: letting the caller's id win would let the same work be re-run under a new name.
 * Depth and fan-out are checked against the recorded chain before anything is stored, so a refused task does
 * not occupy a slot.
 */
export function submitTask(
  ledger: TaskLedger,
  input: SubmitInput,
  now: Date,
  limits: OrchestratorLimits = DEFAULT_LIMITS,
): SubmitResult {
  const v = validateSpec(input.spec);
  if (!v.ok) return { ledger, outcome: "refused", taskId: null, errors: v.errors };
  if (!(ORCHESTRATOR_ACTORS as readonly string[]).includes(input.submittedBy)) {
    return { ledger, outcome: "refused", taskId: null, errors: ["submittedBy is not a known actor"] };
  }
  const id = deriveTaskId(input.spec);
  if (input.expectedId !== undefined && input.expectedId !== id) {
    return {
      ledger,
      outcome: "conflict",
      taskId: null,
      errors: [`caller stated id '${input.expectedId}' but the content derives '${id}'`],
    };
  }
  const existing = Object.prototype.hasOwnProperty.call(ledger, id) ? ledger[id] : undefined;
  if (existing !== undefined) return { ledger, outcome: "duplicate", taskId: id, errors: [] };

  const depth = chainDepth(ledger, input.spec.parentId);
  if (depth === null) {
    return { ledger, outcome: "refused", taskId: null, errors: ["PARENT_CHAIN_NOT_ESTABLISHABLE"] };
  }
  if (depth > limits.maxChainDepth) {
    return { ledger, outcome: "refused", taskId: null, errors: [`LOOP_DEPTH_EXCEEDED: chain would be ${depth}, limit ${limits.maxChainDepth}`] };
  }
  if (input.spec.parentId !== null && fanOut(ledger, input.spec.parentId) >= limits.maxFanOut) {
    return { ledger, outcome: "refused", taskId: null, errors: [`LOOP_FANOUT_EXCEEDED: limit ${limits.maxFanOut}`] };
  }
  if (!ISO_RE.test(now.toISOString())) return { ledger, outcome: "refused", taskId: null, errors: ["now is not representable"] };

  const rec: TaskRecord = Object.freeze({
    schema: TASK_SCHEMA,
    id,
    spec: Object.freeze({ ...input.spec, context: Object.freeze({ ...input.spec.context }) }),
    state: "queued",
    attempts: 0,
    reason: null,
    submittedBy: input.submittedBy,
    submittedAt: now.toISOString(),
  });
  return { ledger: Object.freeze({ ...ledger, [id]: rec }), outcome: "accepted", taskId: id, errors: [] };
}

/** Move a task to a new state. Terminal states are terminal: `succeeded` and `refused` never move again. */
export function transition(ledger: TaskLedger, id: string, state: TaskState, reason: string | null): TaskLedger {
  const rec = Object.prototype.hasOwnProperty.call(ledger, id) ? ledger[id] : undefined;
  if (rec === undefined) return ledger;
  if (rec.state === "succeeded" || rec.state === "refused") return ledger;
  return Object.freeze({ ...ledger, [id]: Object.freeze({ ...rec, state, reason }) });
}

/** Record that an attempt was made. Exhaustion is `failed` with a reason, never a task that quietly stops. */
export function recordAttempt(ledger: TaskLedger, id: string, limits: OrchestratorLimits = DEFAULT_LIMITS): TaskLedger {
  const rec = Object.prototype.hasOwnProperty.call(ledger, id) ? ledger[id] : undefined;
  if (rec === undefined || rec.state === "succeeded" || rec.state === "refused") return ledger;
  const attempts = rec.attempts + 1;
  const exhausted = attempts >= limits.maxAttempts;
  return Object.freeze({
    ...ledger,
    [id]: Object.freeze({
      ...rec,
      attempts,
      state: exhausted ? ("failed" as TaskState) : rec.state,
      reason: exhausted ? `ATTEMPTS_EXHAUSTED after ${attempts}` : rec.reason,
    }),
  });
}

/** Tasks a human should look at: anything that did not succeed, with the reason in plain terms. */
export function needsAttention(ledger: TaskLedger): Array<{ id: string; state: TaskState; attempts: number; reason: string | null }> {
  return Object.values(ledger)
    .filter((r) => r.state !== "succeeded")
    .map((r) => ({ id: r.id, state: r.state, attempts: r.attempts, reason: r.reason }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
