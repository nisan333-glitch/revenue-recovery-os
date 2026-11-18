// TRACK 2 · THE DATA CONTRACT BETWEEN BILLING AND THE BANK, AND THE ONE FIELD THAT HAS TO AGREE.
//
// WHAT THIS IS. The facts each side must supply for a bank's settlement attestation to be comparable
// against a Recovery Case, declared as DATA so a customer-facing request is RENDERED from it rather
// than written beside it. The repository has already paid for the alternative: a hand-authored data
// request drifts from the code silently and the customer discovers it at reconciliation.
//
// AND IT IS CHECKED AGAINST THE CODE, NOT MERELY DECLARED. `pilotPayerContract.test.ts` parses
// `ExternalSettlementFact` and `EvidenceClaim` out of their own source files and fails if this contract
// asks for a field that does not exist, omits one a customer must supply, or names a refusal code that
// is not in `ExternalSettlementRefusal`. A contract nothing compares to the judging code is prose.
//
// WHY A SHARED PAYER REFERENCE IS THE CRUX, and why it is a COMMERCIAL requirement rather than a
// technical one. G10 made the payer reference attestable: billing signs it into the evidence claim, the
// bank signs it into the settlement attestation, and NH compares two independent institutional
// statements. The mechanism is sound and tested. But:
//
//   NOTHING IN SOFTWARE CAN MAKE TWO INSTITUTIONS CHOOSE THE SAME STRING. If the billing system names
//   the payer by its own customer number and the bank names it by an account identifier or a free-text
//   remittance line, both statements are honest, both verify, and they do not match. The correct fix is
//   that both sides quote ONE agreed reference — a clause in the customer's own arrangement with its
//   bank, not a looser comparison in NH.
//
// SO THIS CONTRACT STATES THE REQUIREMENT AND NAMES ITS OWNER. It does not soften the comparison, and
// it does not invent a mapping: a mapping table maintained by the beneficiary would hand them the lever
// the whole check exists to remove.

/** Version of this data contract. A change in what either side must supply is a NEW id. */
export const PILOT_PAYER_CONTRACT_VERSION = "payer-contract-2026.1";

export type ContractSide =
  /** The customer's billing or ERP system — the one that raised the corrective invoice. */
  | "BILLING"
  /** The bank or PSP that received the money. */
  | "BANK";

export type FieldTier =
  /** Without it no settlement can be compared at all. */
  | "REQUIRED"
  /** Improves what NH can say; its absence closes a named capability and rejects nothing. */
  | "OPTIONAL";

export interface ContractField {
  readonly side: ContractSide;
  /** The customer-facing name of the fact. */
  readonly fact: string;
  readonly tier: FieldTier;
  /**
   * The field names this fact occupies in the payload NH actually verifies — on
   * `ExternalSettlementFact` for BANK, on `EvidenceClaim` for BILLING. The test parses both
   * interfaces and requires this to agree, so a renamed field cannot leave a stale customer ask.
   *
   * EMPTY means the fact is not a field of either payload: the attestation envelope, and the
   * corrective-invoice identifier, which NH reads from the correction record the SERVER chose.
   */
  readonly payloadFields: readonly string[];
  readonly whatItIs: string;
  /** Which comparison or control reads it. A fact nothing reads is not asked for. */
  readonly readBy: readonly string[];
  /** Who at the customer owns supplying it. A requirement with no owner is a wish. */
  readonly ownedBy: string;
  /** The refusal codes NH answers with when it is absent or disagrees. Checked against the union. */
  readonly refusals: readonly string[];
  /** What that refusal means for the pilot, in the customer's terms. */
  readonly onAbsence: string;
}

/**
 * Fields of the signed settlement payload that the BANK does not supply, so the contract does not ask
 * for them. Declared here because the derivation test must distinguish "not asked for, by decision"
 * from "forgotten" — the two are identical to a diff.
 */
export const BANK_FIELDS_NOT_REQUESTED: Readonly<Record<string, string>> = Object.freeze({
  boundaryId:
    "the tenant scope. It comes from NH's authenticated server context and is placed inside the " +
    "signed payload by the sending integration; a customer does not choose it.",
  sourceKind:
    "whether the sender is a bank or a PSP. It is a property of the registered source system in NH's " +
    "own key register, not a per-settlement fact.",
  sourceSystem:
    "the registered name of the sending institution. It is established once, at institution " +
    "onboarding, and must match the register — a settlement may not introduce a new source.",
});

export const PILOT_PAYER_CONTRACT_FIELDS: readonly ContractField[] = Object.freeze([
  // ── The shared fact. Everything else is comparable only because this one agrees. ───────────────
  Object.freeze({
    side: "BILLING" as const,
    fact: "payer reference",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["payerExternalRef"]),
    whatItIs:
      "The payer, in the identifier BOTH the billing system and the bank will quote. Signed into the " +
      "evidence claim under the v2 evidence scheme, so NH records a value the billing system asserted " +
      "and the party assembling the submission cannot author.",
    readBy: Object.freeze(["attestedPayerReference", "caseSettlementContext"]),
    ownedBy: "Billing / ERP owner, against a reference agreed with the bank",
    refusals: Object.freeze(["SETTLEMENT_CASE_PAYER_NOT_RECORDED"]),
    onAbsence:
      "The case holds no attested payer, so every cited settlement is refused. Nothing is inferred " +
      "and no proof is produced. This is the correct answer rather than a missing feature.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "payer reference",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["payerExternalRef"]),
    whatItIs:
      "The payer as the bank names them, in the SAME agreed identifier, signed into the settlement " +
      "attestation.",
    readBy: Object.freeze(["externalSettlementSufficiency · payer comparison"]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze(["SETTLEMENT_FACT_MALFORMED", "SETTLEMENT_PAYER_MISMATCH"]),
    onAbsence:
      "Absent, the attestation is structurally unusable. Present but different from the payer billing " +
      "signed for, it is a mismatch — and NH refuses rather than choosing one of the two.",
  }),

  // ── The corrective invoice, which ties the money to this case's own correction ─────────────────
  Object.freeze({
    side: "BILLING" as const,
    fact: "corrective invoice identifier",
    tier: "REQUIRED" as const,
    // Not a claim field: it is `sourceRecordId` on the correction evidence, and NH takes it from the
    // record the SERVER chose rather than from any request.
    payloadFields: Object.freeze([]),
    whatItIs:
      "The billing system's own identifier for the corrective invoice that was raised. NH takes the " +
      "comparison target from the correction record it chose itself, never from the approval request.",
    readBy: Object.freeze(["executedCorrection", "caseSettlementContext"]),
    ownedBy: "Billing / ERP owner",
    refusals: Object.freeze(["SETTLEMENT_CASE_CORRECTION_MISSING"]),
    onAbsence:
      "No executed correction is established, so there is no invoice an attestation could be matched " +
      "against and the approval refuses before any settlement is considered.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "corrective invoice reference on the remittance",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["correctiveInvoiceRef"]),
    whatItIs: "The invoice this money pays, as quoted on the remittance.",
    readBy: Object.freeze(["externalSettlementSufficiency · reference comparison"]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze(["SETTLEMENT_FACT_MALFORMED", "SETTLEMENT_REFERENCE_MISMATCH"]),
    onAbsence:
      "Without it the money cannot be tied to this case's correction. A reference that does not match " +
      "the correction NH chose is refused, not reconciled by resemblance.",
  }),

  // ── The money, and whether it stayed ──────────────────────────────────────────────────────────
  Object.freeze({
    side: "BANK" as const,
    fact: "settled amount",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["amountMinor"]),
    whatItIs: "What arrived, in minor units — whole, non-negative, never a formatted string.",
    readBy: Object.freeze(["externalSettlementSufficiency · amount check"]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze(["SETTLEMENT_FACT_MALFORMED", "SETTLEMENT_AMOUNT_INSUFFICIENT"]),
    onAbsence:
      "A settled total that does not reach the amount claimed is refused. NH does not scale a proof " +
      "down to whatever arrived; the claim is the claim and the evidence either supports it or does not.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "currency",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["currency"]),
    whatItIs: "The currency of the settled amount.",
    readBy: Object.freeze(["externalSettlementSufficiency · currency check"]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze(["SETTLEMENT_FACT_MALFORMED", "SETTLEMENT_CURRENCY_MISMATCH"]),
    onAbsence: "A currency differing from the proof's is refused. Nothing is converted — NH holds no rate.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "finality",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["finality"]),
    whatItIs:
      "Whether the money actually arrived and stayed. Only a credited or settled state is final: " +
      "authorised and captured are pre-settlement, and reversed means it did not stay. A PSP may not " +
      "assert a state only the bank could know.",
    readBy: Object.freeze([
      "externalSettlementSufficiency · finality gate",
      "externalSettlementSufficiency · source-kind competence",
    ]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze([
      "SETTLEMENT_FACT_MALFORMED",
      "SETTLEMENT_NOT_FINAL",
      "SETTLEMENT_REVERSED",
      "SETTLEMENT_FINALITY_NOT_ASSERTABLE_BY_SOURCE",
    ]),
    onAbsence:
      "A pre-settlement state proves an intention, not an arrival, and is refused. A reversal refuses " +
      "outright — money that came back is not recovered revenue.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "value date",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["valueDate"]),
    whatItIs:
      "When the funds cleared — a BUSINESS date, which may be far older than the signature over it.",
    readBy: Object.freeze([
      "externalSettlementSufficiency · must not precede the correction",
      "externalSettlementSufficiency · must not be in the future",
    ]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze([
      "SETTLEMENT_FACT_MALFORMED",
      "SETTLEMENT_PRECEDES_CORRECTION",
      "SETTLEMENT_VALUE_DATE_IN_FUTURE",
    ]),
    onAbsence:
      "Money that cleared BEFORE the correction was raised cannot be the correction's result, however " +
      "well it matches on every other field. That refusal is the point of the field.",
  }),
  Object.freeze({
    side: "BANK" as const,
    fact: "the bank's own settlement reference",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze(["externalSettlementRef"]),
    whatItIs:
      "The institution's own identifier for THIS arrival of money. It is the identity the " +
      "one-arrival-counted-once rule is built on. NH stores only a KEYED pseudonym of it under a " +
      "server-held key, never the value itself.",
    readBy: Object.freeze([
      "settlementIdentity",
      "settlementLedgerStore.claim · one-arrival-counted-once",
      "settlementCompromiseReport",
    ]),
    ownedBy: "Bank / PSP relationship owner",
    refusals: Object.freeze([
      "SETTLEMENT_FACT_MALFORMED",
      "SETTLEMENT_ALREADY_SUBSTANTIATED",
      "SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM",
    ]),
    onAbsence:
      "Without it an arrival has no identity, so nothing can stop the same money substantiating two " +
      "proofs. It must be stable: the same arrival re-sent must carry the same reference.",
  }),

  // ── The signatures, and what a signature is not ───────────────────────────────────────────────
  Object.freeze({
    side: "BANK" as const,
    fact: "attestation envelope — key id, issuing instant, nonce, signature",
    tier: "REQUIRED" as const,
    // Not fields of the fact: the envelope wraps it.
    payloadFields: Object.freeze([]),
    whatItIs:
      "A signature over the ordered settlement payload, under a key registered in NH's governed key " +
      "register and active at the stated issuing instant. The nonce makes each signature single-use.",
    readBy: Object.freeze([
      "verifySettlementAgainstRegister",
      "settlementKeyLifecycle",
      "settlementLedgerStore.claim · one-use nonce",
    ]),
    ownedBy: "Bank / PSP technical owner",
    refusals: Object.freeze([
      "SETTLEMENT_ATTESTATION_REPLAYED",
      "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING",
      "SETTLEMENT_KEY_NOT_CURRENTLY_PERMITTED",
      "SETTLEMENT_KEY_REVOKED_COMPROMISED",
    ]),
    onAbsence:
      "Without a verifying attestation there is no verified settlement and the citation is refused. " +
      "A VALID SIGNATURE PROVES CONTROL OF A REGISTERED KEY AND NOTHING ABOUT WHO HOLDS IT — the " +
      "institution's authority is established separately and is not implied by any signature.",
  }),
  Object.freeze({
    side: "BILLING" as const,
    fact: "source attestation over the evidence claim",
    tier: "REQUIRED" as const,
    payloadFields: Object.freeze([]),
    whatItIs:
      "A signature over the evidence claim, which is what makes the payer reference ATTESTED rather " +
      "than asserted, and the correction evidence source-verified rather than beneficiary-controlled.",
    readBy: Object.freeze(["SourceVerifier.verify", "attestedPayerReference", "executedCorrection"]),
    ownedBy: "Billing / ERP technical owner",
    refusals: Object.freeze(["SETTLEMENT_CASE_PAYER_NOT_RECORDED", "SETTLEMENT_CASE_CORRECTION_MISSING"]),
    onAbsence:
      "An unsigned evidence record carries no verification, contributes no payer reference, and counts " +
      "as beneficiary-controlled for the outcome-evidence gate — so it cannot establish the correction.",
  }),
]);

/**
 * The facts that must carry the SAME value on both sides.
 *
 * DERIVED from the field list rather than restated, so a side added to or removed from the contract
 * cannot leave this stale.
 */
export function sharedFacts(): readonly string[] {
  const sides = new Map<string, Set<ContractSide>>();
  for (const f of PILOT_PAYER_CONTRACT_FIELDS) {
    if (!sides.has(f.fact)) sides.set(f.fact, new Set());
    sides.get(f.fact)!.add(f.side);
  }
  return Object.freeze([...sides.entries()].filter(([, s]) => s.size > 1).map(([fact]) => fact));
}

/** The fields one side must supply, in payload terms. Rendered into the customer request. */
export function requiredPayloadFields(side: ContractSide): readonly string[] {
  return Object.freeze(
    PILOT_PAYER_CONTRACT_FIELDS.filter((f) => f.side === side && f.tier === "REQUIRED")
      .flatMap((f) => [...f.payloadFields])
      .sort(),
  );
}

/** Every refusal code this contract names, for checking against the code that answers with them. */
export function citedRefusalCodes(): readonly string[] {
  return Object.freeze(
    [...new Set(PILOT_PAYER_CONTRACT_FIELDS.flatMap((f) => [...f.refusals]))].sort(),
  );
}

/**
 * THE OPEN COMMERCIAL DEPENDENCY, stated once and rendered everywhere.
 *
 * It is not a defect, not a TODO and not something NH can close. It is a clause someone has to agree,
 * and the honest thing is to say whose clause it is.
 */
export const PAYER_AGREEMENT_DEPENDENCY = Object.freeze({
  requirement:
    "The billing system and the bank must quote the SAME payer identifier — on the corrective invoice " +
    "and on the remittance.",
  whyNHCannotCloseIt:
    "Both statements are signed by institutions NH does not control. If they choose different " +
    "identifiers both are honest, both verify, and they do not match. Software can compare them; it " +
    "cannot make them agree.",
  whyNoMappingTable:
    "A mapping maintained by the customer's own team would hand the beneficiary control over which " +
    "settlement matches which case — the exact lever the payer comparison exists to remove. NH will " +
    "not accept one, and will not fall back to matching on amount, date or name resemblance either.",
  whyNoFuzzyMatch:
    "Amount and date proximity are the first things that look like a match and the first things an " +
    "unrelated payment also satisfies. Matching on them would make NH the author of the relationship " +
    "it is supposed to be reading.",
  ownedBy: "the customer's finance owner, with their bank or PSP",
  blocksUntilAgreed:
    "Every cited settlement is refused: SETTLEMENT_PAYER_MISMATCH when both sides are attested and " +
    "disagree, SETTLEMENT_CASE_PAYER_NOT_RECORDED when billing has not signed one at all.",
  neverPresentedAsVerified: true as const,
});
