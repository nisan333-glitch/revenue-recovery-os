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
  settlementIdentity,
  type ExternalSettlementFact,
  type ExternalSettlementVerdict,
} from "../../src/domain/externalSettlement";
import type { SettlementAttestation, SettlementReceipt, SettlementVerifier } from "./settlementVerification";

/**
 * The persisted state the decision needs and cannot derive.
 *
 * G5 RESHAPED THIS PORT, AND BOTH CHANGES FIX REAL DEFECTS IN THE STAGE-8 VERSION.
 *
 *   IT WAS CLAIM-BLIND. `identitiesAlreadySubstantiating(boundaryId)` had no notion of WHICH claim was
 *   asking, so an idempotent retry of the very claim that recorded an arrival would have been refused
 *   as a double count. The claim reference is now an input and the answer excludes it.
 *
 *   IT WAS UNBOUNDED. Both methods returned a whole tenant's history so the caller could run
 *   `includes()` over it. The question is never "give me every nonce you have ever seen", it is "has
 *   THIS nonce been seen", and at any real volume the first shape is a different kind of defect.
 *
 * AND WHAT IT STILL IS NOT: a control. These reads are a DIAGNOSIS — they let a refusal name which
 * rule failed before the database has to raise. The control is the unique index, because a
 * read-then-check has a window between the read and the write that two simultaneous claims both pass.
 * `PostgresSettlementLedger.claim` is where the arrival is actually taken.
 */
export interface SettlementLedger {
  /** Which of these nonces have already been presented in this tenant. Bounded by the input. */
  nonceAlreadyUsed(boundaryId: string, nonces: readonly string[]): Promise<readonly string[]>;
  /**
   * Which of these settlement IDENTITIES already substantiate a claim OTHER than `claimRef`.
   *
   * Excluding the caller's own claim is what makes an idempotent retry legible rather than refused.
   *
   * IN IDENTITY TERMS, NOT DIGEST TERMS, AND THE FIRST VERSION OF THIS SIGNATURE GOT IT WRONG. The
   * ledger stores a digest of the canonical identity, so my first shape returned digests — which the
   * pure core then compared against raw `settlementIdentity(...)` strings. Type-compatible, and
   * semantically unable to ever match: A CHECK THAT CANNOT MATCH IS WORSE THAN NO CHECK, because it
   * reports a rule as enforced while passing everything. The storage form belongs to the store; the
   * decision stays in the terms it reasons about.
   */
  identitiesSubstantiatingOtherClaims(
    boundaryId: string,
    claimRef: string,
    identities: readonly string[],
  ): Promise<readonly string[]>;
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
  /**
   * WHICH CLAIM IS ASKING. Required, not optional: the ledger cannot tell an idempotent retry from a
   * double count without it, and an optional field would let an existing caller keep the old,
   * claim-blind behaviour by saying nothing — which is how the stage-8 defect would have survived.
   */
  readonly claimRef: string;
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

  // BOUNDED BY WHAT WAS CITED. Both questions are asked about exactly the values in this request.
  const citedNonces = receipts.map((r) => r.nonce);
  const citedIdentities = input.cited.map((c) => settlementIdentity(c.fact));
  const [seenNonces, identitiesAlreadySubstantiating] = await Promise.all([
    ledger.nonceAlreadyUsed(input.boundaryId, citedNonces),
    ledger.identitiesSubstantiatingOtherClaims(input.boundaryId, input.claimRef, citedIdentities),
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
