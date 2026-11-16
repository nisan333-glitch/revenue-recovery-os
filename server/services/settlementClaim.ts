// G7 · CLAIMING THE CITED ARRIVALS INSIDE THE PROOF'S OWN TRANSACTION.
//
// WHAT WAS MISSING, AND WHY A READ WAS NEVER ENOUGH. `runExternalSettlementGate` asks the ledger two
// questions — is this nonce already used, is this arrival already substantiating another claim — and
// then decides. Both are READS. Between the read and the proof's INSERT there is a window, and the
// per-case lock does not close it:
//
//   `withGovernedCaseMutation` locks THE CASE. Two approvals on TWO DIFFERENT cases citing the SAME
//   external settlement take DIFFERENT locks, so they do not serialise against each other at all. Both
//   read "not yet substantiating anything", both pass, and both write a proof — one arrival of money
//   counted twice, by exactly the interleaving the lock was never scoped to prevent.
//
// SO THE CLAIM IS THE CONTROL AND THE GATE'S READ IS A DIAGNOSIS — the same sentence G5's own schema
// states one layer down, applied where it finally matters. `settlement_consumptions` carries a unique
// index on the settlement digest; this module attempts the insert and lets that index decide.
//
// AND IT MUST BE THE SAME TRANSACTION AS THE PROOF, which is the part that cannot be approximated:
//
//   * claim FIRST then write the proof, in one transaction → both commit or neither. A proof can never
//     exist without its arrivals being claimed, and an arrival can never be burned by an approval that
//     did not produce a proof.
//   * claim in a SEPARATE transaction, before → a later failure (halt, kernel refusal, crash) leaves
//     the arrival permanently consumed by a proof that does not exist. The money becomes unclaimable
//     forever, which is worse than the double count this exists to prevent.
//   * claim AFTER the proof commits → the proof is already frozen when the refusal arrives, and rule 5
//     says it may never be rewritten. There would be nothing to do but report it.
//
// A RETRY IS NOT A DOUBLE COUNT, and the ledger already knows the difference: the consumption id is
// derived from (boundary, claimRef, digest), so the same claim re-running finds its own row and reports
// `ALREADY_MINE`. Only a DIFFERENT claim reaching the same arrival is refused.
import { ForbiddenError } from "../http/errors";
import {
  settlementDigest,
  PostgresSettlementLedger,
  type SettlementLedgerSql,
} from "../persistence/settlementLedgerStore";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";
import type { SettlementReceipt } from "./settlementVerification";

/** Why a claim was refused. Both are REFUSALS OF THE APPROVAL, never warnings. */
export type SettlementClaimRefusal =
  /** The arrival is already substantiating a different claim. One arrival of money is counted once. */
  | "SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM"
  /** This attestation's nonce was already used in this tenant. A signature is single-use. */
  | "SETTLEMENT_ATTESTATION_REPLAYED";

export interface ClaimedArrival {
  readonly settlementDigest: string;
  readonly consumptionId: string;
  /** True when this exact claim had already recorded it — an idempotent retry, not a new count. */
  readonly alreadyHeldByThisClaim: boolean;
}

export interface SettlementClaimInput {
  readonly boundaryId: string;
  /** WHICH CLAIM IS ASKING. Without it a retry cannot be told from a double count. */
  readonly claimRef: string;
  readonly cited: readonly { readonly fact: ExternalSettlementFact }[];
  /** The verification receipts, in cited order — the source of the nonce, key and signing instant. */
  readonly receipts: readonly SettlementReceipt[];
}

/**
 * Claim every cited arrival for this claim, or refuse the whole approval.
 *
 * FAIL CLOSED ON THE FIRST REFUSAL, and the rollback does the rest: the caller runs this inside the
 * proof's transaction, so a throw here means no consumption row and no proof. There is deliberately no
 * partial success — an approval that counted three of four arrivals would be a proof citing evidence
 * the ledger does not hold.
 *
 * THE RECEIPTS ARE NOT OPTIONAL AND NOT RE-DERIVED HERE. The nonce, the key id and the signing instant
 * come from the verification that already happened; recomputing them would be a second implementation
 * of the same rule, and taking them from the request would let the caller name a key that did not sign.
 */
export async function claimCitedSettlements(
  sql: SettlementLedgerSql,
  input: SettlementClaimInput,
): Promise<readonly ClaimedArrival[]> {
  if (input.cited.length !== input.receipts.length) {
    // NOT AN ASSERTION ABOUT THE CALLER'S MANNERS. A mismatch means a receipt would be paired with the
    // wrong fact, so a nonce could be recorded against an arrival it never attested.
    throw new Error(
      `settlement claim: ${input.cited.length} cited settlements but ${input.receipts.length} receipts; ` +
        "refusing to pair them by position",
    );
  }

  const ledger = new PostgresSettlementLedger(sql);
  const claimed: ClaimedArrival[] = [];

  for (const [index, { fact }] of input.cited.entries()) {
    const receipt = input.receipts[index]!;
    const digest = await settlementDigest(fact);
    const outcome = await ledger.claim({
      boundaryId: input.boundaryId,
      claimRef: input.claimRef,
      settlementDigest: digest,
      attestationNonce: receipt.nonce,
      keyId: receipt.keyId,
      attestationIssuedAt: receipt.issuedAt,
    });

    switch (outcome.outcome) {
      case "RECORDED":
        claimed.push(Object.freeze({
          settlementDigest: digest, consumptionId: outcome.consumptionId, alreadyHeldByThisClaim: false,
        }));
        break;
      case "ALREADY_MINE":
        claimed.push(Object.freeze({
          settlementDigest: digest, consumptionId: outcome.consumptionId, alreadyHeldByThisClaim: true,
        }));
        break;
      case "TAKEN_BY_ANOTHER_CLAIM":
        throw refusal(
          "SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM",
          `this arrival of money is already substantiating claim '${outcome.byClaimRef}'; one arrival ` +
            "of money may be counted once, and counting it again would report the same cash twice",
        );
      case "NONCE_ALREADY_USED":
        throw refusal(
          "SETTLEMENT_ATTESTATION_REPLAYED",
          `this attestation's nonce was already used by claim '${outcome.byClaimRef}'; a signature is ` +
            "single-use, so the same signed statement cannot substantiate a second approval",
        );
    }
  }

  return Object.freeze(claimed);
}

const refusal = (code: SettlementClaimRefusal, detail: string): ForbiddenError =>
  new ForbiddenError(`${code}: ${detail}`);
