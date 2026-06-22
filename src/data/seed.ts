// Realistic seed data covering every state the product must distinguish:
// open opportunity, proof-grade recovery, low-confidence recovery,
// unclassified (uncounted) recovery, failed, and dismissed.
import type { RecoveryEvent, AuditEntry } from "../domain/types";
import { withDerivedReturn } from "../domain/invariants";

let aud = 0;
function entry(
  at: string,
  actor: string,
  type: AuditEntry["type"],
  summary: string,
): AuditEntry {
  aud += 1;
  return { id: `seed_aud_${aud}`, at, actor, type, summary };
}

type Seed = Omit<RecoveryEvent, "revenueReturned"> & { revenueReturned?: number };

function make(s: Seed): RecoveryEvent {
  return withDerivedReturn({ ...s, revenueReturned: 0 } as RecoveryEvent);
}

export function seedEvents(): RecoveryEvent[] {
  const raw: RecoveryEvent[] = [
    // --- Proof-grade recoveries (CFO auditable) ---
    make({
      eventId: "RE-1001",
      customer: "Northwind Trading",
      funnelStage: "Renewal",
      leakageType: "RenewalAtRisk",
      recoveryReason: "RenewalOutreach",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 24000,
      baselineAmount: 4800,
      collectedAmount: 24000,
      confidence: 94,
      actionsTaken: [
        "Direct renewal outreach with ROI/usage recap",
        "Second invoice confirmed before term lapse",
      ],
      evidenceNotes:
        "Renewal stalled at term end. CSM-led outreach with an ROI recap closed it; second invoice INV-8841 paid. Baseline = matched-cohort renewal rate without outreach.",
      createdAt: "2026-05-02T08:10:00.000Z",
      updatedAt: "2026-05-03T07:02:00.000Z",
      audit: [
        entry("2026-05-02T08:10:00.000Z", "system", "created", "Detected stalled renewal — second invoice at risk ($24,000)"),
        entry("2026-05-02T08:12:00.000Z", "system", "assigned", "Auto-assigned to Dana Levy"),
        entry("2026-05-02T08:15:00.000Z", "Dana Levy", "action_added", "Sent renewal outreach with ROI recap"),
        entry("2026-05-03T07:02:00.000Z", "system", "status_changed", "Detected → Recovered (second invoice paid)"),
      ],
    } as Seed),
    make({
      eventId: "RE-1002",
      customer: "Globex SaaS",
      funnelStage: "Activation",
      leakageType: "ActivationMissed",
      recoveryReason: "MilestoneNudge",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 9600,
      baselineAmount: 1900,
      collectedAmount: 9600,
      confidence: 88,
      actionsTaken: ["Guided account to activation milestone", "Activation event reached"],
      evidenceNotes:
        "Account had not hit its activation milestone by day 30. A guided milestone nudge triggered activation; the next invoice cleared. Evidence: activation event logged + invoice paid.",
      createdAt: "2026-05-08T11:00:00.000Z",
      updatedAt: "2026-05-08T15:20:00.000Z",
      audit: [
        entry("2026-05-08T11:00:00.000Z", "system", "created", "Detected activation milestone missed by day 30"),
        entry("2026-05-08T11:05:00.000Z", "system", "reason_set", "Reason: Milestone Nudge"),
        entry("2026-05-08T15:20:00.000Z", "system", "status_changed", "Recovered — activation milestone reached"),
      ],
    } as Seed),
    make({
      eventId: "RE-1003",
      customer: "Initech",
      funnelStage: "Onboarding",
      leakageType: "StalledOnboarding",
      recoveryReason: "OnboardingReboot",
      owner: "Marcus Cole",
      status: "Recovered",
      riskAmount: 15000,
      baselineAmount: 0,
      collectedAmount: 15000,
      confidence: 91,
      actionsTaken: [
        "Re-kicked off onboarding with a fresh plan + owner",
        "Account went live; first invoice cleared",
      ],
      evidenceNotes:
        "Onboarding stalled post-signature (no kickoff for 3 weeks). Rebooted with a fresh plan and named owner; account activated and the invoice cleared. Finance approved.",
      createdAt: "2026-05-11T09:30:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
      audit: [
        entry("2026-05-11T09:30:00.000Z", "system", "created", "Detected stalled onboarding after signature"),
        entry("2026-05-11T10:00:00.000Z", "Marcus Cole", "action_added", "Re-kicked off onboarding with new plan"),
        entry("2026-05-12T10:00:00.000Z", "Marcus Cole", "status_changed", "Recovered — account activated"),
      ],
    } as Seed),
    make({
      eventId: "RE-1004",
      customer: "Umbrella Corp",
      funnelStage: "Expansion",
      leakageType: "ExpansionStalled",
      recoveryReason: "ExecBusinessReview",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 18000,
      baselineAmount: 6000,
      collectedAmount: 16500,
      confidence: 83,
      actionsTaken: ["Ran executive business review", "Expansion re-opened and signed"],
      evidenceNotes:
        "Expansion stalled; baseline $6k if it lapsed to a flat renewal. An EBR tied usage to ROI and re-opened the expansion at $16.5k. Signed order form attached.",
      createdAt: "2026-05-15T13:00:00.000Z",
      updatedAt: "2026-05-18T16:45:00.000Z",
      audit: [
        entry("2026-05-15T13:00:00.000Z", "system", "created", "Detected stalled expansion"),
        entry("2026-05-16T09:00:00.000Z", "Dana Levy", "action_added", "Ran executive business review"),
        entry("2026-05-18T16:45:00.000Z", "Dana Levy", "status_changed", "Recovered — expansion re-signed"),
      ],
    } as Seed),

    // --- Low-confidence recovery (counted, but NOT CFO-auditable) ---
    make({
      eventId: "RE-1005",
      customer: "Soylent Foods",
      funnelStage: "Onboarding",
      leakageType: "LowAdoption",
      recoveryReason: "CSMOutreach",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 7200,
      baselineAmount: 3600,
      collectedAmount: 7200,
      confidence: 58,
      actionsTaken: ["CSM outreach to unblock adoption"],
      evidenceNotes:
        "Low adoption threatened the next invoice. CSM outreach preceded payment, but attribution is unclear — they may have paid regardless. Evidence weak.",
      createdAt: "2026-05-19T10:00:00.000Z",
      updatedAt: "2026-05-21T12:00:00.000Z",
      audit: [
        entry("2026-05-19T10:00:00.000Z", "system", "created", "Detected low adoption risk"),
        entry("2026-05-20T09:00:00.000Z", "Priya Nair", "action_added", "CSM outreach email"),
        entry("2026-05-21T12:00:00.000Z", "Priya Nair", "status_changed", "Recovered (low confidence)"),
      ],
    } as Seed),

    // --- Recovered WITHOUT a reason (NOT counted at all) ---
    make({
      eventId: "RE-1006",
      customer: "Vandelay Industries",
      funnelStage: "FirstValue",
      leakageType: "NoFirstValue",
      recoveryReason: null,
      owner: null,
      status: "Recovered",
      riskAmount: 4300,
      baselineAmount: 0,
      collectedAmount: 4300,
      confidence: 35,
      actionsTaken: [],
      evidenceNotes:
        "Marked recovered but no recovery play classified — excluded from all totals until triaged.",
      createdAt: "2026-05-22T14:00:00.000Z",
      updatedAt: "2026-05-22T18:00:00.000Z",
      audit: [
        entry("2026-05-22T14:00:00.000Z", "system", "created", "Detected account with no first value"),
        entry("2026-05-22T18:00:00.000Z", "system", "status_changed", "Recovered (unclassified)"),
      ],
    } as Seed),

    // --- Open opportunities (Detected / Queued / Assigned / InProgress) ---
    make({
      eventId: "RE-1007",
      customer: "Stark Solutions",
      funnelStage: "Renewal",
      leakageType: "RenewalAtRisk",
      recoveryReason: "RenewalOutreach",
      owner: null,
      status: "Detected",
      riskAmount: 31000,
      baselineAmount: 6200,
      collectedAmount: 0,
      confidence: 20,
      actionsTaken: [],
      evidenceNotes: "Renewal / second invoice stalled (no response to renewal notice). Awaiting outreach play.",
      createdAt: "2026-06-18T07:00:00.000Z",
      updatedAt: "2026-06-18T07:00:00.000Z",
      audit: [
        entry("2026-06-18T07:00:00.000Z", "system", "created", "Detected stalled renewal — second invoice at risk ($31,000)"),
      ],
    } as Seed),
    make({
      eventId: "RE-1008",
      customer: "Wonka Industries",
      funnelStage: "Activation",
      leakageType: "ActivationMissed",
      recoveryReason: null,
      owner: "Marcus Cole",
      status: "Assigned",
      riskAmount: 12500,
      baselineAmount: 2500,
      collectedAmount: 0,
      confidence: 30,
      actionsTaken: ["Triaged; will guide to activation milestone"],
      evidenceNotes: "Activation milestone missed. Assigned to Marcus for a milestone nudge.",
      createdAt: "2026-06-19T09:00:00.000Z",
      updatedAt: "2026-06-20T09:00:00.000Z",
      audit: [
        entry("2026-06-19T09:00:00.000Z", "system", "created", "Detected activation milestone missed"),
        entry("2026-06-20T09:00:00.000Z", "Marcus Cole", "assigned", "Assigned to Marcus Cole"),
      ],
    } as Seed),
    make({
      eventId: "RE-1009",
      customer: "Hooli",
      funnelStage: "Onboarding",
      leakageType: "StalledOnboarding",
      recoveryReason: "OnboardingReboot",
      owner: "Priya Nair",
      status: "InProgress",
      riskAmount: 8800,
      baselineAmount: 0,
      collectedAmount: 0,
      confidence: 45,
      actionsTaken: ["Started onboarding reboot", "Awaiting first setup milestone"],
      evidenceNotes: "Onboarding stalled at the setup step after signature. Reboot flow in progress.",
      createdAt: "2026-06-20T15:00:00.000Z",
      updatedAt: "2026-06-21T11:00:00.000Z",
      audit: [
        entry("2026-06-20T15:00:00.000Z", "system", "created", "Detected stalled onboarding"),
        entry("2026-06-21T11:00:00.000Z", "Priya Nair", "action_added", "Started onboarding reboot"),
      ],
    } as Seed),
    make({
      eventId: "RE-1010",
      customer: "Pied Piper",
      funnelStage: "FirstValue",
      leakageType: "NoFirstValue",
      recoveryReason: null,
      owner: null,
      status: "Queued",
      riskAmount: 19500,
      baselineAmount: 3900,
      collectedAmount: 0,
      confidence: 25,
      actionsTaken: [],
      evidenceNotes: "Account live but has not reached first value; queued for owner assignment.",
      createdAt: "2026-06-21T08:00:00.000Z",
      updatedAt: "2026-06-21T08:30:00.000Z",
      audit: [
        entry("2026-06-21T08:00:00.000Z", "system", "created", "Detected no first value"),
        entry("2026-06-21T08:30:00.000Z", "system", "status_changed", "Detected → Queued"),
      ],
    } as Seed),

    // --- Failed and Dismissed (for honest recovery rate) ---
    make({
      eventId: "RE-1011",
      customer: "Gringotts Ltd",
      funnelStage: "Renewal",
      leakageType: "LowAdoption",
      recoveryReason: "CSMOutreach",
      owner: "Dana Levy",
      status: "Failed",
      riskAmount: 14000,
      baselineAmount: 0,
      collectedAmount: 0,
      confidence: 15,
      actionsTaken: ["3 CSM outreach attempts", "No response"],
      evidenceNotes: "Account churned despite CSM outreach. Counted as a failed recovery.",
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
      audit: [
        entry("2026-05-25T10:00:00.000Z", "system", "created", "Detected adoption / churn risk"),
        entry("2026-06-05T10:00:00.000Z", "Dana Levy", "status_changed", "Recovery failed"),
      ],
    } as Seed),
    make({
      eventId: "RE-1012",
      customer: "Cyberdyne",
      funnelStage: "Onboarding",
      leakageType: "StalledOnboarding",
      recoveryReason: null,
      owner: "Marcus Cole",
      status: "Dismissed",
      riskAmount: 2100,
      baselineAmount: 0,
      collectedAmount: 0,
      confidence: 10,
      actionsTaken: ["Reviewed — duplicate of RE-1009"],
      evidenceNotes: "False positive / duplicate signal. Dismissed.",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T12:00:00.000Z",
      audit: [
        entry("2026-06-12T10:00:00.000Z", "system", "created", "Detected stalled onboarding"),
        entry("2026-06-12T12:00:00.000Z", "Marcus Cole", "status_changed", "Dismissed as duplicate"),
      ],
    } as Seed),
    make({
      eventId: "RE-1013",
      customer: "Tyrell Corp",
      funnelStage: "FirstValue",
      leakageType: "NoFirstValue",
      recoveryReason: "EnablementSession",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 21000,
      baselineAmount: 4200,
      collectedAmount: 21000,
      confidence: 86,
      actionsTaken: ["Ran enablement session", "Account reached first value"],
      evidenceNotes:
        "Account was live but stuck before first value. An enablement session drove the first value event; the next invoice INV-9120 paid. Evidence: value event + invoice.",
      createdAt: "2026-05-28T09:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      audit: [
        entry("2026-05-28T09:00:00.000Z", "system", "created", "Detected account stuck before first value"),
        entry("2026-05-30T09:00:00.000Z", "Priya Nair", "action_added", "Ran enablement session"),
        entry("2026-06-02T09:00:00.000Z", "Priya Nair", "status_changed", "Recovered — first value reached"),
      ],
    } as Seed),
    make({
      eventId: "RE-1014",
      customer: "Wayne Enterprises",
      funnelStage: "Activation",
      leakageType: "ActivationMissed",
      recoveryReason: "UsageActivation",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 13200,
      baselineAmount: 2600,
      collectedAmount: 13200,
      confidence: 81,
      actionsTaken: ["Triggered in-product usage-activation flow"],
      evidenceNotes:
        "Activation milestone missed; an in-product usage-activation flow triggered the activation event and the next invoice cleared. Order/usage logged in CRM.",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-09T09:00:00.000Z",
      audit: [
        entry("2026-06-01T09:00:00.000Z", "system", "created", "Detected activation milestone missed"),
        entry("2026-06-09T09:00:00.000Z", "Dana Levy", "status_changed", "Recovered via usage activation"),
      ],
    } as Seed),
  ];

  return raw;
}
