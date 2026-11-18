// B3 · THE ADAPTER: the institution register, answering the one question a key activation may ask.
//
// WHY A SEPARATE FILE. `settlementKeyGovernance` declares the port and `institutionGovernance` owns
// the register; neither should import the other. A key-governance module that could reach the register
// directly could read an institution's legal entity, its citations, its governance log or its witness,
// none of which is its business — and a register that imported key governance would invert the
// dependency. This file is the only place the two meet, and it is wired at the call site.
//
// IT VERIFIES THE WITNESS, because this is a RESOLVE FOR USE. An institution row whose stored values
// no longer hash to its stored witness authorises nothing: the register tamper-evidence rule says a
// governed definition is verified against its own witness wherever it is resolved for use, never
// trusted as stored. A failing row yields `KEY_INSTITUTION_RECORD_UNREADABLE` rather than whatever
// state it claims to be in — *"this row changed" outranks "nobody activated it"*.
//
// IT ANSWERS AS OF AN INSTANT, not "now". `institutionStateAt` takes the instant the activation is
// being applied at, so the answer is a property of the moment rather than of when the question
// happened to be asked — the same reason there is no `state` column anywhere in the register.

import {
  institutionStateAt,
  type InstitutionAuthorityState,
} from "../../src/contract/institutionAuthority";
import { institutionWitnessMatches } from "../../src/contract/institutionIdentity";
import {
  senderAuthorityFromState,
  type SenderAuthorityVerdict,
} from "../../src/contract/senderAuthority";
import type { InstitutionRegister } from "./institutionGovernance";
import type { SenderAuthoritySource } from "./settlementKeyGovernance";

/**
 * The production implementation of `SenderAuthoritySource`.
 *
 * THE REGISTER IS PASSED IN rather than defaulted, unlike the stores: this is a composition of two
 * governed objects and the composition belongs to whoever is wiring the route, so a test can supply a
 * register without a database and cannot accidentally reach the shared client.
 */
export function institutionSenderAuthority(
  register: InstitutionRegister,
): SenderAuthoritySource {
  return {
    async senderAuthority({ boundaryId, sourceSystem, at }): Promise<SenderAuthorityVerdict> {
      // CLASSIFIED ON FAILURE, NEVER BEFORE IT, and only for the one failure that is a deployment
      // state rather than an outage. A deployment holding the key register but not the institution
      // register is reachable — the two are separate design scripts, neither in `prisma/migrations/`
      // — and it used to surface as an internal error from a missing relation. Everything else is
      // RE-THROWN: filing a real outage as a tidy refusal would report an answer nobody computed.
      let row: Awaited<ReturnType<InstitutionRegister["findBySender"]>>;
      try {
        row = await register.findBySender(boundaryId, sourceSystem);
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
        return Object.freeze({
          authorised: false as const,
          code: "KEY_INSTITUTION_REGISTER_UNAVAILABLE" as const,
          detail:
            "the governed institution register is not installed in this deployment, so who this " +
            "sender is cannot be established. Apply the institution-register migration before any " +
            "key is put in force — this is a refusal rather than an internal error because a gate " +
            "that cannot read its own evidence must say so",
        });
      }
      if (row === null) {
        // NOT "unverified" — NOTHING IS REGISTERED. The two are different positions with different
        // remedies, and the refusal that fires today on every key is this one, because the register
        // is empty. That is the correct answer rather than a missing feature.
        return senderAuthorityFromState(null, `(no institution for sender '${sourceSystem}')`);
      }

      if (!(await institutionWitnessMatches(row.facts, row.witness))) {
        return Object.freeze({
          authorised: false as const,
          code: "KEY_INSTITUTION_RECORD_UNREADABLE" as const,
          detail:
            `institution '${row.facts.institutionId}' no longer hashes to its stored witness, so its ` +
            "record changed after it was registered and it authorises nothing. Investigate the row " +
            "and the migration that touched it; governance may still withdraw or revoke it",
        });
      }

      const derived = institutionStateAt(row.events, at);
      if (!derived.ok) {
        // A LOG THAT CANNOT BE READ IS NOT A STATE. Reporting it as "not verified" would say somebody
        // looked at the lifecycle and found it incomplete, when in fact the lifecycle is unusable —
        // two different things to go and fix.
        return Object.freeze({
          authorised: false as const,
          code: "KEY_INSTITUTION_RECORD_UNREADABLE" as const,
          detail:
            `institution '${row.facts.institutionId}' has an unusable governance log ` +
            `(${derived.problem}): ${derived.detail}`,
        });
      }

      const state: InstitutionAuthorityState | null = derived.state;
      return senderAuthorityFromState(state, row.facts.institutionId);
    },
  };
}

/**
 * Is this the Postgres "relation does not exist" condition (SQLSTATE 42P01)?
 *
 * MATCHED ON THE CODE AND ON THE MESSAGE, because the two drivers in play report it differently: the
 * Prisma client surfaces `P2010` with the underlying code in its metadata and raw queries carry the
 * text. Narrow on purpose — a wider match would swallow a connection failure, which must be re-thrown.
 */
function isMissingRelation(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const text = String((error as { message?: unknown }).message ?? "");
  if (/\b42P01\b/.test(text)) return true;
  return /relation "[^"]*governed_institution[^"]*" does not exist/i.test(text);
}
