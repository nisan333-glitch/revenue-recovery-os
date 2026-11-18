// K5 · THE INSTITUTION REGISTER'S CONTROLS, EXERCISED RATHER THAN DESCRIBED.
//
// The in-memory register is deliberately NOT a stub that agrees with everything: it enforces the two
// properties the Postgres table will enforce — one row per id, and an append-only event log — so a
// test that passes here is testing the decision logic rather than a double's generosity.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DECLARED_CONDITIONS,
  SERVER_ESTABLISHED_CONDITIONS,
  proposeInstitution,
  resolveInstitutionForGovernance,
  resolveInstitutionForUse,
  revokeInstitutionIdentityDoubted,
  verifyInstitution,
  withdrawInstitution,
  type InstitutionRegister,
  type KeyControlSource,
  type RegisteredInstitution,
} from "./institutionGovernance";
import {
  INSTITUTION_AUTHORITY_CONDITIONS,
  institutionAuthorityCeiling,
  institutionStateAt,
  type InstitutionAuthorityEvent,
} from "../../src/contract/institutionAuthority";
import { hashInstitution, type InstitutionFacts } from "../../src/contract/institutionIdentity";
import type { ActorContext } from "../auth/identity";

const BOUNDARY = "pb-k5-institution";

const FACTS: InstitutionFacts = Object.freeze({
  institutionId: "inst-synthetic-bank",
  boundaryId: BOUNDARY,
  sourceSystem: "SYNTHETIC-BANK",
  sourceKind: "bank" as const,
  // SYNTHETIC THROUGHOUT. No real institution is named anywhere in this repository, and this test is
  // not the place one would start being named.
  legalEntityName: "Synthetic Test Bank (NOT A REAL INSTITUTION)",
  jurisdiction: "ZZ",
  registryIdentifier: "ZZ-SYNTHETIC-0000",
});

const steward = (id: string): ActorContext =>
  Object.freeze({ actorId: id, role: "steward" as const, boundaryIds: [BOUNDARY] });

const PROPOSER = steward("gov-alice");
const VERIFIER = steward("gov-bob");

/** Every declared condition cited. DERIVED, so a new condition is cited automatically. */
const fullCitations = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of DECLARED_CONDITIONS) out[c] = `out-of-band record for ${c}, ref SYNTHETIC-DOC-1`;
  return out;
};

class MemoryRegister implements InstitutionRegister {
  rows = new Map<string, RegisteredInstitution>();

  async read(id: string): Promise<RegisteredInstitution | null> {
    const row = this.rows.get(id);
    return row === undefined ? null : { ...row, events: [...row.events] };
  }

  /**
   * B3 · lookup by SENDER, which is how a settlement key finds its own institution.
   *
   * THE DOUBLE ENFORCES THE UNIQUE INDEX'S PROPERTY rather than assuming it: more than one row for a
   * sender throws, exactly as the store does, so a test cannot pass here on behaviour the real
   * database would refuse. A double more permissive than its subject is how a wrong design survives.
   */
  async findBySender(boundaryId: string, sourceSystem: string): Promise<RegisteredInstitution | null> {
    const hits = [...this.rows.values()].filter(
      (r) => r.facts.boundaryId === boundaryId && r.facts.sourceSystem === sourceSystem,
    );
    if (hits.length > 1) throw new Error("more than one institution claims this sender");
    const row = hits[0];
    return row === undefined ? null : { ...row, events: [...row.events] };
  }

  async insertInstitution(input: {
    facts: InstitutionFacts; witness: string; actor: ActorContext; rationale: string;
  }): Promise<void> {
    // ONE ROW PER ID, like the table's primary key. A double that allowed two would make the
    // already-registered refusal untestable.
    if (this.rows.has(input.facts.institutionId)) throw new Error("duplicate institution id");
    this.rows.set(input.facts.institutionId, {
      facts: input.facts,
      witness: input.witness,
      proposedByActorId: input.actor.actorId,
      events: [],
      verification: null,
    });
  }

  async appendEvent(id: string, event: InstitutionAuthorityEvent): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error("no such institution");
    // APPEND ONLY, like the trigger. Nothing here can rewrite or remove an event.
    this.rows.set(id, { ...row, events: [...row.events, event] });
  }

  async recordVerification(
    id: string, verification: NonNullable<RegisteredInstitution["verification"]>,
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error("no such institution");
    if (row.verification !== null) throw new Error("already verified");
    this.rows.set(id, { ...row, verification });
  }

  /** Simulate the tampering the witness exists to detect, by writing the row a tamper would produce. */
  tamper(id: string, patch: Partial<InstitutionFacts>): void {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, facts: { ...row.facts, ...patch } });
  }
}

const keysInForce = (over: Partial<{ boundaryId: string; sourceSystem: string; inForce: boolean }> = {}):
  KeyControlSource => ({
  async keyInForce(keyId) {
    if (keyId !== "KEY-SYNTHETIC-1") return null;
    return {
      boundaryId: over.boundaryId ?? BOUNDARY,
      sourceSystem: over.sourceSystem ?? "SYNTHETIC-BANK",
      inForce: over.inForce ?? true,
    };
  },
});

let register: MemoryRegister;
beforeEach(() => {
  register = new MemoryRegister();
});

const propose = () =>
  proposeInstitution(register, PROPOSER, { facts: FACTS, rationale: "registry lookup completed" });

const verify = (
  actor: ActorContext = VERIFIER,
  extra: Partial<{ citations: Record<string, string>; keyId: string; keys: KeyControlSource }> = {},
) =>
  verifyInstitution(register, extra.keys ?? keysInForce(), actor, {
    institutionId: FACTS.institutionId,
    citations: extra.citations ?? fullCitations(),
    keyControlDemonstratedByKeyId: extra.keyId ?? "KEY-SYNTHETIC-1",
    rationale: "second-person verification",
  });

describe("the condition split is derived, not hand-listed", () => {
  it("every ceremony condition is either declared by an operator or established by the server", () => {
    // NEITHER LIST MAY SILENTLY MISS ONE. A condition in neither would escape both the citation
    // requirement and the server's own derivation, and would then be `false` forever — which is
    // fail-closed, but fail-closed for an unstated reason is how a bar becomes unsatisfiable by
    // accident. The two sets are asserted to partition the ceremony exactly.
    const union = [...DECLARED_CONDITIONS, ...SERVER_ESTABLISHED_CONDITIONS].sort();
    expect(union).toEqual([...INSTITUTION_AUTHORITY_CONDITIONS].sort());
    for (const c of DECLARED_CONDITIONS) {
      expect(SERVER_ESTABLISHED_CONDITIONS.includes(c), `${c} is in both lists`).toBe(false);
    }
  });

  it("the two the server establishes are exactly the second person and key control", () => {
    expect([...SERVER_ESTABLISHED_CONDITIONS].sort()).toEqual([
      "keyControlDemonstrated",
      "secondPersonApproval",
    ]);
  });

  it("six conditions need an out-of-band citation, and NH cannot check any of them", () => {
    expect(DECLARED_CONDITIONS).toHaveLength(6);
  });
});

describe("proposing", () => {
  it("computes the witness itself and records the proposer", async () => {
    const out = await propose();
    expect(out.witness).toBe(await hashInstitution(FACTS));
    const row = await register.read(FACTS.institutionId);
    expect(row!.proposedByActorId).toBe("gov-alice");
    expect(row!.verification).toBeNull();
    expect(institutionStateAt(row!.events, "2100-01-01T00:00:00.000Z")).toMatchObject({
      ok: true, state: "PROPOSED",
    });
  });

  it("an unverified institution carries NO evidence set, not an all-false one", async () => {
    await propose();
    const row = await register.read(FACTS.institutionId);
    // `null` says NOBODY HAS VERIFIED THIS. An all-false evidence set would say we looked at eight
    // conditions and found none met — "not computed is not zero", applied to a record.
    expect(row!.verification).toBeNull();
  });

  it("refuses a second proposal of the same id — a change of legal entity is a new institution", async () => {
    await propose();
    await expect(propose()).rejects.toThrow(/INSTITUTION_ALREADY_REGISTERED/);
  });

  it("refuses malformed facts, naming every problem rather than the first", async () => {
    await expect(
      proposeInstitution(register, PROPOSER, {
        facts: { ...FACTS, registryIdentifier: "", jurisdiction: " ZZ " },
        rationale: "x",
      }),
      // IN THE VALIDATOR'S OWN FIELD ORDER, which is `jurisdiction` before `registryIdentifier`. The
      // first form of this assertion had them the other way round and failed — the test was wrong and
      // the code was right, which is the only way to find out that the order is part of the contract.
    ).rejects.toThrow(/INSTITUTION_FACTS_MALFORMED.*jurisdiction.*registryIdentifier/s);
  });

  it("refuses a control character in an identifier, which could impersonate a hash separator", async () => {
    await expect(
      proposeInstitution(register, PROPOSER, {
        facts: { ...FACTS, sourceSystem: "SYNTHETIC\u0000BANK" },
        rationale: "x",
      }),
    ).rejects.toThrow(/control characters/);
  });

  it("refuses a role that may not propose, and a boundary the actor does not hold", async () => {
    await expect(
      proposeInstitution(register, { actorId: "a", role: "author", boundaryIds: [BOUNDARY] }, {
        facts: FACTS, rationale: "x",
      }),
    ).rejects.toThrow();
    await expect(
      proposeInstitution(register, { actorId: "s", role: "steward", boundaryIds: ["pb-other"] }, {
        facts: FACTS, rationale: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("verifying · the separation of duties IS the second-person condition", () => {
  it("THE POSITIVE CONTROL: a second governance identity verifies, and the institution reads VERIFIED", async () => {
    await propose();
    await verify();
    const row = await register.read(FACTS.institutionId);
    expect(institutionStateAt(row!.events, "2100-01-01T00:00:00.000Z")).toMatchObject({
      ok: true, state: "VERIFIED",
    });
    expect(row!.verification!.verifiedByActorId).toBe("gov-bob");
    expect(row!.verification!.keyId).toBe("KEY-SYNTHETIC-1");
    // Every condition met — and the two the server established are true because it established them.
    for (const c of INSTITUTION_AUTHORITY_CONDITIONS) {
      expect(row!.verification!.evidence[c], `${c} is not recorded as met`).toBe(true);
    }
  });

  it("the proposer may NOT verify their own proposal", async () => {
    await propose();
    await expect(verify(PROPOSER)).rejects.toThrow(/INSTITUTION_PROPOSER_MAY_NOT_VERIFY/);
    const row = await register.read(FACTS.institutionId);
    expect(row!.verification).toBeNull();
    expect(institutionStateAt(row!.events, "2100-01-01T00:00:00.000Z")).toMatchObject({ state: "PROPOSED" });
  });

  it("a caller may not STATE the second-person condition — it is refused by name, not stripped", async () => {
    await propose();
    await expect(
      verify(VERIFIER, { citations: { ...fullCitations(), secondPersonApproval: "I approved it" } }),
    ).rejects.toThrow(/INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED/);
  });

  it("nor key control, for the same reason", async () => {
    await propose();
    await expect(
      verify(VERIFIER, { citations: { ...fullCitations(), keyControlDemonstrated: "they signed something" } }),
    ).rejects.toThrow(/INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED/);
  });

  it("EVERY server-established condition is refused as an input, derived from the list", async () => {
    // Not two hand-written cases: if a third condition becomes server-established, this covers it.
    for (const c of SERVER_ESTABLISHED_CONDITIONS) {
      register = new MemoryRegister();
      await propose();
      await expect(
        verify(VERIFIER, { citations: { ...fullCitations(), [c]: "supplied" } }),
      ).rejects.toThrow(/INSTITUTION_SERVER_ESTABLISHED_CONDITION_SUPPLIED/);
    }
  });
});

describe("verifying · the citations NH stores and cannot check", () => {
  it("refuses when a declared condition carries no record, naming ALL of them", async () => {
    await propose();
    const citations = fullCitations();
    delete citations.legalEntityVerifiedIndependently;
    delete citations.ceremonyRecorded;
    await expect(verify(VERIFIER, { citations })).rejects.toThrow(
      /INSTITUTION_CITATION_MISSING.*legalEntityVerifiedIndependently.*ceremonyRecorded/s,
    );
  });

  it("a blank or whitespace citation is not a citation", async () => {
    await propose();
    await expect(
      verify(VERIFIER, { citations: { ...fullCitations(), regulatoryStandingVerified: "   " } }),
    ).rejects.toThrow(/INSTITUTION_CITATION_MISSING.*regulatoryStandingVerified/s);
  });

  it("EVERY declared condition is individually load-bearing", async () => {
    // Derived rather than enumerated, so a seventh declared condition is covered on the day it lands.
    for (const c of DECLARED_CONDITIONS) {
      register = new MemoryRegister();
      await propose();
      const citations = fullCitations();
      delete citations[c as string];
      await expect(verify(VERIFIER, { citations })).rejects.toThrow(
        new RegExp(`INSTITUTION_CITATION_MISSING[\\s\\S]*${c}`),
      );
    }
  });

  it("a refused verification records nothing — not a partial evidence set", async () => {
    await propose();
    const citations = fullCitations();
    delete citations.ceremonyRecorded;
    await expect(verify(VERIFIER, { citations })).rejects.toThrow();
    const row = await register.read(FACTS.institutionId);
    expect(row!.verification).toBeNull();
  });
});

describe("verifying · key control is RESOLVED, never ticked", () => {
  it("refuses a key that is not registered at all", async () => {
    await propose();
    await expect(verify(VERIFIER, { keyId: "KEY-DOES-NOT-EXIST" })).rejects.toThrow(
      /INSTITUTION_KEY_NOT_IN_FORCE/,
    );
  });

  it("refuses a registered key that is not in force", async () => {
    await propose();
    await expect(verify(VERIFIER, { keys: keysInForce({ inForce: false }) })).rejects.toThrow(
      /INSTITUTION_KEY_NOT_IN_FORCE/,
    );
  });

  it("refuses a key bound to a DIFFERENT source system — one sender's control is not another's", async () => {
    await propose();
    await expect(
      verify(VERIFIER, { keys: keysInForce({ sourceSystem: "SOME-OTHER-BANK" }) }),
    ).rejects.toThrow(/INSTITUTION_KEY_NOT_BOUND_TO_INSTITUTION/);
  });

  it("refuses a key bound to a different BOUNDARY", async () => {
    await propose();
    await expect(verify(VERIFIER, { keys: keysInForce({ boundaryId: "pb-other" }) })).rejects.toThrow(
      /INSTITUTION_KEY_NOT_BOUND_TO_INSTITUTION/,
    );
  });

  it("records WHICH key, so a later compromise of it can reach this verification", async () => {
    await propose();
    await verify();
    const row = await register.read(FACTS.institutionId);
    expect(row!.verification!.keyId).toBe("KEY-SYNTHETIC-1");
  });
});

describe("the witness · a changed row authorises nothing and stays governable", () => {
  it("resolving FOR USE refuses a row whose facts were changed after registration", async () => {
    await propose();
    register.tamper(FACTS.institutionId, { sourceSystem: "ATTACKER-BANK" });
    await expect(resolveInstitutionForUse(register, FACTS.institutionId)).rejects.toThrow(
      /INSTITUTION_WITNESS_MISMATCH/,
    );
  });

  it("so verification — which puts authority in force — refuses it too", async () => {
    await propose();
    register.tamper(FACTS.institutionId, { legalEntityName: "Someone Else Entirely" });
    await expect(verify()).rejects.toThrow(/INSTITUTION_WITNESS_MISMATCH/);
  });

  it("but governance can still reach it, and can still WITHDRAW it", async () => {
    await propose();
    register.tamper(FACTS.institutionId, { sourceSystem: "ATTACKER-BANK" });
    await expect(resolveInstitutionForGovernance(register, FACTS.institutionId)).resolves.toBeTruthy();
    await withdrawInstitution(register, VERIFIER, {
      institutionId: FACTS.institutionId, rationale: "witness mismatch found",
    });
    const row = await register.read(FACTS.institutionId);
    expect(institutionStateAt(row!.events, "2100-01-01T00:00:00.000Z")).toMatchObject({ state: "WITHDRAWN" });
  });

  it("and can still REVOKE it as identity-doubted — the case where it matters most", async () => {
    await propose();
    register.tamper(FACTS.institutionId, { registryIdentifier: "ZZ-DIFFERENT-9999" });
    await revokeInstitutionIdentityDoubted(register, VERIFIER, {
      institutionId: FACTS.institutionId, rationale: "the row no longer matches its witness",
    });
    const row = await register.read(FACTS.institutionId);
    expect(institutionStateAt(row!.events, "2100-01-01T00:00:00.000Z")).toMatchObject({
      state: "REVOKED_IDENTITY_DOUBTED",
    });
  });
});

describe("withdrawal and identity doubt never collapse", () => {
  it("a withdrawn institution can later be revoked as identity-doubted", async () => {
    await propose();
    await verify();
    await withdrawInstitution(register, VERIFIER, {
      institutionId: FACTS.institutionId, rationale: "relationship ended",
    });
    await revokeInstitutionIdentityDoubted(register, VERIFIER, {
      institutionId: FACTS.institutionId, rationale: "we have since learned the entity was impersonated",
    });
    const row = await register.read(FACTS.institutionId);
    // BOTH EVENTS SURVIVE, in order. Reading the log says which happened and when — the whole reason
    // the two states are separate.
    expect(row!.events.map((e) => e.transition)).toEqual([
      "PROPOSE", "VERIFY", "WITHDRAW", "REVOKE_IDENTITY_DOUBTED",
    ]);
  });

  it("there is no re-verify: a withdrawn institution cannot be verified again", async () => {
    await propose();
    await verify();
    await withdrawInstitution(register, VERIFIER, {
      institutionId: FACTS.institutionId, rationale: "ended",
    });
    await expect(verify(steward("gov-carol"))).rejects.toThrow(/INSTITUTION_ILLEGAL_TRANSITION|already verified/);
  });

  it("a revocation reverses no proof: the ceiling is answered AS OF the instant, not now", async () => {
    await propose();
    await verify(VERIFIER, {});
    const row = await register.read(FACTS.institutionId);
    const beforeRevocation = new Date(Date.now() + 1000).toISOString();
    const verifiedThen = institutionAuthorityCeiling(row!.events, beforeRevocation);
    expect(verifiedThen.ceiling).toBe("AUTHORITY_VERIFIED");

    await revokeInstitutionIdentityDoubted(register, VERIFIER, {
      institutionId: FACTS.institutionId,
      rationale: "identity in doubt",
      at: new Date(Date.now() + 5000).toISOString(),
    });
    const after = await register.read(FACTS.institutionId);
    // WHAT AN ATTESTATION WAS AUTHORISED BY AT THE TIME IS WHAT IT STAYS AUTHORISED BY. Learning
    // changes future decisions only; the exposure is REPORTED, never retro-applied to a frozen proof.
    expect(institutionAuthorityCeiling(after!.events, beforeRevocation).ceiling).toBe("AUTHORITY_VERIFIED");
    expect(
      institutionAuthorityCeiling(after!.events, new Date(Date.now() + 9000).toISOString()).ceiling,
    ).not.toBe("AUTHORITY_VERIFIED");
  });
});

describe("THE FINDING THIS REGISTER UNCOVERED — NOW CLOSED, and the pin inverted", () => {
  // THE PIN DID ITS JOB. The three assertions that stood here described the pre-B3 state and were
  // written to FAIL when the wiring landed: *a finding nothing asserts is free to be forgotten.* The
  // wiring landed on 2026-11-18 with the owner's approval, so they are rewritten to assert the new
  // state rather than deleted — a closed finding whose assertions simply disappear leaves nothing
  // guarding the thing that was fixed.
  //
  // WHAT THE DEFECT WAS. `KeyRegistrationEvidence.institutionIdentityVerified` meant *the
  // institution's identity, established independently of whoever supplied the key*, and it arrived
  // over HTTP as a required boolean on the propose-key request — no citation, no legal entity, no
  // jurisdiction, no registry identifier, no second person, no lifecycle. `ProposeSettlementKey` is
  // held by `author` and `operator`: the BENEFICIARY side. Not unchecked, since a different identity
  // activates, but UNEVIDENCED — an activator had nothing to check the claim against.
  it("the key-registration schema NO LONGER accepts an institution claim from the caller", () => {
    const schemas = readRepoFile("server/http/schemas.ts");
    expect(schemas).not.toMatch(/institutionIdentityVerified: \{ type: "boolean" \}/);
    // AND AN INJECTED ONE IS A 400 RATHER THAN A SILENT STRIP, which is why the field had to leave the
    // schema rather than merely be ignored downstream: a caller who sends it believes they stated
    // something. `additionalProperties: false` is what makes that true.
    const evidenceBlock = schemas.slice(
      schemas.indexOf("      evidence: {"),
      schemas.indexOf("export const activateSettlementKeySchema"),
    );
    expect(evidenceBlock).toMatch(/additionalProperties: false/);
    expect(evidenceBlock).not.toMatch(/institutionIdentityVerified/);
  });

  it("the key's evidence type no longer has a field for it, so no caller can supply one", () => {
    const lifecycle = readRepoFile("src/contract/settlementKeyLifecycle.ts");
    const typeBlock = lifecycle.slice(
      lifecycle.indexOf("export interface KeyRegistrationEvidence {"),
      lifecycle.indexOf("export type KeyRegistrationRefusal ="),
    );
    expect(typeBlock).not.toMatch(/institutionIdentityVerified/);
    // ABSENT, NOT OPTIONAL. An optional field lets an existing caller keep its old behaviour by
    // saying nothing, which is how the proof bypass arose.
    expect(typeBlock).not.toMatch(/institutionIdentityVerified\?/);
  });

  it("the beneficiary side still proposes KEYS, which is correct and is not the defect", () => {
    // UNCHANGED ON PURPOSE. Which key a customer's settlements are signed with is a customer
    // preference, and governance still activates. What was wrong was that the same request also
    // asserted who the institution IS — a fact about NH's counterparty, not a preference.
    const identity = readRepoFile("server/auth/identity.ts");
    const authorBlock = identity.slice(identity.indexOf("  author: ["), identity.indexOf("  operator: ["));
    expect(authorBlock).toMatch(/ProposeSettlementKey/);
    // And the institution capabilities are NOT held by the beneficiary side.
    expect(authorBlock).not.toMatch(/ProposeInstitution|VerifyInstitution/);
    const operatorBlock = identity.slice(
      identity.indexOf("  operator: ["), identity.indexOf("  approver: ["),
    );
    expect(operatorBlock).not.toMatch(/ProposeInstitution|VerifyInstitution/);
  });

  it("the activation gate reads the register, and the layering is still a PORT", () => {
    const keyGov = readRepoFile("server/services/settlementKeyGovernance.ts");
    // It consults a sender-authority source, required rather than optional.
    expect(keyGov).toMatch(/institutions: SenderAuthoritySource/);
    expect(keyGov).toMatch(/KEY_SENDER_NOT_AUTHORISED/);
    // AND IT STILL DOES NOT IMPORT THE REGISTER. A key-governance module that could reach the
    // register directly could read an institution's legal entity, its citations, its governance log
    // or its witness, none of which is its business. The composition happens at the call site.
    expect(keyGov).not.toMatch(/from "\.\/institutionGovernance"/);
    expect(keyGov).not.toMatch(/from "\.\.\/persistence\/institutionStore"/);
    const adapter = readRepoFile("server/services/institutionSenderAuthority.ts");
    expect(adapter).toMatch(/from "\.\/institutionGovernance"/);
  });
});

describe("what this register does NOT do", () => {
  it("names no real institution anywhere in this test", () => {
    // A SYNTHETIC FIXTURE IS NOT A PILOT. Nothing here establishes that any real bank was verified,
    // and the fixture says so in the legal entity name itself.
    expect(FACTS.legalEntityName).toMatch(/NOT A REAL INSTITUTION/);
    expect(FACTS.jurisdiction).toBe("ZZ");
  });

  it("is imported by a NAMED, CLOSED set — asserted on import specifiers, not on prose", () => {
    // B3 · THE SET GREW BY EXACTLY TWO, AND THAT IS WHY THIS IS A LIST RATHER THAN A COUNT. Before the
    // wiring this suite asserted the register had no production importer at all. It now has the
    // adapter and the route composition, and each had to be added here deliberately — an assertion
    // that silently tracked whatever imports appeared would guard nothing.
    const importers = execSyncSafe(
      "grep -rlE \"from \\\"[^\\\"]*institutionGovernance\\\"\" --include=*.ts server src || true",
    )
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^\.\//, ""))
      .sort();
    expect(importers).toEqual([
      // PRODUCTION: the store, and the adapter — which is the ONLY module that joins the two
      // registers. Nothing else reaches it, and `server/app.ts` composes them without importing the
      // governance service itself.
      "server/persistence/institutionStore.ts",
      "server/services/institutionSenderAuthority.ts",
      // TESTS: this suite, the register's own Postgres suite, and the key register's suite — which
      // runs the REAL composition and is what stands behind every `senderVerified()` double.
      "server/persistence/institutionRegister.postgres.test.ts",
      "server/persistence/settlementKeyRegister.postgres.test.ts",
      "server/services/institutionGovernance.test.ts",
    ].sort());
  });

  it("the importer scan is not vacuous — it finds a real importer when there is one", () => {
    // A GUARD THAT CANNOT FIRE IS NO GUARD. Proved on a module that certainly has importers, so a
    // pattern that silently matched nothing could not pass as "no importers".
    const known = execSyncSafe(
      "grep -rlE \"from \\\"[^\\\"]*settlementKeyGovernance\\\"\" --include=*.ts server src || true",
    ).trim();
    expect(known.length).toBeGreaterThan(0);
  });

  it("NO proof, monetary, reconciliation or domain module reaches it", () => {
    // THE PROPERTY THE LIST ABOVE EXISTS TO PROTECT, asserted on its own rather than inferred from a
    // count. B3 · `server/app.ts` LEFT this list, because wiring the activation route is exactly the
    // consumer the owner approved; everything that touches MONEY is still forbidden, and that is the
    // line the register must not cross. The institution's authority decides whether a key may be put
    // in force — it does not decide a figure, recompute a proof, or reverse one.
    const forbidden = [
      "server/services/proofService.ts",
      "server/services/externalSettlementGate.ts",
      "server/services/settlementClaim.ts",
      "server/persistence/proofStore.ts",
      "src/domain/approval.ts",
      "src/domain/invariants.ts",
      "src/domain/outcomes.ts",
      "src/benchmark/reconciliationCore.ts",
    ];
    for (const file of forbidden) {
      // NAMED AS FILES THAT EXIST, so the list cannot rot into a set of paths that were renamed away
      // and would then vacuously pass.
      expect(existsSyncSafe(file), `${file} does not exist; the forbidden list has rotted`).toBe(true);
      const src = readRepoFile(file);
      expect(
        /from "[^"]*institution(Governance|Identity|Store|SenderAuthority)"/.test(src),
        `${file} imports the institution register — a monetary surface must not decide authority`,
      ).toBe(false);
    }
  });

  it("the register reverses no proof: the ceiling is historical and nothing recomputes", () => {
    // STATED ON THE CODE. A revocation must change FUTURE decisions only, so no monetary figure can
    // move because governance learned something today.
    const adapter = readRepoFile("server/services/institutionSenderAuthority.ts");
    const keyGov = readRepoFile("server/services/settlementKeyGovernance.ts");
    for (const src of [adapter, keyGov]) {
      expect(src).not.toMatch(/proofStore|recomputeProof|revokeProof|provenRevenue/);
    }
    // And the only transition the gate can cause is an ACTIVATION, never a reversal.
    expect(keyGov).toMatch(/transition: "ACTIVATED"/);
  });
});

function existsSyncSafe(rel: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return existsSync(resolve(process.cwd(), rel));
}

function readRepoFile(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

function execSyncSafe(cmd: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  return execSync(cmd, { cwd: process.cwd(), encoding: "utf8" });
}
