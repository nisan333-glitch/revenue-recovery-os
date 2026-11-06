// THE FINANCIAL TRACE · one obligation, end to end, with every stage's evidence class on the record.
//
// WHAT IT IS FOR. Issue #18 Priority 3 asks for a product able to present REPRODUCIBLE FINANCIAL
// EVIDENCE rather than a screen showing amounts. A screen showing `$500.00 returned` is not evidence of
// anything: the reader cannot tell which records the figure came from, which stages were executed by
// production code, which inputs NH itself produced, or whether any independent party ever asserted the
// settlement. This module produces that answer as DATA — ten ordered stages, each naming the table its
// facts came from, each carrying two class fields, and a canonical form a reader can re-derive.
//
// TWO CLASS FIELDS PER STAGE, AND THEY ARE NEVER COLLAPSED. `executionClass` says whether real
// production code ran and wrote the real record. `inputClass` says who produced the input. A stage can
// be EXECUTED and SIMULATED at once — the whole case arc is — and reporting only the first half is how a
// demo gets mistaken for a pilot. The owner's three words map on exactly: *simulated* →
// `inputClass: SIMULATED`, *executed* → `executionClass: EXECUTED`, *attested* → `inputClass: ATTESTED`.
//
// NOTHING IN THIS BUILD REACHES ATTESTED, AND THE VERDICT IS DERIVED RATHER THAN DECLARED. See
// `attestationVerdict`: it reads the FIELDS PRESENT ON THE STORED RECEIPT and asks whether any of them
// could establish who holds the signing key. None can, so independence is NOT ESTABLISHABLE FROM THE
// RECORD — for every case, including one whose signature verified perfectly. It is deliberately NOT a
// string match on the keyId: the demo's key happens to be named `SYNTHETIC-DEMO-billing-…` and a naming
// convention is not a mechanism. The day a holder field is recorded, this flips on its own.
//
// SO REVENUE RETURNED IS REPORTED AS NOT ESTABLISHED, WITH EVERY APPLICABLE REASON. `revenueReturned`
// carries a LIST of codes, not one: a case with no proof AND no attestation channel has two independent
// reasons, and picking the "most specific" would hide the build-level one behind the case-level one.
// Collapsing distinguishable states is the error this repository keeps correcting.
//
// PURE. No clock, no I/O, no randomness, no crypto. The canonical form is a string this module builds;
// hashing it is the caller's job, exactly as `canonicalFinding` leaves hashing to `hashFinding`. That
// split is what lets the reproducibility property be tested without a database or Web Crypto.
import { addMoney, money, type Money } from "./money";
import {
  observedExposure,
  provenRevenueReturned,
  type ObservedExposure,
  type ProvenRevenueReturned,
} from "./caseLifecycle";

export const FINANCIAL_TRACE_SCHEME = "nh-financial-trace-v1";
export const FINANCIAL_TRACE_VERSION = "1.0.0";

/**
 * The ten stages, in the order the money travels. Fixed and ordered: a trace that could present them in
 * another order would let a reader draw a different causal story from the same records.
 */
export const TRACE_STAGE_ORDER = Object.freeze([
  "SOURCE_OBLIGATION",
  "DETECTION",
  "CANDIDATE",
  "REVIEW",
  "RECOVERY_CASE",
  "BASELINE",
  "PROPOSED_CORRECTION",
  "CORRECTION_RECORD",
  "SETTLEMENT_EVIDENCE",
  "PROOF",
] as const);

export type TraceStageName = (typeof TRACE_STAGE_ORDER)[number];

/** ESTABLISHED, ABSENT and REFUSED are three different things and none of them is a zero. */
export type StageStatus = "ESTABLISHED" | "ABSENT" | "REFUSED";

export type ExecutionClass = "EXECUTED" | "NOT_IMPLEMENTED";

export type InputClass = "SIMULATED" | "OBSERVED" | "ATTESTED" | "NOT_ESTABLISHABLE";

/**
 * Which ledger a reported figure belongs to. The tag travels WITH the figure so a renderer cannot put
 * two of them in one sum: an understatement and an overstatement are two problems and their sum is zero
 * problems, and a forecast summed into a proven number is the day the moat is gone.
 */
export type FigureLedger =
  /** What the SOURCE said — expected, billed, residual. Not NH's figure and not a ledger of ours. */
  | "SOURCE_STATED"
  /** What a detector says is at risk. Never recovered, never proven. */
  | "OBSERVED_EXPOSURE"
  /** The locked pre-outcome baseline. An input to a proof, never a result. */
  | "BASELINE"
  /** `Collected − Baseline` from a frozen proof chain. */
  | "PROVEN_REVENUE_RETURNED"
  /** Unreported or overstated BECAUSE precedence is undecided. A magnitude with a direction. */
  | "UNDECIDED_CORRECTION_MAGNITUDE";

export type TraceRefusalCode =
  /** Billed exceeded expected: a liability signal, never exposure and never recovered revenue. */
  | "NEGATIVE_RESIDUAL_NOT_EXPOSURE"
  /** Several observations, different amounts, and no approved rule says which statement wins. */
  | "CORRECTION_PRECEDENCE_UNDECIDED"
  /** Two observations of one identity share an append sequence, so order is not establishable. */
  | "CORRECTION_ORDER_NOT_ESTABLISHABLE"
  /** NH has no billing-correction request, approval, execution or status. None. */
  | "BILLING_CORRECTION_NOT_IMPLEMENTED"
  /** The obligation-identity gate refused this case; its own code is carried beside this one. */
  | "OBLIGATION_IDENTITY_GATE_REFUSED"
  /** No effective recovery proof exists for this case. */
  | "NO_EFFECTIVE_RECOVERY_PROOF"
  /** Independence of the settlement signer cannot be established from the record. */
  | "SETTLEMENT_INDEPENDENCE_NOT_ESTABLISHABLE";

export interface TraceFigure {
  /** Our own label. Never customer text, never a validator detail string. */
  readonly label: string;
  readonly ledger: FigureLedger;
  /** `null` is NOT ESTABLISHED. A zero would assert the figure was computed and came out empty. */
  readonly minor: number | null;
  readonly currency: string;
}

export interface TraceStage {
  readonly stage: TraceStageName;
  readonly status: StageStatus;
  readonly executionClass: ExecutionClass;
  readonly inputClass: InputClass;
  /** The table(s) the facts came from, as OUR constant — so a reader can go and look. */
  readonly recordSource: string;
  /** Record identifiers, pseudonymous or NH-issued only. */
  readonly recordIds: readonly string[];
  readonly figures: readonly TraceFigure[];
  readonly refusalCode: TraceRefusalCode | null;
  /** Our own wording for what is and is not established here. */
  readonly note: string;
}

// ── The attestation verdict ───────────────────────────────────────────────────────────────────────

/**
 * Fields that, IF THEY WERE ON THE STORED RECEIPT, could establish who holds the signing key and
 * whether that party is independent of the beneficiary.
 *
 * Declared as data so the verdict is a derivation over the real record rather than a sentence someone
 * wrote. None of these exists today; the day one is recorded, `attestationVerdict` upgrades with no edit
 * here — which is the whole reason it is a list and not a boolean.
 */
export const HOLDER_INDEPENDENCE_FIELDS: readonly string[] = Object.freeze([
  "keyHolder",
  "keyHolderIndependentOfBeneficiary",
  "provenanceChannel",
  "attestationChannel",
  "issuedBySystemOfRecord",
]);

export type AttestationCode =
  /** A signature verified, but nothing in the record says whose key it was. */
  | "INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD"
  /** No evidence row carries a verified signature at all. */
  | "NO_VERIFIED_SIGNATURE"
  /** There is no evidence. */
  | "NO_EVIDENCE";

export interface AttestationVerdict {
  /** True only when an independent party, not party to the claim, is established as the signer. */
  readonly independentlyAttested: false;
  readonly code: AttestationCode;
  readonly reason: string;
  /** Which of `HOLDER_INDEPENDENCE_FIELDS` the stored receipts actually carry. Expected: none. */
  readonly holderFieldsPresent: readonly string[];
  readonly verifiedSignatureCount: number;
}

export interface AttestationInput {
  /** Union of the keys present on every stored source-verification receipt for this case. */
  readonly receiptFields: readonly string[];
  readonly verifiedSignatureCount: number;
  readonly evidenceCount: number;
}

/**
 * Decide whether the settlement evidence is independently attested.
 *
 * THE RETURN TYPE CANNOT EXPRESS A YES. `independentlyAttested` is `false` and nothing else, the same
 * treatment `constitutesProof: false as const` already gets, because the one thing this verdict must
 * never do is become quotable as a positive. A build that can genuinely attest will add a new type
 * rather than flip a boolean here, and that is a reviewed change rather than an accident.
 */
export function attestationVerdict(input: AttestationInput): AttestationVerdict {
  const holderFieldsPresent = Object.freeze(
    HOLDER_INDEPENDENCE_FIELDS.filter((f) => input.receiptFields.includes(f)),
  );
  if (input.evidenceCount === 0) {
    return Object.freeze({
      independentlyAttested: false as const,
      code: "NO_EVIDENCE" as const,
      reason: "no evidence has been ingested for this case, so there is nothing whose origin could be attested",
      holderFieldsPresent,
      verifiedSignatureCount: input.verifiedSignatureCount,
    });
  }
  if (input.verifiedSignatureCount === 0) {
    return Object.freeze({
      independentlyAttested: false as const,
      code: "NO_VERIFIED_SIGNATURE" as const,
      reason:
        "no evidence row carries a verified source signature, so nothing outside NH has asserted this settlement",
      holderFieldsPresent,
      verifiedSignatureCount: 0,
    });
  }
  return Object.freeze({
    independentlyAttested: false as const,
    code: "INDEPENDENCE_NOT_ESTABLISHABLE_FROM_RECORD" as const,
    reason:
      "a source signature verified, which establishes that the payload was signed by a key in NH's " +
      "configured trust registry and NOTHING about who holds that key. The stored receipt records no " +
      "holder, no provenance channel and no issuing system, so a key generated by NH's own harness and a " +
      "key held by a customer's system of record are indistinguishable once verification has succeeded. " +
      "Independence of the signer is therefore not establishable from the record.",
    holderFieldsPresent,
    verifiedSignatureCount: input.verifiedSignatureCount,
  });
}

// ── Revenue Returned ─────────────────────────────────────────────────────────────────────────────

export type RevenueReturnedWithheldCode =
  | "REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED"
  | "NO_EFFECTIVE_RECOVERY_PROOF"
  | "OBLIGATION_IDENTITY_GATE_REFUSED";

export interface RevenueReturnedVerdict {
  readonly established: false;
  /** EVERY applicable reason, not the most specific one. Two reasons are two facts. */
  readonly codes: readonly RevenueReturnedWithheldCode[];
  readonly reasons: readonly string[];
  /**
   * The figure the frozen proof chain computed, carried for audit and NEVER as Revenue Returned.
   *
   * It is branded `ProvenRevenueReturned` because that is what the proof chain established internally;
   * the verdict beside it is what stops it being read as money the business got back. `null` when no
   * effective proof exists — never a zero.
   */
  readonly proofChainFigure: ProvenRevenueReturned | null;
  readonly fromProofIds: readonly string[];
}

// ── The trace ────────────────────────────────────────────────────────────────────────────────────

export interface FinancialTrace {
  readonly scheme: typeof FINANCIAL_TRACE_SCHEME;
  readonly version: typeof FINANCIAL_TRACE_VERSION;
  readonly recoveryCaseId: string;
  readonly boundaryId: string;
  readonly currency: string;
  readonly stages: readonly TraceStage[];
  /** What a detector said was at risk. Branded, so it cannot be put where the proven figure belongs. */
  readonly observedExposure: ObservedExposure | null;
  readonly observedExposureLabel: string;
  readonly revenueReturned: RevenueReturnedVerdict;
  readonly attestation: AttestationVerdict;
  /** The sentence that travels with the trace wherever it is rendered. */
  readonly syntheticDisclosure: string;
}

export interface FinancialTraceInput {
  readonly recoveryCaseId: string;
  readonly boundaryId: string;
  readonly currency: string;
  readonly stages: readonly TraceStage[];
  readonly observedExposureMinor: number | null;
  readonly proofChainFigureMinor: number | null;
  readonly proofIds: readonly string[];
  readonly attestation: AttestationVerdict;
  /** The obligation-identity gate's own refusal code, when it refused. */
  readonly identityGateRefusalCode: string | null;
}

const EXPOSURE_LABEL =
  "OBSERVED EXPOSURE — what a detector said was at risk. It is not money returned, it is never summed " +
  "into Revenue Returned, and it is never summed into Auditable Revenue.";

const SYNTHETIC_DISCLOSURE =
  "SYNTHETIC. Every figure in this trace was produced by NH or its harness. No billing system was " +
  "contacted, no charge was raised, no independent party asserted any settlement, and no amount here " +
  "was collected.";

/**
 * Assemble the trace, and decide Revenue Returned.
 *
 * THE STAGE ORDER IS ENFORCED, not trusted: a caller that passes stages out of order, duplicated, or
 * missing throws. A trace that silently reordered itself would let the same records tell a different
 * causal story, and a trace missing a stage would read as that stage having nothing to report — which
 * is the "not computed is not zero" mistake applied to a whole stage.
 */
export function buildFinancialTrace(input: FinancialTraceInput): FinancialTrace {
  const names = input.stages.map((s) => s.stage);
  if (names.length !== TRACE_STAGE_ORDER.length || names.some((n, i) => n !== TRACE_STAGE_ORDER[i])) {
    throw new Error(
      `financial trace must carry all ${TRACE_STAGE_ORDER.length} stages in order; got [${names.join(", ")}]`,
    );
  }

  const codes: RevenueReturnedWithheldCode[] = [];
  const reasons: string[] = [];

  // THE BUILD-LEVEL REASON IS ALWAYS FIRST AND IS ALWAYS PRESENT. It does not depend on this case, so a
  // case-level reason can never displace it: that displacement is how a general limitation gets reported
  // as a particular case's problem and then quietly disappears when the particular problem is fixed.
  codes.push("REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED");
  reasons.push(
    `Revenue Returned is WITHHELD: ${input.attestation.reason} Until an independent settlement source ` +
      "asserts this recovery, no amount here may be presented as money the business got back.",
  );

  if (input.proofChainFigureMinor === null || input.proofIds.length === 0) {
    codes.push("NO_EFFECTIVE_RECOVERY_PROOF");
    reasons.push("no effective recovery proof exists for this case, so no proof chain has computed a figure at all");
  }
  if (input.identityGateRefusalCode !== null) {
    codes.push("OBLIGATION_IDENTITY_GATE_REFUSED");
    reasons.push(
      `the obligation-identity gate refused this case with ${input.identityGateRefusalCode}, so a monetary ` +
        "proof may not be minted for it",
    );
  }

  const figure =
    input.proofChainFigureMinor === null || input.proofIds.length === 0
      ? null
      : provenRevenueReturned(money(input.proofChainFigureMinor, input.currency), input.proofIds);

  return Object.freeze({
    scheme: FINANCIAL_TRACE_SCHEME,
    version: FINANCIAL_TRACE_VERSION,
    recoveryCaseId: input.recoveryCaseId,
    boundaryId: input.boundaryId,
    currency: input.currency,
    stages: Object.freeze([...input.stages]),
    observedExposure:
      input.observedExposureMinor === null
        ? null
        : observedExposure(money(input.observedExposureMinor, input.currency)),
    observedExposureLabel: EXPOSURE_LABEL,
    revenueReturned: Object.freeze({
      established: false as const,
      codes: Object.freeze(codes),
      reasons: Object.freeze(reasons),
      proofChainFigure: figure,
      fromProofIds: Object.freeze([...input.proofIds]),
    }),
    attestation: input.attestation,
    syntheticDisclosure: SYNTHETIC_DISCLOSURE,
  });
}

/**
 * WHICH LEDGERS MAY BE ADDED UP AT ALL. Declared as data, because additivity is a property of what the
 * figures MEAN and not of their type.
 *
 * `SOURCE_STATED` is deliberately absent, and finding that out cost a wrong number: the first form of
 * `ledgerTotals` added every ledger, and a real run printed `SOURCE_STATED: $5,700.00` — the expected
 * amount plus the billed amount plus the residual plus each observation plus the stored figure plus the
 * evidence amount. Those are six STATEMENTS about one obligation, several of them restatements of each
 * other, and their sum is a figure no record asserts and no person could defend. A trace built to stop
 * exactly that kind of number must not print one itself.
 *
 * The four that remain are additive because each is a quantity of money of one kind: a baseline, an
 * exposure, a proven figure, a magnitude held back. Even so, within one case each normally has a single
 * figure, so the total is a convenience rather than a finding.
 */
export const ADDITIVE_LEDGERS: readonly FigureLedger[] = Object.freeze([
  "OBSERVED_EXPOSURE",
  "BASELINE",
  "PROVEN_REVENUE_RETURNED",
  "UNDECIDED_CORRECTION_MAGNITUDE",
]);

export interface LedgerSummary {
  /**
   * `null` in TWO cases, both of which a zero would misreport.
   *
   *  1. The ledger is NOT ADDITIVE, so no total is offered at all.
   *  2. Every figure in it is NOT ESTABLISHED, so there is nothing to add. A `$0.00` here would assert
   *     the ledger summed cleanly to nothing, which is the "not computed is not zero" rule inside an
   *     aggregate — found by a test on the renderer, which printed exactly that.
   */
  readonly total: Money | null;
  readonly additive: boolean;
  readonly figureCount: number;
  /** Figures reported as NOT ESTABLISHED. Counted, never added as a zero. */
  readonly unestablishedCount: number;
  /** How many figures actually carried an amount. `total` is null exactly when this is 0. */
  readonly establishedCount: number;
}

/**
 * Per-ledger summaries. THERE IS NO GRAND TOTAL AND THERE IS NO FUNCTION THAT RETURNS ONE.
 *
 * A caller wanting one has to write the loop itself, in its own file, where a reviewer will see it. That
 * is the whole mechanism: this module makes the honest answer easy and the dishonest one conspicuous.
 */
export function ledgerTotals(trace: FinancialTrace): ReadonlyMap<FigureLedger, LedgerSummary> {
  const out = new Map<
    FigureLedger,
    { total: Money | null; additive: boolean; figureCount: number; unestablishedCount: number; establishedCount: number }
  >();
  for (const stage of trace.stages) {
    for (const f of stage.figures) {
      const additive = ADDITIVE_LEDGERS.includes(f.ledger);
      const entry = out.get(f.ledger) ?? {
        total: null,
        additive,
        figureCount: 0,
        unestablishedCount: 0,
        establishedCount: 0,
      };
      entry.figureCount += 1;
      if (f.minor === null) {
        entry.unestablishedCount += 1;
      } else if (additive) {
        // The accumulator STARTS at the first established figure rather than at a zero, so a ledger with
        // nothing established keeps `total: null` instead of reporting a clean nothing.
        entry.total = entry.total === null ? money(f.minor, f.currency) : addMoney(entry.total, money(f.minor, f.currency));
        entry.establishedCount += 1;
      } else {
        entry.establishedCount += 1;
      }
      out.set(f.ledger, entry);
    }
  }
  return out;
}

/**
 * The canonical form — the reproducibility claim, as a string.
 *
 * CLOCK VALUES ARE EXCLUDED BY CONSTRUCTION, because nothing here reads one: no `verifiedAt`, no
 * `ingestedAt`, no `at`. That is what makes the digest a function of the RECORDS rather than of the run,
 * so the same case re-traced tomorrow yields the same digest — and a digest that moved would mean a
 * record moved, which on append-only tables should be impossible.
 *
 * `reasons` and `note` are OUR prose and are deliberately out of the preimage: a clearer sentence must
 * not re-identify a trace. The CODES are in, because a code is a decision.
 */
export function canonicalFinancialTrace(trace: FinancialTrace): string {
  return JSON.stringify({
    scheme: trace.scheme,
    version: trace.version,
    recoveryCaseId: trace.recoveryCaseId,
    boundaryId: trace.boundaryId,
    currency: trace.currency,
    stages: trace.stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      executionClass: s.executionClass,
      inputClass: s.inputClass,
      recordSource: s.recordSource,
      recordIds: [...s.recordIds].sort(),
      figures: [...s.figures]
        .map((f) => ({ label: f.label, ledger: f.ledger, minor: f.minor, currency: f.currency }))
        .sort((a, b) => (a.ledger + a.label).localeCompare(b.ledger + b.label)),
      refusalCode: s.refusalCode,
    })),
    observedExposureMinor: trace.observedExposure?.minor ?? null,
    revenueReturned: {
      established: trace.revenueReturned.established,
      codes: [...trace.revenueReturned.codes].sort(),
      proofChainFigureMinor: trace.revenueReturned.proofChainFigure?.minor ?? null,
      fromProofIds: [...trace.revenueReturned.fromProofIds].sort(),
    },
    attestation: {
      independentlyAttested: trace.attestation.independentlyAttested,
      code: trace.attestation.code,
      holderFieldsPresent: [...trace.attestation.holderFieldsPresent].sort(),
      verifiedSignatureCount: trace.attestation.verifiedSignatureCount,
    },
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

/**
 * Render the trace as text. PURE, so every claim the CLI makes is falsifiable without a database.
 *
 * It prints `NOT ESTABLISHED` where a figure is null and NEVER `$0.00`, for the reason the whole trace
 * exists: a zero asserts that a figure was computed and came out empty, which is a different and much
 * stronger claim than "nobody established this". And it prints the two class fields side by side on
 * every line, because a reader skimming for `EXECUTED` must see `SIMULATED` in the same glance.
 */
export function renderFinancialTrace(
  trace: FinancialTrace,
  digest: string,
  format: (minor: number, currency: string) => string,
): string {
  const lines: string[] = [];
  const amount = (f: TraceFigure): string =>
    f.minor === null ? "NOT ESTABLISHED" : format(f.minor, f.currency);

  lines.push(`FINANCIAL TRACE · ${trace.scheme} ${trace.version}`);
  lines.push(`case ${trace.recoveryCaseId} · boundary ${trace.boundaryId} · ${trace.currency}`);
  lines.push(`trace digest ${digest}`);
  lines.push("");
  lines.push("STAGES · executionClass / inputClass");
  for (const [i, s] of trace.stages.entries()) {
    lines.push(
      `${String(i + 1).padStart(2, " ")}. ${s.stage.padEnd(20, " ")} ${s.status.padEnd(12, " ")}` +
        ` ${s.executionClass} / ${s.inputClass}`,
    );
    lines.push(`    record: ${s.recordSource}`);
    if (s.recordIds.length > 0) lines.push(`    ids: ${s.recordIds.join(", ")}`);
    for (const f of s.figures) lines.push(`    ${f.ledger} · ${f.label}: ${amount(f)}`);
    if (s.refusalCode !== null) lines.push(`    REFUSED · ${s.refusalCode}`);
    lines.push(`    ${s.note}`);
  }
  lines.push("");
  lines.push("LEDGERS · reported apart, never summed together");
  for (const [ledger, entry] of [...ledgerTotals(trace)].sort(([a], [b]) => a.localeCompare(b))) {
    const unestablished =
      entry.unestablishedCount > 0 ? ` (+${entry.unestablishedCount} NOT ESTABLISHED)` : "";
    lines.push(
      entry.total !== null
        ? `  ${ledger}: ${format(entry.total.minor, entry.total.currency)}${unestablished}`
        : entry.additive
          ? `  ${ledger}: NOT ESTABLISHED — ${entry.figureCount} figure(s), none carrying an amount`
          : `  ${ledger}: NOT ADDITIVE — ${entry.figureCount} separate statement(s), listed above and ` +
            `deliberately not summed${unestablished}`,
    );
  }
  lines.push("");
  lines.push("OBSERVED EXPOSURE");
  lines.push(
    `  ${trace.observedExposure === null ? "NOT ESTABLISHED" : format(trace.observedExposure.minor, trace.observedExposure.currency)}`,
  );
  lines.push(`  ${trace.observedExposureLabel}`);
  lines.push("");
  lines.push("REVENUE RETURNED");
  lines.push(`  ESTABLISHED: ${trace.revenueReturned.established ? "yes" : "NO"}`);
  lines.push(
    `  the proof chain's own figure: ${
      trace.revenueReturned.proofChainFigure === null
        ? "NOT ESTABLISHED"
        : format(trace.revenueReturned.proofChainFigure.minor, trace.revenueReturned.proofChainFigure.currency)
    }` + (trace.revenueReturned.fromProofIds.length > 0
      ? ` from ${trace.revenueReturned.fromProofIds.join(", ")}`
      : ""),
  );
  for (const [i, code] of trace.revenueReturned.codes.entries()) {
    lines.push(`  WITHHELD · ${code}`);
    lines.push(`    ${trace.revenueReturned.reasons[i] ?? ""}`);
  }
  lines.push("");
  lines.push(`ATTESTATION · ${trace.attestation.code}`);
  lines.push(`  independently attested: NO`);
  lines.push(`  verified source signatures: ${trace.attestation.verifiedSignatureCount}`);
  lines.push(
    `  holder fields on the stored receipt: ${
      trace.attestation.holderFieldsPresent.length === 0
        ? "none — so who holds the signing key is not recorded"
        : trace.attestation.holderFieldsPresent.join(", ")
    }`,
  );
  lines.push("");
  lines.push(trace.syntheticDisclosure);
  return lines.join("\n");
}
