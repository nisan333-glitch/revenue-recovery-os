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

/** The four governed conditions, derived from the TYPE via a value the compiler checks. */
const ALL_CONDITIONS: Record<K5Condition, true> = {
  channelIndependentlyVerified: true,
  institutionIdentityVerified: true,
  keyControlDemonstrated: true,
  ceremonyRecorded: true,
};
const CONDITIONS = Object.keys(ALL_CONDITIONS) as K5Condition[];

describe("K5 evidence catalogue · coverage", () => {
  it("pins the catalogue version, because a change in what the ceremony demands is a new id", () => {
    expect(K5_EVIDENCE_CATALOGUE_VERSION).toBe("k5-evidence-2026.1");
  });

  it("covers EVERY governed registration condition — a condition with no item is an unaskable gate", () => {
    for (const condition of CONDITIONS) {
      const items = K5_EVIDENCE_ITEMS.filter((i) => i.supports === condition);
      expect(items.length, `no evidence item supports ${condition}`).toBeGreaterThan(0);
    }
  });

  it("every refusal the lifecycle can raise corresponds to a condition the catalogue covers", () => {
    // Derived from the refusal function rather than a hand-kept list, so a fifth condition added to
    // `KeyRegistrationEvidence` fails here instead of silently having no evidence behind it.
    const none: KeyRegistrationEvidence = {
      channelIndependentlyVerified: false, institutionIdentityVerified: false,
      keyControlDemonstrated: false, ceremonyRecorded: false,
    };
    expect(keyRegistrationRefusals(none)).toHaveLength(CONDITIONS.length);
    expect(new Set(K5_EVIDENCE_ITEMS.map((i) => i.supports)).size).toBe(CONDITIONS.length);
  });

  it("every item names an issuer, and NH never issues the evidence for the institution's identity", () => {
    for (const item of K5_EVIDENCE_ITEMS) {
      expect(item.issuedBy.trim().length).toBeGreaterThan(0);
      if (item.supports === "institutionIdentityVerified") {
        // The identity must come from somewhere neither side of the exchange controls. An item NH
        // issued for this condition would be NH vouching for its own counterparty.
        expect(item.issuedBy).not.toMatch(/\bNH\b/);
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
  it("EXACTLY ONE condition is mechanically verifiable, and it is key CONTROL", () => {
    // The central finding, as a measurement rather than a sentence. Anyone can generate an Ed25519
    // pair and answer a nonce; what that proves is control of a key and nothing about who holds it.
    expect(k5MechanicallyVerifiableConditions()).toEqual(["keyControlDemonstrated"]);
  });

  it("the three human verifications are UNCORROBORATED, never WELL_FORMED-by-accident", () => {
    // `WELL_FORMED` would be a quiet upgrade: it says NH checked the artefact's shape, which for a
    // channel or an identity reads as having checked the thing itself.
    const human = K5_EVIDENCE_ITEMS.filter(
      (i) => i.supports === "channelIndependentlyVerified" || i.supports === "institutionIdentityVerified",
    );
    for (const item of human) {
      if (item.issuedBy.includes("NH operator")) continue; // the ceremony's own record of how it looked
      expect(item.checkability, `${item.id} overstates what NH can do`).toBe("UNCORROBORATED_CLAIM");
    }
  });

  it("the honest statement is DERIVED from the catalogue and refuses the flattering reading", () => {
    const s = k5HonestStatement();
    expect(s).toContain("verify 1 mechanically");
    expect(s).toContain("The other 3 are recorded claims");
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
