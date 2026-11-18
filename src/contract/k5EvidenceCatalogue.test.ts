// K5 · falsifiers for the evidence catalogue, and for the one claim it exists to prevent.
import { describe, expect, it } from "vitest";
import {
  K5_EVIDENCE_CATALOGUE_VERSION,
  K5_EVIDENCE_ITEMS,
  k5HonestStatement,
  k5MechanicallyVerifiableConditions,
  type K5Condition,
} from "./k5EvidenceCatalogue";
import { keyRegistrationRefusals, type KeyRegistrationEvidence } from "./settlementKeyLifecycle";

/**
 * Every governed condition, derived from the TYPE via a value the compiler checks exhaustively.
 *
 * B3 · IT SPANS TWO GOVERNED OBJECTS NOW. `K5Condition` is the union of the key's declared conditions
 * and the institution register's, and the three key ones are also institution ones by name — so the
 * union has eight distinct members and a `Record` over it is the only honest way to enumerate them. A
 * ninth condition added to either object fails to compile here rather than quietly having no evidence.
 */
const ALL_CONDITIONS: Record<K5Condition, true> = {
  channelIndependentlyVerified: true,
  keyControlDemonstrated: true,
  ceremonyRecorded: true,
  legalEntityVerifiedIndependently: true,
  regulatoryStandingVerified: true,
  authorisedSignatoriesEstablished: true,
  keyFingerprintConfirmedOutOfBand: true,
  secondPersonApproval: true,
};
const CONDITIONS = Object.keys(ALL_CONDITIONS) as K5Condition[];

describe("K5 evidence catalogue · coverage", () => {
  it("pins the catalogue version, because a change in what the ceremony demands is a new id", () => {
    // B3 · BUMPED, not silently edited: an item was added, two were re-pointed to the institution
    // register's own conditions and one was upgraded from WELL_FORMED to CORROBORATED. That is a
    // change in what the ceremony demands and in what NH claims to verify.
    expect(K5_EVIDENCE_CATALOGUE_VERSION).toBe("k5-evidence-2026.2");
  });

  it("covers EVERY governed registration condition — a condition with no item is an unaskable gate", () => {
    for (const condition of CONDITIONS) {
      const items = K5_EVIDENCE_ITEMS.filter((i) => i.supports === condition);
      expect(items.length, `no evidence item supports ${condition}`).toBeGreaterThan(0);
    }
  });

  it("every refusal the KEY's lifecycle can raise has a condition the catalogue covers", () => {
    // Derived from the refusal function rather than a hand-kept list. B3 · the lifecycle now raises
    // refusals for its THREE declared conditions only; the institution's are a different object's,
    // which is why this no longer compares against the full condition count.
    const none: KeyRegistrationEvidence = {
      channelIndependentlyVerified: false,
      keyControlDemonstrated: false, ceremonyRecorded: false,
    };
    const raised = keyRegistrationRefusals(none);
    expect(raised).toHaveLength(3);
    expect(raised.join(" ")).not.toMatch(/INSTITUTION/);
  });

  it("the catalogue covers EVERY member of the union, with nothing spare", () => {
    // BOTH DIRECTIONS. A condition with no item is an unaskable gate; an item supporting a condition
    // no governed object declares would be evidence collected for nothing.
    const covered = new Set(K5_EVIDENCE_ITEMS.map((i) => i.supports));
    expect([...covered].sort()).toEqual([...CONDITIONS].sort());
    expect(covered.size).toBe(8);
  });

  it("every item names an issuer, and NH never issues the evidence for the institution's identity", () => {
    for (const item of K5_EVIDENCE_ITEMS) {
      expect(item.issuedBy.trim().length).toBeGreaterThan(0);
      // B3 · THE IDENTITY CONDITIONS, named individually rather than as one boolean. The identity must
      // come from somewhere neither side of the exchange controls, so an item NH issued for any of
      // them would be NH vouching for its own counterparty.
      const identityConditions: readonly K5Condition[] = [
        "legalEntityVerifiedIndependently",
        "regulatoryStandingVerified",
        "authorisedSignatoriesEstablished",
      ];
      if (identityConditions.includes(item.supports)) {
        expect(item.issuedBy, `${item.id} has NH vouching for its own counterparty`).not.toMatch(/\bNH\b/);
      }
    }
  });

  it("every item states what it does NOT establish — the half a checklist usually drops", () => {
    for (const item of K5_EVIDENCE_ITEMS) {
      expect(item.doesNotEstablish.trim().length, `${item.id} claims no limitation`).toBeGreaterThan(20);
      expect(item.why.trim().length).toBeGreaterThan(20);
    }
  });

  it("item ids are unique and shaped, so the checklist can reference them", () => {
    const ids = K5_EVIDENCE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^K5-E\d+$/);
  });
});

describe("K5 evidence catalogue · the claim it exists to prevent", () => {
  it("EXACTLY TWO conditions are mechanically verifiable, and NEITHER is the identity", () => {
    // The central finding, as a measurement rather than a sentence. Anyone can generate an Ed25519
    // pair and answer a nonce; what that proves is control of a key and nothing about who holds it.
    //
    // B3 · IT WENT FROM ONE TO TWO, and the second is the separation of duties — not the identity.
    // The flattering reading of "two of eight are mechanical" is that one of them establishes who we
    // are talking to. Asserted negatively as well, so that reading cannot creep in.
    expect([...k5MechanicallyVerifiableConditions()].sort()).toEqual([
      "keyControlDemonstrated", "secondPersonApproval",
    ]);
    for (const identity of [
      "legalEntityVerifiedIndependently", "regulatoryStandingVerified",
      "authorisedSignatoriesEstablished", "keyFingerprintConfirmedOutOfBand",
    ] as K5Condition[]) {
      expect(k5MechanicallyVerifiableConditions(), `${identity} is claimed as mechanical`)
        .not.toContain(identity);
    }
  });

  it("the CORROBORATED upgrade rests on a database trigger, not on a comment", () => {
    // `WELL_FORMED` → `CORROBORATED` is the quiet flattery this catalogue exists to prevent, so the
    // one upgrade B3 made is tied to the mechanism that justifies it. If the trigger is ever removed
    // this fails, rather than the label quietly outliving the control.
    const sql = readRepoFile("scripts/migration-design/institution-register-up.sql");
    expect(sql).toMatch(/CREATE TRIGGER governed_institution_verifications_second_person/);
    expect(sql).toMatch(/INSTITUTION_PROPOSER_MAY_NOT_VERIFY/);
    // And there is no column a verifier could assert it with.
    const verificationTable = sql.slice(
      sql.indexOf('CREATE TABLE "governed_institution_verifications"'),
      sql.indexOf('ALTER TABLE "governed_institution_verifications"'),
    );
    expect(verificationTable).not.toMatch(/second_person|"approved_by"/);
    const item = K5_EVIDENCE_ITEMS.find((i) => i.supports === "secondPersonApproval");
    expect(item?.checkability).toBe("CORROBORATED");
  });

  it("the three human verifications are UNCORROBORATED, never WELL_FORMED-by-accident", () => {
    // `WELL_FORMED` would be a quiet upgrade: it says NH checked the artefact's shape, which for a
    // channel or an identity reads as having checked the thing itself.
    const human = K5_EVIDENCE_ITEMS.filter(
      (i) => i.supports === "channelIndependentlyVerified"
        || i.supports === "legalEntityVerifiedIndependently"
        || i.supports === "regulatoryStandingVerified"
        || i.supports === "authorisedSignatoriesEstablished",
    );
    for (const item of human) {
      if (item.issuedBy.includes("NH operator")) continue; // the ceremony's own record of how it looked
      expect(item.checkability, `${item.id} overstates what NH can do`).toBe("UNCORROBORATED_CLAIM");
    }
  });

  it("the honest statement is DERIVED from the catalogue and refuses the flattering reading", () => {
    const s = k5HonestStatement();
    // B3 · 2 of 8, with BOTH named in the sentence. The figures are derived, so the assertion is
    // against what the catalogue actually holds rather than against a number typed into prose.
    expect(s).toContain("verify 2 mechanically");
    expect(s).toContain("The other 6 are recorded claims");
    expect(s).toContain("keyControlDemonstrated and secondPersonApproval");
    // AND THE SENTENCE MUST NOT NAME AN IDENTITY CONDITION AS MECHANICAL. The whole risk of a rising
    // count is that a reader assumes the identity is now among the verified ones.
    const mechanicalClause = s.slice(0, s.indexOf(". The other"));
    expect(mechanicalClause).not.toMatch(/legalEntity|regulatoryStanding|authorisedSignatories/);
    expect(s).toMatch(/NOT a verified institution/);
    expect(s).toMatch(/no readiness level above SOURCE_ATTESTED/);
  });

  it("the statement moves with the catalogue rather than being pinned to today's numbers", () => {
    // A hardcoded sentence would outlive the facts. This asserts the mechanism, not the text: the
    // counts in the statement are the counts the catalogue currently yields.
    const conditions = new Set(K5_EVIDENCE_ITEMS.map((i) => i.supports)).size;
    const verifiable = k5MechanicallyVerifiableConditions().length;
    expect(k5HonestStatement()).toContain(`Of the ${conditions} governed registration conditions`);
    expect(k5HonestStatement()).toContain(`verify ${verifiable} mechanically`);
  });

  it("no item's prose claims NH verifies an institution, a channel or an identity itself", () => {
    // A tripwire, labelled as one: prose can be rewritten into optimism, and the structural guards
    // above are what actually hold. This catches the careless version.
    const forbidden = [
      /NH verifies the institution/i,
      /NH confirms the (channel|identity)/i,
      /\bproves the institution\b/i,
      /institution is verified\b/i,
    ];
    for (const item of K5_EVIDENCE_ITEMS) {
      const prose = `${item.artefact} ${item.why} ${item.doesNotEstablish}`;
      for (const pattern of forbidden) {
        expect(prose, `${item.id} overstates NH's role`).not.toMatch(pattern);
      }
    }
  });
});

function readRepoFile(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(__dirname, "../..", rel), "utf8");
}
