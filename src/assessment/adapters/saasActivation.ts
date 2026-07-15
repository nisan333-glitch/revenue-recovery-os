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
import { fromDecimal, isNegative, isPositive } from "../../domain/money";

export const SAAS_ADAPTER_ID = "saas-activation";
export const SAAS_ADAPTER_VERSION = "2026.1";

export interface AdapterOptions {
  readonly locale?: DateLocale; // for ambiguous numeric dates
}

const REQUIRED = ["entity_id", "signed_at", "next_invoice_due_at", "next_invoice_amount", "currency"] as const;

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

  // Amount — exact minor units via the governed decimal boundary.
  let amount;
  try {
    amount = fromDecimal(c["next_invoice_amount"]!, currency);
  } catch {
    return exclude(id, "invalid_amount", c["next_invoice_amount"]!);
  }
  if (isNegative(amount)) return exclude(id, "negative_amount", c["next_invoice_amount"]!);
  if (!isPositive(amount)) return exclude(id, "zero_amount", c["next_invoice_amount"]!);

  // Optional settled amount (for partial detection).
  let paidAmount = null;
  if ((c["paid_amount"] ?? "").trim() !== "") {
    try {
      paidAmount = fromDecimal(c["paid_amount"]!, currency);
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
