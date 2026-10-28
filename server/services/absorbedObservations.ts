// OBLIGATION-MERGE EXPOSURE · the read-only question "did this database already swallow an observation?"
//
// WHY THIS EXISTS. Candidate identity is `digest([boundaryId, recoveryType, sourceRef])` and `sourceRef`
// is ACCOUNT-grained, so two obligations of one customer collapse onto one candidate and one Recovery
// Case. `src/domain/caseIdentityGrain.ts` discloses that this is POSSIBLE on every case, from the identity
// rule alone. This module answers the different, harder question: whether it HAPPENED here.
//
// IT IS DERIVABLE WITH NO SCHEMA CHANGE, which is the finding that makes the module possible. The deployed
// activation path is `postgresTaskStore.succeed()` → `PostgresCandidateSignalWriter.writeWithin`
// (`ON CONFLICT (dedupe_key) DO NOTHING`, returning `{admittedCount, createdCount, filteredCount}`) →
// merged into the `task.succeeded` event's `metadata`, in a table that is append-only by database trigger
// and has no purge path. So `admittedCount >= 1 AND createdCount = 0` IS the stored record that a signal
// cleared the admission gate and was then absorbed by an existing candidate.
//
// AN EARLIER FORM OF MY OWN ANALYSIS SAID THE OPPOSITE, and the correction is why this file is careful.
// `docs/architecture/OBLIGATION_MERGE_RISK_V1.md` §2 reported that the activation path records "nothing at
// all" and that `created: false` is "not persisted". That is true of `CaseAdmissionService` +
// `InMemoryCaseCandidateStore` — which is what the test measured — and FALSE of the deployed path. I
// measured a non-production lane and reported its behaviour as the product's.
//
// THREE STATES, AND THEY STAY DISTINGUISHABLE. The temptation is one number called "absorbed", and it
// would be wrong in the quiet direction:
//
//   • NOT ESTABLISHABLE — a `task.succeeded` event carrying no `admittedCount` at all. The candidate
//     publisher was not wired when that task ran, so nothing was recorded either way. This is NOT zero,
//     and reporting it as zero would assert a population was checked and found clean when nobody checked.
//   • NO ABSORPTION RECORDED — the counts are present and `createdCount` equals `admittedCount`.
//   • ABSORPTION RECORDED — `admittedCount >= 1` and `createdCount = 0`.
//
// AND THE LAST STEP IS AN INFERENCE THE STORED DATA CANNOT MAKE. Two absorbed observations with different
// `sourcePayloadHash` values are EITHER two obligations OR one obligation re-observed after a reschedule, a
// renewal or a corrected amount. No column anywhere identifies an obligation, so this module reports
// absorbed OBSERVATIONS and never "N obligations were merged". That is the same distinction that named the
// disclosure state `ABSORBED_OBSERVATIONS_RECORDED` rather than `CONFIRMED_COLLISION`.
//
// A FOURTH READING IS POSSIBLE AND IS STATED RATHER THAN HIDDEN: a `createdCount = 0` event also describes
// an idempotent replay of the same observation under a fresh task key. Both real enqueuers hash the
// payload, so an exact repeat never creates a task — but the store does not enforce that and the key is
// caller-chosen, so the strength of the inference depends on an observer the database does not record.
// `distinctPayloadHashesAbsorbed` is the number that separates them: a replay absorbs the SAME hash.
//
// PURE. No `prisma`, no `pg`, no clock, no filesystem, no `process`. A test asserts the absent imports,
// because the claim that a diagnostic cannot write is worth more than the sentence saying so. The CLI at
// `scripts/exposure/absorbed-observations.ts` holds every bit of I/O.

/** Version of THIS reading. A change in what counts as absorption is a new id, never a silent re-grade. */
export const ABSORBED_OBSERVATIONS_SCHEME = "nh-absorbed-observations-v1";

/**
 * One `task.succeeded` row as the CLI reads it.
 *
 * `admittedCount`/`createdCount` are `null` when the event's metadata carries no such key — the publisher
 * was not wired. They are deliberately NOT defaulted to 0: that default is the whole defect this module
 * is built to avoid.
 */
export interface SucceededTaskRow {
  readonly boundaryId: string;
  readonly agentId: string;
  readonly admittedCount: number | null;
  readonly createdCount: number | null;
  /**
   * The signals the task returned, as stored in `agent_tasks.result`.
   *
   * READ, NEVER PRINTED. `sourceRef` is an account identifier and `sourcePayloadHash` is a content digest;
   * both are used to group and to count, and `formatAbsorptionReport` emits neither.
   */
  readonly signals: readonly AbsorbedSignalFacts[];
}

export interface AbsorbedSignalFacts {
  readonly recoveryType: string;
  readonly sourceRef: string;
  readonly sourcePayloadHash: string;
}

/** What one boundary's history establishes. Every field is a COUNT. */
export interface BoundaryAbsorption {
  readonly boundaryId: string;
  readonly agentIds: readonly string[];
  /** `task.succeeded` events seen at all. */
  readonly succeededEvents: number;
  /** …of which carried no admission counts, so absorption is NOT ESTABLISHABLE from them. */
  readonly eventsWithoutAdmissionCounts: number;
  /** …of which recorded an admission and created a candidate. */
  readonly eventsWithCandidateCreated: number;
  /** …of which admitted at least one signal and created NOTHING. This is the recorded absorption. */
  readonly eventsWithAbsorption: number;
  /** Distinct account-grained dedupe identities that absorbed at least one signal. */
  readonly accountIdentitiesAbsorbing: number;
  /**
   * Σ over the identities below of the distinct `sourcePayloadHash` values seen on them.
   *
   * This is the number that separates a genuine second observation from an idempotent replay: a replay
   * carries the SAME digest, so it contributes nothing here.
   */
  readonly distinctObservationDigests: number;
  /**
   * Identities that absorbed a signal AND have seen two or more DISTINCT observation digests. The
   * strongest evidence the stored data can offer that a second, different observation was folded in.
   *
   * THE COMPARISON SPANS CREATED AND ABSORBED EVENTS, and an earlier form of this compared only the
   * absorbed ones. That was wrong in the quiet direction: in the ordinary merge the FIRST observation
   * creates the candidate and the SECOND is absorbed, so only one digest is ever on the absorbed side and
   * the count read zero — it would have reported nothing for exactly the scenario it exists to find, and
   * fired only from a third observation onwards. Caught by driving the real production chain end to end,
   * which is what a fixture over shapes I chose could not have caught.
   */
  readonly accountIdentitiesWithDifferingObservations: number;
}

export type ExposureVerdict =
  | "ABSORPTION_RECORDED"
  | "NO_ABSORPTION_RECORDED"
  | "NOT_ESTABLISHABLE";

export interface AbsorptionReport {
  readonly scheme: typeof ABSORBED_OBSERVATIONS_SCHEME;
  readonly verdict: ExposureVerdict;
  /** Sorted by `boundaryId`, so the same history always prints in the same order. */
  readonly boundaries: readonly BoundaryAbsorption[];
  readonly totals: {
    readonly succeededEvents: number;
    readonly eventsWithoutAdmissionCounts: number;
    readonly eventsWithAbsorption: number;
    readonly accountIdentitiesWithDifferingObservations: number;
  };
}

/**
 * The account-grained grouping identity, restated LOCALLY and on purpose.
 *
 * `caseCandidateDedupeKey` is the authority and is a sha-256 digest. Importing it would pull the whole
 * admission module into a pure diagnostic for no gain, because this module never needs the key's VALUE —
 * only whether two signals share one. A tuple join is exactly as discriminating for that and reveals
 * nothing: the grouping is `(boundaryId, recoveryType, sourceRef)`, which is the key's own preimage.
 *
 * A test holds this against the real `caseCandidateDedupeKey`, so the two cannot drift apart.
 */
/**
 * The parameter is NARROWED to the two fields this function reads, rather than taking the whole
 * `AbsorbedSignalFacts`. It never needed `sourcePayloadHash` — the grouping is the dedupe key's own
 * preimage — and requiring it forced a caller holding only a case root to invent a placeholder digest.
 * A fake value passed to satisfy a type is worse than a narrower type: a reviewer believes it.
 */
export function accountGrainedGroup(
  boundaryId: string,
  signal: Pick<AbsorbedSignalFacts, "recoveryType" | "sourceRef">,
): string {
  return JSON.stringify([boundaryId, signal.recoveryType, signal.sourceRef]);
}

/** Pure, total, deterministic. The same rows always produce a byte-identical report. */
export function summariseAbsorption(rows: readonly SucceededTaskRow[]): AbsorptionReport {
  const byBoundary = new Map<
    string,
    {
      agentIds: Set<string>;
      succeededEvents: number;
      eventsWithoutAdmissionCounts: number;
      eventsWithCandidateCreated: number;
      eventsWithAbsorption: number;
      /** Every digest seen per account identity, from created AND absorbed events alike. */
      digestsByGroup: Map<string, Set<string>>;
      /** The identities an absorption actually happened on. */
      absorbingGroups: Set<string>;
    }
  >();

  for (const row of rows) {
    let b = byBoundary.get(row.boundaryId);
    if (!b) {
      b = {
        agentIds: new Set(),
        succeededEvents: 0,
        eventsWithoutAdmissionCounts: 0,
        eventsWithCandidateCreated: 0,
        eventsWithAbsorption: 0,
        digestsByGroup: new Map(),
        absorbingGroups: new Set(),
      };
      byBoundary.set(row.boundaryId, b);
    }
    b.agentIds.add(row.agentId);
    b.succeededEvents += 1;

    // The three states, and the first one is the one a default would have destroyed.
    if (row.admittedCount === null || row.createdCount === null) {
      b.eventsWithoutAdmissionCounts += 1;
      continue;
    }
    const absorbed = row.admittedCount >= 1 && row.createdCount === 0;
    if (absorbed) b.eventsWithAbsorption += 1;
    else if (row.createdCount >= 1) b.eventsWithCandidateCreated += 1;

    // The digests of BOTH kinds of event are recorded against the identity, because the question is
    // whether the identity has seen differing observations — not whether the absorbed ones differ from
    // each other. Only the absorbing identities are then counted, so a boundary where every signal
    // created its own candidate contributes nothing however many digests it carries.
    for (const signal of row.signals) {
      const group = accountGrainedGroup(row.boundaryId, signal);
      const digests = b.digestsByGroup.get(group) ?? new Set<string>();
      digests.add(signal.sourcePayloadHash);
      b.digestsByGroup.set(group, digests);
      if (absorbed) b.absorbingGroups.add(group);
    }
  }

  const boundaries: BoundaryAbsorption[] = [];
  for (const boundaryId of [...byBoundary.keys()].sort()) {
    const b = byBoundary.get(boundaryId)!;
    let distinctObservationDigests = 0;
    let differing = 0;
    for (const group of b.absorbingGroups) {
      const digests = b.digestsByGroup.get(group)?.size ?? 0;
      if (digests > 1) {
        differing += 1;
        distinctObservationDigests += digests;
      }
    }
    boundaries.push(
      Object.freeze({
        boundaryId,
        agentIds: Object.freeze([...b.agentIds].sort()),
        succeededEvents: b.succeededEvents,
        eventsWithoutAdmissionCounts: b.eventsWithoutAdmissionCounts,
        eventsWithCandidateCreated: b.eventsWithCandidateCreated,
        eventsWithAbsorption: b.eventsWithAbsorption,
        accountIdentitiesAbsorbing: b.absorbingGroups.size,
        distinctObservationDigests,
        accountIdentitiesWithDifferingObservations: differing,
      }),
    );
  }

  const totals = {
    succeededEvents: sum(boundaries, (b) => b.succeededEvents),
    eventsWithoutAdmissionCounts: sum(boundaries, (b) => b.eventsWithoutAdmissionCounts),
    eventsWithAbsorption: sum(boundaries, (b) => b.eventsWithAbsorption),
    accountIdentitiesWithDifferingObservations: sum(
      boundaries,
      (b) => b.accountIdentitiesWithDifferingObservations,
    ),
  };

  // ORDER MATTERS, AND IT IS THE FAIL-CLOSED ORDER. A recorded absorption outranks everything: it is a
  // positive finding and must not be hidden behind "some events could not be read". Only when nothing was
  // found do the unreadable events decide the verdict, because then they are the whole answer — and a
  // database with no succeeded events at all establishes nothing either.
  const verdict: ExposureVerdict =
    totals.eventsWithAbsorption > 0
      ? "ABSORPTION_RECORDED"
      : totals.eventsWithoutAdmissionCounts > 0 || totals.succeededEvents === 0
        ? "NOT_ESTABLISHABLE"
        : "NO_ABSORPTION_RECORDED";

  return Object.freeze({
    scheme: ABSORBED_OBSERVATIONS_SCHEME,
    verdict,
    boundaries: Object.freeze(boundaries),
    totals: Object.freeze(totals),
  });
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/**
 * Render the report.
 *
 * COUNTS, OUR OWN CONSTANTS, AND THE BOUNDARY AND AGENT LABELS — NOTHING ELSE. No `sourceRef`, no amount,
 * no currency figure, no payload value, no observation timestamp, no dedupe key and no content digest.
 * This is the codes-only rule from the extract-fault slice applied to a different surface: a diagnostic
 * may name a thing only when the name is OURS. The boundary and agent are the operator's own labels and
 * are the only way the finding can be routed; an account pseudonym is the customer's.
 *
 * A test performs the leak attempt — a row whose `sourceRef` and `sourcePayloadHash` are distinctive — and
 * asserts neither reaches this string, with the forbidden values taken from the row rather than hardcoded.
 */
export function formatAbsorptionReport(report: AbsorptionReport): string {
  const lines: string[] = [];
  lines.push(`absorbed observations · ${report.scheme}`);
  lines.push("");
  lines.push(`VERDICT: ${report.verdict}`);
  lines.push(verdictMeaning(report.verdict));
  lines.push("");

  if (report.boundaries.length === 0) {
    lines.push("No `task.succeeded` event exists in this database, so nothing was examined.");
    lines.push("That is NOT evidence that no absorption occurred anywhere — it is evidence about this");
    lines.push("database only. An empty local database says nothing about a deployed one.");
    return lines.join("\n");
  }

  // THE ANSWER BEFORE THE DETAIL. A first real run of this command printed 67 boundaries and put the
  // three numbers that matter underneath them, which on a real estate means the operator scrolls past the
  // finding to reach the finding. The same reason the grain notice sits ABOVE the figure it qualifies: a
  // qualification read after the number has already been believed is not a qualification.
  lines.push(
    `TOTALS: ${report.totals.succeededEvents} succeeded event(s) over ${report.boundaries.length} ` +
      `boundar${report.boundaries.length === 1 ? "y" : "ies"} · ` +
      `${report.totals.eventsWithAbsorption} with recorded absorption · ` +
      `${report.totals.accountIdentitiesWithDifferingObservations} account identit(ies) that absorbed a ` +
      `DIFFERING observation · ${report.totals.eventsWithoutAdmissionCounts} NOT ESTABLISHABLE`,
  );
  lines.push("");

  // A boundary with a finding, or with an event nobody can read, is printed in full. A boundary where
  // every admitted signal created its own candidate is COLLAPSED TO A COUNT rather than omitted: the
  // count is stated, so nothing is hidden, and the detail is reserved for what an operator must act on.
  const notable = report.boundaries.filter(
    (b) => b.eventsWithAbsorption > 0 || b.eventsWithoutAdmissionCounts > 0,
  );
  const clean = report.boundaries.length - notable.length;

  for (const b of notable) {
    lines.push(`── boundary ${b.boundaryId}  (agents: ${b.agentIds.join(", ")})`);
    lines.push(`     succeeded events                        ${b.succeededEvents}`);
    lines.push(`     …carrying no admission counts           ${b.eventsWithoutAdmissionCounts}   NOT ESTABLISHABLE, not zero`);
    lines.push(`     …that created a candidate               ${b.eventsWithCandidateCreated}`);
    lines.push(`     …that admitted and created NOTHING      ${b.eventsWithAbsorption}   ← recorded absorption`);
    lines.push(`     account identities absorbing            ${b.accountIdentitiesAbsorbing}`);
    lines.push(`     …with DIFFERING observation digests     ${b.accountIdentitiesWithDifferingObservations}`);
    lines.push(`     distinct digests seen on those          ${b.distinctObservationDigests}`);
  }

  if (clean > 0) {
    lines.push(
      `── ${clean} further boundar${clean === 1 ? "y" : "ies"}: every admitted signal created its own ` +
        "candidate, and every event recorded the counts. Nothing to report, and nothing suppressed.",
    );
  }

  lines.push("");
  lines.push("WHAT THIS DOES NOT ESTABLISH. An account identity that absorbed differing observation");
  lines.push("digests absorbed differing OBSERVATIONS. Whether those are two contractual obligations or");
  lines.push("one obligation re-observed after a reschedule, a renewal or a corrected amount cannot be");
  lines.push("established: no column in this database identifies an obligation. A count above zero is a");
  lines.push("case to investigate by hand, never a count of merged obligations.");
  return lines.join("\n");
}

function verdictMeaning(verdict: ExposureVerdict): string {
  if (verdict === "ABSORPTION_RECORDED") {
    return "At least one admitted signal was folded into an existing account-grained candidate.";
  }
  if (verdict === "NO_ABSORPTION_RECORDED") {
    return "Every admitted signal created its own candidate, across every event that recorded the counts.";
  }
  return (
    "Some or all succeeded events carry no admission counts, so absorption could not be established\n" +
    "either way. This is not a clean result and must not be reported as one."
  );
}

// ── READING THE TABLES · still pure, because the query function is INJECTED ───────────────────────
//
// These were in the CLI and had to move, which is a defect worth recording rather than quietly fixing.
// The CLI calls `main()` at module scope — the shape every script in this repository uses — so importing
// `readSucceededRows` from a test RAN THE WHOLE COMMAND, hit `prisma.$disconnect()` and `process.exit()`,
// and the test failed with "Engine is not yet connected". *A command whose claims cannot be imported
// cannot be falsified* was the rule the local-pair readiness slice settled; the half it did not state is
// that an entry point's side effects must not fire on import. Keeping the logic here and the side effects
// there satisfies both without a conditional self-invocation guard, which is the easier and weaker answer.

/** One `task.succeeded` row as the database returns it. Snake case, because that is the column spelling. */
export interface RawSucceededRow {
  readonly boundary_id: string;
  readonly agent_id: string;
  readonly admitted_count: number | null;
  readonly created_count: number | null;
  readonly result: unknown;
}

/**
 * The scan, as one statement.
 *
 * The counts come from the EVENT, because `agent_task_events` is append-only by database trigger and has
 * no purge path, while `agent_tasks` is mutable by design. The signals come from the task row, because
 * that is where the payload lives. The `LEFT JOIN` is deliberate: an event whose task row is gone still
 * proves the event happened, and an inner join would quietly shrink the finding.
 *
 * `metadata->>'admittedCount'` yields SQL NULL when the key is absent, which is exactly the
 * NOT-ESTABLISHABLE state. `COALESCE(…, 0)` here would be the defect this whole module exists to avoid.
 */
export const ABSORBED_OBSERVATIONS_SQL = `SELECT ev.boundary_id,
            ev.agent_id,
            (ev.metadata->>'admittedCount')::int AS admitted_count,
            (ev.metadata->>'createdCount')::int  AS created_count,
            task.result                          AS result
       FROM agent_task_events AS ev
       LEFT JOIN agent_tasks AS task
              ON task.task_id = ev.task_id
             AND task.boundary_id = ev.boundary_id
             AND task.agent_id = ev.agent_id
      WHERE ev.kind = 'task.succeeded'
      ORDER BY ev.event_sequence ASC`;

export async function readSucceededRows(
  query: (sql: string) => Promise<readonly RawSucceededRow[]>,
): Promise<readonly SucceededTaskRow[]> {
  const rows = await query(ABSORBED_OBSERVATIONS_SQL);
  return rows.map((row) => ({
    boundaryId: row.boundary_id,
    agentId: row.agent_id,
    admittedCount: row.admitted_count,
    createdCount: row.created_count,
    signals: signalFacts(row.result),
  }));
}

/**
 * The three facts the grouping needs, and nothing else.
 *
 * Narrowed HERE rather than passed whole, so no other field of a stored `CandidateSignal` — the amount,
 * the currency, the observation timestamp, the detector version — can reach the summary at all. A value
 * that never arrives cannot be printed by accident.
 */
function signalFacts(result: unknown): readonly AbsorbedSignalFacts[] {
  if (!Array.isArray(result)) return [];
  const facts: AbsorbedSignalFacts[] = [];
  for (const entry of result) {
    if (!entry || typeof entry !== "object") continue;
    const signal = entry as Record<string, unknown>;
    if (
      typeof signal.recoveryType !== "string" ||
      typeof signal.sourceRef !== "string" ||
      typeof signal.sourcePayloadHash !== "string"
    ) {
      continue;
    }
    facts.push({
      recoveryType: signal.recoveryType,
      sourceRef: signal.sourceRef,
      sourcePayloadHash: signal.sourcePayloadHash,
    });
  }
  return facts;
}

/**
 * The whole command as an importable function: verdict, rendered output and exit code.
 *
 * 0 only for a clean, ESTABLISHED result. 1 is a positive finding. 2 is "could not tell", which an empty
 * database returns — because reporting success having examined nothing is the one outcome that would make
 * this diagnostic worse than not existing.
 */
export async function runAbsorbedObservations(
  query: (sql: string) => Promise<readonly RawSucceededRow[]>,
): Promise<{ readonly exitCode: number; readonly output: string; readonly report: AbsorptionReport }> {
  const report = summariseAbsorption(await readSucceededRows(query));
  const exitCode =
    report.verdict === "NO_ABSORPTION_RECORDED" ? 0 : report.verdict === "ABSORPTION_RECORDED" ? 1 : 2;
  return { exitCode, output: formatAbsorptionReport(report), report };
}
