// A PROOF ALREADY IN A BROWSER'S STORAGE CANNOT SURVIVE THE GATE EITHER.
//
// The seed is only one of two ways an unattestable proof reaches a screen. The other is storage: a
// browser that used the app before the Option 1 correction holds seven approved proofs for mechanisms
// no source attests, and changing `seedTrust.ts` does nothing for it — `readTrust()` finds the stored
// value and returns it. That is the quiet half of this kind of correction, and it is the half that
// would have left the old $83,400 on a real user's CFO screen.
//
// THE KEY BUMP IS NOT THE GUARD. `rros.trust.v1` → `.v2` re-seeds an existing browser once, and a
// test that only asserted the new key would prove the migration and not the property. These tests
// write directly to the `.v2` key — the state a hand-edited store, an older build, or a future
// regression would produce — and assert the proof is dropped on read anyway.
import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStorageRepo } from "./localStorageRepo";
import { seedTrust } from "./seedTrust";
import { provenLedger } from "../domain/provenLedger";
import { approveProofForCase } from "../domain/approval";
import { establishBaseline, lockBaseline } from "../domain/baseline";
import { makeEvidence } from "../domain/evidence";
import { money } from "../domain/money";
import { CURRENT_POLICY } from "../domain/policy";
import type { Proof } from "../domain/proof";
import type { TrustStore } from "./repository";

const V2_TRUST_KEY = "rros.trust.v2";
const V1_TRUST_KEY = "rros.trust.v1";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function setStorage(s: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
}

/**
 * A proof for an unattestable mechanism, built the way the OLD code built one.
 *
 * It cannot be built through `approveProofForCase` any more — that is the whole point of the slice —
 * so it is assembled from a legitimately approved proof with the reason swapped. That is exactly the
 * shape a pre-correction store holds: a well-formed, frozen, correctly-signed proof whose only defect
 * is a mechanism nothing attests.
 */
function legacyUnattestableProof(): Proof {
  const baseline = lockBaseline(
    establishBaseline({
      baselineId: "BL-legacy",
      method: CURRENT_POLICY.baselineMethodId,
      methodVersion: CURRENT_POLICY.baselineMethodVersion,
      sourceRefs: ["cohort:legacy"],
      calculatedAmount: money(260_000, "USD"),
      applicableLeakType: "RevenueUnderBilled",
      effectiveAt: "2026-06-01T00:00:00.000Z",
      establishedAt: "2026-06-01T00:00:00.000Z",
      establishedBy: "system",
    }),
    "2026-06-02T00:00:00.000Z",
    "pre-registered",
  );
  const real = approveProofForCase({
    proofId: "PF-RE-LEGACY",
    recoveryCaseId: "RE-LEGACY",
    approvedAt: "2026-06-20T00:00:00.000Z",
    ownerActorId: "dana@company",
    approverActor: { id: "cfo@company", displayName: "CFO", roles: ["proofApprover"] },
    baseline,
    evidence: [
      makeEvidence({
        evidenceId: "EV-legacy-fix", evidenceType: "corrective_invoice_issued", sourceSystem: "billing",
        sourceRecordId: "CN-L", observedAt: "2026-06-10T00:00:00.000Z", ingestedAt: "2026-06-10T00:00:00.000Z",
        trustClassification: "independent", suppliedBy: "billing",
      }),
      makeEvidence({
        evidenceId: "EV-legacy-paid", evidenceType: "invoice_paid", sourceSystem: "billing",
        sourceRecordId: "INV-L", observedAt: "2026-06-18T00:00:00.000Z", ingestedAt: "2026-06-18T00:00:00.000Z",
        trustClassification: "independent", suppliedBy: "billing",
      }),
    ],
    interventionAt: "2026-06-05T00:00:00.000Z",
    outcomeObservedAt: "2026-06-18T00:00:00.000Z",
    collectedMinor: 1_320_000,
    currency: "USD",
    excludedMinor: 0,
    exclusionStatement: "No excluded recovery — asserted.",
    recoveryReason: "BillingCorrection",
    attribution: "legacy",
    confidenceUsed: 95,
    policy: CURRENT_POLICY,
    recoveryType: "RevenueUnderBilled",
  });
  // The swap: a frozen, well-formed proof carrying a mechanism with no declared channel.
  return { ...real, recoveryReason: "UsageActivation" } as Proof;
}

describe("a stored proof for an unattestable mechanism is dropped on READ", () => {
  beforeEach(() => setStorage(memStorage()));

  it("1 · the control: a legitimate stored proof IS returned, so the filter is not just deleting everything", () => {
    // A guard that drops the input unconditionally is not a guard. Before asserting what gets dropped,
    // assert that something survives.
    const legit = seedTrust();
    localStorage.setItem(V2_TRUST_KEY, JSON.stringify(legit));
    const repo = createLocalStorageRepo();
    expect(repo.loadTrust().proofs).toHaveLength(1);
    expect(repo.loadTrust().proofs[0]!.recoveryCaseId).toBe("RE-1015");
    expect(provenLedger(repo.loadTrust().proofs, "USD").revenueReturned.minor).toBe(550_000);
  });

  it("2 · an unattestable proof written to the CURRENT key is still refused", () => {
    const poisoned: TrustStore = { baselines: [], proofs: [legacyUnattestableProof()], evidenceByCase: {} };
    localStorage.setItem(V2_TRUST_KEY, JSON.stringify(poisoned));
    const repo = createLocalStorageRepo();
    expect(repo.loadTrust().proofs).toEqual([]);
    // And it contributes nothing to any figure.
    const ledger = provenLedger(repo.loadTrust().proofs, "USD");
    expect(ledger.revenueReturned.minor).toBe(0);
    expect(ledger.auditableRevenue.minor).toBe(0);
    expect(ledger.provenCount).toBe(0);
  });

  it("3 · a MIXED store keeps the admissible proof and drops the rest", () => {
    const mixed: TrustStore = {
      baselines: [], evidenceByCase: {},
      proofs: [legacyUnattestableProof(), ...seedTrust().proofs],
    };
    localStorage.setItem(V2_TRUST_KEY, JSON.stringify(mixed));
    const repo = createLocalStorageRepo();
    const kept = repo.loadTrust().proofs;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.recoveryReason).toBe("BillingCorrection");
  });

  it("4 · the stored BYTES are not destroyed — the proof is dropped on read, not deleted", () => {
    const poisoned: TrustStore = { baselines: [], proofs: [legacyUnattestableProof()], evidenceByCase: {} };
    const raw = JSON.stringify(poisoned);
    localStorage.setItem(V2_TRUST_KEY, raw);
    createLocalStorageRepo();
    // Nothing is counted from it, and nothing was erased either: the record of what a prior build
    // believed is left intact, which is this repository's rule for superseded conclusions.
    expect(localStorage.getItem(V2_TRUST_KEY)).toBe(raw);
  });

  it("5 · a pre-correction `.v1` store is not read at all, and a fresh seed is written to `.v2`", () => {
    // Defence 1, asserted as the one-time migration it is — not as the guard.
    localStorage.setItem(V1_TRUST_KEY, JSON.stringify({
      baselines: [], evidenceByCase: {}, proofs: [legacyUnattestableProof()],
    }));
    const repo = createLocalStorageRepo();
    expect(repo.loadTrust().proofs.map((p) => p.recoveryCaseId)).toEqual(["RE-1015"]);
    expect(localStorage.getItem(V2_TRUST_KEY)).not.toBeNull();
    // The old key is left where it was; nothing is migrated or rewritten.
    expect(localStorage.getItem(V1_TRUST_KEY)).not.toBeNull();
  });

  it("6 · saveTrust refuses one too, so a caller cannot write around the gate", () => {
    const repo = createLocalStorageRepo();
    repo.saveTrust({ baselines: [], evidenceByCase: {}, proofs: [legacyUnattestableProof()] });
    expect(repo.loadTrust().proofs).toEqual([]);
  });
});
