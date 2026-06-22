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
      leakageType: "FailedPayment",
      recoveryReason: "DunningRetry",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 24000,
      baselineAmount: 4800,
      collectedAmount: 24000,
      confidence: 94,
      actionsTaken: [
        "Smart retry scheduled for 09:00 local",
        "Retry #2 succeeded via Visa",
      ],
      evidenceNotes:
        "Stripe charge ch_3Qxx succeeded on retry #2. Invoice INV-8841 marked paid. Customer confirmed continued subscription.",
      createdAt: "2026-05-02T08:10:00.000Z",
      updatedAt: "2026-05-03T07:02:00.000Z",
      audit: [
        entry("2026-05-02T08:10:00.000Z", "system", "created", "Detected failed renewal payment ($24,000)"),
        entry("2026-05-02T08:12:00.000Z", "system", "assigned", "Auto-assigned to Dana Levy"),
        entry("2026-05-02T08:15:00.000Z", "Dana Levy", "action_added", "Scheduled smart retry"),
        entry("2026-05-03T07:02:00.000Z", "system", "status_changed", "Detected → Recovered (retry succeeded)"),
      ],
    } as Seed),
    make({
      eventId: "RE-1002",
      customer: "Globex SaaS",
      funnelStage: "Renewal",
      leakageType: "ExpiredCard",
      recoveryReason: "CardUpdater",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 9600,
      baselineAmount: 1900,
      collectedAmount: 9600,
      confidence: 88,
      actionsTaken: ["Account Updater refreshed card", "Auto-charged new card"],
      evidenceNotes:
        "Network account updater returned new expiry 11/29. Charge succeeded same day. Evidence: AU response logged.",
      createdAt: "2026-05-08T11:00:00.000Z",
      updatedAt: "2026-05-08T15:20:00.000Z",
      audit: [
        entry("2026-05-08T11:00:00.000Z", "system", "created", "Detected expired card on renewal"),
        entry("2026-05-08T11:05:00.000Z", "system", "reason_set", "Reason: Card Updater"),
        entry("2026-05-08T15:20:00.000Z", "system", "status_changed", "Recovered via Account Updater"),
      ],
    } as Seed),
    make({
      eventId: "RE-1003",
      customer: "Initech",
      funnelStage: "Onboarding",
      leakageType: "BillingError",
      recoveryReason: "BillingFix",
      owner: "Marcus Cole",
      status: "Recovered",
      riskAmount: 15000,
      baselineAmount: 0,
      collectedAmount: 15000,
      confidence: 91,
      actionsTaken: [
        "Identified misconfigured tax rule",
        "Corrected and re-issued invoice",
      ],
      evidenceNotes:
        "Tax rule blocked invoice finalization. Fixed config, re-issued INV-9002, paid within 24h. Finance approved.",
      createdAt: "2026-05-11T09:30:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
      audit: [
        entry("2026-05-11T09:30:00.000Z", "system", "created", "Detected billing error blocking collection"),
        entry("2026-05-11T10:00:00.000Z", "Marcus Cole", "action_added", "Diagnosed tax rule misconfig"),
        entry("2026-05-12T10:00:00.000Z", "Marcus Cole", "status_changed", "Recovered after billing fix"),
      ],
    } as Seed),
    make({
      eventId: "RE-1004",
      customer: "Umbrella Corp",
      funnelStage: "Expansion",
      leakageType: "Downgrade",
      recoveryReason: "DiscountOffer",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 18000,
      baselineAmount: 6000,
      collectedAmount: 16500,
      confidence: 83,
      actionsTaken: ["Offered 8% loyalty discount", "Customer retained on Pro tier"],
      evidenceNotes:
        "Account intended downgrade to Starter (baseline $6k). Save offer retained Pro at $16.5k. Signed order form attached.",
      createdAt: "2026-05-15T13:00:00.000Z",
      updatedAt: "2026-05-18T16:45:00.000Z",
      audit: [
        entry("2026-05-15T13:00:00.000Z", "system", "created", "Detected downgrade risk"),
        entry("2026-05-16T09:00:00.000Z", "Dana Levy", "action_added", "Extended save offer"),
        entry("2026-05-18T16:45:00.000Z", "Dana Levy", "status_changed", "Recovered — retained on Pro"),
      ],
    } as Seed),

    // --- Low-confidence recovery (counted, but NOT CFO-auditable) ---
    make({
      eventId: "RE-1005",
      customer: "Soylent Foods",
      funnelStage: "Renewal",
      leakageType: "InvoluntaryChurn",
      recoveryReason: "ManualOutreach",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 7200,
      baselineAmount: 3600,
      collectedAmount: 7200,
      confidence: 58,
      actionsTaken: ["AM emailed customer"],
      evidenceNotes:
        "Customer paid after outreach, but attribution unclear — they may have renewed regardless. Evidence weak.",
      createdAt: "2026-05-19T10:00:00.000Z",
      updatedAt: "2026-05-21T12:00:00.000Z",
      audit: [
        entry("2026-05-19T10:00:00.000Z", "system", "created", "Detected involuntary churn risk"),
        entry("2026-05-20T09:00:00.000Z", "Priya Nair", "action_added", "Manual outreach email"),
        entry("2026-05-21T12:00:00.000Z", "Priya Nair", "status_changed", "Recovered (low confidence)"),
      ],
    } as Seed),

    // --- Recovered WITHOUT a reason (NOT counted at all) ---
    make({
      eventId: "RE-1006",
      customer: "Vandelay Industries",
      funnelStage: "Checkout",
      leakageType: "AbandonedCheckout",
      recoveryReason: null,
      owner: null,
      status: "Recovered",
      riskAmount: 4300,
      baselineAmount: 0,
      collectedAmount: 4300,
      confidence: 35,
      actionsTaken: [],
      evidenceNotes:
        "Marked recovered but no recovery reason classified — excluded from all totals until triaged.",
      createdAt: "2026-05-22T14:00:00.000Z",
      updatedAt: "2026-05-22T18:00:00.000Z",
      audit: [
        entry("2026-05-22T14:00:00.000Z", "system", "created", "Detected abandoned checkout"),
        entry("2026-05-22T18:00:00.000Z", "system", "status_changed", "Recovered (unclassified)"),
      ],
    } as Seed),

    // --- Open opportunities (Detected / Queued / Assigned / InProgress) ---
    make({
      eventId: "RE-1007",
      customer: "Stark Solutions",
      funnelStage: "Renewal",
      leakageType: "FailedPayment",
      recoveryReason: "DunningRetry",
      owner: null,
      status: "Detected",
      riskAmount: 31000,
      baselineAmount: 6200,
      collectedAmount: 0,
      confidence: 20,
      actionsTaken: [],
      evidenceNotes: "Renewal charge failed (insufficient funds). Awaiting retry strategy.",
      createdAt: "2026-06-18T07:00:00.000Z",
      updatedAt: "2026-06-18T07:00:00.000Z",
      audit: [
        entry("2026-06-18T07:00:00.000Z", "system", "created", "Detected failed renewal ($31,000)"),
      ],
    } as Seed),
    make({
      eventId: "RE-1008",
      customer: "Wonka Industries",
      funnelStage: "Renewal",
      leakageType: "ExpiredCard",
      recoveryReason: null,
      owner: "Marcus Cole",
      status: "Assigned",
      riskAmount: 12500,
      baselineAmount: 2500,
      collectedAmount: 0,
      confidence: 30,
      actionsTaken: ["Triaged; will trigger card updater"],
      evidenceNotes: "Card expired. Assigned to Marcus for account-updater path.",
      createdAt: "2026-06-19T09:00:00.000Z",
      updatedAt: "2026-06-20T09:00:00.000Z",
      audit: [
        entry("2026-06-19T09:00:00.000Z", "system", "created", "Detected expired card"),
        entry("2026-06-20T09:00:00.000Z", "Marcus Cole", "assigned", "Assigned to Marcus Cole"),
      ],
    } as Seed),
    make({
      eventId: "RE-1009",
      customer: "Hooli",
      funnelStage: "Checkout",
      leakageType: "AbandonedCheckout",
      recoveryReason: "CheckoutRescue",
      owner: "Priya Nair",
      status: "InProgress",
      riskAmount: 8800,
      baselineAmount: 0,
      collectedAmount: 0,
      confidence: 45,
      actionsTaken: ["Sent checkout-rescue email", "Awaiting customer action"],
      evidenceNotes: "High-value cart abandoned at payment step. Rescue flow in progress.",
      createdAt: "2026-06-20T15:00:00.000Z",
      updatedAt: "2026-06-21T11:00:00.000Z",
      audit: [
        entry("2026-06-20T15:00:00.000Z", "system", "created", "Detected abandoned checkout"),
        entry("2026-06-21T11:00:00.000Z", "Priya Nair", "action_added", "Started checkout rescue"),
      ],
    } as Seed),
    make({
      eventId: "RE-1010",
      customer: "Pied Piper",
      funnelStage: "Renewal",
      leakageType: "FailedRenewal",
      recoveryReason: null,
      owner: null,
      status: "Queued",
      riskAmount: 19500,
      baselineAmount: 3900,
      collectedAmount: 0,
      confidence: 25,
      actionsTaken: [],
      evidenceNotes: "Renewal stalled; queued for owner assignment.",
      createdAt: "2026-06-21T08:00:00.000Z",
      updatedAt: "2026-06-21T08:30:00.000Z",
      audit: [
        entry("2026-06-21T08:00:00.000Z", "system", "created", "Detected stalled renewal"),
        entry("2026-06-21T08:30:00.000Z", "system", "status_changed", "Detected → Queued"),
      ],
    } as Seed),

    // --- Failed and Dismissed (for honest recovery rate) ---
    make({
      eventId: "RE-1011",
      customer: "Gringotts Ltd",
      funnelStage: "Renewal",
      leakageType: "InvoluntaryChurn",
      recoveryReason: "ManualOutreach",
      owner: "Dana Levy",
      status: "Failed",
      riskAmount: 14000,
      baselineAmount: 0,
      collectedAmount: 0,
      confidence: 15,
      actionsTaken: ["3 outreach attempts", "No response"],
      evidenceNotes: "Customer churned despite outreach. Counted as failed recovery.",
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
      audit: [
        entry("2026-05-25T10:00:00.000Z", "system", "created", "Detected churn risk"),
        entry("2026-06-05T10:00:00.000Z", "Dana Levy", "status_changed", "Recovery failed"),
      ],
    } as Seed),
    make({
      eventId: "RE-1012",
      customer: "Cyberdyne",
      funnelStage: "Trial",
      leakageType: "AbandonedCheckout",
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
        entry("2026-06-12T10:00:00.000Z", "system", "created", "Detected abandoned checkout"),
        entry("2026-06-12T12:00:00.000Z", "Marcus Cole", "status_changed", "Dismissed as duplicate"),
      ],
    } as Seed),
    make({
      eventId: "RE-1013",
      customer: "Tyrell Corp",
      funnelStage: "Renewal",
      leakageType: "FailedPayment",
      recoveryReason: "PaymentMethodSwitch",
      owner: "Priya Nair",
      status: "Recovered",
      riskAmount: 21000,
      baselineAmount: 4200,
      collectedAmount: 21000,
      confidence: 86,
      actionsTaken: ["Prompted ACH switch", "ACH debit cleared"],
      evidenceNotes:
        "Card repeatedly failed; customer switched to ACH. Debit cleared, INV-9120 paid. Bank confirmation attached.",
      createdAt: "2026-05-28T09:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      audit: [
        entry("2026-05-28T09:00:00.000Z", "system", "created", "Detected repeated card failures"),
        entry("2026-05-30T09:00:00.000Z", "Priya Nair", "action_added", "Prompted ACH switch"),
        entry("2026-06-02T09:00:00.000Z", "Priya Nair", "status_changed", "Recovered via ACH"),
      ],
    } as Seed),
    make({
      eventId: "RE-1014",
      customer: "Wayne Enterprises",
      funnelStage: "Renewal",
      leakageType: "FailedRenewal",
      recoveryReason: "RenewalNudge",
      owner: "Dana Levy",
      status: "Recovered",
      riskAmount: 13200,
      baselineAmount: 2600,
      collectedAmount: 13200,
      confidence: 81,
      actionsTaken: ["Sent renewal nudge with usage report"],
      evidenceNotes:
        "Stalled renewal completed after value-based nudge. Order form signed; evidence in CRM opportunity.",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-09T09:00:00.000Z",
      audit: [
        entry("2026-06-01T09:00:00.000Z", "system", "created", "Detected stalled renewal"),
        entry("2026-06-09T09:00:00.000Z", "Dana Levy", "status_changed", "Recovered via nudge"),
      ],
    } as Seed),
  ];

  return raw;
}
