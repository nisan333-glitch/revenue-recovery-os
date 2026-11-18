// K5 · THE EVIDENCE A REAL FINANCIAL INSTITUTION'S KEY REGISTRATION MUST PRODUCE.
//
// WHY THIS IS DATA AND NOT A DOCUMENT. `docs/K5_INSTITUTION_VERIFICATION_V1.md` argues what must be
// verified and why. This is the operational list a person actually collects, and it is declared here
// so the customer-facing checklist is RENDERED FROM IT rather than written beside it — the rule the
// pilot-intake package already follows, for the reason it was introduced: a hand-authored list drifts
// from the code silently, and whoever is doing the ceremony discovers it afterwards.
//
// THE ONE THING THIS FILE MUST NOT DO IS FLATTER THE CEREMONY. `KeyRegistrationEvidence` is now THREE
// booleans and `keyDeclaredConditionsComplete` refuses until all three are true — but every one of
// them ARRIVES FROM THE NH OPERATOR, and the server validates only that it is `true`. Under the Trust
// Invariant's standing test that is a gate whose input is supplied by the side that benefits from
// passing it. So each item below carries what NH can ACTUALLY do with it, and most are
// `UNCORROBORATED_CLAIM` by construction. Denying them leaves the register's integrity standing; what
// it does not leave standing is the sentence "the institution is verified".
//
// B3 · AND THAT SENTENCE IS NO LONGER A BOOLEAN AT ALL. The institution's identity left
// `KeyRegistrationEvidence` on 2026-11-18 and is derived from the governed institution register, where
// K5-E3 and K5-E4 are cited conditions a second governance identity must verify. The items did not
// change; what refuses when they are missing did.
//
// NO IMPORTS BUT THE TYPES IT CLASSIFIES. The catalogue is a statement about the lifecycle's own
// conditions, so it is tied to them by the compiler rather than by a naming convention.
import type { KeyRegistrationEvidence } from "./settlementKeyLifecycle";
import type { InstitutionAuthorityCondition } from "./institutionAuthority";

/** Version of this catalogue. A change in what the ceremony demands is a NEW id, never a silent edit. */
export const K5_EVIDENCE_CATALOGUE_VERSION = "k5-evidence-2026.2";

/**
 * Which governed condition an item supports. Keyed to the TYPES, never to a string.
 *
 * ── B3 · THE CEREMONY NOW SPANS TWO GOVERNED OBJECTS, 2026-11-18 ─────────────────────────────────
 *
 * It used to be `keyof KeyRegistrationEvidence` alone, which was accurate while all four conditions
 * were booleans on a key-registration request. The institution's identity left that type: it is now
 * derived from the governed institution register, where it is six separately cited conditions plus two
 * the server establishes itself.
 *
 * SO THIS UNION IS THE HONEST SHAPE, and widening it rather than re-pointing everything at one object
 * is deliberate: K5-E1 and K5-E2 really are facts a KEY registration declares, while K5-E3 and K5-E4
 * really are facts an INSTITUTION's admission establishes. Collapsing them would lose which governed
 * object refuses when an item is missing — and that is the only half of the answer that says where to
 * go and look.
 */
export type K5Condition = keyof KeyRegistrationEvidence | InstitutionAuthorityCondition;

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
    // B3 · re-pointed from the key's retired boolean to the institution register's own condition. The
    // artefact did not change: a registry or regulator entry is exactly what
    // `legalEntityVerifiedIndependently` is cited for, and the register now REQUIRES a non-blank
    // citation for it rather than accepting a tick.
    supports: "legalEntityVerifiedIndependently" as const,
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
    // B3 · the sender being an agent of a real entity is `authorisedSignatoriesEstablished`, which is
    // a separate condition in the register — so "the entity is real" and "this sender speaks for it"
    // can no longer be satisfied by one boolean, which is what K5-E4's own `why` always said.
    supports: "authorisedSignatoriesEstablished" as const,
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
      "declares `keyControlDemonstrated` separately, and why the institution's identity is now a " +
      "governed register entry rather than a boolean on the same request.",
  }),
  Object.freeze({
    id: "K5-E6",
    // B3 · re-pointed. The artefact is unchanged and was always the fingerprint confirmation; the
    // institution register names that condition explicitly, so filing it under key CONTROL was the
    // old type's limitation rather than a judgement. K5-E5 is now the only key-control item, which is
    // exactly right: the challenge-response is the control, and the fingerprint is what stops a
    // substituted key answering it.
    supports: "keyFingerprintConfirmedOutOfBand" as const,
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
    // B3 · re-pointed AND UPGRADED, and the upgrade is the one thing in this file that must not be
    // taken on trust, because `WELL_FORMED` → `CORROBORATED` is exactly the quiet flattery the
    // catalogue exists to prevent. It is justified because the proposition became MECHANICAL: the
    // institution register's verification table has NO COLUMN for a second person, and a
    // `BEFORE INSERT` trigger reads the institution's own stored `proposed_by_actor_id` and raises
    // `INSTITUTION_PROPOSER_MAY_NOT_VERIFY`. So NH does not check that a record of two identities is
    // complete — it derives the fact from an append-only ledger and the database refuses the
    // alternative. A test asserts the trigger exists, so this label rests on a mechanism rather than
    // on this comment.
    supports: "secondPersonApproval" as const,
    artefact:
      "The institution register's own event ledger: a PROPOSE event by one governance identity and a " +
      "VERIFY event by a different one, with the verification row the database only accepts when the " +
      "two differ. Nobody submits this item — NH derives it.",
    issuedBy: "NH's own append-only governance ledger",
    checkability: "CORROBORATED",
    why:
      "No beneficiary may be the sole author, approver or verifier of their own claim. Until B3 this " +
      "was a record NH checked for completeness; it is now a fact the database will not let be false, " +
      "which is the difference between a control and an account of one.",
    doesNotEstablish:
      "independence of JUDGEMENT — only that two distinct identities acted. Two colleagues who agree " +
      "without looking satisfy it, which is why the six cited conditions exist alongside it.",
  }),

  // ── C2c · the regulator's own register ──────────────────────────────────────────────────────
  Object.freeze({
    id: "K5-E9",
    // B3 · NEW. The institution register governs `regulatoryStandingVerified` as a condition in its
    // own right, and it had no evidence item — a governed condition with nothing to collect is an
    // unaskable gate, which is precisely what the coverage test refuses.
    supports: "regulatoryStandingVerified" as const,
    artefact:
      "The entity's entry in the register of the authority that supervises it — a licence or " +
      "authorisation number, the permissions it covers, and its current status, read from the " +
      "regulator's own published register rather than from anything the institution sent us.",
    issuedBy: "the financial regulator that supervises the entity",
    checkability: "UNCORROBORATED_CLAIM",
    why:
      "A real legal entity is not necessarily one permitted to hold client money or settle payments, " +
      "and K5-E3 establishes only that the company exists. A registry extract and a licence entry are " +
      "different facts from different authorities, and conflating them would let a dissolved or " +
      "unlicensed entity pass on the strength of having once been incorporated.",
    doesNotEstablish:
      "that the licence covers THIS arrangement, or that it is still in force on any later date — a " +
      "standing check is a snapshot, and the register records when it was taken.",
  }),
]);

/**
 * Which conditions have at least one item NH can verify MECHANICALLY.
 *
 * Returned as a derivation rather than a constant, so it can never disagree with the catalogue. It
 * exists to make the central K5 finding checkable rather than rhetorical: **most governed conditions
 * have no corroborated evidence at all**, so a complete tick list is a set of RECORDED CLAIMS and a
 * small number of measurements.
 *
 * B3 MOVED THIS COUNT, WHICH IS THE POINT RATHER THAN A SIDE EFFECT. It was 1 of 4 when the
 * institution's identity was a boolean an operator ticked. It is now 2 of 8: the challenge-response,
 * and the second governance identity — the latter because the institution register's verification
 * table has no column for it and a database trigger refuses a row where the verifier is the proposer.
 * The remaining six are still claims NH records and cannot check, and that is the honest shape.
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
  // THE MECHANICAL ONES ARE NAMED, NOT COUNTED. A bare "NH verifies 2 mechanically" invites the
  // reader to guess which two, and the flattering guess is always the identity.
  const named = k5MechanicallyVerifiableConditions().join(" and ");
  return (
    `Of the ${total} governed registration conditions, NH can verify ${verifiable} mechanically ` +
    `(${named}). The other ${total - verifiable} are recorded claims: NH refuses to put a key in ` +
    "force until they are cited and makes the citation auditable, and it establishes none of them " +
    "itself. A registered key is therefore NOT a verified institution, and no readiness level above " +
    "SOURCE_ATTESTED is reachable from this ceremony."
  );
}
