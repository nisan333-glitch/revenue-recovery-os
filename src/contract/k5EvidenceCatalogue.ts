// K5 · THE EVIDENCE A REAL FINANCIAL INSTITUTION'S KEY REGISTRATION MUST PRODUCE.
//
// WHY THIS IS DATA AND NOT A DOCUMENT. `docs/K5_INSTITUTION_VERIFICATION_V1.md` argues what must be
// verified and why. This is the operational list a person actually collects, and it is declared here
// so the customer-facing checklist is RENDERED FROM IT rather than written beside it — the rule the
// pilot-intake package already follows, for the reason it was introduced: a hand-authored list drifts
// from the code silently, and whoever is doing the ceremony discovers it afterwards.
//
// THE ONE THING THIS FILE MUST NOT DO IS FLATTER THE CEREMONY. `KeyRegistrationEvidence` is four
// booleans, and `keyMayBeActivated` refuses until all four are true — but every one of them ARRIVES
// FROM THE NH OPERATOR, and the server validates only that it is `true`. Under the Trust Invariant's
// standing test that is a gate whose input is supplied by the side that benefits from passing it. So
// each item below carries what NH can ACTUALLY do with it, and three of the four conditions are
// `UNCORROBORATED_CLAIM` by construction. Denying all three leaves the register's integrity standing;
// what it does not leave standing is the sentence "the institution is verified".
//
// NO IMPORTS BUT THE TYPES IT CLASSIFIES. The catalogue is a statement about the lifecycle's own
// conditions, so it is tied to them by the compiler rather than by a naming convention.
import type { KeyRegistrationEvidence } from "./settlementKeyLifecycle";

/** Version of this catalogue. A change in what the ceremony demands is a NEW id, never a silent edit. */
export const K5_EVIDENCE_CATALOGUE_VERSION = "k5-evidence-2026.1";

/** Which of the four governed conditions an item supports. Keyed to the type, not to a string. */
export type K5Condition = keyof KeyRegistrationEvidence;

/**
 * What NH can do with the item once it is in hand.
 *
 * The same three-way split `corroborateAttestation` uses, for the same reason: *a rung may rest only
 * on what NH can CHECK, and a claim NH cannot check is recorded, attributed and labelled — never
 * counted as evidence for it.*
 */
export type K5Checkability =
  /** NH can verify this itself, mechanically, from the artefact. */
  | "CORROBORATED"
  /** NH can check the artefact's SHAPE and that it is present — not that it is true. */
  | "WELL_FORMED"
  /** NH records it and can establish nothing about it. The honest default for a human verification. */
  | "UNCORROBORATED_CLAIM";

export interface K5EvidenceItem {
  readonly id: string;
  /** The governed condition this item is collected for. */
  readonly supports: K5Condition;
  /** What the person doing the ceremony must obtain. */
  readonly artefact: string;
  /** Who issues it. NEVER NH, and never the party whose key is being registered where avoidable. */
  readonly issuedBy: string;
  readonly checkability: K5Checkability;
  /** Why this item and not a cheaper one. Rendered to the operator, so it must survive being read. */
  readonly why: string;
  /** What this item does NOT establish. The half a checklist usually drops. */
  readonly doesNotEstablish: string;
}

export const K5_EVIDENCE_ITEMS: readonly K5EvidenceItem[] = Object.freeze([
  // ── C1 · the channel ────────────────────────────────────────────────────────────────────────
  Object.freeze({
    id: "K5-E1",
    supports: "channelIndependentlyVerified" as const,
    artefact:
      "The institution's own published key-distribution channel, located WITHOUT using any address, " +
      "link or contact supplied in the message that carried the key — e.g. a URL reached from the " +
      "institution's primary domain, or a channel named in a signed contract already on file.",
    issuedBy: "the institution, published independently of this exchange",
    checkability: "UNCORROBORATED_CLAIM",
    why:
      "The attack this defeats is the whole reason the condition exists: an attacker who controls the " +
      "message that delivers the key also controls every address inside it, so verifying the channel " +
      "against the message verifies the attacker against himself.",
    doesNotEstablish:
      "that the key published there is the key the institution intended — only that the channel is the " +
      "institution's own.",
  }),
  Object.freeze({
    id: "K5-E2",
    supports: "channelIndependentlyVerified" as const,
    artefact:
      "A record of HOW the channel was located, naming the independent source used (domain, contract " +
      "clause, regulator register entry) and the date.",
    issuedBy: "the NH operator performing the ceremony",
    checkability: "WELL_FORMED",
    why:
      "Without it the channel check is unrepeatable, and an unrepeatable check cannot be audited later " +
      "by anyone who was not in the room.",
    doesNotEstablish: "that the independent source was itself genuine.",
  }),

  // ── C2 · the institution's identity ─────────────────────────────────────────────────────────
  Object.freeze({
    id: "K5-E3",
    supports: "institutionIdentityVerified" as const,
    artefact:
      "The legal entity's identity from an authority that is NOT a party to this exchange: company " +
      "registration number and legal name from the companies registry, or the licence entry from the " +
      "financial regulator that supervises it.",
    issuedBy: "a companies registry or financial regulator",
    checkability: "UNCORROBORATED_CLAIM",
    why:
      "This is the one condition a challenge-response can never supply. Anyone can generate an Ed25519 " +
      "pair and answer a nonce perfectly; what that proves is CONTROL OF A KEY and nothing about WHO " +
      "HOLDS IT. The identity has to come from somewhere neither side of the exchange controls.",
    doesNotEstablish:
      "that the person who sent the key is authorised by that entity — see K5-E4.",
  }),
  Object.freeze({
    id: "K5-E4",
    supports: "institutionIdentityVerified" as const,
    artefact:
      "Confirmation that the individual or system supplying the key is authorised by the institution to " +
      "do so, obtained through the channel from K5-E1 and NOT through the sender's own reply path.",
    issuedBy: "the institution, through its own published channel",
    checkability: "UNCORROBORATED_CLAIM",
    why:
      "An entity being real does not make a particular sender its agent, and a compromised mailbox " +
      "inside a genuine institution is the most ordinary form of this attack.",
    doesNotEstablish: "that the key itself is uncompromised at the institution's end.",
  }),

  // ── C3 · control of the key ─────────────────────────────────────────────────────────────────
  Object.freeze({
    id: "K5-E5",
    supports: "keyControlDemonstrated" as const,
    artefact:
      "A challenge-response: NH chooses a fresh random nonce, the institution returns a signature over " +
      "it under the key being registered, and NH verifies that signature against the public key it is " +
      "about to register. The nonce, the response and the verification result are all recorded.",
    issuedBy: "the institution, under the key being registered",
    checkability: "CORROBORATED",
    why:
      "The ONLY cryptographic step in the ceremony and the only item NH can verify mechanically. It " +
      "proves the responder holds the private half of the key about to be registered.",
    doesNotEstablish:
      "WHO holds it. This item may never substitute for K5-E3 or K5-E4, which is why the lifecycle " +
      "declares `keyControlDemonstrated` as a field separate from `institutionIdentityVerified`.",
  }),
  Object.freeze({
    id: "K5-E6",
    supports: "keyControlDemonstrated" as const,
    artefact:
      "The public key's fingerprint, read back to the institution through the K5-E1 channel and " +
      "confirmed there, so the value NH registers is the value the institution meant to publish.",
    issuedBy: "the institution, through its own published channel",
    checkability: "UNCORROBORATED_CLAIM",
    why:
      "A challenge-response succeeds against whatever key was substituted along with the challenge. " +
      "Reading the fingerprint back through an independent channel is what closes the substitution.",
    doesNotEstablish: "anything about the key's future handling at the institution.",
  }),

  // ── C4 · the ceremony record ────────────────────────────────────────────────────────────────
  Object.freeze({
    id: "K5-E7",
    supports: "ceremonyRecorded" as const,
    artefact:
      "The ceremony record: the channel used, who confirmed at the institution, the key fingerprint, " +
      "the declared validity window, the nonce and response from K5-E5, the date, and the two NH " +
      "identities — the one who proposed and the one who activated.",
    issuedBy: "the NH operator performing the ceremony",
    checkability: "WELL_FORMED",
    why:
      "The register enforces that the proposer is not the activator (`KEY_PROPOSER_MAY_NOT_ACTIVATE`), " +
      "and this is the human half of that control. Without the record the separation is a database " +
      "fact with no account of what the two people actually did.",
    doesNotEstablish:
      "that the steps it describes were performed correctly — it is a record, and NH checks that it is " +
      "complete, not that it is true.",
  }),
  Object.freeze({
    id: "K5-E8",
    supports: "ceremonyRecorded" as const,
    artefact:
      "A documented approval by a second authorised NH identity, distinct from whoever performed " +
      "K5-E1 to K5-E6, recorded before activation.",
    issuedBy: "the second NH identity (the activator)",
    checkability: "WELL_FORMED",
    why:
      "No beneficiary may be the sole author, approver or verifier of their own claim. The register " +
      "refuses a proposer who tries to activate, so this item is what that refusal is protecting.",
    doesNotEstablish: "independence of judgement — only that two identities were involved.",
  }),
]);

/**
 * Which conditions have at least one item NH can verify MECHANICALLY.
 *
 * Returned as a derivation rather than a constant, so it can never disagree with the catalogue. It
 * exists to make the central K5 finding checkable rather than rhetorical: **three of the four governed
 * conditions have no corroborated evidence at all**, so four green booleans are four RECORDED CLAIMS
 * and exactly one measurement.
 */
export function k5MechanicallyVerifiableConditions(): readonly K5Condition[] {
  const verifiable = new Set<K5Condition>();
  for (const item of K5_EVIDENCE_ITEMS) {
    if (item.checkability === "CORROBORATED") verifiable.add(item.supports);
  }
  return Object.freeze([...verifiable]);
}

/**
 * The sentence a pilot brief may truthfully carry about a registered key.
 *
 * DERIVED, never authored beside the catalogue: the count comes from the catalogue itself, so a future
 * item that genuinely becomes corroborated changes this line with no edit here — and, just as
 * importantly, removing the one corroborated item cannot leave an optimistic sentence behind.
 */
export function k5HonestStatement(): string {
  const verifiable = k5MechanicallyVerifiableConditions().length;
  const total = new Set(K5_EVIDENCE_ITEMS.map((i) => i.supports)).size;
  return (
    `Of the ${total} governed registration conditions, NH can verify ${verifiable} mechanically ` +
    `(challenge-response over a nonce NH chose). The other ${total - verifiable} are recorded claims ` +
    "by the NH operator: NH refuses to activate until they are claimed and makes the claim auditable, " +
    "and it establishes none of them itself. A registered key is therefore NOT a verified institution, " +
    "and no readiness level above SOURCE_ATTESTED is reachable from this ceremony."
  );
}
