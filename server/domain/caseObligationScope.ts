// Obligation Scope for a governed Recovery Case (server-side adapter, PURE).
//
// A Case is "one atomic governed claim" — frozen EP-8 rule, enforced by the one-chain-root-per-case
// index. That is a statement about COUNTING (a claim is counted once), not about how many obligations
// stand behind it. The only per-record facts the server persists about a claim's outcome are its
// OUTCOME-role evidence records (e.g. a paid invoice or a received payment). This adapter reads those
// and describes — never decides — what they can and cannot be said to be:
//   • one outcome record does NOT establish one obligation (a single payment may settle several);
//   • several outcome records under one case are RECORDED as merged under one claim identity, and
//     whether they are one obligation or several is not inferred;
//   • no outcome records ⇒ nothing is established.
// It changes no stored record, number, authority or contract; the result is additive read-only data.
import {
  deriveObligationScope,
  type IdentityUnit,
  type ObligationScope,
} from "../../src/domain/obligationScope";

/** The minimal facts about an outcome-role evidence record that the scope derivation needs. */
export interface CaseOutcomeEvidenceRef {
  readonly evidenceId: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
}

export function caseObligationScope(
  recoveryCaseId: string,
  outcomeEvidence: readonly CaseOutcomeEvidenceRef[],
): ObligationScope {
  // Every outcome record is counted under the SAME claim identity: the recoveryCaseId.
  const units: IdentityUnit[] = outcomeEvidence.map((e) => ({
    unitId: e.evidenceId,
    identityKey: recoveryCaseId,
    basis: "SOURCE_IDENTIFIER", // each record carries its own source record id (sourceSystem + sourceRecordId)
    amountMinor: e.amountMinor,
    currency: e.currency,
  }));
  const currencies = new Set(outcomeEvidence.map((e) => e.currency));
  const only = currencies.size === 1 ? [...currencies][0] ?? null : null;
  return deriveObligationScope({
    surface: "RECOVERY_CASE",
    currency: only,
    units,
    absorptionDisposition: "COUNTED_UNDER_ONE_CLAIM",
    obligationLevelIdentifierDeclared: false, // evidence ingestion declares no obligation-level id
  });
}
