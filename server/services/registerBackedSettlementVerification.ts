// G4 · VERIFY AGAINST THE GOVERNED REGISTER, NOT AN ENVIRONMENT VARIABLE.
//
// WHAT CHANGES. `SettlementVerifier` was constructed from `NH_SETTLEMENT_SOURCE_KEYS` — a parsed
// deployment variable with no registration, rotation, revocation, expiry or record of who added a key.
// Whoever could set that variable could mint the authority that decides whether a dollar is proven.
// This resolves the key from the G2 register instead, which is proposed by one identity, activated by
// another, append-only, and witness-verified wherever it is resolved for use.
//
// TWO QUESTIONS, ANSWERED SEPARATELY AND IN THIS ORDER. This is the reference-first scheduling lesson
// applied to keys:
//
//   1. WAS THE KEY IN FORCE WHEN IT SIGNED?        `validAt(issuedAt)` — historical, immutable.
//   2. IS IT STILL PERMITTED TO SUPPORT A NEW PROOF NOW?   the current-state check below.
//
// They must not be merged. (1) alone would let a key revoked as compromised keep minting new proofs,
// because it *was* in force at the signing instant. (2) alone would make a frozen proof stop
// reproducing the moment a key expired, breaking rule 5. And answering them together would let a
// WITHDRAWAL OF SUPPORT report itself as THE RECORD HAVING CHANGED — exactly the conflation the
// scheduling path had to separate.
//
// FAIL-CLOSED THROUGHOUT. Every refusal is a throw with its own named code; nothing returns a falsy
// value a caller could carry on past, and there is no path in which an unresolvable key is treated as
// an acceptable one.

import { ForbiddenError } from "../http/errors";
import {
  SettlementVerifier,
  type SettlementAttestation,
  type SettlementReceipt,
  type SettlementTrustKey,
} from "./settlementVerification";
import { resolveForUse, type SettlementKeyRegister } from "./settlementKeyGovernance";
import {
  compromiseAssessment,
  stateAt,
  validAt,
  type CompromiseAssessment,
  type SettlementKeyFacts,
} from "../../src/contract/settlementKeyLifecycle";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";

export type RegisterVerificationRefusal =
  /** The key's state NOW forbids it supporting a new proof. Distinct from "it was not in force then". */
  | "SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED"
  /** The key is revoked as compromised, so it supports nothing new whatever it signed in the past. */
  | "SETTLEMENT_KEY_REVOKED_COMPROMISED"
  /** The register row's own lifecycle log is unusable, so no answer can be derived from it. */
  | "SETTLEMENT_KEY_LIFECYCLE_UNUSABLE";

export interface RegisterBackedReceipt {
  readonly receipt: SettlementReceipt;
  /** The key's immutable facts as the register holds them, witness already re-verified. */
  readonly key: SettlementKeyFacts;
  /**
   * The compromise status of THIS attestation, carried beside the receipt.
   *
   * `NOT_APPLICABLE` on a healthy key. It is returned rather than merely checked because a future
   * caller freezing a proof must record it: re-deriving it later from a mutable register would make a
   * frozen proof's trust status a function of the register's present contents.
   */
  readonly compromise: CompromiseAssessment;
}

/**
 * Verify one settlement attestation against the governed register.
 *
 * `now` is injected rather than read from the clock here, so every branch is reachable from a test and
 * the function stays a decision rather than a function of when it is called.
 */
export async function verifySettlementAgainstRegister(
  register: SettlementKeyRegister,
  fact: ExternalSettlementFact,
  attestation: SettlementAttestation,
  now: string,
): Promise<RegisterBackedReceipt> {
  // STEP 0 · resolve, with the witness re-checked. Throws `KEY_WITNESS_MISMATCH` on a row that changed
  // after it was registered, and 404 on one that was never registered — the two are different facts
  // and an operator must be able to tell them apart.
  const row = await resolveForUse(register, attestation.keyId);

  // STEP 1 · WAS IT IN FORCE WHEN IT SIGNED? Historical and immutable: a key retired on schedule still
  // verifies what it signed while active, which is what makes a frozen proof reproducible forever.
  const historical = validAt(row.facts, row.events, attestation.issuedAt);
  if (!historical.valid) {
    throw new ForbiddenError(`${historical.code}: ${historical.detail}`);
  }

  // STEP 2 · IS IT STILL PERMITTED TO SUPPORT A NEW PROOF? Asked SEPARATELY and SECOND, so a
  // withdrawal of support can never report itself as the record having changed.
  const current = stateAt(row.events, now);
  if (!current.ok) {
    throw new ForbiddenError(
      `SETTLEMENT_KEY_LIFECYCLE_UNUSABLE: ${current.detail}`,
    );
  }
  if (current.state === "REVOKED_COMPROMISED") {
    throw new ForbiddenError(
      "SETTLEMENT_KEY_REVOKED_COMPROMISED: the key is revoked as compromised, so it may support no " +
        "new proof whatever it signed before — existing frozen proofs are untouched and are flagged " +
        "rather than rewritten",
    );
  }
  // DRAFT is unreachable here because step 1 required ACTIVE at the signing instant and a key is
  // activated once, but it is refused explicitly rather than by implication: a decision that depends
  // on an upstream guard having run is a decision that breaks silently when the order changes.
  if (current.state !== "ACTIVE" && current.state !== "RETIRED") {
    throw new ForbiddenError(
      `SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED: the key's state is ${String(current.state)}`,
    );
  }

  // STEP 3 · the cryptography, over a verifier built from THIS ONE RESOLVED KEY.
  //
  // A ONE-KEY VERIFIER IS THE POINT, not an optimisation. The registry a verifier holds is its whole
  // trust set, so building it from the single row we just resolved makes it structurally impossible
  // for a second key — a stale one, another tenant's, one from the environment — to satisfy this
  // signature. The bindings are then checked again inside `verify`, which is correct: the same
  // defence twice, and neither one relying on the other having run.
  const single: SettlementTrustKey = {
    keyId: row.facts.keyId,
    boundaryId: row.facts.boundaryId,
    sourceSystem: row.facts.sourceSystem,
    sourceKind: row.facts.sourceKind as SettlementTrustKey["sourceKind"],
    publicKey: row.facts.publicKey,
  };
  const receipt = new SettlementVerifier([single], () => Date.parse(now)).verify(fact, attestation);

  return Object.freeze({
    receipt,
    key: row.facts,
    compromise: compromiseAssessment(row.events, attestation.issuedAt),
  });
}
