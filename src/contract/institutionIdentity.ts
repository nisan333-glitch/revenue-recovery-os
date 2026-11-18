// K5 · WHAT IDENTIFIES AN INSTITUTION, AND ITS WITNESS.
//
// SEPARATE FROM `institutionAuthority.ts` ON PURPOSE. That module answers *what must be true before an
// institution may be relied on* and holds no identity at all; this one answers *which institution* and
// *is this still the same row*. Collapsing them would put the conditions inside the witness preimage,
// so recording a condition as met would read as the row having changed — exactly the mistake
// `settlementKeyWitness` avoids by leaving the lifecycle out.
//
// WHAT IS IN THE PREIMAGE IS WHAT A SETTLEMENT PATH RELIES ON. `sourceSystem` is the load-bearing one:
// a settlement fact names its source system, and the whole point of institution verification is that
// THAT name has been tied to a real, independently verified legal entity. If `sourceSystem` could be
// edited after verification, a verified institution's authority would silently transfer to a different
// sender — which is the only attack this register exists to stop.
//
// AND IT CARRIES NO PERSON. `DatasetProvenance` and the attestation form both made the same choice and
// for the same reason: minimization. The authorised signatories are a CONDITION that someone at NH
// established out of band; the names belong in that out-of-band record, not in a row NH hashes and
// stores. A role is enough for everything this register decides.

import { sha256Hex } from "../assessment/fingerprint";

/** Version of the hashing scheme itself. A change here is a new scheme, not a re-grade. */
export const INSTITUTION_HASH_SCHEME = "nh-institution-v1";

/** Version of the identity contract. */
export const INSTITUTION_IDENTITY_VERSION = "instid-2026.1";

export interface InstitutionFacts {
  /** NH's own stable id for the institution. */
  readonly institutionId: string;
  /** Tenant scope. An institution is verified FOR a boundary, never globally by side effect. */
  readonly boundaryId: string;
  /**
   * The source-system name a settlement fact must carry to be attributed to this institution.
   *
   * THE REASON THE WITNESS EXISTS. Editing this after verification would move a verified
   * institution's authority to a different sender, with every stored receipt still pointing here.
   */
  readonly sourceSystem: string;
  /** Bank or PSP. It decides what the institution may assert about finality. */
  readonly sourceKind: "bank" | "psp";
  /**
   * The legal entity as an INDEPENDENT registry names it — a company register, not the institution's
   * own letterhead and not what a salesperson typed.
   */
  readonly legalEntityName: string;
  /** The jurisdiction whose registry was consulted. */
  readonly jurisdiction: string;
  /**
   * The registry's own identifier for the entity, e.g. a company number or LEI.
   *
   * REQUIRED, because "we looked it up" with nothing to look up again is not independent
   * verification — it is a recollection.
   */
  readonly registryIdentifier: string;
}

export type InstitutionFactsProblem = string;

/**
 * Structural problems with the facts. EVERY one, never the first.
 *
 * Deliberately NOT a schema library: the same reason `externalSettlementProblems` is hand-written —
 * padding, control characters and a blank that is not absent are the failures that actually arrive,
 * and each needs its own sentence rather than a generic "invalid".
 */
export function institutionFactsProblems(facts: unknown): readonly InstitutionFactsProblem[] {
  const problems: string[] = [];
  if (facts === null || typeof facts !== "object") return Object.freeze(["facts must be an object"]);
  const f = facts as Record<string, unknown>;
  const text = (field: string) => {
    const v = f[field];
    if (typeof v !== "string") problems.push(`${field} must be a string`);
    else if (v.length === 0) problems.push(`${field} must not be empty`);
    else if (v.trim() !== v) problems.push(`${field} must not be padded`);
    // A control character in an identifier is how a value impersonates a separator in a hash
    // preimage, which would let two different institutions share one witness.
    else if (/[\u0000-\u001f\u007f]/.test(v)) problems.push(`${field} must not contain control characters`);
  };
  for (const field of [
    "institutionId",
    "boundaryId",
    "sourceSystem",
    "legalEntityName",
    "jurisdiction",
    "registryIdentifier",
  ]) {
    text(field);
  }
  if (f.sourceKind !== "bank" && f.sourceKind !== "psp") {
    problems.push("sourceKind must be 'bank' or 'psp'");
  }
  return Object.freeze(problems);
}

/**
 * Fixed field order over the institution's IMMUTABLE facts.
 *
 * THE STATE AND THE EVIDENCE ARE DELIBERATELY ABSENT. The state is derived from the event log, and the
 * evidence is recorded by the verification event — including either would make the witness change when
 * governance acted, so a legitimate verification would read as tampering.
 */
function canonicalize(facts: InstitutionFacts): string {
  const fields: readonly string[] = [
    INSTITUTION_HASH_SCHEME,
    facts.institutionId,
    facts.boundaryId,
    facts.sourceSystem,
    facts.sourceKind,
    facts.legalEntityName,
    facts.jurisdiction,
    facts.registryIdentifier,
  ];
  // NUL-separated so no field value can impersonate a separator and shift the others.
  return fields.join("\u0000");
}

/** `sha256:<64 hex>` over the canonical form. */
export async function hashInstitution(facts: InstitutionFacts): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(facts))}`;
}

/**
 * Does this register row still hash to what was recorded?
 *
 * A FALSE ANSWER IS A TAMPERING SIGNAL, NOT A REASON TO RECOMPUTE AND CARRY ON — the 2026-10-04
 * register tamper-evidence decision. A row that fails its witness authorises nothing, and governance
 * may always still WITHDRAW or REVOKE it, because refusing every transition would leave governance
 * unable to stop what it had just found.
 */
export async function institutionWitnessMatches(
  facts: InstitutionFacts,
  expected: string,
): Promise<boolean> {
  return (await hashInstitution(facts)) === expected;
}
