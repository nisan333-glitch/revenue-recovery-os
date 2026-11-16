import { describe, expect, it } from "vitest";
import {
  activateSettlementKey,
  proposeSettlementKey,
  resolveForUse,
  retireSettlementKey,
  revokeSettlementKeyAsCompromised,
  type RegisteredSettlementKey,
  type SettlementKeyRegister,
} from "./settlementKeyGovernance";
import { hashSettlementKey } from "../../src/contract/settlementKeyWitness";
import { stateAt, type KeyRegistrationEvidence, type SettlementKeyEvent, type SettlementKeyFacts }
  from "../../src/contract/settlementKeyLifecycle";
import type { ActorContext } from "../auth/identity";

const FACTS: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
});

const COMPLETE: KeyRegistrationEvidence = Object.freeze({
  channelIndependentlyVerified: true, institutionIdentityVerified: true,
  keyControlDemonstrated: true, ceremonyRecorded: true,
});

const OPERATOR: ActorContext = { actorId: "op-1", role: "operator", boundaryIds: ["b-alpha"] };
const STEWARD: ActorContext = { actorId: "st-1", role: "steward", boundaryIds: ["b-alpha"] };

/** An in-memory register, so every decision branch is reachable without a database. */
function memoryRegister(): SettlementKeyRegister & { rows: Map<string, RegisteredSettlementKey> } {
  const rows = new Map<string, RegisteredSettlementKey>();
  return {
    rows,
    async read(keyId) { return rows.get(keyId) ?? null; },
    async insertKey(input) {
      rows.set(input.facts.keyId, {
        facts: input.facts, witness: input.witness, evidence: input.evidence,
        registeredByActorId: input.actor.actorId,
        events: [{ transition: "PROPOSED", actorId: input.actor.actorId, actorRole: input.actor.role,
          rationale: input.rationale, at: "2026-02-01T00:00:00.000Z" }],
      });
    },
    async appendEvent(keyId, event) {
      const row = rows.get(keyId)!;
      rows.set(keyId, { ...row, events: [...row.events, event] });
    },
  };
}

const propose = async (r: SettlementKeyRegister, evidence = COMPLETE, actor = OPERATOR) =>
  proposeSettlementKey(r, actor, { facts: FACTS, evidence, rationale: "ceremony complete" });

describe("G2 · propose and activate", () => {
  it("is the positive control: proposed by one identity, activated by another, reads ACTIVE", async () => {
    const r = memoryRegister();
    const { witness } = await propose(r);
    expect(witness).toBe(await hashSettlementKey(FACTS));
    await activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "reviewed", at: "2026-02-02T00:00:00.000Z" });
    const row = await r.read("k-bank-01");
    expect(stateAt(row!.events, "2026-03-01T00:00:00.000Z")).toEqual({ ok: true, state: "ACTIVE" });
  });

  // THE WITNESS IS COMPUTED BY THE SERVER, NEVER SUPPLIED. A caller that could state its own row's
  // witness could state one for values it did not write.
  it("computes the witness itself and ignores anything the caller might have wanted", async () => {
    const r = memoryRegister();
    await propose(r);
    expect(r.rows.get("k-bank-01")!.witness).toBe(await hashSettlementKey(FACTS));
  });

  it("refuses a second registration of the same key id", async () => {
    const r = memoryRegister();
    await propose(r);
    await expect(propose(r)).rejects.toThrow(/KEY_ALREADY_REGISTERED/);
  });

  it("refuses an activation by the identity that proposed it", async () => {
    const r = memoryRegister();
    // Same actorId, steward role — so this is NOT a capability failure, it is separation of duties.
    await propose(r, COMPLETE, { actorId: "st-1", role: "operator", boundaryIds: ["b-alpha"] });
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_PROPOSER_MAY_NOT_ACTIVATE/);
  });

  it("refuses a second activation: there is no resume", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-03T00:00:00.000Z" }))
      .rejects.toThrow(/KEY_ILLEGAL_TRANSITION/);
  });

  it("refuses an unknown key with 404 rather than a permission error", async () => {
    const r = memoryRegister();
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-nope", rationale: "r" }))
      .rejects.toThrow(/not registered/);
  });
});

describe("G2 · K5 · the ceremony gates activation, and control is not identity", () => {
  it("refuses activation when the INSTITUTION is unverified though control is proved", async () => {
    const r = memoryRegister();
    await propose(r, { ...COMPLETE, institutionIdentityVerified: false });
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_INSTITUTION_NOT_VERIFIED/);
  });

  it("says in the refusal that control proves nothing about who holds the key", async () => {
    const r = memoryRegister();
    await propose(r, { ...COMPLETE, institutionIdentityVerified: false });
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/proves nothing about who holds it/);
  });

  it("names EVERY unmet condition, not only the first", async () => {
    const r = memoryRegister();
    await propose(r, { channelIndependentlyVerified: false, institutionIdentityVerified: false,
      keyControlDemonstrated: true, ceremonyRecorded: false });
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_CHANNEL_NOT_AUTHORITATIVE.*KEY_INSTITUTION_NOT_VERIFIED.*KEY_CEREMONY_RECORD_MISSING/);
  });
});

describe("G2 · the witness is re-verified where the row is RESOLVED FOR USE", () => {
  const tamper = async (r: ReturnType<typeof memoryRegister>) => {
    const row = r.rows.get("k-bank-01")!;
    // The stored witness stays; the values move. Exactly what a migration or a restore could do.
    r.rows.set("k-bank-01", { ...row, facts: { ...row.facts, publicKey: "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n" } });
  };

  it("refuses to resolve a tampered row for use", async () => {
    const r = memoryRegister();
    await propose(r);
    await tamper(r);
    await expect(resolveForUse(r, "k-bank-01")).rejects.toThrow(/KEY_WITNESS_MISMATCH/);
  });

  it("refuses to ACTIVATE a tampered row — activation puts a key in force", async () => {
    const r = memoryRegister();
    await propose(r);
    await tamper(r);
    await expect(activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_WITNESS_MISMATCH/);
  });

  // GOVERNANCE MAY ALWAYS STILL WITHDRAW. A key found to have a broken witness is exactly a key worth
  // revoking, so requiring the witness here would make the register unstoppable when it matters most.
  it("STILL permits retiring and revoking a tampered row", async () => {
    const r = memoryRegister();
    await propose(r);
    await tamper(r);
    await expect(revokeSettlementKeyAsCompromised(r, STEWARD, {
      keyId: "k-bank-01", rationale: "witness failed", exposureFrom: null, at: "2026-03-01T00:00:00.000Z",
    })).resolves.toBeUndefined();

    const r2 = memoryRegister();
    await propose(r2);
    await tamper(r2);
    await expect(retireSettlementKey(r2, STEWARD, {
      keyId: "k-bank-01", rationale: "withdraw", at: "2026-03-01T00:00:00.000Z",
    })).resolves.toBeUndefined();
  });
});

describe("G2 · revocation records the exposure claim the caller actually made", () => {
  it("records an UNKNOWN exposure as null rather than omitting the field", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
    await revokeSettlementKeyAsCompromised(r, STEWARD, {
      keyId: "k-bank-01", rationale: "suspected", exposureFrom: null, at: "2026-06-01T00:00:00.000Z",
    });
    const revocation = r.rows.get("k-bank-01")!.events.at(-1) as SettlementKeyEvent;
    expect(revocation.transition).toBe("REVOKED_COMPROMISED");
    expect(revocation.exposureFrom).toBeNull();
  });

  it("records a known exposure start verbatim", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
    await revokeSettlementKeyAsCompromised(r, STEWARD, {
      keyId: "k-bank-01", rationale: "forensics", exposureFrom: "2026-04-01T00:00:00.000Z",
      at: "2026-06-01T00:00:00.000Z",
    });
    expect((r.rows.get("k-bank-01")!.events.at(-1) as SettlementKeyEvent).exposureFrom)
      .toBe("2026-04-01T00:00:00.000Z");
  });

  it("may revoke a key that was already retired", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
    await retireSettlementKey(r, STEWARD, { keyId: "k-bank-01", rationale: "rotated", at: "2026-05-01T00:00:00.000Z" });
    await expect(revokeSettlementKeyAsCompromised(r, STEWARD, {
      keyId: "k-bank-01", rationale: "found later", exposureFrom: null, at: "2026-06-01T00:00:00.000Z",
    })).resolves.toBeUndefined();
  });
});

describe("G2 · authorization · no new role, and the boundary comes from the actor", () => {
  it.each([
    ["an approver may not propose", { actorId: "ap-1", role: "approver" as const }, "propose"],
    ["an operator may not activate", { actorId: "op-2", role: "operator" as const }, "activate"],
    ["an author may not revoke", { actorId: "au-1", role: "author" as const }, "revoke"],
    ["an approver may not revoke", { actorId: "ap-2", role: "approver" as const }, "revoke"],
  ])("%s", async (_name, who, action) => {
    const r = memoryRegister();
    const actor: ActorContext = { ...who, boundaryIds: ["b-alpha"] };
    if (action === "propose") {
      await expect(proposeSettlementKey(r, actor, { facts: FACTS, evidence: COMPLETE, rationale: "r" }))
        .rejects.toThrow(/may not perform/);
      return;
    }
    await propose(r);
    const call = action === "activate"
      ? activateSettlementKey(r, actor, { keyId: "k-bank-01", rationale: "r" })
      : revokeSettlementKeyAsCompromised(r, actor, { keyId: "k-bank-01", rationale: "r", exposureFrom: null });
    await expect(call).rejects.toThrow(/may not perform/);
  });

  it("refuses a proposer who does not hold the key's boundary", async () => {
    const r = memoryRegister();
    const other: ActorContext = { actorId: "op-9", role: "operator", boundaryIds: ["b-beta"] };
    await expect(proposeSettlementKey(r, other, { facts: FACTS, evidence: COMPLETE, rationale: "r" }))
      .rejects.toThrow();
  });

  it("refuses an activator who does not hold the key's boundary", async () => {
    const r = memoryRegister();
    await propose(r);
    const other: ActorContext = { actorId: "st-9", role: "steward", boundaryIds: ["b-beta"] };
    await expect(activateSettlementKey(r, other, { keyId: "k-bank-01", rationale: "r" })).rejects.toThrow();
  });
});
