// T1 · THE TWO-EXTRACT PILOT INTAKE — the door in front of the engine that already works.
//
// WHAT WAS MISSING, AND IT WAS ONLY THIS. `reconciliationObserver` is production code: it takes an
// expectation extract and a billing extract, runs the REAL validators and the REAL reconciliation
// core, and emits a CandidateSignal for every UNDER_BILLED, unpaired, priced unit. But the only two
// things in the repository that ever enqueued a task for it were the assessment path (blocked
// elsewhere) and the synthetic demo. A customer's two files had nowhere to go.
//
// SO THIS MODULE ADDS A DOOR AND NOTHING ELSE. It parses, it asks the existing readiness evaluator
// whether the pair can be read, and it enqueues ONE reconciliation task. It contains:
//
//   * no detector, no reconciliation, no matching rule, no residual, no money;
//   * no new contract, no contract version change, no migration;
//   * nothing that touches the PROVEN gate, a proof, a baseline or a ledger figure.
//
// Every financial decision stays where it already is, and this module cannot reach any of it — a test
// asserts the absent imports rather than the comment claiming it.
//
// ── THE VALIDATION HERE IS A DIAGNOSIS; THE OBSERVER'S IS THE DECISION ──────────────────────────────
//
// The observer validates again when it runs, with the same functions. That is deliberate and it is
// not duplication: this call exists so an unreadable pair is refused AT THE DOOR with codes an
// operator can act on, instead of being queued and failing inside a worker where nobody is looking.
// The same shape as the settlement ledger's — *the constraint is the control, the read is a
// diagnosis* — and the authoritative answer remains the one computed at run time.
//
// So intake refuses ONLY what cannot be processed at all, and REPORTS everything else. A pair whose
// readiness is L1 is still enqueued: "the join cannot be formed" is a finding about the data, not a
// reason for NH to decline to look.
//
// ── WHAT THE REQUEST MAY AND MAY NOT STATE ──────────────────────────────────────────────────────────
//
// `currency` is a GOVERNED READING TERM and the caller states it, exactly as the local CLI requires
// it: a row in another currency is excluded rather than converted, so the term decides which rows
// count, and inferring it from the file would let the file decide. It is the only term.
//
// `observedAt` and `actionAvailable` are NOT request fields and there is no wire format in which they
// could be. `observedAt` is the server's clock; a caller choosing it would be choosing when the
// observation happened. `actionAvailable: false` makes the observer emit NO signals at all, so a
// request field for it would be a silent switch by which the party submitting the data could suppress
// its own detection. Both are stamped here.

import { createHash } from "node:crypto";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";
import { requireCan } from "../auth/authorityGate";
import { assessPairFromCsv } from "../../src/contract/pairAssessment";
import { CsvTransportError } from "../../src/contract/csvPairTransport";
import type { ReadinessReport } from "../../src/contract/dataReadiness";
import {
  MAX_EXTRACT_COLUMNS,
  MAX_EXTRACT_ROWS,
  RECONCILIATION_AGENT_ID,
} from "../agents/reconciliationObserver";

/** Version of this intake path. A change in what it accepts or refuses is a NEW id. */
export const PILOT_PAIR_INTAKE_VERSION = "pair-intake-2026.1";

/**
 * The largest pair this route accepts, per file.
 *
 * TAKEN FROM THE OBSERVER'S OWN BOUNDS rather than chosen here, so the door cannot admit a pair the
 * engine behind it will refuse. The observer throws on an over-large extract; a task that can only
 * fail is worse than a refusal, because the refusal reaches the operator and the throw reaches a log.
 */
export const PAIR_MAX_ROWS = MAX_EXTRACT_ROWS;
export const PAIR_MAX_COLUMNS = MAX_EXTRACT_COLUMNS;

/** 8 MB per file. Transport headroom only — the row and column bounds are the real limits. */
export const PAIR_MAX_BYTES = 8 * 1024 * 1024;

export type PilotPairRefusal =
  /** A file is not readable as CSV at all. The transport's own code is carried through. */
  | "NH-PP-1001"
  /** A file exceeds the byte limit. */
  | "NH-PP-1002"
  /** A file exceeds the observer's row or column bounds. */
  | "NH-PP-1003"
  /** An extract is not usable under its governed contract — the extract-level codes say why. */
  | "NH-PP-1004"
  /** The currency is not a three-letter ISO code. */
  | "NH-PP-1005";

export interface PilotPairSubmission {
  /**
   * The tenant boundary this pair is FOR. An authorization REQUEST, never an assertion:
   * `requireBoundaryAccess` refuses it unless the authenticated context already grants it.
   */
  readonly boundaryId: string;
  readonly expectationCsv: string;
  readonly billingCsv: string;
  /** The governed reading term. Three-letter ISO code, stated by the operator. */
  readonly currency: string;
}

/**
 * What the caller is told. Counts and codes only — never a row, a cell or an identifier.
 *
 * A REFUSAL IS AN ANSWER, NOT AN ERROR, and this follows EP-13's convention exactly: the route
 * returns 200 with a verdict and the caller branches on `accepted`, never on the status code. A pair
 * whose extracts are unusable is a valid finding about the data; throwing would make it look like a
 * malformed request. Authorization is the only thing that throws, because an actor who may not act
 * for a tenant must learn nothing about that tenant's files — not even whether they parse.
 */
export interface PilotPairIntakeResult {
  readonly accepted: boolean;
  /** `null` when accepted; otherwise the single code that decided the refusal. */
  readonly refusal: PilotPairRefusal | null;
  /** Why, in the operator's terms. Codes and our own words only. */
  readonly refusalDetail: string | null;
  readonly boundaryId: string;
  /** `null` when nothing was enqueued. */
  readonly taskId: string | null;
  /** `false` on an idempotent repeat of the same pair: the task already exists and nothing was added. */
  readonly queued: boolean;
  /** `null` when the pair could not be read far enough to judge readiness. */
  readonly readinessLevel: ReadinessReport["level"] | null;
  readonly provisional: boolean;
  readonly expectation: PilotPairExtractSummary | null;
  readonly billing: PilotPairExtractSummary | null;
  /**
   * Stated on every response, because a reader seeing a readiness level and a queued task will
   * otherwise supply their own conclusion.
   */
  readonly establishes: string;
}

export interface PilotPairExtractSummary {
  readonly usable: boolean;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  /** Extract-level fault codes. OURS, never a header string from the customer's file. */
  readonly extractFaultCodes: readonly string[];
  /** Row-level rejection codes, de-duplicated. Codes only; the validator's `detail` never leaves it. */
  readonly rejectionCodes: readonly string[];
}

/** The queue, as a port: this module does not reach Prisma and a test asserts it. */
export interface PairTaskQueue {
  enqueueIfAbsent(input: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly created: boolean }>;
}

/** A refusal verdict. Nothing is enqueued and nothing is recorded. */
function refused(
  boundaryId: string,
  code: PilotPairRefusal,
  detail: string,
  sides?: { expectation: PilotPairExtractSummary; billing: PilotPairExtractSummary; level: ReadinessReport["level"] },
): PilotPairIntakeResult {
  return Object.freeze({
    accepted: false as const,
    refusal: code,
    refusalDetail: detail,
    boundaryId,
    taskId: null,
    queued: false,
    readinessLevel: sides?.level ?? null,
    // UNCONDITIONALLY TRUE. No path through this module can raise authority, and a refusal is not the
    // place a reader should have to work out that nothing was verified.
    provisional: true,
    expectation: sides?.expectation ?? null,
    billing: sides?.billing ?? null,
    establishes:
      "Nothing was queued and nothing was recorded. This is a finding about the files, not a claim " +
      "about the customer's revenue.",
  });
}

/**
 * Accept a pair, judge whether it can be read, and enqueue one reconciliation task.
 *
 * ORDER IS DELIBERATE: the boundary first, because an actor who may not act for a tenant must not
 * learn anything about that tenant's data — not even whether a file parses. Then the cheap structural
 * refusals, then the transport, then the contract. Each refusal is about a different fact and an
 * operator told the wrong one looks in the wrong place.
 */
export async function submitPilotPair(
  queue: PairTaskQueue,
  actor: ActorContext,
  input: PilotPairSubmission,
  now: () => number = Date.now,
): Promise<PilotPairIntakeResult> {
  requireCan(actor, "SubmitPilotDataset");
  requireBoundaryAccess(actor, input.boundaryId);

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return refused(
      input.boundaryId,
      "NH-PP-1005",
      "the currency must be a three-letter ISO code. It is a governed reading term — a row in another " +
        "currency is excluded rather than converted — so it is stated, never inferred from the files",
    );
  }
  for (const [name, csv] of [["expectation", input.expectationCsv], ["billing", input.billingCsv]] as const) {
    if (Buffer.byteLength(csv, "utf8") > PAIR_MAX_BYTES) {
      return refused(
        input.boundaryId, "NH-PP-1002",
        `the ${name} export exceeds the ${PAIR_MAX_BYTES}-byte transport limit`,
      );
    }
  }

  let assessment;
  try {
    assessment = assessPairFromCsv(input.expectationCsv, input.billingCsv, { currency: input.currency });
  } catch (error) {
    // A TRANSPORT FAULT IS ABOUT THE INPUT AND CARRIES ITS OWN CODE. Anything else is ours and is
    // re-thrown: reporting our own bug as unreadable input is the `NH-AX-1009` mistake — blaming the
    // data for a claim we made.
    if (!(error instanceof CsvTransportError)) throw error;
    return refused(input.boundaryId, "NH-PP-1001", `a file is not readable as CSV (${error.code})`);
  }

  // THE OBSERVER'S BOUNDS, CHECKED AT THE DOOR. Asked after parsing because a row count is not
  // knowable before it, and asked before the contract verdict because an over-large file is a
  // transport decision rather than a statement about the data's quality.
  for (const [name, t] of [
    ["expectation", assessment.transport.expectation],
    ["billing", assessment.transport.billing],
  ] as const) {
    if (t.rows.length > PAIR_MAX_ROWS || t.header.length > PAIR_MAX_COLUMNS) {
      return refused(
        input.boundaryId,
        "NH-PP-1003",
        `the ${name} export exceeds the reconciliation bounds of ${PAIR_MAX_ROWS} rows and ` +
          `${PAIR_MAX_COLUMNS} columns. Split the pilot extract rather than truncating it — a ` +
          "truncated export reports less exposure and nothing would say so",
      );
    }
  }

  const report = assessment.report;
  if (!report.expectation.usable || !report.billing.usable) {
    // CODES ONLY. The validator's `detail` quotes cell values — a headerless export makes the first
    // DATA row the header, so a detail can carry a real identifier and a real amount. It never
    // leaves the validator, and the report's `extractFaultCodes` is the surface already proved
    // detail-free against exactly that attack.
    return refused(
      input.boundaryId,
      "NH-PP-1004",
      "an extract is not usable under its governed contract: " +
        `expectation ${codesOf(report.expectation.extractFaultCodes)}, ` +
        `billing ${codesOf(report.billing.extractFaultCodes)}`,
      { expectation: summarise(report.expectation), billing: summarise(report.billing), level: report.level },
    );
  }

  // ── IDEMPOTENCY · the first of three mechanisms against a duplicate case ─────────────────────────
  //
  // DERIVED FROM THE CONTENT, never from the clock or a caller-supplied id. Re-submitting the same two
  // files for the same boundary under the same term is recognised as the SAME OBSERVATION and adds
  // nothing: `enqueueIfAbsent` is ON CONFLICT DO NOTHING, so no second task, no second set of
  // candidates and therefore no second case.
  //
  // The boundary is INSIDE the hash, so one tenant's pair can never collide with another's.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([
      PILOT_PAIR_INTAKE_VERSION,
      input.boundaryId,
      input.currency,
      input.expectationCsv,
      input.billingCsv,
    ]))
    .digest("hex");
  const taskId = `PAIR-${input.boundaryId}-${fingerprint.slice(0, 24)}`;

  const observedAt = new Date(now()).toISOString();
  const queued = await queue.enqueueIfAbsent({
    taskId,
    boundaryId: input.boundaryId,
    agentId: RECONCILIATION_AGENT_ID,
    idempotencyKey: `PAIR-${fingerprint}`,
    payload: Object.freeze({
      expectation: Object.freeze({
        columns: [...assessment.transport.expectation.header],
        rows: assessment.transport.expectation.rows,
      }),
      billing: Object.freeze({
        columns: [...assessment.transport.billing.header],
        rows: assessment.transport.billing.rows,
      }),
      currency: input.currency,
      observedAt,
      // SERVER-STAMPED, NOT A REQUEST FIELD. `false` suppresses every signal, so a caller able to set
      // it could silently switch off detection of their own exposure.
      actionAvailable: true,
    }),
    now: now(),
  });

  return Object.freeze({
    accepted: true as const,
    refusal: null,
    refusalDetail: null,
    boundaryId: input.boundaryId,
    taskId,
    queued: queued.created,
    readinessLevel: report.level,
    provisional: report.provisional,
    expectation: summarise(report.expectation),
    billing: summarise(report.billing),
    establishes:
      "A reconciliation observation was queued. This creates NO Recovery Case, NO proof and NO " +
      "monetary claim: any candidate it produces is OBSERVED exposure in the Revenue Opportunity " +
      "ledger, and Revenue Returned is computed later and only from signed evidence under a locked " +
      "baseline. The readiness level is PROVISIONAL — no provenance channel has verified these files.",
  });
}

/**
 * The fields BOTH sides share, named structurally rather than by one side's type.
 *
 * The expectation and billing summaries are deliberately NOT the same shape — the expectation side
 * carries `unknownAmountRows` and `monetaryQuantification`, the billing side carries `creditRows`
 * and `obligationRefPopulatedRows` — and typing this helper to either one made it reject the other.
 * The intake response carries only the intersection, because the asymmetric fields are the readiness
 * report's business and re-publishing half of them here would invite a reader to compare two columns
 * that do not mean the same thing.
 */
interface PairSideCommon {
  readonly usable: boolean;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly rejectionCodes: readonly string[];
  readonly extractFaultCodes: readonly string[];
}

function summarise(side: PairSideCommon): PilotPairExtractSummary {
  return Object.freeze({
    usable: side.usable,
    acceptedRows: side.acceptedRows,
    rejectedRows: side.rejectedRows,
    extractFaultCodes: Object.freeze([...side.extractFaultCodes]),
    rejectionCodes: Object.freeze([...new Set(side.rejectionCodes)].sort()),
  });
}

/** Render a code list, or say plainly that there is none — never an empty string the reader fills in. */
function codesOf(codes: readonly string[]): string {
  return codes.length === 0 ? "(no extract-level fault)" : codes.join(", ");
}
