// THE GRAIN EXPERIMENT.
//
// `ExpectationRow` carries `entitlementRef` and nothing else as identity. A realistic export cannot
// reach the reconciliation core without first collapsing its source-native identifiers into that one
// field — so THE ADAPTER IS THE D2 DECISION, not plumbing around it. This module makes the collapse an
// explicit, named, swappable choice so each candidate can be measured against the same ground truth
// through the same unmodified `reconcile()`.
//
// NOTHING HERE READS THE GROUND TRUTH. The answer key lives beside the exports and only the scorer
// reads it; `scripts/reconciliation-synthetic/verify.mjs` asserts that over the whole product tree.
//
// A CANDIDATE MAY BE NOT CONSTRUCTIBLE, and that is a result rather than a gap in this file. A join key
// has to exist on BOTH sides. Two of the obvious grains — contract identity and schedule-line identity
// — are emitted only by the contract system, so no amount of adapter code can build them from a
// billing export that never mentions them. Reporting that honestly is more useful than synthesising a
// key and calling the reconciliation a success.
import type { ExpectationRow, ObservationRow } from "./reconciliationScenarios";

/** A row of the contract-system export, as text, exactly as the CSV holds it. */
export type RawExpectation = Readonly<Record<string, string>>;
/** A row of the billing export, as text. */
export type RawObservation = Readonly<Record<string, string>>;

export type GrainCandidateId =
  | "A_SUBSCRIPTION"
  | "B_CONTRACT"
  | "C_SCHEDULE_LINE"
  | "D_PAYER_PERIOD"
  | "E_SUBSCRIPTION_WITH_LEGACY_ALIAS";

export interface GrainCandidate {
  readonly id: GrainCandidateId;
  readonly describes: string;
  /**
   * Why it cannot be built from these two exports, or null when it can. A candidate that names a column
   * one side never emits is refused HERE rather than quietly degraded into a different grain.
   */
  readonly notConstructible: string | null;
  /** The identity each side is keyed by, named so the report can state what was actually compared. */
  readonly expectationKey: string;
  readonly observationKey: string;
  readonly adapt: (e: readonly RawExpectation[], o: readonly RawObservation[]) => {
    readonly expectations: readonly ExpectationRow[];
    readonly observations: readonly ObservationRow[];
    /** Aliases the candidate claims are AUTHORITATIVE, passed to the core as governed terms. */
    readonly aliases: Readonly<Record<string, string>>;
  };
}

const minor = (decimal: string): number | null => {
  const t = decimal.trim();
  if (t === "") return null; // UNKNOWN. Never 0 — the whole point of the blank.
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = `${m[2]}${(m[3] ?? "").padEnd(2, "0")}`;
  const n = Number(cents);
  return m[1] === "-" ? -n : n;
};

const blankToNull = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** The non-identity facts are the same whatever the grain; only the key changes between candidates. */
function expectationWith(r: RawExpectation, entitlementRef: string, customerRef: string): ExpectationRow {
  return Object.freeze({
    entitlementRef,
    customerRef,
    periodStart: r.period_start ?? "",
    periodEnd: r.period_end ?? "",
    expectedAmountMinor: minor(r.expected_amount ?? ""),
    currency: (r.currency ?? "").toUpperCase(),
    terminatedAt: blankToNull(r.terminated_at),
    pauseStart: blankToNull(r.pause_start),
    pauseEnd: blankToNull(r.pause_end),
    amendedAt: blankToNull(r.amended_at),
    // The contract system's supersession points at a SCHEDULE LINE. Under a candidate whose identity is
    // not the schedule line, that reference cannot be resolved, and the core's supersession check keys
    // on the same field it compares — so it is carried as-is and the candidate's result shows the cost.
    supersedesRef: blankToNull(r.supersedes_schedule_line_id),
    scheduleLineRef: blankToNull(r.schedule_line_id),
  });
}

function observationWith(r: RawObservation, entitlementRef: string, customerRef: string): ObservationRow {
  return Object.freeze({
    invoiceRef: r.invoice_id ?? "",
    entitlementRef,
    customerRef,
    periodStart: r.period_start ?? "",
    periodEnd: r.period_end ?? "",
    billedAmountMinor: minor(r.billed_amount ?? "") ?? 0,
    currency: (r.currency ?? "").toUpperCase(),
    isCredit: (r.is_credit ?? "").trim().toLowerCase() === "true",
  });
}

/** Same frozen-spec helper the contract modules use, and here it also supplies contextual typing. */
function candidate(spec: GrainCandidate): GrainCandidate {
  return Object.freeze(spec);
}

export const GRAIN_CANDIDATES: readonly GrainCandidate[] = Object.freeze([
  candidate({
    id: "A_SUBSCRIPTION",
    describes:
      "The implicit assumption today: the contract's entitlement id is the billing subscription id, because billing was provisioned from the contract.",
    notConstructible: null,
    expectationKey: "entitlement_id",
    observationKey: "subscription_id",
    adapt: (e, o) => ({
      expectations: e.map((r) => expectationWith(r, r.entitlement_id ?? "", r.payer_account_id ?? "")),
      observations: o.map((r) => observationWith(r, r.subscription_id ?? "", r.payer_account_id ?? "")),
      aliases: {},
    }),
  }),
  candidate({
    id: "B_CONTRACT",
    describes: "Contract identity plus period — coarse enough to absorb split and consolidated billing.",
    notConstructible:
      "The billing export emits no contract identity. `contract_id` appears only on the contract side, so this grain cannot be built from these two files by any adapter: a join key must exist on BOTH sides. Deriving one would be inventing identity.",
    expectationKey: "contract_id",
    observationKey: "(absent)",
    adapt: () => ({ expectations: [], observations: [], aliases: {} }),
  }),
  candidate({
    id: "C_SCHEDULE_LINE",
    describes: "Per-obligation identity — the finest grain, and the only one an event check could use.",
    notConstructible:
      "The billing export emits no schedule-line identity. `invoice_line_id` is a position WITHIN an invoice ('L1', 'L2'), not a reference to the obligation it settles, so it cannot be joined to `schedule_line_id`. This is the missing fact, not a missing adapter.",
    expectationKey: "schedule_line_id",
    observationKey: "(absent)",
    adapt: () => ({ expectations: [], observations: [], aliases: {} }),
  }),
  candidate({
    id: "D_PAYER_PERIOD",
    describes:
      "The coarsest MONEY grain both systems agree on: who is billed, in which period. Uses no subscription key at all, so re-keying and migration cannot touch it.",
    notConstructible: null,
    expectationKey: "payer_account_id",
    observationKey: "payer_account_id",
    adapt: (e, o) => ({
      // Identity IS the payer, so every obligation of one payer in one period becomes one unit and the
      // amounts sum. That is what makes it survive re-keying — and what makes it blind to which
      // entitlement was wrong.
      expectations: e.map((r) => expectationWith(r, r.payer_account_id ?? "", r.payer_account_id ?? "")),
      observations: o.map((r) => observationWith(r, r.payer_account_id ?? "", r.payer_account_id ?? "")),
      aliases: {},
    }),
  }),
  candidate({
    id: "E_SUBSCRIPTION_WITH_LEGACY_ALIAS",
    describes:
      "Candidate A plus the migration's retained legacy key, declared as an AUTHORITATIVE alias — the source stating the mapping rather than NH guessing it.",
    notConstructible: null,
    expectationKey: "entitlement_id",
    observationKey: "subscription_id, aliased by legacy_subscription_id",
    adapt: (e, o) => {
      // The alias is read from the SOURCE's own retained field. It is authoritative because billing
      // stamped it during its own migration; NH derives nothing. Where no legacy key was retained — a
      // bare re-key — there is no alias and the core refuses, which is the honest answer.
      const aliases: Record<string, string> = {};
      for (const r of o) {
        const legacy = (r.legacy_subscription_id ?? "").trim();
        const current = (r.subscription_id ?? "").trim();
        if (legacy !== "" && current !== "") aliases[current] = legacy;
      }
      return {
        expectations: e.map((r) => expectationWith(r, r.entitlement_id ?? "", r.payer_account_id ?? "")),
        observations: o.map((r) => observationWith(r, r.subscription_id ?? "", r.payer_account_id ?? "")),
        aliases: Object.freeze(aliases),
      };
    },
  }),
]);

export const constructibleCandidates = (): readonly GrainCandidate[] =>
  GRAIN_CANDIDATES.filter((c) => c.notConstructible === null);
