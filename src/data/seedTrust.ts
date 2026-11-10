// Seed for the GOVERNED trust world: a locked Baseline, ≥1 Evidence reference, and — where the gate
// permits one — an immutable approved Proof, in exact minor units (cents).
//
// These are built through the REAL approval gate (`validateApproval` / `approveProofForCase`), so the
// seed itself proves the Trust Invariant: separation of authority (Finance approver ≠ owner), a
// baseline locked before intervention/outcome, a mandatory exclusion statement, independent evidence
// for auditable-tier claims, and — since the owner's Option 1 decision of 2026-11-10 — a recovery
// mechanism some source can actually attest.
//
// THE HEADLINE CHANGED, AND THAT IS THE POINT. This file used to assert proven Revenue Returned of
// $83,400, of which $79,800 CFO-auditable. Every cent of it rested on one of the SEVEN recovery
// mechanisms that have no declared correction channel: a corrective invoice is the billing system's
// statement about billing and attests nothing about whether an onboarding was restarted, a milestone
// reached or a usage flag switched on. The governed HTTP route has refused those since D3. This path
// did not, so the same claim got two answers depending on which door it came through.
//
// SO SEVEN CASES ARE NOW DETECTED-AND-REFUSED and ONE is proven. The seven keep every recorded fact —
// the collection happened, the baseline was locked, the evidence was ingested — and lose only the
// PROOF, which is the one thing that was never supportable. Nothing was relabelled to make a test
// pass: not one `reason`, `leakageType`, amount, date or evidence record moved on any of them. What
// changed is that the gate is now asked, and it answers.
//
// THE REFUSAL IS THE GATE'S OWN, NOT A LIST WRITTEN HERE. `buildOne` calls `validateApproval` and
// builds a proof only when it returns no violations. A hand-kept set of "these seven are refused"
// would agree with the gate on the day it was written and drift the moment a channel is declared.
import { establishBaseline, lockBaseline, type Baseline } from "../domain/baseline";
import { makeEvidence, type Evidence, type TrustClassification } from "../domain/evidence";
import { approveProofForCase, validateApproval, type CaseApprovalContext } from "../domain/approval";
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
  /**
   * The EXECUTED CORRECTION, where one exists: the billing system's own statement that it raised the
   * corrective charge. Its role is DERIVED by `deriveEvidenceRole`, so setting this does not assert
   * anything — a record only reaches the correction channel if (sourceSystem, evidenceType) is on the
   * allowlist. Seven of the eight mechanisms have no channel, so supplying one for them would change
   * nothing: the refusal is about the MECHANISM, not about a missing upload.
   */
  correctionEvidence?: { type: string; system: string; recordId: string; observedAt: string };
}

// Cents mirror the existing Case story exactly (dollars × 100). RE-1006 (recovered, no reason) is
// intentionally absent — rule 2, an unclassified recovery is never counted.
//
// Of the eight entries below, exactly ONE reaches PROVEN: RE-1015, whose mechanism is a billing
// correction. The other seven are unchanged from the day they were written and are now refused by the
// gate, which is the honest outcome rather than a regression.
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
  {
    // ── THE ONE PROVABLE CASE, and the accounting is internally consistent by construction. ──────
    //
    // Contracted obligation            $18,000.00
    // Originally invoiced              $12,500.00   ← the baseline: what WOULD have been collected
    // Shortfall / corrective charge     $5,500.00   ← CN-9120, raised and attested BY BILLING
    // Collected after the correction   $18,000.00
    // Revenue Returned                  $5,500.00   = collected − baseline, AND = the corrective charge
    //
    // The last line is why this case can be proven and the other seven cannot. The uplift is not an
    // estimate of how much a human action moved the number — it EQUALS a specific charge the billing
    // system states it raised, so the attribution is an accounting identity rather than a behavioural
    // hypothesis. A CFO can re-derive it from two documents without believing anything about us.
    //
    // TWO EVIDENCE RECORDS WITH DIFFERENT JOBS, and neither can do the other's. The corrective invoice
    // (`corrective_invoice_issued`) derives the CORRECTION role and is what satisfies the channel: it
    // says the fix was executed. The paid invoice (`invoice_paid`) derives the OUTCOME role and is what
    // says the money arrived. A fix is not a recovery and evidence of arrival is not evidence of a fix,
    // so the proof needs both — and the correction is observed BEFORE the settlement, because a
    // correction that followed the collection would not explain it.
    caseId: "RE-1015",
    ownerName: "Marcus Cole",
    leakageType: "RevenueUnderBilled",
    reason: "BillingCorrection",
    baselineMinor: 1_250_000,
    collectedMinor: 1_800_000,
    confidence: 92,
    attribution:
      "Reconciliation found a $5,500.00 positive residual on the contracted obligation; billing raised "
      + "corrective invoice CN-9120 for exactly that amount and it settled in full on INV-9121.",
    registeredAt: "2026-06-04T09:00:00.000Z",
    independentEvidence: { type: "invoice_paid", system: "billing", recordId: "INV-9121" },
    noteEvidence: null,
    correctionEvidence: {
      type: "corrective_invoice_issued",
      system: "billing",
      recordId: "CN-9120",
      observedAt: "2026-06-04T14:00:00.000Z",
    },
  },
];

export interface SeedTrustBuild {
  baseline: Baseline;
  evidence: Evidence[];
  /** `null` when the real gate refused — NOT COMPUTED, never a zero-valued proof. */
  proof: Proof | null;
  /** The gate's own words, when it refused. Empty when a proof was produced. */
  refusals: string[];
}

function buildOne(s: TrustSeed): SeedTrustBuild {
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
  if (s.correctionEvidence) {
    // Ingested BEFORE the settlement below, by `observedAt`: the correction must precede the
    // collection it explains. `deriveEvidenceRole` decides whether this reaches the correction
    // channel; the field only supplies the (sourceSystem, evidenceType) pair it judges.
    evidence.push(
      makeEvidence({
        evidenceId: `EV-${s.caseId}-fix`,
        evidenceType: s.correctionEvidence.type,
        sourceSystem: s.correctionEvidence.system,
        sourceRecordId: s.correctionEvidence.recordId,
        observedAt: s.correctionEvidence.observedAt,
        ingestedAt: s.correctionEvidence.observedAt,
        trustClassification: "independent" as TrustClassification,
        suppliedBy: s.correctionEvidence.system,
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
    // The case's own leakage type, which is its recovery type for scope purposes.
    recoveryType: s.leakageType,
  };
  // ASK THE GATE. A seed whose mechanism no source can attest produces NO proof, and the gate's own
  // violation strings are carried out rather than a sentence written here — so the day a correction
  // channel is declared for one of the seven, this file starts producing its proof with no edit.
  const refusals = validateApproval(ctx);
  if (refusals.length > 0) return { baseline, evidence, proof: null, refusals };
  return { baseline, evidence, proof: approveProofForCase(ctx), refusals: [] };
}

export function seedTrust(): TrustStore {
  const baselines: Baseline[] = [];
  const proofs: Proof[] = [];
  const evidenceByCase: Record<string, Evidence[]> = {};
  for (const s of SEEDS) {
    const { baseline, evidence, proof } = buildOne(s);
    baselines.push(baseline);
    if (proof !== null) proofs.push(proof);
    evidenceByCase[s.caseId] = evidence;
  }
  return { baselines, proofs, evidenceByCase };
}

/**
 * What the gate said about every seed — for tests and for the record, not for the store.
 *
 * Exposed because "seven of these are refused" is a claim that should be checkable against the gate
 * rather than against a comment. `seedTrustProvability.test.ts` reads it and asserts both halves: the
 * seven refusals name `CORRECTION_CHANNEL_NOT_DECLARED`, and RE-1015 is refused for nothing at all.
 */
export function seedTrustProvability(): { caseId: string; proven: boolean; refusals: string[] }[] {
  return SEEDS.map((s) => {
    const { proof, refusals } = buildOne(s);
    return { caseId: s.caseId, proven: proof !== null, refusals };
  });
}
