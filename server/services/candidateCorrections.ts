// WHAT HAPPENED TO A CORRECTED OBSERVATION · detected, preserved, reported — precedence NOT decided.
//
// THE DEFECT THIS ANSWERS (S-DUP-4). A second observation of the SAME obligation carrying a different
// amount resolves to the same candidate key, and the store keeps the FIRST: "FIRST OBSERVATION WINS".
// An upward correction therefore leaves money unreported, and a downward one leaves exposure overstated.
// Measured on synthetic data: 200.00 unreported upward, 400.00 overstated downward.
//
// WHY THIS MODULE DOES NOT FIX IT, AND MUST NOT. Choosing first-wins, last-wins, highest-wins or a
// re-open rule is a BUSINESS RULE about which statement of an amount is authoritative, and no approved
// requirement states one. Picking one here would be the error this repository keeps correcting —
// promoting an implementation detail into a rule — and it would do it inside a monetary figure. So the
// correction is made VISIBLE and the figure is left exactly where the governed store put it.
//
// NOTHING NEW IS PERSISTED, AND NOTHING NEEDED TO BE. The corrected observation was never lost: every
// emitted signal is already in `agent_tasks.result`, and `agent_task_events` records each succeeded run
// append-only by database trigger with no purge path. The defect was that nobody READ it. This is the
// same shape as the absorption diagnostic — a read-side derivation over append-only data, no schema
// change, reaching every row ever written with no backfill.
//
// ORDER IS THE DATABASE'S, NEVER A CLOCK'S. `agent_task_events.event_sequence` is NOT NULL with a
// Postgres sequence default, so the append order between EVENTS is a fact the database allocated. This
// module does not order by `created_at`, which is a timestamp and can tie, and it has no legacy nulls to
// label — unlike `executionEvents`, whose ordering needed exactly that treatment.
//
// AND TIES ARE **NOT** IMPOSSIBLE — an earlier version of this comment said they were, which was true of
// two EVENTS and false of two SIGNALS. One task result may carry several signals, and they all inherit
// that one event's sequence. Measured: two signals for one obligation in one row tie at sequence 7, and
// the reported DIRECTION of the monetary correction then flips with their position in the array —
// `[60000, 80000]` reads UPWARD and `[80000, 60000]` reads DOWNWARD for the same facts. That is the
// pairing-order defect this repository has already recorded, in a new place: a conclusion that depends
// on an order nothing authoritative established.
//
// SO A TIE IS A REFUSAL, NOT A CHOICE. `ORDER_NOT_ESTABLISHABLE` reports every amount observed and NO
// stored figure, latest figure, delta, direction or magnitude — all null rather than zero, because zero
// would assert there was no correction when the truth is that we cannot tell which statement came
// first. The amounts are presented in numeric order purely so the report is stable; that ordering is a
// presentation and makes no claim about chronology.
//
// IT REPORTS NO CORRECTED EXPOSURE. There is deliberately no "the real amount is X" field: that number
// is the precedence decision wearing a different name.
export const CANDIDATE_CORRECTIONS_SCHEME = "nh-candidate-corrections-v1";

/** One emitted signal, reduced to the facts this derivation needs. */
export interface ObservedAmount {
  readonly eventSequence: number;
  readonly amountAtRiskMinor: number;
  readonly currency: string;
  /** The pseudonymous obligation reference, when the signal stated one. Never a raw identifier. */
  readonly obligationRef: string | null;
  /** Whether the signal's own claim was obligation-grained. Determines which key it took. */
  readonly obligationGrained: boolean;
}

export interface SucceededObservationRow {
  readonly boundaryId: string;
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly observed: ObservedAmount;
}

export type CorrectionDirection = "UPWARD" | "DOWNWARD";

export type CorrectionState =
  /** Exactly one observation. Nothing to decide. */
  | "SINGLE_OBSERVATION"
  /** Several observations, all the same amount. A replay, not a correction. */
  | "REPEATED_IDENTICAL_OBSERVATION"
  /**
   * Several observations with different amounts. DETECTED, PRESERVED, REPORTED — and the authoritative
   * amount is UNDECIDED, because no approved rule says which statement wins.
   */
  | "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED"
  /**
   * Two or more observations of ONE identity share an append sequence, so which statement came first is
   * not establishable. Every monetary field is null: see the header.
   */
  | "ORDER_NOT_ESTABLISHABLE";

export interface CorrectionRecord {
  readonly identity: string;
  readonly boundaryId: string;
  readonly recoveryType: string;
  /** Pseudonymous account reference, as stored. Reported because a reader needs to group by account. */
  readonly sourceRef: string;
  readonly obligationRef: string | null;
  readonly obligationGrained: boolean;
  readonly state: CorrectionState;
  readonly observationCount: number;
  /**
   * Every amount ever observed for this identity, none discarded. In APPEND order where the order is
   * establishable, and in numeric order where it is not — `orderCertain` says which, so a reader never
   * has to guess whether the sequence it is looking at is chronological.
   */
  readonly observedAmountsMinor: readonly number[];
  /** False exactly when two observations of this identity share an append sequence. */
  readonly orderCertain: boolean;
  /**
   * What the governed store holds: the first observation's figure.
   *
   * NULL, NOT ZERO, where the order is not establishable. A zero would assert the store holds nothing.
   */
  readonly storedMinor: number | null;
  /** The most recent statement. NOT an assertion that it is correct. Null where order is uncertain. */
  readonly latestObservedMinor: number | null;
  /** `latestObservedMinor - storedMinor`. Zero where there is nothing to decide, null where unknowable. */
  readonly deltaMinor: number | null;
  readonly direction: CorrectionDirection | null;
  readonly currency: string;
  /**
   * What is unreported or overstated BECAUSE precedence is undecided, as a magnitude with a named
   * direction — never netted into a single signed total across identities, because an understatement
   * and an overstatement are two problems and their sum is zero problems.
   */
  readonly undecidedMagnitudeMinor: number | null;
}

export interface CorrectionReport {
  readonly scheme: typeof CANDIDATE_CORRECTIONS_SCHEME;
  /** Sorted by identity, so the same history always prints in the same order. */
  readonly records: readonly CorrectionRecord[];
  readonly totals: {
    readonly identities: number;
    readonly withCorrections: number;
    readonly repeatedIdentical: number;
    /**
     * Identities whose observation order is not establishable. Counted on its own and EXCLUDED from the
     * two monetary sums below, because an unknowable direction cannot be added to either of them.
     */
    readonly orderNotEstablishable: number;
    /** Σ magnitudes where the latest statement EXCEEDS the stored one: money not currently reported. */
    readonly upwardUndecidedMinor: number;
    /** Σ magnitudes where the latest statement is BELOW the stored one: exposure currently overstated. */
    readonly downwardUndecidedMinor: number;
  };
  /**
   * There is no net field, and its absence is the point. `upward - downward` would read as a correction
   * to the book and would net an understatement against an unrelated overstatement.
   */
  readonly netIsDeliberatelyAbsent: true;
}

/**
 * The grouping identity, restated locally and on purpose — the same decision `absorbedObservations`
 * made and for the same reason. `caseCandidateDedupeKey` is the authority and returns a digest; this
 * module never needs the VALUE, only whether two observations share one. The tuple is exactly the
 * digest's own preimage at each grain, so it is precisely as discriminating and reveals nothing.
 */
export function correctionIdentity(row: SucceededObservationRow): string {
  return row.observed.obligationGrained
    ? JSON.stringify(["v2", row.boundaryId, row.recoveryType, row.sourceRef, row.observed.obligationRef])
    : JSON.stringify(["v1", row.boundaryId, row.recoveryType, row.sourceRef]);
}

/** PURE, TOTAL, DETERMINISTIC. The same rows always produce a byte-identical report. */
export function summariseCorrections(rows: readonly SucceededObservationRow[]): CorrectionReport {
  const byIdentity = new Map<string, SucceededObservationRow[]>();
  for (const row of rows) {
    const key = correctionIdentity(row);
    const list = byIdentity.get(key) ?? [];
    list.push(row);
    byIdentity.set(key, list);
  }

  const records: CorrectionRecord[] = [];
  for (const [identity, group] of [...byIdentity.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    // APPEND ORDER, from the sequence the database allocated. Ties are impossible: the column is NOT
    // NULL with a sequence default, so two rows cannot share a value.
    const ordered = [...group].sort((x, y) => x.observed.eventSequence - y.observed.eventSequence);
    const sequences = ordered.map((r) => r.observed.eventSequence);
    // A TIE IS CHECKED BEFORE ANYTHING IS DERIVED FROM THE ORDER. One task result may carry several
    // signals, and they all inherit that event's sequence, so two observations of one identity can tie.
    const orderCertain = new Set(sequences).size === sequences.length;
    const distinct = new Set(ordered.map((r) => r.observed.amountAtRiskMinor)).size;
    const state: CorrectionState =
      ordered.length === 1 ? "SINGLE_OBSERVATION"
        : distinct === 1 ? "REPEATED_IDENTICAL_OBSERVATION"
          : !orderCertain ? "ORDER_NOT_ESTABLISHABLE"
            : "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED";
    // Numeric order where chronology is unknowable, so the report is stable without implying a sequence.
    const amounts = orderCertain
      ? ordered.map((r) => r.observed.amountAtRiskMinor)
      : [...ordered.map((r) => r.observed.amountAtRiskMinor)].sort((a, b) => a - b);
    const unknowable = state === "ORDER_NOT_ESTABLISHABLE";
    const storedMinor = unknowable ? null : amounts[0]!;
    const latestObservedMinor = unknowable ? null : amounts[amounts.length - 1]!;
    const deltaMinor = unknowable
      ? null
      : state === "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED" ? latestObservedMinor! - storedMinor! : 0;
    const first = ordered[0]!;
    records.push(Object.freeze({
      identity,
      boundaryId: first.boundaryId,
      recoveryType: first.recoveryType,
      sourceRef: first.sourceRef,
      obligationRef: first.observed.obligationRef,
      obligationGrained: first.observed.obligationGrained,
      state,
      observationCount: ordered.length,
      observedAmountsMinor: Object.freeze([...amounts]),
      orderCertain,
      storedMinor,
      latestObservedMinor,
      deltaMinor,
      direction: deltaMinor === null ? null : deltaMinor > 0 ? "UPWARD" : deltaMinor < 0 ? "DOWNWARD" : null,
      currency: first.observed.currency,
      undecidedMagnitudeMinor: deltaMinor === null ? null : Math.abs(deltaMinor),
    }));
  }

  const corrections = records.filter((r) => r.state === "CORRECTION_OBSERVED_PRECEDENCE_UNDECIDED");
  return Object.freeze({
    scheme: CANDIDATE_CORRECTIONS_SCHEME,
    records: Object.freeze(records),
    totals: Object.freeze({
      identities: records.length,
      withCorrections: corrections.length,
      repeatedIdentical: records.filter((r) => r.state === "REPEATED_IDENTICAL_OBSERVATION").length,
      orderNotEstablishable: records.filter((r) => r.state === "ORDER_NOT_ESTABLISHABLE").length,
      upwardUndecidedMinor: corrections.filter((r) => r.direction === "UPWARD")
        .reduce((n, r) => n + (r.undecidedMagnitudeMinor ?? 0), 0),
      downwardUndecidedMinor: corrections.filter((r) => r.direction === "DOWNWARD")
        .reduce((n, r) => n + (r.undecidedMagnitudeMinor ?? 0), 0),
    }),
    netIsDeliberatelyAbsent: true,
  });
}

/**
 * The scan, scoped to a boundary. Unscoped this is a forensic full-table scan, and the ordering column
 * is the sequence rather than the timestamp.
 */
export const CANDIDATE_CORRECTIONS_SQL = `SELECT ev.event_sequence,
            ev.boundary_id,
            task.result AS result
       FROM agent_task_events AS ev
       LEFT JOIN agent_tasks AS task
              ON task.task_id = ev.task_id
             AND task.boundary_id = ev.boundary_id
             AND task.agent_id = ev.agent_id
      WHERE ev.kind = 'task.succeeded'
        AND ev.boundary_id = $1
      ORDER BY ev.event_sequence ASC`;

export interface RawCorrectionRow {
  readonly event_sequence: number | bigint;
  readonly boundary_id: string;
  readonly result: unknown;
}

/**
 * Flatten raw rows into observations. A signal that is not shaped like one contributes NOTHING rather
 * than a zero — a malformed row is not an observation of no money.
 */
export function observationsFromRows(rows: readonly RawCorrectionRow[]): readonly SucceededObservationRow[] {
  const out: SucceededObservationRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.result)) continue;
    // The append-only sequence is the authority for correction order. Converting a bigint beyond
    // Number.MAX_SAFE_INTEGER silently rounds it and can reverse or tie distinct observations.
    // Refuse an unrepresentable order rather than reporting a potentially false monetary delta.
    const sequence = row.event_sequence;
    if ((typeof sequence !== "bigint" && typeof sequence !== "number") ||
        (typeof sequence === "bigint" && (sequence < 1n || sequence > BigInt(Number.MAX_SAFE_INTEGER))) ||
        (typeof sequence === "number" && (!Number.isSafeInteger(sequence) || sequence < 1))) {
      throw new Error("candidate corrections: event sequence cannot be ordered safely");
    }
    for (const raw of row.result) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as {
        recoveryType?: unknown; sourceRef?: unknown; amountAtRiskMinor?: unknown; currency?: unknown;
        obligationCoverage?: { kind?: unknown; obligationRef?: unknown };
      };
      if (typeof s.recoveryType !== "string" || typeof s.sourceRef !== "string") continue;
      if (!Number.isSafeInteger(s.amountAtRiskMinor) || typeof s.currency !== "string") continue;
      const single = s.obligationCoverage?.kind === "SINGLE_OBLIGATION"
        && typeof s.obligationCoverage.obligationRef === "string";
      out.push(Object.freeze({
        boundaryId: row.boundary_id,
        recoveryType: s.recoveryType,
        sourceRef: s.sourceRef,
        observed: Object.freeze({
          eventSequence: Number(row.event_sequence),
          amountAtRiskMinor: s.amountAtRiskMinor as number,
          currency: s.currency,
          obligationRef: single ? (s.obligationCoverage!.obligationRef as string) : null,
          obligationGrained: single,
        }),
      }));
    }
  }
  return Object.freeze(out);
}
