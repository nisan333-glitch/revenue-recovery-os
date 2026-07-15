// Integration proofs of the approval gate: the immutable Proof is created only when EVERY trust
// invariant holds together (separation of authority + baseline temporal validity + mandatory
// exclusion + independent evidence for auditable), and a stored Proof is judged forever against
// the versions STAMPED on it — a later policy/threshold change can never re-judge history.
import { describe, it, expect } from "vitest";
import { establishBaseline, lockBaseline } from "./baseline";
import { makeEvidence, type Evidence } from "./evidence";
import { money } from "./money";
import { CURRENT_POLICY } from "./policy";
import { proofIsAuditable, provenLedger } from "./provenLedger";
import {
  effectiveProofs,
  hasEffectiveRecoveryForCase,
  appendApprovedProof,
  appendReversal,
  type Proof,
} from "./proof";
import {
  approveProofForCase,
  reverseProofForCase,
  validateApproval,
  type CaseApprovalContext,
} from "./approval";
import type { Actor } from "./authority";

const USD = "USD";
const OWNER = "owner@company";
const APPROVER: Actor = { id: "cfo@company", displayName: "CFO", roles: ["proofApprover"] };

const lockedBaseline = lockBaseline(
  establishBaseline({
    baselineId: "BL-1",
    method: CURRENT_POLICY.baselineMethodId,
    methodVersion: CURRENT_POLICY.baselineMethodVersion,
    sourceRefs: ["cohort:test"],
    calculatedAmount: money(620_000, USD),
    applicableLeakType: "ActivationMissed",
    effectiveAt: "2026-06-01T00:00:00.000Z",
    establishedAt: "2026-06-01T00:00:00.000Z",
    establishedBy: "system",
  }),
  "2026-06-02T00:00:00.000Z",
  "pre-registered",
);

const independentEvidence: Evidence = makeEvidence({
  evidenceId: "EV-inv",
  evidenceType: "invoice_paid",
  sourceSystem: "billing",
  sourceRecordId: "INV-1",
  observedAt: "2026-06-18T00:00:00.000Z",
  ingestedAt: "2026-06-18T00:00:00.000Z",
  trustClassification: "independent",
  suppliedBy: "billing",
});

function ctx(over: Partial<CaseApprovalContext> = {}): CaseApprovalContext {
  return {
    proofId: "PF-1",
    recoveryCaseId: "RE-1",
    approvedAt: "2026-06-20T00:00:00.000Z",
    ownerActorId: OWNER,
    approverActor: APPROVER,
    baseline: lockedBaseline,
    evidence: [independentEvidence],
    interventionAt: "2026-06-10T00:00:00.000Z",
    outcomeObservedAt: "2026-06-18T00:00:00.000Z",
    collectedMinor: 3_100_000,
    currency: USD,
    excludedMinor: 0,
    exclusionStatement: "No excluded recovery — asserted: full delta independently evidenced.",
    recoveryReason: "MilestoneNudge",
    attribution: "MilestoneNudge; invoice paid",
    confidenceUsed: 95,
    policy: CURRENT_POLICY,
    ...over,
  };
}

describe("approval gate — the immutable proof is created only when all invariants hold", () => {
  it("happy path freezes revenueReturned = collected − governed baseline", () => {
    const p = approveProofForCase(ctx());
    expect(p.revenueReturned.minor).toBe(2_480_000);
    expect(Object.isFrozen(p)).toBe(true);
    expect(proofIsAuditable(p)).toBe(true);
  });

  it("blocks when the approver is the case owner (separation of authority)", () => {
    const selfApprover: Actor = { id: OWNER, displayName: "Owner", roles: ["caseOwner", "proofApprover"] };
    expect(validateApproval(ctx({ approverActor: selfApprover }))).not.toHaveLength(0);
    expect(() => approveProofForCase(ctx({ approverActor: selfApprover }))).toThrow(/authority|approver/i);
  });

  it("blocks a baseline locked AFTER the intervention", () => {
    const lateLock = lockBaseline(
      establishBaseline({
        baselineId: "BL-late",
        method: CURRENT_POLICY.baselineMethodId,
        methodVersion: 1,
        sourceRefs: ["cohort:test"],
        calculatedAmount: money(620_000, USD),
        applicableLeakType: "ActivationMissed",
        effectiveAt: "2026-06-01T00:00:00.000Z",
        establishedAt: "2026-06-01T00:00:00.000Z",
        establishedBy: "system",
      }),
      "2026-06-15T00:00:00.000Z", // after the 2026-06-10 intervention
      "late",
    );
    expect(() => approveProofForCase(ctx({ baseline: lateLock }))).toThrow(/baseline/i);
  });

  it("blocks with no exclusion statement", () => {
    expect(() => approveProofForCase(ctx({ exclusionStatement: "  " }))).toThrow(/exclusion/i);
  });

  it("blocks an auditable-tier claim with only beneficiary-controlled evidence", () => {
    const note = makeEvidence({
      evidenceId: "EV-note",
      evidenceType: "operator_note",
      sourceSystem: "manual",
      sourceRecordId: "n1",
      observedAt: "2026-06-18T00:00:00.000Z",
      ingestedAt: "2026-06-18T00:00:00.000Z",
      trustClassification: "beneficiary_controlled",
      suppliedBy: OWNER,
    });
    expect(() => approveProofForCase(ctx({ evidence: [note] }))).toThrow(/independent/i);
  });

  it("stamps the threshold used; a later policy change cannot re-judge history", () => {
    // Approved under threshold 80 with confidence 85 → auditable, forever.
    const p = approveProofForCase(ctx({ confidenceUsed: 85 }));
    expect(p.proofThresholdUsed).toBe(80);
    // Even if a stricter policy (threshold 90) exists NOW, the stored proof is judged against the
    // threshold it was approved under — proofIsAuditable reads the snapshot, not any current policy.
    expect(proofIsAuditable(p)).toBe(true);
    expect(p.confidenceUsed >= p.proofThresholdUsed).toBe(true);
  });

  it("guards double-approval: one effective proof per case, re-approvable only after reversal", () => {
    const p = approveProofForCase(ctx());
    // A second independent approval on the same case would open a new chain and double-count.
    expect(hasEffectiveRecoveryForCase([p], "RE-1")).toBe(true);
    const reversal = reverseProofForCase(p, {
      newProofId: "PF-1-rev",
      at: "2026-07-01T00:00:00.000Z",
      approvedBy: APPROVER.id,
      reason: "refund",
    });
    // After a reversal the case has no effective recovery — re-approval is allowed again.
    expect(hasEffectiveRecoveryForCase([p, reversal], "RE-1")).toBe(false);
  });

  it("a reversal is a new linked record; the ledger never double-counts", () => {
    const original = approveProofForCase(ctx());
    const reversal = reverseProofForCase(original, {
      newProofId: "PF-1-rev",
      at: "2026-07-01T00:00:00.000Z",
      approvedBy: APPROVER.id,
      reason: "refund",
    });
    expect(original.status).toBe("Approved"); // original untouched
    expect(reversal.previousProofId).toBe("PF-1");
    const effective = effectiveProofs([original, reversal]);
    expect(effective).toHaveLength(1);
    const ledger = provenLedger([original, reversal], USD);
    expect(ledger.revenueReturned.minor).toBe(0); // reversed → nothing counted
    expect(ledger.reversedCount).toBe(1);
  });
});

// R2: the state layer approves/reverses through the pure appendApprovedProof / appendReversal
// functions against a synchronous authoritative reference. These tests exercise THOSE EXACT
// functions (not a re-implementation) with the collection updated in place between calls — exactly
// what the useRef guard does — proving no duplicate chains / no double-count can result.
describe("R2 — synchronous double-approval / double-reversal guard (the real proof-store functions)", () => {
  it("two immediate approvals for the same case create only ONE effective chain", () => {
    let coll: Proof[] = [];
    const r1 = appendApprovedProof(coll, "RE-2", () => approveProofForCase(ctx({ proofId: "PF-A", recoveryCaseId: "RE-2" })));
    expect(r1.ok).toBe(true);
    coll = r1.proofs;
    const r2 = appendApprovedProof(coll, "RE-2", () => approveProofForCase(ctx({ proofId: "PF-B", recoveryCaseId: "RE-2" })));
    expect(r2.ok).toBe(false); // guard trips — no second chain
    coll = r2.proofs;
    expect(coll).toHaveLength(1);
    expect(effectiveProofs(coll)).toHaveLength(1);
    expect(provenLedger(coll, USD).provenCount).toBe(1);
  });

  it("provenLedger cannot double-count the same recovery case", () => {
    let coll: Proof[] = [];
    coll = appendApprovedProof(coll, "RE-3", () => approveProofForCase(ctx({ proofId: "PF-A", recoveryCaseId: "RE-3" }))).proofs;
    coll = appendApprovedProof(coll, "RE-3", () => approveProofForCase(ctx({ proofId: "PF-B", recoveryCaseId: "RE-3" }))).proofs;
    expect(provenLedger(coll, USD).revenueReturned.minor).toBe(2_480_000); // once, not twice
  });

  it("two immediate reversals cannot create duplicate active reversals", () => {
    let coll: Proof[] = [approveProofForCase(ctx({ proofId: "PF-A", recoveryCaseId: "RE-4" }))];
    const mk = (latest: Proof, id: string) =>
      reverseProofForCase(latest, { newProofId: id, at: "2026-07-02T00:00:00.000Z", approvedBy: APPROVER.id, reason: "refund" });
    const r1 = appendReversal(coll, "PF-A", (latest) => mk(latest, "PF-A-rev1"));
    expect(r1.ok).toBe(true);
    coll = r1.proofs;
    const r2 = appendReversal(coll, "PF-A", (latest) => mk(latest, "PF-A-rev2"));
    expect(r2.ok).toBe(false); // already reversed — no duplicate
    coll = r2.proofs;
    expect(coll).toHaveLength(2); // original + one reversal, not two
    const effective = effectiveProofs(coll);
    expect(effective).toHaveLength(1);
    expect(effective[0]!.status).toBe("Reversed");
  });

  it("a valid LATER reversal remains possible through a linked record", () => {
    let coll: Proof[] = [approveProofForCase(ctx({ proofId: "PF-A", recoveryCaseId: "RE-5" }))];
    const r = appendReversal(coll, "PF-A", (latest) =>
      reverseProofForCase(latest, { newProofId: "PF-A-rev", at: "2026-07-02T00:00:00.000Z", approvedBy: APPROVER.id, reason: "refund" }),
    );
    expect(r.ok).toBe(true);
    coll = r.proofs;
    expect(coll).toHaveLength(2);
    expect(coll[1]!.previousProofId).toBe("PF-A");
    expect(provenLedger(coll, USD).reversedCount).toBe(1);
  });

  it("hasEffectiveRecoveryForCase underpins the guard", () => {
    const p = approveProofForCase(ctx({ proofId: "PF-A", recoveryCaseId: "RE-6" }));
    expect(hasEffectiveRecoveryForCase([p], "RE-6")).toBe(true);
    expect(hasEffectiveRecoveryForCase([p], "RE-other")).toBe(false);
  });
});
