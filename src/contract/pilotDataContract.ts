// Customer Pilot Data Contract v1 — the single, versioned statement of what a customer must supply
// for an Activation Recovery pilot, and what the system promises to do with it.
//
// WHY THIS EXISTS. Before this module the answer to "what data does a pilot need?" was spread across
// three places that could drift apart: the adapter's REQUIRED tuple (src/assessment/adapters/
// saasActivation.ts), prose in the intake kit's data-request guide, and a separate, narrower CSV
// shape on the server ingestion path. A customer could satisfy one and fail another. This file is
// the declaration all of them can be checked against.
//
// WHAT IT IS NOT. It is NOT a second validator competing with the adapter, and it NEVER relaxes one.
// The adapter remains the authority on whether a row becomes an ExpectationCycle; every row it
// excludes stays excluded. This contract (a) declares the rules up front so a customer can comply
// before uploading, (b) adds a STABLE MACHINE-READABLE CODE and remediation to each rejection, and
// (c) rejects additional things the adapter never had to consider — undeclared columns, PII-shaped
// values, ambiguous local timestamps, missing tenant binding.
//
// THE ONE RULE THAT OVERRIDES CONVENIENCE: invalid customer data is REJECTED WITH A REASON, never
// repaired, defaulted, coerced or silently dropped. A pilot that quietly fixes its input cannot
// later prove what it measured.
//
// CLAIM BOUNDARY. Nothing here produces, forecasts or counts money. A validated dataset is INPUT to
// an observed assessment. It is not Revenue Opportunity, not Revenue Returned, not Auditable
// Revenue, and it can never reach a Proof except through the existing governed
// Case → Evidence → Approval path, by a human, under the trust gates that already exist.

/** Semantic version of the contract itself. Consumers pin, compare and negotiate on this. */
export const PILOT_DATA_CONTRACT_VERSION = "1.0.0";

/** Stable identity of this contract, stamped into every report and manifest. */
export const PILOT_DATA_CONTRACT_ID = "nh.customer-pilot-data-contract";

/** `id@version` — the form that appears in reports and audit records. */
export const PILOT_DATA_CONTRACT_REF = `${PILOT_DATA_CONTRACT_ID}@${PILOT_DATA_CONTRACT_VERSION}`;

// ── 1 · Field requirements ────────────────────────────────────────────────────────────────────────

/**
 * How badly the pilot needs a field.
 *  • required    — the dataset is rejected without it. No default is ever substituted.
 *  • recommended — accepted without it, but the assessment is measurably weaker and says so.
 *  • optional    — a refinement (matching dimensions, reversal detail).
 */
export type FieldRequirement = "required" | "recommended" | "optional";

/**
 * How a value is parsed and what rule set applies. Types are deliberately coarse — the contract
 * declares intent; the existing normalizers (dateNormalize, amountNormalize, money.fromDecimal)
 * remain the implementation and are not duplicated here.
 */
export type FieldKind =
  | "identifier" // stable join key; never a human name or contact detail
  | "date" // calendar day, timezone-agnostic (see TIME_RULES)
  | "instant" // exact point in time; UTC offset REQUIRED
  | "money_decimal" // decimal amount paired with `currency`
  | "currency_code" // ISO 4217
  | "boolean"
  | "enum"
  | "dimension"; // low-cardinality grouping label (plan, segment, product)

/**
 * Data-protection class. This drives rejection, not documentation:
 *  • identifier_pseudonymous — an opaque key. Checked against PII shapes and rejected if it looks
 *    like a person (email/phone/card). A customer's internal account id is fine; an email is not.
 *  • operational            — dates, amounts, statuses. No personal data expected.
 *  • prohibited             — must never appear in a pilot dataset at all.
 */
export type PiiClass = "identifier_pseudonymous" | "operational" | "prohibited";

export interface FieldSpec {
  /** Canonical name. Matches the adapter's vocabulary so the two can never fork. */
  readonly name: string;
  readonly requirement: FieldRequirement;
  readonly kind: FieldKind;
  readonly piiClass: PiiClass;
  /** What the field means to the customer, in their language. */
  readonly description: string;
  /** Which system normally owns it — provenance starts at the request, not at upload. */
  readonly typicalSourceSystem: "crm" | "billing" | "product" | "any";
  /** Version in which the field was introduced (see COMPATIBILITY_POLICY). */
  readonly since: string;
}

function field(spec: FieldSpec): FieldSpec {
  return Object.freeze(spec);
}

/**
 * THE FIELD TABLE. Canonical names are the adapter's (`SAAS_CANONICAL_FIELDS`) — this contract
 * declares requirement, PII class, provenance and semantics for each; it does not invent a parallel
 * vocabulary. Header synonyms stay in the adapter, which owns the SaaS dialect.
 */
export const PILOT_DATA_CONTRACT_FIELDS: readonly FieldSpec[] = Object.freeze([
  field({
    name: "entity_id",
    requirement: "required",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "Stable customer/account identifier. An internal key — never an email, phone or personal name.",
    typicalSourceSystem: "crm",
    since: "1.0.0",
  }),
  field({
    name: "signed_at",
    requirement: "required",
    kind: "date",
    piiClass: "operational",
    description: "Date the contract or subscription was signed — the commitment that creates the obligation.",
    typicalSourceSystem: "crm",
    since: "1.0.0",
  }),
  field({
    name: "next_invoice_due_at",
    requirement: "required",
    kind: "date",
    piiClass: "operational",
    description: "Due date of the invoice under observation. Must not precede signed_at.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "next_invoice_amount",
    requirement: "required",
    kind: "money_decimal",
    piiClass: "operational",
    description: "Gross obligated amount of that invoice, in major units, positive.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "currency",
    requirement: "required",
    kind: "currency_code",
    piiClass: "operational",
    description: "ISO 4217 code. One currency per dataset — amounts are never converted or summed across currencies.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "subscription_id",
    requirement: "recommended",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "Stable cycle-level join key. Without it the cycle key is derived, and two real cycles can collide.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "cycle_id",
    requirement: "optional",
    kind: "identifier",
    piiClass: "identifier_pseudonymous",
    description: "Alternative cycle-level join key when subscription_id is not the billing grain.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "activation_at",
    requirement: "recommended",
    kind: "date",
    piiClass: "operational",
    description: "Customer-confirmed activation milestone. Absent means 'not activated', which is a finding, not a gap.",
    typicalSourceSystem: "product",
    since: "1.0.0",
  }),
  field({
    name: "next_invoice_paid_at",
    requirement: "recommended",
    kind: "date",
    piiClass: "operational",
    description: "Observed settlement date. Preferred over the boolean: only a date distinguishes on-time from late.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "next_invoice_paid",
    requirement: "optional",
    kind: "boolean",
    piiClass: "operational",
    description: "Compatibility input for sources with no settlement timestamp. Cannot establish timing; marked as such.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "paid_amount",
    requirement: "recommended",
    kind: "money_decimal",
    piiClass: "operational",
    description: "Observed settled amount. Required to detect partial payment; must not exceed next_invoice_amount.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "refunded_at",
    requirement: "recommended",
    kind: "date",
    piiClass: "operational",
    description: "Effective date of a refund. A refund state without a date is rejected — timing decides point-in-time truth.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "cancelled_at",
    requirement: "recommended",
    kind: "date",
    piiClass: "operational",
    description: "Effective date of a cancellation. Same rule as refunded_at.",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "refunded",
    requirement: "optional",
    kind: "boolean",
    piiClass: "operational",
    description: "Refund flag. Must be accompanied by refunded_at (or a dated status change).",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "cancelled",
    requirement: "optional",
    kind: "boolean",
    piiClass: "operational",
    description: "Cancellation flag. Must be accompanied by cancelled_at (or a dated status change).",
    typicalSourceSystem: "billing",
    since: "1.0.0",
  }),
  field({
    name: "status",
    requirement: "optional",
    kind: "enum",
    piiClass: "operational",
    description: "Raw lifecycle status from the source, used for inclusion/exclusion under the stamped policy.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
  field({
    name: "status_effective_at",
    requirement: "optional",
    kind: "date",
    piiClass: "operational",
    description: "When the status became effective. Supplies the date a bare refunded/cancelled status lacks.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
  field({
    name: "is_test",
    requirement: "optional",
    kind: "boolean",
    piiClass: "operational",
    description: "Marks internal/test accounts so they are excluded rather than counted as customer exposure.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
  field({
    name: "plan",
    requirement: "optional",
    kind: "dimension",
    piiClass: "operational",
    description: "Plan/tier label, for matched comparison. Low cardinality; never free text about a person.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
  field({
    name: "segment",
    requirement: "optional",
    kind: "dimension",
    piiClass: "operational",
    description: "Segment label, for matched comparison.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
  field({
    name: "product",
    requirement: "optional",
    kind: "dimension",
    piiClass: "operational",
    description: "Product label, for matched comparison.",
    typicalSourceSystem: "any",
    since: "1.0.0",
  }),
]);

const BY_NAME: ReadonlyMap<string, FieldSpec> = new Map(
  PILOT_DATA_CONTRACT_FIELDS.map((f) => [f.name, f]),
);

export function contractField(name: string): FieldSpec | undefined {
  return BY_NAME.get(name);
}

export function fieldsByRequirement(requirement: FieldRequirement): readonly string[] {
  return Object.freeze(PILOT_DATA_CONTRACT_FIELDS.filter((f) => f.requirement === requirement).map((f) => f.name));
}

/** Required canonical fields. Must agree with the adapter's REQUIRED — asserted in the tests. */
export const CONTRACT_REQUIRED_FIELDS: readonly string[] = fieldsByRequirement("required");

// ── 3 · Time, timezone and ordering ───────────────────────────────────────────────────────────────

/**
 * TIME RULES.
 *
 * Calendar-day fields are timezone-agnostic on purpose: an invoice is due on a DAY, and re-projecting
 * that day through a timezone is how an obligation silently moves across a period boundary. So a
 * date field is accepted only as an unambiguous calendar day, and is compared as a day.
 *
 * A timestamp that carries a time but NO offset ("2026-02-01 14:30:00") is ambiguous — it means
 * different instants in different zones. It is REJECTED rather than assumed to be UTC or local.
 * That is the single most common silent corruption in customer exports, and guessing it would put an
 * unprovable assumption underneath every downstream number.
 */
export const TIME_RULES = Object.freeze({
  dateGranularity: "calendar_day" as const,
  /** Accepted date forms, in the adapter's own normalizer vocabulary. */
  acceptedDateForms: Object.freeze([
    "YYYY-MM-DD (preferred, unambiguous)",
    "YYYY-MM-DDTHH:mm:ssZ (UTC instant — the date part is taken)",
    "YYYY/MM/DD",
    "D MMM YYYY / MMM D, YYYY (month name — unambiguous)",
    "numeric D/M/Y or M/D/Y ONLY when self-disambiguating (one part > 12) or an explicit locale is supplied",
  ]),
  /** A local time with no offset is not a point in time. Rejected, never assumed. */
  rejectLocalTimestampWithoutOffset: true,
  /** Ambiguous numeric dates require an explicit locale — never a guess. */
  rejectAmbiguousNumericDateWithoutLocale: true,
  /** Ordering constraints enforced across fields of one row. */
  ordering: Object.freeze([
    "signed_at <= next_invoice_due_at (an invoice cannot be due before the contract that creates it)",
    "signed_at <= activation_at (a customer cannot activate before signing)",
    "every date is compared at day granularity, never by wall-clock instant",
  ]),
  /**
   * The analysis cut-off (`asOf`) is the ONLY clock the classification may consult. A value dated
   * after `asOf` is future information and must not retroactively change a point-in-time answer.
   */
  asOfIsTheOnlyClock: true,
});

// ── 4 · Money, currency and precision ─────────────────────────────────────────────────────────────

/**
 * MONEY RULES. Exactness is not a preference here — a float cent that rounds the wrong way inside a
 * fee-bearing path is a trust failure, so the contract forbids the representation, not just the bug.
 */
export const MONEY_RULES = Object.freeze({
  /** Customers supply decimal major units; the system converts ONCE, at the boundary. */
  customerSupplies: "decimal_major_units" as const,
  /** Internally every amount is an exact integer in the currency's minor unit. Never a float. */
  internalRepresentation: "exact_integer_minor_units" as const,
  /** More fractional digits than the currency supports is a REJECTION, never a rounding. */
  rejectExcessPrecision: true,
  /** One currency per dataset. Cross-currency rows are excluded, never converted or summed. */
  singleCurrencyPerDataset: true,
  /** No FX conversion exists anywhere in the pilot path. */
  performsCurrencyConversion: false,
  /** Obligations must be strictly positive; a settled amount may not exceed the obligation. */
  obligationMustBePositive: true,
  settledAmountMayNotExceedObligation: true,
});

// ── 5 · Source system and provenance ──────────────────────────────────────────────────────────────

/**
 * Provenance the customer declares ABOUT the dataset (never inside it — a row cannot vouch for its
 * own origin). Declared provenance is a CLAIM: it is recorded and stamped, and it is never treated
 * as verified independence. Server-side Ed25519 source attestation (services/sourceVerification.ts)
 * is the only thing that upgrades a claim into verified evidence.
 */
export interface DatasetProvenance {
  /** Which system produced the extract, per logical field group. */
  readonly sourceSystems: Readonly<Record<"contract" | "billing" | "product", string>>;
  /** Who inside the customer owns the extract (a role/team, not a named individual). */
  readonly dataOwnerRole: string;
  /** How the extract was produced — a query, a report export, a warehouse view. */
  readonly extractionMethod: string;
  /** When the extract was taken. RFC3339 UTC instant. */
  readonly extractedAt: string;
  /** Inclusive observation window the extract covers, as calendar days. */
  readonly coverageStart: string;
  readonly coverageEnd: string;
  /**
   * Whether the customer asserts the source is outside the beneficiary's unilateral control.
   * Recorded as an ASSERTION. It never satisfies the trust invariant on its own.
   */
  readonly assertedIndependentOfBeneficiary: boolean;
}

export const PROVENANCE_FIELDS: readonly (keyof DatasetProvenance)[] = Object.freeze([
  "sourceSystems",
  "dataOwnerRole",
  "extractionMethod",
  "extractedAt",
  "coverageStart",
  "coverageEnd",
  "assertedIndependentOfBeneficiary",
]);

// ── 6 · Data minimization and PII ─────────────────────────────────────────────────────────────────

/**
 * MINIMIZATION. The pilot needs joins, dates and amounts. It does not need people. Any column not
 * declared in the field table is REJECTED rather than ignored, because an ignored column still
 * travels in the file the customer uploaded, still lands in memory, and still ends up in whatever
 * the operator screenshots.
 *
 * Rejecting is deliberately less convenient than stripping. Stripping would teach customers that
 * over-sharing is harmless, and it would make the uploaded file and the assessed file differ — the
 * fingerprint would then attest to something the customer never saw.
 */
export const MINIMIZATION_RULES = Object.freeze({
  rejectUndeclaredColumns: true,
  stripsOrRedactsSilently: false,
  /** Field names that must never appear in a pilot dataset, matched case-insensitively. */
  prohibitedFieldNames: Object.freeze([
    "email", "email_address", "contact_email", "phone", "phone_number", "mobile",
    "first_name", "last_name", "full_name", "contact_name", "name", "address",
    "street", "postcode", "zip", "date_of_birth", "dob", "ssn", "national_id",
    "tax_id", "vat_number", "card_number", "pan", "iban", "bank_account", "password", "api_key",
  ]),
  /** Value shapes that indicate a person hiding in an identifier column. */
  prohibitedValueShapes: Object.freeze(["email address", "international phone number", "payment card number (Luhn-shaped)"]),
});

// Email detection is an explicit scan rather than a regex. These predicates run over uploaded,
// attacker-influenceable CSV content, so the cost of each one should be obvious from reading it
// instead of depending on how a particular engine optimises a pattern. (The equivalent regex
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ is in fact linear here — its character classes exclude "@", so the
// split around it is unambiguous — but that is a subtle property to have to re-derive, and a later
// edit widening a class would quietly lose it.) A scan has no such failure mode and no length cap,
// so it detects everything the regex did.
const PHONE_SHAPE = /^\+[0-9][0-9\s().-]{7,}$/; // single character class — linear
const CARD_SHAPE = /^(?:\d[ -]?){13,19}$/; // bounded repetition — linear

function isEmailShaped(v: string): boolean {
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@") || at === v.length - 1) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (/[\s]/.test(local) || /[\s]/.test(domain)) return false;
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/** Does a value look like personal data? Shape-based, conservative, and never auto-corrected. */
export function looksLikePii(value: string): "email" | "phone" | "card" | null {
  const v = value.trim();
  if (v === "") return null;
  if (isEmailShaped(v)) return "email";
  if (PHONE_SHAPE.test(v)) return "phone";
  if (CARD_SHAPE.test(v) && luhn(v.replace(/[ -]/g, ""))) return "card";
  return null;
}

/** Luhn check — used ONLY to avoid rejecting ordinary long numeric ids as if they were cards. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isProhibitedFieldName(header: string): boolean {
  return MINIMIZATION_RULES.prohibitedFieldNames.includes(header.trim().toLowerCase());
}

// ── 10 · Versioning and backward compatibility ────────────────────────────────────────────────────

/**
 * COMPATIBILITY POLICY. A customer builds an export pipeline against a version; the contract owes
 * them a rule for when that pipeline breaks. Semantics are versioned as strictly as the shape:
 * silently changing what `activation_at` MEANS is a breaking change even though every column name
 * stayed identical — and it is the kind of change that invalidates a pilot's conclusions without
 * anyone noticing.
 */
export const COMPATIBILITY_POLICY = Object.freeze({
  scheme: "semver" as const,
  patch: "Editorial only — wording, remediation text, documentation. No parsing or acceptance change.",
  minor: Object.freeze([
    "Add an optional or recommended field.",
    "Add a header synonym.",
    "Add a new rejection code for a case previously reported under a broader code.",
    "Relax a rule so that a dataset valid under X.Y is still valid under X.(Y+1).",
  ]),
  major: Object.freeze([
    "Add or promote a required field.",
    "Remove or rename a field.",
    "Change the MEANING of an existing field, even with an identical name and type.",
    "Tighten a validation rule so a previously valid dataset is now rejected.",
    "Change the identity/idempotency derivation.",
  ]),
  /** A dataset declaring an older MINOR of the same MAJOR is accepted and its version recorded. */
  acceptsOlderMinorOfSameMajor: true,
  /** A dataset declaring a NEWER version than the code implements is rejected, never guessed at. */
  acceptsNewerThanImplemented: false,
  /** Two majors are supported concurrently for at least one full pilot cycle before removal. */
  deprecationWindow: "one full pilot cycle, minimum",
});

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseContractVersion(version: string): ParsedVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  return Object.freeze({ major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) });
}

/**
 * May this build process a dataset declaring `declared`? Same major and not newer than implemented.
 * Fails closed on anything unparseable — an unreadable version is not a compatible one.
 */
export function isSupportedContractVersion(declared: string): boolean {
  const d = parseContractVersion(declared);
  const impl = parseContractVersion(PILOT_DATA_CONTRACT_VERSION);
  if (!d || !impl) return false;
  if (d.major !== impl.major) return false;
  if (d.minor > impl.minor) return false;
  if (d.minor === impl.minor && d.patch > impl.patch) return false;
  return true;
}
