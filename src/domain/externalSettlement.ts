// STAGE 8 · EXTERNAL SETTLEMENT ATTESTATION — the pure decision.
//
// WHAT THIS ANSWERS. The PROVEN gate already refuses unless every outcome-role evidence record is
// `independent`, which `evidenceStore` sets from a verified Ed25519 attestation. But the only source
// system `OUTCOME_EVIDENCE_TYPES` declares is `billing` — the customer's OWN system. So today's
// "independent" means INDEPENDENT OF THE NH OPERATOR, not independent of the COMPANY. This module is
// the decision for the stronger property: that an external party which is not party to the recovery
// claim — a bank or a payment service provider — has stated that the money arrived.
//
// WHAT THIS IS NOT. It is not a widening of `outcomeEvidence.ts`, whose verdict every existing proof
// already rests on. It is an ADDITIVE SIBLING with its own scheme, its own vocabulary and its own
// refusals, in the pattern Detector #2 and the expectation extract set. Nothing here changes an
// existing figure, and a build with the feature flag off behaves exactly as it did.
//
// NO IMPORTS AT ALL, deliberately, exactly as `leakInstanceIdentity.ts` has none: this decision must be
// re-derivable from its inputs with no ambient state, no clock of its own and no crypto. Verification
// of the signature belongs to the server layer; what is DECIDED belongs here, where a unit test can
// reach every branch.

/**
 * The scheme id. INSIDE the signed payload rather than a prefix on a derived string, so a settlement
 * attestation can never be replayed as an evidence attestation and vice versa — the two schemes are
 * different sentences even under the same key.
 */
export const SETTLEMENT_ATTESTATION_SCHEME = "nh-settlement-v1";

/** Version of this decision. A change in meaning is a NEW id, never a silent re-grade. */
export const EXTERNAL_SETTLEMENT_METHOD_VERSION = "xsa-2026.1";

// ── Finality · authorisation is not settlement ───────────────────────────────────────────────────
//
// THE DISTINCTION THIS MODULE EXISTS TO ENFORCE. A card flow passes through states that all read like
// success in a dashboard and mean completely different things about money:
//
//   AUTHORIZED   a reservation against a credit line. No money has moved. It can expire.
//   CAPTURED     the company has CLAIMED the authorised money. Still no transfer; this is OUR action.
//   PSP_SETTLED  the provider has paid out. Money has left the provider for the company's account.
//   BANK_CREDITED the company's bank states the funds are in the account.
//   REVERSED     a reversal, chargeback or refund. Money went back.
//
// They stay FIVE STATES rather than a boolean `settled`, for the reason this repository keeps
// relearning: collapsing them hides which half is missing, and a boolean would let AUTHORIZED wear
// BANK_CREDITED's guarantee. `Collected − Baseline` is about money the company HAS, so only the two
// states that assert arrival may substantiate it.

export type SettlementFinality =
  | "AUTHORIZED"
  | "CAPTURED"
  | "PSP_SETTLED"
  | "BANK_CREDITED"
  | "REVERSED";

export const SETTLEMENT_FINALITY_STATES: readonly SettlementFinality[] =
  Object.freeze(["AUTHORIZED", "CAPTURED", "PSP_SETTLED", "BANK_CREDITED", "REVERSED"]);

/**
 * The only states that assert the money ARRIVED.
 *
 * `CAPTURED` is excluded and that is the load-bearing exclusion: a capture is an instruction the
 * COMPANY issues, so treating it as settlement would let the beneficiary's own action substantiate the
 * beneficiary's own claim — the Trust Invariant's standing test answered the wrong way.
 */
export const FINAL_SETTLEMENT_STATES: readonly SettlementFinality[] =
  Object.freeze(["PSP_SETTLED", "BANK_CREDITED"]);

export function settlementIsFinal(finality: SettlementFinality): boolean {
  return FINAL_SETTLEMENT_STATES.includes(finality);
}

// ── Source kinds · which party may assert which state ────────────────────────────────────────────
//
// A BANK CANNOT SEE AN AUTHORISATION. It sees credits and debits on an account. A PSP sees the whole
// card lifecycle. So a record claiming a bank asserted `AUTHORIZED` is not a weak record, it is an
// INCOHERENT one — the stated source could not know the stated fact — and it is refused on that ground
// rather than on its amount. This is the "according to transaction type" requirement, made structural.

export type SettlementSourceKind = "bank" | "psp";

export const SETTLEMENT_SOURCE_KINDS: readonly SettlementSourceKind[] = Object.freeze(["bank", "psp"]);

export const FINALITY_BY_SOURCE_KIND: Readonly<Record<SettlementSourceKind, readonly SettlementFinality[]>> =
  Object.freeze({
    bank: Object.freeze(["BANK_CREDITED", "REVERSED"] as const),
    psp: Object.freeze(["AUTHORIZED", "CAPTURED", "PSP_SETTLED", "REVERSED"] as const),
  });

// ── The fact ─────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE external settlement fact, reduced to the five things §2.3 of the audit established as minimal —
 * and no sixth.
 *
 * `expectedMinor` IS DELIBERATELY ABSENT. The external party must not state what was owed: billing
 * stating the expectation is billing auditing itself, which the billing extract already refuses, and
 * an external party stating it would be worse — it has no way to know. What was owed comes from the
 * governed baseline; this fact says only what ARRIVED.
 */
export interface ExternalSettlementFact {
  /** Tenant scope. From the authenticated server context, and inside the signed payload. */
  readonly boundaryId: string;
  /** The registered external source system, e.g. a named bank or provider. Never free text at the gate. */
  readonly sourceSystem: string;
  /** Which kind of party it is, which decides what it may assert. */
  readonly sourceKind: SettlementSourceKind;
  /** The external system's own identifier for THIS settlement. The money's identity. */
  readonly externalSettlementRef: string;
  /** What the external party says happened. */
  readonly finality: SettlementFinality;
  /** E1 · the amount, in minor units. */
  readonly amountMinor: number;
  /** E1 · its currency. */
  readonly currency: string;
  /** E2 · when the funds cleared. A BUSINESS date, which may be far older than the signature. */
  readonly valueDate: string;
  /** E3 · the reference tying this money to the corrective invoice. */
  readonly correctiveInvoiceRef: string;
  /** E4 · the payer as the EXTERNAL system holds it — so NH can check rather than take on trust. */
  readonly payerExternalRef: string;
}

/** Canonical identity of the MONEY, so the same settlement can never be counted twice. */
export function settlementIdentity(fact: ExternalSettlementFact): string {
  return [SETTLEMENT_ATTESTATION_SCHEME, fact.boundaryId, fact.sourceSystem, fact.externalSettlementRef]
    .join("\u0000");
}

// ── Refusals · every one fails CLOSED ────────────────────────────────────────────────────────────

export type ExternalSettlementRefusal =
  /** The feature is not enabled for this build. Named rather than silently permissive. */
  | "EXTERNAL_SETTLEMENT_NOT_ENABLED"
  /** No external settlement fact was cited at all. */
  | "NO_EXTERNAL_SETTLEMENT_EVIDENCE"
  /** A fact is structurally unusable — missing, empty, padded, control characters, bad number. */
  | "SETTLEMENT_FACT_MALFORMED"
  /** The stated source kind could not know the stated finality. */
  | "SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE"
  /** Every cited fact is pre-settlement — authorised or captured, so no money has arrived. */
  | "SETTLEMENT_NOT_FINAL"
  /** A reversal is present, so the money did not stay. */
  | "SETTLEMENT_REVERSED"
  /** A fact names a different tenant from the one the server is acting for. */
  | "SETTLEMENT_TENANT_MISMATCH"
  /** Facts from more than one external source system. They may not be summed — see the header. */
  | "SETTLEMENT_SOURCES_NOT_SUMMABLE"
  /** The same attestation was presented before. */
  | "SETTLEMENT_ATTESTATION_REPLAYED"
  /** This settlement already substantiates another claim. */
  | "SETTLEMENT_ALREADY_SUBSTANTIATED"
  /** A cited reference does not match the corrective invoice recorded on the case. */
  | "SETTLEMENT_REFERENCE_MISMATCH"
  /** The payer the external system names is not the payer recorded on the case. */
  | "SETTLEMENT_PAYER_MISMATCH"
  /** A currency differs from the proof's. */
  | "SETTLEMENT_CURRENCY_MISMATCH"
  /** The settled total does not reach the amount claimed. */
  | "SETTLEMENT_AMOUNT_INSUFFICIENT"
  /** The money cleared BEFORE the correction was raised, so it cannot be its result. */
  | "SETTLEMENT_PRECEDES_CORRECTION"
  /** A value date in the future. Nothing can attest a settlement that has not happened. */
  | "SETTLEMENT_VALUE_DATE_IN_FUTURE";

export type ExternalSettlementVerdict =
  | {
      readonly sufficient: true;
      /** Summed over DISTINCT settlement identities from ONE source system. */
      readonly settledMinor: number;
      /** The identities relied on, so the caller can record exactly what was consumed. */
      readonly identities: readonly string[];
      readonly sourceSystem: string;
      /** Necessary evidence of a relationship. NEVER causation — see the header of `proofService`. */
      readonly causationEstablished: false;
    }
  | {
      readonly sufficient: false;
      readonly code: ExternalSettlementRefusal;
      readonly reason: string;
    };

const deny = (code: ExternalSettlementRefusal, reason: string): ExternalSettlementVerdict =>
  Object.freeze({ sufficient: false as const, code, reason });

/** Why a text component is unusable, or null. NEVER echoes the value — refusals reach operators. */
export function settlementTextProblem(field: string, value: unknown): string | null {
  if (typeof value !== "string") return `${field} must be a string`;
  if (value.trim() === "") return `${field} must not be empty`;
  if (value !== value.trim()) return `${field} must not be surrounded by whitespace`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return `${field} must not contain control characters`;
  if (value.length > 256) return `${field} must be at most 256 characters`;
  return null;
}

/** Every structural problem with one fact, in a stable order. Empty means it is usable. */
export function externalSettlementProblems(fact: unknown): readonly string[] {
  const r = (fact ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of [
    "boundaryId", "sourceSystem", "externalSettlementRef", "currency", "valueDate",
    "correctiveInvoiceRef", "payerExternalRef",
  ]) {
    const problem = settlementTextProblem(field, r[field]);
    if (problem !== null) problems.push(problem);
  }
  if (!SETTLEMENT_SOURCE_KINDS.includes(r.sourceKind as SettlementSourceKind)) {
    problems.push("sourceKind must be one of: bank, psp");
  }
  if (!SETTLEMENT_FINALITY_STATES.includes(r.finality as SettlementFinality)) {
    problems.push(`finality must be one of: ${SETTLEMENT_FINALITY_STATES.join(", ")}`);
  }
  // A SETTLEMENT OF ZERO IS NOT A SETTLEMENT. Nothing arrived, so there is nothing to substantiate, and
  // permitting it would let a zero-amount record satisfy "at least one final fact" while adding no money.
  if (!Number.isSafeInteger(r.amountMinor) || (r.amountMinor as number) <= 0) {
    problems.push("amountMinor must be a whole amount greater than zero");
  }
  return Object.freeze(problems);
}

export interface ExternalSettlementInput {
  /** The feature flag, read from the environment by the server — never from a request. */
  readonly enabled: boolean;
  /** The tenant the SERVER is acting for. Never a request field. */
  readonly boundaryId: string;
  /** The amount the proof claims was collected. */
  readonly claimedCollectedMinor: number;
  /** The proof's currency. */
  readonly currency: string;
  /** The corrective invoice reference recorded on the CASE, from the correction evidence. */
  readonly caseCorrectiveInvoiceRef: string;
  /** The payer reference recorded on the CASE. */
  readonly casePayerExternalRef: string;
  /** When the correction was raised, from the case's own record. ISO-8601. */
  readonly correctionRaisedAt: string;
  /** Server clock, passed in so this stays pure and every branch is reachable from a test. */
  readonly now: string;
  /** The verified facts. Verification happened in the server layer; these are already signed-and-checked. */
  readonly facts: readonly ExternalSettlementFact[];
  /** Attestation nonces already seen, from persisted state. Replay protection. */
  readonly seenNonces: readonly string[];
  /** The nonce of each cited attestation, index-aligned with `facts`. */
  readonly nonces: readonly string[];
  /** Settlement identities already substantiating ANOTHER claim, from persisted state. */
  readonly identitiesAlreadySubstantiating: readonly string[];
}

/**
 * Decide whether external settlement evidence substantiates the claimed collection.
 *
 * THE ORDER IS FROM MOST STRUCTURAL TO MOST ARITHMETIC, so the refusal a caller receives is the one that
 * tells them what to do: "you cited nothing external" sends them somewhere different from "your
 * settlements total less than you claimed". That ordering rule is `outcomeEvidence`'s and is followed
 * here rather than reinvented.
 */
export function externalSettlementSufficiency(input: ExternalSettlementInput): ExternalSettlementVerdict {
  if (!input.enabled) {
    return deny(
      "EXTERNAL_SETTLEMENT_NOT_ENABLED",
      "external settlement attestation is not enabled for this build, so no claim may rest on it",
    );
  }
  if (input.facts.length === 0) {
    return deny(
      "NO_EXTERNAL_SETTLEMENT_EVIDENCE",
      "a claim resting on external settlement requires at least one attested settlement fact from a " +
        "party that is not party to the recovery claim",
    );
  }
  if (input.nonces.length !== input.facts.length) {
    return deny(
      "SETTLEMENT_FACT_MALFORMED",
      "every cited settlement fact must carry the nonce of the attestation that verified it",
    );
  }

  for (const fact of input.facts) {
    const problems = externalSettlementProblems(fact);
    if (problems.length > 0) {
      return deny("SETTLEMENT_FACT_MALFORMED", `settlement fact is unusable: ${problems.join("; ")}`);
    }
  }

  // TENANT FIRST, before anything about the money. A fact naming another tenant is not weak evidence
  // about this one, it is evidence about a different book, and reporting its amount problem would
  // describe the wrong tenant's figures.
  for (const fact of input.facts) {
    if (fact.boundaryId !== input.boundaryId) {
      return deny(
        "SETTLEMENT_TENANT_MISMATCH",
        "a cited settlement names a different tenant from the one this claim belongs to",
      );
    }
  }

  for (const fact of input.facts) {
    if (!FINALITY_BY_SOURCE_KIND[fact.sourceKind].includes(fact.finality)) {
      return deny(
        "SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE",
        `a ${fact.sourceKind} cannot assert ${fact.finality}: the stated source could not know the ` +
          "stated fact, so the record is incoherent rather than merely weak",
      );
    }
  }

  // A REVERSAL OUTRANKS EVERYTHING BELOW IT. If any cited fact says the money went back, the question
  // is not whether the rest sums: it is that the collection did not stay collected. Rule 9 then applies
  // — a revision is a NEW linked proof, never an overwrite.
  if (input.facts.some((f) => f.finality === "REVERSED")) {
    return deny(
      "SETTLEMENT_REVERSED",
      "a cited settlement is a reversal, chargeback or refund, so the money did not stay with the " +
        "company; a reversal after approval requires a new linked proof revision, never an overwrite",
    );
  }

  for (let i = 0; i < input.facts.length; i += 1) {
    if (input.seenNonces.includes(input.nonces[i]!)) {
      return deny(
        "SETTLEMENT_ATTESTATION_REPLAYED",
        "a cited attestation has been presented before; a signature is single-use, and freshness alone " +
          "is not a replay defence",
      );
    }
  }

  const finals = input.facts.filter((f) => settlementIsFinal(f.finality));
  if (finals.length === 0) {
    return deny(
      "SETTLEMENT_NOT_FINAL",
      "every cited settlement is pre-settlement: an authorisation is a reservation and a capture is the " +
        "company's own instruction, so neither establishes that money arrived",
    );
  }

  // ONE SOURCE SYSTEM, AND THIS IS THE SUBTLEST RULE HERE.
  //
  // Summing a PSP payout and a bank credit would double-count whenever the payout IS that credit — which
  // is the normal case — and NOTHING in either record establishes that they are not the same money. A
  // provider's payout reference and a bank's credit reference are different strings for one transfer.
  // So facts from a second source system contribute NO MONEY: they would be corroboration, and
  // corroborating across sources needs a source-stated link that neither party emits today.
  const sources = [...new Set(finals.map((f) => f.sourceSystem))];
  if (sources.length > 1) {
    return deny(
      "SETTLEMENT_SOURCES_NOT_SUMMABLE",
      "cited settlements come from more than one external source system; a provider payout and a bank " +
        "credit are routinely the SAME money under two references, and nothing in either record " +
        "establishes otherwise, so they are never summed",
    );
  }

  for (const fact of finals) {
    if (fact.correctiveInvoiceRef !== input.caseCorrectiveInvoiceRef) {
      return deny(
        "SETTLEMENT_REFERENCE_MISMATCH",
        "a cited settlement does not reference the corrective invoice recorded on this case, so the " +
          "money is not attributable to this recovery",
      );
    }
    if (fact.payerExternalRef !== input.casePayerExternalRef) {
      return deny(
        "SETTLEMENT_PAYER_MISMATCH",
        "the payer the external system names is not the payer recorded on this case",
      );
    }
    if (fact.currency !== input.currency) {
      return deny(
        "SETTLEMENT_CURRENCY_MISMATCH",
        "a cited settlement is denominated in a different currency from the claim; NH converts nothing",
      );
    }
  }

  const nowMs = Date.parse(input.now);
  const correctionMs = Date.parse(input.correctionRaisedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(correctionMs)) {
    return deny("SETTLEMENT_FACT_MALFORMED", "the server clock or the correction timestamp is not a date");
  }
  for (const fact of finals) {
    const valueMs = Date.parse(fact.valueDate);
    if (!Number.isFinite(valueMs)) {
      return deny("SETTLEMENT_FACT_MALFORMED", "a cited settlement's value date is not a date");
    }
    if (valueMs > nowMs) {
      return deny(
        "SETTLEMENT_VALUE_DATE_IN_FUTURE",
        "a cited settlement clears in the future; nothing can attest a settlement that has not happened",
      );
    }
    if (valueMs < correctionMs) {
      return deny(
        "SETTLEMENT_PRECEDES_CORRECTION",
        "a cited settlement cleared before the correction was raised, so it cannot be the correction's " +
          "result; this is necessary evidence of a relationship and never proof of causation",
      );
    }
  }

  // DISTINCT IDENTITIES ONLY. Two attestations of one settlement are the same money: the second is
  // corroboration and adds nothing. Summing by record rather than by identity is how a figure doubles.
  const byIdentity = new Map<string, ExternalSettlementFact>();
  for (const fact of finals) {
    const identity = settlementIdentity(fact);
    if (!byIdentity.has(identity)) byIdentity.set(identity, fact);
  }
  for (const identity of byIdentity.keys()) {
    if (input.identitiesAlreadySubstantiating.includes(identity)) {
      return deny(
        "SETTLEMENT_ALREADY_SUBSTANTIATED",
        "a cited settlement already substantiates another claim; one arrival of money may be counted once",
      );
    }
  }

  if (!Number.isSafeInteger(input.claimedCollectedMinor) || input.claimedCollectedMinor < 0) {
    return deny("SETTLEMENT_FACT_MALFORMED", "the claimed collected amount is not a whole, non-negative amount");
  }

  let settledMinor = 0;
  for (const fact of byIdentity.values()) settledMinor += fact.amountMinor;

  if (settledMinor < input.claimedCollectedMinor) {
    return deny(
      "SETTLEMENT_AMOUNT_INSUFFICIENT",
      `the attested settlements total ${settledMinor} minor units, which does not reach the ` +
        `${input.claimedCollectedMinor} claimed`,
    );
  }

  return Object.freeze({
    sufficient: true as const,
    settledMinor,
    identities: Object.freeze([...byIdentity.keys()]),
    sourceSystem: sources[0]!,
    causationEstablished: false as const,
  });
}
