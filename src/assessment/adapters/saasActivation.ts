// SaaS Activation adapter — the ONLY place that knows about subscriptions, activation, invoices and
// currency columns. It maps one CSV row to a neutral ExpectationCycle, or to an ExclusionRecord with
// an explicit reason. It never deduplicates or aggregates: collisions are the assess step's concern.
//
// Grain: one row = one subscription's expectation cycle (signed → activation → next invoice).
// cycleId is derived (preferring an explicit subscription/cycle id) and kept distinct from entityId.
import type { AssessmentPolicy } from "../policy";
import type { ExclusionRecord, ExpectationCycle, RowOutcome } from "../types";
import type { RawRow } from "../parse";
import { normalizeDate, type DateLocale } from "../dateNormalize";
import { normalizeAmount, type AmountFormat } from "../amountNormalize";
import { fromDecimal, isNegative, isPositive } from "../../domain/money";

export const SAAS_ADAPTER_ID = "saas-activation";
export const SAAS_ADAPTER_VERSION = "2026.1";

export interface AdapterOptions {
  readonly locale?: DateLocale; // for ambiguous numeric dates
  readonly amountFormat?: AmountFormat; // for ambiguous grouping/decimal separators
}

const REQUIRED = ["entity_id", "signed_at", "next_invoice_due_at", "next_invoice_amount", "currency"] as const;

/** Required columns absent from the header — a structural error (never a silent all-rows-excluded). */
export function missingRequiredColumns(headers: readonly string[]): string[] {
  const present = new Set(headers.map((h) => h.trim()));
  return REQUIRED.filter((r) => !present.has(r));
}

// --- Column mapping vocabulary --------------------------------------------------------------------
// This adapter is the ONLY place that knows what a source header might be called. The generic mapping
// mechanics (columnMap.ts) stay neutral and receive this as DATA. Real billing/CRM exports (Stripe,
// Chargebee, NetSuite, Salesforce…) rarely use our canonical names — these synonyms let a Design
// Partner's own CSV run without hand-editing headers, while the mapping is stamped for reproducibility.

/** Every canonical field `toCycle` can read (required + optional). */
export const SAAS_CANONICAL_FIELDS: readonly string[] = [
  "entity_id",
  "signed_at",
  "next_invoice_due_at",
  "next_invoice_amount",
  "currency",
  "subscription_id",
  "cycle_id",
  "activation_at",
  "next_invoice_paid_at",
  "next_invoice_paid",
  "paid_amount",
  "status",
  "is_test",
  "refunded",
  "cancelled",
  "plan",
  "segment",
  "product",
];

/** Required canonicals — re-exported for the mapping spec (single source of truth: REQUIRED). */
export const SAAS_REQUIRED: readonly string[] = REQUIRED;

/** canonical → common alternative source header names (matched case-insensitively). */
export const SAAS_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  entity_id: ["customer_id", "account_id", "customer", "account", "company_id", "org_id"],
  signed_at: ["contract_signed_at", "signed_date", "signup_date", "created_at", "close_date", "start_date"],
  next_invoice_due_at: ["invoice_due_date", "due_date", "next_invoice_date", "invoice_date", "billing_date"],
  next_invoice_amount: ["amount", "invoice_amount", "mrr", "arr", "invoice_total", "billing_amount"],
  currency: ["ccy", "currency_code", "iso_currency"],
  subscription_id: ["subscription", "sub_id"],
  activation_at: ["activated_at", "onboarded_at", "go_live_date", "first_value_at", "activation_date"],
  next_invoice_paid_at: ["paid_at", "invoice_paid_at", "payment_date", "paid_date"],
  next_invoice_paid: ["paid", "is_paid"],
  paid_amount: ["amount_paid", "settled_amount"],
  status: ["subscription_status", "account_status", "state"],
  is_test: ["test", "test_account", "is_internal"],
});

/** The mapping spec the generic detector consumes. Keeps SaaS vocabulary out of the neutral core. */
export const SAAS_MAPPING_SPEC = Object.freeze({
  canonicalFields: SAAS_CANONICAL_FIELDS,
  synonyms: SAAS_SYNONYMS,
  requiredFields: SAAS_REQUIRED,
});

function exclude(sourceRowId: string, reason: ExclusionRecord["reason"], detail: string): RowOutcome {
  return { kind: "excluded", exclusion: { sourceRowId, reason, detail } };
}

function parseBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n", ""].includes(s)) return false;
  return undefined;
}

export function toCycle(row: RawRow, policy: AssessmentPolicy, opts: AdapterOptions = {}): RowOutcome {
  const id = row.sourceRowId;
  if (row.malformed) return exclude(id, "unparseable_row", "column count does not match header");

  const c = row.cells;
  for (const f of REQUIRED) {
    if (!c[f] || c[f]!.trim() === "") return exclude(id, "missing_required_field", f);
  }

  // Currency — single-currency policy; never aggregate across currencies.
  const currency = c["currency"]!.trim().toUpperCase();
  if (currency !== policy.currency.toUpperCase()) {
    return exclude(id, "currency_mismatch", `${currency} != policy ${policy.currency}`);
  }

  // Test/internal + excluded statuses.
  const statusRaw = (c["status"] ?? "").trim() || null;
  if (parseBool(c["is_test"] ?? "") === true) return exclude(id, "internal_or_test_account", "is_test");
  if (statusRaw && policy.excludedStatuses.some((s) => s.toLowerCase() === statusRaw.toLowerCase())) {
    return exclude(id, "excluded_status", statusRaw);
  }

  // Dates.
  const signed = normalizeDate(c["signed_at"]!, { locale: opts.locale });
  if (!signed.ok) return exclude(id, signed.reason, `signed_at: ${signed.detail}`);
  const due = normalizeDate(c["next_invoice_due_at"]!, { locale: opts.locale });
  if (!due.ok) return exclude(id, due.reason, `next_invoice_due_at: ${due.detail}`);

  let observationAt: string | null = null;
  if ((c["activation_at"] ?? "").trim() !== "") {
    const act = normalizeDate(c["activation_at"]!, { locale: opts.locale });
    if (!act.ok) return exclude(id, act.reason, `activation_at: ${act.detail}`);
    observationAt = act.iso;
  }

  // Amount — normalize a possibly-formatted export value ($, thousands separators, etc.) to a plain
  // decimal, then cross the SINGLE governed decimal boundary (fromDecimal) for exact minor units.
  const amountNorm = normalizeAmount(c["next_invoice_amount"]!, { format: opts.amountFormat });
  if (!amountNorm.ok) return exclude(id, amountNorm.reason, `next_invoice_amount: ${amountNorm.detail}`);
  let amount;
  try {
    amount = fromDecimal(amountNorm.decimal, currency);
  } catch {
    return exclude(id, "invalid_amount", c["next_invoice_amount"]!);
  }
  if (isNegative(amount)) return exclude(id, "negative_amount", c["next_invoice_amount"]!);
  if (!isPositive(amount)) return exclude(id, "zero_amount", c["next_invoice_amount"]!);

  // Optional settled amount (for partial detection).
  let paidAmount = null;
  if ((c["paid_amount"] ?? "").trim() !== "") {
    const paidNorm = normalizeAmount(c["paid_amount"]!, { format: opts.amountFormat });
    if (!paidNorm.ok) return exclude(id, paidNorm.reason, `paid_amount: ${paidNorm.detail}`);
    try {
      paidAmount = fromDecimal(paidNorm.decimal, currency);
    } catch {
      return exclude(id, "invalid_amount", `paid_amount: ${c["paid_amount"]}`);
    }
  }

  // Payment timing: prefer an observed timestamp; a bare boolean is a documented compatibility input.
  let paidAt: string | null = null;
  if ((c["next_invoice_paid_at"] ?? "").trim() !== "") {
    const pd = normalizeDate(c["next_invoice_paid_at"]!, { locale: opts.locale });
    if (!pd.ok) return exclude(id, pd.reason, `next_invoice_paid_at: ${pd.detail}`);
    paidAt = pd.iso;
  } else {
    const paidBool = parseBool(c["next_invoice_paid"] ?? "");
    // COMPATIBILITY: a true boolean without a timestamp is normalized to "paid at the due date".
    // This keeps the paid/unpaid axis correct (out of the Unpaid headline) but cannot distinguish
    // on-time vs late — a documented limitation of boolean-only inputs.
    if (paidBool === true) paidAt = due.iso;
  }

  const refunded = parseBool(c["refunded"] ?? "") === true || statusRaw?.toLowerCase() === "refunded";
  const cancelled = parseBool(c["cancelled"] ?? "") === true || statusRaw?.toLowerCase() === "cancelled";

  // cycleId — prefer an explicit id; else a deterministic composite (collision-tested in assess).
  const explicitCycle = (c["subscription_id"] ?? c["cycle_id"] ?? "").trim();
  const entityId = c["entity_id"]!.trim();
  const cycleId = explicitCycle !== "" ? explicitCycle : `${entityId}|${signed.iso}|${due.iso}`;

  const attributes: Record<string, string> = {};
  for (const k of ["plan", "segment", "product"]) {
    if ((c[k] ?? "").trim() !== "") attributes[k] = c[k]!.trim();
  }
  if (paidAmount === null && (c["next_invoice_paid_at"] ?? "").trim() === "" && parseBool(c["next_invoice_paid"] ?? "") === true) {
    attributes["paid_timing"] = "unknown_from_bool";
  }

  const cycle: ExpectationCycle = Object.freeze({
    cycleId,
    sourceRowId: id,
    entityId,
    expectationAt: signed.iso,
    observationAt,
    monetaryEvent: Object.freeze({
      dueAt: due.iso,
      amount,
      paidAt,
      paidAmount,
      refunded,
      cancelled,
    }),
    currency,
    statusRaw,
    attributes: Object.freeze(attributes),
  });
  return { kind: "cycle", cycle };
}

/** Default SaaS activation policy fields (definitions captured into the policy for the audit trail). */
export const SAAS_ACTIVATION_DEFS = Object.freeze({
  activationDefinition:
    "A subscription is stalled if it was not activated (activation_at) within N days of signed_at, as of asOf.",
  paymentDefinition:
    "The next invoice is settled if next_invoice_paid_at is on/before its due date and on/before asOf.",
});
