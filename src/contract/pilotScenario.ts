// TRACK 2 · THE NARROW FINANCIAL PILOT, DECLARED AS CRITERIA THAT CAN BE FAILED.
//
// WHY THIS SHAPE. "Run a pilot" is not a criterion and neither is "it works". Every acceptance
// condition here is either BOUND TO A TEST that exists in this repository, or marked as BLOCKED with
// the owner of the blocker named. A criterion that no test can fail is a hope, and a criterion whose
// blocker has no owner never moves.
//
// SO THE SCENARIO IS DELIBERATELY NARROW: one boundary, one Recovery Case, one corrective invoice, one
// arrival of money from one registered institution. Everything that would make the pilot broader —
// several institutions, partial settlements summed across sources, FX, a second detector family — is
// listed as OUT OF SCOPE with the reason, because an unstated exclusion reads as a promise.
//
// AND IT CANNOT PRODUCE REVENUE RETURNED ON ITS OWN. The last criterion is the honest one: a GREEN
// pilot establishes that NH's settlement path behaves correctly on a real institution's attestation.
// It does not establish that the institution's authority was independently verified — that is K5's
// ladder, whose top rung is unreachable today — and every pilot figure stays PROVISIONAL until it is.

/** Version of this scenario definition. A change to the criteria is a NEW id. */
export const PILOT_SCENARIO_VERSION = "fin-pilot-2026.1";

export type CriterionStatus =
  /** A test in this repository decides it, named in `evidence`. */
  | "BOUND_TO_TEST"
  /** It cannot be decided here: the blocker is named and so is its owner. */
  | "BLOCKED"
  /** It is decided by a person reading something, not by code. Named so it is never mistaken for the above. */
  | "MANUAL_REVIEW";

export interface PilotCriterion {
  readonly id: string;
  /** What must be true. Written so a failure is recognisable. */
  readonly criterion: string;
  readonly status: CriterionStatus;
  /** `BOUND_TO_TEST`: files whose tests decide it. Each is asserted to exist on disk. */
  readonly evidence: readonly string[];
  /**
   * Refusal codes whose behaviour this criterion rests on.
   *
   * WHY THIS EXISTS: AN EXISTENCE CHECK IS NOT A RELEVANCE CHECK. The first form of this scenario
   * cited `externalSettlementGate.test.ts` for the value-date and finality criteria; the file exists,
   * so the citation passed, and those codes are in fact exercised in `externalSettlement.test.ts`
   * one layer down. Every code named here is asserted to appear in a cited file, so a citation can no
   * longer be merely plausible.
   */
  readonly decidedBy: readonly string[];
  /** `BLOCKED`: what stands in the way, and who owns clearing it. Empty otherwise. */
  readonly blocker: string;
  readonly blockerOwnedBy: string;
}

export const PILOT_CRITERIA: readonly PilotCriterion[] = Object.freeze([
  // ── A · the money is real, and arrived after the fix ──────────────────────────────────────────
  Object.freeze({
    id: "A1",
    criterion:
      "A settlement attestation signed by the registered institution, naming the case's corrective " +
      "invoice and the payer billing signed for, carries one Recovery Case to PROVEN.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/externalSettlementGate.test.ts",
    ]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "A2",
    criterion:
      "Money that cleared BEFORE the correction was raised is refused, however well it matches on " +
      "every other field — it cannot be the correction's result.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze(["src/domain/externalSettlement.test.ts"]),
    decidedBy: Object.freeze(["SETTLEMENT_PRECEDES_CORRECTION", "SETTLEMENT_VALUE_DATE_IN_FUTURE"]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "A3",
    criterion:
      "A pre-settlement or reversed state produces no proof. An intention to pay and a payment that " +
      "came back are both refused.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze(["src/domain/externalSettlement.test.ts"]),
    decidedBy: Object.freeze(["SETTLEMENT_NOT_FINAL", "SETTLEMENT_REVERSED"]),
    blocker: "",
    blockerOwnedBy: "",
  }),

  // ── B · the signature, and what it does not establish ─────────────────────────────────────────
  Object.freeze({
    id: "B1",
    criterion:
      "A forged signature, an unregistered key, and a key revoked as compromised each refuse and " +
      "consume nothing — the revoked case holding even while the environment still lists the key.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/settlementVerification.test.ts",
      "server/services/registerBackedSettlementVerification.test.ts",
    ]),
    // `SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED` is deliberately NOT cited here — see
    // `UNREACHABLE_BY_CONSTRUCTION` below. The criterion rests on revocation, which is tested.
    decidedBy: Object.freeze(["SETTLEMENT_KEY_REVOKED_COMPROMISED"]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "B2",
    criterion:
      "No path reaches AUTHORITY_VERIFIED on a valid signature alone. Signature verification " +
      "establishes control of a registered key; the institution's authority is a separate ladder " +
      "whose cryptographic condition is exactly one of its conditions.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "src/contract/institutionAuthority.test.ts",
      "src/contract/sourceFactAuthority.ts",
      // The register that enforces the ladder's non-cryptographic conditions, including the one the
      // server derives rather than accepts: a verifier may not be the proposer.
      "server/services/institutionGovernance.test.ts",
      "server/persistence/institutionRegister.postgres.test.ts",
    ]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),

  // ── C · the payer, which is the pilot's real dependency ───────────────────────────────────────
  Object.freeze({
    id: "C1",
    criterion:
      "A bank naming a DIFFERENT payer from the one billing signed for is refused, and two attested " +
      "payers that disagree establish nothing — NH does not pick one.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/attestedPayerReference.test.ts",
    ]),
    decidedBy: Object.freeze(["SETTLEMENT_PAYER_MISMATCH", "SETTLEMENT_CASE_PAYER_NOT_RECORDED"]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "C2",
    criterion:
      "The pilot's billing export and its bank remittance quote the SAME payer identifier, so the " +
      "comparison can succeed on real data at all.",
    status: "BLOCKED" as const,
    evidence: Object.freeze([]),
    decidedBy: Object.freeze([]),
    blocker:
      "Two institutions must choose one identifier. NH can compare them and cannot make them agree; " +
      "a mapping table maintained by the beneficiary is refused, and so is matching on amount, date " +
      "or name resemblance. Until it is agreed every cited settlement is refused.",
    blockerOwnedBy: "the customer's finance owner, with their bank or PSP",
  }),

  // ── D · one arrival of money counted once ─────────────────────────────────────────────────────
  Object.freeze({
    id: "D1",
    criterion:
      "The same arrival cannot substantiate two proofs: the gate's read refuses it, and the claim " +
      "refuses it atomically if two approvals race.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/settlementClaim.postgres.test.ts",
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/externalSettlementGate.test.ts",
    ]),
    // TWO CODES BECAUSE THERE ARE TWO MECHANISMS, and the criterion rests on both: the gate's READ
    // refuses an arrival already substantiating a proof, and the CLAIM refuses it atomically when two
    // approvals race past the read. A single code would hide which half was exercised.
    decidedBy: Object.freeze(["SETTLEMENT_ALREADY_SUBSTANTIATED", "SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM"]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "D2",
    criterion:
      "A replayed attestation is refused under its own code, distinct from the money already being " +
      "counted — the attestation and the arrival are different facts.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/settlementClaim.postgres.test.ts",
      "server/services/externalSettlementGate.test.ts",
    ]),
    decidedBy: Object.freeze(["SETTLEMENT_ATTESTATION_REPLAYED"]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "D3",
    criterion:
      "A failure anywhere after the claim releases the arrival, so a refused approval burns no money " +
      "— which only holds because the claim shares the proof's transaction.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/settlementClaim.postgres.test.ts",
      "server/services/proofServiceSettlement.postgres.test.ts",
    ]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),

  // ── E · separation, permissions and tenancy ───────────────────────────────────────────────────
  Object.freeze({
    id: "E1",
    criterion:
      "The approver is never the author, a role that may not approve never reaches the settlement " +
      "path at all, and an attestation for another boundary cannot support this case.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/externalSettlementGate.test.ts",
    ]),
    decidedBy: Object.freeze(["SETTLEMENT_TENANT_MISMATCH"]),
    blocker: "",
    blockerOwnedBy: "",
  }),

  // ── F · what the pilot must not leak or claim ─────────────────────────────────────────────────
  Object.freeze({
    id: "F1",
    criterion:
      "The ledger holds no confirmable payment identifier: the stored digest is a keyed pseudonym " +
      "under a server-held key, and a refusal never echoes an external reference or an amount.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "server/services/proofServiceSettlement.postgres.test.ts",
      "server/services/externalSettlementGate.test.ts",
    ]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "F2",
    criterion:
      "A key found compromised can be answered for: every arrival resting on it is placed inside or " +
      "outside the exposure window, and an arrival whose signing instant was never recorded is " +
      "counted as unplaceable rather than read as unaffected.",
    status: "BOUND_TO_TEST" as const,
    evidence: Object.freeze([
      "src/contract/settlementCompromiseReport.test.ts",
      "server/persistence/settlementLedger.postgres.test.ts",
      "server/services/settlementCompromiseRead.test.ts",
    ]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),
  Object.freeze({
    id: "F3",
    criterion:
      "The institution supplying the attestation has been verified independently of its own " +
      "signature: legal entity, regulatory standing, authorised signatories, an out-of-band key " +
      "fingerprint, a recorded ceremony and a second person's approval.",
    status: "BLOCKED" as const,
    evidence: Object.freeze([]),
    decidedBy: Object.freeze([]),
    blocker:
      "THE MECHANISM EXISTS AND THE EVIDENCE DOES NOT, and those are different blockers. The " +
      "governed institution register enforces propose-not-verify by database trigger, resolves key " +
      "control against the key register, and refuses a bare tick by making a blank citation " +
      "unwritable — so SIX of the eight conditions are now a matter of gathering out-of-band " +
      "evidence rather than of building anything. The two NH establishes itself are done. But no " +
      "institution is registered, no provenance channel reaching AUTHORITY_VERIFIED is implemented, " +
      "and until a real counterparty supplies a registry extract, a regulator entry, a signatory " +
      "schedule, a published channel, an out-of-band fingerprint and a recorded ceremony, a pilot " +
      "figure stays PROVISIONAL at a SOURCE_ATTESTED ceiling however many tests are green.",
    blockerOwnedBy: "the owner — it needs a real institution and a decision to onboard one",
  }),
  Object.freeze({
    id: "F4",
    criterion:
      "The pilot's own reading of the result states what it does NOT establish: that no observed " +
      "amount became Revenue Returned on the strength of synthetic evidence, and that a green run " +
      "is a statement about NH's behaviour rather than about the institution.",
    status: "MANUAL_REVIEW" as const,
    evidence: Object.freeze([]),
    decidedBy: Object.freeze([]),
    blocker: "",
    blockerOwnedBy: "",
  }),
]);

/**
 * OUT OF SCOPE, with reasons. An unstated exclusion reads as a promise.
 */
export const PILOT_OUT_OF_SCOPE: readonly { readonly item: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      item: "Settlements summed across more than one institution",
      why:
        "The gate refuses it by name. Two institutions' attestations are two statements about two " +
        "arrivals, and adding them asserts a relationship neither of them makes.",
    }),
    Object.freeze({
      item: "A settlement in a currency other than the proof's",
      why: "NH holds no rate, and a governed FX rate is a separate source fact nobody has supplied.",
    }),
    Object.freeze({
      item: "Partial settlement scaling a proof down to whatever arrived",
      why:
        "The claim is the claim. A settled total short of it is refused rather than quietly " +
        "re-stated as a smaller recovery.",
    }),
    Object.freeze({
      item: "Any detector family other than the one that opened the case",
      why: "The pilot measures the settlement path, not detection reach. One case, one correction.",
    }),
    Object.freeze({
      item: "Production migration, and the settlement digest key in production",
      why:
        "Both are named in the production requirements and neither is executed. The migration design " +
        "lives in scripts/migration-design/ and has been applied to disposable databases only.",
    }),
  ]);

/**
 * REFUSALS THAT EXIST, ARE CORRECT, AND NO TEST EXERCISES — because nothing can reach them.
 *
 * FOUND BY THIS SCENARIO'S OWN RELEVANCE CHECK, which is the only reason it is written down. A
 * criterion cited `SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED`; the check asked which test exercises it
 * and the answer was none, anywhere in the repository.
 *
 * THE CODE IS NOT THE DEFECT. `verifySettlementAgainstRegister` requires the key to have been ACTIVE
 * at the signing instant before it looks at the key's state now, and the lifecycle's transitions run
 * DRAFT → ACTIVE → RETIRED or REVOKED_COMPROMISED with no path back, so a key that was ACTIVE then
 * cannot read DRAFT now. The refusal is defence in depth against a reordering of those two steps,
 * and the module says so itself: *a decision that depends on an upstream guard having run is a
 * decision that breaks silently when the order changes.*
 *
 * SO IT IS RECORDED RATHER THAN TESTED. Writing a test that reached it would mean constructing a
 * lifecycle log the transitions forbid — the test would assert the guard fires in a state the system
 * cannot be in, which proves nothing about the pilot and would make a structurally unreachable branch
 * look like a covered one. The honest statement is that the branch is unreachable, that this is why
 * no test names it, and that the day the step order changes it stops being unreachable.
 */
export const UNREACHABLE_BY_CONSTRUCTION: readonly { readonly code: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      code: "SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED",
      why:
        "it fires only for a DRAFT key, and the signing-instant check that runs first requires the key " +
        "to have been ACTIVE then; no lifecycle transition returns a key to DRAFT. Defence in depth " +
        "against a reordering, not a reachable refusal.",
    }),
  ]);

/** Criteria a pilot run can actually decide. */
export function decidableCriteria(): readonly PilotCriterion[] {
  return Object.freeze(PILOT_CRITERIA.filter((c) => c.status === "BOUND_TO_TEST"));
}

/** Criteria that block a GREEN pilot from meaning more than it does. */
export function blockedCriteria(): readonly PilotCriterion[] {
  return Object.freeze(PILOT_CRITERIA.filter((c) => c.status === "BLOCKED"));
}

/**
 * THE VERDICT RULE, written before any run.
 *
 * A pilot in which every bound criterion passes is `BEHAVIOUR_CONFIRMED`, never `VERIFIED` and never
 * `ACCEPTED`: the blocked criteria are precisely the ones that would license a stronger word, and a
 * run cannot clear them by passing.
 */
export const PILOT_VERDICT_RULE = Object.freeze({
  allBoundCriteriaPass: "BEHAVIOUR_CONFIRMED · PROVISIONAL" as const,
  anyBoundCriterionFails: "REFUSED · the named criterion is the finding" as const,
  whyNotVerified:
    "Authority verification and the shared payer identifier are both outside this repository. No " +
    "number of passing tests moves either, so no run may report VERIFIED or ACCEPTED.",
  blockedCriteriaAreNotWaivable: true as const,
});
