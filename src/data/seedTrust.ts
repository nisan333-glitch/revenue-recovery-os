// Seed for the GOVERNED trust world: a locked Baseline, ≥1 Evidence reference, and an immutable
// approved Proof for each recovered, classified seed Case — expressed in exact minor units (cents).
//
// These are built through the REAL approval gate (`approveProofForCase`), so the seed itself proves
// the Trust Invariant: separation of authority (Finance approver ≠ owner), a baseline locked before
// intervention/outcome, a mandatory exclusion statement, and independent evidence for auditable-tier
// claims. The headline story is reproduced exactly: proven Revenue Returned = $83,400, of which
// $79,800 is CFO-auditable (the low-confidence Soylent case is proven but below threshold).
import { establishBaseline, lockBaseline, type Baseline } from "../domain/baseline";
import { makeEvidence, type Evidence, type TrustClassification } from "../domain/evidence";
import { approveProofForCase, type CaseApprovalContext } from "../domain/approval";
import type { Proof } from "../domain/proof";
import { money } from "../domain/money";
import { CURRENT_POLICY } from "../domain/policy";
import type { LeakageType, RecoveryReason } from "../domain/types";
import { APPROVER_ACTOR, ownerActor } from "./actors";
import type { TrustStore } from "./repository";

const USD = "USD";

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

interface TrustSeed {
  caseId: string;
  ownerName: string;
  leakageType: LeakageType;
  reason: NonNullable<RecoveryReason>;
  baselineMinor: number;
  collectedMinor: number;
  confidence: number;
  attribution: string;
  /** Pre-registration point: baseline established + locked here, before any intervention. */
  registeredAt: string;
  /** Independent evidence (paid invoice etc.) makes an auditable claim; a note alone does not. */
  independentEvidence: { type: string; system: string; recordId: string } | null;
  noteEvidence: string | null;
}

// Cents mirror the existing Case story exactly (dollars × 100). Only Recovered + classified +
// uplift cases get a Proof; RE-1006 (recovered, no reason) is intentionally absent.
const SEEDS: TrustSeed[] = [
  {
    caseId: "RE-1001",
    ownerName: "Dana Levy",
    leakageType: "RenewalAtRisk",
    reason: "RenewalOutreach",
    baselineMinor: 480_000,
    collectedMinor: 2_400_000,
    confidence: 94,
    attribution: "RenewalOutreach play; second invoice INV-8841 paid before term lapse.",
    registeredAt: "2026-05-02T08:12:00.000Z",
    independentEvidence: { type: "invoice_paid", system: "billing", recordId: "INV-8841" },
    noteEvidence: "CSM-led renewal outreach with ROI recap.",
  },
  {
    caseId: "RE-1002",
    ownerName: "Priya Nair",
    leakageType: "ActivationMissed",
    reason: "MilestoneNudge",
    baselineMinor: 190_000,
    collectedMinor: 960_000,
    confidence: 88,
    attribution: "MilestoneNudge drove the activation event; next invoice cleared.",
    registeredAt: "2026-05-08T11:05:00.000Z",
    independentEvidence: { type: "invoice_paid", system: "billing", recordId: "INV-8902" },
    noteEvidence: "Activation event logged in product.",
  },
  {
    caseId: "RE-1003",
    ownerName: "Marcus Cole",
    leakageType: "StalledOnboarding",
    reason: "OnboardingReboot",
    baselineMinor: 0,
    collectedMinor: 1_500_000,
    confidence: 91,
    attribution: "Onboarding reboot with a fresh plan + named owner; first invoice cleared.",
    registeredAt: "2026-05-11T09:35:00.000Z",
    independentEvidence: { type: "invoice_paid", system: "billing", recordId: "INV-8955" },
    noteEvidence: "Finance approved the cleared invoice.",
  },
  {
    caseId: "RE-1004",
    ownerName: "Dana Levy",
    leakageType: "ExpansionStalled",
    reason: "ExecBusinessReview",
    baselineMinor: 600_000,
    collectedMinor: 1_650_000,
    confidence: 83,
    attribution: "EBR tied usage to ROI and re-opened the expansion; signed order form.",
    registeredAt: "2026-05-15T13:05:00.000Z",
    independentEvidence: { type: "order_form_signed", system: "crm", recordId: "OF-4471" },
    noteEvidence: "Baseline = flat renewal counterfactual if expansion had lapsed.",
  },
  {
    // Low-confidence: proven (counted) but BELOW the auditable threshold — note-only evidence.
    caseId: "RE-1005",
    ownerName: "Priya Nair",
    leakageType: "LowAdoption",
    reason: "CSMOutreach",
    baselineMinor: 360_000,
    collectedMinor: 720_000,
    confidence: 58,
    attribution: "CSM outreach preceded payment; attribution weak (may have paid regardless).",
    registeredAt: "2026-05-19T10:05:00.000Z",
    independentEvidence: null,
    noteEvidence: "CSM outreach email; no independent evidence captured.",
  },
  {
    caseId: "RE-1013",
    ownerName: "Priya Nair",
    leakageType: "NoFirstValue",
    reason: "EnablementSession",
    baselineMinor: 420_000,
    collectedMinor: 2_100_000,
    confidence: 86,
    attribution: "Enablement session drove the first-value event; invoice INV-9120 paid.",
    registeredAt: "2026-05-28T09:05:00.000Z",
    independentEvidence: { type: "invoice_paid", system: "billing", recordId: "INV-9120" },
    noteEvidence: "First-value event recorded in product.",
  },
  {
    caseId: "RE-1014",
    ownerName: "Dana Levy",
    leakageType: "ActivationMissed",
    reason: "UsageActivation",
    baselineMinor: 260_000,
    collectedMinor: 1_320_000,
    confidence: 81,
    attribution: "In-product usage-activation flow triggered activation; next invoice cleared.",
    registeredAt: "2026-06-01T09:05:00.000Z",
    independentEvidence: { type: "usage_activation_event", system: "product", recordId: "UA-7781" },
    noteEvidence: "Order/usage logged in CRM.",
  },
];

function buildOne(s: TrustSeed): { baseline: Baseline; evidence: Evidence[]; proof: Proof } {
  const interventionAt = addHours(s.registeredAt, 1);
  const outcomeObservedAt = addHours(s.registeredAt, 24);
  const approvedAt = addHours(s.registeredAt, 25);

  // 1) Establish + lock the governed baseline BEFORE the intervention (pre-registration).
  const baseline = lockBaseline(
    establishBaseline({
      baselineId: `BL-${s.caseId}`,
      method: CURRENT_POLICY.baselineMethodId,
      methodVersion: CURRENT_POLICY.baselineMethodVersion,
      sourceRefs: [`cohort:${s.leakageType}`],
      calculatedAmount: money(s.baselineMinor, USD),
      applicableLeakType: s.leakageType,
      effectiveAt: s.registeredAt,
      establishedAt: s.registeredAt,
      establishedBy: "system",
    }),
    s.registeredAt,
    "pre-registered before intervention",
  );

  // 2) Evidence: an independent reference (paid invoice / signed order / product event) for
  //    auditable-tier claims; a beneficiary-controlled note otherwise.
  const evidence: Evidence[] = [];
  if (s.independentEvidence) {
    evidence.push(
      makeEvidence({
        evidenceId: `EV-${s.caseId}-src`,
        evidenceType: s.independentEvidence.type,
        sourceSystem: s.independentEvidence.system,
        sourceRecordId: s.independentEvidence.recordId,
        observedAt: outcomeObservedAt,
        ingestedAt: outcomeObservedAt,
        trustClassification: "independent" as TrustClassification,
        suppliedBy: s.independentEvidence.system,
      }),
    );
  }
  if (s.noteEvidence) {
    evidence.push(
      makeEvidence({
        evidenceId: `EV-${s.caseId}-note`,
        evidenceType: "operator_note",
        sourceSystem: "manual",
        sourceRecordId: `${s.caseId}-note`,
        observedAt: interventionAt,
        ingestedAt: interventionAt,
        trustClassification: "beneficiary_controlled" as TrustClassification,
        suppliedBy: "operator@company",
      }),
    );
  }

  // 3) Approve through the real gate — the seed cannot violate the Trust Invariant.
  const ctx: CaseApprovalContext = {
    proofId: `PF-${s.caseId}`,
    recoveryCaseId: s.caseId,
    approvedAt,
    ownerActorId: ownerActor(s.ownerName).id,
    approverActor: APPROVER_ACTOR,
    baseline,
    evidence,
    interventionAt,
    outcomeObservedAt,
    collectedMinor: s.collectedMinor,
    currency: USD,
    excludedMinor: 0,
    exclusionStatement:
      "No excluded recovery on this case — asserted: the full delta is supported by the referenced evidence.",
    recoveryReason: s.reason,
    attribution: s.attribution,
    confidenceUsed: s.confidence,
    policy: CURRENT_POLICY,
  };
  const proof = approveProofForCase(ctx);
  return { baseline, evidence, proof };
}

export function seedTrust(): TrustStore {
  const baselines: Baseline[] = [];
  const proofs: Proof[] = [];
  const evidenceByCase: Record<string, Evidence[]> = {};
  for (const s of SEEDS) {
    const { baseline, evidence, proof } = buildOne(s);
    baselines.push(baseline);
    proofs.push(proof);
    evidenceByCase[s.caseId] = evidence;
  }
  return { baselines, proofs, evidenceByCase };
}
