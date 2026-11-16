// G6 · THE GOVERNED READ: what did this compromised key touch?
//
// READ-ONLY, AND STRUCTURALLY SO. It opens no transaction, writes no row and appends no event. The two
// things it reads — the key's append-only lifecycle log and the ledger's append-only consumptions —
// are both immutable by database trigger, so this surface cannot alter the facts it reports even by
// mistake.
//
// WHY IT DOES NOT REQUIRE THE WITNESS TO MATCH, which is the one decision in this file worth arguing.
// `resolveForUse` refuses a key whose stored values no longer hash to their stored witness, because
// such a row must JUDGE NOTHING. This read does not judge: it enumerates what a key already signed.
// Refusing it on a witness failure would leave an investigator unable to see the exposure of the very
// key they have just discovered was tampered with — the moment the question matters most. So the row
// is resolved without that gate and the witness status is REPORTED BESIDE THE ANSWER, which keeps
// "verified" and "the record changed after registration" distinguishable instead of collapsing them
// into a silent read or a blanket refusal. Governance may always still withdraw; it must also always
// still be able to LOOK.
//
// WHAT IT IS NOT. It is not wired to the PROVEN gate, it reduces no ledger, and it reports no money —
// the consumptions table holds no amount, so that absence is structural rather than promised.
import {
  resolveForGovernance,
  type SettlementKeyRegister,
} from "./settlementKeyGovernance";
import { settlementKeyWitnessMatches } from "../../src/contract/settlementKeyWitness";
import {
  settlementCompromiseDeclaration,
  settlementCompromiseReport,
  type ArrivalRestingOnKey,
  type KeyCompromiseDeclaration,
  type SettlementCompromiseReport,
} from "../../src/contract/settlementCompromiseReport";
import { stateAt, type SettlementKeyState } from "../../src/contract/settlementKeyLifecycle";
import { requireCan } from "../auth/authorityGate";
import { requireBoundaryAccess, type ActorContext } from "../auth/identity";

/**
 * Why the ledger could not be enumerated. NAMED, never collapsed into an empty list.
 *
 * The ledger's table lives in `scripts/migration-design/` and deliberately NOT in
 * `prisma/migrations/`, because a file there is applied by every deploy and committing it WOULD BE the
 * production schema change. So a perfectly healthy deployment can hold this key register and no
 * consumptions table at all, and that state must be sayable.
 */
export type ArrivalsUnavailableReason = "ledger_not_provisioned";

/**
 * What the ledger half of the join returned — AVAILABLE WITH ROWS, or UNAVAILABLE WITH A REASON.
 *
 * THE ABSENCE IS IN THE TYPE, NOT IN AN EXCEPTION, and that is the whole point of this shape. An
 * unreachable ledger returning an empty array would produce a report reading "0 arrivals, 0 flagged"
 * — success reported having examined nothing, which is the one outcome worse than the tool not
 * existing. The compiler now refuses to let a caller mistake one for the other.
 */
export type ArrivalEnumeration =
  | { readonly available: true; readonly arrivals: readonly ArrivalRestingOnKey[] }
  | {
      readonly available: false;
      readonly reason: ArrivalsUnavailableReason;
      readonly detail: string;
    };

/** The ledger half of the join. A port, so the read can be exercised without a database. */
export interface SettlementArrivalReader {
  enumerate(keyId: string): Promise<ArrivalEnumeration>;
}

export type KeyRecordIntegrity =
  /** The stored values hash to the stored witness. */
  | "WITNESS_VERIFIED"
  /**
   * They do not. The record changed after it was registered.
   *
   * REPORTED, NEVER SWALLOWED, and it does not suppress the report. A tampered record is a reason to
   * distrust the key's FACTS — its public key, its window, its source system — and it is not a reason
   * to hide which arrivals the ledger says rest on it. Those arrivals are recorded in a different,
   * independently append-only table that this failure says nothing about.
   */
  | "WITNESS_MISMATCH";

export interface SettlementCompromiseView {
  readonly keyId: string;
  readonly boundaryId: string;
  readonly sourceSystem: string;
  readonly sourceKind: string;
  /** The key's state as of the moment of reading. Current status, NOT the historical question. */
  readonly stateNow: SettlementKeyState | null;
  /** Null when the log is malformed; the problem is then named in `stateProblem`. */
  readonly stateProblem: string | null;
  readonly recordIntegrity: KeyRecordIntegrity;
  /**
   * What the KEY'S OWN LOG declares, which is available whether or not the ledger is.
   *
   * Lifted out of the report on purpose: an operator who cannot enumerate arrivals must still learn
   * *this key is revoked and here is the window*. Losing the declaration along with the arrivals would
   * collapse two independent facts into one silence.
   */
  readonly compromise: KeyCompromiseDeclaration;
  /**
   * The per-arrival report, or `null` meaning NOT COMPUTED.
   *
   * `null` IS NOT AN EMPTY REPORT. A report with zero arrivals asserts the ledger was read and held
   * nothing; `null` asserts it was not read. The reason is in `arrivalsUnavailable`.
   */
  readonly report: SettlementCompromiseReport | null;
  readonly arrivalsUnavailable:
    | { readonly reason: ArrivalsUnavailableReason; readonly detail: string }
    | null;
}

/**
 * Every arrival resting on one key, placed against that key's declared exposure window.
 *
 * THREE GATES, IN THIS ORDER, AND THE ORDER IS THE POINT.
 *
 *  1. `AuditRead` FIRST, before the register is touched, so an unauthorized actor cannot learn WHICH
 *     key ids exist by the difference between a 403 and a 404. Same shape as `readRecoveryCase`.
 *  2. The key must exist — a 404 from `resolveForGovernance`.
 *  3. Boundary access against THE KEY'S OWN boundary, which no request parameter can name. A caller
 *     cannot widen their reach by asserting a tenant, because the tenant is read from the record.
 *
 * The beneficiary consequence is stated rather than hidden, exactly as it is on the Recovery Case
 * read: an `author`/`operator` does not hold `AuditRead`, so the party whose claim an arrival
 * substantiates cannot pull this report for themselves. Widening that is a governance decision with an
 * owner, not a convenience.
 */
export async function readSettlementCompromise(
  register: SettlementKeyRegister,
  ledger: SettlementArrivalReader,
  actor: ActorContext,
  keyId: string,
  now: string = new Date().toISOString(),
): Promise<SettlementCompromiseView> {
  requireCan(actor, "AuditRead");
  const row = await resolveForGovernance(register, keyId);
  requireBoundaryAccess(actor, row.facts.boundaryId);

  const integrity: KeyRecordIntegrity = (await settlementKeyWitnessMatches(row.facts, row.witness))
    ? "WITNESS_VERIFIED"
    : "WITNESS_MISMATCH";

  const derived = stateAt(row.events, now);
  const enumeration = await ledger.enumerate(keyId);

  return Object.freeze({
    keyId,
    boundaryId: row.facts.boundaryId,
    sourceSystem: row.facts.sourceSystem,
    sourceKind: row.facts.sourceKind,
    stateNow: derived.ok ? derived.state : null,
    stateProblem: derived.ok ? null : `${derived.problem}: ${derived.detail}`,
    recordIntegrity: integrity,
    // THE DECLARATION IS DERIVED FROM THE KEY'S OWN LOG, not from `stateNow` and not from anything the
    // caller said. `settlementCompromiseDeclaration` finds the revocation itself, so a malformed log
    // that defeats `stateAt` still yields a correct declaration when a REVOKED_COMPROMISED event is
    // present — the two questions are answered separately, in that order, for the same reason G4
    // separates "was it in force when it signed" from "is it in force now".
    compromise: settlementCompromiseDeclaration(row.events),
    report: enumeration.available
      ? settlementCompromiseReport(keyId, row.events, enumeration.arrivals)
      : null,
    arrivalsUnavailable: enumeration.available
      ? null
      : Object.freeze({ reason: enumeration.reason, detail: enumeration.detail }),
  });
}
