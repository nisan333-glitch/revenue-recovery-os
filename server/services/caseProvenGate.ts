// THE OBLIGATION-IDENTITY GATE ON `approve()`. It answers one question from persisted state alone:
//
//   > may a monetary proof be minted for THIS case, given what its identity actually covers?
//
// and it answers NO unless the server itself recorded that the claim covers exactly one reconciliation
// unit, with the expected amount, the billed amount and the discrepancy between them, and no second
// observation was folded in. The decision rule lives in `src/domain/provenEligibility.ts` and is pure;
// this module only GATHERS, so the rule can be falsified without a database and the gathering can be
// falsified without re-stating the rule.
//
// EVERY INPUT IS READ FROM THE RECORD, NEVER FROM THE REQUEST. The caller supplies a case id and nothing
// else. The coverage comes from the candidate signal the detector wrote; the absorption comes from
// `agent_task_events`, which is append-only by database trigger with no purge path. A beneficiary has no
// field by which to assert either, which is the same structural refusal the readiness ladder makes
// against a `provenanceEstablished` parameter.
//
// FAIL CLOSED AT EVERY STEP, AND EACH ABSENCE KEEPS ITS OWN NAME. A case with no governed root, a root
// whose candidate row is gone, and a candidate that stated no coverage are three different situations
// and all three refuse — but they refuse through the same pure predicate rather than through three
// hand-written throws, so the refusal vocabulary cannot drift between them.
import { prisma } from "../db";
import { accountGrainedGroup } from "./absorbedObservations";
import { provenEligibility, type ObligationCoverage, type ProvenEligibility } from "../../src/domain/provenEligibility";

/** The one statement, scoped to a boundary. Unscoped, this is a forensic full-table scan. */
const ABSORPTION_FOR_BOUNDARY = `SELECT (ev.metadata->>'admittedCount')::int AS admitted_count,
            (ev.metadata->>'createdCount')::int  AS created_count,
            task.result                          AS result
       FROM agent_task_events AS ev
       LEFT JOIN agent_tasks AS task
              ON task.task_id = ev.task_id
             AND task.boundary_id = ev.boundary_id
             AND task.agent_id = ev.agent_id
      WHERE ev.kind = 'task.succeeded'
        AND ev.boundary_id = $1
      ORDER BY ev.event_sequence ASC`;

interface AbsorptionRow {
  readonly admitted_count: number | null;
  readonly created_count: number | null;
  readonly result: unknown;
}

/** Only the two fields the grouping needs. A signal shaped otherwise contributes nothing. */
function signalsOf(result: unknown): readonly { readonly recoveryType: string; readonly sourceRef: string }[] {
  if (!Array.isArray(result)) return [];
  return result.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const sig = s as { recoveryType?: unknown; sourceRef?: unknown };
    return typeof sig.recoveryType === "string" && typeof sig.sourceRef === "string"
      ? [{ recoveryType: sig.recoveryType, sourceRef: sig.sourceRef }]
      : [];
  });
}

/**
 * Count observations absorbed into THIS case's account-grained identity.
 *
 * `null` means NOT CHECKABLE rather than zero — returned when an event carries no admission counts at
 * all, which is every event written before the publisher recorded them. Reading that silence as "no
 * absorption" is the one mistake that would let this gate mint a proof over a merge.
 */
async function absorbedForIdentity(
  boundaryId: string, group: string,
): Promise<{ readonly checked: true; readonly count: number } | { readonly checked: false }> {
  const rows = await prisma.$queryRawUnsafe<AbsorptionRow[]>(ABSORPTION_FOR_BOUNDARY, boundaryId);
  let count = 0;
  for (const row of rows) {
    const touchesThisCase = signalsOf(row.result).some(
      (s) => accountGrainedGroup(boundaryId, s) === group,
    );
    if (!touchesThisCase) continue;
    // An event that touches this identity but carries no counts makes the whole question unanswerable
    // for it. One such event is enough to refuse: a partial count is not a count.
    if (row.admitted_count === null || row.created_count === null) return { checked: false };
    if (row.admitted_count >= 1 && row.created_count === 0) count += 1;
  }
  return { checked: true, count };
}

function coverageOf(signal: unknown): ObligationCoverage | null {
  if (!signal || typeof signal !== "object") return null;
  const c = (signal as { obligationCoverage?: unknown }).obligationCoverage;
  if (!c || typeof c !== "object") return null;
  const kind = (c as { kind?: unknown }).kind;
  // Shape-checked rather than cast. `assertCandidateSignal` validated it on the way in; a row written
  // by an older build, or hand-edited, must not reach the predicate pretending to be well-formed.
  if (kind === "SINGLE_OBLIGATION" || kind === "ACCOUNT_AGGREGATE") return c as ObligationCoverage;
  return null;
}

/**
 * Decide, for one case, from the record alone.
 *
 * PURE DECISION, IMPURE GATHERING — and the split is load-bearing: `provenEligibility` is the only place
 * a refusal is chosen, so a new refusal cannot be invented here where no test would look for it.
 */
export async function caseProvenEligibility(recoveryCaseId: string): Promise<ProvenEligibility> {
  const root = await prisma.recoveryCaseRecord.findUnique({
    where: { recoveryCaseId },
    select: { boundaryId: true, recoveryType: true, sourceRef: true, sourceCandidateId: true },
  });
  // NO GOVERNED ROOT is not an aggregate and not a single obligation — it is a case whose subject was
  // never recorded. The predicate's own NOT_STATED branch says that, and says it once.
  if (!root) return provenEligibility({ coverage: null, absorbedObservations: { checked: false } });

  const candidate = await prisma.agentCaseCandidateRecord.findUnique({
    where: { candidateId: root.sourceCandidateId },
    select: { signal: true },
  });
  const coverage = coverageOf(candidate?.signal);

  // The absorption query is skipped when the coverage already refuses: the answer cannot change, and a
  // full boundary scan on a request that is going to be refused anyway is waste. The predicate still
  // receives `{ checked: false }`, so if that ordering ever became wrong the refusal stays a refusal.
  if (coverage === null || coverage.kind !== "SINGLE_OBLIGATION") {
    return provenEligibility({ coverage, absorbedObservations: { checked: false } });
  }

  const group = accountGrainedGroup(root.boundaryId, {
    recoveryType: root.recoveryType, sourceRef: root.sourceRef,
  });
  return provenEligibility({
    coverage,
    absorbedObservations: await absorbedForIdentity(root.boundaryId, group),
  });
}
