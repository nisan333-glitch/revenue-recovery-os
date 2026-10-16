// MINIMAL CUSTOMER PROVENANCE ATTESTATION — the smallest practical step from PROVISIONAL towards
// verified authority, and deliberately not a step to verified authority itself.
//
// WHAT PROBLEM THIS SOLVES. Readiness could say a customer's files are structurally capable of monetary
// reconciliation, and could say nothing at all about whether the files came from the systems they claim
// to come from. The ceiling was `SOURCE_NATIVE` with `AUTHORITY_UNVERIFIED`, because no provenance
// channel existed. This adds the cheapest channel that carries real evidence: a short declaration by the
// customer's data-owning ROLE, which NH then checks against the files.
//
// THE LIMIT OF WHAT ANY OF THIS CAN ESTABLISH, and the first version of this module got it wrong, so it
// is stated before anything else. `corroborateAttestation` takes three inputs — the declaration, the
// expectation validation and the billing validation — and ALL THREE COME FROM THE SAME PARTY. A predicate
// whose every input is controlled by one party can decide INTERNAL CONSISTENCY and can never decide
// CORRESPONDENCE WITH AN EXTERNAL REFERENT. So:
//
//   • "the file we received has the number of rows the declaration states" is inside the closure, and is
//     genuinely checkable.
//   • "this is the complete, untrimmed export the source system produced" relates the file to the source
//     system's actual state, which appears in no input at all, so it is not merely unchecked but
//     UNREACHABLE.
//
// The first version wrongly called the row count a PRE-COMMITMENT that would make a later trim
// detectable; the declaration and the file arrive together, so anyone willing to delete rows can adjust
// the number to match. **Pre-registration is meaningful only when the committed artefact passes beyond
// the committer's reach, and this one never does.** The row-count check is kept because an uncoordinated
// mismatch is the common real-world failure and refusing it costs nothing — and it is now named and
// described for what it decides.
//
// WHY IT IS NOT AUTHORITY_VERIFIED, stated here because the temptation is to round up. That rung means
// *evidenced by a channel the beneficiary cannot unilaterally alter* (`sourceFactAuthority.ts`), and this
// repository already contains its one instance: `server/services/sourceVerification.ts` verifies Ed25519
// over a payload signed by a key the SOURCE SYSTEM holds and the submitter does not. An attestation is
// written by the submitting side, which can revise the attestation and the file together. So it earns a
// new, strictly weaker rung — `SOURCE_ATTESTED` — and never that one.
//
// THE LOAD-BEARING DISTINCTION, and the whole reason this module is more than a form:
//
//   **A rung may rest only on what NH can CHECK. A claim NH cannot check is recorded, attributed and
//   labelled — never counted as evidence for it.**
//
// So every declared fact is classified once, in `ATTESTATION_CLAIMS`, as exactly one of:
//
//   CORROBORATED        checked against the contents of the files themselves
//   WELL_FORMED         checked for shape only — it is a commitment, not yet a corroboration
//   UNCORROBORATED_CLAIM  not checkable by any means available here, ever
//
// Three of the six things a pilot wants to know have real corroboration and three do not. The report says
// which, because a customer who is told "provenance confirmed" would reasonably conclude we checked the
// three we cannot check.
//
// A ROLE, NEVER A NAMED INDIVIDUAL. `DatasetProvenance` on the observation contract already made this
// choice deliberately, and minimization is why: the pilot needs joins, dates and amounts, not people. An
// accountable individual belongs in the contract or the DPA, not in a data submission.
//
// PURE AND CLOCKLESS. No crypto, no network, no `Date.now()`. The same bytes and the same attestation
// must always produce the same corroboration, or historical proof would stop being reproducible.
import type { ExpectationExtractValidation } from "./expectationExtractValidator";
import type { BillingExtractValidation } from "./billingExtractValidator";

export const ATTESTATION_SCHEME = "nh-provenance-attestation-v1";

/** This corroboration method's own version line, independent of every extract and of readiness. */
export const ATTESTATION_METHOD_VERSION = "pav-2026.2";

// ── 1 · WHAT THE CUSTOMER DECLARES ────────────────────────────────────────────────────────────────

/**
 * How the extract was produced. A CLOSED set, because free text here would make the field unusable as
 * evidence: "exported" tells us nothing, while `warehouse_view` tells us a transformation layer sits
 * between the source system and the file, which is exactly the thing worth knowing.
 */
export type ExtractionMethod =
  | "direct_query"
  | "standard_report_export"
  | "warehouse_view"
  | "vendor_api_export"
  | "other_described";

export const EXTRACTION_METHODS: readonly ExtractionMethod[] = Object.freeze([
  "direct_query", "standard_report_export", "warehouse_view", "vendor_api_export", "other_described",
]);

export interface ExportAttestation {
  /** The system the export came from, as the customer names it. Checked for presence, never for truth. */
  readonly sourceSystem: string;
  readonly extractionMethod: ExtractionMethod;
  /** Required when, and only when, the method is `other_described`. */
  readonly extractionMethodDescription: string | null;
  /** When the extract was taken. `YYYY-MM-DD`, which is all the precision this check needs. */
  readonly extractedAt: string;
  /** Inclusive window the export claims to cover. */
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /**
   * The number of rows the declaration says each export contains.
   *
   * WHAT THIS IS NOT, stated here because the first version of this module got it wrong. It is **not a
   * pre-commitment** and it does **not** make a later trim detectable. The declaration and the file reach
   * NH together, from the same party, so anyone willing to remove rows can adjust this number to match
   * and NH sees a perfect agreement. What a match establishes is that the declaration and the file WE
   * RECEIVED agree with each other — which catches the careless case, which is the common one, and
   * catches nothing deliberate.
   */
  readonly declaredRowCount: number;
  /** UNCORROBORATED. That the rows were not estimated, back-filled or reconstructed by hand. */
  readonly amountsAndDatesNotReconstructed: boolean;
  /** UNCORROBORATED. That the file came from the system named above. */
  readonly cameFromStatedSystem: boolean;
}

export interface ProvenanceAttestation {
  /** The accountable ROLE or team inside the customer. Never a person's name. */
  readonly dataOwnerRole: string;
  readonly expectationExport: ExportAttestation;
  readonly billingExport: ExportAttestation;
  readonly pseudonymisation: {
    readonly applied: boolean;
    /** UNCORROBORATED as a general claim; CORROBORATED in the one way that matters — the joins form. */
    readonly joinPreserving: boolean;
    /** UNCORROBORATED. That no identifier was replaced by a value derived from an amount, a date or a row position. */
    readonly noIdentifierDerivedFromAmountDateOrPosition: boolean;
  };
  /**
   * UNCORROBORATED positively, CORROBORATED negatively: NH cannot show a reference came from the source
   * system, and it CAN show one was composed from other cells on its own row. `null` when the column was
   * not supplied at all, so the claim is absent rather than false.
   */
  readonly obligationRefExportedFromSource: boolean | null;
}

// ── 2 · THE CLAIM CATALOGUE ───────────────────────────────────────────────────────────────────────

export type ClaimKind = "CORROBORATED" | "WELL_FORMED" | "UNCORROBORATED_CLAIM";

export interface AttestationClaimSpec {
  readonly id: string;
  readonly kind: ClaimKind;
  /** The pilot question it serves, so the form and the report can be read against the requirement. */
  readonly requirement: string;
  /** What the data owner is being asked to state, in their words. The form renders this verbatim. */
  readonly statement: string;
  /** What NH does about it. For an UNCORROBORATED_CLAIM this says plainly that nothing is done. */
  readonly howNhChecksIt: string;
}

function claim(spec: AttestationClaimSpec): AttestationClaimSpec {
  return Object.freeze(spec);
}

/**
 * Every claim, classified once. The customer-facing form is GENERATED from this list, so the form and
 * the checks cannot drift apart — the same rule the data request and the field dictionary already follow.
 */
export const ATTESTATION_CLAIMS: readonly AttestationClaimSpec[] = Object.freeze([
  claim({
    id: "OWNER_ROLE",
    kind: "WELL_FORMED",
    requirement: "Someone is accountable for this submission.",
    statement: "The role or team inside our organisation that owns these exports is named in the table.",
    howNhChecksIt: "Presence only. We ask for a ROLE and not a person — the pilot does not need anyone's name.",
  }),
  claim({
    id: "EXPECTATION_SOURCE_NAMED",
    kind: "WELL_FORMED",
    requirement: "1 · the expectation export came from the stated system of record",
    statement: "Export A was produced from the system named in the table, which is our system of record for contracted obligations.",
    howNhChecksIt: "We check that a system is named and that the extraction method is one of the listed kinds. We cannot check that the file came from it.",
  }),
  claim({
    id: "BILLING_SOURCE_NAMED",
    kind: "WELL_FORMED",
    requirement: "2 · the billing export came from the stated billing/ERP system",
    statement: "Export B was produced from the billing or ERP system named in the table.",
    howNhChecksIt: "As above: the name and the method are checked for shape. The origin itself is your assertion.",
  }),
  claim({
    id: "DECLARED_ROW_COUNT_AGREES",
    kind: "CORROBORATED",
    requirement: "the declaration and the file we received agree with each other",
    statement: "Each export contains exactly the number of rows stated in the table, counted at the moment of export.",
    howNhChecksIt: "We count the rows we received and compare them with your number. A match shows the two things you sent us are consistent; it does NOT show the file is complete, because you send us both and could change both. A mismatch is reported as a contradiction.",
  }),
  claim({
    id: "COVERAGE_WINDOW_HONOURED",
    kind: "CORROBORATED",
    requirement: "the export covers the window it claims to cover",
    statement: "Each export covers the inclusive window stated in the table, and contains no rows anchored outside it.",
    howNhChecksIt: "We check every row's anchor date — the invoice raise date on B, the period start on A — falls inside the declared window. A period that EXTENDS past the window is normal and is not a contradiction.",
  }),
  claim({
    id: "EXTRACTED_AFTER_COVERAGE",
    kind: "WELL_FORMED",
    requirement: "the export could have seen the whole window",
    statement: "Each export was taken on or after the last day of the window it covers.",
    howNhChecksIt: "Date comparison. An export taken before its window closed cannot be a complete statement for it.",
  }),
  claim({
    id: "IDENTIFIERS_SOURCE_NATIVE",
    kind: "CORROBORATED",
    requirement: "3 · source-native identifiers were preserved semantically",
    statement: "The identifiers in these files are the source systems' own, carried through unchanged except for pseudonymisation.",
    howNhChecksIt: "We check the two sides still share payer identities, and that the obligation join forms. These are necessary evidence and never a proof: a file can pass them and still have been re-keyed.",
  }),
  claim({
    id: "OBLIGATION_REF_NOT_MANUFACTURED",
    kind: "CORROBORATED",
    requirement: "4 · obligation_ref was exported from the source system, not manufactured for NH",
    statement: "Where `obligation_ref` is supplied, it is the contract system's own obligation identifier as billing received it — not created for this exercise.",
    howNhChecksIt: "We check no reference equals, contains or is contained by another cell on its own row, which is what a composed key looks like. We cannot prove the positive — only rule out the obvious fabrication.",
  }),
  claim({
    id: "JOINS_SURVIVED_PSEUDONYMISATION",
    kind: "CORROBORATED",
    requirement: "6 · pseudonymisation did not alter the semantic joins",
    statement: "If identifiers were pseudonymised, the same real identifier became the same token in BOTH exports.",
    howNhChecksIt: "We check the joins actually form across the two files. Pseudonymising each file independently — the common mistake — produces no overlap at all, and that we would see.",
  }),
  claim({
    id: "AMOUNTS_NOT_RECONSTRUCTED",
    kind: "UNCORROBORATED_CLAIM",
    requirement: "5 · amounts, currencies and timestamps were not estimated or manually reconstructed",
    statement: "No amount, currency or date in these files was estimated, rounded for presentation, back-filled or reconstructed by hand.",
    howNhChecksIt: "NOTHING. We cannot distinguish a real amount from a carefully estimated one. This is your assertion, recorded against the role above, and it does not raise the authority we report.",
  }),
  claim({
    id: "NO_DERIVED_IDENTIFIERS",
    kind: "UNCORROBORATED_CLAIM",
    requirement: "6b · pseudonyms are not derived from the data",
    statement: "No identifier was replaced by a value derived from an amount, a date or a row position.",
    howNhChecksIt: "NOTHING in general. A pseudonym that happens to encode an amount is indistinguishable from an opaque one.",
  }),
  claim({
    id: "EXPORT_IS_COMPLETE",
    kind: "UNCORROBORATED_CLAIM",
    requirement: "no rows were removed after the export was taken",
    statement: "Neither export had rows removed, filtered out or held back after it was taken from the source system.",
    howNhChecksIt: "NOTHING, and this is the one most worth understanding. The declaration and the file arrive together from the same party, so a row count that matches proves only that the two agree. Establishing completeness needs something we do not have: a record of what the source system actually held, made where you could not revise it.",
  }),
  claim({
    id: "FILES_CAME_FROM_STATED_SYSTEMS",
    kind: "UNCORROBORATED_CLAIM",
    requirement: "1 and 2, the part that cannot be checked",
    statement: "These files are the output of the systems named, and were not assembled, merged or edited in a spreadsheet afterwards.",
    howNhChecksIt: "NOTHING. Only a signed export or a fetch NH performs itself could establish this, and neither exists yet.",
  }),
]);

/** The claims whose failure keeps authority at SOURCE_NATIVE. UNCORROBORATED claims are never among them. */
export const RUNG_BEARING_CLAIMS: readonly string[] = Object.freeze(
  ATTESTATION_CLAIMS.filter((c) => c.kind !== "UNCORROBORATED_CLAIM").map((c) => c.id),
);

// ── 3 · CORROBORATION ─────────────────────────────────────────────────────────────────────────────

export type CheckOutcome = "PASS" | "CONTRADICTED" | "NOT_CHECKABLE";

export interface AttestationCheck {
  readonly claimId: string;
  readonly kind: ClaimKind;
  readonly outcome: CheckOutcome;
  readonly detail: string;
}

export interface AttestationCorroboration {
  readonly scheme: typeof ATTESTATION_SCHEME;
  readonly methodVersion: typeof ATTESTATION_METHOD_VERSION;
  readonly dataOwnerRole: string;
  readonly checks: readonly AttestationCheck[];
  /**
   * TRUE only when every rung-bearing claim passed. A `NOT_CHECKABLE` rung-bearing claim does NOT count
   * as a pass: it means we could not look, which is not the same as having looked and found nothing
   * wrong. Fails closed.
   */
  readonly allRungBearingClaimsPassed: boolean;
  /** Claims where the attestation and the files disagree. Worse than no attestation, and reported first. */
  readonly contradictions: readonly string[];
  /** Recorded, attributed, and explicitly not evidence for the rung. */
  readonly uncorroboratedClaims: readonly string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Distinct rows the validator saw. A row may carry several rejections, so counting rejections overcounts. */
function rowsReceived(v: { readonly accepted: readonly { rowNumber: number }[]; readonly rejections: readonly { rowNumber: number }[] }): number {
  const seen = new Set<number>();
  for (const a of v.accepted) seen.add(a.rowNumber);
  for (const r of v.rejections) seen.add(r.rowNumber);
  return seen.size;
}

/** A value long enough that containment in another cell is meaningful rather than coincidental. */
const KEYLIKE_MIN = 4;

/**
 * Check a declared attestation against the files it describes.
 *
 * It takes the two VALIDATIONS rather than the raw files, so it can only see what the contracts already
 * accepted — and it takes no parameter by which a caller could assert a result. The caller supplies the
 * DECLARATION; NH computes the corroboration. That asymmetry is the whole defence against self-vouching,
 * and it is structural rather than a validation.
 */
export function corroborateAttestation(
  attestation: ProvenanceAttestation,
  expectation: ExpectationExtractValidation,
  billing: BillingExtractValidation,
): AttestationCorroboration {
  const checks: AttestationCheck[] = [];
  const add = (claimId: string, outcome: CheckOutcome, detail: string): void => {
    const spec = ATTESTATION_CLAIMS.find((c) => c.id === claimId)!;
    checks.push(Object.freeze({ claimId, kind: spec.kind, outcome, detail }));
  };

  // ── WELL_FORMED ────────────────────────────────────────────────────────────────────────────────
  add("OWNER_ROLE",
    attestation.dataOwnerRole.trim() !== "" ? "PASS" : "CONTRADICTED",
    attestation.dataOwnerRole.trim() === "" ? "no accountable role is named" : `role: ${attestation.dataOwnerRole.trim()}`);

  const sides = [
    ["EXPECTATION_SOURCE_NAMED", "A · expectation", attestation.expectationExport, expectation] as const,
    ["BILLING_SOURCE_NAMED", "B · billing", attestation.billingExport, billing] as const,
  ];
  for (const [claimId, label, ex] of sides) {
    const named = ex.sourceSystem.trim() !== "";
    const methodKnown = EXTRACTION_METHODS.includes(ex.extractionMethod);
    const describedIfNeeded = ex.extractionMethod !== "other_described"
      || (ex.extractionMethodDescription ?? "").trim() !== "";
    add(claimId,
      named && methodKnown && describedIfNeeded ? "PASS" : "CONTRADICTED",
      !named ? `${label}: no source system named`
        : !methodKnown ? `${label}: extraction method is not one of the declared kinds`
          : !describedIfNeeded ? `${label}: method is other_described and no description was given`
            : `${label}: ${ex.sourceSystem.trim()} via ${ex.extractionMethod}`);
  }

  // An export taken before its window closed cannot be a complete statement for that window.
  {
    const bad = sides
      .filter(([, , ex]) => !ISO_DATE.test(ex.extractedAt) || !ISO_DATE.test(ex.coverageEnd) || ex.extractedAt < ex.coverageEnd)
      .map(([, label, ex]) => `${label}: taken ${ex.extractedAt}, window ends ${ex.coverageEnd}`);
    add("EXTRACTED_AFTER_COVERAGE", bad.length === 0 ? "PASS" : "CONTRADICTED",
      bad.length === 0 ? "both exports were taken on or after their window closed" : bad.join("; "));
  }

  // ── CORROBORATED · the declared row count AGREES WITH THE FILE WE RECEIVED ─────────────────────
  //
  // Not a pre-commitment and not a completeness check. Both artefacts arrive from the same party, so a
  // match establishes only that they are consistent with each other. That still has value — an
  // uncoordinated mismatch is the common real-world failure and refusing it costs nothing — and it
  // establishes nothing against anyone willing to change both.
  {
    const parts: string[] = [];
    let contradicted = false;
    let uncheckable = false;
    for (const [, label, ex, v] of sides) {
      if (!v.usable) {
        // Do not blame the attestation for a file NH could not read at all. That is an extract fault and
        // it already has its own code; reporting it here as a contradiction would point at the wrong thing.
        uncheckable = true;
        parts.push(`${label}: extract unusable, so its row count cannot be compared`);
        continue;
      }
      const actual = rowsReceived(v);
      if (actual !== ex.declaredRowCount) {
        contradicted = true;
        parts.push(`${label}: declared ${ex.declaredRowCount}, received ${actual}`);
      } else {
        parts.push(`${label}: ${actual} rows, as declared`);
      }
    }
    add("DECLARED_ROW_COUNT_AGREES",
      contradicted ? "CONTRADICTED" : uncheckable ? "NOT_CHECKABLE" : "PASS", parts.join("; "));
  }

  // ── CORROBORATED · the coverage window ─────────────────────────────────────────────────────────
  {
    // ANCHOR DATES ONLY, and this is a semantic choice rather than a shortcut. The anchor is the date the
    // row is ABOUT: when the charge was raised, or when the obligation's period begins. A period that
    // extends past the window end is ordinary — a monthly obligation straddles any cut-off — so treating
    // period_end as needing to be inside the window would manufacture contradictions out of normal data.
    const outside: string[] = [];
    const ea = attestation.expectationExport;
    for (const a of expectation.accepted) {
      if (ISO_DATE.test(a.periodStart) && (a.periodStart < ea.coverageStart || a.periodStart > ea.coverageEnd)) {
        outside.push(`A row ${a.rowNumber}: period starts ${a.periodStart}`);
      }
    }
    const ba = attestation.billingExport;
    for (const b of billing.accepted) {
      if (ISO_DATE.test(b.invoiceRaisedAt) && (b.invoiceRaisedAt < ba.coverageStart || b.invoiceRaisedAt > ba.coverageEnd)) {
        outside.push(`B row ${b.rowNumber}: raised ${b.invoiceRaisedAt}`);
      }
    }
    const windowsWellFormed = [ea, ba].every((x) =>
      ISO_DATE.test(x.coverageStart) && ISO_DATE.test(x.coverageEnd) && x.coverageStart <= x.coverageEnd);
    add("COVERAGE_WINDOW_HONOURED",
      !windowsWellFormed ? "CONTRADICTED" : outside.length === 0 ? "PASS" : "CONTRADICTED",
      !windowsWellFormed ? "a declared coverage window is malformed or ends before it starts"
        : outside.length === 0 ? "every row is anchored inside its declared window"
          : `${outside.length} row(s) anchored outside the declared window — ${outside.slice(0, 3).join("; ")}`);
  }

  // ── CORROBORATED · identifiers and the joins ───────────────────────────────────────────────────
  {
    // NECESSARY EVIDENCE, NEVER A PROOF — the same rule the semantic-equivalence correction established.
    // Independently pseudonymising the two files, which is the common mistake, yields NO shared payer and
    // no formed join, and that we can see. A consistent re-keying of both files would pass this and is
    // exactly what the rung does not claim to exclude.
    const ePayers = new Set(expectation.accepted.map((a) => a.payerRef).filter((p): p is string => !!p));
    const bPayers = new Set(billing.accepted.map((b) => b.payerRef).filter((p) => p !== ""));
    const sharedPayers = [...ePayers].filter((p) => bPayers.has(p)).length;
    const obligations = new Set(
      expectation.accepted.map((a) => a.scheduleLineRef).filter((r): r is string => typeof r === "string" && r !== ""),
    );
    const refs = billing.accepted.map((b) => b.obligationRef).filter((r): r is string => r !== null);
    const resolving = refs.filter((r) => obligations.has(r)).length;

    if (ePayers.size === 0 || bPayers.size === 0) {
      add("IDENTIFIERS_SOURCE_NATIVE", "NOT_CHECKABLE",
        "one side carries no payer identity, so the sides cannot be compared");
    } else {
      add("IDENTIFIERS_SOURCE_NATIVE", sharedPayers > 0 ? "PASS" : "CONTRADICTED",
        sharedPayers > 0
          ? `${sharedPayers} payer identit(ies) appear on both sides`
          : "the two exports share NO payer identity, which is what independently pseudonymised files look like");
    }

    if (refs.length === 0) {
      add("JOINS_SURVIVED_PSEUDONYMISATION", "NOT_CHECKABLE",
        "no obligation reference was supplied, so the cross-file join cannot be formed or tested");
    } else {
      add("JOINS_SURVIVED_PSEUDONYMISATION", resolving > 0 ? "PASS" : "CONTRADICTED",
        resolving > 0
          ? `${resolving} of ${refs.length} obligation reference(s) resolve to an accepted obligation`
          : `NONE of ${refs.length} obligation reference(s) resolve — the join does not form at all`);
    }
  }

  // ── CORROBORATED · obligation_ref was not composed from the row it sits on ──────────────────────
  {
    const composed: string[] = [];
    for (const b of billing.accepted) {
      const ref = b.obligationRef;
      if (ref === null || ref.length < KEYLIKE_MIN) continue;
      // Every other cell on the row that could have been used to build the reference.
      const others = [b.invoiceRef, b.invoiceLineRef, b.invoiceRaisedAt, String(b.invoiceLineAmountMinor),
        b.currency, b.payerRef, b.periodStart ?? "", b.periodEnd ?? "", b.legacySubscriptionRef ?? "",
        b.sourceSystem ?? ""].filter((c) => c.length >= KEYLIKE_MIN);
      if (others.some((c) => c === ref || c.includes(ref) || ref.includes(c))) {
        composed.push(`row ${b.rowNumber}: "${ref}"`);
      }
    }
    if (attestation.obligationRefExportedFromSource === null) {
      add("OBLIGATION_REF_NOT_MANUFACTURED", "NOT_CHECKABLE",
        "no obligation reference was supplied, so there is no claim to test");
    } else {
      add("OBLIGATION_REF_NOT_MANUFACTURED", composed.length === 0 ? "PASS" : "CONTRADICTED",
        composed.length === 0
          ? "no obligation reference is equal to, contains or is contained by another cell on its own row"
          : `${composed.length} reference(s) look composed from the row they sit on — ${composed.slice(0, 3).join("; ")}`);
    }
  }

  // ── UNCORROBORATED · recorded, attributed, and never evidence for the rung ──────────────────────
  for (const id of ["AMOUNTS_NOT_RECONSTRUCTED", "NO_DERIVED_IDENTIFIERS", "FILES_CAME_FROM_STATED_SYSTEMS",
    "EXPORT_IS_COMPLETE"]) {
    // EXPORT_IS_COMPLETE has no field of its own, deliberately: there is no box to tick that would make
    // it checkable, so it is reported as unestablished whatever the submission says. Giving it a boolean
    // would invite the reading that ticking it achieved something.
    const asserted = id === "AMOUNTS_NOT_RECONSTRUCTED"
      ? attestation.expectationExport.amountsAndDatesNotReconstructed
        && attestation.billingExport.amountsAndDatesNotReconstructed
      : id === "NO_DERIVED_IDENTIFIERS"
        ? attestation.pseudonymisation.noIdentifierDerivedFromAmountDateOrPosition
        : id === "EXPORT_IS_COMPLETE"
          ? false
          : attestation.expectationExport.cameFromStatedSystem && attestation.billingExport.cameFromStatedSystem;
    add(id, "NOT_CHECKABLE",
      id === "EXPORT_IS_COMPLETE"
        ? "NOT ESTABLISHED. The declaration and the file arrive together from the same party, so nothing here speaks to completeness. This does not raise authority and cannot be asserted into existence."
        : asserted
          ? "asserted by the data owner; NH performs no check and this does not raise authority"
          : "NOT asserted by the data owner — recorded as such");
  }

  const frozen = Object.freeze(checks.map((c) => Object.freeze(c)));
  const rungBearing = frozen.filter((c) => RUNG_BEARING_CLAIMS.includes(c.claimId));
  return Object.freeze({
    scheme: ATTESTATION_SCHEME,
    methodVersion: ATTESTATION_METHOD_VERSION,
    dataOwnerRole: attestation.dataOwnerRole.trim(),
    checks: frozen,
    allRungBearingClaimsPassed: rungBearing.length > 0 && rungBearing.every((c) => c.outcome === "PASS"),
    contradictions: Object.freeze(frozen.filter((c) => c.outcome === "CONTRADICTED").map((c) => c.claimId)),
    uncorroboratedClaims: Object.freeze(
      ATTESTATION_CLAIMS.filter((c) => c.kind === "UNCORROBORATED_CLAIM").map((c) => c.id),
    ),
  });
}
