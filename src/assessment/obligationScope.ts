// Assessment adapter for the Obligation Scope derivation. Maps the adapter's per-row outcomes to the
// neutral identity units that ../domain/obligationScope understands. It is read-only over the same
// `outcomes` that `assess` consumes: it never alters a cycle, an exclusion, a total or a result, and
// its output is NOT part of AssessmentResult (so assessmentId, canonical bytes and record hashes are
// unchanged for every input that already existed).
//
// The units are the RAW cycles — before collision rejection — because the colliding rows are exactly
// the ones `assess` records as `duplicate_cycle_id` exclusions and removes from every total.
import type { AssessmentPolicy } from "./policy";
import type { RowOutcome } from "./types";
import {
  deriveObligationScope,
  type IdentityBasis,
  type IdentityUnit,
  type ObligationScope,
} from "../domain/obligationScope";

/** Derive the obligation scope of an assessment run. Pure and deterministic. */
export function assessmentObligationScope(
  outcomes: readonly RowOutcome[],
  policy: AssessmentPolicy,
): ObligationScope {
  const units: IdentityUnit[] = [];
  for (const o of outcomes) {
    if (o.kind !== "cycle") continue;
    const c = o.cycle;
    const basis: IdentityBasis = c.identityBasis ?? "UNDECLARED"; // never guessed from the id's shape
    units.push({
      unitId: c.sourceRowId,
      identityKey: c.cycleId,
      basis,
      amountMinor: c.monetaryEvent.amount.minor,
      currency: c.currency,
    });
  }
  return deriveObligationScope({
    surface: "ASSESSMENT",
    currency: policy.currency,
    units,
    absorptionDisposition: "EXCLUDED_FROM_TOTALS", // assess drops every colliding row from all totals
    obligationLevelIdentifierDeclared: false, // no canonical field in this adapter declares one
  });
}
