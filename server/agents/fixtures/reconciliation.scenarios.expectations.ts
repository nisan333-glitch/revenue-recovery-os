// PRE-REGISTERED EXPECTATIONS · SYNTHETIC · written and hashed BEFORE the first run of these scenarios.
//
// WHY THIS FILE IS SEPARATE FROM THE DATA AND FROM THE TESTS. The repository's freeze control already
// establishes that the ruler is part of the experiment: scenarios, amounts, expected outcomes and the
// scorer are frozen before the first detection run, and a defect found afterwards is fixed in the
// PRODUCT and re-run against the same package. This file is that ruler for the five new scenario
// families. It is hashed into a tracked lock before any run, so an expectation cannot be adjusted to
// match a result that has already been seen.
//
// ── THE THREE FIELDS, AND WHY THEY MAY NEVER BE COLLAPSED ───────────────────────────────────────────
//
// An earlier draft of this work wrote ONE expectation per scenario, derived from what the code does
// today. That is the error this project has now recorded twice: documented behaviour is not required
// behaviour, and the code proves what is implemented while an approved requirement states what ought to
// be. So every scenario carries three separate statements:
//
//   currentBehaviour  — measured, with file:line evidence. Never a prediction.
//   requiredOutcome   — the business outcome. NEVER derived from currentBehaviour. Where no approved
//                       requirement states it, `basis.kind` is NOT_ESTABLISHED and the silence is
//                       itself the finding — not a licence to promote current behaviour into the rule.
//   knownGap          — null ONLY where required and current coincide. Otherwise the named divergence.
//
// A scenario whose run matches `currentBehaviour` while `knownGap` is non-null is a PASS of the
// instrument and a FAIL of the product. Those two verdicts are reported separately.
//
// ── ZERO IS NOT AN ANSWER ───────────────────────────────────────────────────────────────────────────
//
// BLOCKED, UNSUPPORTED and UNKNOWN are each distinct from ZERO and from one another, for the reason this
// repository has applied to `coverage.event`, `NOT_ESTABLISHABLE` and "not computed is not zero": a
// figure of 0 asserts that a population was examined and found clean. Collapsing any of the three into
// 0 would claim work nobody did.
//
// SYNTHETIC THROUGHOUT. No identifier, payer or amount here describes a real customer, and nothing in
// this file turns any observed amount into proven Revenue Returned.

/** Where a required business outcome comes from. The second form is a finding, not a default. */
export type RequirementBasis =
  | {
      readonly kind: "APPROVED";
      /** Document and section that states the requirement. Quoted, never paraphrased into existence. */
      readonly source: string;
    }
  | {
      readonly kind: "NOT_ESTABLISHED";
      /** What was searched, so the absence is checkable rather than asserted. */
      readonly searched: readonly string[];
      readonly detail: string;
    };

/** Distinct from one another and from a zero figure. */
export type OutcomeClass = "DETECTED" | "ZERO" | "BLOCKED" | "UNSUPPORTED" | "UNKNOWN";

export interface ScenarioExpectation {
  readonly id: string;
  readonly title: string;
  readonly currentBehaviour: {
    readonly statement: string;
    /** `path:line` anchors. Read at the recorded SHA, not remembered. */
    readonly evidence: readonly string[];
  };
  readonly requiredOutcome: {
    readonly statement: string;
    readonly basis: RequirementBasis;
  };
  readonly knownGap: string | null;
  /** What the RUN must show. Written before the run; a run that shows otherwise is a finding. */
  readonly acceptance: readonly string[];
  readonly expectedClass: OutcomeClass;
}

const PROOF_MODEL_SEARCH: readonly string[] = Object.freeze([
  "docs/PROOF_MODEL.md (199 lines) — grep -niE 'grain|account|obligation-level|attribut' returns 0 hits",
  "docs/STRATEGY.md, CLAUDE.md — state the two-ledger rule and the Trust Invariant; neither states the",
  "  GRAIN at which a proven figure may be asserted",
]);

export const SCENARIOS: readonly ScenarioExpectation[] = Object.freeze([
  // ── DUPLICATION, SPLIT FOUR WAYS ──────────────────────────────────────────────────────────────────
  // One scenario cannot carry these: "the same thing twice" and "two different things that look the
  // same to the key" have OPPOSITE required outcomes. Suppressing the first is correct; suppressing the
  // second loses a real obligation.
  Object.freeze({
    id: "S-DUP-1",
    title: "the identical observation is submitted twice",
    currentBehaviour: Object.freeze({
      statement:
        "The second submission resolves to the same dedupe key and is absorbed: no second candidate, " +
        "no second case, the figure unchanged.",
      evidence: Object.freeze([
        "server/agents/caseAdmission.ts:78 — digest([boundaryId, recoveryType, sourceRef])",
        "server/agents/caseAdmission.ts:70-72 — byDedupeKey lookup returns the existing candidate",
        "prisma/schema.prisma:195 — dedupeKey String @unique",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement: "No additional case and no double count.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source:
          "CLAUDE.md Trust Invariant rule 10 and the two-ledger rule: a dollar may be counted once. " +
          "src/domain/proof.ts:175 encodes it for the proof chain.",
      }),
    }),
    knownGap: null,
    acceptance: Object.freeze([
      "exactly one agent_case_candidates row for the pair",
      "the second run reports created=false and admitted>=1",
      "observed exposure after the second run equals the figure after the first",
      "no partial write: no orphan candidate, no case without a candidate",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  Object.freeze({
    id: "S-DUP-2",
    title: "two DIFFERENT obligations of one account, in the SAME run",
    currentBehaviour: Object.freeze({
      statement:
        "Both units are reconciled individually and their positive residuals are SUMMED into the " +
        "account's single candidate. The money is preserved; which obligation contributed is not " +
        "recoverable from the candidate.",
      evidence: Object.freeze([
        "server/agents/reconciliationObserver.ts:41-43 — 'the POSITIVE residuals of one payer's units " +
          "are summed into that payer's single candidate'",
        "server/agents/reconciliationObserver.ts:341 — sourceRef is accountSourceRef(...accountRef)",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "Neither obligation's amount is silently lost, AND the record either distinguishes the two or " +
        "states that it cannot.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source:
          "CLAUDE.md north star — 'every recovered dollar must be explainable' — and the 2026-10-22 " +
          "obligation-merge decision: three states stay distinguishable and absence renders NOT_STATED.",
      }),
    }),
    knownGap:
      "The money half is met; the attribution half is met only as a DISCLOSURE. deriveCaseIdentityGrain " +
      "states the key cannot distinguish obligations, which satisfies 'states that it cannot' and does " +
      "not satisfy explainability per dollar.",
    acceptance: Object.freeze([
      "one candidate whose residual equals the SUM of both shortfalls — no silent loss",
      "the identity-grain disclosure present and saying the key cannot distinguish obligations",
      "no figure anywhere claims per-obligation attribution",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  Object.freeze({
    id: "S-DUP-3",
    title: "two DIFFERENT obligations of one account, in DIFFERENT runs",
    currentBehaviour: Object.freeze({
      statement:
        "The later run's shortfall is absorbed by the existing candidate and ITS MONEY REACHES NO " +
        "FIGURE. The module states this in its own header; it is not inferred.",
      evidence: Object.freeze([
        "server/agents/reconciliationObserver.ts:44-46 — 'a LATER run that finds a new shortfall for " +
          "the same payer is absorbed by the first candidate and its money reaches no figure'",
        "server/agents/reconciliationObserver.ts:48-50 — 'FIRST OBSERVATION WINS'",
        "server/agents/caseAdmission.ts:70-72 — the store returns the existing candidate unchanged",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "The second obligation's amount must not be silently lost. Either it is treated, or the " +
        "decision is BLOCKED and the untreated amount is reported as such.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source:
          "CLAUDE.md — 'Excluded Recovery is MANDATORY and cannot silently default to zero' (Trust " +
          "Invariant rule 7). An absorbed shortfall that reaches no figure is excluded recovery that " +
          "is neither reported nor excluded.",
      }),
    }),
    knownGap:
      "REQUIRED OUTCOME NOT MET. A valid amount disappears from treatment and from every reported " +
      "figure. The event metadata records THAT an observation was absorbed and carries NO AMOUNT, so " +
      "the untreated money is not even quantifiable from the record.",
    acceptance: Object.freeze([
      "run 1 then run 2 with a different obligation for the same payer",
      "measure: candidate count, candidate residual, observed exposure after each run",
      "assert the loss is REAL and MEASURED here rather than assumed — record the exact amount lost",
      "assert the absorption IS recorded (admittedCount>=1, createdCount=0) — recorded is not treated",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  Object.freeze({
    id: "S-DUP-4",
    title: "a later observation CORRECTS the amount of an earlier one",
    currentBehaviour: Object.freeze({
      statement:
        "FIRST OBSERVATION WINS: the store keeps the first amount and the corrected figure is absorbed " +
        "without changing the candidate.",
      evidence: Object.freeze([
        "server/agents/reconciliationObserver.ts:48-50",
        "server/agents/caseAdmission.ts:70-72",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "A correction is recorded and handled under an approved rule — not swallowed merely because it " +
        "arrived second.",
      basis: Object.freeze({
        kind: "NOT_ESTABLISHED" as const,
        searched: PROOF_MODEL_SEARCH,
        detail:
          "No approved requirement states how a corrected OBSERVATION (pre-candidate) is handled. The " +
          "approved rule for a corrected PROOF exists and is the opposite of absorption: a revision " +
          "creates a new LINKED proof record and never overwrites (Trust Invariant rule 9). Whether " +
          "that rule reaches the observation layer is undecided — and two layers sharing a proposition " +
          "may need opposite mechanics, which this repository has already recorded for NH-EX-2016.",
      }),
    }),
    knownGap:
      "No approved rule exists at this layer, so 'first wins' is an unreviewed default rather than a " +
      "decision. Direction of harm is stated: if the correction is UPWARD the under-reported amount is " +
      "lost; if DOWNWARD the candidate overstates exposure.",
    acceptance: Object.freeze([
      "run with amount A, then the same unit with corrected amount B (test both B>A and B<A)",
      "measure which figure survives and whether the correction is recorded at all",
      "report as a GOVERNANCE GAP, not as a product defect to patch in this slice",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  // ── THE REMAINING FOUR FAMILIES ───────────────────────────────────────────────────────────────────
  Object.freeze({
    id: "S-CHG-1",
    title: "the contract changes mid-period (amendment supersedes a live line)",
    currentBehaviour: Object.freeze({
      statement: "MEASURED IN THE RUN — not predicted here.",
      evidence: Object.freeze([
        "src/contract/expectationExtract.ts — supersedes_ref / amended_at are declared source facts",
        "NH-EX-2016 refuses two unsuperseded live lines in one unit (ambiguous additive obligation)",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "The superseded line must not be added to its successor. Where supersession is not stated, the " +
        "unit is REFUSED with a null residual rather than summed or arbitrated.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source:
          "CLAUDE.md ambiguous-live-lines decision (2026-10-05): 'Addition is permitted only where the " +
          "source establishes that the lines are DISTINCT ADDITIVE OBLIGATIONS.'",
      }),
    }),
    knownGap: null,
    acceptance: Object.freeze([
      "a properly superseded amendment yields ONE obligation at the new amount",
      "an unlinked amendment yields REFUSED_AMBIGUOUS_LIVE_LINES with a null residual",
      "the refusal is NOT reported as zero exposure, and observedMinor is retained",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  Object.freeze({
    id: "S-ID-1",
    title: "unverified identity — a billing line whose obligation_ref resolves to nothing",
    currentBehaviour: Object.freeze({
      statement: "MEASURED IN THE RUN — not predicted here.",
      evidence: Object.freeze([
        "CLAUDE.md readiness decision: 'A dangling reference is a PER-UNIT condition — counted, " +
          "carrying its interpretation, gating nothing at dataset level.'",
        "src/contract/leakInstanceIdentity.ts:53 — OBLIGATION_IDENTITY_FIELDS is frozen empty",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "A dangling reference must not drop the dataset to zero and must not be read as 'nothing was " +
        "owed'. It is counted per unit and reported.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source: "CLAUDE.md — the per-unit dangling-reference rule, and 'capability gating per detector, never global dataset rejection'.",
      }),
    }),
    knownGap: null,
    acceptance: Object.freeze([
      "the dangling unit is counted and named, not silently dropped",
      "other units in the same dataset still produce their candidates",
      "the outcome class is UNKNOWN or BLOCKED for that unit — never ZERO",
    ]),
    expectedClass: "UNKNOWN" as const,
  }),

  Object.freeze({
    id: "S-CRD-1",
    title: "a credit / reversal issued AFTER a correction — as sequential stages",
    currentBehaviour: Object.freeze({
      statement: "MEASURED IN THE RUN — not predicted here.",
      evidence: Object.freeze([
        "src/contract/billingExtract.ts — is_credit is a declared fact; credits are excluded from billed money",
        "src/domain/proof.ts:156 — a chain folds to exactly one record, so an original and its reversal never both count",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "A reversal after an approved correction must create a NEW LINKED proof revision and must never " +
        "overwrite the original. The ledger must not count both.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source: "CLAUDE.md Trust Invariant rule 9, and rule 5 (historical proof immutable and reproducible).",
      }),
    }),
    knownGap: null,
    acceptance: Object.freeze([
      "SEQUENTIAL, not two static rows in one input: stage 1 correction, stage 2 credit, measured after each",
      "after stage 2 the chain folds to one effective record; the original is byte-identical",
      "the reversed amount is not counted as returned, and is not silently zeroed either",
    ]),
    expectedClass: "DETECTED" as const,
  }),

  Object.freeze({
    id: "S-PAY-1",
    title: "an unrelated payment lands on the account during the period",
    currentBehaviour: Object.freeze({
      statement: "MEASURED IN THE RUN — not predicted here.",
      evidence: Object.freeze([
        "server/agents/reconciliationObserver.ts:227 — an UNDER_BILLED unit is withheld where the money may already have been paid",
        "CLAUDE.md taint-scope decision: doubt reaches a residual only where authoritative facts make SETTLEMENT possible (same payer, period or governed window, governed currency — conjunctive)",
      ]),
    }),
    requiredOutcome: Object.freeze({
      statement:
        "An unrelated payment must not be credited against an unrelated obligation. Where settlement is " +
        "possible the residual is HELD pending attribution; where it is not, the candidate stands.",
      basis: Object.freeze({
        kind: "APPROVED" as const,
        source:
          "CLAUDE.md taint-scope decision (2026-10-06) and 'amount similarity, date proximity alone and " +
          "any name resemblance are excluded'.",
      }),
    }),
    knownGap: null,
    acceptance: Object.freeze([
      "a payment outside the governed window does NOT suppress the candidate",
      "a payment inside it HOLDS the residual and says more than one counterpart survived, if so",
      "no pairing is decided by row order — the pairing-order rule is exercised, not assumed",
    ]),
    expectedClass: "DETECTED" as const,
  }),
]);

/**
 * THE PROVEN-GRAIN QUESTION, recorded as an open item rather than answered by the code.
 *
 * MEASURED: a reconciliation candidate can reach a case and a proof WITHOUT weakening
 * OBLIGATION_IDENTITY_FIELDS, because leakInstanceIdentityStatus() gates only the ASSESSMENT path
 * (server/services/governedSignalStaging.ts:186-189, governedSignalEmitter.ts:218) and appears on the
 * candidate path once, at server/agents/candidateReview.ts:88, as a DISCLOSURE fed to
 * deriveCaseIdentityGrain rather than as a refusal.
 *
 * NOT ESTABLISHED: whether an approved requirement PERMITS a proven figure at account grain. No
 * approved document states the grain at which a proven figure may be asserted. And the proof ledger's
 * anti-double-count is CHAIN-SCOPED (src/domain/provenLedger.ts:3, src/domain/proof.ts:156,175 —
 * "exactly one record per chain"), so double attribution is prevented WITHIN a case and is NOT
 * ESTABLISHABLE ACROSS cases, there being no obligation identity to compare.
 *
 * So the precise statement is: a route exists that permits it; the business authorization is NOT YET
 * PROVEN. Disclosure alone does not complete missing evidence. No scenario in this file asserts a
 * proven figure at account grain, and none will until that question has an owner's answer.
 */
export const PROVEN_GRAIN_AUTHORIZATION = Object.freeze({
  routeExists: true,
  businessAuthorizationProven: false,
  doubleAttributionPrevented: "WITHIN_CASE_ONLY" as const,
  searched: PROOF_MODEL_SEARCH,
});

/**
 * DENOMINATORS, stated because a rate without one is not a measurement.
 *
 * The 100.00% recall / 98.28% precision / 53.25%-unrepresentable figures quoted while planning this
 * slice are measurements over ONE FROZEN SYNTHETIC PACKAGE (V3 and its obligation_ref variant), where
 * the money is the benchmark's PLANTED REGISTER — an artefact this project authored. (The file is named
 * in the harness and deliberately not here: scripts/reconciliation-synthetic/verify.mjs forbids any
 * module under src/ or server/ from carrying that literal, and its first run reported this file as
 * one that "reads the ground truth" for a prose mention alone. The guard is conservative in the safe
 * direction and was NOT weakened to let this file pass.) They license no claim about
 * a real book, and specifically they do NOT establish that better detectors would find no more money:
 * "unrepresentable" there means unrepresentable under CONTRACT 2.0.0 AS IT STANDS, which an extended
 * schema or mapping could change. That alternative was dismissed without evidence and is reinstated as
 * open.
 */
export const BENCHMARK_DENOMINATOR = Object.freeze({
  dataset: "frozen synthetic V3 + obligation_ref variant",
  moneySource: "the benchmark's planted register — authored by this project",
  synthetic: true,
  unrepresentableIsRelativeTo: "pilot data contract 2.0.0 as it stands",
  licensesSaturationClaim: false,
});
