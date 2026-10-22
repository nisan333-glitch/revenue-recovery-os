// Obligation Scope — what the system can and cannot say about HOW MANY obligations stand behind a
// unit of record. PURE, neutral (no billing/SaaS vocabulary), no I/O, no clock, no randomness.
//
// WHY THIS EXISTS (documented gap — see docs/OBLIGATION_SCOPE.md):
// Every figure in the system is attached to a "unit of record" (a source row, or a governed Recovery
// Case). Nothing in the data model says that a unit is exactly ONE obligation (one invoice, one
// charge, one contract). A row may already be an aggregate; two separate obligations may share the
// fields an identity is derived from; and a Case is "one atomic governed claim" for dedupe purposes,
// which is a statement about COUNTING, not about the number of obligations behind it. If the UI or
// API spoke as if a unit were a single obligation, a merged pair of obligations would be invisible.
//
// This module derives, from evidence only, (1) the IDENTITY GRAIN of the units, (2) whether any units
// were RECORDED as absorbed into a shared identity, and (3) whether a single-obligation reading is
// SUPPORTED. It never infers that colliding units are separate obligations, and never infers that
// they are duplicates of one. Two different facts are kept apart on purpose:
//   • AMBIGUITY            — we cannot tell (a property of the evidence we have). Never a measurement.
//   • RECORDED ABSORPTION  — units the system itself collapsed under one identity (a measured fact).
// Candidate exposure is reported only for recorded absorption, as an UPPER BOUND, and is explicitly
// not a loss, not a forecast and not recovered value.
//
// It changes no money, identity/dedupe, authority, contract, or persisted record: it only describes.
import { type Money, addMoney, formatMoney, money, zeroMoney } from "./money";

export const OBLIGATION_SCOPE_VERSION = "obligation-scope-2026.1";

/** Where a unit's identity came from. "UNDECLARED" = the caller could not say (fails closed). */
export type IdentityBasis = "SOURCE_IDENTIFIER" | "DERIVED_COMPOSITE" | "UNDECLARED";

/** The identity grain of a set of units, derived from the bases of its members. */
export type IdentityGrain = "SOURCE_IDENTIFIER" | "DERIVED_COMPOSITE" | "MIXED" | "NOT_ESTABLISHED";

export type ScopeSurface = "ASSESSMENT" | "RECOVERY_CASE";

/** What the pipeline did with absorbed units: dropped from totals, or counted once as one claim. */
export type AbsorptionDisposition = "EXCLUDED_FROM_TOTALS" | "COUNTED_UNDER_ONE_CLAIM";

export type AmbiguityReason =
  | "SCOPE_NOT_COMPUTED"
  | "NO_UNITS_EXAMINED"
  | "OBLIGATION_LEVEL_IDENTIFIER_NOT_DECLARED"
  | "IDENTITY_NOT_SOURCED"
  | "IDENTITY_COLLISION_UNRESOLVED";

export interface IdentityUnit {
  /** Provenance of the unit (source row id, evidence id, …). */
  readonly unitId: string;
  /** The identity this unit was assigned. Units sharing a key were collapsed under one identity. */
  readonly identityKey: string;
  readonly basis: IdentityBasis;
  /** Exact minor units, or null when unknown. Never estimated. */
  readonly amountMinor: number | null;
  readonly currency: string | null;
}

export interface ObligationScopeInput {
  readonly surface: ScopeSurface;
  /** Currency of the surface when it has exactly one (assessment policy); else null. */
  readonly currency: string | null;
  readonly units: readonly IdentityUnit[];
  readonly absorptionDisposition: AbsorptionDisposition;
  /**
   * True ONLY when the source states that its identifier identifies a single obligation (e.g. a
   * declared invoice/charge id). Defaults to false. Nothing in the current ingestion supplies this.
   */
  readonly obligationLevelIdentifierDeclared?: boolean;
}

export interface ObligationScope {
  readonly version: string;
  readonly surface: ScopeSurface;
  readonly identity: {
    readonly grain: IdentityGrain;
    readonly unitCount: number;
    readonly sourceIdentifierCount: number;
    readonly derivedCompositeCount: number;
    readonly undeclaredCount: number;
    readonly distinctIdentityCount: number;
  };
  /** "SUPPORTED" only with a declared obligation-level source identifier and no collisions. */
  readonly singleObligation: "SUPPORTED" | "REFUSED_UNSUPPORTED";
  /** "We cannot tell." PRESENT whenever a single-obligation reading is unsupported. */
  readonly ambiguity: {
    readonly status: "PRESENT" | "ABSENT";
    readonly reasons: readonly AmbiguityReason[];
  };
  /** "We collapsed these." A measured fact about identity collisions — never an inference. */
  readonly recordedAbsorption: {
    readonly status: "RECORDED" | "NONE_RECORDED";
    readonly disposition: AbsorptionDisposition;
    readonly groupCount: number;
    readonly unitCount: number;
    readonly unitIds: readonly string[];
    /** Σ amount of absorbed units — an UPPER BOUND if each were a separate obligation. null = not
     * quantifiable (unknown amount or mixed currency). Not a loss, forecast or recovered value. */
    readonly candidateExposureUpperBound: Money | null;
    readonly unquantifiedUnitCount: number;
  };
  /** Fixed, shared wording rendered verbatim by every surface (UI, export, API). */
  readonly disclosure: readonly string[];
}

const isSafeNonNegative = (n: number | null): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

function grainOf(counts: { source: number; derived: number; undeclared: number }): IdentityGrain {
  const total = counts.source + counts.derived + counts.undeclared;
  if (total === 0 || counts.undeclared > 0) return "NOT_ESTABLISHED"; // fail closed
  if (counts.derived === 0) return "SOURCE_IDENTIFIER";
  if (counts.source === 0) return "DERIVED_COMPOSITE";
  return "MIXED";
}

function exposureOf(
  absorbed: readonly IdentityUnit[],
  currency: string | null,
): { value: Money | null; unquantified: number } {
  if (absorbed.length === 0) return { value: currency ? zeroMoney(currency) : null, unquantified: 0 };
  const cur = currency ?? absorbed[0]!.currency;
  const unquantified = absorbed.filter(
    (u) => !isSafeNonNegative(u.amountMinor) || u.currency === null || u.currency !== cur,
  ).length;
  if (unquantified > 0 || cur === null) return { value: null, unquantified };
  try {
    let sum = zeroMoney(cur);
    for (const u of absorbed) sum = addMoney(sum, money(u.amountMinor as number, cur));
    return { value: sum, unquantified: 0 };
  } catch {
    return { value: null, unquantified: absorbed.length }; // overflow ⇒ not quantifiable, never partial
  }
}

/** Derive the obligation scope. Deterministic: same input ⇒ identical output. */
export function deriveObligationScope(input: ObligationScopeInput): ObligationScope {
  const declared = input.obligationLevelIdentifierDeclared === true;
  const counts = { source: 0, derived: 0, undeclared: 0 };
  const byKey = new Map<string, IdentityUnit[]>();
  for (const u of input.units) {
    if (u.basis === "SOURCE_IDENTIFIER") counts.source += 1;
    else if (u.basis === "DERIVED_COMPOSITE") counts.derived += 1;
    else counts.undeclared += 1;
    const group = byKey.get(u.identityKey);
    if (group) group.push(u);
    else byKey.set(u.identityKey, [u]);
  }

  const grain = grainOf(counts);
  const collidingGroups = [...byKey.values()].filter((g) => g.length >= 2);
  const absorbed = collidingGroups.flat();
  const unitIds = absorbed.map((u) => u.unitId).sort();
  const { value: exposure, unquantified } = exposureOf(absorbed, input.currency);

  const supported =
    declared && grain === "SOURCE_IDENTIFIER" && collidingGroups.length === 0 && input.units.length > 0;

  const reasons: AmbiguityReason[] = [];
  if (input.units.length === 0) reasons.push("NO_UNITS_EXAMINED");
  if (!declared) reasons.push("OBLIGATION_LEVEL_IDENTIFIER_NOT_DECLARED");
  if (input.units.length > 0 && grain !== "SOURCE_IDENTIFIER") reasons.push("IDENTITY_NOT_SOURCED");
  if (collidingGroups.length > 0) reasons.push("IDENTITY_COLLISION_UNRESOLVED");

  const scope: Omit<ObligationScope, "disclosure"> = {
    version: OBLIGATION_SCOPE_VERSION,
    surface: input.surface,
    identity: {
      grain,
      unitCount: input.units.length,
      sourceIdentifierCount: counts.source,
      derivedCompositeCount: counts.derived,
      undeclaredCount: counts.undeclared,
      distinctIdentityCount: byKey.size,
    },
    singleObligation: supported ? "SUPPORTED" : "REFUSED_UNSUPPORTED",
    ambiguity: { status: supported ? "ABSENT" : "PRESENT", reasons },
    recordedAbsorption: {
      status: absorbed.length > 0 ? "RECORDED" : "NONE_RECORDED",
      disposition: input.absorptionDisposition,
      groupCount: collidingGroups.length,
      unitCount: absorbed.length,
      unitIds,
      candidateExposureUpperBound: exposure,
      unquantifiedUnitCount: unquantified,
    },
  };
  return deepFreeze({ ...scope, disclosure: disclosureFor(scope) });
}

/**
 * Fail-closed placeholder for a surface that was handed no scope. It is NEVER an absence of
 * ambiguity: a view that did not compute its scope must still refuse a single-obligation reading.
 */
export function unavailableObligationScope(surface: ScopeSurface): ObligationScope {
  const base: Omit<ObligationScope, "disclosure"> = {
    version: OBLIGATION_SCOPE_VERSION,
    surface,
    identity: {
      grain: "NOT_ESTABLISHED",
      unitCount: 0,
      sourceIdentifierCount: 0,
      derivedCompositeCount: 0,
      undeclaredCount: 0,
      distinctIdentityCount: 0,
    },
    singleObligation: "REFUSED_UNSUPPORTED",
    ambiguity: { status: "PRESENT", reasons: ["SCOPE_NOT_COMPUTED"] },
    recordedAbsorption: {
      status: "NONE_RECORDED",
      disposition: "EXCLUDED_FROM_TOTALS",
      groupCount: 0,
      unitCount: 0,
      unitIds: [],
      candidateExposureUpperBound: null,
      unquantifiedUnitCount: 0,
    },
  };
  return deepFreeze({
    ...base,
    disclosure: [
      "Obligation scope was not computed for this view. A single-obligation reading is NOT supported: " +
        "no figure here is established to correspond to exactly one obligation (invoice, charge or contract).",
    ],
  });
}

// --- Structural refusal ---------------------------------------------------------------------------

export class UnsupportedSingleObligationAssertion extends Error {
  readonly reasons: readonly AmbiguityReason[];
  constructor(context: string, reasons: readonly AmbiguityReason[]) {
    super(
      `UnsupportedSingleObligationAssertion: ${context} cannot be presented as a single obligation ` +
        `(${reasons.join(", ") || "no supporting evidence"})`,
    );
    this.name = "UnsupportedSingleObligationAssertion";
    this.reasons = reasons;
  }
}

/** Throws unless the scope SUPPORTS a single-obligation reading. The one gate any code path must pass
 * before it may describe a unit as "one invoice / one obligation". */
export function assertSingleObligation(scope: ObligationScope, context: string): void {
  if (scope.singleObligation !== "SUPPORTED") {
    throw new UnsupportedSingleObligationAssertion(context, scope.ambiguity.reasons);
  }
}

/** The only noun surfaces may use for a unit: "obligation" if and only if it is supported. */
export function unitNoun(scope: ObligationScope): "obligation" | "record" {
  return scope.singleObligation === "SUPPORTED" ? "obligation" : "record";
}

// --- Shared disclosure wording ----------------------------------------------------------------------

function disclosureFor(s: Omit<ObligationScope, "disclosure">): readonly string[] {
  const lines: string[] = [];
  const g = s.identity.grain;

  if (s.singleObligation === "SUPPORTED") {
    lines.push(
      "Single-obligation reading is supported: the source declares its identifier to identify one obligation, " +
        "and no identity collisions were found.",
    );
  } else {
    lines.push(
      "Single-obligation reading is NOT supported: this view does not establish that any figure corresponds " +
        "to exactly one obligation (invoice, charge or contract). A record may combine several obligations or " +
        "be only part of one.",
    );
  }

  if (g === "SOURCE_IDENTIFIER") {
    lines.push(
      s.singleObligation === "SUPPORTED"
        ? "Identity grain: SOURCE_IDENTIFIER (declared obligation-level)."
        : "Identity grain: SOURCE_IDENTIFIER — the source supplied an identifier for each record, but it is not " +
            "declared to identify an obligation, so a record may still combine or split obligations.",
    );
  } else if (g === "DERIVED_COMPOSITE") {
    lines.push(
      "Identity grain: DERIVED_COMPOSITE — identity was synthesized from other fields, not supplied by the " +
        "source, so two separate obligations that share those fields cannot be told apart.",
    );
  } else if (g === "MIXED") {
    lines.push(
      "Identity grain: MIXED — some records carry a source identifier and some have a synthesized identity; " +
        "the synthesized ones cannot tell apart separate obligations that share the same fields.",
    );
  } else {
    lines.push("Identity grain: NOT_ESTABLISHED — the identity basis of the records could not be determined.");
  }

  lines.push(
    "Ambiguity (we cannot tell) and recorded absorption (records this system itself collapsed) are different " +
      "facts and are reported separately; neither is inferred from the other.",
  );

  const a = s.recordedAbsorption;
  if (a.status === "RECORDED") {
    const handled =
      a.disposition === "EXCLUDED_FROM_TOTALS"
        ? "excluded from every total"
        : "counted once under a single claim";
    const exposure = a.candidateExposureUpperBound
      ? formatMoney(a.candidateExposureUpperBound, { exact: true })
      : "not quantifiable";
    lines.push(
      `Recorded absorption: ${a.unitCount} record(s) in ${a.groupCount} shared-identity group(s) were ${handled}. ` +
        `Candidate exposure (upper bound if each were a separate obligation): ${exposure}. This is an ` +
        "unclassified bound, not a loss and not recovered value, and it is not inferred whether these records " +
        "are duplicates of one obligation or separate obligations.",
    );
  } else {
    lines.push(
      "Recorded absorption: none. This does not establish that no obligations were merged — see ambiguity above.",
    );
  }
  return lines;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
