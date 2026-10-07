// CUSTOMER DATA READINESS — can a real customer supply the authoritative facts the measured
// money-discovery capability depends on?
//
// IT COMPUTES NO MONEY. No residual, no exposure, no leakage, no finding, no Recovery Case, nothing
// persisted. It takes the two validations and reports which capabilities the files can support, and for
// every one they cannot: WHAT FACT IS MISSING, WHICH SYSTEM OWNS IT, and WHAT IS BLOCKED.
//
// WHY THE ANSWER IS A LEVEL AND NOT A BOOLEAN. The synthetic counterfactual established that the
// presence of `obligation_ref` unlocks a *level* and leaves the levels above it closed: it makes
// monetary reconciliation possible, and it does NOT establish a duplicate as an event, because two
// lines settling one obligation are indistinguishable from two instalments without an expected
// settlement count. A boolean "ready" would re-make precisely the mistake the capability-reporting
// correction just fixed — announcing a capability from a subset of the facts it needs.
//
// AND WHY NO DOLLAR FIGURE APPEARS HERE. Estimating how much money is blocked, before reconciliation
// has ever run on this customer's data, would be a forecast presented as a finding — the one blend the
// constitution forbids outright. The report carries counts and capability states and no amounts. A test
// asserts that structurally over the returned object, not in a comment.
import type { ExpectationExtractValidation } from "./expectationExtractValidator";
import type { BillingExtractValidation } from "./billingExtractValidator";
import {
  assessSourceFactAuthority, declaresOwnAuthority,
  type AuthorityAssessment,
} from "./sourceFactAuthority";
import {
  corroborateAttestation, type AttestationCheck, type ProvenanceAttestation,
} from "./provenanceAttestation";

/**
 * `rdy-2026.2` because a new authority state is genuinely REACHABLE: a submission accompanied by a
 * corroborating attestation now reports SOURCE_ATTESTED where it previously reported SOURCE_NATIVE.
 * That is a behavioural difference, unlike the rename below, which moved names and nothing else.
 *
 * The SCHEME stays `-v2`. The report gains an optional `attestation` summary, and this repository's
 * precedent is that a scheme id moves on a BREAKING shape change — expectation extract 1.0.0 → 1.1.0
 * added a per-unit declaration without moving its scheme. An additive field is not a break.
 *
 * `-v2` because the report's SHAPE moved: `settlement` became `billing` when
 * `nh.settlement-extract@1.0.0` was retired in favour of `nh.billing-extract@1.0.0`. A reported key is
 * part of the shape, and a surface that keeps naming a thing it no longer is was the `coverage.event`
 * error — announcing one state of the world from a surface describing another.
 *
 * The METHOD VERSION deliberately does not move. No level, gate, conjunct, count or refusal changed:
 * the same facts are read under new names. A version signalling a change that did not happen is its own
 * defect, and it would force a re-reading of every report to express a dependency that does not exist.
 */
export const DATA_READINESS_SCHEME = "nh-customer-data-readiness-v2";
export const DATA_READINESS_METHOD_VERSION = "rdy-2026.2";

/**
 * Ordered. Each level requires everything below it; none may be reported without the level beneath.
 * `L4_EVENT_PROOF` is declared and UNREACHABLE in this slice, which is a result rather than an omission.
 */
export type ReadinessLevel =
  | "L0_NOT_READABLE"
  | "L1_STRUCTURALLY_VALID"
  | "L2_MONETARY_RECONCILIATION_POSSIBLE"
  | "L3_EXACT_MONEY"
  | "L4_EVENT_PROOF";

export const READINESS_LEVELS: readonly ReadinessLevel[] = Object.freeze([
  "L0_NOT_READABLE", "L1_STRUCTURALLY_VALID", "L2_MONETARY_RECONCILIATION_POSSIBLE",
  "L3_EXACT_MONEY", "L4_EVENT_PROOF",
]);

/** The money-discovery capabilities a readiness report speaks about. */
export type MoneyDiscoveryCapability =
  | "MONETARY_RECONCILIATION"
  | "EXACT_MONEY"
  | "EVENT_PROOF"
  | "ATTRIBUTION"
  | "ADDITIVE_OBLIGATION"
  | "AMENDMENT_LINEAGE"
  | "LIFECYCLE_EXCLUSION";

export type OwningSourceSystem =
  | "contract_or_clm"
  | "billing_or_erp"
  | "payments_processor"
  | "either_but_must_be_one";

/**
 * The shape of an unavailable capability, and the three things it must always name. A blocked
 * capability that cannot say what is missing or who owns it is a complaint rather than a request.
 */
export interface BlockedCapability {
  readonly capability: MoneyDiscoveryCapability;
  readonly missingSourceFact: string;
  readonly owningSourceSystem: OwningSourceSystem;
  readonly blockedMoneyDiscoveryCapability: string;
  /** The contract code a customer can look up. */
  readonly code: string;
}

export interface CapabilityReadiness {
  readonly capability: MoneyDiscoveryCapability;
  readonly available: boolean;
  /** Present exactly when `available` is false. */
  readonly blocked: BlockedCapability | null;
}

export interface ReadinessReport {
  readonly scheme: typeof DATA_READINESS_SCHEME;
  readonly methodVersion: typeof DATA_READINESS_METHOD_VERSION;
  /** The highest level BOTH files support. Never above what authority permits being relied on. */
  readonly level: ReadinessLevel;
  /**
   * TRUE whenever authority is unverified, which in this slice is always. A provisional level is a
   * statement about the files' SHAPE, never about their trustworthiness.
   */
  readonly provisional: boolean;
  readonly authority: AuthorityAssessment;
  /** Self-asserted authority keys found in the submission. Refused, listed so the refusal is visible. */
  readonly refusedSelfAssertedAuthority: readonly string[];
  // ── counts · never money ──────────────────────────────────────────────────────────────────────
  readonly expectation: {
    readonly usable: boolean;
    readonly acceptedRows: number;
    readonly rejectedRows: number;
    readonly rejectionCodes: readonly string[];
    readonly unknownAmountRows: number;
    readonly monetaryQuantification: ExpectationExtractValidation["monetaryQuantification"];
  };
  readonly billing: {
    readonly usable: boolean;
    readonly acceptedRows: number;
    readonly rejectedRows: number;
    readonly rejectionCodes: readonly string[];
    readonly creditRows: number;
    readonly currencyMismatchRows: number;
    readonly obligationRefPopulatedRows: number;
  };
  /**
   * Billing lines whose `obligation_ref` matches no ACCEPTED expectation. Reported, never joined, and
   * deliberately NOT a dataset-level block — see the note in the evaluator. A non-zero count means
   * billing named an obligation the contract side did not validly state; `expectation.rejectionCodes`
   * says why those obligations were not accepted.
   */
  readonly danglingObligationRefs: number;
  /** What a non-zero dangling count means, so a reader never has to infer it. Null when zero. */
  readonly danglingObligationRefNote: string | null;
  readonly currencyCompatible: boolean;
  /**
   * Present only when an attestation accompanied the submission. It carries COUNTS and per-claim states
   * and no money — the no-money guarantee covers it, and the same structural test walks it.
   */
  readonly attestation: {
    readonly dataOwnerRole: string;
    readonly checks: readonly AttestationCheck[];
    /** Claims where the declaration and the files disagree. Reported first because they outrank a pass. */
    readonly contradictions: readonly string[];
    /** Recorded, attributed, and explicitly not evidence for the rung. */
    readonly uncorroboratedClaims: readonly string[];
  } | null;
  readonly capabilities: readonly CapabilityReadiness[];
  readonly blocked: readonly BlockedCapability[];
  readonly claimBoundary: {
    readonly observationOnly: true;
    readonly computesMoney: false;
    readonly constitutesProof: false;
    readonly constitutesRevenue: false;
  };
}

const EXPECTATION_CAP = (v: ExpectationExtractValidation, name: string): boolean =>
  v.capabilities.find((c) => c.capability === name)?.available === true;

const BILLING_CAP = (v: BillingExtractValidation, name: string): boolean =>
  v.capabilities.find((c) => c.capability === name)?.available === true;

const billingCode = (v: BillingExtractValidation, name: string): string =>
  v.capabilities.find((c) => c.capability === name)?.unavailableCode ?? "NH-BX-3001";

const expectationCode = (v: ExpectationExtractValidation, name: string): string =>
  v.capabilities.find((c) => c.capability === name)?.unavailableCode ?? "NH-EX-3005";

/**
 * Evaluate readiness from the two validations.
 *
 * `submission` is passed only so a self-asserted authority key can be FOUND AND REFUSED, and its
 * values are never read for any other purpose.
 */
export function evaluateDataReadiness(
  expectation: ExpectationExtractValidation,
  billing: BillingExtractValidation,
  submission: Readonly<Record<string, unknown>> = {},
  attestation?: ProvenanceAttestation,
): ReadinessReport {
  const refusedSelfAssertedAuthority = declaresOwnAuthority(submission);

  // THE ASYMMETRY THAT DEFENDS AGAINST SELF-VOUCHING. The caller may hand over a DECLARATION; it may not
  // hand over a verdict about that declaration. So the corroboration is computed HERE, from the
  // declaration and the two validations, and only the computed object reaches the authority assessment.
  const corroboration = attestation === undefined
    ? undefined
    : corroborateAttestation(attestation, expectation, billing);

  // AUTHORITY FIRST, and it gates what any level may be relied on for. Nothing can reach
  // AUTHORITY_VERIFIED: `provenanceEstablished` is not even accepted from the caller.
  const authority = assessSourceFactAuthority({
    present: expectation.usable && billing.usable,
    validFormat: expectation.usable && billing.usable,
    declaredSourceNative: true, // both contracts declare every field source-observable
    attestation: corroboration,
  });
  const provisional = authority.reached !== "AUTHORITY_VERIFIED";

  const obligationRefPopulated = billing.accepted.filter((a) => a.obligationRef !== null).length;
  const acceptedObligations = new Set(
    expectation.accepted.map((a) => a.scheduleLineRef).filter((r): r is string => typeof r === "string" && r !== ""),
  );
  const danglingObligationRefs = billing.accepted.filter(
    (a) => a.obligationRef !== null && !acceptedObligations.has(a.obligationRef),
  ).length;

  const currencyCompatible = expectation.usable && billing.usable
    && expectation.currency === billing.currency
    && billing.currencyMismatchCount === 0;

  // ── the capability map · each one named, each one fail-closed ──────────────────────────────────
  /**
   * THE LINK CAPABILITY IS ABOUT WHETHER BILLING STATES THE REFERENCE AT ALL — not about whether every
   * reference happens to resolve.
   *
   * The first form of this gate also required `danglingObligationRefs === 0`, and the control caught it:
   * on the frozen variant 11 billing lines of 597 name an obligation whose EXPECTATION row was
   * correctly quarantined — 2 for ambiguous live lines (NH-EX-2016) and 9 for a non-governed currency
   * (NH-EX-2008). Blocking monetary reconciliation for the whole dataset over 11 rows is the
   * DATASET-GLOBAL TAINT DEFECT in new clothing, and this repository already governs against it:
   * *doubt is scoped to the evidence that creates it, and a detector that refuses everything is not
   * cautious but unusable.* 586 billing lines resolve perfectly, and telling a customer reconciliation is
   * impossible would be false.
   *
   * So a dangling reference is a PER-UNIT condition, reported as a first-class count with its reason,
   * and it gates nothing at dataset level. What it means is stated rather than implied: billing named
   * an obligation the contract side did not validly state, so those units cannot be joined — and the
   * expectation rejection codes in this report say why.
   */
  const obligationLink = BILLING_CAP(billing, "BILLING_OBLIGATION_LINK_AVAILABLE");
  const billingPeriod = BILLING_CAP(billing, "BILLING_PERIOD_AVAILABLE");
  const creditDistinction = BILLING_CAP(billing, "CREDIT_DISTINCTION_AVAILABLE");
  const expectationEventIdentity = EXPECTATION_CAP(expectation, "EXPECTATION_EVENT_IDENTITY_AVAILABLE");
  const amendmentLineage = EXPECTATION_CAP(expectation, "AMENDMENT_LINEAGE_AVAILABLE");
  const lifecycle = EXPECTATION_CAP(expectation, "LIFECYCLE_TERMINATION_AVAILABLE")
    && EXPECTATION_CAP(expectation, "LIFECYCLE_PAUSE_AVAILABLE");
  const payerRelation = EXPECTATION_CAP(expectation, "PAYER_RELATION_AVAILABLE");

  const bothUsable = expectation.usable && billing.usable;

  // MONETARY RECONCILIATION needs BOTH sides keyed and both able to form a period unit. The expectation
  // side alone is not it — the mistake `coverage.event` made and this slice must not repeat.
  const monetaryReconciliation = bothUsable && obligationLink && expectationEventIdentity && billingPeriod && currencyCompatible;

  // EXACT MONEY additionally needs an authoritative amount on EVERY accepted unit, and credits told
  // apart. A PARTIAL quantification is not rounded up.
  const exactMoney = monetaryReconciliation && expectation.monetaryQuantification === "AVAILABLE" && creditDistinction;

  // ADDITIVE OBLIGATION · whether two live expectation lines on one unit may legitimately be summed.
  // The expectation contract declares NO component-identity field, so this is UNAVAILABLE by
  // construction and the ambiguity it guards is reported unresolved.
  const additiveObligation = false;

  // EVENT PROOF · needs an authoritative expected settlement count, which no side carries.
  const eventProof = BILLING_CAP(billing, "EXPECTED_SETTLEMENT_COUNT_AVAILABLE");

  const attribution = bothUsable && payerRelation;

  const blocked: BlockedCapability[] = [];
  const cap = (
    capability: MoneyDiscoveryCapability,
    available: boolean,
    missing: () => BlockedCapability,
  ): CapabilityReadiness => {
    if (available) return Object.freeze({ capability, available: true, blocked: null });
    const b = missing();
    blocked.push(b);
    return Object.freeze({ capability, available: false, blocked: b });
  };

  const capabilities: readonly CapabilityReadiness[] = Object.freeze([
    cap("MONETARY_RECONCILIATION", monetaryReconciliation, () => Object.freeze({
      capability: "MONETARY_RECONCILIATION" as const,
      missingSourceFact: !bothUsable
        ? "a readable extract on both sides"
        : !obligationLink
          ? "`obligation_ref` on every billing line: the contract system's own obligation identifier, carried by billing onto the line that settles it"
          : !expectationEventIdentity
            ? "`schedule_line_ref` on every expected obligation, so the billing reference has something to resolve to"
            : !billingPeriod
              ? "`period_start` and `period_end` on the billing lines — the issue date is not what the charge covers"
              : "a single governed currency across both extracts",
      owningSourceSystem: (!obligationLink && bothUsable ? "billing_or_erp" : !expectationEventIdentity ? "contract_or_clm" : "either_but_must_be_one") as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "Comparing expected money against billed money at obligation grain. Without the join, a re-key or migration destroys the match and a timing-displacement hypothesis cannot be refuted, so real missing money is held out pending attribution rather than claimed.",
      code: !bothUsable ? "NH-BX-1002"
        : !obligationLink ? billingCode(billing, "BILLING_OBLIGATION_LINK_AVAILABLE")
          : !expectationEventIdentity ? expectationCode(expectation, "EXPECTATION_EVENT_IDENTITY_AVAILABLE")
            : !billingPeriod ? billingCode(billing, "BILLING_PERIOD_AVAILABLE")
              : "NH-BX-2007",
    })),
    cap("EXACT_MONEY", exactMoney, () => Object.freeze({
      capability: "EXACT_MONEY" as const,
      missingSourceFact: !monetaryReconciliation
        ? "monetary reconciliation itself, which is blocked above"
        : expectation.monetaryQuantification !== "AVAILABLE"
          ? "an authoritative `expected_amount` on every expected obligation. Blanks are preserved as declared UNKNOWNs and are NEVER valued, averaged from prior invoices, taken from a plan price or prorated"
          : "`is_credit` on the billing side, so a credit is not read as a charge",
      owningSourceSystem: (expectation.monetaryQuantification !== "AVAILABLE" ? "contract_or_clm" : "billing_or_erp") as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "An exact residual for every unit. Units without an authoritative amount stay UNKNOWN — counted beside the money, never as zero, because $0.00 would assert the obligation was checked and found satisfied.",
      code: expectation.monetaryQuantification !== "AVAILABLE" ? "NH-EX-3006" : billingCode(billing, "CREDIT_DISTINCTION_AVAILABLE"),
    })),
    cap("EVENT_PROOF", eventProof, () => Object.freeze({
      capability: "EVENT_PROOF" as const,
      missingSourceFact:
        "an authoritative EXPECTED SETTLEMENT COUNT per obligation — how many settlement events the obligation expected. Billing cannot state it, because it is a fact about what was expected OF billing.",
      owningSourceSystem: "contract_or_clm" as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "Establishing a DUPLICATE as an event. Two lines settling one obligation stay indistinguishable from two instalments of it, so NH reports MULTIPLE SETTLEMENTS OBSERVED and never a duplicate. On the synthetic evidence this upgrades event-level proof and unlocks NO additional money.",
      code: billingCode(billing, "EXPECTED_SETTLEMENT_COUNT_AVAILABLE"),
    })),
    cap("ATTRIBUTION", attribution, () => Object.freeze({
      capability: "ATTRIBUTION" as const,
      missingSourceFact: "`payer_ref` on every expected obligation, and the payer relation where one is authoritative",
      owningSourceSystem: "contract_or_clm" as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "Attributing a residual to a sibling misallocation rather than to missing money. Without it a positive residual stays in the headline as unexplained exposure — the money is still reported, only unattributed, which is the conservative direction.",
      code: expectationCode(expectation, "PAYER_RELATION_AVAILABLE"),
    })),
    cap("ADDITIVE_OBLIGATION", additiveObligation, () => Object.freeze({
      capability: "ADDITIVE_OBLIGATION" as const,
      missingSourceFact:
        "a source-stated COMPONENT IDENTITY per expected obligation line (BASE, OVERAGE, SEAT-TIER-2), so two live lines on one unit can be established as distinct additive obligations. No such field is declared, deliberately: claiming distinctness INFLATES exposure, so it is beneficiary-adverse and needs governing before it is accepted.",
      owningSourceSystem: "contract_or_clm" as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "Pricing a unit claimed by more than one live expectation line. Such units are REFUSED with a null residual — never summed, because summing would assert an amount neither line makes.",
      code: "NH-EX-2016",
    })),
    cap("AMENDMENT_LINEAGE", amendmentLineage, () => Object.freeze({
      capability: "AMENDMENT_LINEAGE" as const,
      missingSourceFact: "`supersedes_ref` and `amended_at` on the expectation side",
      owningSourceSystem: "contract_or_clm" as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "False-positive control. A replaced obligation reads as still owed beside its replacement, which manufactures exposure.",
      code: expectationCode(expectation, "AMENDMENT_LINEAGE_AVAILABLE"),
    })),
    cap("LIFECYCLE_EXCLUSION", lifecycle, () => Object.freeze({
      capability: "LIFECYCLE_EXCLUSION" as const,
      missingSourceFact: "`terminated_at`, and `pause_start` with `pause_end`, on the expectation side",
      owningSourceSystem: "contract_or_clm" as OwningSourceSystem,
      blockedMoneyDiscoveryCapability:
        "False-positive control. A terminated or suspended period reads as unbilled, which manufactures exposure.",
      code: expectationCode(expectation, "LIFECYCLE_TERMINATION_AVAILABLE"),
    })),
  ]);

  // ── the level · strictly cumulative, and never above what the facts support ────────────────────
  let level: ReadinessLevel = "L0_NOT_READABLE";
  if (bothUsable) level = "L1_STRUCTURALLY_VALID";
  if (level === "L1_STRUCTURALLY_VALID" && monetaryReconciliation) level = "L2_MONETARY_RECONCILIATION_POSSIBLE";
  if (level === "L2_MONETARY_RECONCILIATION_POSSIBLE" && exactMoney) level = "L3_EXACT_MONEY";
  if (level === "L3_EXACT_MONEY" && eventProof) level = "L4_EVENT_PROOF";

  return Object.freeze({
    scheme: DATA_READINESS_SCHEME,
    methodVersion: DATA_READINESS_METHOD_VERSION,
    level,
    provisional,
    authority,
    refusedSelfAssertedAuthority,
    expectation: Object.freeze({
      usable: expectation.usable,
      acceptedRows: expectation.accepted.length,
      rejectedRows: expectation.rejections.length,
      rejectionCodes: Object.freeze([...new Set(expectation.rejections.map((r) => r.code))].sort()),
      unknownAmountRows: expectation.unknownAmountCount,
      monetaryQuantification: expectation.monetaryQuantification,
    }),
    billing: Object.freeze({
      usable: billing.usable,
      acceptedRows: billing.accepted.length,
      rejectedRows: billing.rejections.length,
      rejectionCodes: Object.freeze([...new Set(billing.rejections.map((r) => r.code))].sort()),
      creditRows: billing.creditRowCount,
      currencyMismatchRows: billing.currencyMismatchCount,
      obligationRefPopulatedRows: obligationRefPopulated,
    }),
    danglingObligationRefs,
    danglingObligationRefNote: danglingObligationRefs === 0 ? null
      : `${danglingObligationRefs} billing line(s) name an obligation that is not in the accepted expectation population, so those units cannot be joined. This does NOT make reconciliation impossible for the rest: the affected units are reported and excluded, never guessed at. See expectation.rejectionCodes for why those obligations were not accepted.`,
    currencyCompatible,
    attestation: corroboration === undefined ? null : Object.freeze({
      dataOwnerRole: corroboration.dataOwnerRole,
      checks: corroboration.checks,
      contradictions: corroboration.contradictions,
      uncorroboratedClaims: corroboration.uncorroboratedClaims,
    }),
    capabilities,
    blocked: Object.freeze(blocked),
    claimBoundary: Object.freeze({
      observationOnly: true as const,
      computesMoney: false as const,
      constitutesProof: false as const,
      constitutesRevenue: false as const,
    }),
  });
}
