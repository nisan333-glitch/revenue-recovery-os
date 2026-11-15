// STAGE 8 · the composition — verify, then decide.
//
// WHAT THIS IS. The whole of stage 8 in one call: every cited attestation is verified against a
// registered external key, and the verified facts then go to the pure decision in
// `src/domain/externalSettlement.ts`. It is the function a future `POST /proofs` would invoke.
//
// WHY IT IS NOT WIRED INTO `proofService` IN THIS SLICE, stated rather than left to be noticed. Two
// facts the decision needs do not exist anywhere in the persisted model:
//
//   1. AN EXTERNAL PAYER REFERENCE ON THE CASE. A case carries a pseudonymous `sourceRef` derived under
//      NH's own HMAC key. A bank names the payer in the bank's own terms. Nothing maps one to the other,
//      and NH must not invent the mapping — that would be authoring the identity it is meant to read.
//   2. A SETTLEMENT LEDGER. Replay defence needs the nonces already seen, and the one-arrival-counted-
//      once rule needs the settlement identities already substantiating another claim. Both are
//      persisted state, and persistence means a schema migration.
//
// So wiring this into the live gate today would mean passing values nothing authoritative supplies.
// A gate that reads fabricated inputs is worse than an absent gate, because it reports enforcement that
// is not happening — the `obligation_ref` lesson from the other side. The mechanism is therefore
// complete and proven here, the two dependencies are NAMED, and a structural guard asserts that no
// production module imports this yet, so the absence is enforced rather than promised. That guard must
// MOVE WITH ITS CONSUMER when the schema slice lands, never be deleted.

import { ForbiddenError } from "../http/errors";
import {
  externalSettlementSufficiency,
  type ExternalSettlementFact,
  type ExternalSettlementVerdict,
} from "../../src/domain/externalSettlement";
import type { SettlementAttestation, SettlementReceipt, SettlementVerifier } from "./settlementVerification";

/**
 * The persisted state the decision needs and cannot derive.
 *
 * A PORT, not a table, because this slice adds no schema. Its implementation is the next slice's work,
 * and until it exists the only implementations are in tests — which is why the guard above exists.
 */
export interface SettlementLedger {
  /** Nonces of attestations already presented, for this tenant. */
  seenNonces(boundaryId: string): Promise<readonly string[]>;
  /** Settlement identities already substantiating another claim, for this tenant. */
  identitiesAlreadySubstantiating(boundaryId: string): Promise<readonly string[]>;
}

export interface CitedSettlement {
  readonly fact: ExternalSettlementFact;
  readonly attestation: SettlementAttestation;
}

export interface ExternalSettlementGateInput {
  readonly enabled: boolean;
  /** From the authenticated server context. NEVER a request field. */
  readonly boundaryId: string;
  readonly claimedCollectedMinor: number;
  readonly currency: string;
  /** From the correction evidence record the server itself chose, never cited by the request. */
  readonly caseCorrectiveInvoiceRef: string;
  /** The payer as the external system holds it. See dependency 1 in the header. */
  readonly casePayerExternalRef: string;
  /** When the correction was raised, from the case's own record. */
  readonly correctionRaisedAt: string;
  readonly cited: readonly CitedSettlement[];
}

export interface ExternalSettlementOutcome {
  readonly verdict: ExternalSettlementVerdict;
  /** One receipt per cited settlement, in cited order. Frozen into the proof by a future caller. */
  readonly receipts: readonly SettlementReceipt[];
}

/**
 * Run stage 8.
 *
 * VERIFICATION FIRST, AND IT THROWS. An unverifiable attestation is not weak evidence to be weighed
 * against the rest: it is not evidence at all, and continuing to the arithmetic would let a forged
 * record's amount reach a sum. `SettlementVerifier` throws a `ForbiddenError` naming which check
 * failed, and that propagates unchanged.
 *
 * THE DECISION IS THEN PURE. Every input it reads is either server-held or verified above; nothing the
 * caller asserted about its own evidence survives into it.
 */
export async function runExternalSettlementGate(
  input: ExternalSettlementGateInput,
  verifier: SettlementVerifier,
  ledger: SettlementLedger,
): Promise<ExternalSettlementOutcome> {
  // THE FLAG IS CHECKED BEFORE ANY VERIFICATION OR ANY LEDGER READ, so a disabled build does no work
  // and touches no state. The refusal is the pure core's own, so there is one vocabulary and not two.
  if (!input.enabled) {
    return Object.freeze({
      verdict: externalSettlementSufficiency({
        enabled: false,
        boundaryId: input.boundaryId,
        claimedCollectedMinor: input.claimedCollectedMinor,
        currency: input.currency,
        caseCorrectiveInvoiceRef: input.caseCorrectiveInvoiceRef,
        casePayerExternalRef: input.casePayerExternalRef,
        correctionRaisedAt: input.correctionRaisedAt,
        now: new Date().toISOString(),
        facts: [],
        seenNonces: [],
        nonces: [],
        identitiesAlreadySubstantiating: [],
      }),
      receipts: Object.freeze([]),
    });
  }

  const receipts: SettlementReceipt[] = [];
  for (const { fact, attestation } of input.cited) {
    // A TENANT CHECK BEFORE THE KEY LOOKUP would be redundant: the key is registered per boundary and
    // the boundary is inside the signed payload, so a cross-tenant record cannot verify at all. The
    // pure core checks it again anyway, because a decision that depends on an upstream guard having run
    // is a decision that breaks silently when the call order changes.
    receipts.push(verifier.verify(fact, attestation));
  }

  const [seenNonces, identitiesAlreadySubstantiating] = await Promise.all([
    ledger.seenNonces(input.boundaryId),
    ledger.identitiesAlreadySubstantiating(input.boundaryId),
  ]);

  const verdict = externalSettlementSufficiency({
    enabled: true,
    boundaryId: input.boundaryId,
    claimedCollectedMinor: input.claimedCollectedMinor,
    currency: input.currency,
    caseCorrectiveInvoiceRef: input.caseCorrectiveInvoiceRef,
    casePayerExternalRef: input.casePayerExternalRef,
    correctionRaisedAt: input.correctionRaisedAt,
    // SERVER-PINNED, never client-suppliable — the same rule `approvedAt` already follows.
    now: new Date().toISOString(),
    facts: input.cited.map((c) => c.fact),
    seenNonces,
    nonces: receipts.map((r) => r.nonce),
    identitiesAlreadySubstantiating,
  });

  return Object.freeze({ verdict, receipts: Object.freeze(receipts) });
}

/**
 * The refusal a future caller would raise. Separated so the HTTP shape is decided once, and so the
 * code travels with the message — a generic 403 satisfies a gate and fails a reader.
 */
export function settlementRefusal(verdict: ExternalSettlementVerdict): ForbiddenError | null {
  if (verdict.sufficient) return null;
  return new ForbiddenError(
    `PROVEN requires externally attested settlement — ${verdict.code}: ${verdict.reason}`,
  );
}
