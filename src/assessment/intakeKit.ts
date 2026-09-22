import type { AssessmentResult } from "./types";

export const INTAKE_KIT_VERSION = "pilot-intake-2026.1";

export interface PilotDeclarations {
  readonly activationDefinitionConfirmed: boolean;
  readonly stableJoinKeyConfirmed: boolean;
  readonly sourceOwnershipDocumented: boolean;
  readonly untreatedHistoryAvailable: boolean;
  readonly interventionHistoryAvailable: boolean;
  readonly reversalCoverageConfirmed: boolean;
  readonly baselinePreRegistered: boolean;
}

export const EMPTY_PILOT_DECLARATIONS: PilotDeclarations = Object.freeze({
  activationDefinitionConfirmed: false,
  stableJoinKeyConfirmed: false,
  sourceOwnershipDocumented: false,
  untreatedHistoryAvailable: false,
  interventionHistoryAvailable: false,
  reversalCoverageConfirmed: false,
  baselinePreRegistered: false,
});

export const DECLARATION_LABELS: Readonly<Record<keyof PilotDeclarations, string>> = Object.freeze({
  activationDefinitionConfirmed: "Activation milestone is defined and confirmed by the customer",
  stableJoinKeyConfirmed: "A stable account/subscription key joins CRM, product and billing records",
  sourceOwnershipDocumented: "The owner and system of record for every supplied field are documented",
  untreatedHistoryAvailable: "Historical untreated cycles are available for a comparison baseline",
  interventionHistoryAvailable: "Intervention, owner and action timestamps are available",
  reversalCoverageConfirmed: "Refund, cancellation and reversal coverage is confirmed",
  baselinePreRegistered: "Baseline method and recovery definition will be fixed before pilot outcomes",
});

export type IntakeGateStatus = "pass" | "needs_confirmation" | "blocked";

export interface IntakeGate {
  readonly id: string;
  readonly label: string;
  readonly status: IntakeGateStatus;
  readonly detail: string;
}

export type PilotReadinessStatus = "blocked" | "conditional" | "ready_for_pilot_design";

export interface PilotReadiness {
  readonly version: string;
  readonly status: PilotReadinessStatus;
  readonly gates: readonly IntakeGate[];
  readonly confirmedCount: number;
  readonly requiredConfirmationCount: number;
  readonly limitations: readonly string[];
}

/**
 * A conservative intake gate. "Ready" means ready to design a controlled pilot, never that the
 * imported data proves recovery or source independence. The declarations remain operator/customer
 * assertions until server-side source verification exists.
 */
export function assessPilotReadiness(
  result: AssessmentResult,
  declarations: PilotDeclarations,
): PilotReadiness {
  const dataGates: IntakeGate[] = [
    {
      id: "accepted_cycles",
      label: "Usable expectation cycles",
      status: result.acceptedCycleCount > 0 ? "pass" : "blocked",
      detail:
        result.acceptedCycleCount > 0
          ? `${result.acceptedCycleCount} accepted cycle(s)`
          : "No rows survived validation; the pilot cannot be designed from this file.",
    },
    {
      id: "stalled_cohort",
      label: "Observable stalled cohort",
      status: result.stalledCount > 0 ? "pass" : "blocked",
      detail:
        result.stalledCount > 0
          ? `${result.stalledCount} stalled cycle(s) under the stamped policy`
          : "No stalled cycles were found under the current threshold and as-of date.",
    },
    {
      id: "reference_cohort",
      label: "Descriptive reference cohort",
      status: result.referenceCount > 0 ? "pass" : "needs_confirmation",
      detail:
        result.referenceCount > 0
          ? `${result.referenceCount} confirmed non-deviant cycle(s); this is not yet a causal baseline.`
          : "No confirmed non-deviant cycles are present for descriptive comparison.",
    },
  ];

  const declarationGates: IntakeGate[] = (Object.keys(DECLARATION_LABELS) as (keyof PilotDeclarations)[]).map(
    (key) => ({
      id: key,
      label: DECLARATION_LABELS[key],
      status: declarations[key] ? "pass" : "needs_confirmation",
      detail: declarations[key]
        ? "Confirmed for pilot design; source verification still required."
        : "Not yet confirmed.",
    }),
  );

  const gates = [...dataGates, ...declarationGates];
  const hasBlocker = gates.some((gate) => gate.status === "blocked");
  const hasOpenGate = gates.some((gate) => gate.status === "needs_confirmation");
  const status: PilotReadinessStatus = hasBlocker
    ? "blocked"
    : hasOpenGate
      ? "conditional"
      : "ready_for_pilot_design";

  return Object.freeze({
    version: INTAKE_KIT_VERSION,
    status,
    gates: Object.freeze(gates),
    confirmedCount: declarationGates.filter((gate) => gate.status === "pass").length,
    requiredConfirmationCount: declarationGates.length,
    limitations: Object.freeze([
      "Readiness does not prove detector precision, causality, recovered revenue or willingness to pay.",
      "Uploaded CSV provenance and source independence are self-declared until server-side verification.",
      "Observed unpaid remains observed data only; it is not Revenue Returned or Auditable Revenue.",
    ]),
  });
}

export interface IntakeManifest {
  readonly manifestVersion: string;
  readonly assessmentId: string;
  readonly sourceFingerprint: string;
  readonly policyId: string;
  readonly readiness: PilotReadiness;
  readonly declarations: PilotDeclarations;
  readonly counts: {
    readonly accepted: number;
    readonly excluded: number;
    readonly stalled: number;
    readonly undetermined: number;
    readonly reference: number;
  };
  readonly claimBoundary: {
    readonly observedOnly: true;
    readonly claimsRealRevenue: false;
    readonly claimsCausality: false;
  };
}

export function buildIntakeManifest(
  result: AssessmentResult,
  declarations: PilotDeclarations,
): IntakeManifest {
  return Object.freeze({
    manifestVersion: INTAKE_KIT_VERSION,
    assessmentId: result.assessmentId,
    sourceFingerprint: `${result.fingerprintAlgo}:${result.sourceFingerprint}`,
    policyId: `${result.policy.policyId}@${result.policy.policyVersion}`,
    readiness: assessPilotReadiness(result, declarations),
    declarations: Object.freeze({ ...declarations }),
    counts: Object.freeze({
      accepted: result.acceptedCycleCount,
      excluded: result.excludedRowCount,
      stalled: result.stalledCount,
      undetermined: result.undeterminedCount,
      reference: result.referenceCount,
    }),
    claimBoundary: Object.freeze({
      observedOnly: true,
      claimsRealRevenue: false,
      claimsCausality: false,
    }),
  });
}

export function serializeIntakeManifest(manifest: IntakeManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

export function buildDataRequestGuide(): string {
  return [
    "# NH Activation Recovery — Data Intake Kit v1",
    "",
    "## Purpose",
    "Prepare a controlled customer pilot without confusing observed exposure with proven recovery.",
    "",
    "## Required joined fields",
    "- entity_id — stable customer/account identifier",
    "- signed_at — contract or subscription start date",
    "- next_invoice_due_at — due date of the next invoice",
    "- next_invoice_amount — gross invoice amount",
    "- currency — ISO currency code; one currency per assessment",
    "",
    "## Strongly recommended fields",
    "- subscription_id or cycle_id — stable cycle-level join key",
    "- activation_at — customer-confirmed activation milestone timestamp",
    "- next_invoice_paid_at and paid_amount — observed settlement evidence",
    "- refunded_at and cancelled_at — reversal and terminal-state evidence",
    "- plan, segment and product — matching dimensions for cohort comparison",
    "- intervention timestamp, owner and action — supplied separately for the treated pilot cohort",
    "",
    "## Source-of-record map",
    "Document the source system and data owner for every field. CRM normally supports signature;",
    "product telemetry supports activation; billing supports payment, refund and cancellation.",
    "A CSV declaration does not by itself prove that any source is independent or tamper-resistant.",
    "",
    "## Before the pilot starts",
    "1. Confirm the activation definition and stall threshold.",
    "2. Confirm the stable join key across CRM, product and billing.",
    "3. Identify historical untreated cycles for baseline design.",
    "4. Freeze the baseline method and recovery definition before outcomes are known.",
    "5. Confirm action ownership, intervention timestamps and reversal coverage.",
    "",
    "## Claim boundary",
    "The intake assessment may report observed unpaid value. It cannot claim causality, Revenue Returned",
    "or Auditable Revenue. Those require a governed intervention and independently verified proof.",
  ].join("\n");
}
