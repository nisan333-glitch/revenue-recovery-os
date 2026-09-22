export type SyntheticScenarioId = "successful_recovery" | "human_rejection" | "unverified_evidence";

export type SyntheticPilotStage =
  | "candidate_review"
  | "case_open"
  | "action_recorded"
  | "evidence_received"
  | "proof_approved"
  | "rejected"
  | "proof_blocked";

export interface SyntheticScenarioDefinition {
  readonly id: SyntheticScenarioId;
  readonly label: string;
  readonly account: string;
  readonly opportunityMinor: number;
  readonly baselineMinor: number;
  readonly observedCollectionMinor: number;
  readonly currency: "USD";
  readonly expectedDecision: "prove" | "reject" | "block";
  readonly evidenceTrust: "verified_independent" | "not_applicable" | "beneficiary_controlled";
}

export interface SyntheticScenarioState {
  readonly definition: SyntheticScenarioDefinition;
  readonly stage: SyntheticPilotStage;
}

export interface SyntheticAuditEntry {
  readonly sequence: number;
  readonly actor: string;
  readonly action: string;
  readonly result: string;
}

export const SYNTHETIC_SCENARIOS: readonly SyntheticScenarioDefinition[] = Object.freeze([
  Object.freeze({
    id: "successful_recovery",
    label: "Verified recovery",
    account: "SYNTHETIC Account Alpha",
    opportunityMinor: 1_000_000,
    baselineMinor: 200_000,
    observedCollectionMinor: 700_000,
    currency: "USD",
    expectedDecision: "prove",
    evidenceTrust: "verified_independent",
  }),
  Object.freeze({
    id: "human_rejection",
    label: "Human rejection",
    account: "SYNTHETIC Account Beta",
    opportunityMinor: 1_800_000,
    baselineMinor: 0,
    observedCollectionMinor: 0,
    currency: "USD",
    expectedDecision: "reject",
    evidenceTrust: "not_applicable",
  }),
  Object.freeze({
    id: "unverified_evidence",
    label: "Insufficient evidence",
    account: "SYNTHETIC Account Gamma",
    opportunityMinor: 1_200_000,
    baselineMinor: 300_000,
    observedCollectionMinor: 900_000,
    currency: "USD",
    expectedDecision: "block",
    evidenceTrust: "beneficiary_controlled",
  }),
]);

export function initialSyntheticPilot(): readonly SyntheticScenarioState[] {
  return SYNTHETIC_SCENARIOS.map((definition) => Object.freeze({ definition, stage: "candidate_review" }));
}

export function advanceSyntheticScenario(state: SyntheticScenarioState): SyntheticScenarioState {
  const next = nextStage(state.definition.expectedDecision, state.stage);
  if (!next) return state;
  return Object.freeze({ ...state, stage: next });
}

export function syntheticRevenueReturnedMinor(state: SyntheticScenarioState): number {
  if (state.stage !== "proof_approved") return 0;
  return Math.max(0, state.definition.observedCollectionMinor - state.definition.baselineMinor);
}

export function syntheticAuditableRevenueMinor(state: SyntheticScenarioState): number {
  return state.definition.evidenceTrust === "verified_independent"
    ? syntheticRevenueReturnedMinor(state)
    : 0;
}

export function syntheticPilotTotals(states: readonly SyntheticScenarioState[]) {
  return Object.freeze({
    opportunityMinor: states.reduce((sum, state) => sum + state.definition.opportunityMinor, 0),
    revenueReturnedMinor: states.reduce((sum, state) => sum + syntheticRevenueReturnedMinor(state), 0),
    auditableRevenueMinor: states.reduce((sum, state) => sum + syntheticAuditableRevenueMinor(state), 0),
    stoppedCount: states.filter((state) => state.stage === "rejected" || state.stage === "proof_blocked").length,
  });
}

export function syntheticAuditTrail(state: SyntheticScenarioState): readonly SyntheticAuditEntry[] {
  const entries: SyntheticAuditEntry[] = [
    { sequence: 1, actor: "activation-deadline-v1", action: "Candidate emitted", result: "Pending human review" },
  ];
  const add = (actor: string, action: string, result: string) =>
    entries.push({ sequence: entries.length + 1, actor, action, result });

  if (state.stage === "candidate_review") return entries;
  if (state.stage === "rejected") {
    add("SYNTHETIC operator", "Review rejected", "No Recovery Case created");
    return entries;
  }
  add("SYNTHETIC operator", "Review accepted", "Recovery Case opened");
  if (state.stage === "case_open") return entries;
  add("SYNTHETIC owner", "Activation play recorded", "Fix completed; outcome pending");
  if (state.stage === "action_recorded") return entries;
  add(
    state.definition.evidenceTrust === "verified_independent" ? "SYNTHETIC billing source" : "SYNTHETIC beneficiary",
    "Outcome evidence received",
    state.definition.evidenceTrust === "verified_independent" ? "Ed25519 receipt verified" : "Source authenticity unverified",
  );
  if (state.stage === "evidence_received") return entries;
  if (state.stage === "proof_blocked") {
    add("Proof gate", "Approval blocked", "Revenue Returned and Auditable Revenue remain zero");
    return entries;
  }
  add("SYNTHETIC finance approver", "Proof approved", "Immutable proof and CFO export available");
  return entries;
}

export function nextSyntheticAction(state: SyntheticScenarioState): string | null {
  switch (state.stage) {
    case "candidate_review":
      return state.definition.expectedDecision === "reject" ? "Reject candidate" : "Accept and open case";
    case "case_open":
      return "Record activation play";
    case "action_recorded":
      return "Submit outcome evidence";
    case "evidence_received":
      return state.definition.expectedDecision === "block" ? "Apply proof gate" : "Approve governed proof";
    default:
      return null;
  }
}

function nextStage(
  decision: SyntheticScenarioDefinition["expectedDecision"],
  stage: SyntheticPilotStage,
): SyntheticPilotStage | null {
  if (stage === "candidate_review") return decision === "reject" ? "rejected" : "case_open";
  if (stage === "case_open") return "action_recorded";
  if (stage === "action_recorded") return "evidence_received";
  if (stage === "evidence_received") return decision === "block" ? "proof_blocked" : "proof_approved";
  return null;
}
