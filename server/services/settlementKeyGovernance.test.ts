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
import {
  senderRefusing, senderUnregistered, senderVerified, senderVerifiedRecording,
} from "../test/senderAuthorityDoubles";

const FACTS: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z",
});

const COMPLETE: KeyRegistrationEvidence = Object.freeze({
  channelIndependentlyVerified: true,
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
    await activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "reviewed", at: "2026-02-02T00:00:00.000Z" });
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
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_PROPOSER_MAY_NOT_ACTIVATE/);
  });

  it("refuses a second activation: there is no resume", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-03T00:00:00.000Z" }))
      .rejects.toThrow(/KEY_ILLEGAL_TRANSITION/);
  });

  it("refuses an unknown key with 404 rather than a permission error", async () => {
    const r = memoryRegister();
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-nope", rationale: "r" }))
      .rejects.toThrow(/not registered/);
  });
});

describe("G2 · K5 · the DECLARED ceremony gates activation, and control is not identity", () => {
  it("says in the refusal that control proves nothing about who holds the key", async () => {
    const r = memoryRegister();
    await propose(r, { ...COMPLETE, ceremonyRecorded: false });
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/proves nothing about who holds it/);
  });

  it("names EVERY unmet declared condition, not only the first", async () => {
    const r = memoryRegister();
    await propose(r, { channelIndependentlyVerified: false,
      keyControlDemonstrated: true, ceremonyRecorded: false });
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/KEY_CHANNEL_NOT_AUTHORITATIVE.*KEY_CEREMONY_RECORD_MISSING/);
  });

  it("the declared refusals can no longer name the institution at all", async () => {
    // B3 · the institution left this list. Asserted on the message a caller actually receives, so a
    // future re-introduction of the boolean would have to re-introduce this refusal too.
    const r = memoryRegister();
    await propose(r, { channelIndependentlyVerified: false, keyControlDemonstrated: false,
      ceremonyRecorded: false });
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow(/DECLARED conditions are incomplete/);
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.not.toThrow(/KEY_INSTITUTION/);
  });
});

describe("B3 · the institution condition is DERIVED, and the order of the gates is fixed", () => {
  // THE WHOLE SLICE IN ONE SUITE. Before B3 the institution was a boolean on the propose request from
  // `author` or `operator` — the beneficiary side — and a complete tick list was the entire gate.
  it("is the positive control: a VERIFIED sender lets a complete ceremony activate", async () => {
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, senderVerified(), STEWARD, {
      keyId: "k-bank-01", rationale: "reviewed", at: "2026-02-02T00:00:00.000Z",
    });
    const row = await r.read("k-bank-01");
    expect(stateAt(row!.events, "2026-03-01T00:00:00.000Z")).toEqual({ ok: true, state: "ACTIVE" });
  });

  it("refuses when NOTHING is registered for the sender — the refusal that fires today", async () => {
    const r = memoryRegister();
    await propose(r);
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, { keyId: "k-bank-01", rationale: "r" }),
    ).rejects.toThrow(/KEY_SENDER_NOT_AUTHORISED.*KEY_INSTITUTION_NOT_REGISTERED/s);
  });

  it("carries each of the five refusals through verbatim, so none collapses into another", async () => {
    // THE FOUR NEGATIVE ANSWERS AND THE UNREADABLE RECORD STAY DISTINGUISHABLE. Derived from the
    // union rather than hand-listed, so a sixth refusal added to the port fails here.
    const codes = [
      "KEY_INSTITUTION_NOT_REGISTERED", "KEY_INSTITUTION_NOT_VERIFIED",
      "KEY_INSTITUTION_AUTHORITY_WITHDRAWN", "KEY_INSTITUTION_IDENTITY_DOUBTED",
      "KEY_INSTITUTION_RECORD_UNREADABLE",
    ] as const;
    for (const code of codes) {
      const r = memoryRegister();
      await propose(r);
      await expect(
        activateSettlementKey(r, senderRefusing(code), STEWARD, { keyId: "k-bank-01", rationale: "r" }),
      ).rejects.toThrow(new RegExp(code));
    }
  });

  it("a refused activation writes NOTHING — the key stays in DRAFT", async () => {
    const r = memoryRegister();
    await propose(r);
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, { keyId: "k-bank-01", rationale: "r" }),
    ).rejects.toThrow();
    const row = await r.read("k-bank-01");
    expect(row!.events.map((e) => e.transition)).toEqual(["PROPOSED"]);
    expect(stateAt(row!.events, "2026-03-01T00:00:00.000Z")).toEqual({ ok: true, state: "DRAFT" });
  });

  it("asks about the KEY'S OWN sender, as of the activation's own instant", async () => {
    // The sender is not a request field and cannot be one: it comes from the stored, witness-verified
    // row, so an activation cannot be pointed at a different institution's admission.
    const r = memoryRegister();
    await propose(r);
    const recorder = senderVerifiedRecording();
    await activateSettlementKey(r, recorder, STEWARD, {
      keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z",
    });
    expect(recorder.asked).toEqual([
      { boundaryId: "b-alpha", sourceSystem: "acme-bank", at: "2026-02-02T00:00:00.000Z" },
    ]);
  });

  it("the DECLARED conditions are checked BEFORE the sender, so the refusals do not mask", async () => {
    // ORDER MATTERS FOR THE OPERATOR, not for security: told "your sender is unverified" when the
    // real problem is a missing ceremony record, they would go and talk to a bank for nothing.
    const r = memoryRegister();
    await propose(r, { ...COMPLETE, ceremonyRecorded: false });
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, { keyId: "k-bank-01", rationale: "r" }),
    ).rejects.toThrow(/KEY_REGISTRATION_INCOMPLETE/);
  });

  it("and the SEPARATION OF DUTIES outranks both — who you are before what you declared", async () => {
    const r = memoryRegister();
    await propose(r, { ...COMPLETE, ceremonyRecorded: false },
      { actorId: "st-1", role: "operator", boundaryIds: ["b-alpha"] });
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, { keyId: "k-bank-01", rationale: "r" }),
    ).rejects.toThrow(/KEY_PROPOSER_MAY_NOT_ACTIVATE/);
  });

  it("a BACKDATED activation is answered about the KEY, not about the institution", async () => {
    // FOUND BY A TEST, NOT BY A READING, and it is why the sender check moved below `assertLegal`.
    // An activation dated before the key's birth reaches an instant at which the INSTITUTION also has
    // no event in force, so asking the institution first answered `KEY_INSTITUTION_NOT_REGISTERED` —
    // the bank blamed for a backdated request. The `NH-AX-1009` mistake in miniature.
    const r = memoryRegister();
    await propose(r);
    const row = await r.read("k-bank-01");
    const born = row!.events[0]!.at;
    const before = new Date(Date.parse(born) - 60_000).toISOString();
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, {
        keyId: "k-bank-01", rationale: "r", at: before,
      }),
    ).rejects.toThrow(/KEY_ILLEGAL_TRANSITION/);
    // And explicitly NOT the institution's refusal, even though an unregistered sender is also true.
    await expect(
      activateSettlementKey(r, senderUnregistered(), STEWARD, {
        keyId: "k-bank-01", rationale: "r", at: before,
      }),
    ).rejects.not.toThrow(/KEY_INSTITUTION/);
  });

  it("the sender is NEVER consulted for a retirement or a revocation", async () => {
    // GOVERNANCE MUST ALWAYS BE ABLE TO STOP WHAT IT HAS FOUND. A key whose institution is revoked is
    // exactly the key worth revoking, so requiring an authorised sender there would make the register
    // unstoppable at the moment it matters most. These take no port at all, by signature.
    const r = memoryRegister();
    await propose(r);
    await activateSettlementKey(r, senderVerified(), STEWARD, {
      keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z",
    });
    await expect(revokeSettlementKeyAsCompromised(r, STEWARD, {
      keyId: "k-bank-01", rationale: "found compromised", exposureFrom: null,
      at: "2026-02-03T00:00:00.000Z",
    })).resolves.toBeUndefined();
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
    await expect(activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r" }))
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
    await activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
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
    await activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
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
    await activateSettlementKey(r, senderVerified(), STEWARD, { keyId: "k-bank-01", rationale: "r", at: "2026-02-02T00:00:00.000Z" });
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
      // A PERMISSIVE SENDER ON PURPOSE: this case is about the CAPABILITY refusal, and a refusing
      // sender would let the assertion pass for the wrong reason.
      ? activateSettlementKey(r, senderVerified(), actor, { keyId: "k-bank-01", rationale: "r" })
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
    // Likewise: the boundary refusal must be what fires, so the sender is authorised here.
    await expect(activateSettlementKey(r, senderVerified(), other, { keyId: "k-bank-01", rationale: "r" }))
      .rejects.toThrow();
  });
});
