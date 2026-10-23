import { describe, expect, it } from "vitest";
import { SourceVerifier } from "../services/sourceVerification";
import type { ActorContext } from "../auth/identity";
import type { RecoveryCaseRoot } from "../persistence/recoveryCaseStore";
import { RECONCILIATION_AGENT_ID, RECONCILIATION_RECOVERY_TYPE } from "../agents/reconciliationObserver";
import {
  SYNTHETIC_DEMO_SOURCE_SYSTEM,
  SyntheticDemo,
  syntheticDemoFromEnvironment,
  type SyntheticDemoPorts,
  type SyntheticEvidenceClaim,
} from "./syntheticDemo";

const BOUNDARY = "SYNTHETIC-DEMO";
const KEY = "k".repeat(40);
const GOOD_ENV = {
  NH_SYNTHETIC_DEMO_ENABLED: "true",
  NH_AGENTS_ENABLED: "true",
  NH_AGENT_BOUNDARIES: BOUNDARY,
  NH_RECONCILIATION_OBSERVER_ENABLED: "true",
  NH_RECONCILER_PSEUDONYM_KEY: KEY,
  NH_AGENT_ADMISSION_POLICIES: `${RECONCILIATION_RECOVERY_TYPE}:10000`,
} as const;

const operator: ActorContext = { actorId: "pilot-operator@company", role: "operator", boundaryIds: ["*"] };
const as = (role: ActorContext["role"], boundaryIds: readonly string[] = ["*"]): ActorContext =>
  ({ actorId: `${role}@company`, role, boundaryIds });

function root(partial: Partial<RecoveryCaseRoot> = {}): RecoveryCaseRoot {
  return {
    recoveryCaseId: "RC-1",
    boundaryId: BOUNDARY,
    sourceCandidateId: "cand-1",
    recoveryType: RECONCILIATION_RECOVERY_TYPE,
    sourceRef: "hmac-sha256:abc",
    amountAtRiskMinor: 60_000,
    currency: "USD",
    detectorVersion: RECONCILIATION_AGENT_ID,
    openedByActorId: "pilot-operator@company",
    openedByRole: "operator",
    policyVersion: "recovery-case-promotion-v1",
    openedAt: "2026-10-23T00:00:00.000Z",
    ...partial,
  };
}

interface Fake extends SyntheticDemoPorts {
  readonly enqueued: Parameters<SyntheticDemoPorts["enqueue"]>[0][];
}

function fake(overrides: Partial<SyntheticDemoPorts> = {}): Fake {
  const enqueued: Fake["enqueued"] = [];
  let created = true;
  return {
    enqueued,
    enqueue: async (task) => {
      enqueued.push(task);
      const result = { created };
      created = false; // the store is idempotent: only the first observation is created
      return result;
    },
    readCase: async () => root(),
    hasIntervention: async () => true,
    hasBaseline: async () => true,
    evidenceExists: async () => false,
    ...overrides,
  };
}

function demo(ports: SyntheticDemoPorts, now = () => Date.parse("2026-10-23T12:00:00.000Z")): SyntheticDemo {
  return new SyntheticDemo({ boundaryId: BOUNDARY, now }, ports);
}

describe("syntheticDemoFromEnvironment — off by default, fail closed", () => {
  it("is null unless explicitly enabled", () => {
    expect(syntheticDemoFromEnvironment({}, fake())).toBeNull();
    expect(syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_SYNTHETIC_DEMO_ENABLED: "1" }, fake())).toBeNull();
    expect(syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_SYNTHETIC_DEMO_ENABLED: "TRUE" }, fake())).toBeNull();
  });

  it("is refused outright in production", () => {
    expect(() => syntheticDemoFromEnvironment({ ...GOOD_ENV, NODE_ENV: "production" }, fake())).toThrow(/production/);
  });

  it("refuses to boot when the process could not actually run the reconciler for its boundary", () => {
    const without = (name: keyof typeof GOOD_ENV) => ({ ...GOOD_ENV, [name]: undefined });
    expect(() => syntheticDemoFromEnvironment(without("NH_AGENTS_ENABLED"), fake())).toThrow();
    expect(() => syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_AGENT_BOUNDARIES: "someone-else" }, fake())).toThrow(/boundary/);
    expect(() => syntheticDemoFromEnvironment(without("NH_RECONCILIATION_OBSERVER_ENABLED"), fake())).toThrow();
    expect(() => syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_RECONCILER_PSEUDONYM_KEY: "short" }, fake())).toThrow();
    expect(() => syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_AGENT_ADMISSION_POLICIES: "ActivationMissed:5000" }, fake())).toThrow(/RevenueUnderBilled/);
  });

  it("builds when everything is in place, honouring a custom boundary", () => {
    expect(syntheticDemoFromEnvironment(GOOD_ENV, fake())?.boundaryId).toBe(BOUNDARY);
    const custom = syntheticDemoFromEnvironment({ ...GOOD_ENV, NH_SYNTHETIC_DEMO_BOUNDARY: "journey-x", NH_AGENT_BOUNDARIES: "journey-x" }, fake());
    expect(custom?.boundaryId).toBe("journey-x");
  });
});

describe("launch", () => {
  it("is operator-only", async () => {
    for (const role of ["author", "approver", "verifier", "steward"] as const) {
      const ports = fake();
      await expect(demo(ports).launch(as(role))).rejects.toThrow(/operator/);
      expect(ports.enqueued).toHaveLength(0);
    }
  });

  it("refuses an operator who is not authorised for the demo boundary", async () => {
    const ports = fake();
    await expect(demo(ports).launch(as("operator", ["some-other-boundary"]))).rejects.toThrow(/boundary/);
    expect(ports.enqueued).toHaveLength(0);
  });

  it("enqueues ONLY the labelled fixture for the reconciler on the demo boundary", async () => {
    const ports = fake();
    const result = await demo(ports).launch(operator);
    expect(result).toMatchObject({ launched: true, alreadyLaunched: false, boundaryId: BOUNDARY, currency: "USD" });
    expect(result.label).toMatch(/SYNTHETIC/i);
    expect(ports.enqueued).toHaveLength(1);
    const task = ports.enqueued[0]!;
    expect(task.agentId).toBe(RECONCILIATION_AGENT_ID);
    expect(task.boundaryId).toBe(BOUNDARY);
    expect(JSON.stringify(task.payload)).toContain("DEMO");
    expect(Object.keys(task.payload).sort()).toEqual(["actionAvailable", "billing", "currency", "expectation", "observedAt"]);
  });

  it("is idempotent: a later launch carries the same idempotency key even though the clock moved", async () => {
    const ports = fake();
    let t = Date.parse("2026-10-23T12:00:00.000Z");
    const d = demo(ports, () => t);
    const first = await d.launch(operator);
    t += 3_600_000;
    const second = await d.launch(operator);
    expect(first.launched).toBe(true);
    expect(second).toMatchObject({ launched: false, alreadyLaunched: true });
    expect(ports.enqueued[0]!.idempotencyKey).toBe(ports.enqueued[1]!.idempotencyKey);
    expect(ports.enqueued[0]!.taskId).toBe(ports.enqueued[1]!.taskId);
  });
});

describe("settle — the synthetic billing source", () => {
  async function settled(ports: SyntheticDemoPorts, actor: ActorContext = operator): Promise<{ claim: SyntheticEvidenceClaim; d: SyntheticDemo }> {
    const d = demo(ports);
    let claim: SyntheticEvidenceClaim | undefined;
    await d.settle(actor, "RC-1", async (c) => { claim = c; return c; });
    return { claim: claim!, d };
  }

  it("builds the claim from the case's own frozen root — the caller supplies none of it", async () => {
    const { claim } = await settled(fake());
    expect(claim).toMatchObject({
      evidenceId: "EV-SYNTHETIC-RC-1",
      sourceSystem: SYNTHETIC_DEMO_SOURCE_SYSTEM,
      evidenceType: "invoice_paid",
      amountMinor: 60_000,
      currency: "USD",
    });
    expect(claim.sourceRecordId).toMatch(/^SYNTHETIC-/);
    expect(claim.note).toMatch(/SYNTHETIC/);
    expect(claim.observedAt).toBe("2026-10-23T12:00:00.000Z");
  });

  it("signs with a key the REAL verifier accepts for this exact claim — and for nothing else", async () => {
    const { claim, d } = await settled(fake());
    const verifier = new SourceVerifier([d.trustKey], () => Date.parse("2026-10-23T12:00:30.000Z"));
    const receipt = verifier.verify("RC-1", claim, claim.sourceAttestation);
    expect(receipt?.keyId).toBe(d.trustKey.keyId);
    // inflated amount, other case, other source: all refused
    expect(() => verifier.verify("RC-1", { ...claim, amountMinor: 600_000 }, claim.sourceAttestation)).toThrow();
    expect(() => verifier.verify("RC-2", claim, claim.sourceAttestation)).toThrow();
    expect(() => verifier.verify("RC-1", { ...claim, sourceSystem: "salesforce" }, claim.sourceAttestation)).toThrow();
  });

  it("never exposes its private key", () => {
    const d = demo(fake());
    const everything = JSON.stringify({ d, status: d.status(), trust: d.trustKey });
    expect(everything).not.toMatch(/PRIVATE KEY/);
    expect(d.trustKey.publicKey).toMatch(/BEGIN PUBLIC KEY/);
  });

  it("each process gets a different key", () => {
    expect(demo(fake()).trustKey.keyId).not.toBe(demo(fake()).trustKey.keyId);
    expect(demo(fake()).trustKey.publicKey).not.toBe(demo(fake()).trustKey.publicKey);
  });

  it("requires the evidence permission (approver / verifier / steward are refused)", async () => {
    for (const role of ["approver", "verifier", "steward"] as const) {
      await expect(settled(fake(), as(role))).rejects.toThrow(/IngestEvidence/);
    }
  });

  it("refuses a case that does not exist", async () => {
    await expect(settled(fake({ readCase: async () => null }))).rejects.toThrow(/no such Recovery Case/);
  });

  it("refuses a case that did not come from the demo book on the demo boundary", async () => {
    await expect(settled(fake({ readCase: async () => root({ boundaryId: "customer-x" }) }))).rejects.toThrow(/synthetic demo book/);
    await expect(settled(fake({ readCase: async () => root({ recoveryType: "ActivationMissed" }) }))).rejects.toThrow(/synthetic demo book/);
    await expect(settled(fake({ readCase: async () => root({ detectorVersion: "activation-detector-v1" }) }))).rejects.toThrow(/synthetic demo book/);
  });

  it("refuses an actor who is not authorised for the case's boundary", async () => {
    await expect(settled(fake(), as("operator", ["elsewhere"]))).rejects.toThrow(/boundary/);
  });

  it("will not settle before the fix and a locked baseline exist (the payment cannot precede the action)", async () => {
    await expect(settled(fake({ hasIntervention: async () => false }))).rejects.toThrow(/corrective action/);
    await expect(settled(fake({ hasBaseline: async () => false }))).rejects.toThrow(/baseline/);
  });

  it("settles a case at most once", async () => {
    await expect(settled(fake({ evidenceExists: async () => true }))).rejects.toThrow(/already settled/);
  });

  it("does not call the ingest path when any precondition fails", async () => {
    let called = 0;
    const d = demo(fake({ hasIntervention: async () => false }));
    await expect(d.settle(operator, "RC-1", async () => { called += 1; })).rejects.toThrow();
    expect(called).toBe(0);
  });
});
