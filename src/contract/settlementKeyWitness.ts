// G1 · THE REGISTER ROW'S WITNESS.
//
// WHY A HASH AND NOT JUST `keyId`. A receipt frozen into a proof names a key id. That id is only as
// trustworthy as the guarantee that the row behind it still says what it said — and the register is a
// table we operate, so a migration, a restore or a bug can change it. The witness removes the need for
// that guarantee: it is computed from the key's own immutable facts, so a historical receipt can be
// checked against the exact key material that signed it. If the row were ever altered, the stored
// witness and the recomputed witness diverge and the change is VISIBLE rather than silent.
//
// VERIFIED WHEREVER THE ROW IS RESOLVED FOR USE, NEVER TRUSTED AS STORED. That is the 2026-10-04
// register tamper-evidence decision, and it is the mistake the admission-policy register had for
// weeks: `hashAdmissionPolicy` ran only at registration and `policyHashMatches` had no production
// caller, so the judging path trusted `stored.policyHash`. The same shape here would be worse, because
// this register decides whether money is proven.
//
// Mirrors `policyHash.ts` deliberately rather than inventing a second convention: fixed field order,
// NUL separation, scheme id inside the preimage.

import { sha256Hex } from "../assessment/fingerprint";
import type { SettlementKeyFacts } from "./settlementKeyLifecycle";

/** Version of the hashing scheme itself. A change here is a new scheme, not a re-grade. */
export const SETTLEMENT_KEY_HASH_SCHEME = "nh-settlement-key-v1";

/**
 * Fixed field order over the key's IMMUTABLE facts.
 *
 * THE STATE IS DELIBERATELY ABSENT, and so are the lifecycle events. The state is DERIVED from the
 * event log and is not a property of the row — including it would make the witness change every time
 * governance acted, so a legitimate activation would read as tampering. The witness answers "is this
 * the same key?", never "what has happened to it?".
 */
function canonicalize(facts: SettlementKeyFacts): string {
  const fields: readonly string[] = [
    SETTLEMENT_KEY_HASH_SCHEME,
    facts.keyId,
    facts.boundaryId,
    facts.sourceSystem,
    facts.sourceKind,
    // The key material itself, so a substituted public key cannot keep the row's witness.
    facts.publicKey,
    facts.validFrom,
    facts.validUntil,
  ];
  // NUL-separated so no field value can impersonate a separator and shift the others.
  return fields.join("\u0000");
}

/** `sha256:<64 hex>` over the canonical form. */
export async function hashSettlementKey(facts: SettlementKeyFacts): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(facts))}`;
}

/**
 * Does this register row still hash to what was recorded?
 *
 * A FALSE ANSWER IS A TAMPERING SIGNAL, NOT A REASON TO RECOMPUTE AND CARRY ON. A row that fails its
 * witness verifies nothing — but governance may always still RETIRE or REVOKE it, because refusing
 * every transition would leave governance unable to stop what it had just found.
 */
export async function settlementKeyWitnessMatches(
  facts: SettlementKeyFacts,
  expected: string,
): Promise<boolean> {
  return (await hashSettlementKey(facts)) === expected;
}
